# ADR 0002: Microsoft SSO for Authentication

**Status:** Accepted
**Date:** 2025-07-24

## Context

Premnathrail is an enterprise rail company with:

* Microsoft 365 / Office 365 accounts already established
* An Azure AD tenant with 100+ users
* A requirement to restrict portal access to the company domain

The authentication options considered were:

1. **Local authentication** — username/password stored in the database
2. **Microsoft SSO** — Azure AD / Microsoft 365
3. **Other providers** — Google, Auth0, etc.

## Decision

Use **Microsoft SSO (Azure AD)** for portal authentication.

The portal does not use local passwords. Users authenticate using their Microsoft account.

## Rationale

### Why Microsoft SSO?

**Existing Microsoft infrastructure**

* The company already uses Office 365.
* Employees already have Microsoft accounts.
* Users do not need another password.

**Enterprise authentication**

* SSO is appropriate for enterprise applications.
* Microsoft manages authentication credentials.
* Existing organizational security policies can be applied.

**Domain restriction**

* Access can be restricted to the company's configured email domain.
* External accounts can be prevented from accessing the portal.

**Profile synchronization**

The application can obtain employee information such as:

* Department
* Job title
* Phone
* Name

This reduces duplicate employee-data maintenance.

### Why Not Local Authentication?

**Security burden**

* The application would be responsible for password storage and protection.
* Weak passwords and password reuse become application concerns.
* Password management increases security responsibility.

**User friction**

* Users would need another password.
* Password resets create additional support work.
* MFA would require additional implementation or integration.

### Why Not Other Providers?

**Google SSO**

* The company already uses Microsoft accounts.
* Microsoft provides the existing organizational identity infrastructure.

**Auth0**

* Adds another external dependency.
* Introduces additional cost.
* Provides limited advantage when Microsoft Azure AD is already available.

## Consequences

### Advantages

* Users do not manage a separate portal password.
* Authentication is delegated to Microsoft.
* Access can be restricted by company domain.
* New employees can be provisioned automatically.
* Employee profile information can be synchronized.

### Disadvantages

* Dependency on Microsoft identity services.
* Azure application configuration is required.
* Authentication testing requires appropriate Azure configuration or mocks.

## Implementation

1. Register the application in Azure AD.
2. Obtain the Client ID, Client Secret, and Tenant ID.
3. Implement the OAuth authorization-code flow.
4. Automatically create a portal user on first successful login.
5. Synchronize available Microsoft profile information during login.

## Testing

For local development:

* Use a separate development Azure AD application/tenant where available.
* Alternatively, mock OAuth responses.

For CI/CD:

* Use a suitable service principal or dedicated test account where required.

## References

* Microsoft Identity Platform documentation
* OAuth 2.0 Authorization Code Flow documentation
