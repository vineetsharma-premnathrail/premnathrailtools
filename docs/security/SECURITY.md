# Security Guide

How to keep Premnathrail Portal secure.

## What's Actually Implemented (this codebase)

The rest of this document is general guidance; this section maps it to real
code so "is X actually done?" has a concrete answer.

### `OWASPMiddleware` (`backend/app/middleware/owasp.py`)

Registered globally in `main.py` (after CORS/TrustedHost/logging). Runs on
every request:

| OWASP category | What it does |
|---|---|
| A01 Broken Access Control | Rejects any `/api/` request with no Bearer token, `session_token` cookie, or `X-API-Key` before it reaches the route (`PUBLIC_PATHS` bypass the check). Also tracks repeated 404s per IP as scan behavior. |
| A03 Injection | Regex-scans the URL, query string, and suspicious headers for SQLi/XSS/path-traversal/template-injection/command-injection patterns; separately scans small JSON bodies on POST/PATCH/DELETE. URL is `urllib.parse.unquote`'d first so percent-encoded payloads (`%20`, `%3C`) still match. |
| A04 Insecure Design | Body size caps (512 KB JSON / 10 GB multipart), HTTP method allowlist, Content-Type allowlist on mutating requests, slow-request logging (>5s). |
| A05 Security Misconfiguration | `X-Content-Type-Options`, `Strict-Transport-Security`, CSP, `Referrer-Policy`, `Permissions-Policy`, COOP/CORP on every response; strips `Server`/`X-Powered-By` headers. |
| A07 Auth & Session Failures | Per-bucket sliding-window rate limits (`auth`: 5/min, `delete`: 10/min, `write`: 40/min, `default`: 200/min) keyed by client IP; 10 violations within the ban window (10 min) auto-bans the IP (`429` + `Retry-After`). |
| A08 Data Integrity | Rejects mutating requests with a missing/disallowed `Content-Type`. |
| A10 SSRF | Blocks query params and `X-Forwarded-For`/`X-Real-IP` header values that resolve to a private/loopback/link-local IP (RFC 1918, `127.0.0.0/8`, `169.254.0.0/16`, `::1`, `fc00::/7`, plus `localhost`/`*.internal`/`*.local`). |

Bulk-DELETE protection lives in the same middleware: a `DELETE` on a bare
collection endpoint (e.g. `/api/v1/erp/projects`, no `{id}`) is rejected with
`405`, and any `DELETE` whose query string looks like an id list (`ids=1,2,3`)
is rejected with `400` — per-resource delete is the only supported shape.

Tests: `backend/app/tests/test_security_middleware.py`.

### API Key Authentication (`backend/app/middleware/api_key.py`, `.../routes/api_keys.py`)

Keys are `pew_<random>`, stored as `HMAC-SHA256(raw_key, SECRET_KEY)` — the raw
key is shown exactly once, at creation, and never persisted or logged. Admin
CRUD lives at `/api/v1/api-keys` (list/create/revoke). A validated key acts as
a synthetic `User` (`role="api_service"`) scoped to `allowed_apps`.

### Microsoft Teams SSO (`backend/app/modules/main/routes/auth.py`)

`/auth/teams-token` validates a Teams `getAuthToken()` JWT: decodes the payload
to check `aud`/`iss` before ever hitting the network, rejects replays via a
`jti`-keyed in-memory set, fetches/caches the tenant's JWKS (1 hour TTL) and
verifies the RS256 signature with `python-jose`, then attempts an
On-Behalf-Of exchange (MSAL `acquire_token_on_behalf_of`) for a Graph token —
OBO failure doesn't block login, it just means Graph-backed features degrade.
`/auth/teams-exchange` hands the Teams *popup* flow's one-time code (120s TTL,
issued by `/auth/callback`) back to the main frame as real session cookies.

### Session delivery

`/auth/callback` and both Teams routes set `session_token` as an **httponly**
cookie (`SameSite=None; Secure` when `SECURE_COOKIES=true`, `SameSite=Lax`
otherwise — Teams needs `None`+`Secure` because the portal runs inside a
cross-site iframe). `get_current_user` checks, in order: `X-API-Key` →
`session_token` cookie → `Authorization: Bearer`. OAuth `state` is
server-side only (in-memory, 10-minute TTL, capped at 500 pending), never a
browser cookie — avoids SameSite issues during the redirect round-trip
entirely.

### Presence indicator auth note

`/api/v1/presence/*` (see [ARCHITECTURE.md](../architecture/ARCHITECTURE.md))
requires a valid session like any other route, but does **not** check that the
caller actually has access to the specific SR/project id being "viewed" —
matches legacy behavior, low risk (leaks only a name/email pair, not record
data), but worth knowing if this is ever extended.

---

## Authentication & Authorization

### Do's ✅

- ✅ Use Microsoft SSO (no passwords)
- ✅ Validate JWT tokens on every protected route
- ✅ Check user.is_active (disabled users denied)
- ✅ Use HTTPS only (redirect HTTP)
- ✅ Set HttpOnly cookies (prevent XSS access)
- ✅ Refresh tokens periodically (24 hour expiry)
- ✅ Log all auth events (login, logout, failed attempts)

### Don'ts ❌

- ❌ Store passwords in database (use Microsoft SSO instead)
- ❌ Hardcode credentials in code
- ❌ Send tokens in URL (use Authorization header)
- ❌ Accept tokens without validation
- ❌ Use weak SECRET_KEY
- ❌ Log tokens or passwords

---

## Database Security

### Connection

- ✅ Use connection pooling
- ✅ Encrypt connection to database (SSL)
- ✅ Use strong database password (20+ chars, random)
- ✅ Restrict database network access (VPC security group)

### Queries

- ✅ Use parameterized queries (SQLAlchemy does this)
- ✅ Never concatenate user input into SQL

```python
# ✅ Good — SQLAlchemy handles escaping
user = db.query(User).filter(User.email == email).first()

# ❌ Bad — SQL injection vulnerability
user = db.query(f"SELECT * FROM users WHERE email = '{email}'")
```

### Backups

- ✅ Backup database daily
- ✅ Encrypt backups
- ✅ Store backups in secure location (S3 with encryption)
- ✅ Test restore procedure monthly

---

## API Security

### Input Validation

- ✅ Validate all inputs (using Pydantic)
- ✅ Limit field lengths (prevent DoS)
- ✅ Reject unexpected fields

```python
class CreateNoteSchema(BaseModel):
    title: str  # Pydantic validates type
    description: str | None = None
```

### Rate Limiting

- ✅ Limit API requests per user (e.g., 100 req/min)
- ✅ Limit login attempts (e.g., 5 attempts/5 min)
- ✅ Block IP after repeated failures

### CORS

- ✅ Restrict CORS to known domains
- ✅ Don't use `allow_origins=["*"]` in production

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://app.premnathrail.com"],
    allow_methods=["GET", "POST", "PUT", "DELETE"],
)
```

---

## Secrets Management

### Environment Variables

- ✅ Store secrets in `.env` (local development)
- ✅ Store secrets in Kubernetes secrets (production)
- ✅ Store secrets in AWS Secrets Manager (production)

### Never commit secrets

```bash
# ✅ Good — secrets in .env (not committed)
DATABASE_URL=postgresql://...
SECRET_KEY=...

# ❌ Bad — secrets in code
app = FastAPI()
SECRET_KEY = "super-secret-key-123"  # Visible in git history!
```

### Rotate secrets regularly

- Change database password every 3 months
- Rotate Azure OAuth credentials yearly
- Rotate API tokens when compromised

---

## Code Security

### Dependencies

- ✅ Use known, maintained packages
- ✅ Pin versions in requirements.txt
- ✅ Check for vulnerabilities: `pip install safety && safety check`

### Code review

- ✅ Review all code before merging
- ✅ Look for security issues: SQL injection, XSS, CSRF
- ✅ Check dependencies are safe

### Testing

- ✅ Test authentication (login, token validation)
- ✅ Test authorization (user cannot access others' data)
- ✅ Test input validation (invalid data rejected)

---

## HTTPS & TLS

### Always use HTTPS

```python
# Redirect HTTP to HTTPS
@app.middleware("http")
async def https_redirect(request, call_next):
    if request.url.scheme == "http":
        url = request.url.replace(scheme="https")
        return RedirectResponse(url=url)
    return await call_next(request)
```

### TLS Certificate

- ✅ Use valid certificate (Let's Encrypt is free)
- ✅ Certificate must match domain name
- ✅ Renew certificate before expiry (auto-renewal recommended)
- ✅ Use TLS 1.2+ (disable older versions)

---

## Data Privacy

### Sensitive Data

These fields are sensitive:
- Passwords (don't store — use SSO)
- Tokens (don't log)
- Email addresses (encrypt if PII)
- Phone numbers (encrypt if stored)

### Data Retention

- Delete old data per policy (e.g., old notes after 2 years)
- GDPR right to be forgotten (delete user data)
- Backup older data separately

### Compliance

- GDPR — Protect EU user data
- CCPA — Protect California user data
- Industry standards (ISO 27001, SOC 2)

---

## Logging & Monitoring

### Logs to collect

- ✅ Login attempts (success and failure)
- ✅ API errors (500 errors)
- ✅ Database errors
- ✅ Security events (failed auth, suspicious activity)

### Logs to NOT collect

- ❌ Passwords
- ❌ Tokens
- ❌ Credit card numbers
- ❌ API keys

### Centralize logs

- ✅ Use ELK stack, CloudWatch, or Datadog
- ✅ Retention: 90 days minimum
- ✅ Alert on suspicious patterns

---

## Incident Response

### If compromised:

1. **Isolate** — Take affected system offline
2. **Assess** — What was accessed?
3. **Notify** — Inform affected users
4. **Fix** — Patch vulnerability
5. **Review** — How did this happen? Prevent next time.

### Contact list

- Security lead: [email]
- CTO: [email]
- Legal: [email]

---

## Security Checklist

### Development
- [ ] No hardcoded secrets
- [ ] Parameterized SQL queries
- [ ] Input validation
- [ ] Error handling (don't leak info)
- [ ] Tests for auth/authz

### Deployment
- [ ] HTTPS enabled
- [ ] Strong database password
- [ ] Rate limiting
- [ ] CORS configured
- [ ] Logging enabled
- [ ] Monitoring alerts

### Operations
- [ ] Database backups working
- [ ] Logs being collected
- [ ] Security patches applied
- [ ] Secrets rotated
- [ ] Incident response plan exists

---

## Resources

- [OWASP Top 10](https://owasp.org/www-project-top-ten/) — Common vulnerabilities
- [FastAPI security docs](https://fastapi.tiangolo.com/tutorial/security/) — Best practices
- [CWE Top 25](https://cwe.mitre.org/top25/) — Common weaknesses
- [AWS security best practices](https://aws.amazon.com/architecture/security-identity-compliance/)

---

**Questions?** Contact security team.
