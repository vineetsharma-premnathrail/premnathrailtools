"""SM12-style concurrent-edit protection (optimistic locking).

Key editable documents carry `lock_version` (SQLAlchemy version_id_col — the
UPDATE itself is `... WHERE lock_version = <loaded>`, so two saves racing in
the same instant can't both win) and `lock_changed_by_id`.

Stale-form protection: the frontend API client remembers the lock_version
of every document it loaded and sends it back as `X-Lock-Version` on the next
PUT/PATCH/POST/DELETE to that document's URL (frontend/src/lib/api.ts). When
the stored version has moved on — someone else saved since the form was
opened — the save is refused with 409 "changed by <name> at <time>, reload".
A request without the header (scripts, tests, older pages) behaves as before.

Covered: sales orders, P2P purchase orders, production + design BOMs,
journal entries, vendor invoices, HR employee profiles (LOCKED_PATHS)."""
from contextvars import ContextVar
from datetime import datetime

from fastapi import Request
from fastapi.responses import JSONResponse
from sqlalchemy import event, text

HEADER = "x-lock-version"

# API path prefix (after /api/v1) -> table whose row the next segment identifies.
LOCKED_PATHS: dict[str, str] = {
    "/p2p/purchase-orders/": "p2p_purchase_orders",
    "/production/boms/": "production_boms",
    "/design/boms/": "design_boms",
    "/accounts/journal-entries/": "journal_entries",
    "/accounts/vendor-invoices/": "vendor_invoices",
    "/hr/employees/": "hr_employee_profiles",  # identified by user_id in the URL
}

_state: ContextVar[dict | None] = ContextVar("optimistic_lock_state", default=None)


class StaleRecordError(Exception):
    def __init__(self, table: str, record_id: int, changed_by: str | None, changed_at: datetime | None):
        self.table, self.record_id, self.changed_by, self.changed_at = table, record_id, changed_by, changed_at
        super().__init__(f"{table}#{record_id} changed by {changed_by} at {changed_at}")


_LABELS = {
    "p2p_purchase_orders": "purchase order", "production_boms": "BOM",
    "design_boms": "BOM", "journal_entries": "journal entry", "vendor_invoices": "vendor invoice",
    "hr_employee_profiles": "employee record",
}


def message_for(exc: StaleRecordError) -> str:
    what = _LABELS.get(exc.table, "record")
    who = exc.changed_by or "another user"
    when = f" at {exc.changed_at.astimezone().strftime('%d-%m-%Y %H:%M')}" if exc.changed_at else ""
    return (f"This {what} was changed by {who}{when} after you opened it, so your save was not applied "
            "(it would have overwritten their changes). Reload the page to see the latest version, then re-apply your edits.")


def parse_target(method: str, path: str, header_value: str | None) -> dict | None:
    if method.upper() not in ("PUT", "PATCH", "POST", "DELETE") or not header_value:
        return None
    try:
        expected = int(str(header_value).strip())
    except ValueError:
        return None
    sub = path[len("/api/v1"):] if path.startswith("/api/v1") else path
    for prefix, table in LOCKED_PATHS.items():
        if sub.startswith(prefix):
            ident = sub[len(prefix):].split("/", 1)[0]
            if ident.isdigit():
                return {"table": table, "ident": ident, "expected": expected, "checked": set()}
    return None


class OptimisticLockMiddleware:
    """Pure ASGI: puts the request's lock target on a ContextVar (the dict is
    shared, so sync routes in the threadpool see it too)."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        headers = dict(scope.get("headers") or [])
        raw = headers.get(HEADER.encode())
        target = parse_target(scope.get("method", "GET"), scope.get("path", ""), raw.decode() if raw else None)
        token = _state.set(target)
        try:
            await self.app(scope, receive, send)
        finally:
            _state.reset(token)


def _before_update(mapper, connection, target):
    from app.core.audit_context import get_current_user_id

    uid = get_current_user_id()
    state = _state.get()
    table = mapper.local_table.name
    if state and state["table"] == table:
        key = (table, target.id)
        idents = {str(target.id)}
        if table == "hr_employee_profiles":
            idents = {str(getattr(target, "user_id", None))}
        if key not in state["checked"] and state["ident"] in idents:
            state["checked"].add(key)
            current = target.lock_version
            last_by = target.lock_changed_by_id
            # A version moved on by the same user (another tab / an endpoint
            # that didn't echo lock_version) is not someone else's change.
            if current is not None and current != state["expected"] and not (uid and last_by == uid):
                name = None
                if last_by:
                    name = connection.execute(text("SELECT name FROM users WHERE id = :i"), {"i": last_by}).scalar()
                raise StaleRecordError(table, target.id, name, getattr(target, "updated_at", None))
    if uid:
        target.lock_changed_by_id = uid


_REGISTERED: set = set()


def register_locked_models() -> None:
    from app.modules.accounts.models.journal_entry import JournalEntry
    from app.modules.accounts.models.vendor_invoice import VendorInvoice
    from app.modules.design.models.bom import DesignBom
    from app.modules.hr.models.employee_profile import HrEmployeeProfile
    from app.modules.p2p.models.purchase_order import P2PPurchaseOrder
    from app.modules.production.models.bom import ProductionBom

    for model in (P2PPurchaseOrder, ProductionBom, DesignBom, JournalEntry, VendorInvoice, HrEmployeeProfile):
        if model not in _REGISTERED:
            event.listen(model, "before_update", _before_update)
            _REGISTERED.add(model)


def conflict_response(exc: Exception) -> JSONResponse | None:
    from sqlalchemy.orm.exc import StaleDataError

    if isinstance(exc, StaleRecordError):
        return JSONResponse(status_code=409, content={"detail": message_for(exc), "code": "stale_record"})
    if isinstance(exc, StaleDataError):
        return JSONResponse(status_code=409, content={
            "detail": "Someone else saved this record at the same moment, so your save was not applied. "
                      "Reload the page to see their changes, then re-apply yours.",
            "code": "stale_record",
        })
    return None


def setup_lock_handlers(app) -> None:
    from sqlalchemy.orm.exc import StaleDataError

    async def _handler(request: Request, exc: Exception):
        return conflict_response(exc)

    app.add_exception_handler(StaleRecordError, _handler)
    app.add_exception_handler(StaleDataError, _handler)
