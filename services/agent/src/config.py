"""Agent service configuration."""

import asyncio
import tempfile
from functools import lru_cache
from pathlib import Path
from typing import Any

import httpx
import structlog
from pydantic_settings import BaseSettings, SettingsConfigDict

logger = structlog.get_logger()

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
    LLM_PROVIDER: str = "bedrock"  # bedrock (default), anthropic, openai, ollama
    ANTHROPIC_API_KEY: str | None = None
    OPENAI_API_KEY: str | None = None

    # Ollama (local LLM)
    OLLAMA_URL: str = "http://localhost:11434"
    OLLAMA_MODEL: str = "qwen2.5-coder:14b"  # Best local coding model

    # AWS (for Bedrock - Podex Native)
    AWS_REGION: str = "us-east-1"
    AWS_ACCESS_KEY_ID: str | None = None
    AWS_SECRET_ACCESS_KEY: str | None = None

    # Default models by role (Bedrock model IDs for Podex Native)
    DEFAULT_ARCHITECT_MODEL: str = "anthropic.claude-opus-4-5-20251101-v1:0"
    DEFAULT_CODER_MODEL: str = "anthropic.claude-sonnet-4-5-20250929-v1:0"
    DEFAULT_REVIEWER_MODEL: str = "anthropic.claude-sonnet-4-20250514-v1:0"
    DEFAULT_TESTER_MODEL: str = "anthropic.claude-sonnet-4-5-20250929-v1:0"
    DEFAULT_CHAT_MODEL: str = "anthropic.claude-haiku-4-5-20251001-v1:0"
    DEFAULT_SECURITY_MODEL: str = "anthropic.claude-opus-4-5-20251101-v1:0"
    DEFAULT_DEVOPS_MODEL: str = "anthropic.claude-sonnet-4-5-20250929-v1:0"
    DEFAULT_DOCUMENTATOR_MODEL: str = "anthropic.claude-sonnet-4-20250514-v1:0"

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


# ==========================================
# Bedrock Model Configuration (Fallback)
# ==========================================

# Podex Native (Bedrock) Model IDs - Used as fallback if API unavailable
BEDROCK_MODELS = {
    "claude-opus-4.5": "anthropic.claude-opus-4-5-20251101-v1:0",
    "claude-opus-4.1": "anthropic.claude-opus-4-1-20250805-v1:0",
    "claude-sonnet-4.5": "anthropic.claude-sonnet-4-5-20250929-v1:0",
    "claude-sonnet-4": "anthropic.claude-sonnet-4-20250514-v1:0",
    "claude-haiku-4.5": "anthropic.claude-haiku-4-5-20251001-v1:0",
    "claude-3.5-haiku": "anthropic.claude-3-5-haiku-20241022-v1:0",
    "claude-3-haiku": "anthropic.claude-3-haiku-20240307-v1:0",
}

# Fallback: Models that support vision (used if API unavailable)
_FALLBACK_VISION_CAPABLE_MODELS = frozenset(
    [
        "anthropic.claude-opus-4-5-20251101-v1:0",
        "anthropic.claude-opus-4-1-20250805-v1:0",
        "anthropic.claude-sonnet-4-5-20250929-v1:0",
        "anthropic.claude-sonnet-4-20250514-v1:0",
        "anthropic.claude-haiku-4-5-20251001-v1:0",
        "anthropic.claude-3-haiku-20240307-v1:0",
    ]
)

# Fallback: Models that support extended thinking (used if API unavailable)
_FALLBACK_THINKING_CAPABLE_MODELS = frozenset(
    [
        "anthropic.claude-opus-4-5-20251101-v1:0",
        "anthropic.claude-sonnet-4-5-20250929-v1:0",
        "anthropic.claude-haiku-4-5-20251001-v1:0",
    ]
)

# Default thinking budget (tokens) when enabled
DEFAULT_THINKING_BUDGET = 8000
MIN_THINKING_BUDGET = 1024
MAX_THINKING_BUDGET = 32000


# ==========================================
# Model Capabilities Cache (Fetched from API)
# ==========================================


class ModelCapabilitiesCache:
    """Cache for model capabilities fetched from the API service.

    This class fetches model capabilities from the database via the API service
    and caches them locally. Falls back to hardcoded values if API is unavailable.
    """

    def __init__(self) -> None:
        self._cache: dict[str, dict[str, Any]] = {}
        self._loaded = False
        self._lock = asyncio.Lock()
        self._last_refresh: float = 0
        self._refresh_interval = 300  # 5 minutes

    async def _fetch_capabilities(self) -> dict[str, dict[str, Any]]:
        """Fetch model capabilities from the API service."""
        settings = get_settings()
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(f"{settings.API_BASE_URL}/api/models/capabilities")
                response.raise_for_status()
                result: dict[str, dict[str, Any]] = response.json()
                return result
        except Exception as e:
            logger.warning("Failed to fetch model capabilities from API", error=str(e))
            return {}

    async def refresh(self, force: bool = False) -> None:
        """Refresh the capabilities cache from the API."""
        import time

        now = time.time()
        if not force and self._loaded and (now - self._last_refresh) < self._refresh_interval:
            return

        async with self._lock:
            # Double-check after acquiring lock
            if not force and self._loaded and (now - self._last_refresh) < self._refresh_interval:
                return

            capabilities = await self._fetch_capabilities()
            if capabilities:
                self._cache = capabilities
                self._loaded = True
                self._last_refresh = now
                logger.info("Refreshed model capabilities cache", model_count=len(capabilities))

    def get_capabilities(self, model_id: str) -> dict[str, Any] | None:
        """Get capabilities for a model from cache."""
        return self._cache.get(model_id)

    def supports_vision(self, model_id: str) -> bool:
        """Check if a model supports vision from cache or fallback."""
        caps = self._cache.get(model_id)
        if caps:
            return bool(caps.get("supports_vision", False))
        # Fallback to hardcoded values
        return model_id in _FALLBACK_VISION_CAPABLE_MODELS

    def supports_thinking(self, model_id: str) -> bool:
        """Check if a model supports extended thinking from cache or fallback."""
        caps = self._cache.get(model_id)
        if caps:
            return bool(caps.get("supports_thinking", False))
        # Fallback to hardcoded values
        return model_id in _FALLBACK_THINKING_CAPABLE_MODELS

    @property
    def is_loaded(self) -> bool:
        """Check if cache has been loaded."""
        return self._loaded


# Global capabilities cache instance
_model_capabilities_cache = ModelCapabilitiesCache()


async def refresh_model_capabilities(force: bool = False) -> None:
    """Refresh the model capabilities cache.

    Call this on startup and periodically to keep capabilities in sync with the database.
    """
    await _model_capabilities_cache.refresh(force=force)


def supports_vision(model_id: str) -> bool:
    """Check if a model supports vision/image input.

    Uses cached capabilities from the API if available, otherwise falls back to hardcoded values.
    """
    return _model_capabilities_cache.supports_vision(model_id)


def supports_thinking(model_id: str) -> bool:
    """Check if a model supports extended thinking.

    Uses cached capabilities from the API if available, otherwise falls back to hardcoded values.
    """
    return _model_capabilities_cache.supports_thinking(model_id)


def get_model_capabilities(model_id: str) -> dict[str, Any] | None:
    """Get all capabilities for a model.

    Returns None if model is not in cache.
    """
    return _model_capabilities_cache.get_capabilities(model_id)


def get_default_model_for_role(role: str) -> str:
    """Get the default model ID for an agent role."""
    s = get_settings()
    role_map = {
        "architect": s.DEFAULT_ARCHITECT_MODEL,
        "coder": s.DEFAULT_CODER_MODEL,
        "reviewer": s.DEFAULT_REVIEWER_MODEL,
        "tester": s.DEFAULT_TESTER_MODEL,
        "chat": s.DEFAULT_CHAT_MODEL,
        "security": s.DEFAULT_SECURITY_MODEL,
        "devops": s.DEFAULT_DEVOPS_MODEL,
        "documentator": s.DEFAULT_DOCUMENTATOR_MODEL,
    }
    return role_map.get(role, s.DEFAULT_CODER_MODEL)


@lru_cache
def get_settings() -> Settings:
    """Get cached settings."""
    return Settings()


settings = get_settings()
