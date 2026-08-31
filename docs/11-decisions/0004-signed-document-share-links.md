# ADR 0004: Self-Issued Signed Document Links Instead of SharePoint's Native Sharing Links

**Status:** Accepted
**Date:** 2026-08-29
**Author:** Engineering (documented by AI agent, same session as the change)

## Context

Several document workflows need to provide documents to recipients who do not have a Premnathrail Portal account or SharePoint access. The clearest example is CRM Technical Offer Request emails sent to external vendors.

The initial implementation attempted to use SharePoint's native sharing-link API through Microsoft Graph:

* `scope="anonymous"`
* `scope="organization"`

Both attempts failed with a `sharingDisabled` error caused by the SharePoint tenant/site sharing policy.

Separately, the application was exposing raw SharePoint `webUrl` values through API responses and rendering them directly in attachment links and images. The same change therefore moved document access behind backend-proxied content endpoints.

## Decision

Do not depend on SharePoint's native sharing-link functionality for external document sharing.

Instead, generate a **signed, time-limited JWT scoped to one specific document** and serve the document through an unauthenticated backend proxy route that validates the token before retrieving the file from SharePoint.

Implementation:

* `create_document_share_token(doc_type, doc_id, expires_hours=168)`
* `verify_document_share_token(token, doc_type, doc_id)`

These helpers are implemented in:

`backend/app/auth/jwt_handler.py`

The JWT uses HS256 and contains:

```json
{
  "purpose": "doc_share",
  "doc_type": "...",
  "doc_id": "...",
  "exp": "..."
}
```

The default expiry is 168 hours (7 days).

CRM exposes:

`GET /{document_id}/shared-content?token=...`

The route:

1. Requires no portal login.
2. Validates the signed token.
3. Ensures the token is scoped to the requested document.
4. Retrieves the file server-side using the application's Microsoft Graph credentials.
5. Streams the document bytes to the recipient.

The raw SharePoint `webUrl` is not exposed to the client.

## Rationale

### Option A — Change SharePoint Tenant Sharing Policy

Rejected.

This requires a SharePoint administrator-side policy change outside the application's control and would affect broader site-sharing behavior rather than only this document-sharing workflow.

### Option B — Retry `createLink` With Different Scopes

Rejected.

The observed `sharingDisabled` response indicates a tenant/site policy restriction rather than a transient or parameter-specific error. Changing the scope does not solve the underlying restriction without changing SharePoint policy.

### Option C — Self-Issued Signed Document JWT

**Chosen.**

The application already provides:

* JWT signing infrastructure in `app/auth/jwt_handler.py`
* Authenticated server-side SharePoint proxy downloading through `get_document_content`

The new mechanism therefore reuses existing infrastructure.

The token grants only proof that its holder received a link for the specific document before the token expired. It does not grant general portal access or SharePoint access.

## Consequences

### Positive Consequences

* External recipients can access a specific document without a portal account or SharePoint permissions.
* Invalid or expired links fail closed.
* SharePoint tenant sharing configuration is no longer required for this workflow.
* Raw SharePoint URLs remain hidden from clients.
* Existing JWT and SharePoint proxy infrastructure is reused.
* The approach is consistent with the broader removal of `sharepoint_url` from API responses.

### Negative Consequences

* `settings.SECRET_KEY` becomes a trust boundary for document-share links in addition to portal authentication.
* A leaked `SECRET_KEY` could allow forged document-share tokens.
* Individual links cannot currently be revoked before expiration.
* Rotating `SECRET_KEY` also invalidates existing portal authentication tokens.
* The implementation currently supports CRM documents only through `doc_type="crm_document"`.
* Other modules requiring external document sharing need their own routes wired to the shared token helpers.

## Alternatives Considered

* **Change SharePoint tenant sharing policy** — rejected.
* **Retry SharePoint `createLink` with different scopes** — rejected.
* **Dedicated signing secret for document-share tokens** — not implemented in the shipped change. This could reduce the blast radius of a leaked document-sharing key.

## Related Decisions

* [ADR 0001: Modular Monolith](0001-modular-monolith.md) — shared authentication and SharePoint infrastructure is reused rather than implementing independent sharing mechanisms inside each module.

## When to Revisit

Revisit this decision if:

1. External document sharing is required by P2P, Purchase, or other modules.
2. Per-link revocation becomes a requirement.
3. A database-backed token/allowlist becomes preferable to stateless JWTs.
4. SharePoint tenant sharing policy changes to permit anonymous or organization links.

Even if SharePoint sharing becomes available, the signed-token approach may remain preferable because it avoids exposing raw SharePoint URLs.

## References

* `backend/app/auth/jwt_handler.py`

  * `create_document_share_token`
  * `verify_document_share_token`
* `backend/app/modules/crm/routes/documents.py`

  * `GET /{document_id}/shared-content`
* Commit `c6ba3ab` — **"Stop leaking raw SharePoint URLs; add signed document-share links"**
