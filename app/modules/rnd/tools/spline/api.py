from fastapi import APIRouter, Request, Depends, Response
from fastapi.responses import StreamingResponse, RedirectResponse

from . import core, validation
from .schemas import SplineInput
from .docx_builder import create_spline_docx
from app.services.pdf_service import PdfService

router = APIRouter(tags=["spline"])


@router.get("/")
def spline_page(request: Request):
    # redirect to static html page
    return RedirectResponse(url="/spline_calculator.html")


@router.post("/calculate")
def calculate(data: SplineInput):
    print('calculate endpoint called, raw input=', data)
    result = core.calculate_spline_mode(data.dict())
    print('calculate result', result)
    return result


@router.post("/report")
def report(data: SplineInput):
    print('report endpoint invoked')
    try:
        print('calculating results...')
        result = core.calculate_spline_mode(data.dict())
        print('calculation finished')
        # build PDF with PdfService and custom template
        pdf_buffer = PdfService().create_pdf(
            template_name="spline_template.tex",
            context={"data": data.dict(), "result": result},
            filename="spline_report.pdf",
        )
        print('pdf buffer obtained, size', pdf_buffer.getbuffer().nbytes)
        pdf_bytes = pdf_buffer.getvalue()
        print('pdf bytes length', len(pdf_bytes))
        from fastapi.responses import Response
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": "attachment; filename=spline_report.pdf"},
        )
    except Exception as outer:
        print('error in report handler', outer)
        import traceback
        traceback.print_exc()
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=500, content={"error": str(outer)})


@router.post("/docx")
def docx_report(data: SplineInput):
    print('docx report endpoint invoked')
    try:
        result = core.calculate_spline_mode(data.dict())
        buf = create_spline_docx(data.dict(), result)
        from fastapi.responses import Response as FastResponse
        return FastResponse(
            content=buf.getvalue(),
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={"Content-Disposition": "attachment; filename=spline_report.docx"},
        )
    except Exception as outer:
        print('error in docx handler', outer)
        import traceback
        traceback.print_exc()
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=500, content={"error": str(outer)})
