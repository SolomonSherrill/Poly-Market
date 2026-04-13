from fastapi import FastAPI, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, EmailStr
from Accounts import (
    register_user, login_user, verify_email,
    get_user, resend_verification_email, decode_token
)

app = FastAPI(title="Poly-Market API")
bearer = HTTPBearer()

# ── Request models ────────────────────────────────────────────────────────────

class RegisterRequest(BaseModel):
    name: str
    email: EmailStr
    password: str

class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class ResendRequest(BaseModel):
    email: EmailStr

# ── Auth dependency ───────────────────────────────────────────────────────────

def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(bearer)) -> str:
    try:
        payload = decode_token(credentials.credentials, expected_type="session")
        return payload["sub"]  # user_id
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e))

# ── Routes ────────────────────────────────────────────────────────────────────

@app.post("/auth/register", status_code=201)
async def register(body: RegisterRequest):
    try:
        return register_user(body.name, body.email, body.password)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/auth/login")
async def login(body: LoginRequest):
    try:
        return login_user(body.email, body.password)
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e))

@app.get("/auth/verify-email")
async def verify(token: str):
    try:
        return verify_email(token)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/auth/resend-verification")
async def resend_verification(body: ResendRequest):
    try:
        return resend_verification_email(body.email)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/users/me")
async def me(user_id: str = Depends(get_current_user)):
    try:
        return get_user(user_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))