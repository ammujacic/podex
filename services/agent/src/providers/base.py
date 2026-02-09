"""Base provider interface and common types for LLM providers."""

from abc import ABC, abstractmethod
from collections.abc import AsyncGenerator
from dataclasses import dataclass, field
from typing import Any, Literal


@dataclass
class ChatMessage:
    """A message in a chat conversation."""

    role: Literal["system", "user", "assistant"]
    content: str
    name: str | None = None


@dataclass
class ChatResponse:
    """Response from a chat completion."""

    content: str
    model: str
    input_tokens: int
    output_tokens: int
    stop_reason: str
    tool_calls: list[dict[str, Any]] = field(default_factory=list)


@dataclass
class ModelInfo:
    """Information about an available model."""

    id: str
    name: str
    provider: str
    context_window: int
    max_output_tokens: int
    input_price_per_million: float
    output_price_per_million: float
    is_local: bool = False
    capabilities: list[str] = field(default_factory=list)


class BaseProvider(ABC):
    """Abstract base class for LLM providers."""

    @abstractmethod
    async def list_models(self) -> list[ModelInfo]:
        """List available models from this provider."""
        pass

    @abstractmethod
    async def chat(
        self,
        model: str,
        messages: list[ChatMessage],
        **kwargs: Any,
    ) -> ChatResponse:
        """Send a chat completion request."""
        pass

    @abstractmethod
    async def chat_stream(
        self,
        model: str,
        messages: list[ChatMessage],
        **kwargs: Any,
    ) -> AsyncGenerator[str, None]:
        """Stream a chat completion response."""
        yield ""  # Required for async generator typing

    @abstractmethod
    async def completion(
        self,
        model: str,
        prompt: str,
        **kwargs: Any,
    ) -> ChatResponse:
        """Send a text completion request."""
        pass

    @abstractmethod
    async def completion_stream(
        self,
        model: str,
        prompt: str,
        **kwargs: Any,
    ) -> AsyncGenerator[str, None]:
        """Stream a text completion response."""
        yield ""  # Required for async generator typing

    @abstractmethod
    async def is_available(self) -> bool:
        """Check if the provider is available."""
        pass

    @abstractmethod
    async def close(self) -> None:
        """Clean up resources."""
        pass
