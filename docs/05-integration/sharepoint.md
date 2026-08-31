# ERP-PremnathRail — SharePoint Document Storage

**Organization:** PremnathRail
**Project:** ERP-PremnathRail
**Module:** Integration — SharePoint
**Prepared by:** Vineet Sharma
**Project Lead / Product & Technical Owner:** Vineet Sharma
**Project Sponsor & Final Approver:** Madhav Arora Sir
**Date:** 31 August 2026
**Version:** 1.0
**Status:** Current

---

# 1. Purpose

ERP-PremnathRail uses the organization's existing SharePoint infrastructure for document and file storage.

The ERP application integrates with SharePoint rather than creating a separate document-storage platform.

This document defines:

* SharePoint access architecture
* Storage structure
* Upload validation
* Download and preview behavior
* Application-level authorization
* External document sharing
* Private-site configuration
* Security boundaries

Every SharePoint operation is performed through Microsoft Graph.

---

# 2. Access Model

ERP-PremnathRail uses **application-level Graph access** for SharePoint.

The backend obtains an app-only Graph token through:

```text id="z2k3hf"
get_app_graph_token()
```

The token represents the ERP application's service identity.

Individual employees' SharePoint permissions are not used for normal ERP document operations.

---

# 3. Security Boundary

The ERP application determines whether a user can access a document.

```text id="q4v7aw"
ERP User
   ↓
ERP Authentication
   ↓
ERP Authorization
   ↓
Record / Document Permission
   ↓
Microsoft Graph
   ↓
SharePoint
```

Therefore:

**ERP permission ≠ user's direct SharePoint permission.**

---

# 4. SharePoint Site Permission

The application's service identity uses:

```text id="1qz0yw"
Sites.Selected
```

This scopes the application's SharePoint access to the specifically configured SharePoint site rather than granting broad tenant-wide SharePoint access.

---

# 5. Recommended Site Configuration

The SharePoint site should be configured as:

```text id="g6p8r2"
Private
```

Site membership should be restricted to:

* ERP application's service principal
* Required SharePoint administrators

The ERP application does not require a publicly shared SharePoint site.

---

# 6. Storage Architecture

All ERP-managed files are stored in the configured SharePoint site's document library.

Conceptually:

```text id="d1h6jf"
SharePoint Site
│
├── ERP-media
│   ├── User
│   │   ├── Project
│   │   │   └── Service Request
│
├── CRM-media
│   ├── Organization
│   └── CRM Records
│
├── P2P-media
│
└── Design-media
```

The exact folder root is configurable.

---

# 7. Folder Path Convention

The application builds folder paths using:

```text id="g3zq6n"
build_sharepoint_folder_path(
    user_name,
    project_name,
    service_request_number,
    root_folder
)
```

General structure:

```text id="a0c4p8"
{root_folder}/
    {sanitized_user_name}/
        {sanitized_project_name}/
            {record_identifier}
```

Each path segment is sanitized before being sent to SharePoint.

---

# 8. Module Storage Separation

Different application modules can use different root folders.

Examples:

```text id="z5w4qm"
ERP-media
CRM-media
P2P-media
Design-media
```

This provides logical separation while keeping the organization's existing SharePoint infrastructure centralized.

---

# 9. File Upload Validation

Files are validated before reaching Microsoft Graph.

The validation has three major layers:

### Extension and Content-Type

Only approved file types are accepted.

Dangerous formats such as:

```text id="a1f0yb"
SVG
HTML
XHTML
XML
JavaScript
```

are rejected.

### File Size

Maximum supported upload size:

```text id="w0m6yx"
2 GB
```

### Magic Bytes

The actual file content is inspected to verify that its binary signature matches the claimed file type.

This prevents simple extension or `Content-Type` spoofing.

---

# 10. Upload Size Routing

Files up to 4 MB use a single Microsoft Graph upload request.

```text id="v6w2hz"
PUT .../content
```

Files larger than 4 MB use Graph's resumable upload mechanism.

```text id="n5r7gc"
POST .../createUploadSession
```

Large files are uploaded in:

```text id="j1p6zr"
10 MB chunks
```

---

# 11. Upload Flow

```text id="r8m3dx"
Browser
   ↓
ERP Backend
   ↓
File Validation
   ↓
App-Only Graph Token
   ↓
Microsoft Graph
   ↓
SharePoint Drive
   ↓
Stored File
   ↓
Attachment Metadata
```

The SharePoint file is never uploaded directly by the browser to the SharePoint site.

---

# 12. Download Architecture

Documents are retrieved through the ERP backend.

```text id="n9z5bp"
User
 ↓
ERP Frontend
 ↓
ERP Backend
 ↓
Authorization Check
 ↓
Microsoft Graph
 ↓
SharePoint
 ↓
File Content
 ↓
ERP Backend
 ↓
User
```

The user's browser therefore does not need direct SharePoint access.

---

# 13. Backend-Proxied Content

Each attachment type uses an application-owned content endpoint.

The backend:

1. Loads the document record.
2. Checks authorization.
3. Retrieves the file through Graph.
4. Streams the bytes to the user.

The browser receives the content from the ERP application's own origin.

---

# 14. Raw SharePoint URLs

Raw SharePoint `webUrl` values are **not returned to frontend API responses**.

Although internal database fields may retain SharePoint references for record-keeping, they are not serialized into normal browser-facing responses.

This prevents:

* SharePoint URL disclosure
* Folder-structure disclosure
* Dependence on SharePoint link permissions
* Direct bypass of ERP authorization

---

# 15. Native Browser Rendering

Backend-proxied files can be rendered directly by the browser as appropriate:

```text id="s4c0pr"
Images
PDF
Video
```

This avoids depending on Microsoft's Office viewer for normal application rendering.

---

# 16. File Deletion

The SharePoint utility provides:

```text id="8f6m3z"
delete_file_from_sharepoint()
```

which performs a Graph DELETE operation against the configured SharePoint path.

The calling application route is responsible for authorization before deletion.

---

# 17. File Preview

The application can request a short-lived Microsoft preview URL through:

```text id="9m2s7c"
get_preview_url()
```

The caller must authorize the user before generating the preview URL.

Holding a valid preview URL provides access to the corresponding file during its validity period.

---

# 18. Current SharePoint Consumers

The SharePoint integration is used by:

| Module | Usage                                         |
| ------ | --------------------------------------------- |
| ERP    | Project attachments and Service Request media |
| CRM    | Activity documents and CRM document library   |
| P2P    | Purchase-request and RFQ attachments          |
| Design | Engineering documents                         |

---

# 19. External Document Sharing

Some documents must be accessible to people who do not have ERP accounts.

The primary example is:

**Technical Offer Request**

A vendor may receive a document without having:

* ERP account
* ERP session
* SharePoint account
* Direct SharePoint permission

---

# 20. SharePoint Native Sharing — Abandoned Approach

The application previously considered SharePoint's native sharing links.

This approach used Graph's `createLink` functionality for anonymous or organization-wide sharing.

It was abandoned because it depends on Microsoft 365 tenant/site sharing policy.

During testing, the approach failed with:

```text id="4k2m8v"
sharingDisabled
```

Therefore the application does not depend on SharePoint-native anonymous sharing.

---

# 21. Application-Issued Share Token

The adopted solution is a self-issued, signed, time-limited document token.

Function:

```text id="b8c1jx"
create_document_share_token(
    doc_type,
    doc_id,
    expires_hours=168
)
```

Default validity:

```text id="p4z0lm"
168 hours
7 days
```

---

# 22. Token Scope

The token contains information identifying:

```text id="9g7q2k"
Purpose
Document Type
Document ID
Expiry
```

The token is signed using the application's:

```text id="n4h6st"
SECRET_KEY
```

A token created for one document cannot be used to retrieve another document.

---

# 23. Token Verification

The application verifies:

```text id="c8q1xp"
Signature
Expiry
Purpose
Document Type
Document ID
```

using:

```text id="v7m2ka"
verify_document_share_token()
```

Only when all required values match is the token accepted.

---

# 24. External Document Endpoint

The external recipient accesses:

```text id="e5p9rz"
GET /crm/documents/{document_id}/shared-content?token=...
```

No ERP login is required.

The signed token is the only credential for that specific external document-sharing operation.

---

# 25. External Sharing Flow

```text id="k2w8fd"
CRM Document
      ↓
Create Signed Token
      ↓
Email / Share Link
      ↓
External Vendor
      ↓
ERP Shared-Content Endpoint
      ↓
Token Verification
      ↓
Microsoft Graph
      ↓
Private SharePoint
      ↓
Document Content
```

The vendor never receives the underlying SharePoint URL.

---

# 26. Why Application-Issued Tokens Are Used

The design provides:

### Independence from SharePoint Sharing Policy

The application does not depend on anonymous SharePoint sharing settings.

### Private SharePoint Site Compatibility

The SharePoint site can remain private.

### Exact Document Scope

A token identifies one specific document.

### Controlled Expiration

The application controls the token lifetime.

---

# 27. Private SharePoint Architecture

The complete architecture is:

```text id="x3c7v1"
                 ERP-PremnathRail
                       │
                       │ App-Only Graph
                       ▼
                Microsoft Graph
                       │
                       ▼
              Private SharePoint
                       │
            ┌──────────┴──────────┐
            │                     │
      ERP Authenticated       External User
            │                     │
      ERP Authorization     Signed Share Token
            │                     │
            └──────────┬──────────┘
                       ▼
                 Document Bytes
```

---

# 28. Important Security Principle

SharePoint is treated as the **backend storage layer**, not the application's user authorization system.

The ERP application remains responsible for determining who can access business documents.

---

# 29. Current Security Controls

The SharePoint integration currently provides:

* App-only Graph authentication
* `Sites.Selected` site-level application access
* Private SharePoint site compatibility
* File extension allowlisting
* Content-Type validation
* Dangerous-type rejection
* File-size limits
* Magic-byte validation
* Backend-proxied downloads
* Raw SharePoint URL suppression
* Document-specific signed sharing tokens
* Token expiration
* Document ID binding

---

# 30. Known Residual Risk

A valid external share token is a bearer credential.

If an external recipient forwards the valid URL, another person possessing that URL may access the document until the token expires.

The current design does not provide an independently verified early-revocation mechanism.

---

# 31. Document Update Rules

Update this document when:

* SharePoint site architecture changes.
* Graph permissions change.
* Storage folders change.
* Upload limits change.
* File-validation rules change.
* Attachment routes change.
* SharePoint URLs become exposed or are further restricted.
* External-sharing architecture changes.
* Signed-token behavior changes.

---

# 32. Historical Versions

Previous approved versions should be retained.

When the document is updated:

```text id="q7r2mw"
v1.0 → Current Baseline
v1.1 → Minor Change
v1.2 → Additional Integration Change
v2.0 → Major Architecture Change
```

The current version describes the active implementation; historical versions preserve previous decisions and architecture.

---

# 33. Related Documents

* Microsoft Graph Integration
* Microsoft Teams Integration
* Security Implementation Guide
* Threat Model
* Permission Matrix
* Database Schema
* Database Relationships
* Project Charter
* BRD
* PRD
* HLD
* LLD

---

# 34. Approval

| Name             | Role                                     | Signature  | Date       |
| ---------------- | ---------------------------------------- | ---------- | ---------- |
| Madhav Arora Sir | Project Sponsor & Final Approver         | __________ | __________ |
| Vineet Sharma    | Project Lead / Product & Technical Owner | __________ | __________ |

---

# 35. Document Information

**Document:** SharePoint Document Storage
**Project:** ERP-PremnathRail
**Organization:** PremnathRail
**Module:** Integration — SharePoint
**Version:** 1.0
**Status:** Current
**Prepared By:** Vineet Sharma
**Date:** 31 August 2026
