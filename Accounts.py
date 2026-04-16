from datetime import datetime, timezone
import os

import certifi
import jwt
from bson import ObjectId
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv()

_client = MongoClient(os.getenv("MONGO_URL"), tlsCAFile=certifi.where())
db = _client["Poly-Market"]
db["Users"].create_index("email", unique=True, sparse=True)
db["Users"].create_index("auth_provider_user_id", unique=True, sparse=True)

_jwks_client = None


def _get_auth0_domain() -> str:
    domain = os.getenv("AUTH0_DOMAIN", "").strip()
    if not domain:
        raise ValueError("AUTH0_DOMAIN not set in environment")
    return domain.removeprefix("https://").rstrip("/")


def _get_auth0_audience() -> str:
    audience = os.getenv("AUTH0_AUDIENCE", "").strip()
    if not audience:
        raise ValueError("AUTH0_AUDIENCE not set in environment")
    return audience


def _get_jwks_client() -> jwt.PyJWKClient:
    global _jwks_client
    if _jwks_client is None:
        domain = _get_auth0_domain()
        _jwks_client = jwt.PyJWKClient(f"https://{domain}/.well-known/jwks.json")
    return _jwks_client


def verify_auth0_token(token: str) -> dict:
    domain = _get_auth0_domain()
    audience = _get_auth0_audience()

    try:
        signing_key = _get_jwks_client().get_signing_key_from_jwt(token)
        return jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            audience=audience,
            issuer=f"https://{domain}/",
        )
    except jwt.ExpiredSignatureError:
        raise ValueError("Token has expired")
    except jwt.InvalidTokenError as exc:
        raise ValueError(f"Invalid token: {exc}")


def _build_new_user_document(claims: dict) -> dict:
    document = {
        "auth_provider": "auth0",
        "auth_provider_user_id": claims["sub"],
        "balance": 0.0,
        "total_wins": 0,
        "total_losses": 0,
        "net_profit": 0.0,
        "created_at": datetime.now(timezone.utc),
        "last_login_at": datetime.now(timezone.utc),
    }

    if claims.get("email"):
        document["email"] = claims["email"].lower().strip()
    if claims.get("name"):
        document["name"] = claims["name"]
    if "email_verified" in claims:
        document["email_verified"] = bool(claims["email_verified"])
    if claims.get("picture"):
        document["picture"] = claims["picture"]

    return document


def get_or_create_user_from_claims(claims: dict) -> dict:
    auth_provider_user_id = claims.get("sub")
    if not auth_provider_user_id:
        raise ValueError("Token missing sub claim")

    user = db["Users"].find_one({"auth_provider_user_id": auth_provider_user_id})
    if user:
        updates = {
            "last_login_at": datetime.now(timezone.utc),
        }

        if claims.get("email"):
            updates["email"] = claims["email"].lower().strip()
        if claims.get("name"):
            updates["name"] = claims["name"]
        if "email_verified" in claims:
            updates["email_verified"] = bool(claims["email_verified"])
        if claims.get("picture"):
            updates["picture"] = claims["picture"]

        db["Users"].update_one({"_id": user["_id"]}, {"$set": updates})
        user.update(updates)
        return user

    email = (claims.get("email") or "").lower().strip()
    if email:
        existing_user = db["Users"].find_one({"email": email})
        if existing_user:
            updates = {
                "auth_provider": "auth0",
                "auth_provider_user_id": auth_provider_user_id,
                "email_verified": bool(claims.get("email_verified")),
                "last_login_at": datetime.now(timezone.utc),
            }
            if claims.get("name"):
                updates["name"] = claims["name"]
            if claims.get("picture"):
                updates["picture"] = claims["picture"]

            db["Users"].update_one({"_id": existing_user["_id"]}, {"$set": updates})
            existing_user.update(updates)
            return existing_user

    result = db["Users"].insert_one(_build_new_user_document(claims))
    user = db["Users"].find_one({"_id": result.inserted_id})
    if not user:
        raise ValueError("Failed to create user")
    return user


def get_local_user_id_from_token(token: str) -> str:
    claims = verify_auth0_token(token)
    user = get_or_create_user_from_claims(claims)
    return str(user["_id"])


def get_user(user_id: str) -> dict:
    try:
        user = db["Users"].find_one({"_id": ObjectId(user_id)})
    except Exception:
        raise ValueError("Invalid user id")

    if not user:
        raise ValueError("User not found")

    return {
        "id": str(user["_id"]),
        "name": user.get("name"),
        "email": user.get("email"),
        "email_verified": user.get("email_verified", False),
        "picture": user.get("picture"),
        "balance": user["balance"],
        "created_at": user["created_at"],
        "auth_provider": user.get("auth_provider"),
        "auth_provider_user_id": user.get("auth_provider_user_id"),
    }
