# ERP-PremnathRail — Microsoft Graph Integration

**Organization:** PremnathRail
**Project:** ERP-PremnathRail
**Module:** Integration — Microsoft Graph
**Prepared by:** Vineet Sharma
**Project Lead / Product & Technical Owner:** Vineet Sharma
**Project Sponsor & Final Approver:** Madhav Arora Sir
**Date:** 31 August 2026
**Version:** 1.0
**Status:** Current

---

# 1. Purpose

This document defines the current Microsoft Graph integration implemented in ERP-PremnathRail.

Microsoft Graph is used for:

* SharePoint document storage
* Outbound email
* Microsoft Teams activity-feed notifications
* Microsoft Teams SSO
* Microsoft Entra ID authentication-related operations

The document focuses specifically on Graph-facing implementation.

---

# 2. Integration Architecture

```text
                         ERP-PremnathRail
                                │
             ┌──────────────────┼──────────────────┐
             │                  │                  │
             ▼                  ▼                  ▼
        SharePoint            Email          Teams
             │                  │                  │
             └──────────────────┼──────────────────┘
                                ▼
                       Microsoft Graph
                                │
                                ▼
                         Microsoft 365
```

All Graph calls are made directly through HTTP using `httpx.AsyncClient`.

The application does not use the Microsoft Graph SDK.

---

# 3. Graph Endpoint

Current Graph requests are made against:

```text
https://graph.microsoft.com/v1.0
```

The backend communicates directly with Microsoft Graph using HTTP requests.

---

# 4. Application Credentials

The Graph integration uses the organization's Microsoft Entra ID application registration.

Configuration values include:

| Setting               | Purpose                        |
| --------------------- | ------------------------------ |
| `AZURE_CLIENT_ID`     | Application Entra ID client ID |
| `AZURE_CLIENT_SECRET` | Application client secret      |
| `AZURE_TENANT_ID`     | Organization Entra ID tenant   |

These credentials support two access models.

---

# 5. App-Only Access

App-only Graph access uses the client-credentials grant.

The token is acquired through:

```text
get_app_graph_token()
```

The resulting identity represents:

```text
ERP-PremnathRail Application
```

rather than an individual employee.

App-only access is used for:

* SharePoint
* Outbound email
* Teams activity notifications

---

# 6. Delegated Access

Delegated Graph access represents a signed-in user.

It is used through:

* Interactive Microsoft SSO
* Microsoft Teams SSO
* On-Behalf-Of token exchange

The delegated authentication flow is maintained separately from application authorization.

---

# 7. SharePoint Integration

**Backend source:**

```text
backend/app/utils/sharepoint.py
```

ERP-PremnathRail uses SharePoint as its document-storage system.

Examples include:

* ERP project attachments
* Service Request media
* P2P/RFQ attachments
* CRM activity documents
* CRM document library files
* Design documents

All portal-controlled SharePoint access goes through Microsoft Graph.

---

# 8. SharePoint Configuration

| Setting              | Purpose                                 |
| -------------------- | --------------------------------------- |
| `SHAREPOINT_SITE_ID` | Target SharePoint site Graph ID         |
| `SHAREPOINT_FOLDER`  | Root folder in the site's default drive |

The default root folder is:

```text
ERP-media
```

Different modules may use dedicated root folders such as:

```text
CRM-media
```

---

# 9. SharePoint Folder Convention

Folder paths are generated using:

```text
build_sharepoint_folder_path(
    user_name,
    project_name,
    service_request_number,
    root_folder
)
```

Conceptually:

```text
{root_folder}/
    {user_name}/
        {project_name}/
            {service_request_number}
```

Folder names are sanitized before being used.

---

# 10. File Upload Validation

Before a file reaches Microsoft Graph, the backend validates it.

The validation has three primary layers:

### 1. Extension and Content-Type Allowlist

Only approved file types are accepted.

The following dangerous formats are explicitly rejected:

```text
SVG
HTML
XHTML
XML
JavaScript
```

### 2. Size Limit

Maximum file size:

```text
2 GB
```

### 3. Magic-Byte Verification

The actual file bytes are checked against the expected file signature.

This prevents a malicious file from bypassing validation merely by changing its filename or `Content-Type`.

---

# 11. File Upload Implementation

Files up to 4 MB use Graph simple upload:

```text
PUT
/sites/{site-id}/drive/root:/{path}:/content
```

Files larger than 4 MB use a resumable upload session:

```text
POST .../createUploadSession
```

The file is then uploaded in:

```text
10 MB chunks
```

using `Content-Range`.

---

# 12. SharePoint File Operations

The integration provides:

### Upload

```text
upload_file_to_sharepoint()
```

### Delete

```text
delete_file_from_sharepoint()
```

### Download

```text
download_file_content()
```

### Preview

```text
get_preview_url()
```

Authorization is performed by the calling application route before sensitive file operations.

---

# 13. SharePoint Download Architecture

Files are retrieved server-side.

```text
User
 ↓
ERP Frontend
 ↓
ERP Backend
 ↓
Microsoft Graph
 ↓
SharePoint
 ↓
File
 ↓
ERP Backend
 ↓
User
```

The application therefore does not require the browser to access SharePoint directly.

---

# 14. SharePoint Preview

The backend can request a short-lived Microsoft preview URL through:

```text
POST
.../root:/{path}:/preview
```

Because possession of the preview URL provides file access, the calling route must authorize the user before requesting it.

---

# 15. Raw SharePoint URLs

Raw SharePoint `webUrl` values are not returned to the frontend.

The database may retain SharePoint references internally, but API response schemas do not expose direct SharePoint URLs.

Instead, the application uses backend-proxied content endpoints.

---

# 16. Benefits of Backend-Proxied Documents

The architecture provides:

* Application-level authorization
* Hidden SharePoint site structure
* Hidden SharePoint folder paths
* Same-origin document rendering
* Reduced dependency on Microsoft's Office viewer
* Centralized document-access control

---

# 17. SharePoint Callers

Current backend modules calling the SharePoint integration include:

```text
ERP Projects
ERP Service Requests
P2P Requests
CRM Activities
CRM Documents
Design
```

---

# 18. SharePoint Upload Flow

```text
Browser
   ↓
Backend Route
   ↓
File Validation
   ↓
App-Only Graph Token
   ↓
Microsoft Graph
   ↓
SharePoint Drive
   ↓
File Stored
   ↓
Metadata Returned
```

The frontend receives application-level file metadata rather than the raw SharePoint URL.

---

# 19. Email Integration

**Backend source:**

```text
backend/app/utils/email.py
```

ERP-PremnathRail sends outbound email through Microsoft Graph.

The application does not use SMTP.

---

# 20. Email API

Email is sent through:

```text
POST
/v1.0/users/{sender}/sendMail
```

The sender mailbox is configured through:

```text
SENDER_EMAIL
```

Internal team notifications use:

```text
TEAM_EMAIL
```

where applicable.

---

# 21. Email Authentication

Email uses the same app-only Graph identity as SharePoint.

Conceptually:

```text
ERP Backend
     ↓
App-Only Graph Token
     ↓
Microsoft Graph
     ↓
Sender Mailbox
     ↓
Recipient
```

---

# 22. Email Logo Handling

The company logo is embedded as a base64 CID inline attachment.

This avoids depending on:

* Public image hosting
* External image URLs
* Mail clients allowing remote images

---

# 23. In-App Notifications

**Backend source:**

```text
backend/app/utils/notifications.py
```

The primary notification mechanism is database-backed.

Functions include:

```text
broadcast_notification()
notify_user()
```

Notifications are stored in the application's `Notification` table.

---

# 24. Teams Activity Notifications

For users with an Azure/Entra identifier, the application can also send native Microsoft Teams activity-feed notifications.

Graph endpoint:

```text
POST
/users/{azure_user_id}/teamwork/sendActivityNotification
```

The notification appears inside Teams as appropriate.

---

# 25. Teams Notification Flow

```text
ERP Business Event
        ↓
Notification Service
        ↓
Database Notification
        ↓
Microsoft Graph
        ↓
Teams Activity Feed
        ↓
User
```

Failure to send the Teams notification does not block the underlying in-app notification.

---

# 26. Teams Deep Link

The Teams notification payload contains a `webUrl`.

The URL points back to the deployed ERP-PremnathRail application.

The embedded Teams application ID must match the Teams application's catalog/manifest ID.

---

# 27. Microsoft Entra ID Authentication

Microsoft Entra ID provides the application's Microsoft SSO mechanism.

The authentication flow uses:

```text
AZURE_CLIENT_ID
AZURE_CLIENT_SECRET
AZURE_TENANT_ID
```

The interactive login uses OAuth authorization-code flow.

---

# 28. Authentication Flow

```text
User
 ↓
ERP Login
 ↓
Microsoft Entra ID
 ↓
Microsoft Authentication
 ↓
OAuth Callback
 ↓
ERP Session
 ↓
Authenticated User
```

The complete application authorization model is documented separately.

---

# 29. Microsoft Teams SSO

Teams SSO uses an additional On-Behalf-Of exchange.

Conceptually:

```text
Teams
 ↓
Teams Identity Token
 ↓
ERP Backend
 ↓
Token Validation
 ↓
On-Behalf-Of Exchange
 ↓
Microsoft Graph
```

The Teams-specific implementation is maintained separately from normal web SSO.

---

# 30. Graph Access Model

The current Graph architecture can be summarized as:

| Capability                   | Access Type                   |
| ---------------------------- | ----------------------------- |
| SharePoint                   | App-only                      |
| Email                        | App-only                      |
| Teams Activity Notifications | App-only                      |
| Interactive Microsoft Login  | Delegated/user authentication |
| Teams SSO Graph operations   | Delegated / OBO               |

---

# 31. Security Boundary

Microsoft Graph access is backend-controlled.

The frontend does not receive:

* Client secrets
* App-only Graph tokens
* SharePoint application credentials

Sensitive Microsoft credentials remain server-side.

---

# 32. External Document Sharing

Documents that must be accessed by users without an ERP account use a separate signed-link mechanism.

The general architecture is:

```text
ERP Document
      ↓
Signed Share Token
      ↓
External Recipient
      ↓
ERP Backend
      ↓
Microsoft Graph
      ↓
SharePoint
```

The underlying SharePoint URL remains hidden.

The detailed signed-link model belongs in the SharePoint Document Storage documentation.

---

# 33. Capabilities Not Currently Implemented

The current codebase does **not** contain Graph integrations for:

* Microsoft Calendar
* Outlook Events
* Microsoft Planner
* Microsoft 365 Copilot
* Copilot Studio

These should only be added through a future approved integration.

---

# 34. Integration Change Rules

Update this document when:

* A new Microsoft Graph capability is introduced.
* A Graph endpoint changes.
* App permissions change.
* SharePoint architecture changes.
* Email architecture changes.
* Teams notification architecture changes.
* Teams SSO changes.
* Authentication flow changes.
* Graph credential architecture changes.

Minor implementation changes that do not alter the integration design do not require a major document revision.

---

# 35. Version Control

```text
v1.0
Current Microsoft Graph integration baseline

v1.1
Minor integration changes

v1.2
Additional Graph capability

v2.0
Major Microsoft 365 / Graph architecture change
```

Previous approved versions should be retained.

---

# 36. Related Documents

* Project Charter
* BRD
* PRD
* Scope Document
* Software Architecture Document
* HLD
* LLD
* Security Implementation Guide
* Permission Matrix
* Threat Model
* SharePoint Document Storage
* Microsoft Teams Integration
* API Documentation

---

# 37. Approval

| Name             | Role                                     | Signature  | Date       |
| ---------------- | ---------------------------------------- | ---------- | ---------- |
| Madhav Arora Sir | Project Sponsor & Final Approver         | __________ | __________ |
| Vineet Sharma    | Project Lead / Product & Technical Owner | __________ | __________ |

---

# 38. Document Status

**Document:** Microsoft Graph Integration
**Project:** ERP-PremnathRail
**Organization:** PremnathRail
**Version:** 1.0
**Status:** Current
**Prepared By:** Vineet Sharma
**Date:** 31 August 2026
