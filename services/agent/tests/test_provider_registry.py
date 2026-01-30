"""Tests for provider registry module.

Tests cover:
- ProviderRegistry initialization and provider management
- Provider resolution
- ProviderRegistryHolder singleton
"""

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


class TestProviderRegistryInit:
    """Test ProviderRegistry initialization."""

    def test_registry_module_exists(self):
        """Test registry module can be imported."""
        from src.providers import registry
        assert registry is not None

    def test_provider_registry_class_exists(self):
        """Test ProviderRegistry class exists."""
        from src.providers.registry import ProviderRegistry
        assert ProviderRegistry is not None

    def test_provider_registry_initialization(self):
        """Test ProviderRegistry initialization."""
        from src.providers.registry import ProviderRegistry

        registry = ProviderRegistry()
        assert registry._providers == {}
        assert registry._default_provider == "anthropic"


class TestProviderRegistration:
    """Test provider registration and unregistration."""

    def test_register_provider(self):
        """Test registering a provider."""
        from src.providers.registry import ProviderRegistry

        registry = ProviderRegistry()
        mock_provider = MagicMock()

        registry.register_provider("test", mock_provider)
        assert "test" in registry._providers
        assert registry._providers["test"] == mock_provider

    def test_unregister_provider(self):
        """Test unregistering a provider."""
        from src.providers.registry import ProviderRegistry

        registry = ProviderRegistry()
        mock_provider = MagicMock()
        registry.register_provider("test", mock_provider)

        registry.unregister_provider("test")
        assert "test" not in registry._providers

    def test_unregister_nonexistent_provider(self):
        """Test unregistering a provider that doesn't exist."""
        from src.providers.registry import ProviderRegistry

        registry = ProviderRegistry()
        # Should not raise
        registry.unregister_provider("nonexistent")

    def test_get_provider(self):
        """Test getting a provider."""
        from src.providers.registry import ProviderRegistry

        registry = ProviderRegistry()
        mock_provider = MagicMock()
        registry.register_provider("test", mock_provider)

        result = registry.get_provider("test")
        assert result == mock_provider

    def test_get_nonexistent_provider(self):
        """Test getting a provider that doesn't exist."""
        from src.providers.registry import ProviderRegistry

        registry = ProviderRegistry()
        result = registry.get_provider("nonexistent")
        assert result is None


class TestDefaultProvider:
    """Test default provider configuration."""

    def test_set_default_provider(self):
        """Test setting default provider."""
        from src.providers.registry import ProviderRegistry

        registry = ProviderRegistry()
        registry.set_default_provider("openai")
        assert registry._default_provider == "openai"


class TestProviderResolution:
    """Test provider resolution for models."""

    def test_get_provider_for_model_with_prefix(self):
        """Test getting provider for model with provider prefix."""
        from src.providers.registry import ProviderRegistry

        registry = ProviderRegistry()
        mock_provider = MagicMock()
        registry.register_provider("ollama", mock_provider)

        result = registry._get_provider_for_model("ollama:llama2")
        assert result is not None
        assert result[0] == "ollama"
        assert result[1] == mock_provider

    def test_get_provider_for_model_without_prefix(self):
        """Test getting provider for model without prefix uses default."""
        from src.providers.registry import ProviderRegistry

        registry = ProviderRegistry()
        mock_provider = MagicMock()
        registry.register_provider("anthropic", mock_provider)

        result = registry._get_provider_for_model("claude-3-5-sonnet")
        assert result is not None
        assert result[0] == "anthropic"
        assert result[1] == mock_provider

    def test_get_provider_for_model_no_matching_provider(self):
        """Test getting provider when no matching provider exists."""
        from src.providers.registry import ProviderRegistry

        registry = ProviderRegistry()
        # No providers registered

        result = registry._get_provider_for_model("some-model")
        assert result is None


class TestProviderRegistryHolder:
    """Test ProviderRegistryHolder singleton."""

    def test_holder_class_exists(self):
        """Test ProviderRegistryHolder class exists."""
        from src.providers.registry import ProviderRegistryHolder
        assert ProviderRegistryHolder is not None

    def test_holder_get_creates_instance(self):
        """Test get() creates instance if none exists."""
        from src.providers.registry import ProviderRegistryHolder, ProviderRegistry

        # Reset singleton
        ProviderRegistryHolder._instance = None

        result = ProviderRegistryHolder.get()
        assert result is not None
        assert isinstance(result, ProviderRegistry)

    def test_holder_get_returns_same_instance(self):
        """Test get() returns same instance."""
        from src.providers.registry import ProviderRegistryHolder

        # Reset singleton
        ProviderRegistryHolder._instance = None

        first = ProviderRegistryHolder.get()
        second = ProviderRegistryHolder.get()
        assert first is second

    def test_holder_set(self):
        """Test set() sets the instance."""
        from src.providers.registry import ProviderRegistryHolder, ProviderRegistry

        registry = ProviderRegistry()
        ProviderRegistryHolder.set(registry)

        assert ProviderRegistryHolder._instance is registry


class TestGetRegistry:
    """Test get_registry function."""

    def test_get_registry_function_exists(self):
        """Test get_registry function exists."""
        from src.providers.registry import get_registry
        assert callable(get_registry)

    def test_get_registry_returns_provider_registry(self):
        """Test get_registry returns ProviderRegistry."""
        from src.providers.registry import get_registry, ProviderRegistry, ProviderRegistryHolder

        # Reset singleton
        ProviderRegistryHolder._instance = None

        result = get_registry()
        assert isinstance(result, ProviderRegistry)


class TestProviderRegistryAsync:
    """Test async methods of ProviderRegistry."""

    @pytest.mark.asyncio
    async def test_list_all_models(self):
        """Test listing models from all providers."""
        from src.providers.registry import ProviderRegistry
        from src.providers.base import ModelInfo

        registry = ProviderRegistry()

        mock_provider = AsyncMock()
        mock_provider.is_available = AsyncMock(return_value=True)
        mock_provider.list_models = AsyncMock(return_value=[
            ModelInfo(
                id="model1",
                name="Model 1",
                provider="test",
                context_window=8192,
                max_output_tokens=4096,
                input_price_per_million=0.01,
                output_price_per_million=0.03,
            )
        ])

        registry.register_provider("test", mock_provider)

        models = await registry.list_all_models()
        assert len(models) == 1
        assert models[0].id == "model1"

    @pytest.mark.asyncio
    async def test_list_all_models_provider_unavailable(self):
        """Test listing models when provider is unavailable."""
        from src.providers.registry import ProviderRegistry

        registry = ProviderRegistry()

        mock_provider = AsyncMock()
        mock_provider.is_available = AsyncMock(return_value=False)

        registry.register_provider("test", mock_provider)

        models = await registry.list_all_models()
        assert len(models) == 0

    @pytest.mark.asyncio
    async def test_list_all_models_provider_error(self):
        """Test listing models when provider raises error."""
        from src.providers.registry import ProviderRegistry

        registry = ProviderRegistry()

        mock_provider = AsyncMock()
        mock_provider.is_available = AsyncMock(side_effect=Exception("Error"))

        registry.register_provider("test", mock_provider)

        # Should not raise, just skip the provider
        models = await registry.list_all_models()
        assert len(models) == 0

    @pytest.mark.asyncio
    async def test_check_availability(self):
        """Test checking availability of providers."""
        from src.providers.registry import ProviderRegistry

        registry = ProviderRegistry()

        mock_provider1 = AsyncMock()
        mock_provider1.is_available = AsyncMock(return_value=True)

        mock_provider2 = AsyncMock()
        mock_provider2.is_available = AsyncMock(return_value=False)

        registry.register_provider("test1", mock_provider1)
        registry.register_provider("test2", mock_provider2)

        results = await registry.check_availability()
        assert results["test1"] is True
        assert results["test2"] is False

    @pytest.mark.asyncio
    async def test_check_availability_with_error(self):
        """Test checking availability when provider raises error."""
        from src.providers.registry import ProviderRegistry

        registry = ProviderRegistry()

        mock_provider = AsyncMock()
        mock_provider.is_available = AsyncMock(side_effect=Exception("Error"))

        registry.register_provider("test", mock_provider)

        results = await registry.check_availability()
        assert results["test"] is False

    @pytest.mark.asyncio
    async def test_chat(self):
        """Test chat request."""
        from src.providers.registry import ProviderRegistry
        from src.providers.base import ChatMessage, ChatResponse

        registry = ProviderRegistry()

        mock_provider = AsyncMock()
        mock_provider.is_available = AsyncMock(return_value=True)
        mock_provider.chat = AsyncMock(return_value=ChatResponse(
            content="Hello",
            model="test-model",
            input_tokens=10,
            output_tokens=5,
            stop_reason="stop",
        ))

        registry.register_provider("anthropic", mock_provider)

        messages = [ChatMessage(role="user", content="Hi")]
        response = await registry.chat("claude-3-5-sonnet", messages)

        assert response.content == "Hello"
        mock_provider.chat.assert_called_once()

    @pytest.mark.asyncio
    async def test_chat_no_provider_configured(self):
        """Test chat when no provider is configured."""
        from src.providers.registry import ProviderRegistry
        from src.providers.base import ChatMessage

        registry = ProviderRegistry()
        messages = [ChatMessage(role="user", content="Hi")]

        with pytest.raises(ValueError, match="No provider configured"):
            await registry.chat("unknown-model", messages)

    @pytest.mark.asyncio
    async def test_chat_provider_unavailable(self):
        """Test chat when provider is not available."""
        from src.providers.registry import ProviderRegistry
        from src.providers.base import ChatMessage

        registry = ProviderRegistry()

        mock_provider = AsyncMock()
        mock_provider.is_available = AsyncMock(return_value=False)

        registry.register_provider("anthropic", mock_provider)

        messages = [ChatMessage(role="user", content="Hi")]

        with pytest.raises(RuntimeError, match="is not available"):
            await registry.chat("claude-3-5-sonnet", messages)

    @pytest.mark.asyncio
    async def test_completion(self):
        """Test completion request."""
        from src.providers.registry import ProviderRegistry
        from src.providers.base import ChatResponse

        registry = ProviderRegistry()

        mock_provider = AsyncMock()
        mock_provider.is_available = AsyncMock(return_value=True)
        mock_provider.completion = AsyncMock(return_value=ChatResponse(
            content="Completed",
            model="test-model",
            input_tokens=10,
            output_tokens=5,
            stop_reason="stop",
        ))

        registry.register_provider("anthropic", mock_provider)

        response = await registry.completion("claude-3-5-sonnet", "Hello")

        assert response.content == "Completed"
        mock_provider.completion.assert_called_once()

    @pytest.mark.asyncio
    async def test_close_all(self):
        """Test closing all providers."""
        from src.providers.registry import ProviderRegistry

        registry = ProviderRegistry()

        mock_provider1 = AsyncMock()
        mock_provider2 = AsyncMock()

        registry.register_provider("test1", mock_provider1)
        registry.register_provider("test2", mock_provider2)

        await registry.close_all()

        mock_provider1.close.assert_called_once()
        mock_provider2.close.assert_called_once()

    @pytest.mark.asyncio
    async def test_close_all_with_error(self):
        """Test closing providers when one raises error."""
        from src.providers.registry import ProviderRegistry

        registry = ProviderRegistry()

        mock_provider = AsyncMock()
        mock_provider.close = AsyncMock(side_effect=Exception("Close failed"))

        registry.register_provider("test", mock_provider)

        # Should not raise
        await registry.close_all()


class TestChatStream:
    """Test chat streaming functionality."""

    @pytest.mark.asyncio
    async def test_chat_stream(self):
        """Test chat streaming."""
        from src.providers.registry import ProviderRegistry
        from src.providers.base import ChatMessage

        registry = ProviderRegistry()

        async def mock_stream(*args, **kwargs):
            for chunk in ["Hello", " ", "World"]:
                yield chunk

        mock_provider = AsyncMock()
        mock_provider.is_available = AsyncMock(return_value=True)
        mock_provider.chat_stream = mock_stream

        registry.register_provider("anthropic", mock_provider)

        messages = [ChatMessage(role="user", content="Hi")]
        chunks = []
        async for chunk in registry.chat_stream("claude-3-5-sonnet", messages):
            chunks.append(chunk)

        assert chunks == ["Hello", " ", "World"]

    @pytest.mark.asyncio
    async def test_chat_stream_no_provider(self):
        """Test chat streaming when no provider configured."""
        from src.providers.registry import ProviderRegistry
        from src.providers.base import ChatMessage

        registry = ProviderRegistry()
        messages = [ChatMessage(role="user", content="Hi")]

        with pytest.raises(ValueError, match="No provider configured"):
            async for _ in registry.chat_stream("unknown-model", messages):
                pass

    @pytest.mark.asyncio
    async def test_chat_stream_provider_unavailable(self):
        """Test chat streaming when provider is not available."""
        from src.providers.registry import ProviderRegistry
        from src.providers.base import ChatMessage

        registry = ProviderRegistry()

        mock_provider = AsyncMock()
        mock_provider.is_available = AsyncMock(return_value=False)

        registry.register_provider("anthropic", mock_provider)

        messages = [ChatMessage(role="user", content="Hi")]

        with pytest.raises(RuntimeError, match="is not available"):
            async for _ in registry.chat_stream("claude-3-5-sonnet", messages):
                pass


class TestCompletionStream:
    """Test completion streaming functionality."""

    @pytest.mark.asyncio
    async def test_completion_stream(self):
        """Test completion streaming."""
        from src.providers.registry import ProviderRegistry

        registry = ProviderRegistry()

        async def mock_stream(*args, **kwargs):
            for chunk in ["Hello", " ", "World"]:
                yield chunk

        mock_provider = AsyncMock()
        mock_provider.is_available = AsyncMock(return_value=True)
        mock_provider.completion_stream = mock_stream

        registry.register_provider("anthropic", mock_provider)

        chunks = []
        async for chunk in registry.completion_stream("claude-3-5-sonnet", "Hello"):
            chunks.append(chunk)

        assert chunks == ["Hello", " ", "World"]

    @pytest.mark.asyncio
    async def test_completion_stream_no_provider(self):
        """Test completion streaming when no provider configured."""
        from src.providers.registry import ProviderRegistry

        registry = ProviderRegistry()

        with pytest.raises(ValueError, match="No provider configured"):
            async for _ in registry.completion_stream("unknown-model", "Hello"):
                pass

    @pytest.mark.asyncio
    async def test_completion_stream_provider_unavailable(self):
        """Test completion streaming when provider is not available."""
        from src.providers.registry import ProviderRegistry

        registry = ProviderRegistry()

        mock_provider = AsyncMock()
        mock_provider.is_available = AsyncMock(return_value=False)

        registry.register_provider("anthropic", mock_provider)

        with pytest.raises(RuntimeError, match="is not available"):
            async for _ in registry.completion_stream("claude-3-5-sonnet", "Hello"):
                pass


class TestInitializeProviders:
    """Test initialize_providers function."""

    def test_initialize_providers_function_exists(self):
        """Test initialize_providers function exists."""
        from src.providers.registry import initialize_providers
        assert callable(initialize_providers)

    @pytest.mark.asyncio
    async def test_initialize_providers_with_ollama(self):
        """Test initializing providers with Ollama."""
        from src.providers.registry import initialize_providers, ProviderRegistryHolder

        # Reset singleton
        ProviderRegistryHolder._instance = None

        with patch("src.providers.registry.OllamaProvider") as mock_ollama_class:
            mock_ollama = AsyncMock()
            mock_ollama.is_available = AsyncMock(return_value=True)
            mock_ollama_class.return_value = mock_ollama

            registry = await initialize_providers(ollama_url="http://localhost:11434")

            assert "ollama" in registry._providers

    @pytest.mark.asyncio
    async def test_initialize_providers_ollama_unavailable(self):
        """Test initializing providers when Ollama is unavailable."""
        from src.providers.registry import initialize_providers, ProviderRegistryHolder

        # Reset singleton
        ProviderRegistryHolder._instance = None

        with patch("src.providers.registry.OllamaProvider") as mock_ollama_class:
            mock_ollama = AsyncMock()
            mock_ollama.is_available = AsyncMock(return_value=False)
            mock_ollama_class.return_value = mock_ollama

            registry = await initialize_providers(ollama_url="http://localhost:11434")

            assert "ollama" not in registry._providers

    @pytest.mark.asyncio
    async def test_initialize_providers_with_lmstudio(self):
        """Test initializing providers with LM Studio."""
        from src.providers.registry import initialize_providers, ProviderRegistryHolder

        # Reset singleton
        ProviderRegistryHolder._instance = None

        with patch("src.providers.registry.LMStudioProvider") as mock_lmstudio_class:
            mock_lmstudio = AsyncMock()
            mock_lmstudio.is_available = AsyncMock(return_value=True)
            mock_lmstudio_class.return_value = mock_lmstudio

            registry = await initialize_providers(lmstudio_url="http://localhost:1234")

            assert "lmstudio" in registry._providers
