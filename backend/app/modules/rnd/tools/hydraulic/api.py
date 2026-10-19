# Hydraulic Tool API Router

import logging
import re
from typing import Mapping, Any
from urllib.parse import quote
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import ValidationError
from .schemas import HydraulicInput
from .validation import validate_hydraulic_inputs
from .service import perform_hydraulic_calculation
from .reports.pdf_builder import create_hydraulic_docx_report, generate_hydraulic_pdf_report
from ..latex_utils import escape_latex

logger = logging.getLogger("rnd.tools.hydraulic")
router = APIRouter()


def _validation_detail(ve: ValidationError) -> str:
    """Turn a Pydantic ValidationError into '<field>: <message> — fill it and recalculate.'
    lines instead of the raw multi-line Pydantic dump."""
    parts = []
    for err in ve.errors():
        loc = ".".join(str(x) for x in err.get("loc", ()) if x != "body") or "input"
        parts.append(f"{loc}: {err.get('msg', 'is not valid')} — fill it and recalculate.")
    return " ".join(parts) or "One of the hydraulic inputs is not valid — check every field and recalculate."


def _parse_input(raw: Mapping[str, Any], purpose: str) -> HydraulicInput:
    try:
        if hasattr(HydraulicInput, 'model_validate'):
            return HydraulicInput.model_validate(raw)
        return HydraulicInput(**raw)  # pydantic v1
    except ValidationError as ve:
        try:
            keys = list(raw.keys())
        except Exception:
            keys = None
        logger.warning("Hydraulic input validation failed (%s): %s; payload keys: %s", purpose, ve, keys)
        raise HTTPException(status_code=422, detail=_validation_detail(ve))
    except Exception:
        logger.exception("Unexpected error while validating hydraulic input (%s)", purpose)
        raise HTTPException(status_code=400, detail="Could not read the hydraulic inputs — fill every field with a valid number and recalculate.")


def _content_disposition(doc_no: Any, ext: str) -> str:
    """Attachment header built from the raw doc_no: an ASCII-safe quoted name
    (falls back to Hydraulic_Report) plus an RFC 5987 filename* for the original."""
    original = str(doc_no or "").strip()
    safe = re.sub(r"[^A-Za-z0-9_.-]", "_", original.replace(" ", "_")).strip("._") or "Hydraulic_Report"
    utf8_name = (original or "Hydraulic_Report") + ext
    return f"attachment; filename=\"{safe}{ext}\"; filename*=UTF-8''{quote(utf8_name)}"

@router.post("/calculate")
async def calculate_hydraulic(raw: Mapping[str, Any]) -> dict[str, Any]:
    """Calculate hydraulic motor/pump parameters"""
    model = _parse_input(raw, "calculate")

    try:
        inputs, inputs_raw = validate_hydraulic_inputs(model)
        results, report = perform_hydraulic_calculation(inputs, inputs_raw)
        return {"report": report, "results": results}
    except HTTPException:
        raise
    except ValueError as e:
        # Input-related error — return 400 so client receives a clear validation response
        logger.warning("Validation error during hydraulic calculation: %s", e)
        raise HTTPException(status_code=400, detail=f"{e} — correct the highlighted input and recalculate.")
    except Exception:
        logger.exception("Error during hydraulic calculation")
        raise HTTPException(500, "Calculation failed unexpectedly — report this with your inputs to the R&D tool owner.")

@router.post("/download-report")
async def download_hydraulic_report(raw: Mapping[str, Any]):
    """Download hydraulic calculation report as DOCX"""
    model = _parse_input(raw, "docx")

    try:
        inputs, inputs_raw = validate_hydraulic_inputs(model)
        results, _ = perform_hydraulic_calculation(inputs, inputs_raw)
        stream = create_hydraulic_docx_report(inputs, results, inputs_raw)
        # File name comes from the raw doc_no (never a LaTeX-escaped one)
        return StreamingResponse(
            stream,
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={"Content-Disposition": _content_disposition(raw.get('doc_no'), ".docx")}
        )
    except HTTPException:
        raise
    except ValueError as e:
        logger.warning("Validation error generating hydraulic report: %s", e)
        raise HTTPException(status_code=400, detail=f"{e} — correct the highlighted input and recalculate.")
    except Exception:
        logger.exception("Error generating hydraulic report")
        raise HTTPException(500, "Calculation failed unexpectedly — report this with your inputs to the R&D tool owner.")


@router.post("/hydraulic_report_pdf")
async def download_hydraulic_pdf(raw: Mapping[str, Any]):
    """Generate and download a PDF report (LaTeX -> PDF) for Pump & Motor (cc) calculations"""
    model = _parse_input(raw, "pdf")

    try:
        inputs, inputs_raw = validate_hydraulic_inputs(model)
        results, _ = perform_hydraulic_calculation(inputs, inputs_raw)

        # Build context for LaTeX template using validated numeric `inputs` + `results`.
        # Avoid using raw string inputs for numeric template expressions (prevents Jinja TypeError).
        context: dict[str, Any] = {}
        context.update(inputs or {})          # validated numeric values
        context.update(results or {})         # calculation outputs
        # include any raw-only keys that don't overwrite validated values
        for k, v in (inputs_raw or {}).items():
            if k not in context:
                context[k] = v
        # include optional metadata from the incoming payload (if provided).
        # These are free-text and go straight into a .tex template that gets
        # compiled by a real LaTeX engine below — escape them so a value like
        # `\input{/app/.env}` renders as literal text instead of being
        # interpreted as a file-inclusion directive by the compiler.
        for meta in ('doc_no', 'made_by', 'checked_by', 'approved_by', 'doc_date'):
            if raw.get(meta):
                context[meta] = escape_latex(str(raw.get(meta)))

        pdf_stream = generate_hydraulic_pdf_report(context)
        # File name comes from the raw doc_no, not the LaTeX-escaped context value
        return StreamingResponse(
            pdf_stream,
            media_type='application/pdf',
            headers={'Content-Disposition': _content_disposition(raw.get('doc_no'), '.pdf')}
        )
    except HTTPException:
        raise
    except ValueError as e:
        logger.warning('Validation error generating hydraulic PDF: %s', e)
        raise HTTPException(status_code=400, detail=f"{e} — correct the highlighted input and recalculate.")
    except Exception:
        logger.exception('Error generating hydraulic PDF report')
        raise HTTPException(500, "Calculation failed unexpectedly — report this with your inputs to the R&D tool owner.")