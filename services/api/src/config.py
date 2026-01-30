"""Application configuration using Pydantic Settings."""

import json
import os
import secrets
import warnings
from functools import lru_cache

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from src.exceptions import DefaultSecretKeyError, ShortSecretKeyError

# Minimum length for JWT secret key in production
MIN_JWT_SECRET_LENGTH = 32

# SECURITY: Generate a random secret for development if not explicitly set
# This prevents hardcoded secrets from being accidentally used
_ENV_JWT_SECRET = os.environ.get("JWT_SECRET_KEY")
if _ENV_JWT_SECRET:
    _DEV_JWT_SECRET = _ENV_JWT_SECRET
else:
    # Generate a random secret for this process (sessions won't persist across restarts)
    _DEV_JWT_SECRET = secrets.token_urlsafe(48)  # 64 chars, cryptographically secure
    if os.environ.get("ENVIRONMENT", "development") != "test":
        warnings.warn(
            "JWT_SECRET_KEY not set - using auto-generated secret. "
            "Sessions will not persist across server restarts. "
            "Set JWT_SECRET_KEY in environment for persistent sessions.",
            stacklevel=2,
        )


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
    )

    # Application
    VERSION: str = "0.1.0"
    ENVIRONMENT: str = "development"
    PORT: int = 3001
    DEBUG: bool = False

    # CORS - stored as raw string to avoid pydantic-settings JSON parsing issues
    CORS_ORIGINS_RAW: str = Field(
        default='["http://localhost:3000"]',
        validation_alias="CORS_ORIGINS",
    )

    @property
    def CORS_ORIGINS(self) -> list[str]:  # noqa: N802 - matches env var name
        """Parse CORS origins from JSON array, comma-separated, or plain string."""
        v = self.CORS_ORIGINS_RAW.strip() if self.CORS_ORIGINS_RAW else ""
        if not v:
            return ["http://localhost:3000"]
        # Try JSON array first
        if v.startswith("["):
            try:
                parsed = json.loads(v)
                return [str(x) for x in parsed] if isinstance(parsed, list) else [v]
            except json.JSONDecodeError:
                pass
        # Comma-separated list (e.g., "https://a.com,https://b.com")
        if "," in v:
            return [origin.strip() for origin in v.split(",") if origin.strip()]
        # Single origin
        return [v]

    # Database
    # NOTE: In production, DATABASE_URL must be set via environment variable
    DATABASE_URL: str = "postgresql+asyncpg://localhost:5432/podex"

    # Database connection pool settings
    DB_POOL_SIZE: int = 10  # Minimum connections in pool
    DB_POOL_MAX_OVERFLOW: int = 20  # Max additional connections above pool_size
    DB_POOL_TIMEOUT: int = 30  # Seconds to wait for connection from pool
    DB_POOL_RECYCLE: int = 1800  # Recycle connections after 30 minutes

    # Redis
    REDIS_URL: str = "redis://localhost:6379"

    # Auth
    JWT_SECRET_KEY: str = _DEV_JWT_SECRET
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    BROWSER_ACCESS_TOKEN_EXPIRE_MINUTES: int = 10080  # 7 days (7 * 24 * 60)
    BROWSER_REFRESH_TOKEN_EXPIRE_DAYS: int = 90  # Extended to 90 days for better UX

    # Auth Cookies (httpOnly cookies for XSS protection)
    COOKIE_SECURE: bool = True  # Set False for local dev without HTTPS
    COOKIE_DOMAIN: str | None = None  # Set for cross-subdomain cookies (e.g., ".podex.dev")
    COOKIE_SAMESITE: str = "lax"  # "lax", "strict", or "none"

    # Password requirements
    PASSWORD_MIN_LENGTH: int = 8
    PASSWORD_MAX_LENGTH: int = 128
    PASSWORD_REQUIRE_COMPLEXITY: bool = True  # Require uppercase, lowercase, number, special char
    PASSWORD_CHECK_COMMON: bool = True  # Check against common password list

    @field_validator("JWT_SECRET_KEY")
    @classmethod
    def validate_jwt_secret(cls, v: str, _info: object) -> str:
        """Validate JWT secret meets security requirements in production."""
        env = os.environ.get("ENVIRONMENT", "development")

        # Check if we're in a production-like environment
        # Note: _info.data may not have ENVIRONMENT yet during validation
        if env == "production":
            # In production, reject the dev default secret
            if v == "dev-secret-key-for-local-development":
                raise DefaultSecretKeyError
            # In production, require explicit JWT_SECRET_KEY from environment
            if not os.environ.get("JWT_SECRET_KEY"):
                raise DefaultSecretKeyError
            if len(v) < MIN_JWT_SECRET_LENGTH:
                raise ShortSecretKeyError
        return v

    # OAuth - GitHub
    GITHUB_CLIENT_ID: str | None = None
    GITHUB_CLIENT_SECRET: str | None = None
    GITHUB_REDIRECT_URI: str = "http://localhost:3000/auth/callback/github"

    # OAuth - Google
    GOOGLE_CLIENT_ID: str | None = None
    GOOGLE_CLIENT_SECRET: str | None = None
    GOOGLE_REDIRECT_URI: str = "http://localhost:3000/auth/callback/google"

    # Frontend URL for redirects
    FRONTEND_URL: str = "http://localhost:3000"

    # API base URL (for webhook URLs, etc.)
    API_BASE_URL: str = "http://localhost:3001"

    # Cognito - optional external identity provider
    COGNITO_USER_POOL_ID: str | None = None
    COGNITO_CLIENT_ID: str | None = None

    # Rate limiting
    RATE_LIMIT_PER_MINUTE: int = 100

    # Security headers
    CSP_ENABLED: bool = True  # Enable Content-Security-Policy header
    CSRF_ENABLED_IN_DEV: bool = True  # Enable CSRF checks in development (recommended)

    # Compute service
    COMPUTE_SERVICE_URL: str = "http://compute:3003"

    # Agent service
    AGENT_SERVICE_URL: str = "http://agent:3002"
    AGENT_TASK_POLL_INTERVAL: float = 0.5  # seconds
    AGENT_TASK_TIMEOUT: float = 120.0  # seconds

    # Cloudflare Tunnel (external exposure: tunnel.podex.dev)
    CLOUDFLARE_API_TOKEN: str | None = None
    CLOUDFLARE_ACCOUNT_ID: str | None = None
    CLOUDFLARE_ZONE_ID: str | None = None  # Zone for tunnel.podex.dev
    TUNNEL_DOMAIN: str = "tunnel.podex.dev"  # Base domain for public URLs

    # Voice/Audio settings
    # Voice provider: "local" (pyttsx3/whisper), "openai", "google" (GCP)
    VOICE_PROVIDER: str = "local"
    DEFAULT_TTS_VOICE_ID: str = (
        "alloy"  # OpenAI TTS voice (alloy, echo, fable, onyx, nova, shimmer)
    )
    DEFAULT_TTS_LANGUAGE: str = "en-US"
    DEFAULT_SPEECH_LANGUAGE: str = "en-US"
    # OpenAI TTS model: "tts-1" (faster) or "tts-1-hd" (higher quality)
    OPENAI_TTS_MODEL: str = "tts-1"
    # Whisper model for local STT: "tiny", "base", "small", "medium", "large"
    WHISPER_MODEL: str = "base"

    # Cache settings
    CACHE_TTL_TEMPLATES: int = 3600  # 1 hour for templates
    CACHE_TTL_SESSIONS: int = 300  # 5 minutes for sessions
    CACHE_TTL_USER_CONFIG: int = 600  # 10 minutes for user config
    CACHE_PREFIX: str = "podex:cache:"

    # Sentry
    SENTRY_DSN: str | None = None
    SENTRY_TRACES_SAMPLE_RATE: float = 0.2
    SENTRY_PROFILES_SAMPLE_RATE: float = 0.1

    # Stripe
    STRIPE_SECRET_KEY: str | None = None
    STRIPE_WEBHOOK_SECRET: str | None = None
    STRIPE_PUBLISHABLE_KEY: str | None = None

    # Email configuration
    EMAIL_BACKEND: str = "console"  # console, smtp, sendgrid
    EMAIL_FROM_ADDRESS: str = "podex@podex.dev"
    EMAIL_FROM_NAME: str = "Podex"
    EMAIL_REPLY_TO: str = "podex@podex.dev"

    # SMTP settings (when EMAIL_BACKEND=smtp)
    SMTP_HOST: str = "localhost"
    SMTP_PORT: int = 587
    SMTP_USER: str | None = None
    SMTP_PASSWORD: str | None = None
    SMTP_USE_TLS: bool = True

    # SendGrid settings (when EMAIL_BACKEND=sendgrid) - RECOMMENDED FOR PRODUCTION
    SENDGRID_API_KEY: str | None = None

    # Push Notifications (Web Push / VAPID)
    VAPID_PUBLIC_KEY: str | None = None
    VAPID_PRIVATE_KEY: str | None = None
    VAPID_EMAIL: str = "mailto:admin@podex.io"

    # AI/LLM providers
    OPENROUTER_API_KEY: str | None = None  # For Podex-hosted models via OpenRouter
    ANTHROPIC_API_KEY: str | None = None  # For users with own API keys
    OPENAI_API_KEY: str | None = None  # For users with own API keys
    OLLAMA_URL: str = "http://localhost:11434"
    OLLAMA_MODEL: str = "qwen2.5-coder:14b"

    # GCP/Vertex AI Configuration (for Claude via Vertex AI)
    GCP_PROJECT_ID: str | None = None
    GCP_REGION: str = "us-east5"

    # Internal Service Authentication
    # REQUIRED in all environments - set a dev token for local development
    INTERNAL_SERVICE_TOKEN: str = ""

    @field_validator("INTERNAL_SERVICE_TOKEN")
    @classmethod
    def validate_internal_service_token(cls, v: str, _info: object) -> str:
        """Validate internal service token is set."""
        env = os.environ.get("ENVIRONMENT", "development")
        if env == "production" and not v:
            raise ValueError("INTERNAL_SERVICE_TOKEN required in production")  # noqa: TRY003
        return v

    # ============== Agent Watchdog Settings ==============
    AGENT_TIMEOUT_MINUTES: int = 15  # Max time agent can be in "running" state
    AGENT_WATCHDOG_INTERVAL: int = 60  # Check every 60 seconds
    AGENT_WATCHDOG_ENABLED: bool = True

    # ============== Container Health Check Settings ==============
    CONTAINER_HEALTH_CHECK_INTERVAL: int = 120  # Check every 2 minutes
    CONTAINER_HEALTH_CHECK_TIMEOUT: int = 10  # 10 second timeout
    CONTAINER_HEALTH_CHECK_ENABLED: bool = True
    CONTAINER_UNRESPONSIVE_THRESHOLD: int = 3  # Mark unhealthy after 3 failures

    # ============== Standby Cleanup Settings ==============
    STANDBY_CLEANUP_ENABLED: bool = True
    STANDBY_CLEANUP_INTERVAL: int = 3600  # Check every hour
    STANDBY_MAX_HOURS_DEFAULT: int = 168  # 7 days default
    STANDBY_MAX_HOURS_MIN: int = 24  # Minimum 24 hours
    STANDBY_MAX_HOURS_MAX: int = 720  # Maximum 30 days

    # ============== Background Task Timeouts ==============
    # Prevents connection pool exhaustion from hung operations
    BG_TASK_DB_TIMEOUT: int = 60  # Max seconds for DB operation in background tasks
    BG_TASK_QUOTA_RESET_INTERVAL: int = 300  # Quota reset check interval (5 min)
    BG_TASK_BILLING_INTERVAL: int = 300  # Billing maintenance interval (5 min)
    BG_TASK_WORKSPACE_DELETE_TIMEOUT: int = 120  # Workspace deletion timeout

    # ============== Session Quota Retry Settings ==============
    SESSION_QUOTA_MAX_RETRIES: int = 3  # Max retries on lock contention
    SESSION_QUOTA_RETRY_DELAY: float = 0.1  # Initial retry delay in seconds
    SESSION_QUOTA_RETRY_BACKOFF: float = 2.0  # Exponential backoff multiplier

    # ============== Usage Calculation Security ==============
    # Maximum quantities per usage event (prevents integer overflow)
    MAX_QUANTITY_TOKENS: int = 100_000_000  # 100M tokens max per event
    MAX_QUANTITY_COMPUTE_SECONDS: int = 2_592_000  # 30 days max
    MAX_COST_CENTS: int = 100_000_000  # $1M max per event
    POSTGRES_INT_MAX: int = 2_147_483_647

    # Admin Configuration
    ADMIN_SUPER_USER_EMAILS: list[str] = []  # Emails that bypass role checks (for bootstrap)
    DEV_SEED_ADMIN: bool = True  # Seed admin user on startup in development

    # ============== MCP (Model Context Protocol) Configuration ==============
    # Enable specific MCP servers by slug (comma-separated)
    # Available: filesystem, git, github, fetch, memory, brave-search,
    # puppeteer, slack, postgres, sqlite, docker, kubernetes
    MCP_ENABLED_SERVERS: str = ""
    MCP_AUTO_DISCOVER: bool = True  # Auto-discover tools when servers connect

    # Per-server secrets (optional - users can also set via UI)
    MCP_GITHUB_TOKEN: str | None = None
    MCP_BRAVE_API_KEY: str | None = None
    MCP_SLACK_BOT_TOKEN: str | None = None
    MCP_SLACK_TEAM_ID: str | None = None
    MCP_POSTGRES_CONNECTION_STRING: str | None = None

    # ============== External Service URLs ==============
    # These can be overridden for testing or self-hosted instances
    GITHUB_API_URL: str = "https://api.github.com"
    GITHUB_API_VERSION: str = "2022-11-28"
    SENDGRID_API_URL: str = "https://api.sendgrid.com/v3/mail/send"
    OPENVSX_API_URL: str = "https://open-vsx.org/api"

    # ============== HTTP Client Timeouts ==============
    HTTP_TIMEOUT_DEFAULT: float = 30.0  # Default HTTP request timeout in seconds
    HTTP_TIMEOUT_GITHUB: float = 30.0  # GitHub API timeout
    HTTP_TIMEOUT_SENDGRID: float = 30.0  # SendGrid API timeout

    # ============== Workspace Operation Timeouts ==============
    WORKSPACE_CREATION_TIMEOUT: int = 600  # 10 minutes for workspace creation
    WORKSPACE_EXEC_TIMEOUT_DEFAULT: int = 10  # Default command execution timeout
    WORKSPACE_EXEC_TIMEOUT_INSTALL: int = 300  # 5 minutes for installations

    # ============== Retry Configuration ==============
    HTTP_RETRY_MAX_ATTEMPTS: int = 3
    HTTP_RETRY_INITIAL_DELAY: float = 0.5  # seconds
    HTTP_RETRY_MAX_DELAY: float = 10.0  # seconds

    @property
    def enabled_mcp_servers(self) -> list[str]:
        """Parse comma-separated MCP server slugs."""
        if not self.MCP_ENABLED_SERVERS:
            return []
        return [s.strip() for s in self.MCP_ENABLED_SERVERS.split(",") if s.strip()]


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()


settings = get_settings()
