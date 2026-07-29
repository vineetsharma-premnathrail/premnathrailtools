"""Application-wide configuration, loaded from environment variables."""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Premnathrail Portal"
    environment: str = "development"
    database_url: str = ""

    # Frontend
    FRONTEND_URL: str = "http://localhost:3000"

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
    APP_BASE_URL: str = "http://localhost:8000"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

settings = Settings()
