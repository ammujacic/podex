"""Agent service configuration."""

import asyncio
import tempfile
from functools import lru_cache
from pathlib import Path
from typing import Any, cast

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

    # LLM Providers
    LLM_PROVIDER: str = "openrouter"  # openrouter (default), anthropic, openai, ollama
    OPENROUTER_API_KEY: str | None = None  # For Podex-hosted models via OpenRouter
    ANTHROPIC_API_KEY: str | None = None  # For users with own API keys
    OPENAI_API_KEY: str | None = None  # For users with own API keys

    # Ollama (local LLM)
    OLLAMA_URL: str = "http://localhost:11434"
    OLLAMA_MODEL: str = "qwen2.5-coder:14b"  # Best local coding model

    # Default models by role (fallback only - actual defaults come from database)
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
    COMPUTE_INTERNAL_API_KEY: str | None = None  # Auth key for compute service calls

    # Internal Agent URL (for MCP self-referencing endpoints like /mcp/skills)
    # Docker Compose: http://agent:3002, GCP Cloud Run: https://agent-xxx.run.app
    AGENT_INTERNAL_URL: str = "http://agent:3002"

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
# Model Configuration
# ==========================================
# All model configuration is admin-controlled via the database.
# The agent service fetches capabilities from the API on startup and
# caches them in Redis. If capabilities are unknown for a model,
# we default to False (safe default).
#
# Admins manage models and defaults via:
# - /admin/models - Add/edit/delete available models
# - /admin/models/agent-defaults - Set default model per agent type

# Redis cache key for platform settings (same as API service)
PLATFORM_SETTINGS_CACHE_KEY = "podex:cache:platform_settings:all"


class SettingsNotAvailableError(Exception):
    """Raised when platform settings are not available in Redis cache."""

    pass


async def get_settings_from_cache() -> dict[str, Any]:
    """Get all platform settings from Redis cache.

    Returns:
        Dictionary of settings

    Raises:
        SettingsNotAvailableError: If settings are not available in cache
    """
    try:
        from podex_shared.redis_client import get_redis_client

        settings = get_settings()
        redis_client = get_redis_client(settings.REDIS_URL)
        await redis_client.connect()
        cached = await redis_client.get_json(PLATFORM_SETTINGS_CACHE_KEY)
        if cached and isinstance(cached, dict):
            return cached
    except Exception as e:
        raise SettingsNotAvailableError(f"Failed to get settings from Redis cache: {e}") from e

    raise SettingsNotAvailableError("Platform settings not found in Redis cache")


async def get_setting_from_cache(key: str) -> Any:
    """Get a single setting from Redis cache.

    Args:
        key: The setting key to look up

    Returns:
        Setting value

    Raises:
        SettingsNotAvailableError: If settings are not available or key not found
    """
    settings = await get_settings_from_cache()
    if key not in settings:
        raise SettingsNotAvailableError(f"Setting '{key}' not found in platform settings cache")
    return settings[key]


async def get_thinking_budget_config() -> dict[str, int]:
    """Get thinking budget configuration from Redis cache.

    Returns:
        Dictionary with default_budget, min_budget, max_budget

    Raises:
        SettingsNotAvailableError: If settings are not available
    """
    config = await get_setting_from_cache("thinking_budget_config")
    if not config or not isinstance(config, dict):
        raise SettingsNotAvailableError("thinking_budget_config not found or invalid")

    return {
        "default_budget": config["defaultBudget"],
        "min_budget": config["minBudget"],
        "max_budget": config["maxBudget"],
    }


async def get_context_limits() -> dict[str, int]:
    """Get context limits from Redis cache.

    Returns:
        Dictionary with max_tokens, output_reservation, summarization_threshold, token_threshold

    Raises:
        SettingsNotAvailableError: If settings are not available
    """
    config = await get_setting_from_cache("context_limits")
    if not config or not isinstance(config, dict):
        raise SettingsNotAvailableError("context_limits not found or invalid")

    return {
        "max_tokens": config.get("maxContextTokens", 100_000),
        "output_reservation": config.get("outputReservation", 4096),
        "summarization_threshold": config.get("summarizationThreshold", 80_000),
        "token_threshold": config.get("tokenThreshold", 50_000),
    }


async def get_anthropic_prompt_caching_enabled() -> bool:
    """Whether Anthropic prompt caching is enabled (admin-controlled, default True).

    Reads from platform feature_flags in Redis cache. Used by LLMProvider when
    building Anthropic requests with cache_control on conversation summaries.
    """
    try:
        flags = await get_setting_from_cache("feature_flags")
        if flags and isinstance(flags, dict):
            return bool(flags.get("anthropic_prompt_caching_enabled", True))
    except SettingsNotAvailableError:
        pass
    return True


# Default thinking budget values (these are used by synchronous code
# that can't call async functions). Should match database seed values.
DEFAULT_THINKING_BUDGET = 8000
MIN_THINKING_BUDGET = 1024
MAX_THINKING_BUDGET = 32000


# ==========================================
# Model Capabilities Cache (Redis-backed)
# ==========================================

# Redis cache key for model capabilities
MODEL_CAPABILITIES_CACHE_KEY = "agent:model_capabilities"
MODEL_CAPABILITIES_CACHE_TTL = 300  # 5 minutes


class ModelCapabilitiesCache:
    """Cache for model capabilities fetched from the API service.

    Uses Redis for distributed caching to ensure consistency across agent instances.
    Falls back to hardcoded values if Redis and API are unavailable.
    """

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._last_refresh: float = 0
        self._refresh_interval = 300  # 5 minutes

    async def _get_redis(self) -> Any:
        """Get connected Redis client."""
        from podex_shared.redis_client import get_redis_client

        settings = get_settings()
        redis_client = get_redis_client(settings.REDIS_URL)
        await redis_client.connect()
        return redis_client

    async def _get_from_redis(self) -> dict[str, dict[str, Any]] | None:
        """Get capabilities from Redis cache."""
        try:
            redis_client = await self._get_redis()
            cached = await redis_client.get_json(MODEL_CAPABILITIES_CACHE_KEY)
            if cached and isinstance(cached, dict):
                return cast("dict[str, dict[str, Any]]", cached)
        except Exception as e:
            logger.warning("Failed to get model capabilities from Redis", error=str(e))
        return None

    async def _set_in_redis(self, capabilities: dict[str, dict[str, Any]]) -> None:
        """Store capabilities in Redis cache."""
        try:
            redis_client = await self._get_redis()
            await redis_client.set_json(
                MODEL_CAPABILITIES_CACHE_KEY, capabilities, ex=MODEL_CAPABILITIES_CACHE_TTL
            )
        except Exception as e:
            logger.warning("Failed to set model capabilities in Redis", error=str(e))

    async def _fetch_capabilities(self) -> dict[str, dict[str, Any]]:
        """Fetch model capabilities from the API service."""
        settings = get_settings()
        try:
            headers = {}
            if settings.INTERNAL_SERVICE_TOKEN:
                headers["Authorization"] = f"Bearer {settings.INTERNAL_SERVICE_TOKEN}"

            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(
                    f"{settings.API_BASE_URL}/api/models/capabilities",
                    headers=headers,
                )
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
        if not force and (now - self._last_refresh) < self._refresh_interval:
            # Check if Redis already has fresh data
            cached = await self._get_from_redis()
            if cached:
                return

        async with self._lock:
            # Double-check after acquiring lock
            if not force and (now - self._last_refresh) < self._refresh_interval:
                cached = await self._get_from_redis()
                if cached:
                    return

            capabilities = await self._fetch_capabilities()
            if capabilities:
                await self._set_in_redis(capabilities)
                self._last_refresh = now
                logger.info(
                    "Refreshed model capabilities cache in Redis", model_count=len(capabilities)
                )

    async def get_capabilities(self, model_id: str) -> dict[str, Any] | None:
        """Get capabilities for a model from Redis cache."""
        cached = await self._get_from_redis()
        if cached:
            return cached.get(model_id)
        return None

    async def supports_vision(self, model_id: str) -> bool:
        """Check if a model supports vision from Redis cache.

        Returns False if capabilities are not cached (safe default).
        """
        cached = await self._get_from_redis()
        if cached:
            caps = cached.get(model_id)
            if caps:
                return bool(caps.get("supports_vision", False))
        # Safe default: assume no vision support if unknown
        logger.debug("Model capabilities not cached, defaulting to no vision", model_id=model_id)
        return False

    async def supports_thinking(self, model_id: str) -> bool:
        """Check if a model supports extended thinking from Redis cache.

        Returns False if capabilities are not cached (safe default).
        """
        cached = await self._get_from_redis()
        if cached:
            caps = cached.get(model_id)
            if caps:
                return bool(caps.get("supports_thinking", False))
        # Safe default: assume no thinking support if unknown
        logger.debug("Model capabilities not cached, defaulting to no thinking", model_id=model_id)
        return False


# Global capabilities cache instance
_model_capabilities_cache = ModelCapabilitiesCache()


async def refresh_model_capabilities(force: bool = False) -> None:
    """Refresh the model capabilities cache.

    Call this on startup and periodically to keep capabilities in sync with the database.
    """
    await _model_capabilities_cache.refresh(force=force)


async def supports_vision_async(model_id: str) -> bool:
    """Check if a model supports vision/image input.

    Uses cached capabilities from Redis. Returns False if not cached (safe default).
    """
    return await _model_capabilities_cache.supports_vision(model_id)


async def supports_thinking_async(model_id: str) -> bool:
    """Check if a model supports extended thinking.

    Uses cached capabilities from Redis. Returns False if not cached (safe default).
    """
    return await _model_capabilities_cache.supports_thinking(model_id)


async def get_model_capabilities(model_id: str) -> dict[str, Any] | None:
    """Get all capabilities for a model.

    Returns None if model is not in cache.
    """
    return await _model_capabilities_cache.get_capabilities(model_id)


@lru_cache
def get_settings() -> Settings:
    """Get cached settings."""
    return Settings()


settings = get_settings()
