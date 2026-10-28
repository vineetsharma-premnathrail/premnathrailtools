"""Application-wide configuration, loaded from environment variables."""

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Premnathrail Portal"
    environment: str = "development"
    database_url: str = ""

    # Frontend
    FRONTEND_URL: str = "http://localhost:3000"

    # Comma-separated lists; production deploys must override these via env.
    ALLOWED_ORIGINS: str = (
        "http://localhost:3000,http://localhost:5173,http://127.0.0.1:3000"
    )
    ALLOWED_HOSTS: str = "localhost,127.0.0.1,testserver"

    # IPs of reverse proxies (e.g. Coolify/Traefik) allowed to set X-Forwarded-For.
    # Empty by default (fail closed) — the client-supplied header is otherwise
    # trivially spoofable and would let rate limiting/IP bans be bypassed.
    # Behind a reverse proxy in production, set this to that proxy's IP.
    TRUSTED_PROXIES: str = ""

    # Exempts 127.0.0.1/::1 from the OWASP middleware's rate limiting and IP
    # bans (app/middleware/owasp.py). False by default — only ever set True in
    # a local .env. Never set this in production: if the app sits behind a
    # same-host reverse proxy that isn't in TRUSTED_PROXIES (misconfigured),
    # every real external request also arrives from 127.0.0.1, and this flag
    # would blind the rate limiter/ban to all of them, not just a developer's
    # own machine.
    TRUSTED_LOCAL_DEV: bool = False

    # Data access for a module when a user's roles set none for it
    # (core/data_scope.py). "assigned" = own + assigned + anything they approve,
    # so changing a record id in the URL never opens a colleague's record unless
    # an admin widened the role (Organization › Role & Permissions).
    DEFAULT_DATA_SCOPE: str = "assigned"

    @property
    def allowed_origins_list(self) -> list[str]:
        return [o.strip() for o in self.ALLOWED_ORIGINS.split(",") if o.strip()]

    @property
    def allowed_hosts_list(self) -> list[str]:
        return [h.strip() for h in self.ALLOWED_HOSTS.split(",") if h.strip()]

    @property
    def trusted_proxies_set(self) -> set[str]:
        return {p.strip() for p in self.TRUSTED_PROXIES.split(",") if p.strip()}

    # Microsoft Azure OAuth
    AZURE_CLIENT_ID: str = ""
    AZURE_CLIENT_SECRET: str = ""
    AZURE_TENANT_ID: str = ""
    AZURE_REDIRECT_URI: str = "http://localhost:8000/auth/callback"
    DOMAIN_EMAIL: str = ""  # e.g., "@premnathrail.com" — empty means allow all domains

    # Cookies: Teams runs the app inside an iframe (top-level site is
    # teams.microsoft.com), so cross-site cookies need SameSite=None, which
    # browsers only honor when Secure=True (i.e. served over HTTPS).
    SECURE_COOKIES: bool = False

    # JWT
    SECRET_KEY: str = "..."

    # Short-lived: minimizes the damage window if a session_token is ever
    # leaked (XSS, logs, a stolen device snapshot). Session length for an
    # active user comes from REFRESH_TOKEN_EXPIRE_DAYS instead — see
    # /auth/refresh, which is what actually keeps daily-active users signed
    # in without re-prompting for Microsoft login.
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15

    # Refresh tokens are opaque (not JWTs) and stored hashed in `user_sessions`,
    # so — unlike a bare JWT — they can be revoked server-side (logout,
    # deactivation, password/security incident) before they naturally expire.
    # Sliding: every refresh issues a new one with a fresh expiry, so only
    # someone who has not opened the portal for this many days is signed out
    # (and the login page then signs them back in with Microsoft by itself).
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30

    # SharePoint (ERP attachment storage)
    SHAREPOINT_SITE_ID: str = ""
    SHAREPOINT_FOLDER: str = "ERP-media"

    # ERP notification email (app-only Graph sendMail)
    SENDER_EMAIL: str = ""
    TEAM_EMAIL: str = ""
    PURCHASE_EMAIL: str = ""
    RND_EMAIL: str = ""
    APP_BASE_URL: str = "http://localhost:8000"

    # GSTIN lookup (gstinapi.in) — used to auto-fill Vendor/Organization forms
    GSTINAPI_KEY: str = ""
    GSTINAPI_BASE_URL: str = "https://www.gstinapi.in"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @model_validator(mode="after")
    def _use_installed_postgres_driver(self) -> "Settings":
        # Only psycopg (v3) is installed (requirements.txt). A plain
        # postgresql:// / postgres:// URL (as hosting panels usually give it)
        # makes SQLAlchemy load psycopg2, which isn't there, and the deploy's
        # `alembic upgrade head` dies with "No module named 'psycopg2'".
        for prefix in ("postgresql://", "postgres://"):
            if self.database_url.startswith(prefix):
                self.database_url = "postgresql+psycopg://" + self.database_url[len(prefix):]
        return self

    @model_validator(mode="after")
    def _reject_placeholder_secret_in_production(self) -> "Settings":
        if self.environment == "production" and (
            not self.SECRET_KEY or self.SECRET_KEY == "..." or len(self.SECRET_KEY) < 32
        ):
            raise ValueError(
                "SECRET_KEY must be set to a strong, unique value (32+ chars) when environment=production. "
                "Refusing to start with a placeholder/weak key, since it would let anyone forge session tokens."
            )
        return self


settings = Settings()
