"""Application configuration using Pydantic Settings."""

import os
from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from src.exceptions import DefaultSecretKeyError, ShortSecretKeyError

# Minimum length for JWT secret key in production
MIN_JWT_SECRET_LENGTH = 32

# Default JWT secret for development - loaded from env var to avoid hardcoded secrets in code
_DEV_JWT_SECRET = os.environ.get("JWT_SECRET_KEY", "dev-secret-key-for-local-development")


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

    # CORS
    CORS_ORIGINS: list[str] = ["http://localhost:3000"]

    # Database
    DATABASE_URL: str = "postgresql+asyncpg://dev:devpass@localhost:5432/podex"

    # Redis
    REDIS_URL: str = "redis://localhost:6379"

    # AWS
    AWS_REGION: str = "us-east-1"
    AWS_ENDPOINT: str | None = None  # For LocalStack

    # S3 Storage
    S3_BUCKET: str = "podex-workspaces"
    S3_WORKSPACE_PREFIX: str = "workspaces"

    # Auth
    JWT_SECRET_KEY: str = _DEV_JWT_SECRET
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

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
        """Validate JWT secret is not the default placeholder in production."""
        env = os.environ.get("ENVIRONMENT", "development")

        # Check if we're in a production-like environment
        # Note: _info.data may not have ENVIRONMENT yet during validation
        if v == "dev-secret-key-for-local-development" and env == "production":
            raise DefaultSecretKeyError
        if len(v) < MIN_JWT_SECRET_LENGTH and env == "production":
            raise ShortSecretKeyError
        return v

    @field_validator("COMPUTE_INTERNAL_API_KEY")
    @classmethod
    def validate_compute_api_key(cls, v: str, _info: object) -> str:
        """Validate compute API key is set in production environments."""
        env = os.environ.get("ENVIRONMENT", "development")

        if env == "production" and not v:
            raise ValueError(  # noqa: TRY003
                "COMPUTE_INTERNAL_API_KEY must be set in production. "
                "This key is required for secure communication between API and compute services."
            )
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

    # Cognito - optional external identity provider
    COGNITO_USER_POOL_ID: str | None = None
    COGNITO_CLIENT_ID: str | None = None

    # Rate limiting
    RATE_LIMIT_PER_MINUTE: int = 100

    # Security headers
    CSP_ENABLED: bool = True  # Enable Content-Security-Policy header
    CSRF_ENABLED_IN_DEV: bool = False  # Enable CSRF checks in development

    # Compute service
    COMPUTE_SERVICE_URL: str = "http://compute:3003"
    COMPUTE_INTERNAL_API_KEY: str = ""  # Must match compute service's internal_api_key

    # Agent service
    AGENT_SERVICE_URL: str = "http://agent:3002"
    AGENT_TASK_POLL_INTERVAL: float = 0.5  # seconds
    AGENT_TASK_TIMEOUT: float = 120.0  # seconds

    # Voice/Audio settings (AWS Transcribe and Polly)
    DEFAULT_POLLY_VOICE_ID: str = "Joanna"
    DEFAULT_POLLY_ENGINE: str = "neural"
    DEFAULT_TRANSCRIBE_LANGUAGE: str = "en-US"
    VOICE_AUDIO_S3_PREFIX: str = "audio/voice"

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

    # Email (Amazon SES)
    EMAIL_FROM_ADDRESS: str = "noreply@podex.dev"
    EMAIL_FROM_NAME: str = "Podex"
    EMAIL_REPLY_TO: str = "support@podex.dev"

    # AI/LLM providers
    LLM_PROVIDER: str = "bedrock"  # bedrock (default), anthropic, openai, ollama
    ANTHROPIC_API_KEY: str | None = None
    OPENAI_API_KEY: str | None = None
    AWS_ACCESS_KEY_ID: str | None = None
    AWS_SECRET_ACCESS_KEY: str | None = None
    OLLAMA_URL: str = "http://localhost:11434"
    OLLAMA_MODEL: str = "qwen2.5-coder:14b"

    # Internal Service Authentication
    INTERNAL_SERVICE_TOKEN: str | None = None  # Token for service-to-service auth

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
