"""Record Stock Entry (multi-line manual entry) was removed on 2026-10-12
(SAP standard). Posting a new entry is refused with 410 and moves no stock;
entries recorded before stay viewable and can still take attachments."""
import json
from datetime import date


from app.modules.store.models.item import StoreItem
from app.modules.store.models.stock_balance import StoreStockBalance
from app.modules.store.models.stock_entry import StoreStockEntry
from app.modules.store.routes.stock import MANUAL_ENTRY_REMOVED
from app.modules.store.services.stock_ledger import post_stock_transaction
from app.tests.test_store_plant_access import API, setup  # noqa: F401 — fixture


def _bal(db, item_id, loc_id):
    db.expire_all()
    b = db.query(StoreStockBalance).filter_by(item_id=item_id, location_id=loc_id).first()
    return b.on_hand_qty if b else 0


def _old_entry(db, setup):
    """An entry recorded before the removal: header + its ledger row."""
    entry = StoreStockEntry(entry_number="SE-2026-0001", entry_type="receipt", location_id=setup["s1"].id,
                            entry_date=date.today(), vendor_name="ABC Fasteners", invoice_number="INV-77",
                            remarks="Free sample lot", created_by_id=setup["keeper_user"].id)
    db.add(entry)
    db.flush()
    post_stock_transaction(db, item_id=setup["item"].id, location_id=setup["s1"].id, transaction_type="manual_in",
                           entry_type="receipt", quantity=5, reference_type="stock_entry", reference_number=entry.entry_number,
                           created_by_id=setup["keeper_user"].id)
    db.commit()
    return entry


def test_new_stock_entry_is_refused_and_moves_no_stock(client, db, setup):  # noqa: F811
    nut = StoreItem(item_code="MT-GEN-0002", item_name="Nut M12", uom="NOS")
    db.add(nut)
    db.commit()
    s1, bolt = setup["s1"], setup["item"]
    payload = {"entry_type": "receipt", "location_id": s1.id, "vendor_name": "ABC Fasteners", "invoice_number": "INV-77", "remarks": "Free sample lot",
               "lines": [{"item_id": bolt.id, "quantity": 5, "unit_cost": 12.5}, {"item_id": nut.id, "quantity": 20}]}
    for who in ("keeper", "admin"):
        r = client.post(f"{API}/stock/entries", data={"payload": json.dumps(payload)}, headers=setup[who])
        assert r.status_code == 410 and r.json()["detail"] == MANUAL_ENTRY_REMOVED, who
    assert _bal(db, bolt.id, s1.id) == 10 and _bal(db, nut.id, s1.id) == 0
    assert db.query(StoreStockEntry).count() == 0


def test_old_entry_stays_viewable(client, db, setup):  # noqa: F811
    entry = _old_entry(db, setup)
    r = client.get(f"{API}/stock/entries/{entry.id}", headers=setup["keeper"])
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["entry_number"] == "SE-2026-0001" and [ln["quantity"] for ln in body["lines"]] == [5]
    assert client.get(f"{API}/stock/entries/by-number/SE-2026-0001", headers=setup["keeper"]).json()["id"] == entry.id


def test_attachments_on_old_entry_need_storage_configured(client, db, setup, monkeypatch):  # noqa: F811
    from app.core.config import settings
    monkeypatch.setattr(settings, "SHAREPOINT_SITE_ID", "")
    entry = _old_entry(db, setup)
    r = client.post(f"{API}/stock/entries/{entry.id}/attachments",
                    files=[("files", ("invoice.pdf", b"%PDF-1.4", "application/pdf"))], headers=setup["keeper"])
    assert r.status_code == 503 and "SharePoint" in r.json()["detail"]
    assert _bal(db, setup["item"].id, setup["s1"].id) == 15
