"""CRM inquiry owners follow the role's "Assign to" rules
(crm:inquiries_tenders.bd_owner / .sales_engineer, services/opportunity.apply_owners)."""
import pytest
from fastapi import HTTPException

from app.modules.crm.services.opportunity import apply_owners
from app.modules.main.models.role import Role
from app.modules.main.models.user import User

CRM = ("crm:inquiries_tenders:view", "crm:inquiries_tenders:create", "crm:inquiries_tenders:edit")


def _user(db, email, role=None):
    u = User(email=email, name=email.split("@")[0].title(), role="user", is_active=True, granular_permissions=[])
    db.add(u)
    db.commit()
    if role is not None:
        u.roles = [role]
        db.commit()
    db.refresh(u)
    return u


def _role(db, name, rules=None):
    r = Role(name=name, permissions=list(CRM), assignee_rules=rules or {})
    db.add(r)
    db.commit()
    db.refresh(r)
    return r


def test_sales_engineer_outside_rule_is_refused(db):
    plain = _role(db, "CRM user")
    bd = _user(db, "bd@premnathrail.com", _role(db, "BD self", {"crm:inquiries_tenders.sales_engineer": {"mode": "self"}}))
    other = _user(db, "eng@premnathrail.com", plain)
    with pytest.raises(HTTPException) as e:
        apply_owners(db, None, {"sales_engineer_id": other.id}, bd)
    assert e.value.status_code == 403 and "Set sales engineer to" in e.value.detail
    data = {"sales_engineer_id": bd.id}
    apply_owners(db, None, data, bd)
    assert data["sales_engineer"] == bd.name


def test_bd_owner_self_always_allowed_and_unchanged_owner_not_rechecked(db):
    plain = _role(db, "CRM user")
    rule = {"crm:inquiries_tenders.bd_owner": {"mode": "custom", "users": [-1]}}
    bd = _user(db, "bd@premnathrail.com", _role(db, "BD narrow", rule))
    other = _user(db, "other@premnathrail.com", plain)
    apply_owners(db, None, {"bd_owner_id": bd.id}, bd)  # owning it yourself
    with pytest.raises(HTTPException):
        apply_owners(db, None, {"bd_owner_id": other.id}, bd)

    class Inq:  # an existing inquiry already owned by `other` — re-saving it isn't a reassignment
        bd_owner_id = other.id
        sales_engineer_id = None
    apply_owners(db, Inq(), {"bd_owner_id": other.id}, bd)
