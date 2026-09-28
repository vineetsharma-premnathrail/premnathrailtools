"""Request-scoped context (IP, user-agent, raw refresh-token cookie) used to
auto-populate AuditLog.ip_address/user_agent/session_id on every insert,
app-wide, without touching the ~10 existing call sites that already create
AuditLog rows (p2p_requests.py, projects.py, workflow.py, organizations.py,
tenders.py, inquiries.py, rfq.py, goods_receipts.py, service_requests.py,
users.py). See the `before_insert` listener in
app/modules/main/models/audit_log.py for where this is consumed."""

from contextvars import ContextVar
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

_ip_address: ContextVar[str | None] = ContextVar("audit_ip_address", default=None)
_user_agent: ContextVar[str | None] = ContextVar("audit_user_agent", default=None)
_refresh_token: ContextVar[str | None] = ContextVar("audit_refresh_token", default=None)
_api_source: ContextVar[str | None] = ContextVar("audit_api_source", default=None)


def get_request_ip() -> str | None:
    return _ip_address.get()


def get_request_user_agent() -> str | None:
    return _user_agent.get()


def get_request_refresh_token() -> str | None:
    """The raw (unhashed) refresh-token cookie for this request, if any —
    hashed and looked up against `user_sessions` only when an AuditLog row
    is actually being written (see the model's before_insert listener), not
    on every request, to avoid an extra DB query on the hot GET path."""
    return _refresh_token.get()


def set_api_source(source: str) -> None:
    """Called from get_current_user() once it's determined which auth path
    this request took — "web_app" | "bearer_token" — so the AuditLog row
    this request eventually triggers knows where it came from."""
    _api_source.set(source)


def get_api_source() -> str | None:
    return _api_source.get()


class AuditContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        ip = request.client.host if request.client else None
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            ip = forwarded.split(",")[0].strip()
        ip_token = _ip_address.set(ip)
        ua_token = _user_agent.set(request.headers.get("user-agent"))
        rt_token = _refresh_token.set(request.cookies.get("refresh_token"))
        src_token = _api_source.set(None)
        try:
            return await call_next(request)
        finally:
            _ip_address.reset(ip_token)
            _user_agent.reset(ua_token)
            _refresh_token.reset(rt_token)
            _api_source.reset(src_token)
