# Braking Tool API Router


from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from .schemas import BrakingInput
from .validation import validate_braking_inputs
from .service import perform_braking_calculation
from .reports.pdf_builder import generate_braking_pdf_report, create_braking_docx_report

router = APIRouter()

@router.post("/braking_calculate")
async def calculate_braking(raw: BrakingInput):
    """Calculate braking performance"""
    try:
        inputs, _ = validate_braking_inputs(raw)
        results, context = perform_braking_calculation(inputs)
        return {
            "rows": results,
            "gbr": context.get("gbr", 0),
            "max_force": context.get("max_braking_force", 0)
        }
    except Exception as e:
        raise HTTPException(500, str(e))


# Endpoint to download braking PDF report
@router.post("/braking_report_pdf")
async def download_braking_pdf(raw: BrakingInput):
    """Generate and download PDF report for braking calculations"""
    try:
        inputs, _ = validate_braking_inputs(raw)
        _, context = perform_braking_calculation(inputs)
        pdf_bytesio = generate_braking_pdf_report(context)
        return StreamingResponse(
            pdf_bytesio,
            media_type="application/pdf",
            headers={
                "Content-Disposition": "attachment; filename=braking_report.pdf"
            }
        )
    except Exception as e:
        raise HTTPException(500, str(e))


# Endpoint to download braking DOCX report (detailed step-by-step)
@router.post("/braking_download_docx")
async def download_braking_docx(raw: BrakingInput):
    """Generate and download DOCX report with detailed step-by-step calculations"""
    try:
        inputs, _ = validate_braking_inputs(raw)
        results_rows, context = perform_braking_calculation(inputs)
        docx_stream = create_braking_docx_report(results_rows, context)
        return StreamingResponse(
            docx_stream,
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={
                "Content-Disposition": "attachment; filename=Braking_Report.docx"
            }
        )
    except Exception as e:
        raise HTTPException(500, str(e))