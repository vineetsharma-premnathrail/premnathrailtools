# Customer Organization form: Domestic / International first, scope-specific tax fields

Owner request (2026-10-26), implementation plan given in chat:
1. Organization Scope: ask **Domestic or International** first.
2. Customer Organization Type: show the existing options second.
3. Customer Organization Name: ask third.
4. Dynamic fields: Domestic shows **GSTIN, PAN and GST State Code**; International shows **Tax/VAT ID and Company Registration Number**.
5. Country: an independent field; it must NOT determine the scope.
6. Validation: required fields and scope-specific formats.
7. Save: persist the organization and its contact persons; record audit logs.
8. Testing: both scopes, field switching, validation, saving and editing.
Size L (CRM, one migration). Core-flow position: Customer / BD. CRM UI changes: the CRM guided-tour configs MUST be updated (`frontend/src/lib/tour/configs/crmOrganizationForm.ts`, `crmOrganizationDetail.ts`, `crmOrganizationsList.ts` as needed) before any push.

## Facts
- Model `backend/app/modules/crm/models/organization.py`, table `crm_organizations`: existing `org_type`, `country` (default "India"), `gst_number` (unique, String 30), `pan` (String 10), `gst_state_code` (String 2), state, city, pin_code, contacts (`OrgContact`) etc. There is NO scope field, NO Tax/VAT ID and NO Company Registration Number today.
- Schemas `backend/app/modules/crm/schemas/organization.py` (`OrganizationCreate`, `OrganizationUpdate`, response): GST format validator `validate_gst_format`; org_type required; PAN derived from GSTIN chars 3-12 and `gst_state_code` from chars 1-2 (see the route / helpers that fill them).
- Form `frontend/src/components/crm/OrganizationForm.tsx` (663 lines, FormPage standard), used by the create and edit pages; detail panel `OrganizationDetailPanel.tsx`.
- Other code reads `gst_number` / `pan` / `gst_state_code` (Sales place of supply, Finance, imports, exports): do not rename or drop them.

## Data (database-agent, ONE migration)
- Add to `crm_organizations`: `org_scope` String(15) NOT NULL server_default `domestic` with CheckConstraint (`domestic`,`international`); `tax_vat_id` String(50) NULL; `company_registration_no` String(50) NULL.
- Back-fill in the migration: `org_scope = 'international'` where `country` is not null and not 'India' and `gst_number` is null; everything else stays `domestic`. (Back-fill is a heuristic for old rows only; going forward country does NOT decide scope.) Index on `org_scope` is not needed.
- `down_revision` = the single head at launch (`alembic heads`; expected e2a7c5b9d1f3, already applied locally). Upgrade and downgrade, inspector guards like recent migrations. Do not run `alembic upgrade`, never touch a database. The Manager adds nothing to main.py/env.py (no new model file).
- Update the model `Organization` with the three columns.

## Backend (backend-agent) - files under `backend/app/modules/crm/` only (+ tests)
- Schemas: `OrganizationCreate` gets `org_scope: Literal["domestic","international"]` (REQUIRED), `tax_vat_id`, `company_registration_no`; `OrganizationUpdate` accepts them; responses return them. Keep `country` independent: no validator may derive or force scope from country, and no scope from country.
- Validation (real messages, reason + how to fix, no SAP words):
  - Required on create: scope, `org_type` (existing), `name`. (Scope can be changed on edit; switching scope clears the other scope's tax fields on save: Domestic -> clear `tax_vat_id` and `company_registration_no`; International -> clear `gst_number`, `pan`, `gst_state_code`.)
  - Domestic: `gst_number` (GSTIN) optional but, when given, the standard 15-character GSTIN format (reuse `validate_gst_format`, uppercase), `pan` optional but, when given, `AAAAA9999A` format; if both are given PAN must equal GSTIN chars 3-12 (existing derivation rule: keep it) and `gst_state_code` must be 2 digits and equal GSTIN chars 1-2 when GSTIN is given; fill `pan` and `gst_state_code` from the GSTIN when blank (existing behaviour). A domestic organization must not carry `tax_vat_id` / `company_registration_no` (422 naming the field if sent).
  - International: `tax_vat_id` optional but, when given, 2-50 chars of letters, digits, spaces, `-`, `.`, `/` (no country-specific VAT checks); `company_registration_no` same rule; `gst_number`, `pan`, `gst_state_code` must not be sent (422 naming the field and saying to switch to Domestic or clear it). Country may be any country, including India.
  - Duplicate checks that exist today for GSTIN keep working; add a duplicate check for `tax_vat_id` + country among international organizations (409 naming the existing organization, same style as the GST one).
- Routes: create/update persist the organization AND its contact persons exactly as today (do not break the contacts flow); write the audit rows the way the other CRM routes do (`record_audit`; changed-field summary must include scope, tax_vat_id and company_registration_no; creating a contact is audited; find how the existing organization routes audit and follow it). Org list/search endpoints: add `org_scope` as an optional filter param and return the new fields; import/export (bulk import of organizations, Excel export) keep working with the new columns (export gets Scope, Tax/VAT ID, Company Registration No columns; import defaults scope from an optional `Scope` column, else `domestic`).
- Tests `backend/app/tests/test_crm_org_scope.py`: create domestic with GSTIN (PAN and state code derived), create domestic with PAN only, create international with Tax/VAT ID and registration number, international organization in India allowed (country independent), domestic with a foreign country allowed, scope required (422), wrong-scope fields rejected with the field named, GSTIN/PAN/state-code format and mismatch errors, tax_vat_id format, duplicates (GSTIN, tax_vat_id+country), editing and switching scope clears the other fields, contacts saved with the organization, audit rows written (and contain the new fields), list filter by scope, export columns. Existing CRM organization tests must pass unchanged (adjust only if the new required `org_scope` forces it: then default missing scope to `domestic` ONLY in tests' helpers, not in production code; production create requires it).
- Run `python -m pytest app/tests -k "crm and (organization or org)" -q`, the new file, and `ruff check --select F821 --target-version py312 app alembic`.

## Frontend (frontend-agent)
Files: `frontend/src/components/crm/OrganizationForm.tsx`, `frontend/src/components/crm/OrganizationDetailPanel.tsx` (show Scope, and Tax/VAT ID + Company Registration No for international, GSTIN/PAN/GST State Code for domestic), the organizations list page/component if it has filters or columns (add a Scope filter in the Filters popup and a Scope column only if the list pattern allows; keep TableFit rules), `frontend/src/types/index.ts` is Manager-only: the Manager already added `org_scope`, `tax_vat_id`, `company_registration_no` to the Organization types (use them), CRM tour configs `crmOrganizationForm.ts`, `crmOrganizationDetail.ts`, `crmOrganizationsList.ts`.
- Field ORDER in the form (FormPage standard, one section "Organization"): 1) **Organization Scope \*** (two clear choices, Domestic / International, as a segmented control with the same height as inputs; no default pre-selected on create so the requester must choose; on edit it shows the saved value), 2) **Customer Organization Type \*** (existing options and behaviour, incl. railway fields rules and the "Other" custom), 3) **Customer Organization Name \***, then the scope-specific tax fields: Domestic -> GSTIN, PAN, GST State Code (keep the existing auto-fill: typing a GSTIN fills PAN and state code; uppercase; 15 / 10 / 2 length hints); International -> Tax / VAT ID, Company Registration Number; 4) **Country** is an independent field (searchable shared Select, default India for a new Domestic organization, empty for International until chosen; changing scope NEVER changes country and changing country NEVER changes scope); the state list follows the existing rule (India -> state list, other -> free text) independent of scope. Until the scope is chosen the fields below it are disabled with a hint "Choose Domestic or International first" (gated dependent fields, per the UI checklist).
- Switching scope on the form clears the other scope's tax fields after a ConfirmDialog only when they hold values ("Switching to International clears GSTIN, PAN and GST State Code. Continue?").
- Client validation mirrors the backend (real messages, field-level, scroll to first error); show backend 422/409 texts as is.
- Contacts section and everything else on the form stays as it is.
- Tour configs updated for the new order and fields (the CRM tour rule). Plain words.
- Use `Select` (shared), `FormPage`/`SheetSection`, no native select, no window dialogs, popups via createPortal.
- Checks: `npx tsc --noEmit` clean, `npm run test:ui` 0 errors.

## Not in scope
Country-specific VAT/registration validation, changing quotations' Domestic/Export type, Finance/Sales field changes.

## Acceptance
Create flow asks Scope, then Type, then Name; Domestic shows GSTIN/PAN/GST State Code, International shows Tax/VAT ID and Company Registration Number; country is independent in both directions; validation messages are specific; save persists the organization and contacts and writes audit rows; edit works including switching scope; old organizations show a sensible scope; migration single head, ruff F821 py312 clean, targeted pytest green, tsc clean, test:ui 0 errors, CRM tours updated.
