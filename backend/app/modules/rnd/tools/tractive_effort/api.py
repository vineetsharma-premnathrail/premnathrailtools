# Tractive Effort Tool API Router
# FastAPI router for tractive effort endpoints

import logging

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from typing import Dict, Any
from .schemas import TractiveEffortInput
from .validation import validate_tractive_effort_inputs
from .service import perform_te_calculation
from .reports.pdf_builder import create_te_docx_report

logger = logging.getLogger("rnd.tools.tractive_effort")
router = APIRouter(tags=["tractive-effort"])

@router.post("/calculate")
async def calculate_tractive_effort(raw_input: TractiveEffortInput) -> Dict[str, Any]:
    """Calculate tractive effort and return results with formatted report"""
    try:
        inputs, inputs_raw = validate_tractive_effort_inputs(raw_input)
        results, report = perform_te_calculation(inputs, inputs_raw)
        return {"report": report, "results": results}
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(400, f"{e} — correct the highlighted input and recalculate.")
    except Exception:
        logger.exception("Tractive effort calculation failed")
        raise HTTPException(500, "Calculation failed unexpectedly — report this with your inputs to the R&D tool owner.")

@router.post("/download-report")
async def download_tractive_effort_report(raw_input: TractiveEffortInput):
    """Generate and download DOCX report for tractive effort calculation"""
    try:
        inputs, inputs_raw = validate_tractive_effort_inputs(raw_input)
        results, _ = perform_te_calculation(inputs, inputs_raw)
        stream = create_te_docx_report(inputs, results, inputs_raw)
        return StreamingResponse(
            stream,
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={"Content-Disposition": "attachment; filename=TE_Report.docx"}
        )
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(400, f"{e} — correct the highlighted input and recalculate.")
    except Exception:
        logger.exception("Tractive effort calculation failed")
        raise HTTPException(500, "Calculation failed unexpectedly — report this with your inputs to the R&D tool owner.")