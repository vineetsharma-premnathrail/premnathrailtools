"""Tamper-proof record references for page URLs.

The portal's page URLs carry a signed reference instead of the record id
(/dashboard/crm/organizations?id=Xk3v9QpL0aB7cD2eF1g), so editing the URL
yields "invalid link" instead of the next record. The reference hides the id
(XOR with a key-derived mask) and carries an HMAC tag over it; neither can be
produced without SECRET_KEY. References are not tied to a user, so links still
work when shared in Teams or email — what a user may open is still decided by
permissions and data scope (core/data_scope.py) on every API call.

    encode_ref(124)   -> "Xk3v9QpL0aB7cD2eF1g"
    decode_ref(ref)   -> 124, or None when the reference was altered

API responses carry the reference next to every id when the frontend asks
(header X-Record-Refs: 1, see RecordRefMiddleware): {"id": 124, "id_ref": "…",
"org_id": 7, "org_id_ref": "…"}. The frontend turns a reference back into an
id with GET /api/v1/refs/{ref}.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import re
from functools import lru_cache

_ID_BYTES = 6  # ids up to 2^48
_TAG_BYTES = 8
REF_RE = re.compile(r"^[A-Za-z0-9_-]{19}$")


@lru_cache(maxsize=1)
def _key(secret: str) -> bytes:
    return hmac.new(secret.encode(), b"record-ref/v1", hashlib.sha256).digest()


def _secret_key() -> bytes:
    from app.core.config import settings

    return _key(settings.SECRET_KEY)


def _tag(key: bytes, record_id: int) -> bytes:
    return hmac.new(key, b"id:" + str(record_id).encode(), hashlib.sha256).digest()[:_TAG_BYTES]


def _mask(key: bytes, tag: bytes) -> int:
    return int.from_bytes(hmac.new(key, b"mask:" + tag, hashlib.sha256).digest()[:_ID_BYTES], "big")


def encode_ref(record_id: int) -> str:
    return _encode(_secret_key(), record_id)


@lru_cache(maxsize=200_000)
def _encode(key: bytes, record_id: int) -> str:
    tag = _tag(key, record_id)
    hidden = (record_id ^ _mask(key, tag)).to_bytes(_ID_BYTES, "big")
    return base64.urlsafe_b64encode(hidden + tag).decode().rstrip("=")


def decode_ref(ref: str) -> int | None:
    if not isinstance(ref, str) or not REF_RE.match(ref):
        return None
    try:
        raw = base64.urlsafe_b64decode(ref + "=")
    except (ValueError, TypeError):
        return None
    if len(raw) != _ID_BYTES + _TAG_BYTES:
        return None
    key = _secret_key()
    hidden, tag = raw[:_ID_BYTES], raw[_ID_BYTES:]
    record_id = int.from_bytes(hidden, "big") ^ _mask(key, tag)
    if not hmac.compare_digest(_tag(key, record_id), tag):
        return None
    # Only the canonical spelling is valid (base64's spare low bits in the last
    # character would otherwise let a few edited links through).
    return record_id if _encode(key, record_id) == ref else None


def add_refs(data):
    """Walk decoded JSON and put `<key>_ref` beside every integer `id` /
    `*_id` field (not bools, not lists of ids)."""
    if isinstance(data, list):
        for item in data:
            add_refs(item)
    elif isinstance(data, dict):
        extra = {}
        for k, v in data.items():
            if isinstance(v, (dict, list)):
                add_refs(v)
            elif (k == "id" or k.endswith("_id")) and isinstance(v, int) and not isinstance(v, bool) and v > 0:
                extra[f"{k}_ref"] = encode_ref(v)
        for k, v in extra.items():
            data.setdefault(k, v)
    return data
