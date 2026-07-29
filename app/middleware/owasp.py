"""
OWASP Top 10 (2021) Middleware — Premnathrail Portal (Ideal rebuild)
=====================================================================
Ported from the legacy app's app/middleware/owasp.py, adapted to Ideal's
Bearer-token/API-key auth model (no session cookie yet — Ideal's frontend is a
separate Next.js app, not server-rendered pages, so there's no PROTECTED_PAGE_PATHS
redirect-to-login concept here either).

A01 - Broken Access Control        → auth pre-check on all /api/ routes + path-scan detection
A02 - Cryptographic Failures       → HSTS
A03 - Injection                    → SQLi / XSS / path traversal / template injection / cmd injection
A04 - Insecure Design              → body size limit, HTTP method allowlist, slow request alerting
A05 - Security Misconfiguration    → strict security headers, CSP, cache-control, hide server info
A06 - Outdated Components          → documented; enforced via pip-audit in CI (not middleware)
A07 - Auth & Session Failures      → per-IP rate limiting per bucket + temporary IP ban on abuse
A08 - Data Integrity Failures      → Content-Type allowlist on mutating requests
A09 - Logging & Monitoring         → Request-ID tracing, structured security events, slow request alerts
A10 - SSRF                         → block private IP ranges in query params and URL-valued headers
"""

import re
import time
import uuid
import logging
import ipaddress
from urllib.parse import urlparse, unquote
from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from app.core.config import settings
from .rate_store import build_rate_store

logger = logging.getLogger("owasp")

# Redis or in-memory rate store (auto-selected at startup)
_store = build_rate_store()


def get_rate_store():
    """Test-only accessor so tests can reset state between runs."""
    return _store


# ─────────────────────────────────────────────────────────────────────────────
# A07 — Rate limit buckets (requests / window_seconds)
# ─────────────────────────────────────────────────────────────────────────────
RATE_CONFIG = {
    "auth":    {"limit": 5,   "window": 60},   # login / OAuth — max 5 attempts/min
    "delete":  {"limit": 10,  "window": 60},   # DELETE — max 10 deletes/min per IP
    "write":   {"limit": 40,  "window": 60},   # POST / PATCH
    "default": {"limit": 200, "window": 60},   # everything else (GET)
}

# Bulk delete protection — block query params that look like ID lists
BULK_ID_PATTERN = re.compile(r"(?:ids|id_list|delete_ids)\s*=|[\[\{].*\d+.*,.*\d+.*[\]\}]", re.IGNORECASE)

# A07 — Temporary IP ban: block IP for BAN_DURATION_SECONDS after BAN_THRESHOLD violations
BAN_THRESHOLD = 10
BAN_DURATION_SECONDS = 600  # 10-minute ban window

# A04 — Max body sizes
MAX_BODY_BYTES = 10 * 1024 * 1024 * 1024   # 10 GB (file uploads)
MAX_JSON_BYTES = 512 * 1024                 # 512 KB (JSON payloads)

# A04 — Allowed HTTP methods
ALLOWED_METHODS = {"GET", "POST", "PATCH", "DELETE", "PUT", "OPTIONS", "HEAD"}

# A09 — Slow request threshold
SLOW_REQUEST_MS = 5000

# ─────────────────────────────────────────────────────────────────────────────
# A03 — Injection detection patterns (URL/header check, no body read needed)
# ─────────────────────────────────────────────────────────────────────────────
INJECTION_PATTERNS = re.compile(
    r"(\.\./|%2e%2e%2f|%252e%252e|\.\.\\|%2e%2e\\|"
    r"<script[\s>]|</script|javascript:|vbscript:|data:text/html|"
    r"\bon(?:click|load|error|unload|change|submit|reset|select|"
    r"blur|focus|key\w+|mouse\w+|drag\w+|contextmenu|dblclick|"
    r"copy|paste|cut|input|pointer\w+|touch\w+)\s*=|"
    r"union\s+(?:all\s+)?select|drop\s+table|drop\s+database|"
    r"insert\s+into|delete\s+from|update\s+\w+\s+set\s|"
    r"exec\s*\(|execute\s*\(|xp_cmdshell|sp_executesql|"
    r"alter\s+table|create\s+table|truncate\s+table|"
    r"information_schema|pg_sleep|pg_tables|sys\.tables|"
    r";\s*(?:rm|del|wget|curl|bash|sh|cmd|powershell)\s|"
    r"\{\{.*?\}\}|\$\{.*?\}|<%=.*?%>|"
    r"\$(?:where|gt|lt|ne|in|nin|regex|exists|type)\b|"
    r"(?:sleep|benchmark|waitfor\s+delay)\s*\(|"
    r"0x[0-9a-f]{4,}|char\s*\(\s*\d|"
    r"load_file\s*\(|into\s+outfile\s|into\s+dumpfile\s)",
    re.IGNORECASE,
)

# Body-level SQLi patterns (checked on POST/PATCH JSON bodies)
SQLI_BODY_PATTERNS = re.compile(
    r"union\s+(?:all\s+)?select|drop\s+(?:table|database|schema)|"
    r"insert\s+into\s+\w|delete\s+from\s+\w|truncate\s+table|"
    r"alter\s+table|create\s+(?:table|user|database)|"
    r"exec(?:ute)?\s*\(|xp_cmdshell|sp_executesql|"
    r"information_schema|pg_sleep|pg_tables|sys\.tables|"
    r"load_file\s*\(|into\s+(?:outfile|dumpfile)|"
    r"(?:sleep|benchmark|waitfor\s+delay)\s*\(",
    re.IGNORECASE,
)

# ─────────────────────────────────────────────────────────────────────────────
# A10 — SSRF: private / loopback IP ranges
# ─────────────────────────────────────────────────────────────────────────────
PRIVATE_RANGES = [
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("169.254.0.0/16"),
    ipaddress.ip_network("100.64.0.0/10"),
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("fc00::/7"),
]

# ─────────────────────────────────────────────────────────────────────────────
# A01 — Public paths: bypass auth pre-check
# ─────────────────────────────────────────────────────────────────────────────
PUBLIC_PATHS = {
    "/",
    "/health",
    "/docs",
    "/redoc",
    "/openapi.json",
    "/api/v1/auth/microsoft-login",
    "/api/v1/auth/callback",
    "/api/v1/auth/logout",
    "/api/v1/auth/teams-token",
    "/api/v1/auth/teams-exchange",
}
PUBLIC_PREFIXES = ("/static/",)

# A08 — Allowed Content-Type values for mutating requests
ALLOWED_CONTENT_TYPES = {
    "application/json",
    "multipart/form-data",
    "application/x-www-form-urlencoded",
    "text/plain",
}

# Collection endpoints where a DELETE without a specific ID in the path would
# affect every row — block those outright (only per-resource delete is allowed).
BULK_DELETE_COLLECTION_SUFFIXES = (
    "projects", "service-requests", "organizations", "inquiries", "tenders",
    "users", "api-keys", "activities", "notes",
)


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _client_ip(request: Request) -> str:
    direct_ip = request.client.host if request.client else "unknown"
    # Only honor X-Forwarded-For when the immediate TCP peer is a configured,
    # trusted reverse proxy — otherwise any client can spoof this header to
    # evade rate limiting / IP bans / 404-scan detection.
    if direct_ip in settings.trusted_proxies_set:
        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded:
            return forwarded.split(",")[0].strip()
    return direct_ip


def _rate_bucket(path: str, method: str) -> str:
    _AUTH_EXCLUDE = {"/api/v1/auth/me", "/api/v1/auth/logout", "/api/v1/auth/callback"}
    if "/auth" in path and path not in _AUTH_EXCLUDE:
        return "auth"
    if method == "DELETE":
        return "delete"
    if method in ("POST", "PATCH", "PUT"):
        return "write"
    return "default"


def _is_rate_limited(bucket: str, ip: str) -> bool:
    cfg = RATE_CONFIG[bucket]
    return _store.is_rate_limited(f"{bucket}:{ip}", cfg["limit"], cfg["window"])


def _record_violation(ip: str) -> bool:
    banned = _store.record_violation(ip, BAN_DURATION_SECONDS, BAN_THRESHOLD)
    if banned:
        logger.critical("[A07] IP BANNED | ip=%s", ip)
    return banned


def _is_banned(ip: str) -> bool:
    return _store.is_banned(ip)


def _is_private_ip(host: str) -> bool:
    try:
        addr = ipaddress.ip_address(host)
        return any(addr in net for net in PRIVATE_RANGES)
    except ValueError:
        return (
            host in ("localhost", "metadata.google.internal", "169.254.169.254")
            or host.endswith(".local")
            or host.endswith(".internal")
        )


def _check_ssrf(value: str) -> bool:
    """Return True if value contains a URL pointing at a private IP."""
    if not value.startswith(("http://", "https://")):
        return False
    try:
        host = urlparse(value).hostname or ""
        return _is_private_ip(host)
    except Exception:
        return False


def _track_404(ip: str) -> bool:
    """A01: Detect port/path scanning. Returns True if IP is scanning."""
    return _store.track_scan(ip, window=60, limit=30)


# ─────────────────────────────────────────────────────────────────────────────
# Middleware
# ─────────────────────────────────────────────────────────────────────────────

class OWASPMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        ip = _client_ip(request)
        path = request.url.path
        method = request.method

        # CORS preflight requests never carry auth/cookies by design — the
        # browser sends them itself before the real request. Middleware order
        # means this runs before CORSMiddleware, so without this bypass every
        # preflight gets rejected here (401) and CORSMiddleware never gets a
        # chance to answer it, breaking every cross-origin POST/PATCH/DELETE.
        if method == "OPTIONS":
            return await call_next(request)

        request_id = str(uuid.uuid4())[:8]

        # ── A07: Check IP ban first (fastest reject) ──────────────────────
        if _is_banned(ip):
            logger.warning("[A07] Banned IP request | ip=%s path=%s", ip, path)
            return JSONResponse(
                status_code=429,
                headers={"Retry-After": str(BAN_DURATION_SECONDS)},
                content={"detail": "Too many violations. Try again later."},
            )

        # ── A01: Auth pre-check — API routes ─────────────────────────────
        if path.startswith("/api/"):
            is_public = path in PUBLIC_PATHS or any(path.startswith(p) for p in PUBLIC_PREFIXES)
            if not is_public:
                auth_header = request.headers.get("Authorization", "")
                has_bearer = auth_header.startswith("Bearer ")
                has_api_key = bool(request.headers.get("X-API-Key"))
                has_session_cookie = bool(request.cookies.get("session_token"))
                if not (has_bearer or has_api_key or has_session_cookie):
                    logger.warning(
                        "[A01] Unauthenticated API access | ip=%s path=%s rid=%s",
                        ip, path, request_id,
                    )
                    _record_violation(ip)
                    return JSONResponse(status_code=401, content={"detail": "Not authenticated. Missing or invalid token."})

        # ── A04: HTTP method allowlist ────────────────────────────────────
        if method not in ALLOWED_METHODS:
            logger.warning("[A04] Method not allowed | ip=%s method=%s path=%s", ip, method, path)
            _record_violation(ip)
            return JSONResponse(status_code=405, content={"detail": "Method not allowed."})

        # ── Bulk DELETE protection ─────────────────────────────────────────
        if method == "DELETE":
            query_str = str(request.url.query)
            if BULK_ID_PATTERN.search(query_str):
                logger.warning(
                    "[BULK-DELETE] Bulk ID query blocked | ip=%s path=%s query=%s rid=%s",
                    ip, path, query_str[:200], request_id,
                )
                _record_violation(ip)
                return JSONResponse(
                    status_code=400,
                    content={"detail": "Bulk delete is not allowed. Delete one record at a time."},
                )
            if path.startswith("/api/") and path.rstrip("/").endswith(BULK_DELETE_COLLECTION_SUFFIXES):
                logger.warning(
                    "[BULK-DELETE] Collection DELETE blocked | ip=%s path=%s rid=%s",
                    ip, path, request_id,
                )
                _record_violation(ip)
                return JSONResponse(status_code=405, content={"detail": "Bulk delete is not allowed."})

        # ── A03: Injection detection in URL + query string ────────────────
        # Decode percent-encoding first (e.g. "%20"/"+") so patterns using \s
        # and literal chars like <, > still match encoded attack payloads.
        full_url = unquote(str(request.url))
        if INJECTION_PATTERNS.search(full_url):
            logger.warning("[A03] Injection attempt in URL | ip=%s url=%s rid=%s", ip, full_url[:300], request_id)
            _record_violation(ip)
            return JSONResponse(status_code=400, content={"detail": "Bad request."})

        # ── A03: Injection detection in suspicious headers ────────────────
        for header_name in ("User-Agent", "Referer", "X-Forwarded-Host", "X-Original-URL"):
            hval = request.headers.get(header_name, "")
            if hval and INJECTION_PATTERNS.search(hval):
                logger.warning("[A03] Injection in header %s | ip=%s rid=%s", header_name, ip, request_id)
                _record_violation(ip)
                return JSONResponse(status_code=400, content={"detail": "Bad request."})

        # ── A03: SQLi scan on JSON body (POST/PATCH/DELETE to /api/ only) ──
        if method in ("POST", "PATCH", "DELETE") and path.startswith("/api/"):
            content_type = request.headers.get("content-type", "")
            if "application/json" in content_type:
                content_length = request.headers.get("content-length", "0")
                try:
                    body_size = int(content_length)
                except ValueError:
                    body_size = 0
                if 0 < body_size <= 64 * 1024:
                    try:
                        body_bytes = await request.body()
                        body_text = body_bytes.decode("utf-8", errors="ignore")
                        if SQLI_BODY_PATTERNS.search(body_text):
                            logger.warning("[A03] SQLi in request body | ip=%s path=%s rid=%s", ip, path, request_id)
                            _record_violation(ip)
                            return JSONResponse(status_code=400, content={"detail": "Bad request."})
                    except Exception:
                        pass

        # ── A10: SSRF — check query params and URL-valued headers ─────────
        for param_value in request.query_params.values():
            if _check_ssrf(param_value):
                logger.warning("[A10] SSRF in query param | ip=%s param=%s rid=%s", ip, param_value[:100], request_id)
                _record_violation(ip)
                return JSONResponse(status_code=400, content={"detail": "Bad request."})

        for ssrf_header in ("X-Forwarded-For", "X-Real-IP"):
            hval = request.headers.get(ssrf_header, "")
            if hval and _check_ssrf(hval):
                logger.warning("[A10] SSRF in header %s | ip=%s rid=%s", ssrf_header, ip, request_id)
                _record_violation(ip)
                return JSONResponse(status_code=400, content={"detail": "Bad request."})

        # ── A04: Block oversized bodies ───────────────────────────────────
        content_length = request.headers.get("content-length")
        if content_length:
            try:
                size = int(content_length)
            except ValueError:
                return JSONResponse(status_code=400, content={"detail": "Bad request."})
            content_type = request.headers.get("content-type", "")
            limit = MAX_BODY_BYTES if "multipart" in content_type else MAX_JSON_BYTES
            if size > limit:
                logger.warning("[A04] Body too large | ip=%s size=%d limit=%d path=%s", ip, size, limit, path)
                return JSONResponse(status_code=413, content={"detail": "Request body too large."})

        # ── A08: Content-Type allowlist on mutating requests ─────────────
        if method in ("POST", "PATCH", "PUT") and content_length and int(content_length) > 0:
            ct = request.headers.get("content-type", "").split(";")[0].strip().lower()
            if not ct:
                logger.warning("[A08] Missing Content-Type | ip=%s path=%s", ip, path)
                return JSONResponse(status_code=415, content={"detail": "Content-Type header required."})
            if ct not in ALLOWED_CONTENT_TYPES:
                logger.warning("[A08] Disallowed Content-Type '%s' | ip=%s path=%s", ct, ip, path)
                return JSONResponse(status_code=415, content={"detail": f"Content-Type '{ct}' not allowed."})

        # ── A07: Rate limiting ────────────────────────────────────────────
        bucket = _rate_bucket(path, method)
        if _is_rate_limited(bucket, ip):
            logger.warning("[A07] Rate limit hit | ip=%s bucket=%s path=%s rid=%s", ip, bucket, path, request_id)
            _record_violation(ip)
            cfg = RATE_CONFIG[bucket]
            return JSONResponse(
                status_code=429,
                headers={"Retry-After": str(cfg["window"])},
                content={"detail": f"Too many requests. Retry after {cfg['window']} seconds."},
            )

        # ── Process request ───────────────────────────────────────────────
        start = time.time()
        response = await call_next(request)
        duration_ms = round((time.time() - start) * 1000)

        # ── A01: Track path scanning (mass 404s) ──────────────────────────
        if response.status_code == 404 and path.startswith("/api/"):
            if _track_404(ip):
                logger.warning("[A01] Path scanning detected | ip=%s", ip)
                _record_violation(ip)

        # ── A09: Structured logging ───────────────────────────────────────
        if response.status_code >= 400:
            level = logging.CRITICAL if response.status_code >= 500 else logging.WARNING
            logger.log(
                level, "[A09] %d | ip=%s method=%s path=%s duration=%dms rid=%s",
                response.status_code, ip, method, path, duration_ms, request_id,
            )

        if duration_ms > SLOW_REQUEST_MS:
            logger.warning("[A09] Slow request | ip=%s method=%s path=%s duration=%dms rid=%s", ip, method, path, duration_ms, request_id)

        # ── A05 + A02: Security response headers ─────────────────────────
        h = response.headers
        h["X-Content-Type-Options"] = "nosniff"
        h["X-XSS-Protection"] = "1; mode=block"
        h["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains; preload"
        h["Referrer-Policy"] = "strict-origin-when-cross-origin"
        h["Permissions-Policy"] = (
            "camera=(), microphone=(), geolocation=(), payment=(), "
            "usb=(), bluetooth=(), accelerometer=(), gyroscope=()"
        )

        if path.startswith("/api/"):
            h["Content-Security-Policy"] = "default-src 'none'"
            h["Cache-Control"] = "no-store, no-cache, must-revalidate, private"
            h["Pragma"] = "no-cache"
        else:
            h["Content-Security-Policy"] = "default-src 'self'; frame-ancestors 'none'; object-src 'none'"

        h["Cross-Origin-Opener-Policy"] = "same-origin"
        h["Cross-Origin-Resource-Policy"] = "cross-origin"
        h["X-Request-ID"] = request_id

        # A02/A05: Remove server fingerprinting
        for leak_header in ("server", "x-powered-by", "x-aspnet-version", "x-aspnetmvc-version"):
            if leak_header in h:
                del h[leak_header]

        return response
