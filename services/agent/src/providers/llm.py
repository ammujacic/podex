"""Unified LLM provider interface supporting multiple providers."""

import json
from collections.abc import AsyncGenerator
from dataclasses import dataclass, field
from typing import Any, Literal

import structlog
from anthropic import AsyncAnthropic
from openai import AsyncOpenAI

from podex_shared import TokenUsageParams, get_usage_tracker
from src.config import settings
from src.providers.vertex import VertexAIProvider

logger = structlog.get_logger()


@dataclass
class CompletionRequest:
    """Request parameters for LLM completion."""

    model: str
    messages: list[dict[str, str]]
    tools: list[dict[str, Any]] | None = None
    max_tokens: int = 4096
    temperature: float = 0.7
    user_id: str | None = None
    session_id: str | None = None
    workspace_id: str | None = None
    agent_id: str | None = None
    # Optional user-provided API keys for external providers
    # Format: {"openai": "sk-...", "anthropic": "sk-ant-...", ...}
    llm_api_keys: dict[str, str] | None = None
    # Model's registered provider from the database (passed from API)
    # This takes precedence over guessing the provider from model name
    model_provider: str | None = None


@dataclass
class UsageTrackingContext:
    """Context for tracking token usage."""

    user_id: str
    model: str
    usage: dict[str, int] = field(default_factory=dict)
    session_id: str | None = None
    workspace_id: str | None = None
    agent_id: str | None = None
    # Usage source: "included" (Vertex/platform), "external" (user API key),
    # "local" (Ollama/LMStudio) - only "included" counts towards quota
    usage_source: str = "included"


@dataclass
class StreamEvent:
    """Event emitted during streaming completion."""

    type: Literal[
        "token",
        "thinking",
        "tool_call_start",
        "tool_call_input",
        "tool_call_end",
        "done",
        "error",
    ]
    content: str | None = None
    tool_call_id: str | None = None
    tool_name: str | None = None
    tool_input: dict[str, Any] | None = None
    usage: dict[str, int] | None = None
    stop_reason: str | None = None
    error: str | None = None


class LLMProvider:
    """Unified LLM interface supporting multiple providers."""

    def __init__(self) -> None:
        """Initialize LLM provider."""
        self.provider = settings.LLM_PROVIDER
        self._anthropic_client: AsyncAnthropic | None = None
        self._openai_client: AsyncOpenAI | None = None
        self._ollama_client: AsyncOpenAI | None = None
        self._vertex_provider: VertexAIProvider | None = None

    def _estimate_tokens(self, text: str) -> int:
        """Estimate token count from text length.

        Args:
            text: Text to estimate tokens for

        Returns:
            Estimated token count (roughly 1 token per 4 characters)
        """
        # Rough estimation: 1 token ~= 4 characters for English text
        return max(1, len(text) // 4)

    @property
    def anthropic_client(self) -> AsyncAnthropic:
        """Get or create Anthropic client."""
        if self._anthropic_client is None:
            self._anthropic_client = AsyncAnthropic(
                api_key=settings.ANTHROPIC_API_KEY,
            )
        return self._anthropic_client

    @property
    def openai_client(self) -> AsyncOpenAI:
        """Get or create OpenAI client."""
        if self._openai_client is None:
            self._openai_client = AsyncOpenAI(
                api_key=settings.OPENAI_API_KEY,
            )
        return self._openai_client

    @property
    def ollama_client(self) -> AsyncOpenAI:
        """Get or create Ollama client (using OpenAI-compatible API)."""
        if self._ollama_client is None:
            # Ollama uses OpenAI-compatible API at /v1 endpoint
            self._ollama_client = AsyncOpenAI(
                base_url=f"{settings.OLLAMA_URL}/v1",
                api_key="ollama",  # Ollama doesn't require a real API key
            )
        return self._ollama_client

    @property
    def vertex_provider(self) -> VertexAIProvider:
        """Get or create Vertex AI provider."""
        if self._vertex_provider is None:
            self._vertex_provider = VertexAIProvider()
        return self._vertex_provider

    def _get_anthropic_client(self, api_key: str | None = None) -> AsyncAnthropic:
        """Get Anthropic client, optionally with user-provided API key.

        Args:
            api_key: Optional user-provided API key (can be standard API key or OAuth token).
                     OAuth tokens start with "sk-ant-oat" and require special headers.

        Returns:
            Anthropic client instance
        """
        if api_key:
            # Check if this is an OAuth token (starts with sk-ant-oat)
            is_oauth_token = api_key.startswith("sk-ant-oat")
            if is_oauth_token:
                # OAuth tokens MUST use auth_token parameter, not api_key
                # Stealth mode: Mimic Claude Code's identity to authorize OAuth token usage
                # OAuth tokens are restricted to Claude Code and require specific headers
                return AsyncAnthropic(
                    api_key=None,  # Must be None for OAuth
                    auth_token=api_key,  # OAuth token goes here
                    default_headers={
                        "accept": "application/json",
                        "anthropic-dangerous-direct-browser-access": "true",
                        # Include Claude Code version and OAuth beta flags
                        "anthropic-beta": (
                            "claude-code-20250219,"
                            "oauth-2025-04-20,"
                            "fine-grained-tool-streaming-2025-05-14"
                        ),
                        # Identify as Claude Code CLI (required for OAuth tokens)
                        "user-agent": "claude-cli/2.1.2 (external, cli)",
                        "x-app": "cli",
                    },
                )
            # Standard API key
            return AsyncAnthropic(api_key=api_key)
        return self.anthropic_client

    def _get_openai_client(self, api_key: str | None = None) -> AsyncOpenAI:
        """Get OpenAI client, optionally with user-provided API key.

        Args:
            api_key: Optional user-provided API key. If None, uses platform default.

        Returns:
            OpenAI client instance
        """
        if api_key:
            # Create a new client with user's API key
            return AsyncOpenAI(api_key=api_key)
        return self.openai_client

    def _get_user_api_key(self, llm_api_keys: dict[str, str] | None, provider: str) -> str | None:
        """Get user API key for a specific provider.

        Args:
            llm_api_keys: Dictionary of user-provided API keys
            provider: Provider name (openai, anthropic, etc.)

        Returns:
            User's API key if available, None otherwise
        """
        if not llm_api_keys:
            return None
        return llm_api_keys.get(provider)

    def _resolve_anthropic_model_id(self, model: str) -> str:
        """Map short Anthropic model aliases to full API model IDs.

        Args:
            model: Model identifier (can be short alias like "opus" or full ID)

        Returns:
            Full Anthropic API model ID
        """
        model_lower = model.lower()

        # Map short aliases to current Anthropic API model IDs
        # Keep these in sync with the platform's canonical Claude 4.5 models.
        alias_map = {
            # Claude 4.5 Opus
            "opus": "claude-opus-4-5",
            # Claude 4.5 Sonnet
            "sonnet": "claude-sonnet-4-5",
            # Claude 4.5 Haiku (fast / low-cost)
            "haiku": "claude-haiku-4-5",
        }

        return alias_map.get(model_lower, model)

    def _get_provider_for_model(self, model: str) -> str:
        """Determine the native provider for a given model ID.

        Args:
            model: Model identifier (e.g., "claude-sonnet-4-5-20250929", "sonnet", "gpt-4o")

        Returns:
            Provider name: "anthropic", "openai", "google", or empty string for unknown
        """
        model_lower = model.lower()

        # Anthropic models - full names and short aliases
        if model_lower.startswith("claude"):
            return "anthropic"
        # Short aliases for Anthropic models (used in user-key models)
        if model_lower in ("sonnet", "haiku", "opus"):
            return "anthropic"

        # OpenAI models
        if model_lower.startswith(("gpt-", "o1-", "o3-", "chatgpt-")):
            return "openai"

        # Google models
        if model_lower.startswith("gemini"):
            return "google"

        # Unknown - will use default provider
        return ""

    def _resolve_provider(
        self,
        model: str,
        llm_api_keys: dict[str, str] | None,
        model_provider: str | None = None,
    ) -> tuple[str, str | None]:
        """Resolve which provider to use based on model and available API keys.

        Priority:
        1. Use model_provider from database if provided
        2. Fall back to guessing provider from model name
        3. If user has API key for the provider, use user's key
        4. Otherwise fall back to configured default provider

        Args:
            model: Model identifier
            llm_api_keys: User-provided API keys
            model_provider: Model's registered provider from database (takes precedence)

        Returns:
            Tuple of (provider_name, api_key_if_user_provided)
        """
        # Use database-provided provider first, then fall back to guessing from model name
        native_provider = model_provider or self._get_provider_for_model(model)

        # Debug: log what keys are available
        if llm_api_keys:
            logger.debug(
                "Available LLM API keys",
                providers=list(llm_api_keys.keys()),
                native_provider=native_provider,
                model=model,
            )

        # If user has an API key for the model's native provider, use it
        if native_provider and llm_api_keys:
            user_key = llm_api_keys.get(native_provider)
            if user_key:
                logger.info(
                    "Using user-provided API key for model",
                    model=model,
                    provider=native_provider,
                    from_database=bool(model_provider),
                    key_prefix=user_key[:15] + "..." if len(user_key) > 15 else user_key,
                )
                return native_provider, user_key
            else:
                logger.warning(
                    "Native provider not found in user's API keys",
                    native_provider=native_provider,
                    available_providers=list(llm_api_keys.keys()),
                    model=model,
                )

        # Fall back to default provider
        logger.debug(
            "Using default provider for model",
            model=model,
            native_provider=native_provider or "unknown",
            from_database=bool(model_provider),
            default_provider=self.provider,
            has_llm_keys=bool(llm_api_keys),
        )
        return self.provider, None

    def _determine_usage_source(self, provider: str, llm_api_keys: dict[str, str] | None) -> str:
        """Determine the usage source for billing purposes.

        Args:
            provider: The LLM provider being used
            llm_api_keys: User-provided API keys (if any)

        Returns:
            Usage source: "included", "external", or "local"
        """
        # Local providers (Ollama, LM Studio) - free, no quota impact
        if provider in ("ollama", "lmstudio"):
            return "local"

        # If user provided their own API key for this provider, it's external
        if llm_api_keys and provider in llm_api_keys:
            return "external"

        # Vertex AI is our platform provider - counts as included
        if provider == "vertex":
            return "included"

        # For anthropic/openai without user keys, check if we're using platform keys
        # If using platform API keys (not Vertex), this is external since user is
        # consuming their own quota on those providers
        # NOTE: In current architecture, only Vertex is "included" (platform-provided)
        # Direct anthropic/openai through platform keys is still "external"
        return "external"

    async def complete(self, request: CompletionRequest) -> dict[str, Any]:
        """
        Generate a completion using the appropriate LLM provider.

        Routes to the correct provider based on:
        1. The model being requested (e.g., claude-* → anthropic)
        2. Whether the user has provided an API key for that provider
        3. Falls back to the configured default provider if no user key

        Args:
            request: CompletionRequest containing model, messages, tools, and tracking context.

        Returns:
            Response dictionary with content and metadata
        """
        # Resolve which provider to use based on model, database provider, and user's API keys
        resolved_provider, user_key = self._resolve_provider(
            request.model, request.llm_api_keys, request.model_provider
        )

        if resolved_provider == "anthropic":
            result = await self._complete_anthropic(
                model=request.model,
                messages=request.messages,
                tools=request.tools,
                max_tokens=request.max_tokens,
                temperature=request.temperature,
                api_key=user_key,
            )
        elif resolved_provider == "openai":
            result = await self._complete_openai(
                model=request.model,
                messages=request.messages,
                tools=request.tools,
                max_tokens=request.max_tokens,
                temperature=request.temperature,
                api_key=user_key,
            )
        elif resolved_provider == "vertex":
            result = await self._complete_vertex(
                model=request.model,
                messages=request.messages,
                tools=request.tools,
                max_tokens=request.max_tokens,
                temperature=request.temperature,
            )
        elif resolved_provider == "ollama":
            result = await self._complete_ollama(
                model=request.model,
                messages=request.messages,
                tools=request.tools,
                max_tokens=request.max_tokens,
                temperature=request.temperature,
            )
        else:
            raise ValueError(f"Unknown provider: {resolved_provider}")

        # Track usage if user context is provided
        if request.user_id and result.get("usage"):
            # Determine usage source for billing
            usage_source = self._determine_usage_source(resolved_provider, request.llm_api_keys)

            tracking_context = UsageTrackingContext(
                user_id=request.user_id,
                model=request.model,
                usage=result["usage"],
                session_id=request.session_id,
                workspace_id=request.workspace_id,
                agent_id=request.agent_id,
                usage_source=usage_source,
            )
            await self._track_usage(tracking_context)

        return result

    async def complete_stream(
        self, request: CompletionRequest
    ) -> AsyncGenerator[StreamEvent, None]:
        """
        Stream a completion from the appropriate LLM provider.

        Routes to the correct provider based on:
        1. The model being requested (e.g., claude-* → anthropic)
        2. Whether the user has provided an API key for that provider
        3. Falls back to the configured default provider if no user key

        Yields StreamEvent objects as tokens are generated.

        Args:
            request: CompletionRequest containing model, messages, tools, and tracking context.

        Yields:
            StreamEvent objects for tokens, tool calls, and completion.
        """
        # Resolve which provider to use based on model, database provider, and user's API keys
        resolved_provider, user_key = self._resolve_provider(
            request.model, request.llm_api_keys, request.model_provider
        )

        try:
            if resolved_provider == "anthropic":
                async for event in self._stream_anthropic(
                    model=request.model,
                    messages=request.messages,
                    tools=request.tools,
                    max_tokens=request.max_tokens,
                    temperature=request.temperature,
                    api_key=user_key,
                ):
                    yield event
            elif resolved_provider == "openai":
                async for event in self._stream_openai(
                    model=request.model,
                    messages=request.messages,
                    tools=request.tools,
                    max_tokens=request.max_tokens,
                    temperature=request.temperature,
                    api_key=user_key,
                ):
                    yield event
            elif resolved_provider == "vertex":
                async for event in self._stream_vertex(
                    model=request.model,
                    messages=request.messages,
                    tools=request.tools,
                    max_tokens=request.max_tokens,
                    temperature=request.temperature,
                ):
                    yield event
            elif resolved_provider == "ollama":
                async for event in self._stream_ollama(
                    model=request.model,
                    messages=request.messages,
                    tools=request.tools,
                    max_tokens=request.max_tokens,
                    temperature=request.temperature,
                ):
                    yield event
            else:
                yield StreamEvent(type="error", error=f"Unknown provider: {resolved_provider}")
                return
        except Exception as e:
            logger.exception("Streaming error", provider=resolved_provider)
            yield StreamEvent(type="error", error=str(e))

    async def _track_usage(self, context: UsageTrackingContext) -> None:
        """Track token usage for billing.

        Args:
            context: UsageTrackingContext containing user, model, and usage data.
        """
        tracker = get_usage_tracker()
        if not tracker:
            logger.debug("Usage tracker not initialized, skipping usage recording")
            return

        try:
            params = TokenUsageParams(
                user_id=context.user_id,
                model=context.model,
                input_tokens=context.usage.get("input_tokens", 0),
                output_tokens=context.usage.get("output_tokens", 0),
                session_id=context.session_id,
                workspace_id=context.workspace_id,
                agent_id=context.agent_id,
                metadata={"provider": self.provider},
                usage_source=context.usage_source,
            )
            await tracker.record_token_usage(params)
        except Exception:
            # Don't fail the request if usage tracking fails
            logger.exception("Failed to track token usage")

    async def _complete_anthropic(
        self,
        model: str,
        messages: list[dict[str, str]],
        tools: list[dict[str, Any]] | None = None,
        max_tokens: int = 4096,
        temperature: float = 0.7,
        api_key: str | None = None,
    ) -> dict[str, Any]:
        """Complete using Anthropic API.

        Args:
            model: Model identifier
            messages: Conversation messages
            tools: Optional tool definitions
            max_tokens: Maximum tokens to generate
            temperature: Sampling temperature
            api_key: Optional user API key (standard or OAuth token)
        """
        # Get appropriate client (with user key or platform default)
        client = self._get_anthropic_client(api_key)

        # Resolve short model aliases to full API model IDs (e.g., "opus" -> "claude-opus-4-5")
        resolved_model = self._resolve_anthropic_model_id(model)

        # Extract system message
        system_message = ""
        conversation_messages = []

        for msg in messages:
            if msg["role"] == "system":
                system_message = msg["content"]
            else:
                conversation_messages.append(msg)

        # Build request
        request_params: dict[str, Any] = {
            "model": resolved_model,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "messages": conversation_messages,
        }

        if system_message:
            request_params["system"] = system_message

        if tools:
            request_params["tools"] = tools

        # Make API call
        response = await client.messages.create(**request_params)

        # Extract content
        content = ""
        tool_calls = []

        for block in response.content:
            if block.type == "text":
                content += block.text
            elif block.type == "tool_use":
                tool_calls.append(
                    {
                        "id": block.id,
                        "name": block.name,
                        "arguments": block.input,
                    },
                )

        return {
            "content": content,
            "tool_calls": tool_calls,
            "usage": {
                "input_tokens": response.usage.input_tokens,
                "output_tokens": response.usage.output_tokens,
                "total_tokens": response.usage.input_tokens + response.usage.output_tokens,
            },
            "stop_reason": response.stop_reason,
        }

    async def _complete_openai(
        self,
        model: str,
        messages: list[dict[str, str]],
        tools: list[dict[str, Any]] | None = None,
        max_tokens: int = 4096,
        temperature: float = 0.7,
        api_key: str | None = None,
    ) -> dict[str, Any]:
        """Complete using OpenAI API.

        Args:
            model: Model identifier
            messages: Conversation messages
            tools: Optional tool definitions
            max_tokens: Maximum tokens to generate
            temperature: Sampling temperature
            api_key: Optional user API key
        """
        # Get appropriate client (with user key or platform default)
        client = self._get_openai_client(api_key)

        # Convert Anthropic-style tools to OpenAI format
        openai_tools = None
        if tools:
            openai_tools = []
            for tool in tools:
                openai_tools.append(
                    {
                        "type": "function",
                        "function": {
                            "name": tool["name"],
                            "description": tool["description"],
                            "parameters": tool["input_schema"],
                        },
                    },
                )

        # Map model names if needed (Anthropic -> OpenAI equivalent)
        model_mapping = {
            "claude-sonnet-4-20250514": "gpt-4o",
            "claude-opus-4-5-20251101": "gpt-4o",
            "claude-3-5-sonnet-20241022": "gpt-4o",
        }
        openai_model = model_mapping.get(model, model)

        # Build request parameters
        request_params: dict[str, Any] = {
            "model": openai_model,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
        }

        if openai_tools:
            request_params["tools"] = openai_tools
            request_params["tool_choice"] = "auto"

        # Make API call
        response = await client.chat.completions.create(**request_params)

        # Extract content and tool calls
        content = ""
        tool_calls = []

        choice = response.choices[0]
        message = choice.message

        if message.content:
            content = message.content

        if message.tool_calls:
            for tc in message.tool_calls:
                tool_calls.append(
                    {
                        "id": tc.id,
                        "name": tc.function.name,
                        "arguments": json.loads(tc.function.arguments),
                    },
                )

        return {
            "content": content,
            "tool_calls": tool_calls,
            "usage": {
                "input_tokens": response.usage.prompt_tokens if response.usage else 0,
                "output_tokens": response.usage.completion_tokens if response.usage else 0,
                "total_tokens": response.usage.total_tokens if response.usage else 0,
            },
            "stop_reason": choice.finish_reason,
        }

    async def _complete_vertex(
        self,
        model: str,
        messages: list[dict[str, str]],
        tools: list[dict[str, Any]] | None = None,
        max_tokens: int = 4096,
        temperature: float = 0.7,
    ) -> dict[str, Any]:
        """Complete using Google Cloud Vertex AI (Claude models via Anthropic partnership)."""
        return await self.vertex_provider.complete(
            model=model,
            messages=messages,
            tools=tools,
            max_tokens=max_tokens,
            temperature=temperature,
        )

    async def _complete_ollama(
        self,
        model: str,  # noqa: ARG002
        messages: list[dict[str, str]],
        tools: list[dict[str, Any]] | None = None,
        max_tokens: int = 4096,
        temperature: float = 0.7,
    ) -> dict[str, Any]:
        """Complete using Ollama (local LLM with OpenAI-compatible API)."""
        # Use the configured Ollama model, ignore the passed model parameter
        # since local models have different names
        ollama_model = settings.OLLAMA_MODEL

        # Convert Anthropic-style tools to OpenAI format if provided
        openai_tools = None
        if tools:
            openai_tools = []
            for tool in tools:
                openai_tools.append(
                    {
                        "type": "function",
                        "function": {
                            "name": tool["name"],
                            "description": tool["description"],
                            "parameters": tool["input_schema"],
                        },
                    },
                )

        # Build request parameters
        request_params: dict[str, Any] = {
            "model": ollama_model,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
        }

        if openai_tools:
            request_params["tools"] = openai_tools
            request_params["tool_choice"] = "auto"

        # Make API call
        response = await self.ollama_client.chat.completions.create(**request_params)

        # Extract content and tool calls
        content = ""
        tool_calls = []

        choice = response.choices[0]
        message = choice.message

        if message.content:
            content = message.content

        if message.tool_calls:
            for tc in message.tool_calls:
                tool_calls.append(
                    {
                        "id": tc.id,
                        "name": tc.function.name,
                        "arguments": json.loads(tc.function.arguments),
                    },
                )

        # Get usage stats or estimate if not provided
        input_tokens = response.usage.prompt_tokens if response.usage else 0
        output_tokens = response.usage.completion_tokens if response.usage else 0
        total_tokens = response.usage.total_tokens if response.usage else 0

        # Fallback: estimate tokens if Ollama didn't provide usage stats
        if total_tokens == 0:
            # Estimate input tokens from messages
            total_message_text = " ".join(msg.get("content", "") for msg in messages)
            input_tokens = self._estimate_tokens(total_message_text)
            # Estimate output tokens from content
            output_tokens = self._estimate_tokens(content)
            total_tokens = input_tokens + output_tokens
            logger.warning(
                "Ollama didn't provide usage stats, using estimation",
                estimated_input=input_tokens,
                estimated_output=output_tokens,
            )

        return {
            "content": content,
            "tool_calls": tool_calls,
            "usage": {
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "total_tokens": total_tokens,
            },
            "stop_reason": choice.finish_reason,
        }

    # ==================== Streaming Implementations ====================

    async def _stream_anthropic(
        self,
        model: str,
        messages: list[dict[str, str]],
        tools: list[dict[str, Any]] | None = None,
        max_tokens: int = 4096,
        temperature: float = 0.7,
        api_key: str | None = None,
    ) -> AsyncGenerator[StreamEvent, None]:
        """Stream completion using Anthropic API.

        Args:
            model: Model identifier
            messages: Conversation messages
            tools: Optional tool definitions
            max_tokens: Maximum tokens to generate
            temperature: Sampling temperature
            api_key: Optional user API key (standard or OAuth token)
        """
        # Get appropriate client (with user key or platform default)
        client = self._get_anthropic_client(api_key)

        # Resolve short model aliases to full API model IDs (e.g., "opus" -> "claude-opus-4-5")
        resolved_model = self._resolve_anthropic_model_id(model)

        # Extract system message
        system_message = ""
        conversation_messages = []

        for msg in messages:
            if msg["role"] == "system":
                system_message = msg["content"]
            else:
                conversation_messages.append(msg)

        # Build request
        request_params: dict[str, Any] = {
            "model": resolved_model,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "messages": conversation_messages,
        }

        if system_message:
            request_params["system"] = system_message

        if tools:
            request_params["tools"] = tools

        # Track tool calls being built
        current_tool_call: dict[str, Any] | None = None
        input_tokens = 0
        output_tokens = 0
        stop_reason = "end_turn"

        async with client.messages.stream(**request_params) as stream:
            async for event in stream:
                if event.type == "message_start":
                    # Capture input token count
                    if hasattr(event, "message") and hasattr(event.message, "usage"):
                        input_tokens = event.message.usage.input_tokens

                elif event.type == "content_block_start":
                    block = event.content_block
                    if block.type == "tool_use":
                        # Starting a new tool call
                        current_tool_call = {
                            "id": block.id,
                            "name": block.name,
                            "input_json": "",
                        }
                        yield StreamEvent(
                            type="tool_call_start",
                            tool_call_id=block.id,
                            tool_name=block.name,
                        )
                    elif block.type == "thinking":
                        # Starting a thinking block
                        pass
                    elif block.type == "text":
                        pass

                elif event.type == "content_block_delta":
                    delta = event.delta
                    if delta.type == "text_delta":
                        yield StreamEvent(type="token", content=delta.text)
                    elif delta.type == "thinking_delta":
                        # Stream thinking tokens
                        yield StreamEvent(type="thinking", content=delta.thinking)
                    elif delta.type == "input_json_delta" and current_tool_call:
                        # Accumulate tool input JSON
                        current_tool_call["input_json"] += delta.partial_json

                elif event.type == "content_block_stop":
                    if current_tool_call:
                        # Parse accumulated JSON and emit tool call end
                        try:
                            tool_input = json.loads(current_tool_call["input_json"])
                        except json.JSONDecodeError:
                            tool_input = {}
                        yield StreamEvent(
                            type="tool_call_end",
                            tool_call_id=current_tool_call["id"],
                            tool_name=current_tool_call["name"],
                            tool_input=tool_input,
                        )
                        current_tool_call = None

                elif event.type == "message_delta":
                    # Capture output token count and stop reason
                    if hasattr(event, "usage"):
                        output_tokens = event.usage.output_tokens
                    stop_reason = getattr(event.delta, "stop_reason", None) or stop_reason

                elif event.type == "message_stop":
                    yield StreamEvent(
                        type="done",
                        usage={
                            "input_tokens": input_tokens,
                            "output_tokens": output_tokens,
                            "total_tokens": input_tokens + output_tokens,
                        },
                        stop_reason=stop_reason,
                    )

    async def _stream_openai(
        self,
        model: str,
        messages: list[dict[str, str]],
        tools: list[dict[str, Any]] | None = None,
        max_tokens: int = 4096,
        temperature: float = 0.7,
        api_key: str | None = None,
    ) -> AsyncGenerator[StreamEvent, None]:
        """Stream completion using OpenAI API.

        Args:
            model: Model identifier
            messages: Conversation messages
            tools: Optional tool definitions
            max_tokens: Maximum tokens to generate
            temperature: Sampling temperature
            api_key: Optional user API key
        """
        # Get appropriate client (with user key or platform default)
        client = self._get_openai_client(api_key)

        # Convert Anthropic-style tools to OpenAI format
        openai_tools = None
        if tools:
            openai_tools = []
            for tool in tools:
                openai_tools.append(
                    {
                        "type": "function",
                        "function": {
                            "name": tool["name"],
                            "description": tool["description"],
                            "parameters": tool["input_schema"],
                        },
                    },
                )

        # Map model names if needed
        model_mapping = {
            "claude-sonnet-4-20250514": "gpt-4o",
            "claude-opus-4-5-20251101": "gpt-4o",
            "claude-3-5-sonnet-20241022": "gpt-4o",
        }
        openai_model = model_mapping.get(model, model)

        # Build request parameters
        request_params: dict[str, Any] = {
            "model": openai_model,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "stream": True,
            "stream_options": {"include_usage": True},
        }

        if openai_tools:
            request_params["tools"] = openai_tools
            request_params["tool_choice"] = "auto"

        # Track tool calls being built
        tool_calls_building: dict[int, dict[str, Any]] = {}
        usage_data: dict[str, int] = {}
        finish_reason: str | None = None

        stream = await client.chat.completions.create(**request_params)

        async for chunk in stream:
            if not chunk.choices and chunk.usage:
                # Final chunk with usage
                usage_data = {
                    "input_tokens": chunk.usage.prompt_tokens,
                    "output_tokens": chunk.usage.completion_tokens,
                    "total_tokens": chunk.usage.total_tokens,
                }
                continue

            if not chunk.choices:
                continue

            choice = chunk.choices[0]
            delta = choice.delta

            if choice.finish_reason:
                finish_reason = choice.finish_reason

            # Handle text content
            if delta.content:
                yield StreamEvent(type="token", content=delta.content)

            # Handle tool calls
            if delta.tool_calls:
                for tc in delta.tool_calls:
                    idx = tc.index
                    if idx not in tool_calls_building:
                        # New tool call starting
                        tool_calls_building[idx] = {
                            "id": tc.id or "",
                            "name": tc.function.name if tc.function else "",
                            "arguments": "",
                        }
                        if tc.function and tc.function.name:
                            yield StreamEvent(
                                type="tool_call_start",
                                tool_call_id=tc.id,
                                tool_name=tc.function.name,
                            )

                    # Accumulate arguments
                    if tc.function and tc.function.arguments:
                        tool_calls_building[idx]["arguments"] += tc.function.arguments

        # Emit tool call ends
        for tc_data in tool_calls_building.values():
            try:
                tool_input = json.loads(tc_data["arguments"]) if tc_data["arguments"] else {}
            except json.JSONDecodeError:
                tool_input = {}
            yield StreamEvent(
                type="tool_call_end",
                tool_call_id=tc_data["id"],
                tool_name=tc_data["name"],
                tool_input=tool_input,
            )

        yield StreamEvent(
            type="done",
            usage=usage_data,
            stop_reason=finish_reason or "stop",
        )

    async def _stream_vertex(
        self,
        model: str,
        messages: list[dict[str, str]],
        tools: list[dict[str, Any]] | None = None,
        max_tokens: int = 4096,
        temperature: float = 0.7,
    ) -> AsyncGenerator[StreamEvent, None]:
        """Stream completion using Google Cloud Vertex AI."""
        async for vertex_event in self.vertex_provider.stream(
            model=model,
            messages=messages,
            tools=tools,
            max_tokens=max_tokens,
            temperature=temperature,
        ):
            # Convert VertexStreamEvent to StreamEvent
            yield StreamEvent(
                type=vertex_event.type,  # type: ignore[arg-type]
                content=vertex_event.content,
                tool_call_id=vertex_event.tool_call_id,
                tool_name=vertex_event.tool_name,
                tool_input=vertex_event.tool_input,
                usage=vertex_event.usage,
                stop_reason=vertex_event.stop_reason,
                error=vertex_event.error,
            )

    async def _stream_ollama(
        self,
        model: str,  # noqa: ARG002
        messages: list[dict[str, str]],
        tools: list[dict[str, Any]] | None = None,
        max_tokens: int = 4096,
        temperature: float = 0.7,
    ) -> AsyncGenerator[StreamEvent, None]:
        """Stream completion using Ollama (OpenAI-compatible API)."""
        ollama_model = settings.OLLAMA_MODEL

        # Convert Anthropic-style tools to OpenAI format
        openai_tools = None
        if tools:
            openai_tools = []
            for tool in tools:
                openai_tools.append(
                    {
                        "type": "function",
                        "function": {
                            "name": tool["name"],
                            "description": tool["description"],
                            "parameters": tool["input_schema"],
                        },
                    },
                )

        # Build request parameters
        request_params: dict[str, Any] = {
            "model": ollama_model,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "stream": True,
            "stream_options": {"include_usage": True},  # Request usage stats
        }

        if openai_tools:
            request_params["tools"] = openai_tools
            request_params["tool_choice"] = "auto"

        # Track tool calls being built
        tool_calls_building: dict[int, dict[str, Any]] = {}
        finish_reason: str | None = None
        prompt_tokens = 0
        completion_tokens = 0
        accumulated_content = ""  # Track content for token estimation fallback

        stream = await self.ollama_client.chat.completions.create(**request_params)

        async for chunk in stream:
            if not chunk.choices:
                # Try to get usage from final chunk
                if chunk.usage:
                    prompt_tokens = chunk.usage.prompt_tokens or 0
                    completion_tokens = chunk.usage.completion_tokens or 0
                continue

            choice = chunk.choices[0]
            delta = choice.delta

            if choice.finish_reason:
                finish_reason = choice.finish_reason

            # Handle text content
            if delta.content:
                accumulated_content += delta.content
                yield StreamEvent(type="token", content=delta.content)

            # Handle tool calls
            if delta.tool_calls:
                for tc in delta.tool_calls:
                    idx = tc.index
                    if idx not in tool_calls_building:
                        tool_calls_building[idx] = {
                            "id": tc.id or "",
                            "name": tc.function.name if tc.function else "",
                            "arguments": "",
                        }
                        if tc.function and tc.function.name:
                            yield StreamEvent(
                                type="tool_call_start",
                                tool_call_id=tc.id,
                                tool_name=tc.function.name,
                            )

                    if tc.function and tc.function.arguments:
                        tool_calls_building[idx]["arguments"] += tc.function.arguments

        # Emit tool call ends
        for tc_data in tool_calls_building.values():
            try:
                tool_input = json.loads(tc_data["arguments"]) if tc_data["arguments"] else {}
            except json.JSONDecodeError:
                tool_input = {}
            yield StreamEvent(
                type="tool_call_end",
                tool_call_id=tc_data["id"],
                tool_name=tc_data["name"],
                tool_input=tool_input,
            )

        # Fallback: estimate tokens if Ollama didn't provide usage stats
        if prompt_tokens == 0 and completion_tokens == 0:
            # Estimate input tokens from messages
            total_message_text = " ".join(msg.get("content", "") for msg in messages)
            prompt_tokens = self._estimate_tokens(total_message_text)
            # Estimate output tokens from accumulated content
            completion_tokens = self._estimate_tokens(accumulated_content)
            logger.warning(
                "Ollama didn't provide usage stats, using estimation",
                estimated_input=prompt_tokens,
                estimated_output=completion_tokens,
            )

        yield StreamEvent(
            type="done",
            usage={
                "input_tokens": prompt_tokens,
                "output_tokens": completion_tokens,
                "total_tokens": prompt_tokens + completion_tokens,
            },
            stop_reason=finish_reason or "stop",
        )
