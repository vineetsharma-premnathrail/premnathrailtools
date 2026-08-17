# Error Handling

## Backend: `HTTPException` at the route level

FastAPI routes across all modules raise `fastapi.HTTPException(status_code=..., detail=...)` directly rather than going through a custom exception hierarchy for expected error conditions. Two examples of the established pattern:

- Permission dependency, `backend/app/core/permissions.py`:
  ```python
  def require_app_access(app_name: str):
      def _dependency(user: User = Depends(get_current_user)) -> User:
          if app_name not in user.get_apps():
              raise HTTPException(status_code=403, detail=f"Access to '{app_name}' module required")
          return user
      return _dependency
  ```
- Resource-not-found and validation errors follow the same `status_code=404/400/409` + human-readable `detail=` string convention throughout `backend/app/modules/*/routes/*.py` (e.g. `erp/routes/projects.py`, `purchase/routes/purchase_requisitions.py`, `p2p/routes/p2p_requests.py`). Use this same shape for new routes: a plain `HTTPException` with a specific status code and a human-readable `detail` string, not a generic 500 or a bespoke error schema.

`backend/app/common/exceptions/` holds any shared custom exception types used across modules — check there before inventing a new exception class for a cross-module concern.

## Global exception handling

`backend/app/main.py` wires up centralized handling via:
```python
setup_error_handlers(app)   # from app.middleware.error_handler
```
This registers FastAPI-level exception handlers so uncaught exceptions get a consistent JSON error response instead of a raw 500/stack trace leaking to the client. Combined with the request-scoped `LoggingMiddleware` (also from `app.middleware.error_handler`), every request/error is logged with a request ID (`rid=`) for correlation.

## OWASP-tagged structured logging

`backend/app/middleware/owasp.py` implements request-level security checks (rate limiting, IP banning, injection/SSRF pattern detection, content-type/method validation, slow-request logging) and logs each using a bracket tag mapping to the relevant OWASP Top-10 category, e.g.:

```python
logger.critical("[A07] IP BANNED | ip=%s", ip)
logger.warning("[A01] Unauthenticated API access | ip=%s path=%s rid=%s", ...)
logger.warning("[A03] Injection attempt in URL | ip=%s url=%s rid=%s", ip, full_url[:300], request_id)
logger.warning("[A10] SSRF in query param | ip=%s param=%s rid=%s", ip, param_value[:100], request_id)
logger.log(level, "[A09] %d | ip=%s method=%s path=%s duration=%dms rid=%s", ...)
```

Tag reference (as used in this codebase):
| Tag | OWASP category | Triggered by |
|---|---|---|
| `[A01]` | Broken access control | Unauthenticated access attempts / scanning behavior |
| `[A03]` | Injection | Suspicious patterns in URL/query params |
| `[A04]` | Insecure design / misconfiguration | Bad method, oversized body, wrong content-type |
| `[A07]` | Auth/session failures | Rate-limit exceeded, IP banned |
| `[A08]` | Software/data integrity | Content-type mismatches |
| `[A09]` | Logging & monitoring failures | Every request's outcome/duration, escalating log level for slow requests |
| `[A10]` | SSRF | Suspicious URLs in query parameters |

When adding new security-relevant logging in `owasp.py` (or elsewhere), reuse this tag scheme rather than inventing new ad hoc log prefixes — it's what makes these events greppable/alertable.

`backend/app/middleware/api_key.py` handles external API-key authentication failures (missing/invalid `Authorization`/`X-API-Key`) — check it for the exact `HTTPException` it raises on invalid keys before adding new API-key-gated routes.

## Frontend: axios interceptor and 401 handling

`frontend/src/lib/api.ts` centralizes both auth-token attachment and 401 handling so individual pages don't need per-call error handling for expired sessions.

Request interceptor (adds bearer token from the store):
```ts
apiClient.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token
  if (token) { /* attach Authorization header */ }
  return config
})
```

Response interceptor (401 → clear session → redirect to `/login`):
```ts
apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    // Skip the /auth/logout request itself — otherwise an already-expired
    // token makes that call 401 too, which would re-enter this same branch
    // and recurse forever instead of just letting the request fail quietly.
    if (error.response?.status === 401 && !error.config?.url?.includes('/auth/logout')) {
      useAuthStore.getState().clearSession()
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
        window.location.href = '/login'
      }
    }
    return Promise.reject(error)
  }
)
```

`frontend/src/store/authStore.ts` provides two distinct session-ending functions — use the right one:
- **`clearSession()`** — local-only, no API call, used specifically by the interceptor above to avoid a recursive-401 loop on an already-expired token:
  ```ts
  /** Clears the session locally only — no API call. Used by the response
   * interceptor on 401 so an already-expired token can't trigger a repeat
   * 401 ... */
  clearSession: () => {
    set({ user: null, token: null, isLoading: false, hasChecked: true })
    localStorage.removeItem('auth-storage')
  },
  ```
- **`logout()`** — the user-initiated version, calls `authApi.logout()` (`POST /auth/logout`) first, then clears the same state.

Important nuance for anything touching auth: the real session is an httpOnly `session_token` cookie set server-side by `/auth/callback`; the `token` field in the Zustand store is documented in `authStore.ts` as being "for API clients/tooling only" — `user` (not `token`) is the authoritative signed-in signal the rest of the app should check.

## Cross-references

- [CONFIGURATION.md](./CONFIGURATION.md) for `SECRET_KEY`/`TRUSTED_PROXIES` used by the OWASP middleware
- [../security/](../security/) for the broader security model
- [CODING_STANDARDS.md](./CODING_STANDARDS.md) for route-level conventions this error handling wraps around
