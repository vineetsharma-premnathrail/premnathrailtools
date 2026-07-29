"""
API Key authentication — lets external systems call the API using a
Bearer token or X-API-Key header instead of a Microsoft-login JWT.

Key format:  pew_<43 random chars>   e.g. pew_a1b2c3d4...
Storage:     HMAC-SHA256(key, server pepper) stored in DB — raw key never saved.
             Keys are 256-bit random, so HMAC with a server-side secret defeats
             precomputed/rainbow attacks while keeping an O(1) indexed lookup
             (bcrypt/argon2 can't be looked up by hash, so they don't fit API keys).
Usage:
    Authorization: Bearer pew_xxxx
    OR
    X-API-Key: pew_xxxx
"""
import hashlib
import hmac
import secrets
from datetime import datetime, timezone
from fastapi import Request
from sqlalchemy.orm import Session

from app.core.config import settings

API_KEY_PREFIX = "pew_"


def hash_api_key(raw: str) -> str:
    """Keyed hash of an API key using the server's SECRET_KEY as a pepper."""
    return hmac.new(settings.SECRET_KEY.encode(), raw.encode(), hashlib.sha256).hexdigest()


def generate_api_key() -> tuple[str, str]:
    """Returns (raw_key, keyed_hash). Store only the hash; show the raw key once."""
    raw = API_KEY_PREFIX + secrets.token_urlsafe(32)
    return raw, hash_api_key(raw)


def get_api_key_record(request: Request, db: Session):
    """Extract and validate an API key from the request. Returns the APIKey row
    if valid, None otherwise. Does NOT raise — caller decides what to do."""
    from app.modules.main.models.api_key import APIKey

    raw_key = request.headers.get("X-API-Key")
    if not raw_key:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer pew_"):
            raw_key = auth.split(" ", 1)[1]

    if not raw_key or not raw_key.startswith(API_KEY_PREFIX):
        return None

    key_hash = hash_api_key(raw_key)
    api_key = db.query(APIKey).filter(APIKey.key_hash == key_hash, APIKey.is_active == True).first()  # noqa: E712
    if not api_key:
        return None

    # Update last_used_at so the audit trail reflects real usage.
    api_key.last_used_at = datetime.now(timezone.utc)
    try:
        db.commit()
    except Exception:
        db.rollback()

    return api_key
