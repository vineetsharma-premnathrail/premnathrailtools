"""PEW project numbers continue the old machine series (PEW-78, PEW-79 ...), 2026-10-26."""
import importlib.util
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

from app.core.pew_numbers import next_pew_number, pew_base, pew_number_taken
from app.modules.erp.models.project import Project as Machine
from app.modules.projects.models.project import PmProject  # noqa: F401
from app.tests.test_cov_projects_lifecycle import API, auth, body, w  # noqa: F401


def _machines(db, *serials):
    for s in serials:
        db.add(Machine(serial_number=s))
    db.commit()


def test_pew_base_reads_digits_after_prefix():
    assert pew_base("PEW-17A") == 17 and pew_base("PEW-34-A1") == 34 and pew_base("PEW-40-01") == 40
    assert pew_base("PEW-D1") == 0 and pew_base("PEW-LTR-1") == 0 and pew_base(None) == 0
    assert pew_base("PEW-2026-0003") == 0  # old interim format, not a series number


def test_next_number_continues_machine_series(client, db):
    _machines(db, "PEW-17", "PEW-17A", "PEW-34-A1", "PEW-77-4", "PEW-LTR-1")
    assert next_pew_number(db) == "PEW-78"


def test_blank_pm_number_is_next_and_typed_is_checked(client, db, w):  # noqa: F811
    _machines(db, "PEW-40-01", "PEW-40-02", "PEW-77-1")
    h = auth(w["partner"])
    r = client.post(f"{API}/projects", headers=h, json=body(w["pm"].id, project_code=""))
    assert r.status_code == 200 and r.json()["project_code"] == "PEW-78"
    # next one continues from the PM project
    r = client.post(f"{API}/projects", headers=h, json=body(w["pm"].id, project_code=" "))
    assert r.json()["project_code"] == "PEW-79"
    # typed, free (lower case is turned to capitals)
    r = client.post(f"{API}/projects", headers=h, json=body(w["pm"].id, project_code=" pew-64a "))
    assert r.status_code == 200 and r.json()["project_code"] == "PEW-64A"
    # used by a PM project
    r = client.post(f"{API}/projects", headers=h, json=body(w["pm"].id, project_code="PEW-64A"))
    assert r.status_code == 409 and "already used by project" in r.json()["detail"] and "PEW-80" in r.json()["detail"]
    # used by machines, by prefix + "-"
    r = client.post(f"{API}/projects", headers=h, json=body(w["pm"].id, project_code="PEW-40"))
    assert r.status_code == 409
    d = r.json()["detail"]
    assert "past project machines PEW-40-01, PEW-40-02" in d and "leave it blank for the next free number PEW-80" in d
    # used by a machine serial exactly
    r = client.post(f"{API}/projects", headers=h, json=body(w["pm"].id, project_code="PEW-77-1"))
    assert r.status_code == 409 and "past project machine PEW-77-1" in r.json()["detail"]
    # PEW-4 is not "used" by PEW-40-01 (prefix needs the dash)
    assert pew_number_taken(db, "PEW-4") is None


def test_create_project_needs_permission(client, db, w):  # noqa: F811
    r = client.post(f"{API}/projects", headers=auth(w["noapp"]), json=body(w["pm"].id, project_code=""))
    assert r.status_code == 403


def _load_migration():
    p = Path(__file__).resolve().parents[2] / "alembic" / "versions" / "c4e8b2a6d9f1_pew_number_series_continues.py"
    spec = importlib.util.spec_from_file_location("pew_series_mig", p)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def test_migration_renumbers_old_format_with_undo_log():
    eng = sa.create_engine("sqlite://")
    with eng.begin() as conn:
        conn.execute(sa.text("CREATE TABLE erp_projects (id INTEGER PRIMARY KEY, serial_number TEXT)"))
        conn.execute(sa.text("CREATE TABLE pm_projects (id INTEGER PRIMARY KEY, project_code TEXT, created_at TIMESTAMP)"))
        conn.execute(sa.text("CREATE TABLE sales_order_projects (id INTEGER PRIMARY KEY, op_number TEXT, created_at TIMESTAMP)"))
        conn.execute(sa.text("CREATE TABLE sales_order_project_elements (id INTEGER PRIMARY KEY, order_project_id INTEGER, element_no TEXT)"))
        conn.execute(sa.text("INSERT INTO erp_projects (serial_number) VALUES ('PEW-77-1'), ('PEW-17A')"))
        conn.execute(sa.text("INSERT INTO pm_projects VALUES (1, 'PEW-2026-0001', '2026-10-01 10:00:00'), (2, 'PEW-64A', '2026-10-02 10:00:00')"))
        conn.execute(sa.text("INSERT INTO sales_order_projects VALUES (1, 'PEW-2026-0002', '2026-10-01 11:00:00'), (2, 'PEW-2026-0003', '2026-10-03 11:00:00')"))
        conn.execute(sa.text("INSERT INTO sales_order_project_elements VALUES (1, 1, 'PEW-2026-0002/01'), (2, 1, 'PEW-2026-0002/02'), (3, 2, 'PEW-2026-0003/01')"))
        mig = _load_migration()
        with Operations.context(MigrationContext.configure(conn)):
            mig.upgrade()
            val = lambda q: [r[0] for r in conn.execute(sa.text(q))]  # noqa: E731
            assert val("SELECT project_code FROM pm_projects ORDER BY id") == ["PEW-78", "PEW-64A"]  # typed one untouched
            assert val("SELECT op_number FROM sales_order_projects ORDER BY id") == ["PEW-79", "PEW-80"]
            assert val("SELECT element_no FROM sales_order_project_elements ORDER BY id") == ["PEW-79/01", "PEW-79/02", "PEW-80/01"]
            mig.downgrade()
            assert val("SELECT project_code FROM pm_projects ORDER BY id") == ["PEW-2026-0001", "PEW-64A"]
            assert val("SELECT op_number FROM sales_order_projects ORDER BY id") == ["PEW-2026-0002", "PEW-2026-0003"]
            assert val("SELECT element_no FROM sales_order_project_elements ORDER BY id") == ["PEW-2026-0002/01", "PEW-2026-0002/02", "PEW-2026-0003/01"]
            assert "pew_series_log" not in sa.inspect(conn).get_table_names()
