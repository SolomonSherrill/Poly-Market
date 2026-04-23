from datetime import datetime, timezone
from importlib import metadata
import json
import os
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import certifi
import jwt
from bson import ObjectId
from dotenv import load_dotenv
from pymongo import MongoClient
from pymongo.errors import DuplicateKeyError, PyMongoError

load_dotenv()

_client = None
db = None
_indexes_ready = False

_jwks_client = None


class ConfigurationError(Exception):
    pass


class ServiceUnavailableError(Exception):
    pass


def _get_env(*names: str) -> str:
    for name in names:
        value = os.getenv(name, "").strip()
        if value:
            return value
    return ""


def _get_mongo_client(mongo_url: str) -> MongoClient:
    client_options = {"serverSelectionTimeoutMS": 5000}
    if mongo_url.startswith("mongodb+srv://"):
        client_options["tlsCAFile"] = certifi.where()
    return MongoClient(mongo_url, **client_options)


def _get_installed_version(package_name: str) -> str:
    try:
        return metadata.version(package_name)
    except metadata.PackageNotFoundError:
        return "not-installed"


def _ensure_rs256_support():
    jwt_version = _get_installed_version("PyJWT")
    crypto_version = _get_installed_version("cryptography")

    try:
        from jwt.algorithms import has_crypto
    except Exception as exc:
        raise ServiceUnavailableError(
            f"PyJWT import is incomplete (PyJWT={jwt_version}, cryptography={crypto_version}): {exc}"
        ) from exc

    if has_crypto:
        return

    try:
        import cryptography  # noqa: F401
    except Exception as exc:
        raise ServiceUnavailableError(
            f"RS256 crypto backend unavailable (PyJWT={jwt_version}, cryptography={crypto_version}): {exc}"
        ) from exc

    raise ServiceUnavailableError(
        f"RS256 crypto backend unavailable even though cryptography is importable (PyJWT={jwt_version}, cryptography={crypto_version})."
    )


def get_db():
    global _client, db, _indexes_ready

    if db is None:
        mongo_url = _get_env("MONGO_URL", "MONGODB_URI", "MONGO_URI", "DATABASE_URL")
        if not mongo_url:
            raise ConfigurationError(
                "Mongo connection string is not set. Expected one of MONGO_URL, MONGODB_URI, MONGO_URI, or DATABASE_URL."
            )

        try:
            _client = _get_mongo_client(mongo_url)
            _client.admin.command("ping")
            db = _client["Poly-Market"]
        except PyMongoError as exc:
            raise ServiceUnavailableError(f"MongoDB connection failed: {exc}") from exc

    if not _indexes_ready:
        try:
            db["Users"].create_index("email", unique=True, sparse=True)
            db["Users"].create_index("auth_provider_user_id", unique=True, sparse=True)
            _indexes_ready = True
        except PyMongoError as exc:
            raise ServiceUnavailableError(f"Failed to initialize MongoDB indexes: {exc}") from exc

    return db


def _get_auth0_domain() -> str:
    domain = _get_env("AUTH0_DOMAIN")
    if not domain:
        raise ConfigurationError("AUTH0_DOMAIN not set in environment")
    return domain.removeprefix("https://").rstrip("/")


def _get_auth0_audience() -> str:
    audience = _get_env("AUTH0_AUDIENCE")
    if not audience:
        raise ConfigurationError("AUTH0_AUDIENCE not set in environment")
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
    _ensure_rs256_support()

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
    except ConfigurationError:
        raise
    except Exception as exc:
        raise ServiceUnavailableError(f"Auth0 token verification failed: {exc}") from exc


def fetch_auth0_userinfo(token: str) -> dict:
    domain = _get_auth0_domain()
    request = Request(
        f"https://{domain}/userinfo",
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
        },
    )

    try:
        with urlopen(request, timeout=5) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        raise ServiceUnavailableError(f"Auth0 /userinfo request failed with status {exc.code}") from exc
    except (URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise ServiceUnavailableError(f"Auth0 /userinfo request failed: {exc}") from exc


def _merge_auth0_profile(claims: dict, profile: dict | None) -> dict:
    merged = dict(claims)
    if not profile:
        return merged

    for field in ("sub", "email", "email_verified", "name", "picture", "given_name", "family_name", "nickname"):
        if profile.get(field) is not None:
            merged[field] = profile[field]

    return merged


def _build_new_user_document(claims: dict) -> dict:
    document = {
        "auth_provider": "auth0",
        "auth_provider_user_id": claims["sub"],
        "balance": 100.0,
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
    db = get_db()
    auth_provider_user_id = claims.get("sub")
    if not auth_provider_user_id:
        raise ValueError("Token missing sub claim")

    try:
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
            user["was_just_created"] = False
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
                existing_user["was_just_created"] = False
                return existing_user

        try:
            result = db["Users"].insert_one(_build_new_user_document(claims))
            user = db["Users"].find_one({"_id": result.inserted_id})
            if not user:
                raise ValueError("Failed to create user")
            user["was_just_created"] = True
            return user
        except DuplicateKeyError:
            user = db["Users"].find_one({"auth_provider_user_id": auth_provider_user_id})
            if not user and claims.get("email"):
                user = db["Users"].find_one({"email": claims["email"].lower().strip()})
            if not user:
                raise ValueError("User creation raced with another request, but no user record was found")
            user["was_just_created"] = False
            return user
    except PyMongoError as exc:
        raise ServiceUnavailableError(f"MongoDB user operation failed: {exc}") from exc


def get_local_user_context_from_token(token: str) -> dict:
    claims = verify_auth0_token(token)
    profile = fetch_auth0_userinfo(token)
    merged_claims = _merge_auth0_profile(claims, profile)
    user = get_or_create_user_from_claims(merged_claims)
    return {
        "user_id": str(user["_id"]),
        "was_just_created": bool(user.get("was_just_created", False)),
    }


def get_local_user_id_from_token(token: str) -> str:
    return get_local_user_context_from_token(token)["user_id"]


def get_user(user_id: str) -> dict:
    db = get_db()
    try:
        object_id = ObjectId(user_id)
    except Exception:
        raise ValueError("Invalid user id")

    try:
        user = db["Users"].find_one({"_id": object_id})
    except PyMongoError as exc:
        raise ServiceUnavailableError(f"MongoDB user lookup failed: {exc}") from exc

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
        "was_just_created": bool(user.get("was_just_created", False)),
    }
