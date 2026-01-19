"""Vertex AI LLM provider for Google Cloud.

Supports multiple models available in Vertex AI Model Garden:
- Claude models (via Anthropic partnership)
- Gemini models (native Google)
- Llama models (via Model Garden)

Model configuration is admin-controlled via the database. This module uses
the ModelCapabilitiesCache from config.py to get model capabilities, falling
back to minimal defaults only when the API is unavailable.
"""

import json
from collections.abc import AsyncGenerator
from dataclasses import dataclass
from typing import Any

import structlog
from anthropic import NOT_GIVEN, AsyncAnthropicVertex

from src.config import settings, supports_thinking, supports_vision

logger = structlog.get_logger()


@dataclass
class VertexStreamEvent:
    """Event emitted during Vertex AI streaming completion."""

    type: str  # "token", "thinking", "tool_call_start", "tool_call_input",
    # "tool_call_end", "done", "error"
    content: str | None = None
    tool_call_id: str | None = None
    tool_name: str | None = None
    tool_input: dict[str, Any] | None = None
    usage: dict[str, int] | None = None
    stop_reason: str | None = None
    error: str | None = None


class VertexAIProvider:
    """Vertex AI LLM provider using Claude models via Anthropic partnership.

    Model capabilities (vision, thinking, etc.) are admin-controlled via the
    database and fetched from the API service. This provider uses the shared
    ModelCapabilitiesCache to determine model features.
    """

    def __init__(
        self,
        project_id: str | None = None,
        region: str | None = None,
    ):
        """Initialize Vertex AI provider.

        Args:
            project_id: GCP project ID (defaults to settings.GCP_PROJECT_ID)
            region: GCP region (defaults to settings.GCP_REGION)
        """
        self.project_id = project_id or settings.GCP_PROJECT_ID
        self.region = region or settings.GCP_REGION
        self._client: AsyncAnthropicVertex | None = None

    @property
    def client(self) -> AsyncAnthropicVertex:
        """Get or create async Anthropic Vertex client."""
        if self._client is None:
            self._client = AsyncAnthropicVertex(
                project_id=self.project_id if self.project_id else NOT_GIVEN,
                region=self.region if self.region else NOT_GIVEN,
            )
        return self._client

    def _get_model_id(self, model: str) -> str:
        """Map model name to Vertex AI model ID.

        Handles various model ID formats:
        - Direct Vertex AI model ID (e.g., "claude-sonnet-4-20250514")
        - Friendly names (resolved via admin-configured model list)

        Note: Model capabilities lookup is async and not available here.
        The model is used as-is, with capabilities checked at runtime.
        """

        # Return as-is if it looks like a Vertex model ID
        # Model capabilities are checked asynchronously in the actual API calls
        if model.startswith("claude-") or model.startswith("gemini-"):
            return model

        # Log warning for unknown models
        logger.warning(f"Unknown model format: {model}, using as-is")
        return model

    def model_supports_vision(self, model: str) -> bool:
        """Check if model supports vision/image input.

        Uses admin-controlled capabilities from the database.
        """
        model_id = self._get_model_id(model)
        return supports_vision(model_id)

    def model_supports_thinking(self, model: str) -> bool:
        """Check if model supports extended thinking.

        Uses admin-controlled capabilities from the database.
        """
        model_id = self._get_model_id(model)
        return supports_thinking(model_id)

    async def complete(
        self,
        model: str,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        max_tokens: int = 4096,
        temperature: float = 0.7,
        thinking_budget: int | None = None,
    ) -> dict[str, Any]:
        """Generate a completion using Vertex AI Claude models.

        Args:
            model: Model name or ID
            messages: Conversation messages
            tools: Tool definitions
            max_tokens: Maximum output tokens
            temperature: Sampling temperature
            thinking_budget: Optional thinking budget for extended thinking

        Returns:
            Response dict with content, tool_calls, usage, stop_reason
        """
        model_id = self._get_model_id(model)

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
            "model": model_id,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "messages": conversation_messages,
        }

        if system_message:
            request_params["system"] = system_message

        if tools:
            request_params["tools"] = tools

        # Add extended thinking if supported and requested
        if thinking_budget and self.model_supports_thinking(model_id):
            request_params["thinking"] = {
                "type": "enabled",
                "budget_tokens": thinking_budget,
            }
            # Extended thinking requires temperature = 1
            request_params["temperature"] = 1.0

        # Make API call
        response = await self.client.messages.create(**request_params)

        # Extract content
        content = ""
        tool_calls = []
        thinking_content = ""

        for block in response.content:
            if block.type == "text":
                content += block.text
            elif block.type == "thinking":
                thinking_content += block.thinking
            elif block.type == "tool_use":
                tool_calls.append(
                    {
                        "id": block.id,
                        "name": block.name,
                        "arguments": block.input,
                    }
                )

        result: dict[str, Any] = {
            "content": content,
            "tool_calls": tool_calls,
            "usage": {
                "input_tokens": response.usage.input_tokens,
                "output_tokens": response.usage.output_tokens,
                "total_tokens": response.usage.input_tokens + response.usage.output_tokens,
            },
            "stop_reason": response.stop_reason,
        }

        if thinking_content:
            result["thinking"] = thinking_content

        return result

    async def complete_stream(
        self,
        model: str,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        max_tokens: int = 4096,
        temperature: float = 0.7,
        thinking_budget: int | None = None,
    ) -> AsyncGenerator[VertexStreamEvent, None]:
        """Stream a completion from Vertex AI Claude models.

        Args:
            model: Model name or ID
            messages: Conversation messages
            tools: Tool definitions
            max_tokens: Maximum output tokens
            temperature: Sampling temperature
            thinking_budget: Optional thinking budget for extended thinking

        Yields:
            VertexStreamEvent objects for tokens, tool calls, and completion
        """
        model_id = self._get_model_id(model)

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
            "model": model_id,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "messages": conversation_messages,
        }

        if system_message:
            request_params["system"] = system_message

        if tools:
            request_params["tools"] = tools

        # Add extended thinking if supported and requested
        if thinking_budget and self.model_supports_thinking(model_id):
            request_params["thinking"] = {
                "type": "enabled",
                "budget_tokens": thinking_budget,
            }
            request_params["temperature"] = 1.0

        # Track state
        current_tool_call: dict[str, Any] | None = None
        input_tokens = 0
        output_tokens = 0
        stop_reason = "end_turn"

        try:
            async with self.client.messages.stream(**request_params) as stream:
                async for event in stream:
                    if event.type == "message_start":
                        if hasattr(event, "message") and hasattr(event.message, "usage"):
                            input_tokens = event.message.usage.input_tokens

                    elif event.type == "content_block_start":
                        block = event.content_block
                        if block.type == "tool_use":
                            current_tool_call = {
                                "id": block.id,
                                "name": block.name,
                                "input_json": "",
                            }
                            yield VertexStreamEvent(
                                type="tool_call_start",
                                tool_call_id=block.id,
                                tool_name=block.name,
                            )

                    elif event.type == "content_block_delta":
                        delta = event.delta
                        if delta.type == "text_delta":
                            yield VertexStreamEvent(type="token", content=delta.text)
                        elif delta.type == "thinking_delta":
                            yield VertexStreamEvent(type="thinking", content=delta.thinking)
                        elif delta.type == "input_json_delta" and current_tool_call:
                            current_tool_call["input_json"] += delta.partial_json

                    elif event.type == "content_block_stop":
                        if current_tool_call:
                            try:
                                tool_input = json.loads(current_tool_call["input_json"])
                            except json.JSONDecodeError:
                                tool_input = {}
                            yield VertexStreamEvent(
                                type="tool_call_end",
                                tool_call_id=current_tool_call["id"],
                                tool_name=current_tool_call["name"],
                                tool_input=tool_input,
                            )
                            current_tool_call = None

                    elif event.type == "message_delta":
                        if hasattr(event, "usage"):
                            output_tokens = event.usage.output_tokens
                        stop_reason = getattr(event.delta, "stop_reason", None) or stop_reason

                    elif event.type == "message_stop":
                        yield VertexStreamEvent(
                            type="done",
                            usage={
                                "input_tokens": input_tokens,
                                "output_tokens": output_tokens,
                                "total_tokens": input_tokens + output_tokens,
                            },
                            stop_reason=stop_reason,
                        )

        except Exception as e:
            logger.exception("Vertex AI streaming error")
            yield VertexStreamEvent(type="error", error=str(e))

    # Alias for complete_stream to match LLM provider interface
    stream = complete_stream


class MockVertexAIProvider(VertexAIProvider):
    """Mock Vertex AI provider for local development."""

    def __init__(self, **kwargs: Any):
        """Initialize mock provider."""
        self.project_id = kwargs.get("project_id", "mock-project")
        self.region = kwargs.get("region", "us-east1")
        self._client = None

    async def complete(
        self,
        model: str,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,  # noqa: ARG002
        max_tokens: int = 4096,  # noqa: ARG002
        temperature: float = 0.7,  # noqa: ARG002
        thinking_budget: int | None = None,  # noqa: ARG002
    ) -> dict[str, Any]:
        """Mock completion."""
        logger.info(f"[MOCK] Vertex AI completion with model {model}")

        # Estimate input tokens
        input_text = " ".join(
            msg.get("content", "") for msg in messages if isinstance(msg.get("content"), str)
        )
        input_tokens = len(input_text) // 4

        return {
            "content": "[Mock Vertex AI response - configure GCP credentials for actual responses]",
            "tool_calls": [],
            "usage": {
                "input_tokens": input_tokens,
                "output_tokens": 20,
                "total_tokens": input_tokens + 20,
            },
            "stop_reason": "end_turn",
        }

    async def complete_stream(
        self,
        model: str,
        messages: list[dict[str, Any]],  # noqa: ARG002
        tools: list[dict[str, Any]] | None = None,  # noqa: ARG002
        max_tokens: int = 4096,  # noqa: ARG002
        temperature: float = 0.7,  # noqa: ARG002
        thinking_budget: int | None = None,  # noqa: ARG002
    ) -> AsyncGenerator[VertexStreamEvent, None]:
        """Mock streaming completion."""
        logger.info(f"[MOCK] Vertex AI streaming with model {model}")

        mock_response = "[Mock Vertex AI streaming response]"
        for token in mock_response.split():
            yield VertexStreamEvent(type="token", content=token + " ")

        yield VertexStreamEvent(
            type="done",
            usage={
                "input_tokens": 100,
                "output_tokens": len(mock_response.split()),
                "total_tokens": 100 + len(mock_response.split()),
            },
            stop_reason="end_turn",
        )


def get_vertex_provider(
    project_id: str | None = None,
    region: str = "us-east1",
    use_mock: bool = False,
) -> VertexAIProvider:
    """Get a Vertex AI provider instance.

    Args:
        project_id: GCP project ID
        region: GCP region
        use_mock: Use mock provider for local development

    Returns:
        VertexAIProvider or MockVertexAIProvider
    """
    if use_mock or not project_id:
        return MockVertexAIProvider(project_id=project_id, region=region)
    return VertexAIProvider(project_id=project_id, region=region)
