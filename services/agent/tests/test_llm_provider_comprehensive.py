"""Comprehensive tests for LLM Provider.

Tests multi-provider support, streaming, and token tracking:
- Provider dispatch (anthropic, openai, vertex, ollama)
- Streaming for each provider
- Token usage tracking
- API key handling (user keys vs platform keys)
- Error handling
"""

from typing import Any, AsyncGenerator
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

    def test_basic_creation(self):
        """Test creating a basic completion request."""
        request = CompletionRequest(
            model="claude-3-5-sonnet-20241022",
            messages=[{"role": "user", "content": "Hello"}],
        )

        assert request.model == "claude-3-5-sonnet-20241022"
        assert len(request.messages) == 1
        assert request.tools is None
        assert request.max_tokens == 4096  # Default value

    def test_with_all_fields(self):
        """Test creating request with all fields."""
        request = CompletionRequest(
            model="claude-3-5-sonnet-20241022",
            messages=[{"role": "user", "content": "Hello"}],
            tools=[{"name": "test_tool"}],
            max_tokens=1000,
            temperature=0.7,
            user_id="user-123",
            session_id="session-456",
            workspace_id="workspace-789",
            agent_id="agent-abc",
            llm_api_keys={"anthropic": "key"},
        )

        assert request.tools == [{"name": "test_tool"}]
        assert request.max_tokens == 1000
        assert request.temperature == 0.7
        assert request.user_id == "user-123"
        assert request.session_id == "session-456"
        assert request.workspace_id == "workspace-789"
        assert request.llm_api_keys == {"anthropic": "key"}


class TestStreamEventDataclass:
    """Test StreamEvent dataclass."""

    def test_token_event(self):
        """Test creating token stream event."""
        event = StreamEvent(
            type="token",
            content="Hello",
        )

        assert event.type == "token"
        assert event.content == "Hello"
        assert event.tool_call_id is None
        assert event.usage is None

    def test_tool_call_start_event(self):
        """Test creating tool call start stream event."""
        event = StreamEvent(
            type="tool_call_start",
            tool_call_id="tc-1",
            tool_name="read_file",
        )

        assert event.type == "tool_call_start"
        assert event.tool_call_id == "tc-1"
        assert event.tool_name == "read_file"

    def test_tool_call_input_event(self):
        """Test creating tool call input stream event."""
        event = StreamEvent(
            type="tool_call_input",
            tool_call_id="tc-1",
            tool_input={"path": "/test.py"},
        )

        assert event.type == "tool_call_input"
        assert event.tool_input == {"path": "/test.py"}

    def test_thinking_event(self):
        """Test creating thinking stream event."""
        event = StreamEvent(
            type="thinking",
            content="Let me think...",
        )

        assert event.type == "thinking"
        assert event.content == "Let me think..."

    def test_done_event(self):
        """Test creating done stream event."""
        event = StreamEvent(
            type="done",
            usage={"input_tokens": 100, "output_tokens": 50},
            stop_reason="end_turn",
        )

        assert event.type == "done"
        assert event.usage["input_tokens"] == 100
        assert event.stop_reason == "end_turn"

    def test_error_event(self):
        """Test creating error stream event."""
        event = StreamEvent(
            type="error",
            error="API Error",
        )

        assert event.type == "error"
        assert event.error == "API Error"


class TestUsageTrackingContextDataclass:
    """Test UsageTrackingContext dataclass."""

    def test_basic_creation(self):
        """Test creating basic context."""
        context = UsageTrackingContext(
            user_id="user-123",
            model="claude-3-5-sonnet",
            provider="anthropic",
        )

        assert context.user_id == "user-123"
        assert context.model == "claude-3-5-sonnet"
        assert context.provider == "anthropic"
        assert context.usage == {}
        assert context.usage_source == "included"

    def test_with_optional_fields(self):
        """Test creating context with optional fields."""
        context = UsageTrackingContext(
            user_id="user-123",
            model="claude-3-5-sonnet",
            provider="openai",
            usage={"input_tokens": 100, "output_tokens": 50},
            session_id="session-456",
            workspace_id="workspace-789",
            agent_id="agent-abc",
            usage_source="external",
        )

        assert context.provider == "openai"
        assert context.session_id == "session-456"
        assert context.workspace_id == "workspace-789"
        assert context.agent_id == "agent-abc"
        assert context.usage_source == "external"
        assert context.usage["input_tokens"] == 100


class TestLLMProviderInitialization:
    """Test LLMProvider initialization."""

    def test_basic_initialization(self):
        """Test basic provider initialization."""
        provider = LLMProvider()

        assert provider._anthropic_client is None
        assert provider._openai_client is None
        assert provider._ollama_client is None

    def test_clients_not_initialized(self):
        """Test that clients are not initialized until accessed."""
        provider = LLMProvider()

        # No global provider - each request specifies model_provider
        assert provider._anthropic_client is None
        assert provider._openrouter_client is None


class TestLLMProviderClientCreation:
    """Test client creation and caching."""

    @pytest.fixture
    def provider(self) -> LLMProvider:
        """Create test provider."""
        return LLMProvider()

    def test_anthropic_client_created_on_demand(self, provider: LLMProvider):
        """Test that Anthropic client is created on demand."""
        assert provider._anthropic_client is None

        with patch("src.providers.llm.AsyncAnthropic") as mock_client, \
             patch("src.providers.llm.settings") as mock_settings:
            mock_settings.ANTHROPIC_API_KEY = "test-key"
            mock_client.return_value = MagicMock()
            _ = provider.anthropic_client

            mock_client.assert_called_once()

    def test_openai_client_created_on_demand(self, provider: LLMProvider):
        """Test that OpenAI client is created on demand."""
        assert provider._openai_client is None

        with patch("src.providers.llm.AsyncOpenAI") as mock_client, \
             patch("src.providers.llm.settings") as mock_settings:
            mock_settings.OPENAI_API_KEY = "test-key"
            mock_client.return_value = MagicMock()
            _ = provider.openai_client

            mock_client.assert_called_once()

    def test_ollama_client_created_on_demand(self, provider: LLMProvider):
        """Test that Ollama client is created on demand."""
        assert provider._ollama_client is None

        with patch("src.providers.llm.AsyncOpenAI") as mock_client, \
             patch("src.providers.llm.settings") as mock_settings:
            mock_settings.OLLAMA_URL = "http://localhost:11434"
            mock_client.return_value = MagicMock()
            _ = provider.ollama_client

            mock_client.assert_called_once_with(
                base_url="http://localhost:11434/v1",
                api_key="ollama",
            )

    def test_openrouter_client_created_on_demand(self, provider: LLMProvider):
        """Test that OpenRouter client is created on demand."""
        assert provider._openrouter_client is None

        with patch("src.providers.llm.AsyncOpenAI") as mock_client, \
             patch("src.providers.llm.settings") as mock_settings:
            mock_settings.OPENROUTER_API_KEY = "test-key"
            mock_client.return_value = MagicMock()
            _ = provider.openrouter_client

            mock_client.assert_called_once()

    def test_get_anthropic_client_with_custom_key(self, provider: LLMProvider):
        """Test getting Anthropic client with custom API key."""
        with patch("src.providers.llm.AsyncAnthropic") as mock_client:
            mock_client.return_value = MagicMock()

            client = provider._get_anthropic_client(api_key="custom-key")

            mock_client.assert_called_with(api_key="custom-key")

    def test_get_anthropic_client_without_custom_key(self, provider: LLMProvider):
        """Test getting Anthropic client without custom key uses default."""
        with patch("src.providers.llm.AsyncAnthropic") as mock_client, \
             patch("src.providers.llm.settings") as mock_settings:
            mock_settings.ANTHROPIC_API_KEY = "default-key"
            mock_client.return_value = MagicMock()

            # First access creates the default client
            _ = provider.anthropic_client

            # Now call without custom key should return same client
            client = provider._get_anthropic_client(api_key=None)

            # Should be the same client (cached)
            assert client == provider._anthropic_client

    def test_get_openai_client_with_custom_key(self, provider: LLMProvider):
        """Test getting OpenAI client with custom API key."""
        with patch("src.providers.llm.AsyncOpenAI") as mock_client:
            mock_client.return_value = MagicMock()

            client = provider._get_openai_client(api_key="custom-key")

            mock_client.assert_called_with(api_key="custom-key")


class TestLLMProviderTokenEstimation:
    """Test token estimation."""

    @pytest.fixture
    def provider(self) -> LLMProvider:
        """Create test provider."""
        return LLMProvider()

    def test_estimate_tokens_basic(self, provider: LLMProvider):
        """Test basic token estimation."""
        text = "Hello, world! This is a test message."

        tokens = provider._estimate_tokens(text)

        # Rough estimation: ~4 chars per token
        assert tokens > 0
        assert tokens < len(text)  # Should be less than character count
        # "Hello, world! This is a test message." = 38 chars / 4 = ~9 tokens
        assert 5 <= tokens <= 15

    def test_estimate_tokens_empty_string(self, provider: LLMProvider):
        """Test token estimation for empty string."""
        tokens = provider._estimate_tokens("")

        # Empty string should give minimum of 1 token
        assert tokens == 1

    def test_estimate_tokens_short_text(self, provider: LLMProvider):
        """Test token estimation for very short text."""
        tokens = provider._estimate_tokens("Hi")

        # Very short text should still give minimum of 1
        assert tokens >= 1

    def test_estimate_tokens_long_text(self, provider: LLMProvider):
        """Test token estimation for long text."""
        long_text = "This is a test. " * 100  # 1600 chars

        tokens = provider._estimate_tokens(long_text)

        # Should be roughly 400 tokens (1600 / 4)
        assert 300 <= tokens <= 500


class TestLLMProviderClientCaching:
    """Test that clients are properly cached."""

    def test_anthropic_client_cached(self):
        """Test that Anthropic client is cached after first access."""
        provider = LLMProvider()

        with patch("src.providers.llm.AsyncAnthropic") as mock_client, \
             patch("src.providers.llm.settings") as mock_settings:
            mock_settings.ANTHROPIC_API_KEY = "test-key"
            mock_instance = MagicMock()
            mock_client.return_value = mock_instance

            # First access
            client1 = provider.anthropic_client
            # Second access
            client2 = provider.anthropic_client

            # Should be same instance
            assert client1 is client2
            # Should only create once
            assert mock_client.call_count == 1

    def test_openai_client_cached(self):
        """Test that OpenAI client is cached after first access."""
        provider = LLMProvider()

        with patch("src.providers.llm.AsyncOpenAI") as mock_client, \
             patch("src.providers.llm.settings") as mock_settings:
            mock_settings.OPENAI_API_KEY = "test-key"
            mock_instance = MagicMock()
            mock_client.return_value = mock_instance

            # First access
            client1 = provider.openai_client
            # Second access
            client2 = provider.openai_client

            # Should be same instance
            assert client1 is client2
            # Should only create once
            assert mock_client.call_count == 1


class TestStreamEventTypes:
    """Test all StreamEvent types."""

    @pytest.mark.parametrize("event_type", [
        "token",
        "thinking",
        "tool_call_start",
        "tool_call_input",
        "tool_call_end",
        "done",
        "error",
    ])
    def test_valid_event_types(self, event_type: str):
        """Test that all valid event types can be created."""
        event = StreamEvent(type=event_type)
        assert event.type == event_type


class TestCompletionRequestDefaults:
    """Test CompletionRequest default values."""

    def test_default_max_tokens(self):
        """Test default max_tokens value."""
        request = CompletionRequest(
            model="test-model",
            messages=[{"role": "user", "content": "test"}],
        )
        assert request.max_tokens == 4096

    def test_default_temperature(self):
        """Test default temperature value."""
        request = CompletionRequest(
            model="test-model",
            messages=[{"role": "user", "content": "test"}],
        )
        assert request.temperature == 0.7

    def test_default_optional_fields(self):
        """Test default values for optional fields."""
        request = CompletionRequest(
            model="test-model",
            messages=[{"role": "user", "content": "test"}],
        )
        assert request.tools is None
        assert request.user_id is None
        assert request.session_id is None
        assert request.workspace_id is None
        assert request.agent_id is None
        assert request.llm_api_keys is None


class TestUsageTrackingContextDefaults:
    """Test UsageTrackingContext default values."""

    def test_default_usage(self):
        """Test default usage dict is empty."""
        context = UsageTrackingContext(
            user_id="test-user",
            model="test-model",
            provider="anthropic",
        )
        assert context.usage == {}

    def test_default_usage_source(self):
        """Test default usage_source is 'included'."""
        context = UsageTrackingContext(
            user_id="test-user",
            model="test-model",
            provider="anthropic",
        )
        assert context.usage_source == "included"

    def test_default_optional_fields(self):
        """Test default values for optional fields."""
        context = UsageTrackingContext(
            user_id="test-user",
            model="test-model",
            provider="anthropic",
        )
        assert context.session_id is None
        assert context.workspace_id is None
        assert context.agent_id is None


class TestStreamEventDefaults:
    """Test StreamEvent default values."""

    def test_default_optional_fields(self):
        """Test default values for optional fields."""
        event = StreamEvent(type="token")

        assert event.content is None
        assert event.tool_call_id is None
        assert event.tool_name is None
        assert event.tool_input is None
        assert event.usage is None
        assert event.stop_reason is None
        assert event.error is None


class TestGetUserApiKey:
    """Test _get_user_api_key method."""

    @pytest.fixture
    def provider(self) -> LLMProvider:
        """Create test provider."""
        return LLMProvider()

    def test_get_user_api_key_none_dict(self, provider: LLMProvider):
        """Test with None llm_api_keys."""
        result = provider._get_user_api_key(None, "openai")
        assert result is None

    def test_get_user_api_key_empty_dict(self, provider: LLMProvider):
        """Test with empty llm_api_keys."""
        result = provider._get_user_api_key({}, "openai")
        assert result is None

    def test_get_user_api_key_found(self, provider: LLMProvider):
        """Test when key exists for provider."""
        result = provider._get_user_api_key({"openai": "sk-test"}, "openai")
        assert result == "sk-test"

    def test_get_user_api_key_not_found(self, provider: LLMProvider):
        """Test when key doesn't exist for provider."""
        result = provider._get_user_api_key({"anthropic": "sk-ant"}, "openai")
        assert result is None


class TestDetermineUsageSource:
    """Test _determine_usage_source method."""

    @pytest.fixture
    def provider(self) -> LLMProvider:
        """Create test provider."""
        return LLMProvider()

    def test_ollama_is_local(self, provider: LLMProvider):
        """Test Ollama returns 'local' source."""
        result = provider._determine_usage_source("ollama", None)
        assert result == "local"

    def test_lmstudio_is_local(self, provider: LLMProvider):
        """Test LM Studio returns 'local' source."""
        result = provider._determine_usage_source("lmstudio", None)
        assert result == "local"

    def test_openrouter_is_included(self, provider: LLMProvider):
        """Test OpenRouter returns 'included' source (platform-provided)."""
        result = provider._determine_usage_source("openrouter", None)
        assert result == "included"

    def test_anthropic_with_user_key_is_external(self, provider: LLMProvider):
        """Test Anthropic with user key returns 'external' source."""
        result = provider._determine_usage_source("anthropic", {"anthropic": "sk-ant"})
        assert result == "external"

    def test_anthropic_without_user_key_is_external(self, provider: LLMProvider):
        """Test Anthropic without user key returns 'external' source."""
        result = provider._determine_usage_source("anthropic", None)
        assert result == "external"

    def test_openai_with_user_key_is_external(self, provider: LLMProvider):
        """Test OpenAI with user key returns 'external' source."""
        result = provider._determine_usage_source("openai", {"openai": "sk-test"})
        assert result == "external"


class TestCompleteMethod:
    """Test complete method dispatch."""

    @pytest.fixture
    def provider(self) -> LLMProvider:
        """Create test provider."""
        return LLMProvider()

    async def test_complete_missing_provider_raises(self, provider: LLMProvider):
        """Test that missing model_provider raises ValueError."""
        request = CompletionRequest(
            model="test",
            messages=[{"role": "user", "content": "hello"}],
        )

        with pytest.raises(ValueError, match="does not have a configured provider"):
            await provider.complete(request)

    async def test_complete_dispatches_to_openrouter(self, provider: LLMProvider):
        """Test completion dispatches to OpenRouter."""
        request = CompletionRequest(
            model="claude-3-5-sonnet",
            messages=[{"role": "user", "content": "hello"}],
            model_provider="openrouter",
        )

        with patch.object(provider, "_complete_openrouter", new_callable=AsyncMock) as mock:
            mock.return_value = {
                "content": "Hello from OpenRouter",
                "tool_calls": [],
                "usage": {"input_tokens": 10, "output_tokens": 5},
            }
            result = await provider.complete(request)
            mock.assert_called_once()
            assert result["content"] == "Hello from OpenRouter"

    async def test_complete_tracks_usage_with_user_id(self, provider: LLMProvider):
        """Test that usage is tracked when user_id provided."""
        request = CompletionRequest(
            model="claude-3-5-sonnet",
            messages=[{"role": "user", "content": "hello"}],
            user_id="user-123",
            model_provider="anthropic",
        )

        with patch.object(provider, "_complete_anthropic", new_callable=AsyncMock) as mock_complete, \
             patch.object(provider, "_track_usage", new_callable=AsyncMock) as mock_track:
            mock_complete.return_value = {
                "content": "Hello",
                "tool_calls": [],
                "usage": {"input_tokens": 10, "output_tokens": 5},
            }
            await provider.complete(request)
            mock_track.assert_called_once()


class TestCompleteAnthropicMethod:
    """Test _complete_anthropic method."""

    @pytest.fixture
    def provider(self) -> LLMProvider:
        """Create test provider."""
        return LLMProvider()

    @pytest.fixture
    def mock_anthropic_response(self) -> MagicMock:
        """Create mock Anthropic response."""
        response = MagicMock()
        response.content = [MagicMock(type="text", text="Hello from Claude")]
        response.usage = MagicMock(input_tokens=100, output_tokens=50)
        response.stop_reason = "end_turn"
        return response

    async def test_complete_anthropic_basic(self, provider: LLMProvider, mock_anthropic_response: MagicMock):
        """Test basic Anthropic completion."""
        mock_client = MagicMock()
        mock_client.messages.create = AsyncMock(return_value=mock_anthropic_response)
        provider._anthropic_client = mock_client

        result = await provider._complete_anthropic(
            model="claude-3-5-sonnet",
            messages=[{"role": "user", "content": "Hello"}],
        )

        assert result["content"] == "Hello from Claude"
        assert result["usage"]["input_tokens"] == 100
        assert result["usage"]["output_tokens"] == 50
        assert result["stop_reason"] == "end_turn"

    async def test_complete_anthropic_with_system_message(self, provider: LLMProvider, mock_anthropic_response: MagicMock):
        """Test Anthropic completion extracts system message."""
        mock_client = MagicMock()
        mock_client.messages.create = AsyncMock(return_value=mock_anthropic_response)
        provider._anthropic_client = mock_client

        await provider._complete_anthropic(
            model="claude-3-5-sonnet",
            messages=[
                {"role": "system", "content": "You are a helpful assistant"},
                {"role": "user", "content": "Hello"},
            ],
        )

        call_kwargs = mock_client.messages.create.call_args.kwargs
        assert call_kwargs["system"] == "You are a helpful assistant"
        assert len(call_kwargs["messages"]) == 1  # System message removed

    async def test_complete_anthropic_with_tools(self, provider: LLMProvider, mock_anthropic_response: MagicMock):
        """Test Anthropic completion with tools."""
        mock_client = MagicMock()
        mock_client.messages.create = AsyncMock(return_value=mock_anthropic_response)
        provider._anthropic_client = mock_client

        tools = [{"name": "read_file", "description": "Read a file", "input_schema": {}}]
        await provider._complete_anthropic(
            model="claude-3-5-sonnet",
            messages=[{"role": "user", "content": "Hello"}],
            tools=tools,
        )

        call_kwargs = mock_client.messages.create.call_args.kwargs
        assert call_kwargs["tools"] == tools

    async def test_complete_anthropic_with_tool_use_response(self, provider: LLMProvider):
        """Test Anthropic completion extracts tool calls."""
        # Create text block
        text_block = MagicMock()
        text_block.type = "text"
        text_block.text = "Let me read that file"

        # Create tool use block with actual values
        tool_block = MagicMock()
        tool_block.type = "tool_use"
        tool_block.id = "tc-1"
        tool_block.name = "read_file"
        tool_block.input = {"path": "/test.py"}

        response = MagicMock()
        response.content = [text_block, tool_block]
        response.usage = MagicMock(input_tokens=100, output_tokens=50)
        response.stop_reason = "tool_use"

        mock_client = MagicMock()
        mock_client.messages.create = AsyncMock(return_value=response)
        provider._anthropic_client = mock_client

        result = await provider._complete_anthropic(
            model="claude-3-5-sonnet",
            messages=[{"role": "user", "content": "Read test.py"}],
        )

        assert len(result["tool_calls"]) == 1
        assert result["tool_calls"][0]["id"] == "tc-1"
        assert result["tool_calls"][0]["name"] == "read_file"


class TestCompleteOpenAIMethod:
    """Test _complete_openai method."""

    @pytest.fixture
    def provider(self) -> LLMProvider:
        """Create test provider."""
        return LLMProvider()

    @pytest.fixture
    def mock_openai_response(self) -> MagicMock:
        """Create mock OpenAI response."""
        response = MagicMock()
        response.choices = [
            MagicMock(
                message=MagicMock(content="Hello from GPT", tool_calls=None),
                finish_reason="stop",
            )
        ]
        response.usage = MagicMock(prompt_tokens=100, completion_tokens=50, total_tokens=150)
        return response

    async def test_complete_openai_basic(self, provider: LLMProvider, mock_openai_response: MagicMock):
        """Test basic OpenAI completion."""
        mock_client = MagicMock()
        mock_client.chat.completions.create = AsyncMock(return_value=mock_openai_response)
        provider._openai_client = mock_client

        result = await provider._complete_openai(
            model="gpt-4",
            messages=[{"role": "user", "content": "Hello"}],
        )

        assert result["content"] == "Hello from GPT"
        assert result["usage"]["input_tokens"] == 100
        assert result["usage"]["output_tokens"] == 50

    async def test_complete_openai_model_mapping(self, provider: LLMProvider, mock_openai_response: MagicMock):
        """Test OpenAI completion maps Anthropic models to OpenAI."""
        mock_client = MagicMock()
        mock_client.chat.completions.create = AsyncMock(return_value=mock_openai_response)
        provider._openai_client = mock_client

        await provider._complete_openai(
            model="claude-3-5-sonnet-20241022",
            messages=[{"role": "user", "content": "Hello"}],
        )

        call_kwargs = mock_client.chat.completions.create.call_args.kwargs
        assert call_kwargs["model"] == "gpt-4o"

    async def test_complete_openai_with_tools(self, provider: LLMProvider, mock_openai_response: MagicMock):
        """Test OpenAI completion converts tools to OpenAI format."""
        mock_client = MagicMock()
        mock_client.chat.completions.create = AsyncMock(return_value=mock_openai_response)
        provider._openai_client = mock_client

        tools = [{"name": "read_file", "description": "Read a file", "input_schema": {"type": "object"}}]
        await provider._complete_openai(
            model="gpt-4",
            messages=[{"role": "user", "content": "Hello"}],
            tools=tools,
        )

        call_kwargs = mock_client.chat.completions.create.call_args.kwargs
        assert call_kwargs["tools"][0]["type"] == "function"
        assert call_kwargs["tools"][0]["function"]["name"] == "read_file"

    async def test_complete_openai_with_tool_calls(self, provider: LLMProvider):
        """Test OpenAI completion extracts tool calls."""
        import json

        response = MagicMock()
        tool_call = MagicMock()
        tool_call.id = "tc-1"
        tool_call.function.name = "read_file"
        tool_call.function.arguments = json.dumps({"path": "/test.py"})

        response.choices = [
            MagicMock(
                message=MagicMock(content="", tool_calls=[tool_call]),
                finish_reason="tool_calls",
            )
        ]
        response.usage = MagicMock(prompt_tokens=100, completion_tokens=50, total_tokens=150)

        mock_client = MagicMock()
        mock_client.chat.completions.create = AsyncMock(return_value=response)
        provider._openai_client = mock_client

        result = await provider._complete_openai(
            model="gpt-4",
            messages=[{"role": "user", "content": "Read test.py"}],
        )

        assert len(result["tool_calls"]) == 1
        assert result["tool_calls"][0]["name"] == "read_file"


class TestCompleteOpenRouterMethod:
    """Test _complete_openrouter method."""

    @pytest.fixture
    def provider(self) -> LLMProvider:
        """Create test provider."""
        return LLMProvider()

    @pytest.fixture
    def mock_openrouter_response(self) -> MagicMock:
        """Create mock OpenRouter response."""
        response = MagicMock()
        response.choices = [
            MagicMock(
                message=MagicMock(content="Hello from OpenRouter", tool_calls=None),
                finish_reason="stop",
            )
        ]
        response.usage = MagicMock(prompt_tokens=100, completion_tokens=50, total_tokens=150)
        return response

    async def test_complete_openrouter_basic(self, provider: LLMProvider, mock_openrouter_response: MagicMock):
        """Test basic OpenRouter completion."""
        mock_client = MagicMock()
        mock_client.chat.completions.create = AsyncMock(return_value=mock_openrouter_response)
        provider._openrouter_client = mock_client

        result = await provider._complete_openrouter(
            model="claude-sonnet-4.5",
            messages=[{"role": "user", "content": "Hello"}],
        )

        assert result["content"] == "Hello from OpenRouter"
        assert result["usage"]["input_tokens"] == 100


class TestCompleteOllamaMethod:
    """Test _complete_ollama method."""

    @pytest.fixture
    def provider(self) -> LLMProvider:
        """Create test provider."""
        return LLMProvider()

    @pytest.fixture
    def mock_ollama_response(self) -> MagicMock:
        """Create mock Ollama response."""
        response = MagicMock()
        response.choices = [
            MagicMock(
                message=MagicMock(content="Hello from Ollama", tool_calls=None),
                finish_reason="stop",
            )
        ]
        response.usage = MagicMock(prompt_tokens=100, completion_tokens=50, total_tokens=150)
        return response

    async def test_complete_ollama_basic(self, provider: LLMProvider, mock_ollama_response: MagicMock):
        """Test basic Ollama completion."""
        mock_client = MagicMock()
        mock_client.chat.completions.create = AsyncMock(return_value=mock_ollama_response)
        provider._ollama_client = mock_client

        with patch("src.providers.llm.settings") as mock_settings:
            mock_settings.OLLAMA_MODEL = "llama2"

            result = await provider._complete_ollama(
                model="claude-3-5-sonnet",  # Ignored, uses OLLAMA_MODEL
                messages=[{"role": "user", "content": "Hello"}],
            )

            assert result["content"] == "Hello from Ollama"
            call_kwargs = mock_client.chat.completions.create.call_args.kwargs
            assert call_kwargs["model"] == "llama2"

    async def test_complete_ollama_estimates_tokens_when_missing(self, provider: LLMProvider):
        """Test Ollama estimates tokens when not provided."""
        response = MagicMock()
        response.choices = [
            MagicMock(
                message=MagicMock(content="Hello from Ollama", tool_calls=None),
                finish_reason="stop",
            )
        ]
        response.usage = MagicMock(prompt_tokens=0, completion_tokens=0, total_tokens=0)

        mock_client = MagicMock()
        mock_client.chat.completions.create = AsyncMock(return_value=response)
        provider._ollama_client = mock_client

        with patch("src.providers.llm.settings") as mock_settings:
            mock_settings.OLLAMA_MODEL = "llama2"

            result = await provider._complete_ollama(
                model="llama2",
                messages=[{"role": "user", "content": "Hello world test message"}],
            )

            # Should have estimated tokens
            assert result["usage"]["input_tokens"] > 0
            assert result["usage"]["output_tokens"] > 0


class TestCompleteStreamMethod:
    """Test complete_stream method."""

    @pytest.fixture
    def provider(self) -> LLMProvider:
        """Create test provider."""
        return LLMProvider()

    async def test_complete_stream_missing_provider(self, provider: LLMProvider):
        """Test streaming with missing model_provider raises ValueError."""
        request = CompletionRequest(
            model="test",
            messages=[{"role": "user", "content": "hello"}],
        )

        with pytest.raises(ValueError, match="does not have a configured provider"):
            async for _ in provider.complete_stream(request):
                pass

    async def test_complete_stream_exception_yields_error(self, provider: LLMProvider):
        """Test streaming exception yields error event."""
        request = CompletionRequest(
            model="claude",
            messages=[{"role": "user", "content": "hello"}],
            model_provider="anthropic",
        )

        async def failing_stream(*args, **kwargs):
            raise Exception("API Error")
            yield  # Make it a generator

        with patch.object(provider, "_stream_anthropic", failing_stream):
            events = []
            async for event in provider.complete_stream(request):
                events.append(event)

            assert len(events) == 1
            assert events[0].type == "error"

    async def test_complete_stream_dispatches_to_anthropic(self, provider: LLMProvider):
        """Test streaming dispatches to Anthropic."""
        request = CompletionRequest(
            model="claude-3-5-sonnet",
            messages=[{"role": "user", "content": "hello"}],
            model_provider="anthropic",
        )

        async def mock_stream(*args, **kwargs):
            yield StreamEvent(type="token", content="Hello")
            yield StreamEvent(type="done", usage={"input_tokens": 10, "output_tokens": 5})

        with patch.object(provider, "_stream_anthropic", mock_stream):
            events = []
            async for event in provider.complete_stream(request):
                events.append(event)

            assert len(events) == 2
            assert events[0].content == "Hello"
            assert events[1].type == "done"

    async def test_complete_stream_dispatches_to_openai(self, provider: LLMProvider):
        """Test streaming dispatches to OpenAI."""
        request = CompletionRequest(
            model="gpt-4",
            messages=[{"role": "user", "content": "hello"}],
            model_provider="openai",
        )

        async def mock_stream(*args, **kwargs):
            yield StreamEvent(type="token", content="Hello")
            yield StreamEvent(type="done")

        with patch.object(provider, "_stream_openai", mock_stream):
            events = []
            async for event in provider.complete_stream(request):
                events.append(event)

            assert len(events) == 2

    async def test_complete_stream_dispatches_to_openrouter(self, provider: LLMProvider):
        """Test streaming dispatches to OpenRouter."""
        request = CompletionRequest(
            model="claude",
            messages=[{"role": "user", "content": "hello"}],
            model_provider="openrouter",
        )

        async def mock_stream(*args, **kwargs):
            yield StreamEvent(type="token", content="Hello")
            yield StreamEvent(type="done")

        with patch.object(provider, "_stream_openrouter", mock_stream):
            events = []
            async for event in provider.complete_stream(request):
                events.append(event)

            assert len(events) == 2

    async def test_complete_stream_dispatches_to_ollama(self, provider: LLMProvider):
        """Test streaming dispatches to Ollama."""
        request = CompletionRequest(
            model="llama2",
            messages=[{"role": "user", "content": "hello"}],
            model_provider="ollama",
        )

        async def mock_stream(*args, **kwargs):
            yield StreamEvent(type="token", content="Hello")
            yield StreamEvent(type="done")

        with patch.object(provider, "_stream_ollama", mock_stream):
            events = []
            async for event in provider.complete_stream(request):
                events.append(event)

            assert len(events) == 2


class TestTrackUsageMethod:
    """Test _track_usage method."""

    @pytest.fixture
    def provider(self) -> LLMProvider:
        """Create test provider."""
        return LLMProvider()

    async def test_track_usage_no_tracker(self, provider: LLMProvider):
        """Test tracking when tracker not available."""
        context = UsageTrackingContext(
            user_id="user-123",
            model="claude-3-5-sonnet",
            provider="anthropic",
            usage={"input_tokens": 10, "output_tokens": 5},
        )

        with patch("src.providers.llm.get_usage_tracker", return_value=None):
            # Should not raise
            await provider._track_usage(context)

    async def test_track_usage_calls_tracker(self, provider: LLMProvider):
        """Test tracking calls usage tracker."""
        context = UsageTrackingContext(
            user_id="user-123",
            model="claude-3-5-sonnet",
            provider="anthropic",
            usage={"input_tokens": 10, "output_tokens": 5},
            session_id="session-1",
        )

        mock_tracker = MagicMock()
        mock_tracker.record_token_usage = AsyncMock()

        with patch("src.providers.llm.get_usage_tracker", return_value=mock_tracker):
            await provider._track_usage(context)
            mock_tracker.record_token_usage.assert_called_once()

    async def test_track_usage_handles_exception(self, provider: LLMProvider):
        """Test tracking handles exceptions gracefully."""
        context = UsageTrackingContext(
            user_id="user-123",
            model="claude-3-5-sonnet",
            provider="anthropic",
            usage={"input_tokens": 10, "output_tokens": 5},
        )

        mock_tracker = MagicMock()
        mock_tracker.record_token_usage = AsyncMock(side_effect=Exception("DB Error"))

        with patch("src.providers.llm.get_usage_tracker", return_value=mock_tracker):
            # Should not raise
            await provider._track_usage(context)


class TestStreamAnthropicMethod:
    """Test _stream_anthropic method."""

    @pytest.fixture
    def provider(self) -> LLMProvider:
        """Create test provider."""
        return LLMProvider()

    @pytest.fixture
    def mock_stream_context(self):
        """Create mock stream context manager."""

        class MockStreamContext:
            def __init__(self, events):
                self.events = events

            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                pass

            def __aiter__(self):
                return self

            async def __anext__(self):
                if not self.events:
                    raise StopAsyncIteration
                return self.events.pop(0)

        return MockStreamContext

    async def test_stream_anthropic_basic_text(self, provider: LLMProvider, mock_stream_context):
        """Test basic text streaming from Anthropic."""
        events = [
            MagicMock(type="message_start", message=MagicMock(usage=MagicMock(input_tokens=10))),
            MagicMock(type="content_block_start", content_block=MagicMock(type="text")),
            MagicMock(type="content_block_delta", delta=MagicMock(type="text_delta", text="Hello")),
            MagicMock(type="content_block_delta", delta=MagicMock(type="text_delta", text=" world")),
            MagicMock(type="content_block_stop"),
            MagicMock(type="message_delta", usage=MagicMock(output_tokens=5), delta=MagicMock(stop_reason="end_turn")),
            MagicMock(type="message_stop"),
        ]

        mock_client = MagicMock()
        mock_client.messages.stream = MagicMock(return_value=mock_stream_context(events))
        provider._anthropic_client = mock_client

        results = []
        async for event in provider._stream_anthropic(
            model="claude-3-5-sonnet",
            messages=[{"role": "user", "content": "Hello"}],
        ):
            results.append(event)

        # Should have token events and done event
        token_events = [e for e in results if e.type == "token"]
        assert len(token_events) == 2
        assert token_events[0].content == "Hello"
        assert token_events[1].content == " world"

        done_events = [e for e in results if e.type == "done"]
        assert len(done_events) == 1
        assert done_events[0].usage["input_tokens"] == 10
        assert done_events[0].usage["output_tokens"] == 5

    async def test_stream_anthropic_with_system_message(self, provider: LLMProvider, mock_stream_context):
        """Test streaming extracts system message."""
        events = [
            MagicMock(type="message_start", message=MagicMock(usage=MagicMock(input_tokens=10))),
            MagicMock(type="message_stop"),
        ]

        mock_client = MagicMock()
        mock_client.messages.stream = MagicMock(return_value=mock_stream_context(events))
        provider._anthropic_client = mock_client

        results = []
        async for event in provider._stream_anthropic(
            model="claude-3-5-sonnet",
            messages=[
                {"role": "system", "content": "You are helpful"},
                {"role": "user", "content": "Hello"},
            ],
        ):
            results.append(event)

        # Check that system message was passed to API
        call_kwargs = mock_client.messages.stream.call_args.kwargs
        assert call_kwargs["system"] == "You are helpful"
        assert len(call_kwargs["messages"]) == 1  # System message extracted

    async def test_stream_anthropic_with_tool_call(self, provider: LLMProvider, mock_stream_context):
        """Test streaming with tool call."""
        # Create tool block with explicit attribute setting (name is special in MagicMock)
        tool_block = MagicMock(type="tool_use", id="tc-1")
        tool_block.name = "read_file"

        events = [
            MagicMock(type="message_start", message=MagicMock(usage=MagicMock(input_tokens=10))),
            MagicMock(type="content_block_start", content_block=tool_block),
            MagicMock(type="content_block_delta", delta=MagicMock(type="input_json_delta", partial_json='{"path":')),
            MagicMock(type="content_block_delta", delta=MagicMock(type="input_json_delta", partial_json='"/test.py"}')),
            MagicMock(type="content_block_stop"),
            MagicMock(type="message_delta", usage=MagicMock(output_tokens=5), delta=MagicMock(stop_reason="tool_use")),
            MagicMock(type="message_stop"),
        ]

        mock_client = MagicMock()
        mock_client.messages.stream = MagicMock(return_value=mock_stream_context(events))
        provider._anthropic_client = mock_client

        results = []
        async for event in provider._stream_anthropic(
            model="claude-3-5-sonnet",
            messages=[{"role": "user", "content": "Read the file"}],
        ):
            results.append(event)

        # Check tool call events
        tool_start = [e for e in results if e.type == "tool_call_start"]
        assert len(tool_start) == 1
        assert tool_start[0].tool_name == "read_file"
        assert tool_start[0].tool_call_id == "tc-1"

        tool_end = [e for e in results if e.type == "tool_call_end"]
        assert len(tool_end) == 1
        assert tool_end[0].tool_input == {"path": "/test.py"}

    async def test_stream_anthropic_with_thinking(self, provider: LLMProvider, mock_stream_context):
        """Test streaming with thinking block."""
        events = [
            MagicMock(type="message_start", message=MagicMock(usage=MagicMock(input_tokens=10))),
            MagicMock(type="content_block_start", content_block=MagicMock(type="thinking")),
            MagicMock(type="content_block_delta", delta=MagicMock(type="thinking_delta", thinking="Let me think...")),
            MagicMock(type="content_block_stop"),
            MagicMock(type="message_stop"),
        ]

        mock_client = MagicMock()
        mock_client.messages.stream = MagicMock(return_value=mock_stream_context(events))
        provider._anthropic_client = mock_client

        results = []
        async for event in provider._stream_anthropic(
            model="claude-3-5-sonnet",
            messages=[{"role": "user", "content": "Think"}],
        ):
            results.append(event)

        thinking_events = [e for e in results if e.type == "thinking"]
        assert len(thinking_events) == 1
        assert thinking_events[0].content == "Let me think..."

    async def test_stream_anthropic_invalid_tool_json(self, provider: LLMProvider, mock_stream_context):
        """Test streaming handles invalid tool JSON."""
        tool_block = MagicMock(type="tool_use", id="tc-1")
        tool_block.name = "read_file"

        events = [
            MagicMock(type="message_start", message=MagicMock(usage=MagicMock(input_tokens=10))),
            MagicMock(type="content_block_start", content_block=tool_block),
            MagicMock(type="content_block_delta", delta=MagicMock(type="input_json_delta", partial_json='invalid json')),
            MagicMock(type="content_block_stop"),
            MagicMock(type="message_stop"),
        ]

        mock_client = MagicMock()
        mock_client.messages.stream = MagicMock(return_value=mock_stream_context(events))
        provider._anthropic_client = mock_client

        results = []
        async for event in provider._stream_anthropic(
            model="claude-3-5-sonnet",
            messages=[{"role": "user", "content": "Read"}],
        ):
            results.append(event)

        tool_end = [e for e in results if e.type == "tool_call_end"]
        assert len(tool_end) == 1
        assert tool_end[0].tool_input == {}  # Invalid JSON returns empty dict


class TestStreamOpenAIMethod:
    """Test _stream_openai method."""

    @pytest.fixture
    def provider(self) -> LLMProvider:
        """Create test provider."""
        return LLMProvider()

    async def test_stream_openai_basic_text(self, provider: LLMProvider):
        """Test basic text streaming from OpenAI."""
        chunks = [
            MagicMock(choices=[MagicMock(delta=MagicMock(content="Hello", tool_calls=None), finish_reason=None)], usage=None),
            MagicMock(choices=[MagicMock(delta=MagicMock(content=" world", tool_calls=None), finish_reason=None)], usage=None),
            MagicMock(choices=[MagicMock(delta=MagicMock(content=None, tool_calls=None), finish_reason="stop")], usage=None),
            MagicMock(choices=[], usage=MagicMock(prompt_tokens=10, completion_tokens=5, total_tokens=15)),
        ]

        async def mock_stream():
            for chunk in chunks:
                yield chunk

        mock_client = MagicMock()
        mock_client.chat.completions.create = AsyncMock(return_value=mock_stream())
        provider._openai_client = mock_client

        results = []
        async for event in provider._stream_openai(
            model="gpt-4",
            messages=[{"role": "user", "content": "Hello"}],
        ):
            results.append(event)

        token_events = [e for e in results if e.type == "token"]
        assert len(token_events) == 2
        assert token_events[0].content == "Hello"
        assert token_events[1].content == " world"

        done_events = [e for e in results if e.type == "done"]
        assert len(done_events) == 1
        assert done_events[0].usage["input_tokens"] == 10

    async def test_stream_openai_model_mapping(self, provider: LLMProvider):
        """Test OpenAI streaming maps Anthropic models."""
        chunks = [
            MagicMock(choices=[MagicMock(delta=MagicMock(content="Hi", tool_calls=None), finish_reason="stop")], usage=None),
            MagicMock(choices=[], usage=MagicMock(prompt_tokens=5, completion_tokens=1, total_tokens=6)),
        ]

        async def mock_stream():
            for chunk in chunks:
                yield chunk

        mock_client = MagicMock()
        mock_client.chat.completions.create = AsyncMock(return_value=mock_stream())
        provider._openai_client = mock_client

        results = []
        async for event in provider._stream_openai(
            model="claude-3-5-sonnet-20241022",  # Should map to gpt-4o
            messages=[{"role": "user", "content": "Hi"}],
        ):
            results.append(event)

        call_kwargs = mock_client.chat.completions.create.call_args.kwargs
        assert call_kwargs["model"] == "gpt-4o"

    async def test_stream_openai_with_tool_calls(self, provider: LLMProvider):
        """Test OpenAI streaming with tool calls."""
        # Tool call function mock
        func1 = MagicMock()
        func1.name = "read_file"
        func1.arguments = '{"path":'

        func2 = MagicMock()
        func2.name = None
        func2.arguments = '"/test.py"}'

        tc1 = MagicMock()
        tc1.index = 0
        tc1.id = "tc-1"
        tc1.function = func1

        tc2 = MagicMock()
        tc2.index = 0
        tc2.id = None
        tc2.function = func2

        chunks = [
            MagicMock(choices=[MagicMock(delta=MagicMock(content=None, tool_calls=[tc1]), finish_reason=None)], usage=None),
            MagicMock(choices=[MagicMock(delta=MagicMock(content=None, tool_calls=[tc2]), finish_reason=None)], usage=None),
            MagicMock(choices=[MagicMock(delta=MagicMock(content=None, tool_calls=None), finish_reason="tool_calls")], usage=None),
            MagicMock(choices=[], usage=MagicMock(prompt_tokens=10, completion_tokens=5, total_tokens=15)),
        ]

        async def mock_stream():
            for chunk in chunks:
                yield chunk

        mock_client = MagicMock()
        mock_client.chat.completions.create = AsyncMock(return_value=mock_stream())
        provider._openai_client = mock_client

        results = []
        async for event in provider._stream_openai(
            model="gpt-4",
            messages=[{"role": "user", "content": "Read file"}],
        ):
            results.append(event)

        tool_start = [e for e in results if e.type == "tool_call_start"]
        assert len(tool_start) == 1
        assert tool_start[0].tool_name == "read_file"

        tool_end = [e for e in results if e.type == "tool_call_end"]
        assert len(tool_end) == 1
        assert tool_end[0].tool_input == {"path": "/test.py"}

    async def test_stream_openai_with_tools_param(self, provider: LLMProvider):
        """Test OpenAI streaming converts tool format."""
        chunks = [
            MagicMock(choices=[MagicMock(delta=MagicMock(content="Hi", tool_calls=None), finish_reason="stop")], usage=None),
            MagicMock(choices=[], usage=MagicMock(prompt_tokens=5, completion_tokens=1, total_tokens=6)),
        ]

        async def mock_stream():
            for chunk in chunks:
                yield chunk

        mock_client = MagicMock()
        mock_client.chat.completions.create = AsyncMock(return_value=mock_stream())
        provider._openai_client = mock_client

        tools = [{"name": "read_file", "description": "Read a file", "input_schema": {"type": "object"}}]

        results = []
        async for event in provider._stream_openai(
            model="gpt-4",
            messages=[{"role": "user", "content": "Hi"}],
            tools=tools,
        ):
            results.append(event)

        call_kwargs = mock_client.chat.completions.create.call_args.kwargs
        assert call_kwargs["tools"][0]["type"] == "function"
        assert call_kwargs["tools"][0]["function"]["name"] == "read_file"

    async def test_stream_openai_invalid_tool_json(self, provider: LLMProvider):
        """Test OpenAI streaming handles invalid tool JSON."""
        func = MagicMock()
        func.name = "read_file"
        func.arguments = "invalid json"

        tc = MagicMock()
        tc.index = 0
        tc.id = "tc-1"
        tc.function = func

        chunks = [
            MagicMock(choices=[MagicMock(delta=MagicMock(content=None, tool_calls=[tc]), finish_reason=None)], usage=None),
            MagicMock(choices=[MagicMock(delta=MagicMock(content=None, tool_calls=None), finish_reason="tool_calls")], usage=None),
            MagicMock(choices=[], usage=MagicMock(prompt_tokens=5, completion_tokens=1, total_tokens=6)),
        ]

        async def mock_stream():
            for chunk in chunks:
                yield chunk

        mock_client = MagicMock()
        mock_client.chat.completions.create = AsyncMock(return_value=mock_stream())
        provider._openai_client = mock_client

        results = []
        async for event in provider._stream_openai(
            model="gpt-4",
            messages=[{"role": "user", "content": "Read"}],
        ):
            results.append(event)

        tool_end = [e for e in results if e.type == "tool_call_end"]
        assert len(tool_end) == 1
        assert tool_end[0].tool_input == {}  # Invalid JSON returns empty dict


class TestStreamOpenRouterMethod:
    """Test _stream_openrouter method."""

    @pytest.fixture
    def provider(self) -> LLMProvider:
        """Create test provider."""
        return LLMProvider()

    async def test_stream_openrouter_basic_text(self, provider: LLMProvider):
        """Test basic text streaming from OpenRouter."""
        chunks = [
            MagicMock(choices=[MagicMock(delta=MagicMock(content="Hello", tool_calls=None), finish_reason=None)], usage=None),
            MagicMock(choices=[MagicMock(delta=MagicMock(content=" world", tool_calls=None), finish_reason=None)], usage=None),
            MagicMock(choices=[MagicMock(delta=MagicMock(content=None, tool_calls=None), finish_reason="stop")], usage=None),
            MagicMock(choices=[], usage=MagicMock(prompt_tokens=10, completion_tokens=5, total_tokens=15)),
        ]

        async def mock_stream():
            for chunk in chunks:
                yield chunk

        mock_client = MagicMock()
        mock_client.chat.completions.create = AsyncMock(return_value=mock_stream())
        provider._openrouter_client = mock_client

        results = []
        async for event in provider._stream_openrouter(
            model="claude-sonnet-4.5",
            messages=[{"role": "user", "content": "Hello"}],
        ):
            results.append(event)

        token_events = [e for e in results if e.type == "token"]
        assert len(token_events) == 2
        assert token_events[0].content == "Hello"
        assert token_events[1].content == " world"

        done_events = [e for e in results if e.type == "done"]
        assert len(done_events) == 1
        assert done_events[0].usage["input_tokens"] == 10

    async def test_stream_openrouter_with_tool_calls(self, provider: LLMProvider):
        """Test OpenRouter streaming with tool calls."""
        func1 = MagicMock()
        func1.name = "read_file"
        func1.arguments = '{"path":'

        func2 = MagicMock()
        func2.name = None
        func2.arguments = '"/test.py"}'

        tc1 = MagicMock()
        tc1.index = 0
        tc1.id = "tc-1"
        tc1.function = func1

        tc2 = MagicMock()
        tc2.index = 0
        tc2.id = None
        tc2.function = func2

        chunks = [
            MagicMock(choices=[MagicMock(delta=MagicMock(content=None, tool_calls=[tc1]), finish_reason=None)], usage=None),
            MagicMock(choices=[MagicMock(delta=MagicMock(content=None, tool_calls=[tc2]), finish_reason=None)], usage=None),
            MagicMock(choices=[MagicMock(delta=MagicMock(content=None, tool_calls=None), finish_reason="tool_calls")], usage=None),
            MagicMock(choices=[], usage=MagicMock(prompt_tokens=10, completion_tokens=5, total_tokens=15)),
        ]

        async def mock_stream():
            for chunk in chunks:
                yield chunk

        mock_client = MagicMock()
        mock_client.chat.completions.create = AsyncMock(return_value=mock_stream())
        provider._openrouter_client = mock_client

        results = []
        async for event in provider._stream_openrouter(
            model="claude-sonnet-4.5",
            messages=[{"role": "user", "content": "Read file"}],
        ):
            results.append(event)

        tool_start = [e for e in results if e.type == "tool_call_start"]
        assert len(tool_start) == 1
        assert tool_start[0].tool_name == "read_file"

        tool_end = [e for e in results if e.type == "tool_call_end"]
        assert len(tool_end) == 1
        assert tool_end[0].tool_input == {"path": "/test.py"}

    async def test_stream_openrouter_model_passthrough(self, provider: LLMProvider):
        """Test OpenRouter streaming passes model name directly.

        Note: Model name mapping (e.g., claude-sonnet-4.5 -> anthropic/claude-sonnet-4.5)
        is done by the caller, not by _stream_openrouter itself.
        """
        chunks = [
            MagicMock(choices=[MagicMock(delta=MagicMock(content="Hi", tool_calls=None), finish_reason="stop")], usage=None),
            MagicMock(choices=[], usage=MagicMock(prompt_tokens=5, completion_tokens=1, total_tokens=6)),
        ]

        async def mock_stream():
            for chunk in chunks:
                yield chunk

        mock_client = MagicMock()
        mock_client.chat.completions.create = AsyncMock(return_value=mock_stream())
        provider._openrouter_client = mock_client

        results = []
        async for event in provider._stream_openrouter(
            model="anthropic/claude-sonnet-4.5",  # Full model name passed by caller
            messages=[{"role": "user", "content": "Hi"}],
        ):
            results.append(event)

        call_kwargs = mock_client.chat.completions.create.call_args.kwargs
        assert call_kwargs["model"] == "anthropic/claude-sonnet-4.5"


class TestStreamOllamaMethod:
    """Test _stream_ollama method."""

    @pytest.fixture
    def provider(self) -> LLMProvider:
        """Create test provider."""
        return LLMProvider()

    async def test_stream_ollama_basic_text(self, provider: LLMProvider):
        """Test basic text streaming from Ollama."""
        chunks = [
            MagicMock(choices=[MagicMock(delta=MagicMock(content="Hello", tool_calls=None), finish_reason=None)], usage=None),
            MagicMock(choices=[MagicMock(delta=MagicMock(content=" world", tool_calls=None), finish_reason=None)], usage=None),
            MagicMock(choices=[MagicMock(delta=MagicMock(content=None, tool_calls=None), finish_reason="stop")], usage=None),
            MagicMock(choices=[], usage=MagicMock(prompt_tokens=10, completion_tokens=5, total_tokens=15)),
        ]

        async def mock_stream():
            for chunk in chunks:
                yield chunk

        mock_client = MagicMock()
        mock_client.chat.completions.create = AsyncMock(return_value=mock_stream())
        provider._ollama_client = mock_client

        with patch("src.providers.llm.settings") as mock_settings:
            mock_settings.OLLAMA_MODEL = "llama2"

            results = []
            async for event in provider._stream_ollama(
                model="llama2",
                messages=[{"role": "user", "content": "Hello"}],
            ):
                results.append(event)

        token_events = [e for e in results if e.type == "token"]
        assert len(token_events) == 2
        assert token_events[0].content == "Hello"

        done_events = [e for e in results if e.type == "done"]
        assert len(done_events) == 1
        assert done_events[0].usage["input_tokens"] == 10

    async def test_stream_ollama_estimates_tokens_when_missing(self, provider: LLMProvider):
        """Test Ollama streaming estimates tokens when not provided."""
        chunks = [
            MagicMock(choices=[MagicMock(delta=MagicMock(content="Hello world", tool_calls=None), finish_reason=None)], usage=None),
            MagicMock(choices=[MagicMock(delta=MagicMock(content=None, tool_calls=None), finish_reason="stop")], usage=None),
            # Final chunk with zero usage
            MagicMock(choices=[], usage=MagicMock(prompt_tokens=0, completion_tokens=0, total_tokens=0)),
        ]

        async def mock_stream():
            for chunk in chunks:
                yield chunk

        mock_client = MagicMock()
        mock_client.chat.completions.create = AsyncMock(return_value=mock_stream())
        provider._ollama_client = mock_client

        with patch("src.providers.llm.settings") as mock_settings:
            mock_settings.OLLAMA_MODEL = "llama2"

            results = []
            async for event in provider._stream_ollama(
                model="llama2",
                messages=[{"role": "user", "content": "Hello test message"}],
            ):
                results.append(event)

        done_events = [e for e in results if e.type == "done"]
        assert len(done_events) == 1
        # Should have estimated tokens (non-zero)
        assert done_events[0].usage["input_tokens"] > 0
        assert done_events[0].usage["output_tokens"] > 0

    async def test_stream_ollama_with_tool_calls(self, provider: LLMProvider):
        """Test Ollama streaming with tool calls."""
        func1 = MagicMock()
        func1.name = "read_file"
        func1.arguments = '{"path":'

        func2 = MagicMock()
        func2.name = None
        func2.arguments = '"/test.py"}'

        tc1 = MagicMock()
        tc1.index = 0
        tc1.id = "tc-1"
        tc1.function = func1

        tc2 = MagicMock()
        tc2.index = 0
        tc2.id = None
        tc2.function = func2

        chunks = [
            MagicMock(choices=[MagicMock(delta=MagicMock(content=None, tool_calls=[tc1]), finish_reason=None)], usage=None),
            MagicMock(choices=[MagicMock(delta=MagicMock(content=None, tool_calls=[tc2]), finish_reason=None)], usage=None),
            MagicMock(choices=[MagicMock(delta=MagicMock(content=None, tool_calls=None), finish_reason="tool_calls")], usage=None),
            MagicMock(choices=[], usage=MagicMock(prompt_tokens=10, completion_tokens=5, total_tokens=15)),
        ]

        async def mock_stream():
            for chunk in chunks:
                yield chunk

        mock_client = MagicMock()
        mock_client.chat.completions.create = AsyncMock(return_value=mock_stream())
        provider._ollama_client = mock_client

        with patch("src.providers.llm.settings") as mock_settings:
            mock_settings.OLLAMA_MODEL = "llama2"

            results = []
            async for event in provider._stream_ollama(
                model="llama2",
                messages=[{"role": "user", "content": "Read file"}],
            ):
                results.append(event)

        tool_start = [e for e in results if e.type == "tool_call_start"]
        assert len(tool_start) == 1
        assert tool_start[0].tool_name == "read_file"

        tool_end = [e for e in results if e.type == "tool_call_end"]
        assert len(tool_end) == 1
        assert tool_end[0].tool_input == {"path": "/test.py"}

    async def test_stream_ollama_with_tools_param(self, provider: LLMProvider):
        """Test Ollama streaming converts tool format."""
        chunks = [
            MagicMock(choices=[MagicMock(delta=MagicMock(content="Hi", tool_calls=None), finish_reason="stop")], usage=None),
            MagicMock(choices=[], usage=MagicMock(prompt_tokens=5, completion_tokens=1, total_tokens=6)),
        ]

        async def mock_stream():
            for chunk in chunks:
                yield chunk

        mock_client = MagicMock()
        mock_client.chat.completions.create = AsyncMock(return_value=mock_stream())
        provider._ollama_client = mock_client

        tools = [{"name": "read_file", "description": "Read a file", "input_schema": {"type": "object"}}]

        with patch("src.providers.llm.settings") as mock_settings:
            mock_settings.OLLAMA_MODEL = "llama2"

            results = []
            async for event in provider._stream_ollama(
                model="llama2",
                messages=[{"role": "user", "content": "Hi"}],
                tools=tools,
            ):
                results.append(event)

        call_kwargs = mock_client.chat.completions.create.call_args.kwargs
        assert call_kwargs["tools"][0]["type"] == "function"
        assert call_kwargs["tools"][0]["function"]["name"] == "read_file"

    async def test_stream_ollama_no_choices_chunk(self, provider: LLMProvider):
        """Test Ollama streaming handles chunks without choices."""
        chunks = [
            MagicMock(choices=[], usage=None),  # Empty chunk
            MagicMock(choices=[MagicMock(delta=MagicMock(content="Hi", tool_calls=None), finish_reason="stop")], usage=None),
            MagicMock(choices=[], usage=MagicMock(prompt_tokens=5, completion_tokens=1, total_tokens=6)),
        ]

        async def mock_stream():
            for chunk in chunks:
                yield chunk

        mock_client = MagicMock()
        mock_client.chat.completions.create = AsyncMock(return_value=mock_stream())
        provider._ollama_client = mock_client

        with patch("src.providers.llm.settings") as mock_settings:
            mock_settings.OLLAMA_MODEL = "llama2"

            results = []
            async for event in provider._stream_ollama(
                model="llama2",
                messages=[{"role": "user", "content": "Hi"}],
            ):
                results.append(event)

        token_events = [e for e in results if e.type == "token"]
        assert len(token_events) == 1
        assert token_events[0].content == "Hi"
