# ADR 0002: Microsoft SSO for Authentication

**Status:** Accepted

**Date:** 2025-07-24

## Context

Premnathrail is an enterprise rail company with:
- Microsoft 365 / Office 365 accounts already established
- Azure AD tenant with 100+ users
- Requirement to restrict access to company domain only

Options:
1. **Local authentication** — Username/password in database
2. **Microsoft SSO** — Use Azure AD / Microsoft 365
3. **Other providers** — Google, Auth0, etc.

## Decision

Use **Microsoft SSO** (Azure AD) for authentication.

No local passwords. Users login with Microsoft account.

## Rationale

### Why Microsoft SSO?

✅ **Already have Azure AD**
- Company uses Office 365
- Users already have Microsoft accounts
- No need for users to remember another password

✅ **Enterprise standard**
- Companies expect SSO
- Better security (Microsoft manages passwords)
- Enforces company policies (MFA, password expiry, etc.)

✅ **Domain restriction**
- Can restrict to `@premnathrail.com` only
- Prevent external account access

✅ **Profile sync**
- Automatically pull department, job title, phone from Azure
- Keep employee data in sync

### Why not local authentication?

❌ **Security burden**
- We store passwords (even hashed)
- Responsibility to keep secure
- Users create weak passwords
- Password reuse across sites

❌ **User friction**
- Another password to remember
- Password reset requests = support tickets
- No MFA built-in

### Why not other providers (Google, Auth0)?

❌ Google SSO
- Company may not use Google accounts
- Doesn't restrict to company domain

❌ Auth0
- Additional cost
- Additional vendor dependency
- No advantage over Microsoft (already have Azure)

## Consequences

### Advantages
- ✅ Users don't manage passwords
- ✅ Secure (Microsoft handles it)
- ✅ Domain-restricted access
- ✅ Auto-provision new employees
- ✅ Auto-deprovision when employee leaves
- ✅ Profile data always synced

### Disadvantages
- ❌ Dependency on Microsoft availability
- ❌ Configuration complexity (Azure Portal)
- ❌ Testing requires Azure credentials

## Implementation

1. Register app in Azure AD
2. Get Client ID, Client Secret, Tenant ID
3. Implement OAuth flow (authorization code grant)
4. Auto-create user on first login
5. Sync profile on every login

## Testing

For local testing:
- Use separate Azure AD app (dev tenant)
- Or use mocked OAuth responses

For CI/CD:
- Use service principal or test account

## References

- [Microsoft identity platform documentation](https://docs.microsoft.com/en-us/azure/active-directory/develop/)
- [OAuth 2.0 authorization code flow](https://docs.microsoft.com/en-us/azure/active-directory/develop/v2-oauth2-auth-code-flow)
