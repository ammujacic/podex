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

    def test_compute_service_url_removed(self) -> None:
        """Test compute service URL is no longer a static setting.

        The compute service URL is now looked up per-workspace from the database
        based on the workspace's assigned server. This enables multi-region
        deployments where different workspaces use different compute services.
        """
        from src.config import settings
        # Verify the setting no longer exists as a static config
        assert not hasattr(settings, "COMPUTE_SERVICE_URL")


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
