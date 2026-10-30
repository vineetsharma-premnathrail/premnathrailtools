"""Priority is exactly two values app-wide: Standard (default) and Urgent."""
import pytest
from fastapi import HTTPException

from app.core.priority import (
    PRIORITIES, PRIORITY_LABELS, PRIORITY_RANK, coerce_priority_field, map_legacy_priority, parse_priority, priority_label,
    priority_rank,
)
from app.modules.crm.schemas.inquiry import InquiryCreate, InquiryUpdate
from app.modules.crm.schemas.tender import TenderCreate
from app.modules.maintenance.service import default_priority


def test_contract_values():
    assert PRIORITIES == ("standard", "urgent")
    assert PRIORITY_LABELS == {"standard": "Standard", "urgent": "Urgent"}
    assert PRIORITY_RANK == {"urgent": 0, "standard": 1}
    assert sorted(["standard", "urgent", "standard"], key=priority_rank) == ["urgent", "standard", "standard"]


@pytest.mark.parametrize("raw,expected", [("urgent", "urgent"), ("URGENT", "urgent"), (" Standard ", "standard"), (None, "standard"), ("", "standard")])
def test_parse_priority_accepts_two_values_any_case(raw, expected):
    assert parse_priority(raw) == expected


@pytest.mark.parametrize("raw", ["low", "medium", "normal", "high", "critical", "asap"])
def test_parse_priority_rejects_third_values(raw):
    with pytest.raises(HTTPException) as e:
        parse_priority(raw)
    assert e.value.status_code == 422 and e.value.detail == "Priority must be Standard or Urgent."


@pytest.mark.parametrize("raw,expected", [
    ("Urgent", "urgent"), ("critical", "urgent"), ("High", "urgent"), ("medium", "standard"), ("Low", "standard"),
    ("normal", "standard"), (None, "standard"), ("", "standard"), ("whatever", "standard"),
])
def test_map_legacy_priority_for_imports(raw, expected):
    assert map_legacy_priority(raw) == expected


def test_priority_label_and_rank_tolerate_legacy_rows():
    assert priority_label("critical") == "Urgent" and priority_label("medium") == "Standard" and priority_label(None) == "Standard"
    assert priority_rank("high") == 0 and priority_rank("low") == 1


def test_schema_validator_helper():
    assert coerce_priority_field(None) is None
    assert coerce_priority_field("  ") is None
    assert coerce_priority_field("", blank_to="standard") == "standard"
    assert coerce_priority_field("URGENT") == "urgent"
    with pytest.raises(ValueError, match="Standard or Urgent"):
        coerce_priority_field("High")


def test_crm_schemas_enforce_two_values():
    assert InquiryCreate(org_id=1, org_contact_id=1, lead_source="Direct").priority == "standard"
    assert InquiryCreate(org_id=1, org_contact_id=1, lead_source="Direct", priority="Urgent").priority == "urgent"
    assert InquiryUpdate(priority="urgent", followup_priority="Standard").followup_priority == "standard"
    assert InquiryUpdate().priority is None
    for bad in ({"priority": "Medium"}, {"followup_priority": "High"}):
        with pytest.raises(ValueError, match="Standard or Urgent"):
            InquiryUpdate(**bad)
    with pytest.raises(ValueError, match="Standard or Urgent"):
        TenderCreate(org_id=1, priority="Low")


def test_maintenance_default_priority_is_urgent_only_for_a_machine_down():
    assert default_priority("A", True) == "urgent"
    for crit, down in (("A", False), ("B", True), ("B", False), ("C", True), ("C", False)):
        assert default_priority(crit, down) == "standard"
