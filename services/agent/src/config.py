"""Agent service configuration."""

import tempfile
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# Use a secure temp directory path
_WORKSPACE_BASE = str(Path(tempfile.gettempdir()) / "podex" / "workspaces")


class Settings(BaseSettings):
    """Agent service settings."""

    model_config = SettingsConfigDict(env_file=".env", case_sensitive=True)

    VERSION: str = "0.1.0"
    ENVIRONMENT: str = "development"
    PORT: int = 3002

    # Database
    DATABASE_URL: str = "postgresql+asyncpg://dev:devpass@localhost:5432/podex"

    # Redis
    REDIS_URL: str = "redis://localhost:6379"

    # S3 Storage
    S3_BUCKET: str = "podex-workspaces"
    S3_ENDPOINT_URL: str | None = None  # For LocalStack: http://localhost:4566
    AWS_S3_REGION: str = "us-east-1"

    # LLM Providers
    LLM_PROVIDER: str = "anthropic"  # anthropic, openai, bedrock, ollama
    ANTHROPIC_API_KEY: str | None = None
    OPENAI_API_KEY: str | None = None

    # Ollama (local LLM)
    OLLAMA_URL: str = "http://localhost:11434"
    OLLAMA_MODEL: str = "qwen2.5-coder:14b"  # Best local coding model

    # AWS (for Bedrock)
    AWS_REGION: str = "us-east-1"
    AWS_ACCESS_KEY_ID: str | None = None
    AWS_SECRET_ACCESS_KEY: str | None = None

    # Default models (use OLLAMA_MODEL when LLM_PROVIDER=ollama)
    DEFAULT_ARCHITECT_MODEL: str = "claude-opus-4-5-20251101"
    DEFAULT_CODER_MODEL: str = "claude-sonnet-4-20250514"
    DEFAULT_REVIEWER_MODEL: str = "claude-sonnet-4-20250514"
    DEFAULT_TESTER_MODEL: str = "claude-sonnet-4-20250514"

    # Workspace configuration
    WORKSPACE_BASE_PATH: str = _WORKSPACE_BASE

    # Tool execution limits
    COMMAND_TIMEOUT: int = 60  # seconds
    MAX_FILE_SIZE: int = 1_000_000  # 1MB
    MAX_SEARCH_RESULTS: int = 50

    # Task queue settings
    TASK_QUEUE_POLL_INTERVAL: float = 1.0  # seconds
    TASK_TTL: int = 86400  # 24 hours
    TASK_MAX_RETRIES: int = 3

    # Streaming settings
    STREAMING_ENABLED: bool = True
    STREAMING_BUFFER_SIZE: int = 1  # Tokens to buffer before emit (1 = immediate)

    # Context window settings
    MAX_CONTEXT_TOKENS: int = 100000
    CONTEXT_OUTPUT_RESERVATION: int = 4096
    CONTEXT_SUMMARIZATION_THRESHOLD: int = 40  # messages
    CONTEXT_TOKEN_THRESHOLD: int = 50000  # tokens

    # Sentry
    SENTRY_DSN: str | None = None
    SENTRY_TRACES_SAMPLE_RATE: float = 0.2
    SENTRY_PROFILES_SAMPLE_RATE: float = 0.1

    # API Service (for usage tracking)
    API_BASE_URL: str = "http://localhost:3001"
    INTERNAL_SERVICE_TOKEN: str | None = None

    # Compute Service (for terminal access)
    COMPUTE_SERVICE_URL: str = "http://localhost:3003"

    # ============== MCP (Model Context Protocol) Configuration ==============
    # MCP server connection settings
    MCP_CONNECTION_TIMEOUT: int = 30  # seconds
    MCP_TOOL_TIMEOUT: int = 60  # seconds for tool execution
    MCP_MAX_RETRIES: int = 3  # retry attempts for failed connections
    MCP_RETRY_DELAY: float = 1.0  # seconds between retries

    # MCP server secrets (mirrors API service for agent-side resolution)
    MCP_GITHUB_TOKEN: str | None = None
    MCP_BRAVE_API_KEY: str | None = None
    MCP_SLACK_BOT_TOKEN: str | None = None
    MCP_SLACK_TEAM_ID: str | None = None
    MCP_POSTGRES_CONNECTION_STRING: str | None = None


@lru_cache
def get_settings() -> Settings:
    """Get cached settings."""
    return Settings()


settings = get_settings()
