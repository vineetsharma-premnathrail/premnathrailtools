"""HR → Settings on the shared settings framework
(app/core/settings_framework.py). Only the values HR code reads."""
from app.core.settings_framework import ModuleSettingsDef, SettingSpec, register_module_settings, get_setting as _get

HR_SETTING_GROUPS = {
    "leave": "Leave",
    "time": "Time evaluation & overtime",
}

_SPECS = [
    SettingSpec("leave_sandwich_rule", "leave", "Sandwich rule", "bool", False,
                help="On: weekly offs and plant holidays that fall between two leave days of the same request are "
                     "counted as leave (e.g. Friday + Monday leave on a Mon–Fri plant = 4 days). Off: only working "
                     "days are charged; offs and holidays inside a leave are free. Applies to new requests and to "
                     "pending requests when they are approved."),
    # Time evaluation (services/time_evaluation.py). Defaults = Factories Act 1948.
    SettingSpec("ot_daily_threshold_minutes", "time", "Overtime after (minutes worked in a day)", "int", 540, min=60, max=1440,
                help="Factories Act s.59: work beyond 9 hours (540 minutes) in a day is overtime, paid at twice the "
                     "ordinary rate by payroll (ADP). Only change this if a state rule or settlement says otherwise."),
    SettingSpec("ot_weekly_threshold_minutes", "time", "Overtime after (minutes worked in a week)", "int", 2880, min=60, max=10080,
                help="Factories Act s.59: work beyond 48 hours (2,880 minutes) in a week (Monday–Sunday) is overtime even "
                     "when no single day passed the daily limit. The larger of the two is used, never both."),
    SettingSpec("ot_minimum_minutes", "time", "Ignore overtime below (minutes per day)", "int", 15, min=0, max=240,
                help="A day's overtime shorter than this is not counted (e.g. a few minutes of late punching out)."),
    SettingSpec("rest_interval_minutes", "time", "Rest interval deducted (minutes)", "int", 30, min=0, max=120,
                help="Factories Act s.55: a rest interval of at least 30 minutes after 5 hours of work. It is deducted "
                     "from the time between check-in and check-out when that time is more than 5 hours, so worked hours "
                     "exclude the break."),
    SettingSpec("standard_day_minutes", "time", "Planned minutes for an employee without a shift", "int", 480, min=60, max=720,
                help="Used for short-hours when the employee has no shift in their HR profile (8 hours = 480)."),
    # Biometric punch evaluation (services/punches.py).
    SettingSpec("punch_full_day_minutes", "time", "Punches: full day from (minutes worked)", "int", 360, min=60, max=720,
                help="When attendance is built from biometric punches, a day with at least this many worked minutes "
                     "(first IN to last OUT, minus the rest interval) is Present."),
    SettingSpec("punch_half_day_minutes", "time", "Punches: half day from (minutes worked)", "int", 240, min=30, max=600,
                help="Below the full-day minutes but at least this many = Half day. Less than this = Absent (the punches "
                     "stay on record and the day is listed as an exception for HR to check)."),
    SettingSpec("punch_duplicate_window_minutes", "time", "Punches: ignore repeats within (minutes)", "int", 2, min=0, max=30,
                help="Two punches of the same employee closer than this are one swipe pressed twice; the second is "
                     "listed as a duplicate and ignored."),
]

register_module_settings(ModuleSettingsDef(
    module_key="hr", label="HR & Administration",
    specs={s.key: s for s in _SPECS}, groups=HR_SETTING_GROUPS,
))


def get_setting(db, key: str):
    return _get(db, "hr", key)
