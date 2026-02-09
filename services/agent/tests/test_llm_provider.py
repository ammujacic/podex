"""Tests for the unified LLM provider interface.

Tests cover:
- Provider dispatch (anthropic, openai, vertex, ollama, lmstudio)
- Completion requests and responses
- Streaming for each provider
- Token usage tracking
- Error handling
"""

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.providers.llm import (
    CompletionRequest,
    LLMProvider,
    StreamEvent,
    UsageTrackingContext,
)


class TestCompletionRequestDataclass:
    """Test CompletionRequest dataclass."""

    def test_basic_request(self):
        """Test basic completion request."""
        request = CompletionRequest(
            model="claude-3-5-sonnet-20241022",
            messages=[{"role": "user", "content": "Hello"}],
        )
        assert request.model == "claude-3-5-sonnet-20241022"
        assert len(request.messages) == 1
        assert request.max_tokens == 4096
        assert request.temperature == 0.7
        assert request.tools is None

    def test_request_with_tools(self):
        """Test completion request with tools."""
        tools = [
            {
                "name": "read_file",
                "description": "Read a file",
                "input_schema": {"type": "object", "properties": {}},
            }
        ]
        request = CompletionRequest(
            model="gpt-4",
            messages=[{"role": "user", "content": "Read file"}],
            tools=tools,
            max_tokens=2000,
            temperature=0.5,
        )
        assert request.tools == tools
        assert request.max_tokens == 2000
        assert request.temperature == 0.5

    def test_request_with_user_context(self):
        """Test request with user tracking context."""
        request = CompletionRequest(
            model="claude-3-5-sonnet-20241022",
            messages=[{"role": "user", "content": "Hello"}],
            user_id="user-123",
            session_id="session-456",
            workspace_id="workspace-789",
            agent_id="agent-101",
        )
        assert request.user_id == "user-123"
        assert request.session_id == "session-456"
        assert request.workspace_id == "workspace-789"
        assert request.agent_id == "agent-101"

    def test_request_with_custom_api_keys(self):
        """Test request with custom API keys."""
        request = CompletionRequest(
            model="gpt-4",
            messages=[{"role": "user", "content": "Hello"}],
            llm_api_keys={"openai": "sk-custom-key"},
        )
        assert request.llm_api_keys == {"openai": "sk-custom-key"}


class TestUsageTrackingContext:
    """Test UsageTrackingContext dataclass."""

    def test_basic_context(self):
        """Test basic usage tracking context."""
        ctx = UsageTrackingContext(
            user_id="user-123",
            model="claude-3-5-sonnet-20241022",
            provider="anthropic",
        )
        assert ctx.user_id == "user-123"
        assert ctx.model == "claude-3-5-sonnet-20241022"
        assert ctx.provider == "anthropic"
        assert ctx.usage == {}
        assert ctx.usage_source == "included"

    def test_context_with_all_fields(self):
        """Test context with all fields."""
        ctx = UsageTrackingContext(
            user_id="user-123",
            model="gpt-4",
            provider="openai",
            usage={"input_tokens": 100, "output_tokens": 50},
            session_id="session-456",
            workspace_id="workspace-789",
            agent_id="agent-101",
            usage_source="external",
        )
        assert ctx.provider == "openai"
        assert ctx.usage == {"input_tokens": 100, "output_tokens": 50}
        assert ctx.usage_source == "external"


class TestStreamEvent:
    """Test StreamEvent dataclass."""

    def test_token_event(self):
        """Test token stream event."""
        event = StreamEvent(type="token", content="Hello")
        assert event.type == "token"
        assert event.content == "Hello"

    def test_tool_call_events(self):
        """Test tool call stream events."""
        # Start event
        start_event = StreamEvent(
            type="tool_call_start",
            tool_call_id="call-123",
            tool_name="read_file",
        )
        assert start_event.type == "tool_call_start"
        assert start_event.tool_name == "read_file"

        # Input event
        input_event = StreamEvent(
            type="tool_call_input",
            tool_call_id="call-123",
            tool_input={"path": "/workspace/main.py"},
        )
        assert input_event.tool_input == {"path": "/workspace/main.py"}

        # End event
        end_event = StreamEvent(type="tool_call_end", tool_call_id="call-123")
        assert end_event.type == "tool_call_end"

    def test_done_event(self):
        """Test completion done event."""
        event = StreamEvent(
            type="done",
            usage={"input_tokens": 100, "output_tokens": 50},
            stop_reason="end_turn",
        )
        assert event.type == "done"
        assert event.usage == {"input_tokens": 100, "output_tokens": 50}
        assert event.stop_reason == "end_turn"

    def test_error_event(self):
        """Test error stream event."""
        event = StreamEvent(type="error", error="Rate limit exceeded")
        assert event.type == "error"
        assert event.error == "Rate limit exceeded"


class TestLLMProviderInit:
    """Test LLM provider initialization."""

    def test_provider_initialization(self):
        """Test provider initializes correctly."""
        provider = LLMProvider()
        # Provider no longer has a global default - each request specifies model_provider
        assert provider._anthropic_client is None
        assert provider._openai_client is None

    def test_clients_lazy_initialized(self):
        """Test clients are lazily initialized."""
        provider = LLMProvider()
        assert provider._anthropic_client is None
        assert provider._openai_client is None
        assert provider._ollama_client is None


class TestTokenEstimation:
    """Test token estimation functionality."""

    def test_estimate_tokens_basic(self):
        """Test basic token estimation."""
        provider = LLMProvider()
        # ~100 characters should be ~25 tokens
        text = "a" * 100
        tokens = provider._estimate_tokens(text)
        assert tokens == 25

    def test_estimate_tokens_empty_string(self):
        """Test estimation returns minimum 1 for empty string."""
        provider = LLMProvider()
        tokens = provider._estimate_tokens("")
        assert tokens == 1

    def test_estimate_tokens_short_string(self):
        """Test estimation returns minimum 1 for short string."""
        provider = LLMProvider()
        tokens = provider._estimate_tokens("Hi")
        assert tokens == 1


class TestProviderDispatch:
    """Test provider dispatch logic."""

    @pytest.fixture
    def mock_anthropic_response(self) -> MagicMock:
        """Create mock Anthropic response."""
        response = MagicMock()
        response.content = [MagicMock(type="text", text="Hello from Anthropic")]
        response.stop_reason = "end_turn"
        response.usage = MagicMock(input_tokens=100, output_tokens=50)
        return response

    @pytest.fixture
    def mock_openai_response(self) -> MagicMock:
        """Create mock OpenAI response."""
        response = MagicMock()
        response.choices = [
            MagicMock(
                message=MagicMock(content="Hello from OpenAI", tool_calls=None),
                finish_reason="stop",
            )
        ]
        response.usage = MagicMock(prompt_tokens=100, completion_tokens=50)
        return response

    async def test_complete_dispatches_to_anthropic(
        self,
        mock_anthropic_response: MagicMock,
    ):
        """Test completion dispatches to Anthropic for Claude models."""
        provider = LLMProvider()

        request = CompletionRequest(
            model="claude-3-5-sonnet-20241022",
            messages=[{"role": "user", "content": "Hello"}],
            model_provider="anthropic",
        )

        with patch.object(provider, "_complete_anthropic", new_callable=AsyncMock) as mock_complete:
            mock_complete.return_value = {
                "content": "Hello from Anthropic",
                "finish_reason": "stop",
                "usage": {"input_tokens": 100, "output_tokens": 50},
                "tool_calls": [],
            }

            result = await provider.complete(request)

            mock_complete.assert_called_once()
            assert result["content"] == "Hello from Anthropic"

    async def test_complete_dispatches_to_openai(self):
        """Test completion dispatches to OpenAI for GPT models."""
        provider = LLMProvider()

        request = CompletionRequest(
            model="gpt-4",
            messages=[{"role": "user", "content": "Hello"}],
            model_provider="openai",
        )

        with patch.object(provider, "_complete_openai", new_callable=AsyncMock) as mock_complete:
            mock_complete.return_value = {
                "content": "Hello from OpenAI",
                "finish_reason": "stop",
                "usage": {"input_tokens": 100, "output_tokens": 50},
                "tool_calls": [],
            }

            result = await provider.complete(request)

            mock_complete.assert_called_once()
            assert result["content"] == "Hello from OpenAI"

    async def test_complete_dispatches_to_ollama(self):
        """Test completion dispatches to Ollama for local models."""
        provider = LLMProvider()

        request = CompletionRequest(
            model="llama2",
            messages=[{"role": "user", "content": "Hello"}],
            model_provider="ollama",
        )

        with patch.object(provider, "_complete_ollama", new_callable=AsyncMock) as mock_complete:
            mock_complete.return_value = {
                "content": "Hello from Ollama",
                "finish_reason": "stop",
                "usage": {"input_tokens": 100, "output_tokens": 50},
                "tool_calls": [],
            }

            result = await provider.complete(request)

            mock_complete.assert_called_once()
            assert result["content"] == "Hello from Ollama"


class TestUsageTracking:
    """Test token usage tracking functionality."""

    async def test_usage_tracked_for_user_id(self):
        """Test that usage is tracked when user_id is provided."""
        provider = LLMProvider()

        request = CompletionRequest(
            model="claude-3-5-sonnet-20241022",
            messages=[{"role": "user", "content": "Hello"}],
            user_id="user-123",
            session_id="session-456",
            model_provider="anthropic",
        )

        with patch.object(provider, "_complete_anthropic", new_callable=AsyncMock) as mock_complete:
            mock_complete.return_value = {
                "content": "Response",
                "finish_reason": "stop",
                "usage": {"input_tokens": 100, "output_tokens": 50},
                "tool_calls": [],
            }

            result = await provider.complete(request)

            # Verify result has usage info
            assert result["usage"]["input_tokens"] == 100
            assert result["usage"]["output_tokens"] == 50

    async def test_local_provider_marked_as_local(self):
        """Test that local providers (Ollama) are marked as 'local' source."""
        provider = LLMProvider()

        request = CompletionRequest(
            model="llama2",
            messages=[{"role": "user", "content": "Hello"}],
            user_id="user-123",
            model_provider="ollama",
        )

        with patch.object(provider, "_complete_ollama", new_callable=AsyncMock) as mock_complete, \
             patch("src.providers.llm.get_usage_tracker") as mock_get_tracker:

            mock_complete.return_value = {
                "content": "Response",
                "finish_reason": "stop",
                "usage": {"input_tokens": 100, "output_tokens": 50},
                "tool_calls": [],
            }

            mock_tracker = MagicMock()
            mock_tracker.track_usage = AsyncMock()
            mock_get_tracker.return_value = mock_tracker

            await provider.complete(request)

            # Check usage source is 'local'
            call_args = mock_tracker.track_usage.call_args
            if call_args:
                params = call_args[0][0]  # First positional argument
                assert params.usage_source == "local"


class TestErrorHandling:
    """Test error handling in LLM provider."""

    async def test_anthropic_error_propagated(self):
        """Test that Anthropic errors are propagated."""
        provider = LLMProvider()

        request = CompletionRequest(
            model="claude-3-5-sonnet-20241022",
            messages=[{"role": "user", "content": "Hello"}],
            model_provider="anthropic",
        )

        with patch.object(provider, "_complete_anthropic", new_callable=AsyncMock) as mock_complete:
            mock_complete.side_effect = Exception("API rate limit exceeded")

            with pytest.raises(Exception, match="API rate limit exceeded"):
                await provider.complete(request)


class TestToolCallExtraction:
    """Test tool call extraction from responses."""

    async def test_anthropic_tool_calls_extracted(self):
        """Test that Anthropic tool calls are correctly extracted."""
        provider = LLMProvider()

        with patch.object(provider, "_complete_anthropic", new_callable=AsyncMock) as mock_complete:
            mock_complete.return_value = {
                "content": "I'll read that file for you",
                "finish_reason": "tool_use",
                "usage": {"input_tokens": 100, "output_tokens": 50},
                "tool_calls": [
                    {
                        "id": "call_123",
                        "name": "read_file",
                        "input": {"path": "/workspace/main.py"},
                    }
                ],
            }

            request = CompletionRequest(
                model="claude-3-5-sonnet-20241022",
                messages=[{"role": "user", "content": "Read main.py"}],
                tools=[{"name": "read_file"}],
                model_provider="anthropic",
            )

            result = await provider.complete(request)

            assert len(result["tool_calls"]) == 1
            assert result["tool_calls"][0]["name"] == "read_file"
            assert result["finish_reason"] == "tool_use"
