import logging

from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse, RedirectResponse

from . import core, validation
from .schemas import SplineInput
from .docx_builder import create_spline_docx
from .reports.pdf_builder import generate_spline_pdf

logger = logging.getLogger("rnd.tools.spline")

router = APIRouter(tags=["spline"])

PDF_FAILURE_MESSAGE = (
    "Couldn't build the spline report PDF. The LaTeX compiler failed — check the "
    "inputs (document no., names, material) for unusual characters; if it keeps "
    "failing, contact IT with the time of the error."
)
DOCX_FAILURE_MESSAGE = (
    "Couldn't build the spline Word report. Generating the document failed — check "
    "the inputs for unusual characters or missing values; if it keeps failing, "
    "contact IT with the time of the error."
)


def _failure(message: str) -> JSONResponse:
    # `detail` is what the frontend error helpers read; `error` is kept for
    # older callers. The raw exception is logged server-side only — it can
    # contain file paths and compiler output that must not reach the client.
    return JSONResponse(status_code=500, content={"detail": message, "error": message})


@router.get("/")
def spline_page(request: Request):
    # redirect to static html page
    return RedirectResponse(url="/spline_calculator.html")


@router.post("/calculate")
def calculate(data: SplineInput):
    logger.debug("Spline calculate called")
    return core.calculate_spline_mode(data.dict())


@router.post("/report")
def report(data: SplineInput):
    try:
        result = core.calculate_spline_mode(data.dict())
        # generate_spline_pdf escapes every user-supplied field and runs the
        # compiler sandboxed — never render this template with raw input.
        pdf_buffer = generate_spline_pdf(data.dict(), result)
        pdf_bytes = pdf_buffer.getvalue()
        logger.debug("Spline PDF built (%d bytes)", len(pdf_bytes))
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": "attachment; filename=spline_report.pdf"},
        )
    except Exception:
        logger.exception("Spline PDF report generation failed")
        return _failure(PDF_FAILURE_MESSAGE)


@router.post("/docx")
def docx_report(data: SplineInput):
    try:
        result = core.calculate_spline_mode(data.dict())
        buf = create_spline_docx(data.dict(), result)
        return Response(
            content=buf.getvalue(),
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={"Content-Disposition": "attachment; filename=spline_report.docx"},
        )
    except Exception:
        logger.exception("Spline DOCX report generation failed")
        return _failure(DOCX_FAILURE_MESSAGE)
