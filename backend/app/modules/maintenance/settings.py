"""Maintenance → Settings on the shared settings framework
(app/core/settings_framework.py). Every default below is the value the code
had hard-coded before this page existed, so an untouched install behaves
exactly as before. Values only — the workflow itself stays in code.

Who can edit: admin, an explicit `maintenance:settings:edit` grant, or an
explicit `maintenance:work_orders:approve` grant (the maintenance planner /
head who already verifies and closes jobs). Explicit grants only — the
Permission Matrix's opt-in fallthrough does not make everyone an editor."""
from app.core.priority import map_legacy_priority
from app.core.settings_framework import (
    ModuleSettingsDef, SettingSpec, can_edit_settings, get_setting as _get, register_module_settings,
)

MODULE = "maintenance"

MAINTENANCE_SETTING_GROUPS = {
    "pm": "Preventive maintenance",
    "breakdown": "Breakdown requests",
    "contracts": "AMC & warranty reminders",
    "reliability": "Reliability KPIs (MTBF / availability)",
    "spares": "Spares",
    "safety": "Work permits (permit-to-work)",
}

_PRIORITIES = [("standard", "Standard"), ("urgent", "Urgent")]


def _prio(key: str, crit: str, down: bool, default: str) -> SettingSpec:
    state = "machine down" if down else "machine running"
    return SettingSpec(
        key, "breakdown", f"Default priority — criticality {crit}, {state}", "select", default, options=_PRIORITIES,
        help=(f"Priority given to a new request on a criticality-{crit} asset when the requester reports the "
              f"{state} and leaves priority blank. Priority drives the order technicians pick jobs up; the requester "
              "or planner can still change it on the request."),
    )


_SPECS = [
    SettingSpec("default_pm_lead_days", "pm", "Default PM lead days", "int", 3, min=0, max=365,
                help="Pre-filled on a new PM plan: how many days before the due date the scheduler raises the PM "
                     "work order, so spares can be kitted and the shutdown planned. Each plan can still override it."),
    SettingSpec("dashboard_pm_window_days", "pm", "Dashboard 'PM due' window (days)", "int", 7, min=1, max=90,
                help="How far ahead (including today) the dashboard's 'PM due' card looks for PM jobs and plans "
                     "falling due. 7 = this week."),
    _prio("priority_a_down", "A", True, "urgent"),
    _prio("priority_b_down", "B", True, "standard"),
    _prio("priority_c_down", "C", True, "standard"),
    _prio("priority_a_running", "A", False, "standard"),
    _prio("priority_b_running", "B", False, "standard"),
    _prio("priority_c_running", "C", False, "standard"),
    SettingSpec("require_requester_confirmation", "breakdown", "Requester must confirm before close", "bool", True,
                help="On: a work order raised from a breakdown request can't be closed until the person who raised "
                     "it confirms the machine is OK (the production side signs off the repair). Off: the planner "
                     "can verify and close as soon as the job is Completed."),
    SettingSpec("contract_reminder_days_before", "contracts", "Remind this many days before expiry", "json_list",
                [30, 15, 7, 1],
                help="The daily reminder to maintenance planners fires when an asset's warranty or AMC is exactly "
                     "this many days from expiry — enough time to raise warranty claims and renew or re-tender the "
                     "AMC. Comma-separated, e.g. 30, 15, 7, 1. Empty list = no advance reminders."),
    SettingSpec("contract_reminder_days_after", "contracts", "Remind this many days after expiry", "int", 1, min=0, max=30,
                help="One more reminder this many days after the cover lapsed (breakdowns are now chargeable). "
                     "0 = no after-expiry reminder."),
    SettingSpec("default_hours_per_day", "reliability", "Default available hours per day", "decimal", 8.0, min=0.5, max=24,
                help="Used for MTBF and availability % when an asset has no linked Production workstation capacity "
                     "and its plant's working hours can't be read. Available hours = working days × this."),
    SettingSpec("critical_spare_alert", "spares", "Alert planners when a critical spare drops below minimum", "bool", True,
                help="On: issuing a spare that is marked critical on any asset's bill of spares and leaves total "
                     "on-hand under the Store minimum (or reorder level) sends planners a bell + Teams reminder, "
                     "once per item per day, so a PR is raised before the next breakdown."),
    SettingSpec("permit_required_default", "safety", "Permit required by default on new work orders", "select", "never",
                options=[("never", "Never — tick it per job"), ("criticality_a", "Criticality A assets"),
                         ("always", "Every work order")],
                help="Pre-sets 'Permit required' on a new work order. A job that needs a permit can't be started until a "
                     "permit-to-work (hot work, height, confined space, electrical isolation / LOTO) is issued and accepted, "
                     "and can't be completed until the permit is closed with the isolation removed."),
]


def _cross_validate(values: dict) -> None:
    days = values.get("contract_reminder_days_before") or []
    bad = [d for d in days if not (1 <= int(d) <= 365)]
    if bad:
        raise ValueError(
            f"Remind this many days before expiry: {', '.join(str(b) for b in bad)} is outside 1–365 — "
            "enter whole days between 1 and 365."
        )


register_module_settings(ModuleSettingsDef(
    module_key=MODULE, label="Maintenance",
    specs={s.key: s for s in _SPECS}, groups=MAINTENANCE_SETTING_GROUPS, cross_validate=_cross_validate,
))


def get_setting(db, key: str):
    return _get(db, MODULE, key)


def can_edit_maintenance_settings(user) -> bool:
    """Maintenance › Settings › Edit, like every module. (Before roles,
    Work Orders › Approve holders could edit settings too; with deny-by-
    default that would make every migrated maintenance user a settings
    editor, so settings are their own grant again.)"""
    return can_edit_settings(user, MODULE)


# ---------------------------------------------------------------- typed readers

def default_pm_lead_days(db) -> int:
    return int(get_setting(db, "default_pm_lead_days"))


def dashboard_pm_window_days(db) -> int:
    return max(1, int(get_setting(db, "dashboard_pm_window_days")))


def priority_for(db, criticality: str | None, machine_down: bool) -> str:
    crit = (criticality or "C").upper()
    if crit not in ("A", "B", "C"):
        crit = "C"
    # A value saved before the two-level scale (high / normal / low) is read as Urgent / Standard.
    return map_legacy_priority(str(get_setting(db, f"priority_{crit.lower()}_{'down' if machine_down else 'running'}")))


def requester_confirmation_required(db) -> bool:
    return bool(get_setting(db, "require_requester_confirmation"))


def contract_reminder_days(db) -> tuple[tuple[int, ...], int]:
    before = tuple(int(d) for d in (get_setting(db, "contract_reminder_days_before") or []))
    return before, int(get_setting(db, "contract_reminder_days_after"))


def default_hours_per_day(db) -> float:
    return float(get_setting(db, "default_hours_per_day"))


def critical_spare_alert_enabled(db) -> bool:
    return bool(get_setting(db, "critical_spare_alert"))


def permit_required_default(db, criticality: str | None) -> bool:
    mode = str(get_setting(db, "permit_required_default") or "never")
    return mode == "always" or (mode == "criticality_a" and (criticality or "").upper() == "A")
