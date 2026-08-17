# Entity-Relationship Diagrams

Derived from the real SQLAlchemy models under `backend/app/modules/*/models/*.py` and
cross-checked against `backend/alembic/versions/`. Split into one diagram per module
group because a single company-wide diagram is unreadable at this table count. See
[SCHEMA.md](SCHEMA.md) for full column listings and [RELATIONSHIPS.md](RELATIONSHIPS.md)
for FK/cardinality prose.

## Main module (users, audit, notifications, feedback, API keys)

```mermaid
erDiagram
    USERS {
        int id PK
        string email UK
        string azure_id UK
    }
    AUDIT_LOGS {
        int id PK
        string entity_type
        int entity_id
        int user_id FK
    }
    NOTIFICATIONS {
        int id PK
        int user_id FK
    }
    API_KEYS {
        int id PK
        string key_hash UK
    }
    FEEDBACK {
        int id PK
        int user_id FK
    }

    USERS ||--o{ AUDIT_LOGS : "acts (loosely, no FK constraint)"
    USERS ||--o{ NOTIFICATIONS : "receives"
    USERS ||--o{ FEEDBACK : "submits"
```

> Note: `audit_logs.user_id` and `notifications.user_id` / `feedback.user_id` are
> plain indexed integer columns, **not** declared `ForeignKey("users.id")` in the model
> files inspected — see [INDEXES.md](INDEXES.md) and [RELATIONSHIPS.md](RELATIONSHIPS.md)
> for what's an enforced FK vs. an application-level reference only.

## ERP module (Projects → Service Requests → Materials)

```mermaid
erDiagram
    ERP_PROJECTS {
        int id PK
        string serial_number UK
        string status
        bool is_deleted "soft delete"
    }
    ERP_SERVICE_REQUESTS {
        int id PK
        string request_number UK
        int project_id FK
        int assigned_service_person_id
        int created_by_id
        bool is_deleted "soft delete"
    }
    ERP_SERVICE_MATERIALS {
        int id PK
        int service_request_id FK
        string material_name
        float quantity
        bool is_deleted "soft delete"
    }
    PROJECT_ATTACHMENTS {
        int id PK
        int project_id FK
        bool is_private
        string sharepoint_path
    }
    PROJECT_ATTACHMENT_SHARES {
        int id PK
        int attachment_id FK
        int user_id FK
        string department
        string designation
    }
    ERP_SERVICE_REQUEST_ATTACHMENTS {
        int id PK
        int service_request_id FK
    }
    ERP_SERVICE_MATERIAL_ATTACHMENTS {
        int id PK
        int service_material_id FK
    }

    ERP_PROJECTS ||--o{ ERP_SERVICE_REQUESTS : "has"
    ERP_PROJECTS ||--o{ PROJECT_ATTACHMENTS : "has"
    PROJECT_ATTACHMENTS ||--o{ PROJECT_ATTACHMENT_SHARES : "shared with"
    ERP_SERVICE_REQUESTS ||--o{ ERP_SERVICE_MATERIALS : "needs"
    ERP_SERVICE_REQUESTS ||--o{ ERP_SERVICE_REQUEST_ATTACHMENTS : "has"
    ERP_SERVICE_MATERIALS ||--o{ ERP_SERVICE_MATERIAL_ATTACHMENTS : "has"
```

## Purchase module (ERP-origin PR) vs. Purchase Requisition module (standalone PR)

Two intentionally decoupled tables/lifecycles — see
[ADR 0003](../adr/0003-independent-p2p-module.md).

```mermaid
erDiagram
    ERP_SERVICE_REQUESTS_REF["erp_service_requests (see ERP diagram)"] {
        int id PK
    }
    ERP_SERVICE_MATERIALS_REF["erp_service_materials (see ERP diagram)"] {
        int id PK
    }
    PURCHASE_REQUISITIONS {
        int id PK
        string pr_number UK
        int project_id FK
        int service_request_id FK
        int raised_by_id FK
        int approver_id FK
        int approved_by_id FK
        int closed_by_id FK
        string status
    }
    PURCHASE_REQUISITION_ITEMS {
        int id PK
        int purchase_requisition_id FK
        int service_material_id FK
    }
    PR_REQUESTS {
        int id PK
        string pr_number UK
        string project_label "free text, no FK to erp_projects"
        int requested_by_id FK
        int approver_id FK
        int approved_by_id FK
        int closed_by_id FK
        int assigned_buyer_id FK
        string status
    }
    PR_REQUEST_ITEMS {
        int id PK
        int pr_request_id FK
    }
    PR_REQUEST_ATTACHMENTS {
        int id PK
        int pr_request_id FK
        int item_id FK "nullable, links to a specific item"
    }

    ERP_SERVICE_REQUESTS_REF ||--o{ PURCHASE_REQUISITIONS : "raise-pr creates"
    PURCHASE_REQUISITIONS ||--o{ PURCHASE_REQUISITION_ITEMS : "has"
    ERP_SERVICE_MATERIALS_REF ||--|| PURCHASE_REQUISITION_ITEMS : "mirrored by (1:1)"

    PR_REQUESTS ||--o{ PR_REQUEST_ITEMS : "has"
    PR_REQUESTS ||--o{ PR_REQUEST_ATTACHMENTS : "has"
    PR_REQUEST_ITEMS ||--o{ PR_REQUEST_ATTACHMENTS : "optionally linked to"
```

Note: `PURCHASE_REQUISITIONS` and `PR_REQUESTS` have **no** relationship to each other in
the schema — they are entirely separate tables with separate numbering, separate status
machines, and (per ADR 0003) deliberately no shared model/table.

## CRM module

```mermaid
erDiagram
    CRM_ORGANIZATIONS {
        int id PK
        bool is_deleted "soft delete"
    }
    CRM_ORG_CONTACTS {
        int id PK
        int organization_id FK
    }
    CRM_INQUIRIES {
        int id PK
        bool is_deleted "soft delete"
    }
    CRM_INQUIRY_TASKS {
        int id PK
        int inquiry_id FK
    }
    CRM_INQUIRY_APPROVALS {
        int id PK
        int inquiry_id FK
    }
    CRM_QUOTATIONS {
        int id PK
        int inquiry_id FK
    }
    CRM_TENDERS {
        int id PK
        bool is_deleted "soft delete"
    }
    CRM_TENDER_TASKS {
        int id PK
        int tender_id FK
    }
    CRM_TENDER_COMPETITORS {
        int id PK
        int tender_id FK
    }
    CRM_PURCHASE_ORDERS {
        int id PK
    }
    CRM_ACTIVITIES {
        int id PK
        bool is_deleted "soft delete"
    }
    CRM_ACTIVITY_ATTACHMENTS {
        int id PK
        int activity_id FK
    }
    CRM_NOTES {
        int id PK
        bool is_deleted "soft delete"
    }
    CRM_DOCUMENTS {
        int id PK
        bool is_deleted "soft delete"
    }
    CRM_DISCUSSIONS {
        int id PK
    }
    CRM_STAGE_LOGS {
        int id PK
    }

    CRM_ORGANIZATIONS ||--o{ CRM_ORG_CONTACTS : "has"
    CRM_ORGANIZATIONS ||--o{ CRM_INQUIRIES : "has"
    CRM_ORGANIZATIONS ||--o{ CRM_TENDERS : "has"
    CRM_INQUIRIES ||--o{ CRM_INQUIRY_TASKS : "has"
    CRM_INQUIRIES ||--o{ CRM_INQUIRY_APPROVALS : "has"
    CRM_INQUIRIES ||--o{ CRM_QUOTATIONS : "has"
    CRM_TENDERS ||--o{ CRM_TENDER_TASKS : "has"
    CRM_TENDERS ||--o{ CRM_TENDER_COMPETITORS : "has"
    CRM_ACTIVITIES ||--o{ CRM_ACTIVITY_ATTACHMENTS : "has"
```

## R&D module (calculation tools + history)

```mermaid
erDiagram
    RND_CALCULATION_HISTORY {
        int id PK
        int user_id "indexed, no FK constraint"
        string tool_name
    }
    RND_BRAKING_CALCULATIONS {
        int id PK
        int user_id "indexed, no FK constraint"
    }
    RND_HYDRAULIC_CALCULATIONS {
        int id PK
        int user_id
    }
    RND_LOAD_DISTRIBUTION_CALCULATIONS {
        int id PK
        int user_id
    }
    RND_QMAX_CALCULATIONS {
        int id PK
        int user_id
    }
    RND_SPLINE_CALCULATIONS {
        int id PK
        int user_id
        string doc_no
    }
    RND_TRACTIVE_EFFORT_CALCULATIONS {
        int id PK
        int user_id
    }
    RND_VEHICLE_PERFORMANCE_CALCULATIONS {
        int id PK
        int user_id
    }
```

R&D's per-tool tables (`rnd_braking_calculations`, `rnd_hydraulic_calculations`, etc.)
are independent, flat result-storage tables — none declare a `ForeignKey` to `users` or
to each other in the models inspected; `user_id` is an indexed plain integer, and
`rnd_calculation_history` appears to be a separate, generic save/list/rename/delete
history table alongside (not on top of) the per-tool tables. This is worth flagging: see
[RELATIONSHIPS.md](RELATIONSHIPS.md).
