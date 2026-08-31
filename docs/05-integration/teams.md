# ERP-PremnathRail — Microsoft Teams Integration

**Organization:** PremnathRail
**Project:** ERP-PremnathRail
**Module:** Integration — Microsoft Teams
**Prepared by:** Vineet Sharma
**Project Lead / Product & Technical Owner:** Vineet Sharma
**Project Sponsor & Final Approver:** Madhav Arora Sir
**Date:** 31 August 2026
**Version:** 1.0
**Status:** Current

---

# 1. Purpose

ERP-PremnathRail uses Microsoft Teams as an organizational collaboration environment.

The ERP application is available through Teams as an additional access channel alongside the standard web application.

The current Teams integration provides:

* Microsoft Teams Single Sign-On (SSO)
* Silent SSO
* Popup SSO fallback
* Teams activity-feed notifications
* Teams application packaging
* Teams Admin Center deployment

The current implementation does **not** include a Teams bot, message extension, or adaptive-card application.

---

# 2. Integration Architecture

```text id="tms1"
Microsoft Teams
      │
      ├── Teams Tab
      │      ↓
      │   ERP Web App
      │
      ├── Teams SSO
      │      ↓
      │   ERP Backend
      │
      └── Activity Notifications
             ↓
        Microsoft Graph
             ↓
          User Teams
```

---

# 3. Why Teams SSO Exists

The ERP application can run inside a Teams iframe.

Normal browser authentication can be inconvenient inside an embedded Teams tab because of iframe, cookie, and popup restrictions.

Teams SSO allows an already authenticated Teams user to access ERP-PremnathRail without requiring a separate normal login whenever silent authentication is available.

The resulting ERP session is the same application session used by the normal browser authentication flow.

---

# 4. Teams Integration Components

| Component            | Location                                       |
| -------------------- | ---------------------------------------------- |
| Teams authentication | `backend/app/modules/main/routes/auth.py`      |
| Teams notifications  | `backend/app/utils/notifications.py`           |
| Login integration    | `frontend/src/app/login/page.tsx`              |
| Teams success page   | `frontend/src/app/auth/teams-success/page.tsx` |
| Teams package        | `teams-app/`                                   |

---

# 5. Teams SSO — Silent Flow

The preferred Teams authentication path is silent SSO.

```text id="tms2"
Teams User
    ↓
ERP Login Page
    ↓
Teams JS SDK
    ↓
teams.app.initialize()
    ↓
teams.authentication.getAuthToken()
    ↓
Teams-issued Entra Token
    ↓
POST /auth/teams-token
    ↓
Backend Token Verification
    ↓
User Lookup / Creation
    ↓
ERP Session Cookie
```

---

# 6. Teams JavaScript SDK

The frontend dynamically loads the Microsoft Teams JavaScript SDK.

The login page uses:

```text id="tms3"
@ microsoft/teams-js
```

The SDK is used only for Teams client authentication and detection.

It does not directly perform Microsoft Graph operations.

---

# 7. Teams Token Verification

The backend does not trust the Teams token without validation.

The token is independently verified against Microsoft Entra ID's JWKS.

Validation includes:

* JWT signature
* Audience
* Issuer
* Token structure
* Replay protection

---

# 8. Replay Protection

The Teams SSO implementation tracks the JWT:

```text id="tms4"
jti
```

claim.

A previously used token cannot simply be submitted again.

This protects the Teams authentication endpoint against token replay.

---

# 9. User Mapping

After successful token validation, the backend creates or updates the local:

```text id="tms5"
User
```

record.

The primary identity mapping uses:

```text id="tms6"
azure_id
```

The authenticated Microsoft identity therefore becomes the corresponding ERP user identity.

---

# 10. Session Creation

After successful Teams SSO:

```text id="tms7"
Teams Token
      ↓
Validated Identity
      ↓
Local ERP User
      ↓
ERP Session
      ↓
session_token
```

The resulting ERP session is compatible with the application's normal authorization system.

---

# 11. On-Behalf-Of Token Exchange

After successful silent SSO, the backend performs a best-effort Microsoft On-Behalf-Of exchange.

The implementation uses:

```text id="tms8"
acquire_token_on_behalf_of()
```

The delegated Graph token can provide scopes such as:

```text id="tms9"
User.Read
Directory.Read.All
User.Read.All
```

---

# 12. OBO Failure Behavior

The OBO operation is intentionally best-effort.

If the OBO exchange fails:

```text id="tms10"
Teams Authentication
       ↓
       ✓
ERP Session
       ↓
       ✓
```

The user's ERP login still succeeds.

Only features requiring delegated Graph access may be affected.

SharePoint operations that use the application's app-only Graph identity remain unaffected.

---

# 13. Popup SSO Fallback

If silent SSO fails, the application uses Teams' popup authentication flow.

Typical reasons include:

* First-time consent
* Incorrect Teams SSO configuration
* Missing Azure application configuration

Flow:

```text id="tms11"
Silent SSO
   ↓
Failure
   ↓
teams.authentication.authenticate()
   ↓
Browser Popup
   ↓
Microsoft OAuth
   ↓
/auth/teams-success
   ↓
One-Time Code
   ↓
Teams Main Frame
   ↓
/auth/teams-exchange
   ↓
ERP Session
```

---

# 14. Popup Success Page

The Teams popup loads:

```text id="tms12"
/auth/teams-success
```

The page uses:

```text id="tms13"
notifySuccess(code)
```

to send a one-time authorization code back to the Teams main frame.

The popup cannot reliably establish the final session itself because it operates in a separate cookie context.

---

# 15. Teams Exchange Endpoint

The main Teams frame submits the one-time code to:

```text id="tms14"
POST /auth/teams-exchange
```

The backend exchanges the code for the actual ERP session cookies.

This endpoint exists specifically for the popup authentication handoff.

It is not used by the silent SSO flow.

---

# 16. Teams SSO Test Coverage

Dedicated tests are maintained in:

```text id="tms15"
backend/app/tests/test_teams_sso.py
```

The tests cover:

* Missing token
* Malformed token
* Incorrect audience
* Incorrect issuer
* Replay attempts
* Successful session creation
* OBO failure handling

---

# 17. Azure App Registration Requirements

Silent Teams SSO depends on the Microsoft Entra application registration being correctly configured.

The application registration must expose an API.

---

# 18. Application ID URI

The Application ID URI follows:

```text id="tms16"
api://{deployed-domain}/{AZURE_CLIENT_ID}
```

This value must match the Teams manifest:

```text id="tms17"
webApplicationInfo.resource
```

exactly.

---

# 19. Required Teams Scope

The exposed API requires a scope named:

```text id="tms18"
access_as_user
```

The Teams client applications must be pre-authorized against this scope.

The relevant clients include:

* Teams desktop
* Teams web
* Teams mobile

---

# 20. Silent SSO Failure

If the Azure application registration is incorrectly configured:

```text id="tms19"
Silent SSO
   ↓
Failure
   ↓
Popup SSO
```

The ERP remains usable, but users must complete the additional popup authentication flow.

---

# 21. Teams Iframe Configuration

The ERP application must explicitly allow Teams to embed the application.

The frontend configuration includes:

```text id="tms20"
Content-Security-Policy:
frame-ancestors
```

with the relevant Teams domains.

---

# 22. X-Frame-Options

The application does not rely on:

```text id="tms21"
X-Frame-Options: ALLOW-FROM
```

because this mechanism is not suitable for modern Chromium-based Teams environments.

Teams iframe permission is controlled through CSP `frame-ancestors`.

---

# 23. Teams Cookie Configuration

When:

```text id="tms22"
SECURE_COOKIES=true
```

the backend session cookies use:

```text id="tms23"
SameSite=None
Secure
HttpOnly
```

This allows the session cookie to work when the application is embedded inside the cross-site Teams iframe.

---

# 24. Teams Activity-Feed Notifications

Teams integration also supports native Teams activity notifications.

Source:

```text id="tms24"
backend/app/utils/notifications.py
```

The notification is sent when the application creates an in-app notification for a user who has an `azure_id`.

---

# 25. Teams Notification Architecture

```text id="tms25"
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

The database notification remains the primary application notification.

Teams provides an additional notification surface.

---

# 26. Graph Activity Notification API

The application sends Teams activity notifications through:

```text id="tms26"
POST
https://graph.microsoft.com/v1.0/users/{azure_user_id}/teamwork/sendActivityNotification
```

The request uses an app-only Microsoft Graph token.

---

# 27. Teams Notification Authentication

The notification service obtains the Graph token using the application's Microsoft Entra identity.

The token acquisition follows the client-credentials pattern.

This is separate from the user's delegated Teams SSO token.

---

# 28. Teams Deep Links

Activity notifications contain a:

```text id="tms27"
webUrl
```

that opens the relevant ERP application page inside Teams.

The Teams application ID used for the deep link must match the ID published in the Teams application manifest.

---

# 29. Teams Notification Failure Handling

If the Teams activity-feed push fails:

```text id="tms28"
Teams Push
   ↓
Failure
   ↓
Log Error
   ↓
Continue
```

The underlying in-app notification is not rolled back.

Therefore:

**Teams notification failure does not prevent the ERP notification from being created.**

---

# 30. Teams Application Package

The Teams application package is located under:

```text id="tms29"
teams-app/
```

The package contains three root-level files:

```text id="tms30"
manifest.json
color.png
outline.png
```

---

# 31. Teams Icons

Required icon files:

| File          |      Size | Purpose                        |
| ------------- | --------: | ------------------------------ |
| `color.png`   | 192 × 192 | Full-color application icon    |
| `outline.png` |   32 × 32 | White/transparent outline icon |

The icons must remain at the ZIP root.

---

# 32. Teams Manifest

The manifest contains:

* Teams application ID
* Application metadata
* Static tab configuration
* Valid domains
* Azure application configuration
* Website information
* Version

The manifest currently assumes the deployed ERP domain:

```text id="tms31"
erp.premnathrailtools.cloud
```

---

# 33. Existing Teams Application ID

The current manifest reuses the existing Teams application's ID.

Therefore uploading the package as currently configured is treated as an update to the existing:

```text id="tms32"
Premnathrail Portal
```

rather than creation of a completely new Teams listing.

---

# 34. New Teams Application

If a new Teams application listing is required, a new GUID must be generated for:

```text id="tms33"
manifest.json → id
```

The Azure application configuration must also be aligned with the new application.

---

# 35. Deployment Domain Changes

If the ERP deployment domain changes, update:

```text id="tms34"
developer.websiteUrl
staticTabs[0].contentUrl
staticTabs[0].websiteUrl
validDomains
```

The Azure/Teams SSO configuration must also remain consistent with the deployed domain.

---

# 36. Manifest Version

The Teams manifest `version` must be incremented for every re-upload.

A package with the same version as the currently installed application will not be treated as a new update.

Example:

```text id="tms35"
1.0.0
 ↓
1.0.1
 ↓
1.0.2
```

---

# 37. Teams Package Creation

The package is created from the `teams-app` directory using:

```text id="tms36"
Compress-Archive -Path manifest.json, color.png, outline.png -DestinationPath ..\PremnathrailPortal-Ideal-Teams.zip -Force
```

The ZIP contains the three required files at its root.

---

# 38. Teams Admin Center Deployment

The package is uploaded through:

```text id="tms37"
Teams Admin Center
 → Teams apps
 → Manage apps
 → Upload new app
```

After administrator approval, users can access the application through:

```text id="tms38"
Teams
 → Apps
 → Built for your org
```

---

# 39. Current Teams Scope

The current Teams integration includes:

```text id="tms39"
✓ Teams application/tab
✓ Teams SSO
✓ Silent SSO
✓ Popup fallback
✓ Teams activity notifications
✓ Teams deep links
✓ Teams app packaging
✓ Teams Admin Center deployment
```

---

# 40. Not Currently Implemented

The current implementation does **not** include:

```text id="tms40"
✗ Teams Bot
✗ Message Extension
✗ Adaptive Cards
✗ Teams Chat Bot
✗ Teams Meeting App
```

These should be treated as future integration capabilities only if separately approved.

---

# 41. Integration Security Model

The Teams integration uses separate identities for separate purposes:

```text id="tms41"
Teams User
     ↓
Teams SSO Token
     ↓
ERP Authentication

ERP Application
     ↓
App-Only Graph Token
     ↓
Teams Activity Notification
```

This separation prevents Teams notification delivery from depending on an individual user's delegated token.

---

# 42. Configuration Dependencies

The Teams integration depends on correct configuration of:

* `AZURE_CLIENT_ID`
* `AZURE_CLIENT_SECRET`
* `AZURE_TENANT_ID`
* Teams application ID
* Teams manifest
* Application ID URI
* `access_as_user`
* Deployment domain
* `SECURE_COOKIES`
* Microsoft Graph permissions

---

# 43. Troubleshooting Areas

When Teams SSO does not work, verify:

1. Azure application registration.
2. Application ID URI.
3. `access_as_user` scope.
4. Teams manifest `webApplicationInfo`.
5. Teams application ID.
6. Deployment domain.
7. CSP `frame-ancestors`.
8. Secure cookie configuration.

When Teams activity notifications fail, verify:

1. `TEAMS_APP_ID`.
2. User `azure_id`.
3. App-only Graph permissions.
4. Microsoft Graph token acquisition.
5. Teams application manifest ID.

---

# 44. Change Management

Update this document when:

* Teams authentication changes.
* Teams SSO configuration changes.
* Graph notification behavior changes.
* Teams manifest changes.
* Teams application ID changes.
* Deployment domain changes.
* Cookie/framing configuration changes.
* New Teams capabilities are introduced.

---

# 45. Historical Versions

Previous approved versions should be retained.

Example:

```text id="tms42"
v1.0
Initial Teams integration

v1.1
Minor Teams configuration update

v1.2
Notification integration update

v2.0
Major Teams architecture change
```

The current version represents the active implementation.

Historical versions preserve previous implementation decisions.

---

# 46. Related Documents

* Microsoft Graph Integration
* SharePoint Document Storage
* Security Implementation Guide
* Threat Model
* Permission Matrix
* Project Charter
* BRD
* PRD
* HLD
* LLD

---

# 47. Approval

| Name             | Role                                     | Signature  | Date       |
| ---------------- | ---------------------------------------- | ---------- | ---------- |
| Madhav Arora Sir | Project Sponsor & Final Approver         | __________ | __________ |
| Vineet Sharma    | Project Lead / Product & Technical Owner | __________ | __________ |

---

# 48. Document Information

**Document:** Microsoft Teams Integration
**Project:** ERP-PremnathRail
**Organization:** PremnathRail
**Module:** Integration — Microsoft Teams
**Version:** 1.0
**Status:** Current
**Prepared By:** Vineet Sharma
**Date:** 31 August 2026
