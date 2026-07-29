# Hydraulic Tool API Router

import logging
from typing import Mapping, Any
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import ValidationError
from .schemas import HydraulicInput
from .validation import validate_hydraulic_inputs
from .service import perform_hydraulic_calculation
from .reports.pdf_builder import create_hydraulic_docx_report, generate_hydraulic_pdf_report

logger = logging.getLogger("engineering_tools")
router = APIRouter()

@router.post("/calculate")
async def calculate_hydraulic(raw: Mapping[str, Any]) -> dict[str, Any]:
    """Calculate hydraulic motor/pump parameters"""
    # Construct the Pydantic model here so we can log validation errors with details
    try:
        if hasattr(HydraulicInput, 'model_validate'):
            # Pydantic v2: model_validate accepts Mapping and returns a model instance
            model = HydraulicInput.model_validate(raw)
        else:
            model = HydraulicInput(**raw)  # pydantic v1
    except ValidationError as ve:
        try:
            keys = list(raw.keys())
        except Exception:
            keys = None
        logger.warning("Hydraulic input validation failed: %s; payload keys: %s", ve, keys)
        # Re-raise as 422 with the validation info for client visibility
        raise HTTPException(status_code=422, detail=str(ve))
    except Exception as e:
        logger.exception("Unexpected error while validating hydraulic input")
        raise HTTPException(status_code=400, detail=str(e))

    try:
        inputs, inputs_raw = validate_hydraulic_inputs(model)
        results, report = perform_hydraulic_calculation(inputs, inputs_raw)
        return {"report": report, "results": results}
    except ValueError as e:
        # Input-related error — return 400 so client receives a clear validation response
        logger.warning("Validation error during hydraulic calculation: %s", e)
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("Error during hydraulic calculation")
        raise HTTPException(500, str(e))

@router.post("/download-report")
async def download_hydraulic_report(raw: Mapping[str, Any]):
    """Download hydraulic calculation report as DOCX"""
    try:
        if hasattr(HydraulicInput, 'model_validate'):
            model = HydraulicInput.model_validate(raw)
        else:
            model = HydraulicInput(**raw)
    except ValidationError as ve:
        try:
            keys = list(raw.keys())
        except Exception:
            keys = None
        logger.warning("Hydraulic input validation failed for download: %s; payload keys: %s", ve, keys)
        raise HTTPException(status_code=422, detail=str(ve))
    except Exception as e:
        logger.exception("Unexpected error while validating hydraulic input for download")
        raise HTTPException(status_code=400, detail=str(e))

    try:
        inputs, inputs_raw = validate_hydraulic_inputs(model)
        results, _ = perform_hydraulic_calculation(inputs, inputs_raw)
        stream = create_hydraulic_docx_report(inputs, results, inputs_raw)
        # Use doc_no for filename when provided
        raw_docno = (inputs_raw or {}).get('doc_no') or 'Hydraulic_Report'
        safe_name = str(raw_docno).replace(' ', '_').replace('/', '_')
        filename = f"{safe_name}.docx" if safe_name else "Hydraulic_Report.docx"
        return StreamingResponse(
            stream,
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )
    except ValueError as e:
        logger.warning("Validation error generating hydraulic report: %s", e)
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("Error generating hydraulic report")
        raise HTTPException(500, str(e))


@router.post("/hydraulic_report_pdf")
async def download_hydraulic_pdf(raw: Mapping[str, Any]):
    """Generate and download a PDF report (LaTeX -> PDF) for Pump & Motor (cc) calculations"""
    try:
        if hasattr(HydraulicInput, 'model_validate'):
            model = HydraulicInput.model_validate(raw)
        else:
            model = HydraulicInput(**raw)
    except ValidationError as ve:
        try:
            keys = list(raw.keys())
        except Exception:
            keys = None
        logger.warning("Hydraulic input validation failed for PDF: %s; payload keys: %s", ve, keys)
        raise HTTPException(status_code=422, detail=str(ve))
    except Exception as e:
        logger.exception("Unexpected error while validating hydraulic input for PDF")
        raise HTTPException(status_code=400, detail=str(e))

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
        # include optional metadata from the incoming payload (if provided)
        for meta in ('doc_no', 'made_by', 'checked_by', 'approved_by', 'doc_date'):
            if raw.get(meta):
                context[meta] = raw.get(meta)

        pdf_stream = generate_hydraulic_pdf_report(context)
        fname = str(context.get('doc_no') or 'Hydraulic_Report').replace(' ', '_').replace('/', '_') + '.pdf'
        return StreamingResponse(
            pdf_stream,
            media_type='application/pdf',
            headers={'Content-Disposition': f'attachment; filename={fname}'}
        )
    except ValueError as e:
        logger.warning('Validation error generating hydraulic PDF: %s', e)
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        import traceback, os
        logger.exception('Error generating hydraulic PDF report')
        # Write diagnostic to file so we can retrieve the traceback without access to uvicorn stdout
        try:
            _log_dir = os.path.join(os.path.dirname(__file__), '..', '..', '..', '..', '..', '..', 'logs')
            os.makedirs(_log_dir, exist_ok=True)
            _log_path = os.path.join(_log_dir, 'pdf_error.log')
            with open(_log_path, 'a', encoding='utf-8') as _f:
                import datetime
                _f.write(f"\n[{datetime.datetime.now().isoformat()}] PDF 500\n")
                _f.write(traceback.format_exc())
                _f.write(f"raw keys: {list(raw.keys()) if raw else 'n/a'}\n")
        except Exception:
            pass
        raise HTTPException(500, str(e))