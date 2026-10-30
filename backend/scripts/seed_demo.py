"""Demo data in EVERY module, on the LOCAL dev database, linked end to end
along the core flow (Customer → BD → R&D → Design/E/H/P → BOM →
Store/Purchase → Production → QC → Dispatch → Commissioning → Machine →
Service → Finance, plus HR, Maintenance, PM and Organization).

Run from backend/:
    venv/Scripts/python.exe scripts/seed_demo.py                 # snapshot the DB, then seed every module
    venv/Scripts/python.exe scripts/seed_demo.py --only crm,rnd  # just these (and what they need first)
    venv/Scripts/python.exe scripts/seed_demo.py --dry-run       # run everything, roll it all back
    venv/Scripts/python.exe scripts/seed_demo.py --restore       # put the DB back to the pre-demo snapshot
    venv/Scripts/python.exe scripts/seed_demo.py --list          # seeders and what each one makes

Everything is labelled "DEMO"; demo people are demo.*@example.invalid (they
can't log in — the script acts for them). `--me` (default: first admin) is
your own account, made approver where a step is left for you to click.

Undo is by snapshot, not by deleting rows: demo data posts stock and ledger
entries, and unpicking those row by row is how books end up unbalanced. The
snapshot is a pg_dump in D:\\PremnathrailBackup\\dumps\\pre-demo-<time>.dump;
--restore loads the latest one (anything you entered after seeding is lost,
so it asks you to type the database name first).

Local only: refuses to run when DATABASE_URL isn't localhost. No email,
Teams or SharePoint call leaves the machine (see scripts/demo/_common.py).
"""
from __future__ import annotations

import argparse
import importlib
import os
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse, unquote

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))

from demo._common import Demo, guard_local_database  # noqa: E402

# Core-flow order: each seeder may use what the earlier ones put in demo.data.
SEEDERS = [
    "foundation",    # organization, demo people, products, store masters/items/stock, vendors, customers
    "crm",           # organizations, contacts, inquiries, tender, activities, TOR to R&D
    "rnd",           # R&D team, requirement work, technical offer, projects, experiments, prototypes
    "quotation",     # CRM quotation against the technical offer
    "design",        # design requests, BOM revisions, ECR/ECN, library
    "electrical",    # electrical jobs, panels, cables, drawings, tests
    "hydraulic",     # hydraulic systems, circuits, BOM, testing
    "p2p",           # PR → RFQ → PO → GRN (stock in)
    "store",         # issues, returns, transfers, reservations, adjustments, stock entries
    "quality",       # inspection plans, lots, NCR, CAPA, complaints
    "production",    # production BOM, workstations, work orders, RRV builds
    "projects",      # PM projects, WBS, tasks, documents
    "erp",           # machines / service projects, service requests, service material
    "maintenance",   # assets, PM plans, requests, work orders
    "hr",            # employees, leave, attendance, holidays, travel, expenses, assets, visitors
    "accounts",      # GL, vendor invoices, AR, payments, bank, journals
]
DUMPS = Path(r"D:\PremnathrailBackup\dumps")


def _pg_env(url: str) -> tuple[dict, list[str], str]:
    u = urlparse(url.replace("+psycopg2", "").replace("+psycopg", ""))
    env = {**os.environ, "PGPASSWORD": unquote(u.password or "")}
    args = ["-h", u.hostname or "localhost", "-p", str(u.port or 5432), "-U", unquote(u.username or "postgres")]
    return env, args, u.path.lstrip("/")


def _pg_bin(name: str) -> str:
    for root in sorted(Path(r"C:\Program Files\PostgreSQL").glob("*/bin"), reverse=True):
        exe = root / f"{name}.exe"
        if exe.exists():
            return str(exe)
    return name


def snapshot(url: str) -> Path:
    env, args, dbname = _pg_env(url)
    DUMPS.mkdir(parents=True, exist_ok=True)
    out = DUMPS / f"pre-demo-{dbname}-{datetime.now():%Y-%m-%d_%H-%M}.dump"
    print(f"Snapshot → {out}")
    subprocess.run([_pg_bin("pg_dump"), *args, "-Fc", "-f", str(out), dbname], env=env, check=True)
    return out


def restore(url: str) -> None:
    env, args, dbname = _pg_env(url)
    dumps = sorted(DUMPS.glob(f"pre-demo-{dbname}-*.dump"))
    if not dumps:
        raise SystemExit(f"No pre-demo snapshot of '{dbname}' in {DUMPS} — nothing to restore.")
    dump = dumps[-1]
    print(f"This replaces EVERYTHING in database '{dbname}' with the snapshot {dump.name}.\n"
          "Anything entered after that snapshot is lost (stop the backend first).")
    if input(f"Type the database name ({dbname}) to continue: ").strip() != dbname:
        raise SystemExit("Not restored.")
    subprocess.run([_pg_bin("pg_restore"), *args, "--clean", "--if-exists", "--no-owner", "-d", dbname, str(dump)], env=env, check=True)
    print(f"Restored '{dbname}' from {dump.name}.")


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--only", help="comma-separated seeders (the ones they depend on run first)")
    p.add_argument("--just", help="foundation + only these seeders (for developing one module in isolation)")
    p.add_argument("--me", help="your portal email (default: first active admin)")
    p.add_argument("--dry-run", action="store_true", help="seed inside one transaction and roll it back")
    p.add_argument("--restore", action="store_true", help="restore the latest pre-demo snapshot")
    p.add_argument("--no-snapshot", action="store_true", help="skip the pg_dump (not recommended)")
    p.add_argument("--list", action="store_true")
    a = p.parse_args()

    if a.list:
        for name in SEEDERS:
            if not (HERE / "demo" / f"seed_{name}.py").exists():
                print(f"{name:<12} (not written yet)")
                continue
            doc = (importlib.import_module(f"demo.seed_{name}").__doc__ or "").strip().splitlines()
            print(f"{name:<12} {doc[0] if doc else ''}")
        return

    url = guard_local_database()
    if a.restore:
        restore(url)
        return

    names = SEEDERS
    if a.only:
        wanted = {n.strip() for n in a.only.split(",") if n.strip()}
        unknown = wanted - set(SEEDERS)
        if unknown:
            raise SystemExit(f"Unknown seeder(s): {', '.join(sorted(unknown))}. Known: {', '.join(SEEDERS)}")
        last = max(SEEDERS.index(n) for n in wanted)
        names = SEEDERS[: last + 1]   # everything up to the last one asked for — they build on each other

    if a.just:
        wanted = {n.strip() for n in a.just.split(",") if n.strip()} | {"foundation"}
        unknown = wanted - set(SEEDERS)
        if unknown:
            raise SystemExit(f"Unknown seeder(s): {', '.join(sorted(unknown))}. Known: {', '.join(SEEDERS)}")
        names = [n for n in SEEDERS if n in wanted]

    if not a.dry_run and not a.no_snapshot:
        snapshot(url)

    from fastapi.testclient import TestClient
    from app.main import app
    from app.db.session import SessionLocal, engine, get_db
    from app.modules.main.models.user import User
    from demo._common import stub_side_effects

    sp = stub_side_effects()
    if a.dry_run:
        from sqlalchemy.orm import Session
        conn = engine.connect()
        outer = conn.begin()
        db = Session(bind=conn, join_transaction_mode="create_savepoint", autoflush=False)
        app.dependency_overrides[get_db] = lambda: db
    else:
        conn = outer = None
        db = SessionLocal()

    me = (db.query(User).filter(User.email == a.me).first() if a.me else
          db.query(User).filter(User.role == "admin", User.is_active == True, ~User.email.like("demo.%")).order_by(User.id).first())  # noqa: E712
    if not me:
        raise SystemExit(f"User {a.me!r} not found — pass --me with your portal email." if a.me else "No active admin user found — pass --me.")

    demo = Demo(db=db, client=TestClient(app), me=me, sp=sp)
    started = time.time()
    try:
        for name in names:
            print(f"\n== {name} ==")
            if not (HERE / "demo" / f"seed_{name}.py").exists():
                print("  (no seeder yet — skipped)")
                continue
            importlib.import_module(f"demo.seed_{name}").seed(demo)
            db.commit()
    finally:
        if a.dry_run:
            db.close()
            outer.rollback()
            conn.close()
            app.dependency_overrides.clear()
        else:
            db.close()

    print(f"\nDone in {time.time() - started:.0f}s — {len(demo.log)} demo steps across {len(names)} seeders.")
    print("Dry run: everything rolled back, nothing saved." if a.dry_run else
          "Undo with: venv/Scripts/python.exe scripts/seed_demo.py --restore")


if __name__ == "__main__":
    main()
