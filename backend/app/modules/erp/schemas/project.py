from datetime import date, datetime
from typing import Any, Literal
from pydantic import BaseModel, field_validator, model_validator
from app.core.validators import validate_email_format, validate_gst_format, validate_financial_year_format


# Machine lifecycle statuses — fixed in code (no admin customization). Must
# match STATUS_OPTIONS in frontend/src/components/erp/ProjectForm.tsx; Production
# writes 'manufacturing_under_progress' / 'active' (production/service.py).
PROJECT_STATUSES = (
    "active", "under_service", "manufacturing_under_progress", "work_in_progress",
    "standby", "inactive", "decommissioned", "cancel",
)


def validate_project_status(v: str | None) -> str | None:
    if v is None:
        return v
    v = v.strip().lower()
    if v not in PROJECT_STATUSES:
        raise ValueError(f"Invalid machine status '{v}' — choose one of: {', '.join(PROJECT_STATUSES)}.")
    return v


# Columns that are NOT NULL on erp_projects: a PATCH may leave them out, but
# may not send null for them (that used to reach the DB and 500).
_PROJECT_REQUIRED_ON_UPDATE = {
    "serial_number": "Serial number can't be blank — enter the machine's serial.",
    "status": "Status can't be blank — pick the machine's status (e.g. Active).",
    "is_export": "Export flag can't be blank — send true or false.",
    "extended_warranty": "Extended warranty can't be blank — send true or false.",
}


class ProjectAttachmentResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    project_id: int
    filename: str
    content_type: str | None = None
    size: int | None = None
    sharepoint_path: str | None = None
    created_by_id: int | None = None
    created_at: datetime | None = None
    is_private: bool = False
    shared_with_user_ids: list[int] = []
    shared_departments: list[str] = []
    shared_designations: list[str] = []


class ProjectAttachmentPermissionUpdate(BaseModel):
    is_private: bool
    shared_with_user_ids: list[int] = []
    shared_departments: list[str] = []
    shared_designations: list[str] = []


class ProjectCreate(BaseModel):
    serial_number: str
    machine_type: str | None = None
    model_name: str | None = None
    engine_number: str | None = None
    chassis_number: str | None = None
    application_type: str | None = None
    status: str = "active"

    po_number: str | None = None
    po_date: date | None = None
    delivery_date: date | None = None
    commissioning_date: date | None = None
    handover_date: date | None = None

    client_company: str | None = None
    client_name: str | None = None
    client_designation: str | None = None
    client_email: str | None = None
    client_phone: str | None = None
    client_phone_alt: str | None = None
    client_address: str | None = None
    client_gst: str | None = None
    # Installed base: the CRM customer and the Product master row.
    customer_id: int | None = None
    product_id: int | None = None

    site_name: str | None = None
    site_location: str | None = None
    site_state: str | None = None
    site_pincode: str | None = None
    site_country: str | None = "India"
    zone: str | None = None
    is_export: bool = False

    warranty_start_date: date | None = None
    warranty_end_date: date | None = None
    warranty_override: str | None = None
    extended_warranty: bool = False
    extended_warranty_end: date | None = None
    amc_status: str | None = None
    amc_end_date: date | None = None

    operator_name: str | None = None
    operator_phone: str | None = None
    operator_email: str | None = None
    operator_qualification: str | None = None

    specifications: str | None = None
    installed_options: str | None = None
    software_version: str | None = None
    year_of_manufacture: str | None = None

    notes: str | None = None
    tech_notes: str | None = None
    warranty_terms: str | None = None

    _validate_client_email = field_validator("client_email")(validate_email_format)
    _validate_operator_email = field_validator("operator_email")(validate_email_format)
    _validate_gst = field_validator("client_gst")(validate_gst_format)
    _validate_year = field_validator("year_of_manufacture")(validate_financial_year_format)
    _validate_status = field_validator("status")(validate_project_status)

    @field_validator("serial_number")
    @classmethod
    def _serial_required(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError(_PROJECT_REQUIRED_ON_UPDATE["serial_number"])
        return v


class ProjectCreateOptionalSerial(ProjectCreate):
    """Machine part of 'Add New Project': the serial may be left blank, and
    then becomes the project number (PEW-78)."""
    serial_number: str | None = None

    @field_validator("serial_number")
    @classmethod
    def _serial_required(cls, v: str | None) -> str | None:
        v = (v or "").strip()
        return v or None


class ProjectUpdate(BaseModel):
    """Every field optional — only supplied fields are patched."""
    machine_type: str | None = None
    model_name: str | None = None
    serial_number: str | None = None
    engine_number: str | None = None
    chassis_number: str | None = None
    application_type: str | None = None
    status: str | None = None

    po_number: str | None = None
    po_date: date | None = None
    delivery_date: date | None = None
    commissioning_date: date | None = None
    handover_date: date | None = None

    client_company: str | None = None
    client_name: str | None = None
    client_designation: str | None = None
    client_email: str | None = None
    client_phone: str | None = None
    client_phone_alt: str | None = None
    client_address: str | None = None
    client_gst: str | None = None
    # Installed base: the CRM customer and the Product master row.
    customer_id: int | None = None
    product_id: int | None = None

    site_name: str | None = None
    site_location: str | None = None
    site_state: str | None = None
    site_pincode: str | None = None
    site_country: str | None = None
    zone: str | None = None
    is_export: bool | None = None

    warranty_start_date: date | None = None
    warranty_end_date: date | None = None
    warranty_override: str | None = None
    extended_warranty: bool | None = None
    extended_warranty_end: date | None = None
    amc_status: str | None = None
    amc_end_date: date | None = None

    operator_name: str | None = None
    operator_phone: str | None = None
    operator_email: str | None = None
    operator_qualification: str | None = None

    specifications: str | None = None
    installed_options: str | None = None
    software_version: str | None = None
    year_of_manufacture: str | None = None

    notes: str | None = None
    tech_notes: str | None = None
    warranty_terms: str | None = None

    _validate_client_email = field_validator("client_email")(validate_email_format)
    _validate_operator_email = field_validator("operator_email")(validate_email_format)
    _validate_gst = field_validator("client_gst")(validate_gst_format)
    _validate_year = field_validator("year_of_manufacture")(validate_financial_year_format)

    @field_validator("serial_number", "status", "is_export", "extended_warranty", mode="before")
    @classmethod
    def _no_null_on_required(cls, v, info):
        if v is None or (isinstance(v, str) and not v.strip()):
            raise ValueError(_PROJECT_REQUIRED_ON_UPDATE[info.field_name])
        return v.strip() if isinstance(v, str) else v
    # Status values are checked in update_project: an unchanged legacy value
    # (from before the list was fixed) must not block editing other fields.


class ProjectApprovalPayload(BaseModel):
    remarks: str | None = None


class ProjectResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    serial_number: str
    machine_type: str | None = None
    model_name: str | None = None
    engine_number: str | None = None
    chassis_number: str | None = None
    application_type: str | None = None
    status: str

    po_number: str | None = None
    po_date: date | None = None
    delivery_date: date | None = None
    commissioning_date: date | None = None
    handover_date: date | None = None

    client_company: str | None = None
    client_name: str | None = None
    client_designation: str | None = None
    client_email: str | None = None
    client_phone: str | None = None
    client_phone_alt: str | None = None
    client_address: str | None = None
    client_gst: str | None = None
    # Installed base: the CRM customer and the Product master row.
    customer_id: int | None = None
    product_id: int | None = None

    site_name: str | None = None
    site_location: str | None = None
    site_state: str | None = None
    site_pincode: str | None = None
    site_country: str | None = None
    zone: str | None = None
    is_export: bool

    warranty_start_date: date | None = None
    warranty_end_date: date | None = None
    warranty_override: str | None = None
    extended_warranty: bool
    extended_warranty_end: date | None = None
    amc_status: str | None = None
    amc_end_date: date | None = None

    operator_name: str | None = None
    operator_phone: str | None = None
    operator_email: str | None = None
    operator_qualification: str | None = None

    specifications: str | None = None
    installed_options: str | None = None
    software_version: str | None = None
    year_of_manufacture: str | None = None

    notes: str | None = None
    tech_notes: str | None = None
    warranty_terms: str | None = None

    approval_status: str = "approved"
    approved_by_id: int | None = None
    approved_at: datetime | None = None
    approval_remarks: str | None = None
    created_by_id: int | None = None
    customer_name: str | None = None
    product_name: str | None = None
    # The Project Management project this machine was registered with (None = past project).
    pm_project_id: int | None = None
    # Lifecycle stage (same keys as a PM project). Service only works on serviceable machines.
    lifecycle_stage: str = "planned"
    lifecycle_stage_label: str | None = None
    serviceable: bool = False

    created_at: datetime
    updated_at: datetime

    @model_validator(mode="after")
    def _stage_flags(self):
        from app.modules.projects import lifecycle
        self.lifecycle_stage_label = lifecycle.stage_label(self.lifecycle_stage)
        self.serviceable = lifecycle.is_serviceable(self.lifecycle_stage)
        return self


class MachineStagePayload(BaseModel):
    # One of the project lifecycle stage keys (planned ... closed).
    stage: str
    # Required when moving the machine back to an earlier stage.
    reason: str | None = None


LETTER_TEMPLATE_TITLES = {
    "delivery_cover": "Delivery Cover Letter",
    "delivery_confirmation": "Delivery Confirmation",
    "guarantee_certificate": "Guarantee Certificate for Quality",
}


def _txt(data: dict, key: str) -> str:
    v = data.get(key)
    return v.strip() if isinstance(v, str) else ""


class ProjectLetterCreate(BaseModel):
    letter_type: Literal["general", "delivery_cover", "delivery_confirmation", "guarantee_certificate"] = "general"
    letter_date: date
    recipient: str = ""
    subject: str = ""
    body: str = ""
    signatory_name: str | None = None
    signatory_designation: str | None = None
    # Structured fields of a templated delivery document (ignored for "general").
    data: dict[str, Any] | None = None

    @model_validator(mode="after")
    def _check(self):
        if self.letter_type == "general":
            self.data = None
            for field, label in (("recipient", "Recipient (To)"), ("subject", "Subject"), ("body", "Letter body")):
                value = (getattr(self, field) or "").strip()
                if not value:
                    raise ValueError(f"{label} is required.")
                setattr(self, field, value)
            if len(self.subject) > 300:
                raise ValueError(f"Subject is {len(self.subject)} characters — keep it under 300.")
            return self

        data = dict(self.data or {})
        missing: list[str] = []
        if not _txt(data, "loa_ref"):
            missing.append("LOA / PO reference — every delivery document quotes the order it is supplied against")
        if self.letter_type in ("delivery_cover", "delivery_confirmation"):
            if not _txt(data, "client"):
                missing.append("Client")
            if not _txt(data, "invoice_no"):
                missing.append("Invoice No. — the invoice the machine was billed on")
        if self.letter_type == "delivery_confirmation":
            if not _txt(data, "delivery_note_no"):
                missing.append("Delivery Note No.")
            items = [i for i in (data.get("items") or []) if isinstance(i, dict) and (str(i.get("challan_no") or "").strip() or str(i.get("description") or "").strip())]
            if not items:
                missing.append("at least one delivery challan line (challan no. + item delivered)")
            for n, i in enumerate(items, 1):
                if not str(i.get("challan_no") or "").strip() or not str(i.get("description") or "").strip():
                    missing.append(f"challan line {n} needs both the challan no. and the item delivered")
            data["items"] = [{"challan_no": str(i.get("challan_no") or "").strip(), "description": str(i.get("description") or "").strip()} for i in items]
        if self.letter_type == "delivery_cover":
            docs = [str(d).strip() for d in (data.get("documents") or []) if str(d).strip()]
            if not docs:
                missing.append("at least one enclosed document in the list")
            data["documents"] = docs
        if self.letter_type == "guarantee_certificate":
            if not _txt(data, "recipient"):
                missing.append("To (who the certificate is addressed to)")
            if not _txt(data, "supply_description"):
                missing.append("What is guaranteed (machine + project)")
            for key, label in (("months_commissioning", "Months from commissioning"), ("months_supply", "Months from supply")):
                try:
                    months = int(data.get(key))
                    if months <= 0:
                        raise ValueError
                    data[key] = months
                except (TypeError, ValueError):
                    missing.append(f"{label} (a whole number above 0)")
        if missing:
            raise ValueError("Please fill: " + "; ".join(missing) + ".")

        # Subject/recipient are derived so the Documents list and audit log stay readable.
        self.subject = LETTER_TEMPLATE_TITLES[self.letter_type]
        self.recipient = _txt(data, "recipient") if self.letter_type == "guarantee_certificate" else (_txt(data, "receiver_org") or _txt(data, "client"))
        self.body = ""
        self.data = data
        return self


class ProjectLetterUpdate(ProjectLetterCreate):
    pass


class ProjectLetterResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    project_id: int
    letter_no: str
    revision: int = 0
    letter_date: date
    recipient: str
    subject: str
    body: str
    signatory_name: str | None = None
    signatory_designation: str | None = None
    letter_type: str = "general"
    data: dict[str, Any] | None = None
    created_by_id: int | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    created_by_name: str | None = None
