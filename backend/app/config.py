"""Application configuration, loaded from environment variables.

All settings are validated by Pydantic. In production on Cloud Run these come
from the service's environment + secrets mounted from Secret Manager.
"""
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # --- Database -------------------------------------------------------
    # e.g. postgresql+psycopg://user:pass@/dbname?host=/cloudsql/PROJECT:REGION:INSTANCE
    database_url: str = "postgresql+psycopg://duck:duck@localhost:5432/duckpond"

    # --- Google OAuth ---------------------------------------------------
    google_client_id: str = ""          # OAuth 2.0 Web client ID
    # Restrict logins to this Google Workspace domain (e.g. "bikeluggage.co.uk").
    # Empty string = allow any Google account (not recommended in prod).
    allowed_hosted_domain: str = ""
    # Optional explicit allow-list of emails (comma separated). If set, only
    # these emails may sign in, in addition to the domain check.
    allowed_emails: str = ""

    # --- Auth / sessions ------------------------------------------------
    jwt_secret: str = "change-me-in-production"
    jwt_ttl_hours: int = 12

    # --- Text to Speech (Google Cloud TTS) ------------------------------
    # If empty, the frontend falls back to the browser's built-in voice.
    tts_enabled: bool = True
    tts_voice: str = "en-GB-Chirp3-HD-Aoede"   # natural female voice
    tts_language_code: str = "en-GB"

    # --- App ------------------------------------------------------------
    cors_origins: str = "http://localhost:3000"
    admin_emails: str = ""   # who can see the team dashboard (comma separated)

    # --- Self-improvement agents (Claude API) ---------------------------
    anthropic_api_key: str = ""
    agent_model: str = "claude-sonnet-4-6"
    agents_enabled: bool = True
    # shared secret so Cloud Scheduler can trigger the nightly run
    agent_cron_token: str = "change-me"

    # --- Cache (Redis / Memorystore) ------------------------------------
    # e.g. redis://10.0.0.3:6379/0 ; empty = in-memory fallback only
    redis_url: str = ""

    @property
    def allowed_email_list(self) -> list[str]:
        return [e.strip().lower() for e in self.allowed_emails.split(",") if e.strip()]

    @property
    def admin_email_list(self) -> list[str]:
        return [e.strip().lower() for e in self.admin_emails.split(",") if e.strip()]

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
