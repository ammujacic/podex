"""Tests for config module.

Tests cover:
- Settings class initialization
- Default values
- Environment variable handling
"""

import os
from typing import Any
from unittest.mock import MagicMock, patch

import pytest


class TestSettingsClass:
    """Test Settings class."""

    def test_settings_exists(self):
        """Test Settings class exists."""
        from src.config import Settings
        assert Settings is not None

    def test_settings_has_version(self):
        """Test Settings has VERSION."""
        from src.config import settings
        assert settings.VERSION is not None

    def test_settings_has_environment(self):
        """Test Settings has ENVIRONMENT."""
        from src.config import settings
        assert settings.ENVIRONMENT is not None

    def test_settings_has_port(self):
        """Test Settings has PORT."""
        from src.config import settings
        assert settings.PORT is not None
        assert isinstance(settings.PORT, int)

    def test_settings_has_database_url(self):
        """Test Settings has DATABASE_URL."""
        from src.config import settings
        assert settings.DATABASE_URL is not None
        assert "postgresql" in settings.DATABASE_URL

    def test_settings_has_redis_url(self):
        """Test Settings has REDIS_URL."""
        from src.config import settings
        assert settings.REDIS_URL is not None
        assert "redis" in settings.REDIS_URL


class TestDefaultModels:
    """Test default model settings.

    Note: All model configuration is admin-controlled via the database.
    The agent service fetches capabilities from the API and caches them in Redis.
    """

    def test_async_capability_functions_exist(self):
        """Test async capability functions are available."""
        from src.config import supports_thinking_async, supports_vision_async

        # These should be async functions
        import inspect

        assert inspect.iscoroutinefunction(supports_vision_async)
        assert inspect.iscoroutinefunction(supports_thinking_async)


class TestToolExecutionLimits:
    """Test tool execution limit settings."""

    def test_command_timeout(self):
        """Test command timeout setting."""
        from src.config import settings
        assert settings.COMMAND_TIMEOUT > 0

    def test_max_file_size(self):
        """Test max file size setting."""
        from src.config import settings
        assert settings.MAX_FILE_SIZE > 0

    def test_max_search_results(self):
        """Test max search results setting."""
        from src.config import settings
        assert settings.MAX_SEARCH_RESULTS > 0


class TestTaskQueueSettings:
    """Test task queue settings."""

    def test_task_queue_poll_interval(self):
        """Test task queue poll interval."""
        from src.config import settings
        assert settings.TASK_QUEUE_POLL_INTERVAL > 0

    def test_task_ttl(self):
        """Test task TTL."""
        from src.config import settings
        assert settings.TASK_TTL > 0

    def test_task_max_retries(self):
        """Test task max retries."""
        from src.config import settings
        assert settings.TASK_MAX_RETRIES >= 0


class TestStreamingSettings:
    """Test streaming settings."""

    def test_streaming_enabled(self):
        """Test streaming enabled setting."""
        from src.config import settings
        assert isinstance(settings.STREAMING_ENABLED, bool)

    def test_streaming_buffer_size(self):
        """Test streaming buffer size."""
        from src.config import settings
        assert settings.STREAMING_BUFFER_SIZE > 0


class TestContextWindowSettings:
    """Test context window settings."""

    def test_max_context_tokens(self):
        """Test max context tokens."""
        from src.config import settings
        assert settings.MAX_CONTEXT_TOKENS > 0

    def test_context_output_reservation(self):
        """Test context output reservation."""
        from src.config import settings
        assert settings.CONTEXT_OUTPUT_RESERVATION > 0

    def test_context_summarization_threshold(self):
        """Test context summarization threshold."""
        from src.config import settings
        assert settings.CONTEXT_SUMMARIZATION_THRESHOLD > 0

    def test_context_token_threshold(self):
        """Test context token threshold."""
        from src.config import settings
        assert settings.CONTEXT_TOKEN_THRESHOLD > 0


class TestServiceURLs:
    """Test service URL settings."""

    def test_api_base_url(self) -> None:
        """Test API base URL."""
        from src.config import settings
        assert settings.API_BASE_URL is not None
        assert "http" in settings.API_BASE_URL


class TestLLMProviderSettings:
    """Test LLM provider settings."""

    def test_ollama_url(self):
        """Test Ollama URL setting."""
        from src.config import settings
        assert settings.OLLAMA_URL is not None

    def test_ollama_model(self):
        """Test Ollama model setting."""
        from src.config import settings
        assert settings.OLLAMA_MODEL is not None


class TestModelCapabilitiesCache:
    """Test ModelCapabilitiesCache class.

    Note: GCP settings (GCP_REGION, GCS_BUCKET) have been removed.
    Model capabilities are now managed via Redis cache with API fallback.
    """

    def test_model_capabilities_cache_exists(self):
        """Test ModelCapabilitiesCache class exists."""
        from src.config import ModelCapabilitiesCache

        assert ModelCapabilitiesCache is not None

    def test_model_capabilities_cache_key_defined(self):
        """Test MODEL_CAPABILITIES_CACHE_KEY is defined."""
        from src.config import MODEL_CAPABILITIES_CACHE_KEY

        assert MODEL_CAPABILITIES_CACHE_KEY is not None
        assert isinstance(MODEL_CAPABILITIES_CACHE_KEY, str)

    def test_platform_settings_cache_key_defined(self):
        """Test PLATFORM_SETTINGS_CACHE_KEY is defined."""
        from src.config import PLATFORM_SETTINGS_CACHE_KEY

        assert PLATFORM_SETTINGS_CACHE_KEY is not None
        assert isinstance(PLATFORM_SETTINGS_CACHE_KEY, str)


class TestSentrySettings:
    """Test Sentry settings."""

    def test_sentry_traces_sample_rate(self):
        """Test Sentry traces sample rate."""
        from src.config import settings
        assert 0 <= settings.SENTRY_TRACES_SAMPLE_RATE <= 1

    def test_sentry_profiles_sample_rate(self):
        """Test Sentry profiles sample rate."""
        from src.config import settings
        assert 0 <= settings.SENTRY_PROFILES_SAMPLE_RATE <= 1


class TestWorkspaceSettings:
    """Test workspace settings."""

    def test_workspace_base_path(self):
        """Test workspace base path."""
        from src.config import settings
        assert settings.WORKSPACE_BASE_PATH is not None
        assert "podex" in settings.WORKSPACE_BASE_PATH


class TestPlatformSettingsCache:
    """Tests for platform settings cache helpers."""

    @pytest.mark.asyncio
    async def test_get_settings_from_cache_success(self, monkeypatch: pytest.MonkeyPatch):
        """get_settings_from_cache returns dict when Redis has data."""
        from src import config as config_module

        fake_data = {"foo": "bar"}

        class FakeRedisClient:
            async def connect(self) -> None:  # pragma: no cover - trivial
                return None

            async def get_json(self, key: str) -> dict[str, Any]:
                assert key == config_module.PLATFORM_SETTINGS_CACHE_KEY
                return fake_data

        def fake_get_redis_client(url: str) -> FakeRedisClient:
            assert url == config_module.settings.REDIS_URL
            return FakeRedisClient()

        monkeypatch.setattr(
            "podex_shared.redis_client.get_redis_client",
            fake_get_redis_client,
        )

        result = await config_module.get_settings_from_cache()
        assert result == fake_data

    @pytest.mark.asyncio
    async def test_get_settings_from_cache_error_raises(self, monkeypatch: pytest.MonkeyPatch):
        """get_settings_from_cache wraps errors in SettingsNotAvailableError."""
        from src import config as config_module

        def fake_get_redis_client(url: str) -> Any:
            raise RuntimeError("boom")

        monkeypatch.setattr(
            "podex_shared.redis_client.get_redis_client",
            fake_get_redis_client,
        )

        with pytest.raises(config_module.SettingsNotAvailableError):
            await config_module.get_settings_from_cache()

    @pytest.mark.asyncio
    async def test_get_setting_from_cache_missing_key_raises(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ):
        """get_setting_from_cache raises when key not present."""
        from src import config as config_module

        class FakeRedisClient:
            async def connect(self) -> None:
                return None

            async def get_json(self, key: str) -> dict[str, Any]:
                return {"other": "value"}

        def fake_get_redis_client(url: str) -> FakeRedisClient:
            return FakeRedisClient()

        monkeypatch.setattr(
            "podex_shared.redis_client.get_redis_client",
            fake_get_redis_client,
        )

        with pytest.raises(config_module.SettingsNotAvailableError):
            await config_module.get_setting_from_cache("missing_key")

    @pytest.mark.asyncio
    async def test_get_thinking_budget_config_happy_path(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ):
        """get_thinking_budget_config maps keys correctly."""
        from src import config as config_module

        async def fake_get_setting_from_cache(key: str) -> dict[str, int]:
            assert key == "thinking_budget_config"
            return {"defaultBudget": 10, "minBudget": 5, "maxBudget": 20}

        monkeypatch.setattr(
            config_module,
            "get_setting_from_cache",
            fake_get_setting_from_cache,
        )

        cfg = await config_module.get_thinking_budget_config()
        assert cfg == {"default_budget": 10, "min_budget": 5, "max_budget": 20}

    @pytest.mark.asyncio
    async def test_get_thinking_budget_config_invalid_raises(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ):
        """get_thinking_budget_config raises on invalid config."""
        from src import config as config_module

        async def fake_get_setting_from_cache(key: str) -> Any:
            return "not-a-dict"

        monkeypatch.setattr(
            config_module,
            "get_setting_from_cache",
            fake_get_setting_from_cache,
        )

        with pytest.raises(config_module.SettingsNotAvailableError):
            await config_module.get_thinking_budget_config()


class TestContextLimitsConfig:
    """Tests for get_context_limits helper."""

    @pytest.mark.asyncio
    async def test_get_context_limits_with_custom_values(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ):
        """Uses values from config when present."""
        from src import config as config_module

        async def fake_get_setting_from_cache(key: str) -> dict[str, int]:
            assert key == "context_limits"
            return {
                "maxContextTokens": 123,
                "outputReservation": 456,
                "summarizationThreshold": 789,
                "tokenThreshold": 999,
            }

        monkeypatch.setattr(
            config_module,
            "get_setting_from_cache",
            fake_get_setting_from_cache,
        )

        cfg = await config_module.get_context_limits()
        assert cfg == {
            "max_tokens": 123,
            "output_reservation": 456,
            "summarization_threshold": 789,
            "token_threshold": 999,
        }

    @pytest.mark.asyncio
    async def test_get_context_limits_uses_defaults_when_missing(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ):
        """Falls back to defaults when keys missing."""
        from src import config as config_module

        async def fake_get_setting_from_cache(key: str) -> dict[str, int]:
            # Non-empty dict without expected keys should trigger defaults via .get(...)
            return {"other": 1}

        monkeypatch.setattr(
            config_module,
            "get_setting_from_cache",
            fake_get_setting_from_cache,
        )

        cfg = await config_module.get_context_limits()
        assert cfg["max_tokens"] == 100_000
        assert cfg["output_reservation"] == 4096
        assert cfg["token_threshold"] == 50_000

    @pytest.mark.asyncio
    async def test_get_context_limits_invalid_raises(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ):
        """Raises when stored value is not a dict."""
        from src import config as config_module

        async def fake_get_setting_from_cache(key: str) -> Any:
            return None

        monkeypatch.setattr(
            config_module,
            "get_setting_from_cache",
            fake_get_setting_from_cache,
        )

        with pytest.raises(config_module.SettingsNotAvailableError):
            await config_module.get_context_limits()


class TestAnthropicPromptCachingFlag:
    """Tests for get_anthropic_prompt_caching_enabled helper."""

    @pytest.mark.asyncio
    async def test_anthropic_prompt_caching_enabled_true(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ):
        """Returns flag value when present."""
        from src import config as config_module

        async def fake_get_setting_from_cache(key: str) -> dict[str, Any]:
            assert key == "feature_flags"
            return {"anthropic_prompt_caching_enabled": False}

        monkeypatch.setattr(
            config_module,
            "get_setting_from_cache",
            fake_get_setting_from_cache,
        )

        assert await config_module.get_anthropic_prompt_caching_enabled() is False

    @pytest.mark.asyncio
    async def test_anthropic_prompt_caching_enabled_default_true_on_missing(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ):
        """Defaults to True when flag missing or unavailable."""
        from src import config as config_module

        async def fake_get_setting_from_cache(key: str) -> dict[str, Any]:
            return {}

        monkeypatch.setattr(
            config_module,
            "get_setting_from_cache",
            fake_get_setting_from_cache,
        )

        assert await config_module.get_anthropic_prompt_caching_enabled() is True

        async def raise_not_available(key: str) -> Any:
            raise config_module.SettingsNotAvailableError("no cache")

        monkeypatch.setattr(
            config_module,
            "get_setting_from_cache",
            raise_not_available,
        )

        assert await config_module.get_anthropic_prompt_caching_enabled() is True
