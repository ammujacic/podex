"""Tests for context management modules.

Tests cover:
- Context window manager
- Context summarizer
- Tokenizer and token estimation functions
"""

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


class TestTokenizerModule:
    """Test tokenizer module."""

    def test_tokenizer_class_exists(self):
        """Test Tokenizer class exists."""
        from src.context.tokenizer import Tokenizer
        assert Tokenizer is not None

    def test_tokenizer_initialization(self):
        """Test Tokenizer initialization."""
        from src.context.tokenizer import Tokenizer

        tokenizer = Tokenizer()
        assert tokenizer is not None

    def test_tokenizer_with_model(self):
        """Test Tokenizer with model specification."""
        from src.context.tokenizer import Tokenizer

        tokenizer = Tokenizer(model="claude-3-5-sonnet-20241022")
        assert tokenizer.context_limit == 200000

    def test_tokenizer_default_context_limit(self):
        """Test Tokenizer default context limit."""
        from src.context.tokenizer import Tokenizer

        tokenizer = Tokenizer()
        assert tokenizer.context_limit == 100000

    def test_estimate_tokens_function(self):
        """Test estimate_tokens function."""
        from src.context.tokenizer import estimate_tokens

        # ~100 characters should be ~25 tokens
        text = "a" * 100
        tokens = estimate_tokens(text)
        assert tokens >= 20
        assert tokens <= 30

    def test_estimate_tokens_empty(self):
        """Test estimate_tokens for empty string."""
        from src.context.tokenizer import estimate_tokens

        tokens = estimate_tokens("")
        assert tokens == 0

    def test_estimate_message_tokens_function(self):
        """Test estimate_message_tokens function."""
        from src.context.tokenizer import estimate_message_tokens

        message = {"role": "user", "content": "Hello world"}
        tokens = estimate_message_tokens(message)
        assert tokens > 0

    def test_estimate_messages_tokens_function(self):
        """Test estimate_messages_tokens function."""
        from src.context.tokenizer import estimate_messages_tokens

        messages = [
            {"role": "user", "content": "Hello"},
            {"role": "assistant", "content": "Hi there!"},
        ]
        tokens = estimate_messages_tokens(messages)
        assert tokens > 0


class TestContextWindowManagerModule:
    """Test ContextWindowManager class."""

    def test_context_window_manager_exists(self):
        """Test ContextWindowManager class exists."""
        from src.context.manager import ContextWindowManager
        assert ContextWindowManager is not None

    def test_context_window_manager_initialization(self):
        """Test ContextWindowManager initialization."""
        from src.context.manager import ContextWindowManager

        mock_llm = MagicMock()
        manager = ContextWindowManager(
            llm_provider=mock_llm,
            model="claude-3-5-sonnet-20241022",
            max_context_tokens=8000,
            output_reservation=1000,
        )

        assert manager._llm == mock_llm
        assert manager._max_tokens == 8000
        assert manager._output_reservation == 1000

    def test_context_manager_holder_exists(self):
        """Test ContextManagerHolder class exists."""
        from src.context.manager import ContextManagerHolder
        assert ContextManagerHolder is not None

    def test_get_context_manager_function(self):
        """Test get_context_manager function."""
        from src.context.manager import get_context_manager
        assert callable(get_context_manager)


class TestContextSummarizerModule:
    """Test context summarizer module."""

    def test_conversation_summarizer_exists(self):
        """Test ConversationSummarizer class exists."""
        from src.context.summarizer import ConversationSummarizer
        assert ConversationSummarizer is not None

    def test_conversation_summary_class(self):
        """Test ConversationSummary class."""
        from src.context.summarizer import ConversationSummary, SummaryMetadata

        metadata = SummaryMetadata(
            messages_start_id="msg-1",
            messages_end_id="msg-10",
            message_count=10,
            token_count=500,
        )
        summary = ConversationSummary(
            summary_id="summary-123",
            agent_id="agent-456",
            summary="Summary of conversation",
            metadata=metadata,
        )

        assert summary.id == "summary-123"
        assert summary.agent_id == "agent-456"
        assert summary.summary == "Summary of conversation"
        assert summary.message_count == 10
        assert summary.token_count == 500

    def test_summary_metadata_dataclass(self):
        """Test SummaryMetadata dataclass."""
        from src.context.summarizer import SummaryMetadata

        metadata = SummaryMetadata(
            messages_start_id="msg-1",
            messages_end_id="msg-20",
            message_count=20,
            token_count=1000,
        )

        assert metadata.message_count == 20
        assert metadata.token_count == 1000
        assert metadata.messages_start_id == "msg-1"
        assert metadata.messages_end_id == "msg-20"

    def test_conversation_summarizer_initialization(self):
        """Test ConversationSummarizer initialization."""
        from src.context.summarizer import ConversationSummarizer

        mock_llm = MagicMock()
        summarizer = ConversationSummarizer(
            llm_provider=mock_llm,
            model="claude-3-5-sonnet-20241022",
        )

        assert summarizer._llm == mock_llm
