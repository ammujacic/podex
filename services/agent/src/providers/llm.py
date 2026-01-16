"""Unified LLM provider interface supporting multiple providers."""

import json
from collections.abc import AsyncGenerator
from dataclasses import dataclass, field
from typing import Any, Literal

import aioboto3
import structlog
from anthropic import AsyncAnthropic
from openai import AsyncOpenAI

from podex_shared import TokenUsageParams, get_usage_tracker
from src.config import settings

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


@dataclass
class UsageTrackingContext:
    """Context for tracking token usage."""

    user_id: str
    model: str
    usage: dict[str, int] = field(default_factory=dict)
    session_id: str | None = None
    workspace_id: str | None = None
    agent_id: str | None = None


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
        self._boto_session: aioboto3.Session | None = None

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
    def boto_session(self) -> aioboto3.Session:
        """Get or create aioboto3 session."""
        if self._boto_session is None:
            self._boto_session = aioboto3.Session(
                aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
                aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
                region_name=settings.AWS_REGION,
            )
        return self._boto_session

    def _get_anthropic_client(self, api_key: str | None = None) -> AsyncAnthropic:
        """Get Anthropic client, optionally with user-provided API key.

        Args:
            api_key: Optional user-provided API key. If None, uses platform default.

        Returns:
            Anthropic client instance
        """
        if api_key:
            # Create a new client with user's API key
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

    async def complete(self, request: CompletionRequest) -> dict[str, Any]:
        """
        Generate a completion using the configured LLM provider.

        Args:
            request: CompletionRequest containing model, messages, tools, and tracking context.

        Returns:
            Response dictionary with content and metadata
        """
        if self.provider == "anthropic":
            result = await self._complete_anthropic(
                model=request.model,
                messages=request.messages,
                tools=request.tools,
                max_tokens=request.max_tokens,
                temperature=request.temperature,
            )
        elif self.provider == "openai":
            result = await self._complete_openai(
                model=request.model,
                messages=request.messages,
                tools=request.tools,
                max_tokens=request.max_tokens,
                temperature=request.temperature,
            )
        elif self.provider == "bedrock":
            result = await self._complete_bedrock(
                model=request.model,
                messages=request.messages,
                tools=request.tools,
                max_tokens=request.max_tokens,
                temperature=request.temperature,
            )
        elif self.provider == "ollama":
            result = await self._complete_ollama(
                model=request.model,
                messages=request.messages,
                tools=request.tools,
                max_tokens=request.max_tokens,
                temperature=request.temperature,
            )
        else:
            raise ValueError(f"Unknown provider: {self.provider}")

        # Track usage if user context is provided
        if request.user_id and result.get("usage"):
            tracking_context = UsageTrackingContext(
                user_id=request.user_id,
                model=request.model,
                usage=result["usage"],
                session_id=request.session_id,
                workspace_id=request.workspace_id,
                agent_id=request.agent_id,
            )
            await self._track_usage(tracking_context)

        return result

    async def complete_stream(
        self, request: CompletionRequest
    ) -> AsyncGenerator[StreamEvent, None]:
        """
        Stream a completion from the configured LLM provider.

        Yields StreamEvent objects as tokens are generated.

        Args:
            request: CompletionRequest containing model, messages, tools, and tracking context.

        Yields:
            StreamEvent objects for tokens, tool calls, and completion.
        """
        try:
            if self.provider == "anthropic":
                async for event in self._stream_anthropic(
                    model=request.model,
                    messages=request.messages,
                    tools=request.tools,
                    max_tokens=request.max_tokens,
                    temperature=request.temperature,
                ):
                    yield event
            elif self.provider == "openai":
                async for event in self._stream_openai(
                    model=request.model,
                    messages=request.messages,
                    tools=request.tools,
                    max_tokens=request.max_tokens,
                    temperature=request.temperature,
                ):
                    yield event
            elif self.provider == "bedrock":
                async for event in self._stream_bedrock(
                    model=request.model,
                    messages=request.messages,
                    tools=request.tools,
                    max_tokens=request.max_tokens,
                    temperature=request.temperature,
                ):
                    yield event
            elif self.provider == "ollama":
                async for event in self._stream_ollama(
                    model=request.model,
                    messages=request.messages,
                    tools=request.tools,
                    max_tokens=request.max_tokens,
                    temperature=request.temperature,
                ):
                    yield event
            else:
                yield StreamEvent(type="error", error=f"Unknown provider: {self.provider}")
                return
        except Exception as e:
            logger.exception("Streaming error", provider=self.provider)
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
    ) -> dict[str, Any]:
        """Complete using Anthropic API."""
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
            "model": model,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "messages": conversation_messages,
        }

        if system_message:
            request_params["system"] = system_message

        if tools:
            request_params["tools"] = tools

        # Make API call
        response = await self.anthropic_client.messages.create(**request_params)

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
    ) -> dict[str, Any]:
        """Complete using OpenAI API."""
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
        response = await self.openai_client.chat.completions.create(**request_params)

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

    def _get_bedrock_model_info(self, model: str) -> tuple[str, str]:
        """Get Bedrock model ID and family from model name.

        Returns:
            Tuple of (bedrock_model_id, model_family)
        """
        # Map model names to Bedrock model IDs and their family
        model_mapping = {
            # Anthropic Claude models
            "claude-sonnet-4-20250514": ("anthropic.claude-3-5-sonnet-20241022-v2:0", "anthropic"),
            "claude-opus-4-5-20251101": ("anthropic.claude-3-5-sonnet-20241022-v2:0", "anthropic"),
            "claude-3-5-sonnet-20241022": (
                "anthropic.claude-3-5-sonnet-20241022-v2:0",
                "anthropic",
            ),
            "claude-3-sonnet": ("anthropic.claude-3-sonnet-20240229-v1:0", "anthropic"),
            "claude-3-haiku": ("anthropic.claude-3-haiku-20240307-v1:0", "anthropic"),
            # Meta Llama models
            "llama-3-1-70b": ("meta.llama3-1-70b-instruct-v1:0", "llama"),
            "llama-3-1-8b": ("meta.llama3-1-8b-instruct-v1:0", "llama"),
            "llama-3-2-90b": ("meta.llama3-2-90b-instruct-v1:0", "llama"),
            "llama-3-2-11b": ("meta.llama3-2-11b-instruct-v1:0", "llama"),
            # Amazon Titan models
            "titan-text-premier": ("amazon.titan-text-premier-v1:0", "titan"),
            "titan-text-express": ("amazon.titan-text-express-v1", "titan"),
            "titan-text-lite": ("amazon.titan-text-lite-v1", "titan"),
            # Cohere models
            "cohere-command-r-plus": ("cohere.command-r-plus-v1:0", "cohere"),
            "cohere-command-r": ("cohere.command-r-v1:0", "cohere"),
            # Mistral models
            "mistral-large": ("mistral.mistral-large-2407-v1:0", "mistral"),
            "mistral-small": ("mistral.mistral-small-2402-v1:0", "mistral"),
        }

        # Check if model is already a bedrock model ID
        if model.startswith(("anthropic.", "meta.", "amazon.", "cohere.", "mistral.")):
            # Determine family from prefix
            if model.startswith("anthropic."):
                return model, "anthropic"
            elif model.startswith("meta."):
                return model, "llama"
            elif model.startswith("amazon."):
                return model, "titan"
            elif model.startswith("cohere."):
                return model, "cohere"
            elif model.startswith("mistral."):
                return model, "mistral"

        return model_mapping.get(model, ("anthropic.claude-3-5-sonnet-20241022-v2:0", "anthropic"))

    def _build_bedrock_request(
        self,
        model_family: str,
        messages: list[dict[str, str]],
        tools: list[dict[str, Any]] | None,
        max_tokens: int,
        temperature: float,
    ) -> dict[str, Any]:
        """Build request body for different Bedrock model families."""
        # Extract system message
        system_message = ""
        conversation_messages = []

        for msg in messages:
            if msg["role"] == "system":
                system_message = msg["content"]
            else:
                conversation_messages.append(msg)

        if model_family == "anthropic":
            # Anthropic Claude format
            formatted_messages = [
                {
                    "role": msg["role"],
                    "content": [{"type": "text", "text": msg["content"]}],
                }
                for msg in conversation_messages
            ]

            request_body: dict[str, Any] = {
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": max_tokens,
                "temperature": temperature,
                "messages": formatted_messages,
            }

            if system_message:
                request_body["system"] = system_message

            if tools:
                request_body["tools"] = tools

        elif model_family == "llama":
            # Meta Llama format (uses messages API)
            llama_messages: list[dict[str, str]] = []
            if system_message:
                llama_messages.append({"role": "system", "content": system_message})
            llama_messages.extend(conversation_messages)

            request_body = {
                "prompt": self._format_llama_prompt(llama_messages),
                "max_gen_len": max_tokens,
                "temperature": temperature,
            }

        elif model_family == "titan":
            # Amazon Titan format
            prompt = self._format_titan_prompt(system_message, conversation_messages)

            request_body = {
                "inputText": prompt,
                "textGenerationConfig": {
                    "maxTokenCount": max_tokens,
                    "temperature": temperature,
                    "topP": 0.9,
                },
            }

        elif model_family == "cohere":
            # Cohere Command format
            request_body = {
                "message": conversation_messages[-1]["content"] if conversation_messages else "",
                "chat_history": [
                    {"role": "USER" if m["role"] == "user" else "CHATBOT", "message": m["content"]}
                    for m in conversation_messages[:-1]
                ],
                "preamble": system_message if system_message else None,
                "max_tokens": max_tokens,
                "temperature": temperature,
            }

            # Convert tools to Cohere format
            if tools:
                request_body["tools"] = [
                    {
                        "name": tool["name"],
                        "description": tool["description"],
                        "parameter_definitions": {
                            param_name: {
                                "description": param_info.get("description", ""),
                                "type": param_info.get("type", "string"),
                                "required": param_name in tool["input_schema"].get("required", []),
                            }
                            for param_name, param_info in tool["input_schema"]
                            .get("properties", {})
                            .items()
                        },
                    }
                    for tool in tools
                ]

        elif model_family == "mistral":
            # Mistral format (OpenAI compatible)
            mistral_messages: list[dict[str, str]] = []
            if system_message:
                mistral_messages.append({"role": "system", "content": system_message})
            mistral_messages.extend(conversation_messages)

            request_body = {
                "messages": mistral_messages,
                "max_tokens": max_tokens,
                "temperature": temperature,
            }

            # Convert tools to Mistral format
            if tools:
                request_body["tools"] = [
                    {
                        "type": "function",
                        "function": {
                            "name": tool["name"],
                            "description": tool["description"],
                            "parameters": tool["input_schema"],
                        },
                    }
                    for tool in tools
                ]

        else:
            # Default to Anthropic format
            request_body = {
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": max_tokens,
                "temperature": temperature,
                "messages": conversation_messages,
            }

        return request_body

    def _format_llama_prompt(self, messages: list[dict[str, str]]) -> str:
        """Format messages into Llama prompt format."""
        prompt_parts = []
        for msg in messages:
            role = msg["role"]
            content = msg["content"]
            if role == "system":
                prompt_parts.append(
                    f"<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n\n{content}<|eot_id|>"
                )
            elif role == "user":
                prompt_parts.append(
                    f"<|start_header_id|>user<|end_header_id|>\n\n{content}<|eot_id|>"
                )
            elif role == "assistant":
                prompt_parts.append(
                    f"<|start_header_id|>assistant<|end_header_id|>\n\n{content}<|eot_id|>"
                )

        # Add final assistant prompt
        prompt_parts.append("<|start_header_id|>assistant<|end_header_id|>\n\n")
        return "".join(prompt_parts)

    def _format_titan_prompt(self, system_message: str, messages: list[dict[str, str]]) -> str:
        """Format messages into Amazon Titan prompt format."""
        prompt_parts = []
        if system_message:
            prompt_parts.append(f"System: {system_message}\n\n")

        for msg in messages:
            role = "User" if msg["role"] == "user" else "Assistant"
            prompt_parts.append(f"{role}: {msg['content']}\n\n")

        prompt_parts.append("Assistant: ")
        return "".join(prompt_parts)

    def _parse_bedrock_response(
        self, response_body: dict[str, Any], model_family: str
    ) -> dict[str, Any]:
        """Parse response from different Bedrock model families."""
        content = ""
        tool_calls = []
        usage: dict[str, int] = {}
        stop_reason = None

        if model_family == "anthropic":
            for block in response_body.get("content", []):
                if block.get("type") == "text":
                    content += block.get("text", "")
                elif block.get("type") == "tool_use":
                    tool_calls.append(
                        {
                            "id": block.get("id"),
                            "name": block.get("name"),
                            "arguments": block.get("input", {}),
                        }
                    )

            usage = response_body.get("usage", {})
            stop_reason = response_body.get("stop_reason")

        elif model_family == "llama":
            content = response_body.get("generation", "")
            stop_reason = response_body.get("stop_reason", "end_turn")
            # Llama doesn't provide token counts in response
            usage = {
                "input_tokens": response_body.get("prompt_token_count", 0),
                "output_tokens": response_body.get("generation_token_count", 0),
            }

        elif model_family == "titan":
            results = response_body.get("results", [{}])
            if results:
                content = results[0].get("outputText", "")
                stop_reason = results[0].get("completionReason", "end_turn")
            usage = {
                "input_tokens": response_body.get("inputTextTokenCount", 0),
                "output_tokens": sum(r.get("tokenCount", 0) for r in results),
            }

        elif model_family == "cohere":
            content = response_body.get("text", "")
            stop_reason = response_body.get("finish_reason", "COMPLETE")

            # Handle Cohere tool calls
            if response_body.get("tool_calls"):
                for tc in response_body["tool_calls"]:
                    tool_calls.append(
                        {
                            "id": tc.get("id", f"call_{len(tool_calls)}"),
                            "name": tc.get("name"),
                            "arguments": tc.get("parameters", {}),
                        }
                    )

            # Cohere provides token counts in meta
            meta = response_body.get("meta", {})
            billed_units = meta.get("billed_units", {})
            usage = {
                "input_tokens": billed_units.get("input_tokens", 0),
                "output_tokens": billed_units.get("output_tokens", 0),
            }

        elif model_family == "mistral":
            choices = response_body.get("choices", [{}])
            if choices:
                message = choices[0].get("message", {})
                content = message.get("content", "")
                stop_reason = choices[0].get("finish_reason", "stop")

                # Handle Mistral tool calls
                if message.get("tool_calls"):
                    for tc in message["tool_calls"]:
                        tool_calls.append(
                            {
                                "id": tc.get("id", f"call_{len(tool_calls)}"),
                                "name": tc.get("function", {}).get("name"),
                                "arguments": json.loads(
                                    tc.get("function", {}).get("arguments", "{}")
                                ),
                            }
                        )

            usage = response_body.get("usage", {})
            usage = {
                "input_tokens": usage.get("prompt_tokens", 0),
                "output_tokens": usage.get("completion_tokens", 0),
            }

        return {
            "content": content,
            "tool_calls": tool_calls,
            "usage": {
                "input_tokens": usage.get("input_tokens", 0),
                "output_tokens": usage.get("output_tokens", 0),
                "total_tokens": usage.get("input_tokens", 0) + usage.get("output_tokens", 0),
            },
            "stop_reason": stop_reason,
        }

    async def _complete_bedrock(
        self,
        model: str,
        messages: list[dict[str, str]],
        tools: list[dict[str, Any]] | None = None,
        max_tokens: int = 4096,
        temperature: float = 0.7,
    ) -> dict[str, Any]:
        """Complete using AWS Bedrock with multiple model families.

        Supports:
        - Anthropic Claude (claude-3-5-sonnet, claude-3-haiku, etc.)
        - Meta Llama (llama-3-1-70b, llama-3-1-8b, etc.)
        - Amazon Titan (titan-text-premier, etc.)
        - Cohere Command (cohere-command-r-plus, etc.)
        - Mistral (mistral-large, mistral-small)
        """
        bedrock_model_id, model_family = self._get_bedrock_model_info(model)

        # Build request based on model family
        request_body = self._build_bedrock_request(
            model_family, messages, tools, max_tokens, temperature
        )

        logger.debug(
            "Bedrock request",
            model=bedrock_model_id,
            family=model_family,
        )

        async with self.boto_session.client(
            "bedrock-runtime",
            region_name=settings.AWS_REGION,
        ) as bedrock_client:
            response = await bedrock_client.invoke_model(
                modelId=bedrock_model_id,
                contentType="application/json",
                accept="application/json",
                body=json.dumps(request_body),
            )

            # Parse response
            response_body = json.loads(await response["body"].read())

        # Parse response based on model family
        return self._parse_bedrock_response(response_body, model_family)

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
    ) -> AsyncGenerator[StreamEvent, None]:
        """Stream completion using Anthropic API."""
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
            "model": model,
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

        async with self.anthropic_client.messages.stream(**request_params) as stream:
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
    ) -> AsyncGenerator[StreamEvent, None]:
        """Stream completion using OpenAI API."""
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

        stream = await self.openai_client.chat.completions.create(**request_params)

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

    async def _stream_bedrock(
        self,
        model: str,
        messages: list[dict[str, str]],
        tools: list[dict[str, Any]] | None = None,
        max_tokens: int = 4096,
        temperature: float = 0.7,
    ) -> AsyncGenerator[StreamEvent, None]:
        """Stream completion using AWS Bedrock with multiple model families.

        Supports streaming for:
        - Anthropic Claude (native streaming)
        - Meta Llama (streaming via invoke_model_with_response_stream)
        - Amazon Titan (streaming supported)
        - Cohere Command (limited streaming support)
        - Mistral (streaming supported)
        """
        bedrock_model_id, model_family = self._get_bedrock_model_info(model)

        # Build request based on model family
        request_body = self._build_bedrock_request(
            model_family, messages, tools, max_tokens, temperature
        )

        logger.debug(
            "Bedrock streaming request",
            model=bedrock_model_id,
            family=model_family,
        )

        # Track state
        current_tool_call: dict[str, Any] | None = None
        input_tokens = 0
        output_tokens = 0
        stop_reason = "end_turn"
        accumulated_content = ""

        async with self.boto_session.client(
            "bedrock-runtime",
            region_name=settings.AWS_REGION,
        ) as bedrock_client:
            response = await bedrock_client.invoke_model_with_response_stream(
                modelId=bedrock_model_id,
                contentType="application/json",
                accept="application/json",
                body=json.dumps(request_body),
            )

            async for event in response["body"]:
                chunk = json.loads(event["chunk"]["bytes"])

                if model_family == "anthropic":
                    # Anthropic Claude streaming format
                    event_type = chunk.get("type")

                    if event_type == "message_start":
                        usage = chunk.get("message", {}).get("usage", {})
                        input_tokens = usage.get("input_tokens", 0)

                    elif event_type == "content_block_start":
                        block = chunk.get("content_block", {})
                        if block.get("type") == "tool_use":
                            current_tool_call = {
                                "id": block.get("id"),
                                "name": block.get("name"),
                                "input_json": "",
                            }
                            yield StreamEvent(
                                type="tool_call_start",
                                tool_call_id=block.get("id"),
                                tool_name=block.get("name"),
                            )

                    elif event_type == "content_block_delta":
                        delta = chunk.get("delta", {})
                        if delta.get("type") == "text_delta":
                            text = delta.get("text", "")
                            accumulated_content += text
                            yield StreamEvent(type="token", content=text)
                        elif delta.get("type") == "input_json_delta" and current_tool_call:
                            current_tool_call["input_json"] += delta.get("partial_json", "")

                    elif event_type == "content_block_stop":
                        if current_tool_call:
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

                    elif event_type == "message_delta":
                        delta = chunk.get("delta", {})
                        stop_reason = delta.get("stop_reason", stop_reason)
                        usage = chunk.get("usage", {})
                        output_tokens = usage.get("output_tokens", output_tokens)

                    elif event_type == "message_stop":
                        yield StreamEvent(
                            type="done",
                            usage={
                                "input_tokens": input_tokens,
                                "output_tokens": output_tokens,
                                "total_tokens": input_tokens + output_tokens,
                            },
                            stop_reason=stop_reason,
                        )

                elif model_family == "llama":
                    # Meta Llama streaming format
                    if "generation" in chunk:
                        text = chunk.get("generation", "")
                        if text:
                            accumulated_content += text
                            yield StreamEvent(type="token", content=text)

                    if chunk.get("stop_reason"):
                        stop_reason = chunk.get("stop_reason", "end_turn")
                        input_tokens = chunk.get("prompt_token_count", 0)
                        output_tokens = chunk.get("generation_token_count", 0)

                        yield StreamEvent(
                            type="done",
                            usage={
                                "input_tokens": input_tokens,
                                "output_tokens": output_tokens,
                                "total_tokens": input_tokens + output_tokens,
                            },
                            stop_reason=stop_reason,
                        )

                elif model_family == "titan":
                    # Amazon Titan streaming format
                    if "outputText" in chunk:
                        text = chunk.get("outputText", "")
                        if text:
                            accumulated_content += text
                            yield StreamEvent(type="token", content=text)

                    if chunk.get("completionReason"):
                        stop_reason = chunk.get("completionReason", "FINISH")
                        input_tokens = chunk.get("inputTextTokenCount", 0)
                        output_tokens = chunk.get("totalOutputTextTokenCount", 0)

                        yield StreamEvent(
                            type="done",
                            usage={
                                "input_tokens": input_tokens,
                                "output_tokens": output_tokens,
                                "total_tokens": input_tokens + output_tokens,
                            },
                            stop_reason=stop_reason,
                        )

                elif model_family == "cohere":
                    # Cohere Command streaming format
                    event_type = chunk.get("event_type")

                    if event_type == "text-generation":
                        text = chunk.get("text", "")
                        if text:
                            accumulated_content += text
                            yield StreamEvent(type="token", content=text)

                    elif event_type == "tool-calls-generation":
                        # Handle tool calls for Cohere
                        for tc in chunk.get("tool_calls", []):
                            yield StreamEvent(
                                type="tool_call_start",
                                tool_call_id=tc.get("id", f"call_{len(accumulated_content)}"),
                                tool_name=tc.get("name"),
                            )
                            yield StreamEvent(
                                type="tool_call_end",
                                tool_call_id=tc.get("id", f"call_{len(accumulated_content)}"),
                                tool_name=tc.get("name"),
                                tool_input=tc.get("parameters", {}),
                            )

                    elif event_type == "stream-end":
                        response_meta = chunk.get("response", {}).get("meta", {})
                        billed_units = response_meta.get("billed_units", {})
                        input_tokens = billed_units.get("input_tokens", 0)
                        output_tokens = billed_units.get("output_tokens", 0)
                        stop_reason = chunk.get("finish_reason", "COMPLETE")

                        yield StreamEvent(
                            type="done",
                            usage={
                                "input_tokens": input_tokens,
                                "output_tokens": output_tokens,
                                "total_tokens": input_tokens + output_tokens,
                            },
                            stop_reason=stop_reason,
                        )

                elif model_family == "mistral":
                    # Mistral streaming format (OpenAI-compatible)
                    choices = chunk.get("choices", [])
                    if choices:
                        choice = choices[0]
                        delta = choice.get("delta", {})

                        if delta.get("content"):
                            text = delta.get("content", "")
                            accumulated_content += text
                            yield StreamEvent(type="token", content=text)

                        # Handle tool calls
                        if delta.get("tool_calls"):
                            for tc in delta["tool_calls"]:
                                if tc.get("function", {}).get("name"):
                                    yield StreamEvent(
                                        type="tool_call_start",
                                        tool_call_id=tc.get("id"),
                                        tool_name=tc["function"]["name"],
                                    )

                        if choice.get("finish_reason"):
                            stop_reason = choice.get("finish_reason", "stop")
                            usage = chunk.get("usage", {})
                            input_tokens = usage.get("prompt_tokens", 0)
                            output_tokens = usage.get("completion_tokens", 0)

                            yield StreamEvent(
                                type="done",
                                usage={
                                    "input_tokens": input_tokens,
                                    "output_tokens": output_tokens,
                                    "total_tokens": input_tokens + output_tokens,
                                },
                                stop_reason=stop_reason,
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
