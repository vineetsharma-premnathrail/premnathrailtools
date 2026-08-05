"""
Error handling middleware - catches all exceptions and logs them properly.
"""

import logging
from fastapi import Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from starlette.middleware.base import BaseHTTPMiddleware

logger = logging.getLogger(__name__)


async def error_handler(request: Request, exc: Exception):
    """
    Handle unexpected errors and return proper response.

    Logs error details for debugging without exposing sensitive info.
    """
    logger.error(
        f"Unexpected error: {str(exc)}",
        extra={
            "method": request.method,
            "path": request.url.path,
            "error_type": type(exc).__name__,
        },
        exc_info=True
    )

    # Return generic error response (don't leak internal details)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "detail": "Internal server error. Please contact support.",
            "error_id": id(exc)  # For user to report
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
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": exc.detail}
        )

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(request: Request, exc: RequestValidationError):
        return await validation_error_handler(request, exc)

    @app.exception_handler(Exception)
    async def general_exception_handler(request: Request, exc: Exception):
        return await error_handler(request, exc)
