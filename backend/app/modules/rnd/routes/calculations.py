from fastapi import APIRouter, Depends

from app.core.permissions import require_app_access, require_tab_access
from app.modules.rnd.tools.braking.api import router as braking_router
from app.modules.rnd.tools.hydraulic.api import router as hydraulic_router
from app.modules.rnd.tools.qmax.api import router as qmax_router
from app.modules.rnd.tools.load_distribution.api import router as load_distribution_router
from app.modules.rnd.tools.tractive_effort.api import router as tractive_effort_router
from app.modules.rnd.tools.vehicle_performance.api import router as vehicle_performance_router
from app.modules.rnd.tools.spline.api import router as spline_router

# All RnD calculation tools require authenticated access to the "rnd" app,
# and each tool is gated on its own Permission Matrix subtab (opt-in: users
# the matrix never touched keep access). /history/save is not gated here —
# every tool auto-saves into it.
router = APIRouter(dependencies=[Depends(require_app_access("rnd"))])

router.include_router(braking_router, prefix="/tools/braking", dependencies=[Depends(require_tab_access("rnd", "braking"))])
router.include_router(hydraulic_router, prefix="/tools/hydraulic", dependencies=[Depends(require_tab_access("rnd", "hydraulic"))])
router.include_router(qmax_router, prefix="/tools/qmax", dependencies=[Depends(require_tab_access("rnd", "qmax"))])
router.include_router(load_distribution_router, prefix="/tools/load-distribution", dependencies=[Depends(require_tab_access("rnd", "load_distribution"))])
router.include_router(tractive_effort_router, prefix="/tools/tractive-effort", dependencies=[Depends(require_tab_access("rnd", "tractive_effort"))])
router.include_router(vehicle_performance_router, prefix="/tools/vehicle-performance", dependencies=[Depends(require_tab_access("rnd", "vehicle_performance"))])
router.include_router(spline_router, prefix="/tools/spline", dependencies=[Depends(require_tab_access("rnd", "spline"))])
