"""Segregation of Duties ruleset (SAP GRC Access Risk Analysis equivalent).

Coded, not admin-configurable (project rule: no metadata customization). A
rule is violated when one holder has at least one permission from side A AND
at least one from side B — e.g. whoever can edit the vendor master must not
also be able to post the payment to that vendor, or a fake vendor's bank
account can be paid without a second person seeing it.

Risk "high" needs a recorded mitigation reason before it can be assigned
(main/services/grc.py check_assignment); "medium" is a warning only. Every id
here must be a concrete Permission Matrix id (core/permission_registry.py) —
test_grc_basis.py fails on an unknown one.

Portal admins hold every permission by design and are reported separately,
not as violations (an admin is the firefighter account)."""
from dataclasses import dataclass


@dataclass(frozen=True)
class SodRule:
    rule_id: str
    title: str
    risk: str  # high | medium
    why: str
    side_a_label: str
    side_a: tuple[str, ...]
    side_b_label: str
    side_b: tuple[str, ...]


SOD_RULES: tuple[SodRule, ...] = (
    SodRule(
        "SOD-01", "Vendor master edit + vendor payment", "high",
        "One person could create or change a vendor's bank details and then pay that vendor.",
        "Maintain vendor master", ("accounts:vendors:create", "accounts:vendors:edit", "p2p:vendors:create", "p2p:vendors:edit"),
        "Post / approve vendor payments", ("accounts:payments:create", "accounts:payments:approve", "accounts:payment_runs:approve"),
    ),
    SodRule(
        "SOD-02", "Purchase order create + goods receipt post", "high",
        "One person could order material and also confirm it arrived, so a fictitious receipt gets paid.",
        "Create / edit purchase orders", ("p2p:purchase_orders:create", "p2p:purchase_orders:edit"),
        "Post / approve GRN", ("store:grn:create", "store:grn:approve"),
    ),
    SodRule(
        "SOD-03", "Journal voucher create + approve", "high",
        "One person could raise and approve their own journal, so a wrong or fraudulent entry posts unchecked.",
        "Create journal vouchers", ("accounts:journal_vouchers:create",),
        "Approve journal vouchers", ("accounts:journal_vouchers:approve",),
    ),
    SodRule(
        "SOD-04", "Purchase invoice entry + vendor payment", "high",
        "One person could book a vendor invoice and pay it themselves.",
        "Create purchase invoices", ("accounts:purchase_invoices:create",),
        "Post / approve vendor payments", ("accounts:payments:create", "accounts:payments:approve", "accounts:payment_runs:approve"),
    ),
    SodRule(
        "SOD-05", "Role administration + finance posting", "high",
        "Whoever can change roles can grant themselves any finance power and remove it afterwards.",
        "Edit roles / user access", ("organization:roles:edit", "organization:roles:create"),
        "Approve journals / payments", ("accounts:journal_vouchers:approve", "accounts:payments:approve", "accounts:payment_runs:approve"),
    ),
    SodRule(
        "SOD-06", "Purchase requisition create + approve", "medium",
        "A requester approving their own requisition skips the budget owner's check.",
        "Create requisitions", ("p2p:purchase_requisitions:create",),
        "Approve requisitions", ("p2p:purchase_requisitions:approve",),
    ),
    SodRule(
        "SOD-07", "Journal voucher create + period close", "medium",
        "Whoever posts journals can reopen or close the period they are posting into.",
        "Create journal vouchers", ("accounts:journal_vouchers:create",),
        "Open / close periods", ("accounts:period_close:edit", "accounts:period_close:approve"),
    ),
    SodRule(
        "SOD-09", "Stock adjustment create + approve", "medium",
        "One person could write stock off and approve it, hiding a shortage.",
        "Create stock adjustments", ("store:adjustments:create",),
        "Approve stock adjustments", ("store:adjustments:approve",),
    ),
    SodRule(
        "SOD-10", "Sales invoice create + receipt posting", "medium",
        "One person could raise an invoice and record its collection, masking unpaid dues.",
        "Create sales invoices", ("accounts:sales_invoices:create",),
        "Approve receipts / payments", ("accounts:payments:approve",),
    ),
)

RULES_BY_ID = {r.rule_id: r for r in SOD_RULES}


def all_rule_permissions() -> set[str]:
    return {p for r in SOD_RULES for p in (*r.side_a, *r.side_b)}


def conflicts_in(permissions: set[str]) -> list[dict]:
    """Rules violated by a set of concrete permission ids."""
    out = []
    for r in SOD_RULES:
        a = sorted(p for p in r.side_a if p in permissions)
        b = sorted(p for p in r.side_b if p in permissions)
        if a and b:
            out.append({
                "rule_id": r.rule_id, "title": r.title, "risk": r.risk, "why": r.why,
                "side_a_label": r.side_a_label, "side_b_label": r.side_b_label,
                "side_a_held": a, "side_b_held": b,
            })
    return out


def rule_out(r: SodRule) -> dict:
    return {
        "rule_id": r.rule_id, "title": r.title, "risk": r.risk, "why": r.why,
        "side_a_label": r.side_a_label, "side_a": list(r.side_a),
        "side_b_label": r.side_b_label, "side_b": list(r.side_b),
    }
