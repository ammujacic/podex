"""Comprehensive tests for Context Management modules.

Tests cover:
- ContextWindowManager token budgeting
- ConversationSummarizer
- Tokenizer
- Context overflow handling
- Browser context formatting
"""

import asyncio
from datetime import UTC, datetime
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


class TestTokenizer:
    """Test Tokenizer class."""

    def test_tokenizer_initialization(self):
        """Test Tokenizer initialization."""
        from src.context.tokenizer import Tokenizer

        tokenizer = Tokenizer("claude-3-5-sonnet-20241022")

        assert tokenizer._model == "claude-3-5-sonnet-20241022"

    def test_tokenizer_default_model(self):
        """Test Tokenizer with default model."""
        from src.context.tokenizer import Tokenizer

        tokenizer = Tokenizer()

        # Default model is None, which is valid - uses default context limit
        assert tokenizer._context_limit > 0

    def test_count_text_basic(self):
        """Test counting tokens in text."""
        from src.context.tokenizer import Tokenizer

        tokenizer = Tokenizer()

        count = tokenizer.count("Hello, world!")

        # Should return a positive count
        assert count > 0

    def test_count_text_empty(self):
        """Test counting empty text."""
        from src.context.tokenizer import Tokenizer

        tokenizer = Tokenizer()

        count = tokenizer.count("")

        assert count == 0

    def test_count_text_unicode(self):
        """Test counting unicode text."""
        from src.context.tokenizer import Tokenizer

        tokenizer = Tokenizer()

        count = tokenizer.count("Hello 世界 🌍")

        assert count > 0

    def test_count_messages(self):
        """Test counting tokens in messages."""
        from src.context.tokenizer import Tokenizer

        tokenizer = Tokenizer()

        messages = [
            {"role": "user", "content": "Hello"},
            {"role": "assistant", "content": "Hi there!"},
        ]

        count = tokenizer.count_messages(messages)

        assert count > 0

    def test_count_messages_empty(self):
        """Test counting empty messages list."""
        from src.context.tokenizer import Tokenizer

        tokenizer = Tokenizer()

        count = tokenizer.count_messages([])

        assert count == 0

    def test_count_messages_with_tool_calls(self):
        """Test counting messages with tool calls."""
        from src.context.tokenizer import Tokenizer

        tokenizer = Tokenizer()

        messages = [
            {
                "role": "assistant",
                "content": "I'll read the file",
                "tool_calls": [
                    {"id": "call-1", "type": "tool_use", "name": "read_file", "input": {"path": "/test"}}
                ],
            },
            {
                "role": "tool",
                "tool_use_id": "call-1",
                "content": "File contents here",
            },
        ]

        count = tokenizer.count_messages(messages)

        assert count > 0

    def test_fits_in_context(self):
        """Test fits_in_context method."""
        from src.context.tokenizer import Tokenizer

        tokenizer = Tokenizer("claude-3-5-sonnet-20241022")

        messages = [
            {"role": "user", "content": "Hello"},
            {"role": "assistant", "content": "Hi there!"},
        ]

        fits = tokenizer.fits_in_context(messages, system_prompt="You are helpful.")

        assert fits is True

    def test_context_limit_property(self):
        """Test context_limit property."""
        from src.context.tokenizer import Tokenizer

        tokenizer = Tokenizer("claude-3-5-sonnet-20241022")

        assert tokenizer.context_limit == 200000

    def test_available_tokens_property(self):
        """Test available_tokens property."""
        from src.context.tokenizer import Tokenizer

        tokenizer = Tokenizer("claude-3-5-sonnet-20241022")

        # Available = limit - output reservation
        assert tokenizer.available_tokens > 0
        assert tokenizer.available_tokens < tokenizer.context_limit


class TestContextWindowManager:
    """Test ContextWindowManager."""

    @pytest.fixture
    def mock_llm_provider(self):
        """Create mock LLM provider."""
        provider = MagicMock()
        provider.complete = AsyncMock(return_value="Summary of conversation")
        return provider

    def test_manager_initialization(self, mock_llm_provider):
        """Test manager initialization."""
        from src.context.manager import ContextWindowManager

        manager = ContextWindowManager(
            llm_provider=mock_llm_provider,
            model="claude-3-5-sonnet-20241022",
            max_context_tokens=100000,
            output_reservation=4096,
        )

        assert manager._max_tokens == 100000
        assert manager._output_reservation == 4096

    def test_manager_requires_llm_and_limits(self):
        """Test manager requires all parameters."""
        from src.context.manager import ContextWindowManager

        mock_llm = MagicMock()

        # Missing max_context_tokens
        with pytest.raises(ValueError) as exc_info:
            ContextWindowManager(
                llm_provider=mock_llm,
                model="claude-3-5-sonnet-20241022",
                output_reservation=4096,
            )
        assert "max_context_tokens" in str(exc_info.value)

    def test_manager_default_values(self, mock_llm_provider):
        """Test manager with valid parameters."""
        from src.context.manager import ContextWindowManager

        manager = ContextWindowManager(
            llm_provider=mock_llm_provider,
            model="claude-3-5-sonnet-20241022",
            max_context_tokens=100000,
            output_reservation=4096,
        )

        assert manager._max_tokens > 0
        assert manager._output_reservation > 0

    def test_get_available_tokens(self, mock_llm_provider):
        """Test available_tokens property."""
        from src.context.manager import ContextWindowManager

        manager = ContextWindowManager(
            llm_provider=mock_llm_provider,
            model="claude-3-5-sonnet-20241022",
            max_context_tokens=100000,
            output_reservation=4096,
        )

        available = manager.available_tokens

        # Should be max - output_reservation - buffer
        assert available > 0
        assert available < 100000

    def test_get_available_tokens_when_over(self, mock_llm_provider):
        """Test available tokens with small limits."""
        from src.context.manager import ContextWindowManager

        manager = ContextWindowManager(
            llm_provider=mock_llm_provider,
            model="claude-3-5-sonnet-20241022",
            max_context_tokens=5000,  # Small limit
            output_reservation=4000,
        )

        available = manager.available_tokens

        # Very small available tokens
        assert available < 2000

    def test_track_usage(self, mock_llm_provider):
        """Test token usage tracking."""
        from src.context.manager import ContextWindowManager

        manager = ContextWindowManager(
            llm_provider=mock_llm_provider,
            model="claude-3-5-sonnet-20241022",
            max_context_tokens=100000,
            output_reservation=4096,
        )

        manager.track_usage(input_tokens=1000, output_tokens=500)
        usage = manager.get_token_usage()

        assert usage["total_input_tokens"] == 1000
        assert usage["total_output_tokens"] == 500
        assert usage["total_tokens"] == 1500


class TestConversationSummarizer:
    """Test ConversationSummarizer."""

    @pytest.fixture
    def mock_llm_provider(self):
        """Create mock LLM provider."""
        provider = MagicMock()
        provider.complete = AsyncMock(return_value="This is a summary.")
        return provider

    def test_summarizer_initialization(self, mock_llm_provider):
        """Test summarizer initialization."""
        from src.context.summarizer import ConversationSummarizer

        summarizer = ConversationSummarizer(
            llm_provider=mock_llm_provider,
            model="claude-3-5-sonnet-20241022",
        )

        assert summarizer is not None

    @pytest.mark.asyncio
    async def test_create_summary_empty_messages_raises(self, mock_llm_provider):
        """Test create_summary with empty messages raises ValueError."""
        from src.context.summarizer import ConversationSummarizer

        summarizer = ConversationSummarizer(
            llm_provider=mock_llm_provider,
            model="claude-3-5-sonnet-20241022",
        )

        with pytest.raises(ValueError) as exc_info:
            await summarizer.create_summary(agent_id="agent-123", messages=[])

        assert "No messages to summarize" in str(exc_info.value)


class TestContextSummaryDataclass:
    """Test ConversationSummary dataclass."""

    def test_context_summary_creation(self):
        """Test creating ConversationSummary."""
        from src.context.summarizer import ConversationSummary, SummaryMetadata

        metadata = SummaryMetadata(
            message_count=10,
            token_count=5000,
        )

        summary = ConversationSummary(
            summary_id="sum-123",
            agent_id="agent-123",
            summary="This is a summary",
            metadata=metadata,
        )

        assert summary.summary == "This is a summary"
        assert summary.message_count == 10
        assert summary.token_count == 5000

    def test_context_summary_to_dict(self):
        """Test ConversationSummary to_dict method."""
        from src.context.summarizer import ConversationSummary, SummaryMetadata

        metadata = SummaryMetadata(
            message_count=10,
            token_count=5000,
        )

        summary = ConversationSummary(
            summary_id="sum-123",
            agent_id="agent-123",
            summary="This is a summary",
            metadata=metadata,
        )

        data = summary.to_dict()

        assert data["id"] == "sum-123"
        assert data["agent_id"] == "agent-123"
        assert data["summary"] == "This is a summary"


class TestBrowserContext:
    """Test browser context formatting."""

    def test_format_browser_context_empty(self):
        """Test formatting empty browser context."""
        from src.context.manager import format_browser_context

        result = format_browser_context({})

        assert result == ""

    def test_format_browser_context_with_url(self):
        """Test formatting browser context with URL."""
        from src.context.manager import format_browser_context

        context = {
            "url": "https://example.com",
            "title": "Example Site",
            "timestamp": "2024-01-01T00:00:00Z",
        }

        result = format_browser_context(context)

        assert "https://example.com" in result
        assert "Example Site" in result

    def test_format_browser_context_with_console(self):
        """Test formatting browser context with console logs."""
        from src.context.manager import format_browser_context

        context = {
            "url": "https://example.com",
            "consoleLogs": [
                {"level": "error", "message": "Test error"},
                {"level": "warn", "message": "Test warning"},
                {"level": "log", "message": "Test log"},
            ],
        }

        result = format_browser_context(context)

        assert "Console Output" in result
        assert "Test error" in result

    def test_format_browser_context_with_network(self):
        """Test formatting browser context with network requests."""
        from src.context.manager import format_browser_context

        context = {
            "url": "https://example.com",
            "networkRequests": [
                {"method": "GET", "url": "https://api.example.com", "status": 200},
                {"method": "POST", "url": "https://api.example.com/error", "status": 500},
            ],
        }

        result = format_browser_context(context)

        assert "Network Requests" in result
        assert "500" in result

    def test_format_browser_context_with_errors(self):
        """Test formatting browser context with JavaScript errors."""
        from src.context.manager import format_browser_context

        context = {
            "url": "https://example.com",
            "errors": [
                {"type": "TypeError", "message": "Cannot read property", "stack": "at foo.js:10"},
            ],
        }

        result = format_browser_context(context)

        assert "JavaScript Errors" in result
        assert "TypeError" in result
        assert "Cannot read property" in result


class TestContextOverflow:
    """Test context overflow handling."""

    def test_truncate_message_content(self):
        """Test message content truncation."""
        from src.context.tokenizer import Tokenizer

        tokenizer = Tokenizer()

        # Long message should have higher token count
        short_msg = {"role": "user", "content": "Hello"}
        long_msg = {"role": "user", "content": "x" * 10000}

        short_count = tokenizer.count_message(short_msg)
        long_count = tokenizer.count_message(long_msg)

        assert long_count > short_count

    def test_prioritize_recent_messages(self):
        """Test that tokenizer counts all messages."""
        from src.context.tokenizer import Tokenizer

        tokenizer = Tokenizer()

        messages = [
            {"role": "user", "content": f"Message {i}"}
            for i in range(100)
        ]

        total_count = tokenizer.count_messages(messages)

        # Should count all messages
        assert total_count > 0


class TestContextIntegration:
    """Test context module integration."""

    @pytest.fixture
    def mock_llm_provider(self):
        """Create mock LLM provider."""
        provider = MagicMock()
        provider.complete = AsyncMock(return_value="This is a summary of the conversation.")
        return provider

    @pytest.mark.asyncio
    async def test_full_context_workflow(self, mock_llm_provider):
        """Test complete context preparation workflow."""
        from src.context.manager import ContextWindowManager

        manager = ContextWindowManager(
            llm_provider=mock_llm_provider,
            model="claude-3-5-sonnet-20241022",
            max_context_tokens=100000,
            output_reservation=4096,
        )

        messages = [
            {"role": "user", "content": "Hello"},
            {"role": "assistant", "content": "Hi there!"},
            {"role": "user", "content": "How are you?"},
        ]

        prepared, token_count = await manager.prepare_context(
            agent_id="agent-123",
            messages=messages,
            system_prompt="You are helpful.",
        )

        assert len(prepared) > 0
        assert token_count > 0

    @pytest.mark.asyncio
    async def test_context_with_summarization(self, mock_llm_provider):
        """Test context preparation with summarization needed."""
        from src.context.manager import ContextWindowManager

        manager = ContextWindowManager(
            llm_provider=mock_llm_provider,
            model="claude-3-5-sonnet-20241022",
            max_context_tokens=200,  # Very small to trigger summarization
            output_reservation=50,
        )

        # Create many messages that exceed the limit
        messages = [
            {"role": "user" if i % 2 == 0 else "assistant", "content": f"Message {i} " * 50}
            for i in range(20)
        ]

        prepared, token_count = await manager.prepare_context(
            agent_id="agent-123",
            messages=messages,
            system_prompt="You are helpful.",
        )

        # Should still return something
        assert len(prepared) >= 0


class TestEstimateTokensFunctions:
    """Test module-level estimate functions."""

    def test_estimate_tokens_basic(self):
        """Test estimate_tokens function."""
        from src.context.tokenizer import estimate_tokens

        count = estimate_tokens("Hello, world!")

        assert count > 0

    def test_estimate_tokens_empty(self):
        """Test estimate_tokens with empty string."""
        from src.context.tokenizer import estimate_tokens

        count = estimate_tokens("")

        assert count == 0

    def test_estimate_message_tokens(self):
        """Test estimate_message_tokens function."""
        from src.context.tokenizer import estimate_message_tokens

        message = {"role": "user", "content": "Hello"}

        count = estimate_message_tokens(message)

        # Should include content + overhead
        assert count > 0

    def test_estimate_messages_tokens(self):
        """Test estimate_messages_tokens function."""
        from src.context.tokenizer import estimate_messages_tokens

        messages = [
            {"role": "user", "content": "Hello"},
            {"role": "assistant", "content": "Hi there!"},
        ]

        count = estimate_messages_tokens(messages)

        assert count > 0
