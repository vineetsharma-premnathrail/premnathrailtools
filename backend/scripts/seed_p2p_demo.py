"""Seed Procurement (P2P) demo data on the LOCAL dev database — PR create
through PO approval — so the whole flow can be clicked through in the UI.

Run from backend/:
    venv/Scripts/python.exe scripts/seed_p2p_demo.py            # create demo data
    venv/Scripts/python.exe scripts/seed_p2p_demo.py --cleanup  # remove it again
    venv/Scripts/python.exe scripts/seed_p2p_demo.py --me you@premnathrail.com   # who gets the PO-approver flag

What it creates (everything labelled "DEMO", users on @example.invalid):
  * 8 demo users — requester, the 4 PR approvers for an "existing project"
    PR (Design / Production / Project / Store Manager), a buyer, a Purchase
    Manager and a Director. They can't log in (SSO only); the script acts
    for them.
  * 5 demo PRs, one parked at each stage so every screen can be tested:
      A  submitted        — 2 of 4 approvals done, 2 pending
      B  approved         — ready for the buyer to start the RFQ
      C  vendor_quotations — RFQ locked, 3 vendor quotations recorded
      D  po_raised        — PO priced & submitted; Production Manager,
                            Project Manager and Director have approved, only
                            the Purchase Manager (`--me`) is left
      E  po_approved      — all 4 PO approvals done, ready for GRN
  * PO approval for an "existing project" PR needs ALL of Production Manager,
    Purchase Manager, Project Manager (picked on the RFQ page) + any one
    Director — the same rule the GRN screen checks before it lists a PO.
  * `--me` (default: first admin) is given is_purchase_manager and picked as
    PR D's Purchase Manager PO approver, so their approval in the UI is the
    final one — they are neither its requester nor its buyer.

Side effects are stubbed: no Teams pushes, no approval emails, and RFQ
quotation files are recorded as placeholders instead of being uploaded to
the company SharePoint (opening those two demo files will say not found).
"""
import argparse
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

DEMO_DOMAIN = "example.invalid"
LABEL_PREFIX = "DEMO"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--cleanup", action="store_true", help="delete all demo P2P data and demo users")
    parser.add_argument("--me", help="email of the real user who should approve PR D's PO in the UI")
    parser.add_argument("--dry-run", action="store_true", help="run the whole seed inside one transaction and roll it back")
    args = parser.parse_args()

    # --- stub every outward side effect before the app is imported ---------
    import app.utils.notifications as notifications
    notifications._notify_teams = lambda *a, **k: None

    from fastapi.testclient import TestClient
    from sqlalchemy import text
    from app.main import app
    from app.db.session import SessionLocal
    from app.auth.jwt_handler import create_access_token
    from app.core.config import settings
    from app.middleware.owasp import RATE_CONFIG
    from app.modules.main.models.user import User
    import app.modules.p2p.routes.p2p_requests as pr_routes
    import app.modules.p2p.routes.rfq as rfq_routes

    async def _no_email(*_a, **_k):
        return None

    async def _placeholder_upload(site_id, folder_path, upload_file):
        data = upload_file.file.read()
        return {"name": upload_file.filename, "path": f"DEMO-placeholder/{upload_file.filename}", "webUrl": None, "size": len(data)}

    pr_routes._send_p2p_pr_approval_emails_background = _no_email
    pr_routes._send_p2p_po_approval_emails_background = _no_email
    rfq_routes.upload_file_to_sharepoint = _placeholder_upload
    settings.SHAREPOINT_SITE_ID = settings.SHAREPOINT_SITE_ID or "demo"
    RATE_CONFIG["write"]["limit"] = RATE_CONFIG["delete"]["limit"] = 100000

    if args.dry_run:
        from sqlalchemy.orm import Session
        from app.db.session import engine, get_db
        conn = engine.connect()
        outer = conn.begin()
        db = Session(bind=conn, join_transaction_mode="create_savepoint", autoflush=False)
        app.dependency_overrides[get_db] = lambda: db
    else:
        db = SessionLocal()
    try:
        _run(args, db, app, text, User, TestClient, create_access_token)
    finally:
        if args.dry_run:
            db.close()
            outer.rollback()
            conn.close()
            app.dependency_overrides.clear()
            print("\n(dry run — everything rolled back, nothing saved)")
        else:
            db.close()


def _run(args, db, app, text, User, TestClient, create_access_token) -> None:
    if args.cleanup:
        cleanup(db, text)
        return

    if db.query(User).filter(User.email == f"demo.requester@{DEMO_DOMAIN}").first():
        print("Demo data already exists. Run with --cleanup first if you want a fresh set.")
        return

    me = db.query(User).filter(User.email == args.me).first() if args.me else \
        db.query(User).filter(User.role == "admin", User.is_active == True).order_by(User.id).first()  # noqa: E712
    if not me:
        sys.exit(f"User {args.me!r} not found — pass --me with your portal email.")

    def mk(slug, name, apps, **flags):
        u = User(email=f"demo.{slug}@{DEMO_DOMAIN}", name=f"{LABEL_PREFIX} {name}", role="user", is_active=True,
                 assigned_apps=list(apps), department="DEMO", designation=f"{LABEL_PREFIX} {name}")
        for flag, value in flags.items():
            setattr(u, flag, value)
        db.add(u)
        db.commit()
        db.refresh(u)
        return u

    people = {
        "requester": mk("requester", "Requester (Maintenance Engineer)", ["p2p"]),
        "design": mk("design.manager", "Design Manager", ["p2p"], is_design_manager=True),
        "production": mk("production.manager", "Production Manager", ["p2p"], is_production_manager=True),
        "project": mk("project.manager", "Project Manager", ["p2p"], is_project_manager=True),
        "store": mk("store.manager", "Store Manager", ["p2p"], is_store_manager=True),
        "buyer": mk("buyer", "Buyer (Purchase Team)", ["p2p", "purchase"]),
        "purchase_mgr": mk("purchase.manager", "Purchase Manager", ["p2p"], is_purchase_manager=True),
        "director": mk("director", "Director", ["p2p"], is_director=True),
    }
    me.is_purchase_manager = True
    db.commit()

    client = TestClient(app)

    def h(user):
        return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id), 'email': user.email, 'role': user.role})}"}

    def call(method, url, user, **kw):
        r = client.request(method, f"/api/v1{url}", headers=h(user), **kw)
        if r.status_code >= 400:
            raise SystemExit(f"{method} {url} as {user.email} failed ({r.status_code}): {r.text[:500]}")
        return r.json()

    approvers = {"design_manager": people["design"].id, "production_manager": people["production"].id,
                 "project_manager": people["project"].id, "store_manager": people["store"].id}
    today = date.today()

    def new_pr(letter, title, items):
        return call("POST", "/p2p/requests", people["requester"], json={
            "project_label": f"{LABEL_PREFIX} {letter} — {title}", "project_type": "existing", "category_code": "OTH",
            "requirement_type": "Material", "priority": "medium", "required_date": str(today + timedelta(days=21)),
            "approvers": approvers, "remarks": f"{LABEL_PREFIX} data — safe to delete (scripts/seed_p2p_demo.py --cleanup).",
            "items": items,
        })

    def approve_all(pr, roles=("design", "production", "project", "store")):
        for key in roles:
            pr = call("POST", f"/p2p/requests/{pr['id']}/approve", people[key], json={"comment": "Approved (demo)"})
        return pr

    def to_quotations(pr):
        buyer = people["buyer"]
        call("POST", f"/p2p/requests/{pr['id']}/assign-buyer", buyer, json={"assigned_buyer_id": buyer.id})
        rfq = call("POST", "/p2p/rfqs", buyer, json={"p2p_request_id": pr["id"], "requires_technical_evaluation": False})
        for tier, vendor in (("L1", "DEMO Hydro Seals Pvt Ltd"), ("L2", "DEMO Fluid Power Traders")):
            call("POST", f"/p2p/rfqs/{rfq['id']}/attachments", buyer,
                 data={"vendor_tier": tier, "vendor_name": vendor},
                 files=[("files", (f"{tier}-quotation.pdf", b"%PDF-1.4 demo quotation placeholder", "application/pdf"))])
        call("PATCH", f"/p2p/rfqs/{rfq['id']}", buyer, json={
            "payment_terms": "30 days from receipt", "delivery_lead_time": "3 weeks",
            "late_delivery_clause": "0.5% per week, max 5%", "comments": "Two quotations compared (demo).",
        })
        call("POST", f"/p2p/rfqs/{rfq['id']}/submit", buyer)
        quotes = [
            call("POST", f"/p2p/rfqs/{rfq['id']}/vendor-quotations", buyer, json={"vendor_name": name, "quoted_price": price, "delivery_time": dt, "payment_terms": "30 days"})
            for name, price, dt in (("DEMO Hydro Seals Pvt Ltd", 48500, "3 weeks"), ("DEMO Fluid Power Traders", 51200, "2 weeks"), ("DEMO Rail Spares Co", 55900, "4 weeks"))
        ]
        return rfq, quotes

    def to_po_raised(pr, po_no, purchase_mgr):
        rfq, quotes = to_quotations(pr)
        buyer = people["buyer"]
        call("POST", f"/p2p/rfqs/{rfq['id']}/start-commercial-evaluation", buyer)
        for vq, status in zip(quotes, ("approved", "approved", "rejected")):
            call("POST", f"/p2p/rfqs/{rfq['id']}/vendor-quotations/{vq['id']}/commercial-evaluation", buyer, json={"status": status, "remarks": "demo evaluation"})
        call("POST", f"/p2p/rfqs/{rfq['id']}/select-vendor-quotation", buyer, json={"vendor_quotation_id": quotes[0]["id"]})
        po = call("POST", f"/p2p/rfqs/{rfq['id']}/po-draft", buyer, json={
            "p2p_request_id": pr["id"], "po_number": po_no, "po_date": str(today), "expected_delivery": str(today + timedelta(days=21)),
            "delivery_terms": "Door delivery, Faridabad plant",
        })
        prices = [1850.0, 320.0, 95.0, 2400.0]
        call("PATCH", f"/p2p/rfqs/{rfq['id']}/po-draft/{po['id']}", buyer, json={
            "items": [{"id": it["id"], "unit_price": prices[i % len(prices)], "tax_rate": 18} for i, it in enumerate(po["items"])],
        })
        # PO approvers are picked on the RFQ page, before the PO is raised.
        call("POST", f"/p2p/requests/{pr['id']}/set-po-approvers", buyer, json={"po_approvers": {
            "production_manager": people["production"].id, "purchase_manager": purchase_mgr.id, "project_manager": people["project"].id,
        }})
        call("POST", f"/p2p/rfqs/{rfq['id']}/po-draft/{po['id']}/submit", buyer)
        return call("GET", f"/p2p/requests/{pr['id']}", buyer)

    def approve_po(pr, roles):
        for key in roles:
            row = call("POST", f"/p2p/requests/{pr['id']}/approve-po", people[key], json={"comment": "Approved (demo)"})
        return row

    hyd_items = [
        {"item_name": "DEMO Hydraulic hose assembly 1/2in x 1.5m", "make": "Parker", "part_code": "DEMO-HH-12-150", "unit": "Nos", "quantity": 12, "ship_to": "Faridabad plant", "project_inhouse": "Project"},
        {"item_name": "DEMO O-ring kit (NBR, metric)", "make": "Trelleborg", "part_code": "DEMO-OR-KIT", "unit": "Set", "quantity": 4, "ship_to": "Faridabad plant", "project_inhouse": "Project"},
    ]
    elec_items = [
        {"item_name": "DEMO Proximity sensor M18 PNP", "make": "Pepperl+Fuchs", "part_code": "DEMO-PX-M18", "unit": "Nos", "quantity": 6, "ship_to": "Faridabad plant", "project_inhouse": "Project"},
        {"item_name": "DEMO Relay 24VDC 2CO", "make": "Finder", "part_code": "DEMO-RL-24", "unit": "Nos", "quantity": 20, "ship_to": "Faridabad plant", "project_inhouse": "Project"},
    ]

    created = {}
    pr = new_pr("A", "Awaiting PR approval", hyd_items)
    created["A"] = approve_all(pr, roles=("design", "production"))
    created["B"] = approve_all(new_pr("B", "Approved, ready for RFQ", elec_items))
    pr = approve_all(new_pr("C", "Quotations received, ready for evaluation", hyd_items))
    to_quotations(pr)
    created["C"] = call("GET", f"/p2p/requests/{pr['id']}", people["buyer"])
    pr = approve_all(new_pr("D", "PO raised, awaiting PO approval", hyd_items))
    to_po_raised(pr, f"DEMO-PO-{today:%y%m%d}-D", me)
    created["D"] = approve_po(pr, ("production", "project", "director"))
    pr = approve_all(new_pr("E", "PO approved (complete reference)", elec_items))
    to_po_raised(pr, f"DEMO-PO-{today:%y%m%d}-E", people["purchase_mgr"])
    created["E"] = approve_po(pr, ("production", "purchase_mgr", "project", "director"))

    print("\nDemo P2P data created:")
    for letter, row in created.items():
        print(f"  {letter}  {row['p2p_number']:<22} status={row['status']:<18} {row['project_label']}")
    print(f"\n{me.email} now has is_purchase_manager = True and is PR D's Purchase Manager PO approver (the last approval left).")
    print("Remove everything with: venv/Scripts/python.exe scripts/seed_p2p_demo.py --cleanup")
    if args.dry_run:
        # Prove the teardown works too, inside the same rolled-back transaction.
        cleanup(db, text)


def cleanup(db, text) -> None:
    """Delete demo PRs (and their RFQs, quotations, POs, approvals, audit)
    and the demo users. Rows are selected ONLY through the demo users
    (demo.*@example.invalid) — never by label, because real people also use
    "DEMO" in project labels — so real data can't be touched."""
    from sqlalchemy import bindparam

    def q(sql, **lists):
        stmt = text(sql).bindparams(*[bindparam(k, expanding=True) for k in lists])
        return db.execute(stmt, {k: (v or [0]) for k, v in lists.items()})

    users = [r[0] for r in db.execute(text(f"SELECT id FROM users WHERE email LIKE 'demo.%@{DEMO_DOMAIN}'")).all()]
    if not users:
        print("No demo data found.")
        return
    ids = [r[0] for r in q("SELECT id FROM p2p_requests WHERE requested_by_id IN :users", users=users).all()]
    rfqs = [r[0] for r in q("SELECT id FROM rfqs WHERE p2p_request_id IN :ids", ids=ids).all()]
    pos = [r[0] for r in q("SELECT id FROM p2p_purchase_orders WHERE p2p_request_id IN :ids", ids=ids).all()]

    # Stock and finance entries hang off GRNs / invoices — deleting those
    # would leave the Store ledger or AP inconsistent, so stop instead.
    downstream = []
    for table, col, key, vals in (("p2p_goods_receipts", "purchase_order_id", "pos", pos), ("vendor_invoices", "purchase_order_id", "pos", pos),
                                  ("quality_inspections", "p2p_request_id", "ids", ids), ("store_material_issues", "p2p_request_id", "ids", ids)):
        n = q(f"SELECT count(*) FROM {table} WHERE {col} IN :{key}", **{key: vals}).scalar()
        if n:
            downstream.append(f"{n} {table}")
    if downstream:
        raise SystemExit(
            "Not cleaning up: the demo POs/PRs already have " + ", ".join(downstream) + " (GRN / invoice / stock / inspection records). "
            "Deleting them here would unbalance stock or accounts — reverse those in their own modules first, then re-run --cleanup."
        )

    q("DELETE FROM p2p_purchase_order_items WHERE purchase_order_id IN :pos", pos=pos)
    q("DELETE FROM p2p_purchase_orders WHERE id IN :pos", pos=pos)
    q("DELETE FROM p2p_vendor_quotations WHERE rfq_id IN :rfqs OR p2p_request_id IN :ids", rfqs=rfqs, ids=ids)
    q("DELETE FROM rfq_attachments WHERE rfq_id IN :rfqs", rfqs=rfqs)
    q("DELETE FROM rfqs WHERE id IN :rfqs", rfqs=rfqs)
    q("DELETE FROM p2p_request_approvals WHERE p2p_request_id IN :ids", ids=ids)
    q("DELETE FROM p2p_request_po_approvers WHERE p2p_request_id IN :ids", ids=ids)
    q("DELETE FROM p2p_request_attachments WHERE p2p_request_id IN :ids", ids=ids)
    q("DELETE FROM p2p_request_items WHERE p2p_request_id IN :ids", ids=ids)
    q("DELETE FROM audit_logs WHERE (entity_type = 'p2p_request' AND entity_id IN :ids) OR (entity_type = 'rfq' AND entity_id IN :rfqs)", ids=ids, rfqs=rfqs)
    q("DELETE FROM notifications WHERE user_id IN :users OR (entity_type = 'p2p_request' AND entity_id IN :ids)", users=users, ids=ids)
    q("DELETE FROM p2p_requests WHERE id IN :ids", ids=ids)
    q("DELETE FROM users WHERE id IN :users", users=users)
    db.commit()
    print(f"Removed {len(ids)} demo PR(s), {len(rfqs)} RFQ(s), {len(pos)} PO(s) and {len(users)} demo user(s).")
    print("Note: the is_purchase_manager flag given to your own account was left as is — untick it in Users & Roles if you don't want it.")

if __name__ == "__main__":
    main()
