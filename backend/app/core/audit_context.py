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
# Values set by get_current_user() (api_source, acting user id) live in a
# per-request *mutable* dict rather than their own ContextVars: FastAPI runs
# sync dependencies like get_current_user() in a threadpool with a *copy* of
# the context, so a ContextVar.set() there never reaches the route that later
# writes the AuditLog row. Mutating the dict the middleware created does.
_request_state: ContextVar[dict | None] = ContextVar("audit_request_state", default=None)


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


def _set_state(key: str, value) -> None:
    state = _request_state.get()
    if state is not None:
        state[key] = value


def _get_state(key: str):
    state = _request_state.get()
    return state.get(key) if state is not None else None


def set_api_source(source: str) -> None:
    """Called from get_current_user() once it's determined which auth path
    this request took — "web_app" | "bearer_token" — so the AuditLog row
    this request eventually triggers knows where it came from."""
    _set_state("api_source", source)


def get_api_source() -> str | None:
    return _get_state("api_source")


def set_current_user_id(user_id: int) -> None:
    """Called from get_current_user() once the caller is authenticated, so
    the automatic ORM-level audit trail (app/core/audit.py) can attribute
    changes without every route passing the user through."""
    _set_state("user_id", user_id)


def get_current_user_id() -> int | None:
    return _get_state("user_id")


class AuditContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        ip = request.client.host if request.client else None
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            ip = forwarded.split(",")[0].strip()
        ip_token = _ip_address.set(ip)
        ua_token = _user_agent.set(request.headers.get("user-agent"))
        rt_token = _refresh_token.set(request.cookies.get("refresh_token"))
        state_token = _request_state.set({})
        try:
            return await call_next(request)
        finally:
            _ip_address.reset(ip_token)
            _user_agent.reset(ua_token)
            _refresh_token.reset(rt_token)
            _request_state.reset(state_token)
