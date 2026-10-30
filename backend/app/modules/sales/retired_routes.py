"""Catch-all for the retired Sales API (2026-10-30).

Every method on /api/v1/sales/... answers 410 Gone with the reason and where
to go instead, so an old bookmark, script or open browser tab gets a clear
message rather than a 404. The response carries no data, so it needs no
permission gate or data-scope filter. Mounted in main.py (prefix /api/v1).
"""
from fastapi import APIRouter
from fastapi.responses import JSONResponse

RETIRED_MESSAGE = (
    "Sales Orders were removed on 2026-10-30. Projects are created in "
    "Project Management › All Projects › + Create Project."
)

router = APIRouter(prefix="/sales", tags=["Sales (retired)"], include_in_schema=False)


@router.api_route("/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
async def sales_retired(path: str) -> JSONResponse:
    return JSONResponse(status_code=410, content={"detail": RETIRED_MESSAGE, "code": "sales_retired"})
