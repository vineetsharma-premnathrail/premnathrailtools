"""Store › Reservations: one reservation with many item lines (all or nothing)
and the Excel line import."""
import io

from openpyxl import Workbook

from app.modules.store.models.item import StoreItem
from app.modules.store.models.stock_reservation import StoreStockReservation
from app.modules.store.services.stock_ledger import post_stock_transaction
from app.tests.test_cov_store_open_store import API, _balance, _h, env  # noqa: F401 (fixture)


def _second_item(db, env):  # noqa: F811
    item = StoreItem(item_code="MT-GEN-0102", item_name="Hex Nut M12", uom="NOS", item_type="material")
    db.add(item)
    db.commit()
    post_stock_transaction(db, item_id=item.id, location_id=env["loc"].id, transaction_type="receipt", quantity=10,
                           reference_type="test_seed", reference_number="SEED", created_by_id=env["manager"].id)
    db.commit()
    return item


def test_bulk_reserves_every_line_with_shared_header(client, db, env):  # noqa: F811
    nut = _second_item(db, env)
    r = client.post(f"{API}/stock-reservations/bulk", json={
        "location_id": env["loc"].id, "project": "Loco 7", "remarks": "For assembly",
        "lines": [{"item_id": env["item"].id, "quantity": 5}, {"item_id": nut.id, "quantity": 4, "remarks": "Spare"}],
    }, headers=_h(env["keeper"]))
    assert r.status_code == 200, r.text
    rows = r.json()
    assert [x["quantity"] for x in rows] == [5, 4]
    assert {x["project"] for x in rows} == {"Loco 7"}
    assert [x["remarks"] for x in rows] == ["For assembly", "Spare"]
    assert len({x["reservation_number"] for x in rows}) == 2
    assert float(_balance(db, env).reserved_qty) == 5


def test_bulk_is_all_or_nothing_when_a_line_is_short(client, db, env):  # noqa: F811
    nut = _second_item(db, env)
    r = client.post(f"{API}/stock-reservations/bulk", json={
        "location_id": env["loc"].id,
        "lines": [{"item_id": env["item"].id, "quantity": 5}, {"item_id": nut.id, "quantity": 99}],
    }, headers=_h(env["keeper"]))
    assert r.status_code == 409
    assert "Line 2" in r.json()["detail"] and "Nothing was reserved" in r.json()["detail"]
    assert db.query(StoreStockReservation).count() == 0
    assert float(_balance(db, env).reserved_qty) == 0


def test_bulk_rejects_empty_and_bad_quantity(client, db, env):  # noqa: F811
    url, h = f"{API}/stock-reservations/bulk", _h(env["keeper"])
    assert client.post(url, json={"location_id": env["loc"].id, "lines": []}, headers=h).status_code == 422
    r = client.post(url, json={"location_id": env["loc"].id, "lines": [{"item_id": env["item"].id, "quantity": 0}]}, headers=h)
    assert r.status_code == 422 and "Line 1" in r.json()["detail"]


def test_import_lines_reads_codes_and_reports_bad_rows(client, db, env):  # noqa: F811
    wb = Workbook()
    ws = wb.active
    ws.append(["item_code", "quantity", "remarks"])
    ws.append(["MT-GEN-0101", 3, "first"])
    ws.append(["NOPE-1", 1, ""])
    buf = io.BytesIO()
    wb.save(buf)
    r = client.post(f"{API}/stock-reservations/import-lines", headers=_h(env["keeper"]),
                    files={"file": ("lines.xlsx", buf.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")})
    assert r.status_code == 200, r.text
    body = r.json()
    assert [ln["item_id"] for ln in body["lines"]] == [env["item"].id]
    assert body["errors"][0]["item_code"] == "NOPE-1"
    t = client.get(f"{API}/stock-reservations/import-lines/template", headers=_h(env["keeper"]))
    assert t.status_code == 200
