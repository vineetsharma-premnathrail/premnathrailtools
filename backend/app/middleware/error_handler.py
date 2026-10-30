"""
Error handling middleware - catches all exceptions and logs them properly.
"""

import logging
from fastapi import Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from starlette.middleware.base import BaseHTTPMiddleware
from sqlalchemy.exc import DBAPIError, OperationalError

from app.core.db_errors import describe_db_error

logger = logging.getLogger(__name__)


def _is_db_unreachable(exc: Exception) -> bool:
    """
    True when the database itself is down or dropped the connection (server
    restart, connection refused) rather than rejecting this request's data.
    SQLSTATE class 08 = connection exception, 57P = server shutdown/restart;
    a refused connect has no SQLSTATE at all.
    """
    if not isinstance(exc, OperationalError):
        return False
    if exc.connection_invalidated:
        return True
    orig = getattr(exc, "orig", None)
    if not type(orig).__module__.startswith(("psycopg", "psycopg2")):
        return False  # e.g. SQLite in tests: "no such table" is a real bug, not an outage
    state = getattr(orig, "sqlstate", None) or getattr(orig, "pgcode", None)
    return state is None or str(state).startswith(("08", "57P"))


async def error_handler(request: Request, exc: Exception):
    """
    Handle unexpected errors and return proper response.

    Database errors the user caused (text too long, duplicate value, missing
    required field) are explained in plain language so they can fix the form
    themselves — "Internal server error. Please contact support." tells them
    nothing and sends them to us for something they can correct in a second.
    Anything genuinely unexpected still returns a generic message.
    """
    if _is_db_unreachable(exc):
        # Database down/restarting: not a bug in this request, and recording it
        # would need the same database. One log line, 503, clear message.
        logger.warning(f"Database unreachable on {request.method} {request.url.path}: {getattr(exc, 'orig', exc)}")
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={
                "detail": (
                    "The database server is not reachable right now (it is restarting or down), "
                    "so nothing was saved. Please wait a minute and try again — if it keeps "
                    "happening, ask the administrator to check that the database server is running."
                )
            },
            headers={"Retry-After": "30"},
        )

    if isinstance(exc, DBAPIError):
        described = describe_db_error(exc)
        if described:
            status_code, message = described
            logger.warning(
                f"Database error explained to user on {request.method} {request.url.path}: {message}",
                exc_info=True,
            )
            return JSONResponse(status_code=status_code, content={"detail": message})

    logger.error(
        f"Unexpected error: {str(exc)}",
        extra={
            "method": request.method,
            "path": request.url.path,
            "error_type": type(exc).__name__,
        },
        exc_info=True
    )

    # Stale save on an optimistically-locked document (SM12) -> 409, not 500.
    from app.core.optimistic_lock import conflict_response
    conflict = conflict_response(exc)
    if conflict is not None:
        return conflict

    # SM21 / ST22: persist the error under a unique reference (uuid, not the
    # memory address id(exc)) — the same one the user sees, so support can
    # open the stack trace in Organization › System Monitor › System errors.
    from app.modules.main.services.basis_log import new_error_ref, record_error
    error_ref = new_error_ref()
    user_id = (request.scope.get("audit_state") or {}).get("user_id")
    from starlette.concurrency import run_in_threadpool
    await run_in_threadpool(record_error, error_ref, request, exc, user_id)

    # Return generic error response (don't leak internal details)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "detail": (
                "Something went wrong on the server while handling this request, so nothing "
                "was saved. Please try again — if it keeps happening, report this error reference "
                f"to support: {error_ref}."
            ),
            "error_id": error_ref,  # For user to report — matches system_error_logs.error_ref
        }
    )


async def validation_error_handler(request: Request, exc: RequestValidationError):
    """
    Handle Pydantic validation errors.

    Returns detailed error info (safe - validation is client fault, not security issue).
    """
    logger.warning(f"Validation error on {request.method} {request.url.path}: {exc.errors()}")
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={
            "detail": "Validation error",
            # jsonable_encoder is required here: Pydantic v2 puts the raw
            # exception object in errors()[i]["ctx"]["error"] for any custom
            # validator that raises ValueError(...), and that isn't JSON-
            # serializable on its own — passing exc.errors() to JSONResponse
            # directly 500s instead of returning 422.
            "errors": jsonable_encoder(exc.errors()),
        }
    )


class LoggingMiddleware(BaseHTTPMiddleware):
    """
    Middleware that logs all requests/responses.
    Useful for debugging and monitoring.
    """

    async def dispatch(self, request: Request, call_next):
        logger.info(
            f"{request.method} {request.url.path}",
            extra={"ip": request.client.host if request.client else "unknown"}
        )

        try:
            response = await call_next(request)
            logger.info(
                f"{request.method} {request.url.path} -> {response.status_code}"
            )
            return response
        except Exception as exc:
            logger.error(f"Request failed: {str(exc)}", exc_info=True)
            raise


class SecurityErrorHandler:
    """
    Handle security-related errors specially.
    Don't expose implementation details.
    """

    @staticmethod
    def handle_auth_error(exc: Exception):
        """
        Handle authentication errors (missing token, invalid token, etc.)

        Don't say "token expired" — say "unauthorized"
        Don't say which field — say "validation error"
        """
        logger.warning(f"Auth error: {str(exc)}")

        return JSONResponse(
            status_code=status.HTTP_401_UNAUTHORIZED,
            content={"detail": "Invalid credentials or session expired"}
        )

    @staticmethod
    def handle_permission_error(exc: Exception):
        """
        Handle authorization errors (user doesn't have permission).

        Don't tell them what permission they're missing.
        Don't tell them what they were trying to access.
        """
        logger.warning(f"Permission error: {str(exc)}")

        return JSONResponse(
            status_code=status.HTTP_403_FORBIDDEN,
            content={"detail": "You don't have permission to access this resource"}
        )

    @staticmethod
    def handle_not_found_error(exc: Exception):
        """
        Handle not found errors.

        Could be real (doesn't exist) or user doesn't have permission.
        Don't distinguish — both return 404.
        """
        logger.info(f"Not found: {str(exc)}")

        return JSONResponse(
            status_code=status.HTTP_404_NOT_FOUND,
            content={"detail": "Resource not found"}
        )


def setup_error_handlers(app):
    """
    Register error handlers with FastAPI app.

    Usage in main.py:
        from app.middleware.error_handler import setup_error_handlers
        setup_error_handlers(app)
    """
    from fastapi.exceptions import HTTPException

    @app.exception_handler(HTTPException)
    async def http_exception_handler(request: Request, exc: HTTPException):
        # HTTPExceptions are intentional (raised by our code)
        logger.info(f"HTTP error: {exc.detail} ({exc.status_code})")
        if exc.status_code == 403:
            # SU53: keep a trace of every refused request (rate-limited).
            from app.core.audit_context import get_current_user_id
            from app.modules.main.services.basis_log import record_denial
            from starlette.concurrency import run_in_threadpool
            await run_in_threadpool(record_denial, request.method, request.url.path, exc.detail, get_current_user_id(),
                                    getattr(exc, "permission_key", None))
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": exc.detail},
            headers=getattr(exc, "headers", None),
        )

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(request: Request, exc: RequestValidationError):
        return await validation_error_handler(request, exc)

    @app.exception_handler(DBAPIError)
    async def database_exception_handler(request: Request, exc: DBAPIError):
        return await error_handler(request, exc)

    @app.exception_handler(Exception)
    async def general_exception_handler(request: Request, exc: Exception):
        return await error_handler(request, exc)
