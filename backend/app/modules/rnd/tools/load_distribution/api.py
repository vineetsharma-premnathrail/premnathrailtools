# Load Distribution Tool API Router
# FastAPI router for load distribution endpoints

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from typing import Dict, Any
from .schemas import LoadDistributionInput
from .validation import validate_load_distribution_inputs
from .service import perform_load_distro_calc, format_load_distro_steps
from .reports.pdf_builder import create_load_distro_docx

router = APIRouter(tags=["load-distribution"])

@router.post("/calculate")
async def calculate_load_distribution(raw_input: LoadDistributionInput) -> Dict[str, Any]:
    """Calculate load distribution and return results with formatted report"""
    try:
        inputs, _ = validate_load_distribution_inputs(raw_input)
        results = perform_load_distro_calc(
            inputs['config_type'],
            inputs['total_load'],
            inputs['front_percent'],
            inputs['q1_percent'],
            inputs['q3_percent']
        )
        report = format_load_distro_steps(inputs, results)
        return {"report": report, "results": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/download-report")
async def download_load_distribution_report(raw_input: LoadDistributionInput):
    """Generate and download DOCX report for load distribution calculation"""
    try:
        inputs, _ = validate_load_distribution_inputs(raw_input)
        results = perform_load_distro_calc(
            inputs['config_type'],
            inputs['total_load'],
            inputs['front_percent'],
            inputs['q1_percent'],
            inputs['q3_percent']
        )
        stream = create_load_distro_docx(inputs, results)
        return StreamingResponse(
            stream,
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={"Content-Disposition": "attachment; filename=Load_Report.docx"}
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

def format_load_distro_steps(inputs: Dict[str, Any], results: Dict[str, Any]) -> str:
    """Format load distribution calculation steps (imported from service for compatibility)"""
    from .service import format_load_distro_steps as service_format
    return service_format(inputs, results)