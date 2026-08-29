from datetime import datetime, timedelta
from jose import JWTError, jwt
from app.core.config import settings


def create_access_token(data: dict) -> str:
    """Create a JWT access token."""
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm="HS256")
    return encoded_jwt


def verify_access_token(token: str) -> dict | None:
    """Verify and decode a JWT access token. Returns payload on success, None on failure."""
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=["HS256"])
        return payload
    except JWTError:
        return None


def create_document_share_token(doc_type: str, doc_id: int, expires_hours: int = 168) -> str:
    """Signs a link to one specific document that needs no portal login and no
    SharePoint access of its own — used for documents emailed to recipients
    who may have neither (e.g. external vendors on a Technical Offer
    Request). The token only ever proves "the holder was handed a link to
    this exact document before it expired"; it grants nothing else."""
    expire = datetime.utcnow() + timedelta(hours=expires_hours)
    return jwt.encode({"purpose": "doc_share", "doc_type": doc_type, "doc_id": doc_id, "exp": expire}, settings.SECRET_KEY, algorithm="HS256")


def verify_document_share_token(token: str, doc_type: str, doc_id: int) -> bool:
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=["HS256"])
    except JWTError:
        return False
    return payload.get("purpose") == "doc_share" and payload.get("doc_type") == doc_type and payload.get("doc_id") == doc_id
