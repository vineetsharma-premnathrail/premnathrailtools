"""Store & Quality: the Role matrix tick alone decides (owner, 2026-11-14 —
"role ke permission di hai fir bhi show nahi hota").

* A stock adjustment's approver is anyone holding Store › Adjustments ›
  Approve — no 'Store Manager' user flag needed, and that person approves it.
* My Inspections shows open lots nobody is assigned to yet to an inspector
  whose data scope is only "Own + assigned".
* A stock transfer shows in Store › Transfers for the people who must act on
  it: the routed approver (sending store's manager), other holders of
  Store › Transfers › Approve, and whoever receives at the destination store.

Users here are built WITHOUT assigned_apps, so they get the real
deny-by-default behaviour of their extra grants (conftest)."""
from app.auth.jwt_handler import create_access_token
from app.modules.main.models.user import User
from app.modules.organization.models.branch import Branch
from app.modules.quality.services.lots import create_lot
from app.modules.store.models.item import StoreItem
from app.modules.store.models.location import StoreLocation
from app.modules.store.models.stock_balance import StoreStockBalance
from app.modules.store.services.stock_ledger import post_stock_transaction

S = "/api/v1/store"
Q = "/api/v1/quality"


def _user(db, email, grants, scopes=None, **fields) -> User:
    u = User(email=email, name=email.split("@")[0], role="user", is_active=True,
             granular_permissions=list(grants), data_access_scopes=dict(scopes or {}), **fields)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _h(u: User) -> dict:
    return {"Authorization": f"Bearer {create_access_token({'sub': str(u.id), 'email': u.email, 'role': u.role})}"}


# ── Adjustments: approver by the Approve tick, no Store Manager flag ─────────

def test_adjustment_approver_is_decided_by_the_approve_tick_not_the_flag(client, db):
    loc = StoreLocation(name="Main Store", code="MS")
    item = StoreItem(item_code="MT-GEN-0901", item_name="Hex nut M10", uom="NOS")
    db.add_all([loc, item])
    db.commit()
    post_stock_transaction(db, item_id=item.id, location_id=loc.id, transaction_type="receipt", quantity=20)
    db.commit()
    keeper = _user(db, "tick.keeper@premnathrail.com", ["store:adjustments:view", "store:adjustments:create"])
    approver = _user(db, "tick.approver@premnathrail.com", ["store:adjustments:view", "store:adjustments:approve"])
    viewer = _user(db, "tick.viewer@premnathrail.com", ["store:adjustments:view"])
    assert not approver.is_store_manager and loc.manager_user_id is None

    # The picker offers exactly the holders of the tick (minus the caller).
    picker = client.get(f"{S}/stock-adjustments/approvers", headers=_h(keeper))
    assert picker.status_code == 200, picker.text
    ids = {u["id"] for u in picker.json()}
    assert approver.id in ids and viewer.id not in ids and keeper.id not in ids

    # Naming someone without the tick is refused with the reason.
    bad = client.post(f"{S}/stock-adjustments", json={
        "location_id": loc.id, "approved_by_id": viewer.id, "items": [{"item_id": item.id, "actual_quantity": 18}]},
        headers=_h(keeper))
    assert bad.status_code == 400 and "Store › Adjustments › Approve" in bad.json()["detail"]

    adj = client.post(f"{S}/stock-adjustments", json={
        "location_id": loc.id, "approved_by_id": approver.id, "items": [{"item_id": item.id, "actual_quantity": 18}]},
        headers=_h(keeper))
    assert adj.status_code == 200, adj.text
    ok = client.post(f"{S}/stock-adjustments/{adj.json()['id']}/approve", headers=_h(approver))
    assert ok.status_code == 200, ok.text
    assert ok.json()["status"] == "approved"
    db.expire_all()
    assert db.query(StoreStockBalance).filter_by(item_id=item.id, location_id=loc.id).one().on_hand_qty == 18


# ── Quality: unassigned open lots in My Inspections ─────────────────────────

def test_unassigned_open_lots_show_in_my_inspections_for_an_assigned_scope_inspector(client, db):
    loc = StoreLocation(name="QA Store", code="QS")
    item = StoreItem(item_code="MT-GEN-0902", item_name="Brake shoe", uom="NOS", inspection_on_receipt=True)
    db.add_all([loc, item])
    db.commit()
    raiser = _user(db, "tick.raiser@premnathrail.com", ["quality:inspection_lots:view"])
    someone = _user(db, "tick.someone@premnathrail.com", ["quality:my_inspections:view"])
    inspector = _user(db, "tick.inspector@premnathrail.com", ["quality:my_inspections:view", "quality:my_inspections:edit"],
                      scopes={"quality": "assigned"})
    looker = _user(db, "tick.looker@premnathrail.com", ["quality:my_inspections:view"], scopes={"quality": "assigned"})
    free = create_lot(db, inspection_type="incoming", source_type="manual", item=item, quantity=5, location_id=None,
                      user_id=raiser.id)
    taken = create_lot(db, inspection_type="incoming", source_type="manual", item=item, quantity=3, location_id=None,
                       user_id=raiser.id, assigned_to_id=someone.id)
    db.commit()

    mine = client.get(f"{Q}/inspection-lots", params={"mine": True}, headers=_h(inspector))
    assert mine.status_code == 200, mine.text
    ids = {lot["id"] for lot in mine.json()}
    assert free.id in ids and taken.id not in ids
    # The lot page opens for the pickup too.
    assert client.get(f"{Q}/inspection-lots/{free.id}", headers=_h(inspector)).status_code == 200
    # Someone who only views (no Edit tick) doesn't get other people's pickups.
    assert free.id not in {lot["id"] for lot in client.get(f"{Q}/inspection-lots", params={"mine": True}, headers=_h(looker)).json()}
    # Assigning an inspector is the Assign inspector feature, not My Inspections › Edit.
    r = client.post(f"{Q}/inspection-lots/{free.id}/assign", json={"user_id": inspector.id}, headers=_h(inspector))
    assert r.status_code == 403 and "Assign inspector" in r.json()["detail"]


# ── Transfers: whoever must act on it sees it ───────────────────────────────

def _transfer_ids(client, u):
    r = client.get(f"{S}/stock-transfers", headers=_h(u))
    assert r.status_code == 200, r.text
    return {t["id"] for t in r.json()}


def test_transfer_shows_to_its_approvers_and_the_receiving_side(client, db):
    p1, p2 = Branch(name="Unit 1", code="U1"), Branch(name="Unit 2", code="U2")
    db.add_all([p1, p2])
    db.flush()
    mgr = _user(db, "tick.mgr@premnathrail.com", ["store:transfers:view", "store:transfers:approve"],
                scopes={"store": "assigned"}, branch_id=p1.id)
    s1 = StoreLocation(name="U1 Store", code="U1-S", branch_id=p1.id, manager_user_id=mgr.id)
    s2 = StoreLocation(name="U2 Store", code="U2-S", branch_id=p2.id)
    item = StoreItem(item_code="MT-GEN-0903", item_name="Axle bolt", uom="NOS")
    db.add_all([s1, s2, item])
    db.commit()
    post_stock_transaction(db, item_id=item.id, location_id=s1.id, transaction_type="receipt", quantity=10)
    db.commit()
    raiser = _user(db, "tick.sender@premnathrail.com", ["store:transfers:view", "store:transfers:create"], branch_id=p1.id)
    also = _user(db, "tick.also@premnathrail.com", ["store:transfers:view", "store:transfers:approve"],
                 scopes={"store": "assigned"}, branch_id=p2.id)
    receiver = _user(db, "tick.receiver@premnathrail.com",
                     ["store:transfers:view", "store:transfers.receive:view", "store:transfers.receive:edit"],
                     scopes={"store": "assigned"}, branch_id=p2.id)
    outsider = _user(db, "tick.outsider@premnathrail.com", ["store:transfers:view"], scopes={"store": "assigned"},
                     branch_id=p2.id)

    t = client.post(f"{S}/stock-transfers", json={
        "from_location_id": s1.id, "to_location_id": s2.id, "items": [{"item_id": item.id, "quantity": 2}]},
        headers=_h(raiser))
    assert t.status_code == 200, t.text
    tid = t.json()["id"]

    assert tid in _transfer_ids(client, mgr)        # routed approver (sending store's manager)
    assert tid in _transfer_ids(client, also)       # another holder of Transfers › Approve
    assert tid in _transfer_ids(client, receiver)   # receives at the destination store
    assert tid not in _transfer_ids(client, outsider)
    # The approve-grant holder can open it and decide it.
    assert client.get(f"{S}/stock-transfers/{tid}", headers=_h(also)).status_code == 200
    st = client.get(f"/api/v1/approvals/entity/stock_transfer/{tid}", headers=_h(also)).json()
    r = client.post(f"/api/v1/approvals/requests/{st['current']['id']}/decide", json={"decision": "approve"}, headers=_h(also))
    assert r.status_code == 200, r.text
    assert client.get(f"{S}/stock-transfers/{tid}", headers=_h(mgr)).json()["status"] == "approved"
