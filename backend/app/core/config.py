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

    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440  # 24 hours

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
