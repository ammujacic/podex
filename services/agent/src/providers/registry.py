"""Provider registry for managing LLM providers."""

from collections.abc import AsyncGenerator
from typing import Any, cast

import structlog

from .base import BaseProvider, ChatMessage, ChatResponse, ModelInfo
from .lmstudio import LMStudioProvider
from .ollama import OllamaProvider

logger = structlog.get_logger(__name__)


class ProviderRegistry:
    """Registry for managing multiple LLM providers."""

    def __init__(self) -> None:
        self._providers: dict[str, BaseProvider] = {}
        self._default_provider: str = "anthropic"

    def register_provider(self, name: str, provider: BaseProvider) -> None:
        """Register a provider."""
        self._providers[name] = provider

    def unregister_provider(self, name: str) -> None:
        """Unregister a provider."""
        if name in self._providers:
            del self._providers[name]

    def get_provider(self, name: str) -> BaseProvider | None:
        """Get a provider by name."""
        return self._providers.get(name)

    def set_default_provider(self, name: str) -> None:
        """Set the default provider."""
        self._default_provider = name

    async def list_all_models(self) -> list[ModelInfo]:
        """List models from all available providers."""
        all_models = []
        for name, provider in self._providers.items():
            try:
                if await provider.is_available():
                    models = await provider.list_models()
                    all_models.extend(models)
            except Exception as e:
                logger.warning(f"Failed to list models from {name}: {e}")
        return all_models

    async def check_availability(self) -> dict[str, bool]:
        """Check availability of all providers."""
        results = {}
        for name, provider in self._providers.items():
            try:
                results[name] = await provider.is_available()
            except Exception:
                results[name] = False
        return results

    def _get_provider_for_model(self, model: str) -> tuple[str, BaseProvider] | None:
        """Get the appropriate provider for a model ID."""
        # Check if model has explicit provider prefix
        if ":" in model:
            provider_name = model.split(":")[0]
            if provider_name in self._providers:
                return provider_name, self._providers[provider_name]

        # Otherwise use default provider
        if self._default_provider in self._providers:
            return self._default_provider, self._providers[self._default_provider]

        return None

    async def _execute_on_provider(
        self,
        model: str,
        operation: str,
        *args: Any,
        **kwargs: Any,
    ) -> Any:
        """Execute an operation on the appropriate provider for the model."""
        result = self._get_provider_for_model(model)
        if result is None:
            raise ValueError(
                f"No provider configured for model '{model}'. "
                f"Available providers: {list(self._providers.keys())}"
            )

        provider_name, provider = result

        if not await provider.is_available():
            raise RuntimeError(
                f"Provider '{provider_name}' for model '{model}' is not available. "
                "Please check that the provider service is running and accessible."
            )

        method = getattr(provider, operation)
        return await method(model, *args, **kwargs)

    async def chat(
        self,
        model: str,
        messages: list[ChatMessage],
        **kwargs: Any,
    ) -> ChatResponse:
        """Send chat request to the appropriate provider."""
        return cast(
            "ChatResponse",
            await self._execute_on_provider(model, "chat", messages, **kwargs),
        )

    async def chat_stream(
        self,
        model: str,
        messages: list[ChatMessage],
        **kwargs: Any,
    ) -> AsyncGenerator[str, None]:
        """Stream chat from the appropriate provider."""
        result = self._get_provider_for_model(model)
        if result is None:
            raise ValueError(
                f"No provider configured for model '{model}'. "
                f"Available providers: {list(self._providers.keys())}"
            )

        provider_name, provider = result

        if not await provider.is_available():
            raise RuntimeError(
                f"Provider '{provider_name}' for model '{model}' is not available. "
                "Please check that the provider service is running and accessible."
            )

        async for chunk in provider.chat_stream(model, messages, **kwargs):
            yield chunk

    async def completion(
        self,
        model: str,
        prompt: str,
        **kwargs: Any,
    ) -> ChatResponse:
        """Send completion request to the appropriate provider."""
        return cast(
            "ChatResponse",
            await self._execute_on_provider(model, "completion", prompt, **kwargs),
        )

    async def completion_stream(
        self,
        model: str,
        prompt: str,
        **kwargs: Any,
    ) -> AsyncGenerator[str, None]:
        """Stream completion from the appropriate provider."""
        result = self._get_provider_for_model(model)
        if result is None:
            raise ValueError(
                f"No provider configured for model '{model}'. "
                f"Available providers: {list(self._providers.keys())}"
            )

        provider_name, provider = result

        if not await provider.is_available():
            raise RuntimeError(
                f"Provider '{provider_name}' for model '{model}' is not available. "
                "Please check that the provider service is running and accessible."
            )

        async for chunk in provider.completion_stream(model, prompt, **kwargs):
            yield chunk

    async def close_all(self) -> None:
        """Close all providers."""
        for provider in self._providers.values():
            try:
                await provider.close()
            except Exception as e:
                logger.warning(f"Failed to close provider: {e}")


class ProviderRegistryHolder:
    """Singleton holder for the global provider registry instance."""

    _instance: ProviderRegistry | None = None

    @classmethod
    def get(cls) -> ProviderRegistry:
        """Get the global provider registry."""
        if cls._instance is None:
            cls._instance = ProviderRegistry()
        return cls._instance

    @classmethod
    def set(cls, registry: ProviderRegistry) -> None:
        """Set the global provider registry."""
        cls._instance = registry


def get_registry() -> ProviderRegistry:
    """Get the global provider registry."""
    return ProviderRegistryHolder.get()


async def initialize_providers(
    ollama_url: str | None = None,
    lmstudio_url: str | None = None,
    _anthropic_api_key: str | None = None,
    _openai_api_key: str | None = None,
    _google_api_key: str | None = None,
) -> ProviderRegistry:
    """Initialize providers with given configuration."""
    registry = get_registry()

    # Initialize local providers
    if ollama_url:
        ollama = OllamaProvider(base_url=ollama_url)
        if await ollama.is_available():
            registry.register_provider("ollama", ollama)
            logger.info("Registered Ollama provider")

    if lmstudio_url:
        lmstudio = LMStudioProvider(base_url=lmstudio_url)
        if await lmstudio.is_available():
            registry.register_provider("lmstudio", lmstudio)
            logger.info("Registered LM Studio provider")

    # Cloud providers would be initialized here with their API keys
    # For now, we use the existing llm.py provider for Anthropic

    return registry
