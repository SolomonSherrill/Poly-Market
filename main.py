from fastapi import FastAPI, HTTPException, Depends, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, EmailStr, field_validator
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from datetime import datetime, timedelta, timezone
from Accounts import (
    register_user, login_user, verify_email, get_user,
    resend_verification_email, decode_token,
    request_password_reset, reset_password,
)
from Prediction import (
    create_prediction, get_prediction, back_prediction, get_all_predictions,
)

# ── App setup ─────────────────────────────────────────────────────────────────

def get_real_ip(request: Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host

limiter = Limiter(key_func=get_real_ip)
app = FastAPI(title="Poly-Market API")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=["*"])

bearer = HTTPBearer()

# ── Auth Request models ────────────────────────────────────────────────────────────

def validate_password(v: str) -> str:
    if len(v) < 8:
        raise ValueError("Password must be at least 8 characters")
    if not any(c.isupper() for c in v):
        raise ValueError("Password must contain at least one uppercase letter")
    if not any(c.isdigit() for c in v):
        raise ValueError("Password must contain at least one number")
    return v

class RegisterRequest(BaseModel):
    name: str
    email: EmailStr
    password: str

    @field_validator("password")
    @classmethod
    def password_strength(cls, v):
        return validate_password(v)

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v):
        if not v.strip():
            raise ValueError("Name cannot be empty")
        return v.strip()

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
    def password_strength(cls, v):
        return validate_password(v)
    
# ── Prediction Related models ────────────────────────────────────────────────────────────

class CreatePredictionRequest(BaseModel):
    bet_string: str
    is_high_low: bool = False
    is_yes_no: bool = False
    end_time: datetime

class BackPredictionRequest(BaseModel):
    prediction_id: str
    amount: float
    is_yes: bool

# ── Auth dependency ───────────────────────────────────────────────────────────

def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(bearer)) -> str:
    try:
        payload = decode_token(credentials.credentials, expected_type="session")
        return payload["sub"]
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e))

# ── Auth Routes ────────────────────────────────────────────────────────────────────

@app.post("/auth/register", status_code=201)
@limiter.limit("10/hour")
async def register(request: Request, body: RegisterRequest):
    try:
        return register_user(body.name, body.email, body.password)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/auth/login")
@limiter.limit("10/minute")
async def login(request: Request, body: LoginRequest):
    try:
        return login_user(body.email, body.password)
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e))

@app.get("/auth/verify-email")
@limiter.limit("10/minute")
async def verify(request: Request, token: str):
    try:
        return verify_email(token)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/auth/resend-verification")
@limiter.limit("3/hour")
async def resend_verification(request: Request, body: ResendRequest):
    try:
        return resend_verification_email(body.email)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/auth/forgot-password")
@limiter.limit("5/hour")
async def forgot_password(request: Request, body: ResetRequest):
    return request_password_reset(body.email)

@app.post("/auth/reset-password")
@limiter.limit("5/hour")
async def reset(request: Request, body: ResetPasswordRequest):
    try:
        return reset_password(body.token, body.new_password)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/users/me")
async def me(user_id: str = Depends(get_current_user)):
    try:
        return get_user(user_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    
# ── Prediction Routes ────────────────────────────────────────────────────────────────────
@app.post("/predictions/post-prediction")
async def post_prediction(request: Request, body: CreatePredictionRequest, user_id: str = Depends(get_current_user)):
    try:
        return create_prediction(user_id, body.bet_string, body.is_high_low, body.is_yes_no, body.end_time)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
@app.post("/predictions/back-prediction")
async def back_prediction_route(request: Request, body: BackPredictionRequest, user_id: str = Depends(get_current_user)):
    try:
        return back_prediction(body.prediction_id, user_id, body.amount, body.is_yes)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
@app.get("/predictions/get-all-predictions")
async def get_all_predictions_route(user_id: str = Depends(get_current_user)):
    try:
        return get_all_predictions()
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
@app.get("/predictions/{prediction_id}")
async def get_prediction_route(prediction_id: str, user_id: str = Depends(get_current_user)):
    try:
        return get_prediction(prediction_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))