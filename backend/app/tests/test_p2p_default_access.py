"""Default Procurement roles + PR / PO workflows applied by migration e8b4c2d6f1a3 (2026-11-19)."""
from __future__ import annotations

from app.core.permission_registry import can_feature, can_perform, is_valid_grant
from app.modules.main.models.role import Role
from app.modules.main.models.user import User
from app.modules.organization.models.approval import ApprovalWorkflow
from app.modules.organization.models.department import Department
from app.modules.organization.services import approval_engine as engine
from app.modules.p2p import po_split
from app.modules.p2p.default_access import (APPROVER, PURCHASE_HEAD, PURCHASER, REQUESTER,
                                            apply_default_procurement_access)


def _user(db, email, **kw):
    u = User(email=email, name=email.split("@")[0].replace(".", " ").title(), role=kw.pop("role", "user"), is_active=True, **kw)
    db.add(u)
    db.commit()
    return u


def test_every_default_grant_exists_and_only_buyers_can_raise_rfqs():
    for grants in (REQUESTER, APPROVER, PURCHASER, PURCHASE_HEAD):
        bad = [g for g in grants if not is_valid_grant(g)]
        assert not bad, bad
    assert not any(g.startswith("p2p:rfq") for g in REQUESTER)          # the Everyone role never sees quotes
    assert "p2p:rfq:create" not in APPROVER and "p2p:rfq:create" in PURCHASER
    assert "p2p:purchase_requisitions.all_lines:edit" in PURCHASE_HEAD
    assert "p2p:purchase_requisitions.all_lines:edit" not in PURCHASER


def test_apply_overwrites_procurement_ticks_adds_users_from_data_and_sets_workflows(db):
    head_acc, head_pur, buyer, partner = (_user(db, "dept.head@x.com"), _user(db, "purchase.head@x.com"),
                                          _user(db, "buyer.one@x.com", department="Purchase"), _user(db, "partner.one@x.com", is_partner=True))
    admin = _user(db, "admin.one@x.com", role="admin", is_partner=True)
    plain = _user(db, "plain.one@x.com")
    db.add_all([Department(name="Accounts", code="ACC", head_user_id=head_acc.id),
                Department(name="Purchase", code="PUR", head_user_id=head_pur.id)])
    # Production's older roles: the Everyone "purchase user" with a CRM tick and too much Procurement,
    # and an Approver that held everything.
    db.add_all([Role(name="purchase user", permissions=["crm:inquiries_tenders:view", "p2p:*:*"], data_scopes={}, is_default=True),
                Role(name="Procurement – Approver", permissions=["p2p:*:*"], data_scopes={})])
    db.commit()

    out = apply_default_procurement_access(db.connection())
    db.commit()
    db.expire_all()

    roles = {r.name: r for r in db.query(Role).all()}
    req = roles["PR Requester"]  # renamed, still Everyone, CRM tick kept, Procurement replaced
    assert "purchase user" not in roles and req.is_default
    assert "crm:inquiries_tenders:view" in req.permissions and "p2p:*:*" not in req.permissions
    assert "p2p:*:*" not in roles["Procurement – Approver"].permissions
    assert roles["Purchaser"].data_scopes["p2p"] == "organization" and req.data_scopes["p2p"] == "assigned"

    members = {name: {u.id for u in db.query(User).join(User.roles).filter(Role.name == name)} for name in roles}
    assert members["Procurement – Approver"] == {head_acc.id, partner.id}          # admins and the purchase head left out
    assert members["Purchase Head"] == {head_pur.id}
    assert members["Purchaser"] == {buyer.id}
    assert out["added"] == {"approver": 2, "purchase_head": 1, "purchaser": 1}

    # What each person can do now.
    for u in (plain, buyer, head_pur, head_acc):
        db.refresh(u)
    assert can_perform(plain, "p2p", "purchase_requisitions", "create") and not can_perform(plain, "p2p", "rfq", "view")
    assert not po_split.is_purchaser(plain) and not po_split.can_see_all_lines(plain)
    assert po_split.is_purchaser(buyer) and not po_split.can_work_all_lines(buyer)
    assert po_split.can_work_all_lines(head_pur)
    assert can_feature(head_acc, "p2p", "purchase_orders", "prices", "view") and not po_split.is_purchaser(head_acc)

    # Workflows: stages in order, the skippable ones skippable.
    pr = db.query(ApprovalWorkflow).filter_by(key="p2p.purchase_requisition").one()
    assert [(s.name, s.approver_rule, s.skip_if_no_approver) for s in pr.stages] == [
        ("Department head", "department_head", True), ("Project head", "record_field", True), ("Purchase team", "permission", False)]
    assert pr.is_active and not pr.allow_self_approval and not pr.require_permission
    po = db.query(ApprovalWorkflow).filter_by(key="p2p.purchase_order").one()
    assert [(s.name, s.approver_rule) for s in po.stages] == [
        ("Purchase head", "permission"), ("Project head", "record_field"), ("Partner (final approval)", "partner")]
    assert po.distinct_approvers
    # The engine finds the right people for the permission stages.
    assert set(engine.permission_holders(db, "p2p:rfq:create")) == {buyer.id, head_pur.id}
    assert engine.permission_holders(db, "p2p:purchase_requisitions.all_lines:edit") == [head_pur.id]
    assert admin.id not in members["Procurement – Approver"]

    # Running it again adds nobody twice.
    again = apply_default_procurement_access(db.connection())
    assert again["added"] == {"approver": 0, "purchase_head": 0, "purchaser": 0}
