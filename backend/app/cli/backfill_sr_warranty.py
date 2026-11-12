"""One-time: run the warranty check on service requests that never had one.

Imported SRs (and SRs raised before the check existed) have no warranty status,
so the Warranty card shows "Not checked". This fills it for the SR's reported
date, using erp.warranty.fill_unchecked (same rules as a newly raised SR).

Safe to run again: only SRs whose warranty status is still empty are touched.
Free / chargeable is not changed where an invoice exists or someone set it by
hand with a reason. Every changed SR gets an Audit Trail entry ("System").

    python -m app.cli.backfill_sr_warranty            # dry run, prints what would change
    python -m app.cli.backfill_sr_warranty --apply    # writes
"""
from __future__ import annotations

import sys
from collections import Counter

import app.main  # noqa: F401,E402 — registers every model so relationships resolve
from app.db.session import SessionLocal  # noqa: E402
from app.modules.erp import warranty  # noqa: E402
from app.modules.erp.models.project import Project  # noqa: E402
from app.modules.erp.models.service_request import ServiceRequest  # noqa: E402
from app.modules.main.models.audit_log import AuditLog  # noqa: E402


def main(apply: bool) -> None:
    db = SessionLocal()
    try:
        srs = db.query(ServiceRequest).filter(
            ServiceRequest.warranty_status.is_(None), ServiceRequest.project_id.isnot(None),
        ).order_by(ServiceRequest.id.asc()).all()
        cover, flips = Counter(), 0
        for sr in srs:
            project = db.get(Project, sr.project_id)
            if project is None:
                continue
            before = sr.is_chargeable
            note = warranty.fill_unchecked(db, sr, project)
            cover[sr.warranty_status] += 1
            if before != sr.is_chargeable:
                flips += 1
            print(f"{sr.request_number}: {note}" + (f"  [chargeable {before} -> {sr.is_chargeable}]" if before != sr.is_chargeable else ""))
            db.add(AuditLog(entity_type="service_request", entity_id=sr.id, action="warranty_checked",
                            summary=note, performed_by_id=None))
        print(f"\n{len(srs)} SR(s) without a warranty check. Cover: {dict(cover)}. Free/chargeable changed on {flips}.")
        if apply:
            db.commit()
            print("Saved.")
        else:
            db.rollback()
            print("Dry run — nothing saved. Run with --apply to save.")
    finally:
        db.close()


if __name__ == "__main__":
    main("--apply" in sys.argv)
