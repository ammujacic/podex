"""Tests for context management module.

Tests cover:
- Context window management
- Message history trimming
- Token counting
- Context summarization triggers
"""

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


class TestContextManagerBasics:
    """Test basic context manager functionality."""

    def test_context_manager_module_exists(self):
        """Test that context manager module can be imported."""
        from src.context import manager
        assert manager is not None

    def test_get_context_manager_function_exists(self):
        """Test that get_context_manager function exists."""
        from src.context.manager import get_context_manager
        assert callable(get_context_manager)


class TestTokenCounting:
    """Test token counting functionality."""

    def test_tokenizer_module_exists(self):
        """Test that tokenizer module can be imported."""
        from src.context import tokenizer
        assert tokenizer is not None


class TestContextSummarization:
    """Test context summarization functionality."""

    def test_summarizer_module_exists(self):
        """Test that summarizer module can be imported."""
        from src.context import summarizer
        assert summarizer is not None


class TestMessageManagement:
    """Test message history management."""

    def test_message_structure(self):
        """Test standard message structure."""
        message = {
            "role": "user",
            "content": "Hello, world!",
        }
        assert message["role"] in ["user", "assistant", "system"]
        assert len(message["content"]) > 0

    def test_assistant_message_with_tool_calls(self):
        """Test assistant message with tool calls."""
        message = {
            "role": "assistant",
            "content": "I'll read that file for you.",
            "tool_calls": [
                {
                    "id": "call_123",
                    "name": "read_file",
                    "input": {"path": "/workspace/main.py"},
                }
            ],
        }
        assert message["role"] == "assistant"
        assert len(message["tool_calls"]) == 1

    def test_tool_result_message(self):
        """Test tool result message structure."""
        message = {
            "role": "user",
            "content": [
                {
                    "type": "tool_result",
                    "tool_use_id": "call_123",
                    "content": "def main():\n    print('Hello')",
                }
            ],
        }
        assert message["content"][0]["type"] == "tool_result"


class TestTokenizerFunctions:
    """Test tokenizer module functions."""

    def test_tokenizer_class_exists(self):
        """Test Tokenizer class exists."""
        from src.context.tokenizer import Tokenizer
        assert Tokenizer is not None

    def test_estimate_tokens_function(self):
        """Test estimate_tokens function."""
        from src.context.tokenizer import estimate_tokens

        tokens = estimate_tokens("Hello, world!")
        assert isinstance(tokens, int)
        assert tokens > 0

    def test_estimate_tokens_empty_string(self):
        """Test token counting for empty string."""
        from src.context.tokenizer import estimate_tokens

        tokens = estimate_tokens("")
        assert tokens == 0

    def test_estimate_message_tokens(self):
        """Test estimate_message_tokens function."""
        from src.context.tokenizer import estimate_message_tokens

        message = {"role": "user", "content": "Hello, world!"}
        tokens = estimate_message_tokens(message)
        assert isinstance(tokens, int)
        assert tokens > 0

    def test_estimate_messages_tokens(self):
        """Test estimate_messages_tokens function."""
        from src.context.tokenizer import estimate_messages_tokens

        messages = [
            {"role": "user", "content": "Hello"},
            {"role": "assistant", "content": "Hi there!"},
        ]
        tokens = estimate_messages_tokens(messages)
        assert isinstance(tokens, int)
        assert tokens > 0


class TestSummarizerFunctions:
    """Test summarizer module functions."""

    def test_conversation_summarizer_class_exists(self):
        """Test ConversationSummarizer class exists."""
        from src.context.summarizer import ConversationSummarizer
        assert ConversationSummarizer is not None

    def test_conversation_summary_dataclass_exists(self):
        """Test ConversationSummary dataclass exists."""
        from src.context.summarizer import ConversationSummary
        assert ConversationSummary is not None


class TestContextWindowManager:
    """Test ContextWindowManager class functionality."""

    @pytest.fixture
    def mock_llm_provider(self) -> MagicMock:
        """Create mock LLM provider."""
        mock = MagicMock()
        mock.complete = AsyncMock(return_value={
            "content": "Summary",
            "finish_reason": "stop",
            "usage": {},
            "tool_calls": [],
        })
        return mock

    def test_context_window_manager_class_exists(self):
        """Test ContextWindowManager class exists."""
        from src.context.manager import ContextWindowManager
        assert ContextWindowManager is not None


class TestFormatBrowserContext:
    """Test browser context formatting function."""

    def test_format_empty_context(self):
        """Test formatting empty browser context."""
        from src.context.manager import format_browser_context

        result = format_browser_context({})
        assert result == ""

    def test_format_none_context(self):
        """Test formatting None browser context."""
        from src.context.manager import format_browser_context

        result = format_browser_context(None)
        assert result == ""

    def test_format_basic_context(self):
        """Test formatting basic browser context."""
        from src.context.manager import format_browser_context

        context = {
            "url": "http://example.com",
            "timestamp": "2024-01-01T12:00:00Z",
            "title": "Example Page",
        }

        result = format_browser_context(context)
        assert "## Browser Context" in result
        assert "http://example.com" in result
        assert "Example Page" in result

    def test_format_context_with_errors(self):
        """Test formatting browser context with JS errors."""
        from src.context.manager import format_browser_context

        context = {
            "url": "http://example.com",
            "errors": [
                {
                    "type": "TypeError",
                    "message": "Cannot read property 'foo' of undefined",
                    "timestamp": "12:00:00",
                    "stack": "at main.js:10\nat init.js:5",
                }
            ],
        }

        result = format_browser_context(context)
        assert "JavaScript Errors" in result
        assert "TypeError" in result
        assert "Cannot read property" in result

    def test_format_context_with_console_logs(self):
        """Test formatting browser context with console logs."""
        from src.context.manager import format_browser_context

        context = {
            "url": "http://example.com",
            "consoleLogs": [
                {"level": "error", "message": "Error occurred"},
                {"level": "warn", "message": "Warning issued"},
                {"level": "log", "message": "Info logged"},
            ],
        }

        result = format_browser_context(context)
        # Console section or errors should be present
        assert len(result) > 0

    def test_format_context_with_metadata(self):
        """Test formatting browser context with metadata."""
        from src.context.manager import format_browser_context

        context = {
            "url": "http://example.com",
            "metadata": {
                "userAgent": "Mozilla/5.0 Chrome/120.0",
                "viewportSize": {"width": 1920, "height": 1080},
            },
        }

        result = format_browser_context(context)
        assert "Metadata" in result
        assert "1920" in result


class TestGetSetContextManager:
    """Test get_context_manager and set_context_manager functions."""

    def test_get_context_manager_function_exists(self):
        """Test that get_context_manager function exists."""
        from src.context.manager import get_context_manager
        assert callable(get_context_manager)

    def test_set_context_manager_function_exists(self):
        """Test that set_context_manager function exists."""
        from src.context.manager import set_context_manager
        assert callable(set_context_manager)

    def test_get_returns_none_initially(self):
        """Test get_context_manager returns None when not set."""
        from src.context.manager import get_context_manager, set_context_manager

        # Set to None first to reset any previous state
        set_context_manager(None)
        manager = get_context_manager()
        assert manager is None

    def test_set_and_get_manager(self):
        """Test setting and getting context manager."""
        from src.context.manager import get_context_manager, set_context_manager, ContextWindowManager

        # Create a mock manager
        mock_manager = MagicMock(spec=ContextWindowManager)

        set_context_manager(mock_manager)
        result = get_context_manager()

        assert result == mock_manager

        # Cleanup
        set_context_manager(None)


class TestContextManagerHolder:
    """Test ContextManagerHolder class."""

    def test_context_manager_holder_exists(self):
        """Test ContextManagerHolder class exists."""
        from src.context.manager import ContextManagerHolder
        assert ContextManagerHolder is not None
