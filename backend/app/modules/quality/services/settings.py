"""Quality → Settings: data-only values (numbering prefixes, thresholds,
KPI targets, sampling defaults) plus the simple master lists.

The *set of keys* and their meaning is coded here — users only change
values (no metadata customization). Changes are audit-logged automatically
because QualitySetting / QualityMasterValue are registered in
app/core/audit_registry.py."""
from sqlalchemy.orm import Session

from app.modules.quality.models.masters import QualitySetting, QualityMasterValue, QUALITY_MASTER_LISTS

# key -> spec. type: int | float | str | choice. group = section on the page.
QUALITY_SETTING_SPECS: dict[str, dict] = {
    # Numbering
    "lot_number_prefix": {"group": "numbering", "label": "Inspection lot number prefix", "type": "str", "default": "IL",
                          "help": "Lots are numbered <prefix>-<year>-<0001>."},
    "ncr_number_prefix": {"group": "numbering", "label": "NCR number prefix", "type": "str", "default": "NCR",
                          "help": "NCRs are numbered <prefix>-<year>-<0001>."},
    "fai_number_prefix": {"group": "numbering", "label": "First article (FAI) number prefix", "type": "str", "default": "FAI",
                          "help": "First article inspections are numbered <prefix>-<year>-<0001>."},
    "call_number_prefix": {"group": "numbering", "label": "Inspection call number prefix", "type": "str", "default": "IC",
                           "help": "Customer / third-party inspection calls are numbered <prefix>-<year>-<0001>."},
    "capa_number_prefix": {"group": "numbering", "label": "CAPA number prefix", "type": "str", "default": "CAPA",
                           "help": "CAPAs (8D) are numbered <prefix>-<year>-<0001>."},
    "complaint_number_prefix": {"group": "numbering", "label": "Customer complaint number prefix", "type": "str", "default": "COMP",
                                "help": "Customer complaints are numbered <prefix>-<year>-<0001>."},
    "vendor_audit_number_prefix": {"group": "numbering", "label": "Vendor audit number prefix", "type": "str", "default": "VA",
                                   "help": "Vendor audits are numbered <prefix>-<year>-<0001>."},
    # Thresholds
    "lot_waiting_days": {"group": "thresholds", "label": "Lot waiting alert after (days)", "type": "int", "default": 2, "min": 1,
                         "help": "An open inspection lot older than this reminds the quality engineers (Teams + bell)."},
    "inspection_call_reminder_days": {"group": "thresholds", "label": "Inspection call reminder before (days)", "type": "int", "default": 2, "min": 0,
                                      "help": "Quality engineers get a Teams + bell reminder this many days before a scheduled customer / third-party inspection call."},
    "reduced_after_lots": {"group": "sampling", "label": "Reduced sampling after (accepted lots in a row)", "type": "int", "default": 10, "min": 2,
                           "help": "ISO 2859-1 switching: an Approved vendor whose last N lots of an item were all accepted moves to reduced sampling. Any rejection returns it to normal."},
    "tightened_to_normal_lots": {"group": "sampling", "label": "Tightened → normal after (accepted lots in a row)", "type": "int", "default": 5, "min": 1,
                                 "help": "ISO 2859-1: 2 rejected of the last 5 lots switches to tightened; this many accepted in a row switches back (not while On watch)."},
    "skip_lot_after_lots": {"group": "sampling", "label": "Skip-lot after (accepted lots in a row)", "type": "int", "default": 20, "min": 5,
                            "help": "An Approved vendor on reduced sampling with this many accepted lots in a row and a monthly score at or above the minimum below qualifies for skip-lot."},
    "skip_lot_min_score": {"group": "sampling", "label": "Skip-lot minimum vendor score", "type": "float", "default": 95, "min": 0, "max": 100},
    "skip_lot_frequency": {"group": "sampling", "label": "Skip-lot: fully inspect 1 lot in", "type": "int", "default": 4, "min": 2,
                           "help": "On skip-lot, one lot in this many is inspected fully; the others check only critical characteristics (always 100%)."},
    "fai_sample_size": {"group": "sampling", "label": "First article sample (pieces)", "type": "int", "default": 5, "min": 1,
                        "help": "Pieces checked against the full drawing when an item has no own First article plan (its incoming / final plan is used, every characteristic at this sample, accept 0). Critical characteristics stay 100%."},
    "gauge_due_days": {"group": "thresholds", "label": "Gauge due alert before (days)", "type": "int", "default": 15, "min": 1,
                       "help": "Used from Phase 4 (calibration)."},
    # "scrap_value_limit" moved to Organization › Approval Workflows › NCR
    # disposition (the Partner stage's condition) — see services/authz.py.
    "vendor_watch_below": {"group": "thresholds", "label": "Vendor 'On watch' below score", "type": "float", "default": 90, "min": 0, "max": 100,
                           "help": "A vendor whose monthly score falls below this goes On watch: tightened sampling on its lots, a vendor CAPA, and an alert to Purchase + Quality heads."},
    "vendor_block_below": {"group": "thresholds", "label": "Vendor 'Blocked' below score", "type": "float", "default": 75, "min": 0, "max": 100,
                           "help": "Below this the vendor is proposed for Blocked — a Partner approves; a Blocked vendor gets no new PO lines and no lot acceptance for that item."},
    "vendor_weight_quality": {"group": "thresholds", "label": "Vendor rating weight — quality (%)", "type": "float", "default": 60, "min": 0, "max": 100},
    "vendor_weight_delivery": {"group": "thresholds", "label": "Vendor rating weight — delivery (%)", "type": "float", "default": 30, "min": 0, "max": 100},
    "vendor_weight_ncr": {"group": "thresholds", "label": "Vendor rating weight — NCR severity (%)", "type": "float", "default": 10, "min": 0, "max": 100},
    "capa_repeat_count": {"group": "thresholds", "label": "CAPA trigger — same defect count", "type": "int", "default": 3, "min": 1,
                          "help": "The same defect code on the same item this many times within the window below raises a CAPA automatically."},
    "capa_repeat_days": {"group": "thresholds", "label": "CAPA trigger — within (days)", "type": "int", "default": 90, "min": 1},
    "effectiveness_days": {"group": "thresholds", "label": "CAPA effectiveness check after (days)", "type": "int", "default": 90, "min": 1,
                           "help": "Once a CAPA's actions are done, the D8 effectiveness check (and closure) is due after this many days."},
    "complaint_repeat_days": {"group": "thresholds", "label": "Complaint counts as repeat within (days)", "type": "int", "default": 365, "min": 1,
                              "help": "A complaint from the same customer about the same item within this window is flagged as a repeat."},
    "avl_validity_months": {"group": "thresholds", "label": "Vendor approval valid for (months)", "type": "int", "default": 36, "min": 1,
                            "help": "An approved vendor (item × vendor) is due for re-evaluation after this period."},
    # KPI targets
    "kpi_incoming_rejection_pct": {"group": "kpi", "label": "Incoming rejection % (max)", "type": "float", "default": 2.0, "min": 0},
    "kpi_internal_rejection_pct": {"group": "kpi", "label": "Internal rejection % (max)", "type": "float", "default": 1.0, "min": 0},
    "kpi_first_pass_yield_pct": {"group": "kpi", "label": "First-pass yield % (min)", "type": "float", "default": 98.0, "min": 0, "max": 100},
    "kpi_complaints_per_month": {"group": "kpi", "label": "Customer complaints per month (max)", "type": "int", "default": 0, "min": 0},
    "kpi_copq_per_month": {"group": "kpi", "label": "Cost of poor quality per month (₹, max)", "type": "float", "default": 0, "min": 0},
    "kpi_ncr_closure_days": {"group": "kpi", "label": "NCR closure time (days, max)", "type": "int", "default": 30, "min": 1},
    "kpi_capa_on_time_pct": {"group": "kpi", "label": "CAPA on-time % (min)", "type": "float", "default": 90, "min": 0, "max": 100},
    "kpi_calibration_compliance_pct": {"group": "kpi", "label": "Calibration compliance % (min)", "type": "float", "default": 100, "min": 0, "max": 100},
    "kpi_third_party_first_pass_pct": {"group": "kpi", "label": "Third-party first-pass % (min)", "type": "float", "default": 95, "min": 0, "max": 100},
    # Sampling defaults (prefilled on a new inspection plan)
    "default_sampling_type": {"group": "sampling", "label": "Default sampling", "type": "choice", "default": "aql",
                              "choices": [["aql", "AQL table (ISO 2859-1)"], ["full", "100%"], ["fixed", "Fixed quantity"]]},
    "default_aql": {"group": "sampling", "label": "Default AQL", "type": "choice", "default": "1.0",
                    "choices": [[v, v] for v in ("0.065", "0.10", "0.15", "0.25", "0.40", "0.65", "1.0", "1.5", "2.5", "4.0", "6.5", "10.0")]},
    "default_inspection_level": {"group": "sampling", "label": "Default inspection level", "type": "choice", "default": "II",
                                 "choices": [["I", "General I"], ["II", "General II"], ["III", "General III"]]},
    "default_sampling_severity": {"group": "sampling", "label": "Default switching state", "type": "choice", "default": "normal",
                                  "choices": [["normal", "Normal"], ["tightened", "Tightened"], ["reduced", "Reduced"]]},
}

QUALITY_SETTING_GROUPS = {
    "numbering": "Numbering", "thresholds": "Thresholds", "kpi": "KPI targets", "sampling": "Sampling defaults",
}

# Seed values for the simple master lists (inserted by the migration and
# lazily by ensure_master_lists for fresh / test databases).
QUALITY_MASTER_LIST_SEEDS: dict[str, list[tuple[str, str]]] = {
    "ncr_sources": [
        ("incoming", "Incoming inspection"), ("job_work", "Job work inspection"), ("in_process", "In-process inspection"),
        ("final", "Final inspection"), ("customer_inspection", "Customer / third-party inspection"),
        ("complaint", "Customer complaint"), ("audit", "Audit"), ("internal", "Internal finding"),
    ],
    "complaint_categories": [
        ("product_failure", "Product failure"), ("dimensional", "Dimensional"), ("documentation", "Documentation"),
        ("delivery", "Delivery / packing"), ("other", "Other"),
    ],
    "audit_types": [
        ("internal", "Internal audit"), ("vendor", "Vendor audit"), ("customer", "Customer audit"),
        ("certification", "Certification audit"),
    ],
    "inspection_agencies": [
        ("rites", "RITES"), ("rdso", "RDSO"), ("customer", "Customer"), ("other", "Other"),
    ],
}


def coerce_setting(key: str, value):
    """Validates and normalizes one setting value; raises ValueError with a
    user-readable reason."""
    spec = QUALITY_SETTING_SPECS.get(key)
    if not spec:
        raise ValueError(f"'{key}' is not a Quality setting.")
    label = spec["label"]
    t = spec["type"]
    if t == "str":
        v = str(value or "").strip().upper()
        if not v or len(v) > 10 or not v.replace("-", "").isalnum():
            raise ValueError(f"{label} must be 1–10 letters/digits (e.g. IL).")
        return v
    if t == "choice":
        v = str(value)
        allowed = [c[0] for c in spec["choices"]]
        if v not in allowed:
            raise ValueError(f"{label} must be one of: {', '.join(allowed)}.")
        return v
    try:
        v = int(value) if t == "int" else float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{label} must be a number.")
    if t == "int" and float(value) != int(value):
        raise ValueError(f"{label} must be a whole number.")
    if "min" in spec and v < spec["min"]:
        raise ValueError(f"{label} can't be less than {spec['min']}.")
    if "max" in spec and v > spec["max"]:
        raise ValueError(f"{label} can't be more than {spec['max']}.")
    return v


def get_setting(db: Session, key: str):
    row = db.query(QualitySetting).filter(QualitySetting.key == key).first()
    if row is not None and row.value is not None:
        return row.value
    return QUALITY_SETTING_SPECS[key]["default"]


def get_all_settings(db: Session) -> dict:
    stored = {r.key: r.value for r in db.query(QualitySetting).all()}
    return {k: (stored[k] if stored.get(k) is not None else spec["default"]) for k, spec in QUALITY_SETTING_SPECS.items()}


def save_settings(db: Session, values: dict) -> dict:
    """Validates every value first, then writes — a bad value saves nothing."""
    clean = {k: coerce_setting(k, v) for k, v in values.items()}
    merged = {**get_all_settings(db), **clean}
    weights = merged["vendor_weight_quality"] + merged["vendor_weight_delivery"] + merged["vendor_weight_ncr"]
    if abs(weights - 100) > 1e-6:
        raise ValueError(f"Vendor rating weights must add up to 100% — they add up to {weights:g}%.")
    if merged["vendor_block_below"] >= merged["vendor_watch_below"]:
        raise ValueError("Vendor 'Blocked' score must be lower than the 'On watch' score.")
    for key, value in clean.items():
        row = db.query(QualitySetting).filter(QualitySetting.key == key).first()
        if row is None:
            db.add(QualitySetting(key=key, value=value))
        elif row.value != value:
            row.value = value
    db.flush()
    return get_all_settings(db)


def ensure_master_lists(db: Session) -> None:
    """Inserts any missing seed value (never re-activates a retired one)."""
    existing = {(r.list_key, r.value) for r in db.query(QualityMasterValue.list_key, QualityMasterValue.value).all()}
    added = False
    for list_key, values in QUALITY_MASTER_LIST_SEEDS.items():
        for i, (value, label) in enumerate(values):
            if (list_key, value) not in existing:
                db.add(QualityMasterValue(list_key=list_key, value=value, label=label, sort_order=(i + 1) * 10))
                added = True
    if added:
        db.flush()


def active_master_values(db: Session, list_key: str) -> list[str]:
    if list_key not in QUALITY_MASTER_LISTS:
        raise ValueError(f"Unknown master list '{list_key}'")
    ensure_master_lists(db)
    return [r.value for r in db.query(QualityMasterValue).filter(
        QualityMasterValue.list_key == list_key, QualityMasterValue.is_active.is_(True)
    ).all()]
