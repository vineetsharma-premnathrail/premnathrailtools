"""CSRF protection: Origin / Referer check on cookie-authenticated unsafe requests.

Auth cookies are SameSite=None when SECURE_COOKIES is on (needed for the Teams
iframe), so the browser attaches them to cross-site requests. CORS only hides
the response from the attacker — it doesn't stop a cross-site <form> POST from
reaching the handler. This middleware rejects POST/PUT/PATCH/DELETE requests on
/api/ paths that carry an auth cookie when their Origin (or, failing that, the
scheme://host of Referer) isn't an allowed portal origin.

Requests without an auth cookie (Bearer-only API clients, unauthenticated
calls) are not affected; neither are requests with no Origin/Referer at all
(non-browser clients — a browser always sends Origin on a cross-site POST).
"""
from __future__ import annotations

import json
from urllib.parse import urlsplit

from app.core.config import settings

UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
AUTH_COOKIES = ("session_token=", "refresh_token=")
EXEMPT_PATHS = {"/api/v1/auth/callback"}


def _origin_of(url: str) -> str | None:
    try:
        parts = urlsplit(url)
    except ValueError:
        return None
    if not parts.scheme or not parts.netloc:
        return None
    return f"{parts.scheme}://{parts.netloc}".lower()


class CSRFOriginMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope.get("method", "").upper() not in UNSAFE_METHODS:
            await self.app(scope, receive, send)
            return
        path = scope.get("path", "")
        if not path.startswith("/api/") or path in EXEMPT_PATHS:
            await self.app(scope, receive, send)
            return

        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers", [])}
        cookie = headers.get("cookie", "")
        if not any(c in cookie for c in AUTH_COOKIES):
            await self.app(scope, receive, send)
            return

        origin_header = headers.get("origin", "").strip()
        source = None
        if origin_header and origin_header.lower() != "null":
            source = _origin_of(origin_header)
        elif origin_header.lower() == "null":
            source = "null"
        else:
            referer = headers.get("referer", "").strip()
            if referer:
                source = _origin_of(referer)
        if source is None:
            # No Origin/Referer → not a browser cross-site form; let it through.
            await self.app(scope, receive, send)
            return

        allowed = {o.rstrip("/").lower() for o in settings.allowed_origins_list}
        # The API's own host (Swagger /docs, same-origin deployments behind a
        # proxy). Compare host only so an http↔https proxy hop doesn't matter.
        # In production the Next.js /api rewrite proxies to 127.0.0.1:8000 and
        # passes the browser's Host as X-Forwarded-Host (possibly a list).
        forwarded = [h.strip() for h in headers.get("x-forwarded-host", "").split(",")]
        own_hosts = {h.lower() for h in [headers.get("host", ""), *forwarded] if h}
        source_host = urlsplit(source).netloc.lower() if source != "null" else ""
        if source in allowed or (source_host and source_host in own_hosts):
            await self.app(scope, receive, send)
            return

        shown = origin_header or headers.get("referer", "")
        body = json.dumps({
            "detail": (
                f"Request blocked: it came from {shown or source}, which is not an allowed portal "
                "origin. If this is a legitimate portal URL, add it to ALLOWED_ORIGINS on the server."
            )
        }).encode()
        await send({
            "type": "http.response.start",
            "status": 403,
            "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())],
        })
        await send({"type": "http.response.body", "body": body})
