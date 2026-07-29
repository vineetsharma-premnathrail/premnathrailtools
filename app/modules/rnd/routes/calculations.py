from fastapi import APIRouter, Depends

from app.core.permissions import require_app_access
from app.modules.rnd.tools.braking.api import router as braking_router
from app.modules.rnd.tools.hydraulic.api import router as hydraulic_router
from app.modules.rnd.tools.qmax.api import router as qmax_router
from app.modules.rnd.tools.load_distribution.api import router as load_distribution_router
from app.modules.rnd.tools.tractive_effort.api import router as tractive_effort_router
from app.modules.rnd.tools.vehicle_performance.api import router as vehicle_performance_router
from app.modules.rnd.tools.spline.api import router as spline_router

# All RnD calculation tools require authenticated access to the "rnd" app.
router = APIRouter(dependencies=[Depends(require_app_access("rnd"))])

router.include_router(braking_router, prefix="/tools/braking")
router.include_router(hydraulic_router, prefix="/tools/hydraulic")
router.include_router(qmax_router, prefix="/tools/qmax")
router.include_router(load_distribution_router, prefix="/tools/load-distribution")
router.include_router(tractive_effort_router, prefix="/tools/tractive-effort")
router.include_router(vehicle_performance_router, prefix="/tools/vehicle-performance")
router.include_router(spline_router, prefix="/tools/spline")
