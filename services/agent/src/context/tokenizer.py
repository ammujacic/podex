"""Token counting utilities for context management."""

import re
from typing import Any, ClassVar

import structlog

logger = structlog.get_logger()

# Average characters per token (approximation for Claude/GPT models)
CHARS_PER_TOKEN = 4.0

# Token overhead for message structure
MESSAGE_OVERHEAD = 4  # tokens for role, separators, etc.


def estimate_tokens(text: str) -> int:
    """Estimate token count for a text string.

    Uses a simple character-based estimation. For production,
    consider using tiktoken or the Anthropic tokenizer.

    Args:
        text: Text to estimate tokens for

    Returns:
        Estimated token count
    """
    if not text:
        return 0

    # Count characters excluding whitespace runs
    text = re.sub(r"\s+", " ", text)
    char_count = len(text)

    # Estimate tokens
    return int(char_count / CHARS_PER_TOKEN) + 1


def estimate_message_tokens(message: dict[str, Any]) -> int:
    """Estimate tokens for a single message.

    Args:
        message: Message dict with role and content

    Returns:
        Estimated token count
    """
    content = message.get("content", "")
    content_tokens = estimate_tokens(content)

    # Add overhead for message structure
    return content_tokens + MESSAGE_OVERHEAD


def estimate_messages_tokens(messages: list[dict[str, Any]]) -> int:
    """Estimate total tokens for a list of messages.

    Args:
        messages: List of message dicts

    Returns:
        Total estimated token count
    """
    return sum(estimate_message_tokens(msg) for msg in messages)


class Tokenizer:
    """Token counter with model-specific configurations."""

    # Model context limits
    MODEL_LIMITS: ClassVar[dict[str, int]] = {
        "claude-opus-4-5-20251101": 200000,
        "claude-sonnet-4-5": 200000,
        "claude-3-5-sonnet-20241022": 200000,
        "claude-3-sonnet": 200000,
        "claude-3-haiku": 200000,
        "gpt-4o": 128000,
        "gpt-4-turbo": 128000,
        "gpt-4": 8192,
        "gpt-3.5-turbo": 16384,
    }

    # Default output token reservation
    DEFAULT_OUTPUT_TOKENS = 4096

    def __init__(self, model: str | None = None) -> None:
        """Initialize tokenizer.

        Args:
            model: Optional model name for context limits
        """
        self._model = model
        self._context_limit = self.MODEL_LIMITS.get(model or "", 100000)

    @property
    def context_limit(self) -> int:
        """Get the context window limit for the model."""
        return self._context_limit

    @property
    def available_tokens(self) -> int:
        """Get available tokens for input (limit - output reservation)."""
        return self._context_limit - self.DEFAULT_OUTPUT_TOKENS

    def count(self, text: str) -> int:
        """Count tokens in a text string.

        Args:
            text: Text to count

        Returns:
            Token count
        """
        return estimate_tokens(text)

    def count_message(self, message: dict[str, Any]) -> int:
        """Count tokens in a message.

        Args:
            message: Message dict

        Returns:
            Token count
        """
        return estimate_message_tokens(message)

    def count_messages(self, messages: list[dict[str, Any]]) -> int:
        """Count tokens in a list of messages.

        Args:
            messages: List of messages

        Returns:
            Total token count
        """
        return estimate_messages_tokens(messages)

    def fits_in_context(
        self,
        messages: list[dict[str, Any]],
        system_prompt: str = "",
        buffer: int = 1000,
    ) -> bool:
        """Check if messages fit within context window.

        Args:
            messages: Messages to check
            system_prompt: System prompt to include
            buffer: Extra token buffer for safety

        Returns:
            True if messages fit in context
        """
        system_tokens = self.count(system_prompt)
        messages_tokens = self.count_messages(messages)
        total = system_tokens + messages_tokens + buffer

        return total <= self.available_tokens

    def trim_to_fit(
        self,
        messages: list[dict[str, Any]],
        system_prompt: str = "",
        buffer: int = 1000,
        keep_recent: int = 5,
    ) -> list[dict[str, Any]]:
        """Trim messages to fit within context window.

        Preserves the most recent messages and removes older ones.

        Args:
            messages: Messages to trim
            system_prompt: System prompt to account for
            buffer: Extra token buffer
            keep_recent: Minimum recent messages to keep

        Returns:
            Trimmed list of messages
        """
        if self.fits_in_context(messages, system_prompt, buffer):
            return messages

        system_tokens = self.count(system_prompt)
        available = self.available_tokens - system_tokens - buffer

        # Always keep the last few messages
        result = messages[-keep_recent:] if len(messages) > keep_recent else messages[:]
        result_tokens = self.count_messages(result)

        # Add older messages from newest to oldest until we hit the limit
        remaining = messages[:-keep_recent] if len(messages) > keep_recent else []

        for msg in reversed(remaining):
            msg_tokens = self.count_message(msg)
            if result_tokens + msg_tokens <= available:
                result.insert(0, msg)
                result_tokens += msg_tokens
            else:
                break

        logger.debug(
            "Trimmed messages to fit context",
            original_count=len(messages),
            trimmed_count=len(result),
            tokens_used=result_tokens,
            available=available,
        )

        return result
