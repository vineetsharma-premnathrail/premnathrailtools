"""Company delete rule in the engineering / shop-floor modules: deleting
needs 'Delete' on the tab AND the record must be your own (admins delete
anything). Users here are built WITHOUT assigned_apps, so they get the real
deny-by-default behaviour from their granular grants alone."""
from app.auth.jwt_handler import create_access_token
from app.modules.hydraulic.models.calculation import HydCalculation
from app.modules.main.models.user import User
from app.modules.production.models.workstation import ProductionWorkstation
from app.modules.quality.models.quality_standard import QualityStandard

API = "/api/v1"


def _user(db, email, grants, role="user"):
    u = User(email=email, name=email.split("@")[0], role=role, is_active=True, granular_permissions=grants)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _h(user):
    token = create_access_token({"sub": str(user.id), "email": user.email, "role": user.role})
    return {"Authorization": f"Bearer {token}"}


def _calc(db, number, owner):
    c = HydCalculation(calc_number=number, title="Pump sizing", calc_type="pump_power", system_type="hydraulic",
                       inputs={}, results={}, created_by_id=owner.id)
    db.add(c)
    db.commit()
    return c


def test_hydraulic_calculation_delete_is_own_only(client, db):
    grants = ["hydraulic:calculations:view", "hydraulic:calculations:delete"]
    alice = _user(db, "hyd-alice@premnathrail.com", grants)
    bob = _user(db, "hyd-bob@premnathrail.com", grants)
    calc = _calc(db, "HC-T-0001", alice)

    denied = client.delete(f"{API}/hydraulic/calculations/{calc.id}", headers=_h(bob))
    assert denied.status_code == 403, denied.text
    assert "created yourself" in denied.json()["detail"]

    ok = client.delete(f"{API}/hydraulic/calculations/{calc.id}", headers=_h(alice))
    assert ok.status_code == 200, ok.text
    db.refresh(calc)
    assert calc.is_deleted


def test_view_only_user_cannot_delete_and_admin_can_delete_anything(client, db):
    alice = _user(db, "hyd-alice2@premnathrail.com", ["hydraulic:calculations:view", "hydraulic:calculations:delete"])
    viewer = _user(db, "hyd-viewer@premnathrail.com", ["hydraulic:calculations:view"])
    admin = _user(db, "hyd-admin@premnathrail.com", [], role="admin")
    calc = _calc(db, "HC-T-0002", alice)

    r = client.delete(f"{API}/hydraulic/calculations/{calc.id}", headers=_h(viewer))
    assert r.status_code == 403 and "'delete' permission" in r.json()["detail"].lower()

    r = client.delete(f"{API}/hydraulic/calculations/{calc.id}", headers=_h(admin))
    assert r.status_code == 200, r.text


def test_quality_standard_delete_is_own_only(client, db):
    grants = ["quality:standards:view", "quality:standards:delete"]
    alice = _user(db, "qs-alice@premnathrail.com", grants)
    bob = _user(db, "qs-bob@premnathrail.com", grants)
    std = QualityStandard(standard_code="QS-T-1", title="Weld acceptance", created_by_id=alice.id)
    db.add(std)
    db.commit()

    denied = client.delete(f"{API}/quality/standards/{std.id}", headers=_h(bob))
    assert denied.status_code == 403 and "created yourself" in denied.json()["detail"]
    # Without 'Delete' on the tab, even your own record can't be deleted.
    viewer = _user(db, "qs-viewer@premnathrail.com", ["quality:standards:view"])
    own = QualityStandard(standard_code="QS-T-2", title="Paint DFT", created_by_id=viewer.id)
    db.add(own)
    db.commit()
    assert client.delete(f"{API}/quality/standards/{own.id}", headers=_h(viewer)).status_code == 403

    ok = client.delete(f"{API}/quality/standards/{std.id}", headers=_h(alice))
    assert ok.status_code == 200, ok.text


def test_record_without_creator_is_deletable_by_any_delete_holder(client, db):
    """Workstations carry no creator column — 'Delete' on the tab is enough."""
    deleter = _user(db, "ws-del@premnathrail.com", ["production:workstations:view", "production:workstations:delete"])
    viewer = _user(db, "ws-view@premnathrail.com", ["production:workstations:view"])
    ws = ProductionWorkstation(code="WS-T-1", name="Lathe 1")
    db.add(ws)
    db.commit()
    assert client.delete(f"{API}/production/workstations/{ws.id}", headers=_h(viewer)).status_code == 403
    r = client.delete(f"{API}/production/workstations/{ws.id}", headers=_h(deleter))
    assert r.status_code == 200, r.text
