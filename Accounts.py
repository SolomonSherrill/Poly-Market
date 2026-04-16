from dotenv import load_dotenv
import os
import pymongo
from pymongo import MongoClient
import certifi
import jwt
import resend
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, VerificationError, InvalidHashError
from datetime import datetime, timedelta, timezone
from bson import ObjectId
from secrets import token_urlsafe

load_dotenv()

resend.api_key = os.getenv("RESEND_API_KEY")

ph = PasswordHasher(
    time_cost=3,
    memory_cost=65536,
    parallelism=2,
    hash_len=32,
    salt_len=16,
)

# ── DB ────────────────────────────────────────────────────────────────────────

_client = None
_db = None
_indexes_ready = False


def get_db():
    global _client, _db

    if _db is None:
        mongo_url = os.getenv("MONGO_URL") or "mongodb://localhost:27017"
        _client = MongoClient(
            mongo_url,
            tlsCAFile=certifi.where(),
            serverSelectionTimeoutMS=5000,
        )
        _db = _client["Poly-Market"]

    return _db


def ensure_indexes():
    global _indexes_ready

    if _indexes_ready:
        return

    get_db()["Users"].create_index("email", unique=True)
    _indexes_ready = True

# ── Password ──────────────────────────────────────────────────────────────────

def hash_password(plain: str):
    return ph.hash(plain)

def check_password(plain: str, hashed: str):
    try:
        return ph.verify(hashed, plain)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return {"success": False, "message": "Invalid email or password"}

# ── Tokens ────────────────────────────────────────────────────────────────────

def _get_secret():
    secret = os.getenv("JWT_SECRET")
    if not secret:
        raise ValueError("JWT_SECRET not set in environment")
    return secret

def generate_session_token(user_id: str):
    payload = {
        "sub": user_id,
        "type": "session",
        "iat": datetime.now(timezone.utc),
        "exp": datetime.now(timezone.utc) + timedelta(days=7),
    }
    return jwt.encode(payload, _get_secret(), algorithm="HS256")

def generate_verification_token(user_id: str):
    payload = {
        "sub": user_id,
        "type": "email_verification",
        "iat": datetime.now(timezone.utc),
        "exp": datetime.now(timezone.utc) + timedelta(hours=24),
    }
    return jwt.encode(payload, _get_secret(), algorithm="HS256")

def decode_token(token: str, expected_type: str):
    try:
        payload = jwt.decode(token, _get_secret(), algorithms=["HS256"])
        if payload.get("type") != expected_type:
            raise ValueError("Invalid token type")
        return payload
    except jwt.ExpiredSignatureError:
        raise ValueError("Token has expired")
    except jwt.InvalidTokenError:
        raise ValueError("Invalid token")

# ── Email ─────────────────────────────────────────────────────────────────────

def send_verification_email(email: str, name: str, user_id: str):
    token = generate_verification_token(user_id)
    base_url = os.getenv("APP_BASE_URL", "http://localhost:8000")
    verify_url = f"{base_url}/auth/verify-email?token={token}"

    resend.Emails.send({
        "from": "Poly-Market <onboarding@resend.dev>",  # swap for your domain later
        "to": email,
        "subject": "Verify your Poly-Market email",
        "html": f"""
            <p>Hi {name},</p>
            <p>Click the link below to verify your email. It expires in 24 hours.</p>
            <a href="{verify_url}">Verify your email</a>
            <p>If you didn't create an account, you can ignore this.</p>
        """,
    })

# ── User methods ──────────────────────────────────────────────────────────────

def register_user(name: str, email: str, password: str):
    if not name or not email or not password:
        raise ValueError("Name, email, and password are required")
    if len(password) < 8:
        raise ValueError("Password must be at least 8 characters")

    db = get_db()
    ensure_indexes()

    try:
        result = db["Users"].insert_one({
            "name": name,
            "email": email.lower().strip(),
            "password_hash": hash_password(password),
            "email_verified": False,
            "balance": 0.0,
            "total_wins": 0,
            "total_losses": 0,
            "net_profit": 0.0,
            "created_at": datetime.now(timezone.utc),
        })
    except pymongo.errors.DuplicateKeyError:
        raise ValueError(f"An account with email '{email}' already exists")

    user_id = str(result.inserted_id)
    send_verification_email(email, name, user_id)

    return {"id": user_id, "message": "Account created. Check your email to verify."}

def verify_email(token: str):
    db = get_db()
    payload = decode_token(token, expected_type="email_verification")
    user_id = payload["sub"]

    result = db["Users"].update_one(
        {"_id": ObjectId(user_id), "email_verified": False},
        {"$set": {"email_verified": True, "verified_at": datetime.now(timezone.utc)}}
    )

    if result.matched_count == 0:
        raise ValueError("Already verified or user not found")

    return {"message": "Email verified successfully"}

def login_user(email: str, password: str):
    db = get_db()
    user = db["Users"].find_one({"email": email.lower().strip()})

    if not user or not check_password(password, user["password_hash"]):
        raise ValueError("Invalid email or password")

    if not user.get("email_verified"):
        raise ValueError("Please verify your email before logging in")

    user_id = str(user["_id"])
    return {
        "id": user_id,
        "name": user["name"],
        "token": generate_session_token(user_id),
    }

def get_user(user_id: str):
    db = get_db()
    user = db["Users"].find_one({"_id": ObjectId(user_id)})
    if not user:
        raise ValueError("User not found")
    return {
        "id": str(user["_id"]),
        "name": user["name"],
        "email": user["email"],
        "email_verified": user["email_verified"],
        "balance": user["balance"],
        "created_at": user["created_at"],
    }

def resend_verification_email(email: str):
    """For users who never clicked the link."""
    db = get_db()
    user = db["Users"].find_one({"email": email.lower().strip()})
    if not user:
        # Don't reveal whether the email exists
        return {"message": "If that email is registered, a verification link has been sent."}
    if user.get("email_verified"):
        raise ValueError("Email is already verified")

    send_verification_email(email, user["name"], str(user["_id"]))
    return {"message": "If that email is registered, a verification link has been sent."}

# ── Password Reset ────────────────────────────────────────────────────────────

def generate_reset_token(user_id: str):
    payload = {
        "sub": user_id,
        "type": "password_reset",
        "iat": datetime.now(timezone.utc),
        "exp": datetime.now(timezone.utc) + timedelta(hours=1),
    }
    return jwt.encode(payload, _get_secret(), algorithm="HS256")

def send_reset_email(email: str, name: str, user_id: str):
    token = generate_reset_token(user_id)
    base_url = os.getenv("APP_BASE_URL", "http://localhost:8000")
    reset_url = f"{base_url}/auth/reset-password?token={token}"

    resend.Emails.send({
        "from": "Poly-Market <onboarding@resend.dev>",
        "to": email,
        "subject": "Reset your Poly-Market password",
        "html": f"""
            <p>Hi {name},</p>
            <p>Click the link below to reset your password. It expires in 1 hour.</p>
            <a href="{reset_url}">Reset Password</a>
            <p>If you didn't request this, you can ignore this email.</p>
        """,
    })

def request_password_reset(email: str):
    db = get_db()
    user = db["Users"].find_one({"email": email.lower().strip()})
    # Always return the same message — don't reveal whether email exists
    if user:
        send_reset_email(email, user["name"], str(user["_id"]))
    return {"message": "If that email is registered, a password reset link has been sent."}

def reset_password(token: str, new_password: str):
    if len(new_password) < 8:
        raise ValueError("Password must be at least 8 characters")

    db = get_db()
    payload = decode_token(token, expected_type="password_reset")
    user_id = payload["sub"]

    try:
        result = db["Users"].update_one(
            {"_id": ObjectId(user_id)},
            {"$set": {
                "password_hash": hash_password(new_password),
                "password_reset_at": datetime.now(timezone.utc),
            }}
        )
    except Exception:
        raise ValueError("Invalid user")

    if result.matched_count == 0:
        raise ValueError("User not found")

    return {"message": "Password reset successfully. Please log in again."}
