"""Reorder-point list (2026-10-12): due items net of what is already on
order, with a suggested quantity for a one-click PR."""
from app.modules.store.models.item import StoreItem
from app.modules.store.services.reorder import suggest
from app.tests.test_cov_controls_store import API, _h, _seed_stock, env  # noqa: F401 — env is a fixture
from app.tests.test_p2p_requests import _create_pr, _requester, _sqlite_number_series  # noqa: F401 — autouse fixture

REORDER = f"{API}/reorder"


def test_item_at_reorder_point_is_listed_and_open_pr_counts_as_on_order(client, db, env):
    item = env["item"]
    item.reorder_level, item.reorder_quantity = 15, 10
    db.commit()
    _seed_stock(client, env, 12)  # 12 <= 15 → due

    rows = client.get(REORDER, headers=_h(env["manager"])).json()
    row = next(r for r in rows if r["item_id"] == item.id)
    assert (row["available"], row["on_order"], row["projected"], row["due"], row["suggested_qty"]) == (12, 0, 12, True, 10)

    # A PR for 10 is raised → projected 22 > 15, no longer due (not ordered twice).
    pr = _create_pr(client, _requester(db, "reorder.req@premnathrail.com"),
                    items=[{"store_item_id": item.id, "quantity": 10, "project_inhouse": "Inhouse"}])
    rows = client.get(REORDER, headers=_h(env["manager"])).json()
    assert all(r["item_id"] != item.id for r in rows)
    everything = client.get(REORDER, params={"due_only": False}, headers=_h(env["manager"])).json()
    row = next(r for r in everything if r["item_id"] == item.id)
    assert row["on_order"] == 10 and row["on_order_docs"] == [pr["p2p_number"]] and row["due"] is False


def test_suggested_quantity_rules():
    it = StoreItem(item_code="X", item_name="X", uom="NOS")
    it.reorder_level, it.maximum_stock = 10, 50
    assert suggest(it, 4) == 46                       # top up to maximum
    it.maximum_stock, it.reorder_quantity = None, 5
    assert suggest(it, 2) == 10                       # one lot (5) wouldn't lift 2 above 10 → two lots
    it.reorder_quantity, it.min_order_qty = None, 25
    assert suggest(it, 4) == 25                       # shortfall 7 → rounded up to the minimum order qty
