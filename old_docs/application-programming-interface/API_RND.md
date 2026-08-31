# API — R&D Module (`app/modules/rnd`)

**Correction vs. the previous draft of this doc:** the old `API.md` stated RnD tools
were "not yet ported to this rebuild" and only scaffolding existed. That is no longer
accurate (or was never accurate at the time of writing) — `rnd_calculations_routes` and
`rnd_history_routes` are both wired into `app/main.py`
(`app.include_router(rnd_calculations_routes.router, prefix="/api/v1/rnd")` etc.), and
all seven calculation tools plus the history log have real, implemented routes with
handler bodies (not stubs). Treat this file as current, not the old claim.

All routes require `require_app_access("rnd")` — for the calculation-tool routes this is
applied once, at the parent router level
(`APIRouter(dependencies=[Depends(require_app_access("rnd"))])` in
`routes/calculations.py`), rather than per-route.

## Calculation tools (`routes/calculations.py` mounts 7 per-tool sub-routers under `/rnd/tools/<tool>`)

Final paths are `/api/v1/rnd/tools/<tool>/...` (module prefix `/api/v1/rnd` + this
router's own `/tools/<tool>` + the sub-router's route path). Note the paths are **not
uniform** across tools — some repeat the tool name in the path segment, some don't:

```
POST /rnd/tools/braking/braking_calculate
POST /rnd/tools/braking/braking_report_pdf
POST /rnd/tools/braking/braking_download_docx

POST /rnd/tools/hydraulic/calculate
POST /rnd/tools/hydraulic/download-report
POST /rnd/tools/hydraulic/hydraulic_report_pdf

POST /rnd/tools/load-distribution/calculate
POST /rnd/tools/load-distribution/download-report

POST /rnd/tools/qmax/calculate
POST /rnd/tools/qmax/download-report

GET  /rnd/tools/spline/
POST /rnd/tools/spline/calculate
POST /rnd/tools/spline/report
POST /rnd/tools/spline/docx

POST /rnd/tools/tractive-effort/calculate
POST /rnd/tools/tractive-effort/download-report

POST /rnd/tools/vehicle-performance/calculate
POST /rnd/tools/vehicle-performance/download-report
```

**Note:** the previous doc's guess at a uniform `/rnd/{tool}_calculate`,
`/rnd/{tool}_report_pdf`, `/rnd/{tool}_download_docx` pattern across all seven tools is
incorrect — only `braking` actually uses that naming; the other six use `/calculate` +
either `/download-report` or (hydraulic) an extra `_report_pdf` route, and spline has
three distinctly-named routes (`/calculate`, `/report`, `/docx`) plus a bare `GET /`.
Each tool's request/response schemas live in
`app/modules/rnd/tools/<tool>/schemas.py` (not individually catalogued here — read the
specific tool's `api.py`/`schemas.py` for exact field shapes).

## Calculation history (`routes/history.py`, prefix `/history`) — 7 routes, final path `/api/v1/rnd/history/...`

```
POST   /rnd/history/save                    Save a named calculation result for the caller.
GET    /rnd/history/list                    Caller's own saved calculations only.
GET    /rnd/history/admin/list              All users' saved calculations. Admin-only (local
                                             require_admin — 403 otherwise).
GET    /rnd/history/admin/users             Distinct users who have saved calculations. Admin-only.
GET    /rnd/history/detail/{calc_id}        404 if missing; 403 if not owner and not admin.
PATCH  /rnd/history/rename/{calc_id}        (also registered as PUT — both methods route to the same handler)
DELETE /rnd/history/delete/{calc_id}        404/403 as above.
```
Every calculation-save route snapshots the specific tool's input/output via
`_snapshot_tool_calculation()`, so history entries carry enough detail to reconstruct a
past run's inputs, not just its outputs.

---

**Module endpoint count: 24** (17 across the 7 calculation-tool sub-routers + 7 history
routes).
