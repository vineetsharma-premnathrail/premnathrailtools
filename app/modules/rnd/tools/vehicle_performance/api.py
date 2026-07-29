# Vehicle Performance Tool API Router
# FastAPI router for vehicle performance endpoints

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from typing import Dict, Any
from .schemas import VehiclePerformanceInput
from .validation import validate_vehicle_performance_inputs
from .service import VehiclePerformanceCalculator
from .reports.pdf_builder import create_vehicle_performance_docx_report

router = APIRouter(tags=["vehicle-performance"])

@router.post("/calculate")
async def calculate_vehicle_performance(raw_input: VehiclePerformanceInput) -> Dict[str, Any]:
    try:
        inputs, _ = validate_vehicle_performance_inputs(raw_input)
        calculator = VehiclePerformanceCalculator(inputs)

        plot_data = calculator.calculate_plot_data()
        results: Dict[str, Any] = {
            'traction_snapshot': calculator.run_tractive_calculation(),
            'tractive_effort_graph': plot_data['tractive_effort_plot'],
            'shunting_capability_graph': plot_data['shunting_capability_plot'],
            'speed_vs_slope_table': calculator.calculate_speed_for_shunting_load()
        }

        return results
    except Exception as e:
        import traceback
        print(f"Vehicle Performance Calculation Error: {str(e)}")
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/download-report")
async def download_vehicle_performance_report(raw_input: VehiclePerformanceInput):
    try:
        inputs, _ = validate_vehicle_performance_inputs(raw_input)
        calculator = VehiclePerformanceCalculator(inputs)

        results: Dict[str, Any] = {
            'traction_snapshot': calculator.run_tractive_calculation(),
            'plot_data': calculator.calculate_plot_data(),
            'speed_slope_table': calculator.calculate_speed_for_shunting_load()
        }

        stream = create_vehicle_performance_docx_report(inputs, results)

        return StreamingResponse(
            stream,
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={"Content-Disposition": "attachment; filename=Performance_Report.docx"}
        )
    except Exception as e:
        import traceback
        print(f"Vehicle Performance Report Error: {str(e)}")
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))
