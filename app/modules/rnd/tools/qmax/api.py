from typing import Dict, Any
# Qmax Tool API Router

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from .schemas import QmaxInput
from .validation import validate_qmax_inputs
from .service import perform_qmax_calculation
from .reports.pdf_builder import create_qmax_docx_report

router = APIRouter()

@router.post("/calculate")


async def calculate(raw: QmaxInput) -> Dict[str, Any]:
    """Calculate Qmax values"""
    try:
        inputs, inputs_raw = validate_qmax_inputs(raw)
        results, report = perform_qmax_calculation(inputs, inputs_raw)
        return {"report": report, "results": results}
    except Exception as e:
        raise HTTPException(500, str(e))

@router.post("/download-report")
async def download_report(raw: QmaxInput):
    """Download Qmax calculation report as DOCX"""
    try:
        inputs, inputs_raw = validate_qmax_inputs(raw)
        results, _ = perform_qmax_calculation(inputs, inputs_raw)
        stream = create_qmax_docx_report(results, inputs_raw)
        return StreamingResponse(
            stream,
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={"Content-Disposition": "attachment; filename=Qmax_Report.docx"}
        )
    except Exception as e:
        raise HTTPException(500, str(e))