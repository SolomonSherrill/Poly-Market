import asyncio
import json
import logging
import random
import uuid
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path

import numpy as np
from fastapi import Depends, FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from Accounts import get_local_user_id_from_token, get_user
from Prediction import back_prediction, create_prediction, get_all_predictions, get_prediction

logger = logging.getLogger(__name__)
BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"

FANOUT = 10
RESERVED = 6
FIEDLER_THRESHOLD = 0.85


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
app = FastAPI(title="Poly-Market API (Auth0 Copy)", lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

bearer = HTTPBearer()


@app.get("/", include_in_schema=False)
async def index():
    return FileResponse(STATIC_DIR / "index.html")


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


@app.websocket("/connect")
async def connect(ws: WebSocket, token: str = Query(...)):
    try:
        user_id = get_local_user_id_from_token(token)
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


class CreatePredictionRequest(BaseModel):
    bet_string: str
    is_high_low: bool = False
    is_yes_no: bool = False
    end_time: datetime


class BackPredictionRequest(BaseModel):
    prediction_id: str
    amount: float
    is_yes: bool


def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(bearer)) -> str:
    try:
        return get_local_user_id_from_token(credentials.credentials)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc))


@app.get("/auth/reset-password")
async def reset_password_page(token: str):
    return RedirectResponse(url=f"/?mode=reset&token={token}", status_code=303)


@app.get("/users/me")
async def me(user_id: str = Depends(get_current_user)):
    try:
        return get_user(user_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.post("/predictions/post-prediction")
async def post_prediction(
    request: Request,
    body: CreatePredictionRequest,
    user_id: str = Depends(get_current_user),
):
    try:
        return create_prediction(user_id, body.bet_string, body.is_high_low, body.is_yes_no, body.end_time)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/predictions/back-prediction")
async def back_prediction_route(
    request: Request,
    body: BackPredictionRequest,
    user_id: str = Depends(get_current_user),
):
    try:
        return back_prediction(body.prediction_id, user_id, body.amount, body.is_yes)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/predictions/get-all-predictions")
async def get_all_predictions_route(user_id: str = Depends(get_current_user)):
    try:
        return get_all_predictions()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/predictions/{prediction_id}")
async def get_prediction_route(prediction_id: str, user_id: str = Depends(get_current_user)):
    try:
        return get_prediction(prediction_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
