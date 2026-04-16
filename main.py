import asyncio
import json
import logging
import random
import uuid
from contextlib import asynccontextmanager

import numpy as np
from fastapi import Depends, FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, EmailStr, field_validator
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from Accounts import (
    decode_token,
    get_user,
    login_user,
    register_user,
    request_password_reset,
    resend_verification_email,
    reset_password,
    verify_email,
)

logger = logging.getLogger(__name__)

# ---------- P2P networking system ----------
FANOUT = 10  # max neighbors per peer
RESERVED = 6  # reserved slots for emergency repairs and new peers
FIEDLER_THRESHOLD = 0.85  # below this, try to repair


class Peer:
    def __init__(self, peer_id: str, ws: WebSocket):
        self.peer_id = peer_id
        self.ws = ws
        self.neighbors: list[str] = []
        self.slots: int = RESERVED
        self.user_id: str | None = None

    async def sendText(self, text: str):
        try:
            await self.ws.send_text(text)
        except WebSocketDisconnect:
            pass


class Network:
    def __init__(self):
        self.peers: dict[str, Peer] = {}
        self.adjacency: np.ndarray = np.zeros((0, 0))

    def peerIndex(self) -> dict[str, int]:
        return {pid: i for i, pid in enumerate(self.peers)}

    def expandAdjacency(self):
        n = len(self.peers)
        new_matrix = np.zeros((n, n))
        if n > 1:
            new_matrix[: n - 1, : n - 1] = self.adjacency
        self.adjacency = new_matrix

    def addEdge(self, peer_a: str, peer_b: str):
        idx = self.peerIndex()
        i, j = idx[peer_a], idx[peer_b]
        self.adjacency[i][j] = 1
        self.adjacency[j][i] = 1

        if peer_b not in self.peers[peer_a].neighbors:
            self.peers[peer_a].neighbors.append(peer_b)
        if peer_a not in self.peers[peer_b].neighbors:
            self.peers[peer_b].neighbors.append(peer_a)

    def add(self, peer: Peer) -> list[str]:
        n = len(self.peers)

        if n == 0:
            self.peers[peer.peer_id] = peer
            self.expandAdjacency()
            return []

        if n == 1:
            only_peer = next(iter(self.peers))
            self.peers[peer.peer_id] = peer
            self.expandAdjacency()
            self.addEdge(peer.peer_id, only_peer)
            return peer.neighbors

        self.peers[peer.peer_id] = peer
        self.expandAdjacency()

        steps = (FANOUT - RESERVED) // 2
        for _ in range(steps):
            side_a, side_b, _ = self.findBottleneck()

            candidates_a = [p for p in side_a if p not in peer.neighbors and p != peer.peer_id]
            candidates_b = [p for p in side_b if p not in peer.neighbors and p != peer.peer_id]

            if candidates_a:
                self.addEdge(peer.peer_id, random.choice(candidates_a))

            if candidates_b:
                self.addEdge(peer.peer_id, random.choice(candidates_b))

        return peer.neighbors

    def remove(self, peer_id: str) -> list[str]:
        if peer_id not in self.peers:
            return []

        idx = self.peerIndex()
        remove_idx = idx[peer_id]
        departed_neighbors = list(self.peers[peer_id].neighbors)

        for neighbor_id in departed_neighbors:
            neighbor = self.peers.get(neighbor_id)
            if neighbor:
                neighbor.neighbors = [pid for pid in neighbor.neighbors if pid != peer_id]

        del self.peers[peer_id]

        if self.adjacency.size:
            self.adjacency = np.delete(self.adjacency, remove_idx, axis=0)
            self.adjacency = np.delete(self.adjacency, remove_idx, axis=1)

        return departed_neighbors

    def findBottleneck(self) -> tuple[list[str], list[str], np.ndarray]:
        peer_ids = list(self.peers.keys())
        d_matrix = np.diag(self.adjacency.sum(axis=1))
        laplacian = d_matrix - self.adjacency

        _, eigenvectors = np.linalg.eigh(laplacian)
        fiedler_vector = eigenvectors[:, 1]

        partition_a = [peer_ids[i] for i, value in enumerate(fiedler_vector) if value < 0]
        partition_b = [peer_ids[i] for i, value in enumerate(fiedler_vector) if value >= 0]
        return (partition_a, partition_b, fiedler_vector)

    def fiedlerValue(self) -> float:
        d_matrix = np.diag(self.adjacency.sum(axis=1))
        laplacian = d_matrix - self.adjacency
        eigenvalues = np.linalg.eigvalsh(laplacian)
        return float(np.sort(eigenvalues)[1])

    def repair(self) -> tuple[str, str] | None:
        partition_a, partition_b, fiedler_vector = self.findBottleneck()
        idx = self.peerIndex()

        side_a = sorted(partition_a, key=lambda peer_id: fiedler_vector[idx[peer_id]])
        side_b = sorted(partition_b, key=lambda peer_id: -fiedler_vector[idx[peer_id]])

        for peer_a in side_a:
            for peer_b in side_b:
                if (
                    peer_b not in self.peers[peer_a].neighbors
                    and self.peers[peer_a].slots > 0
                    and self.peers[peer_b].slots > 0
                ):
                    self.addEdge(peer_a, peer_b)
                    self.peers[peer_a].slots -= 1
                    self.peers[peer_b].slots -= 1
                    return (peer_a, peer_b)

        return None


network = Network()


# ---------- Background diagnostics ----------
async def diagnosticsLoop():
    while True:
        try:
            await asyncio.sleep(10)
            if len(network.peers) < 3:
                continue

            fiedler = network.fiedlerValue()
            if fiedler < FIEDLER_THRESHOLD:
                bridge = network.repair()
                if not bridge:
                    continue

                peer_a, peer_b = bridge
                first = network.peers.get(peer_a)
                second = network.peers.get(peer_b)
                if not first or not second:
                    continue

                await first.sendText(json.dumps({"type": "CONNECT_TO_NEW_PEER", "peer_id": peer_b}))
                await second.sendText(json.dumps({"type": "CONNECT_TO_NEW_PEER", "peer_id": peer_a}))
        except Exception:
            logger.exception("Diagnostics loop failed")


# ---------- App setup ----------
@asynccontextmanager
async def lifespan(app: FastAPI):
    asyncio.create_task(diagnosticsLoop())
    yield


def get_real_ip(request: Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host


limiter = Limiter(key_func=get_real_ip)
app = FastAPI(title="Poly-Market API", lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

bearer = HTTPBearer()


# ---------- REST endpoints ----------
@app.get("/health")
def health():
    return {
        "peers": len(network.peers),
        "fiedler": network.fiedlerValue() if len(network.peers) >= 2 else None,
    }


@app.get("/network")
def network_state():
    return {
        "peers": {
            pid: {
                "neighbors": peer.neighbors,
                "slots": peer.slots,
                "user_id": peer.user_id,
            }
            for pid, peer in network.peers.items()
        },
        "adjacency": network.adjacency.tolist(),
    }


# ---------- WebSocket signaling ----------
@app.websocket("/connect")
async def connect(ws: WebSocket, token: str = Query(...)):
    try:
        payload = decode_token(token, expected_type="session")
        user_id = payload["sub"]
    except ValueError:
        await ws.close(code=1008)
        return

    await ws.accept()
    peer_id = str(uuid.uuid4())
    peer = Peer(peer_id, ws)
    peer.user_id = user_id
    neighbors = network.add(peer)

    await ws.send_text(
        json.dumps(
            {
                "type": "PEERS",
                "your_id": peer_id,
                "user_id": user_id,
                "authenticated": True,
                "connect_to": neighbors,
            }
        )
    )

    for neighbor_id in neighbors:
        neighbor = network.peers.get(neighbor_id)
        if neighbor:
            await neighbor.sendText(json.dumps({"type": "INCOMING_PEER", "peer_id": peer_id}))

    try:
        async for raw in ws.iter_text():
            msg = json.loads(raw)
            target_id = msg.get("to")

            if target_id and target_id in network.peers:
                await network.peers[target_id].sendText(raw)
    except WebSocketDisconnect:
        pass
    finally:
        departed_neighbors = network.remove(peer_id)
        for neighbor_id in departed_neighbors:
            neighbor = network.peers.get(neighbor_id)
            if neighbor:
                await neighbor.sendText(json.dumps({"type": "PEER_DISCONNECTED", "peer_id": peer_id}))


# ---------- Request models ----------
def validate_password(value: str) -> str:
    if len(value) < 8:
        raise ValueError("Password must be at least 8 characters")
    if not any(char.isupper() for char in value):
        raise ValueError("Password must contain at least one uppercase letter")
    if not any(char.isdigit() for char in value):
        raise ValueError("Password must contain at least one number")
    return value


class RegisterRequest(BaseModel):
    name: str
    email: EmailStr
    password: str

    @field_validator("password")
    @classmethod
    def password_strength(cls, value):
        return validate_password(value)

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, value):
        if not value.strip():
            raise ValueError("Name cannot be empty")
        return value.strip()


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class ResendRequest(BaseModel):
    email: EmailStr


class ResetRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def password_strength(cls, value):
        return validate_password(value)


# ---------- Auth dependency ----------
def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(bearer)) -> str:
    try:
        payload = decode_token(credentials.credentials, expected_type="session")
        return payload["sub"]
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc))


# ---------- Routes ----------
@app.post("/auth/register", status_code=201)
@limiter.limit("10/hour")
async def register(request: Request, body: RegisterRequest):
    try:
        return register_user(body.name, body.email, body.password)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/auth/login")
@limiter.limit("10/minute")
async def login(request: Request, body: LoginRequest):
    try:
        return login_user(body.email, body.password)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc))


@app.get("/auth/verify-email")
@limiter.limit("10/minute")
async def verify(request: Request, token: str):
    try:
        return verify_email(token)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/auth/resend-verification")
@limiter.limit("3/hour")
async def resend_verification(request: Request, body: ResendRequest):
    try:
        return resend_verification_email(body.email)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/auth/forgot-password")
@limiter.limit("5/hour")
async def forgot_password(request: Request, body: ResetRequest):
    return request_password_reset(body.email)


@app.post("/auth/reset-password")
@limiter.limit("5/hour")
async def reset(request: Request, body: ResetPasswordRequest):
    try:
        return reset_password(body.token, body.new_password)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/users/me")
async def me(user_id: str = Depends(get_current_user)):
    try:
        return get_user(user_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
