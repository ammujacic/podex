"""Conversation summarization for context management."""

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any
from uuid import uuid4

import structlog

from src.context.tokenizer import Tokenizer, estimate_tokens
from src.providers.llm import CompletionRequest

if TYPE_CHECKING:
    from src.providers.llm import LLMProvider

logger = structlog.get_logger()

# Summarization prompt
SUMMARIZATION_PROMPT = """Summarize the following conversation between a user and an AI assistant.
Focus on:
1. Key decisions made
2. Important context and requirements discovered
3. Actions taken and their outcomes
4. Any pending tasks or unresolved issues

Be concise but preserve all critical information that would be needed to continue the conversation.

Conversation:
{conversation}

Summary:"""


@dataclass
class SummaryMetadata:
    """Metadata about a conversation summary."""

    messages_start_id: str | None = None
    messages_end_id: str | None = None
    message_count: int = 0
    token_count: int = 0
    created_at: datetime | None = None


class ConversationSummary:
    """A summary of a conversation segment."""

    def __init__(
        self,
        summary_id: str,
        agent_id: str,
        summary: str,
        metadata: SummaryMetadata | None = None,
    ) -> None:
        metadata = metadata or SummaryMetadata()
        self.id = summary_id
        self.agent_id = agent_id
        self.summary = summary
        self.messages_start_id = metadata.messages_start_id
        self.messages_end_id = metadata.messages_end_id
        self.message_count = metadata.message_count
        self.token_count = metadata.token_count
        self.created_at = metadata.created_at or datetime.now(UTC)

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary."""
        return {
            "id": self.id,
            "agent_id": self.agent_id,
            "summary": self.summary,
            "messages_start_id": self.messages_start_id,
            "messages_end_id": self.messages_end_id,
            "message_count": self.message_count,
            "token_count": self.token_count,
            "created_at": self.created_at.isoformat(),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ConversationSummary":
        """Create from dictionary."""
        metadata = SummaryMetadata(
            messages_start_id=data.get("messages_start_id"),
            messages_end_id=data.get("messages_end_id"),
            message_count=data.get("message_count", 0),
            token_count=data.get("token_count", 0),
            created_at=datetime.fromisoformat(data["created_at"])
            if data.get("created_at")
            else None,
        )
        return cls(
            summary_id=data["id"],
            agent_id=data["agent_id"],
            summary=data["summary"],
            metadata=metadata,
        )


class ConversationSummarizer:
    """Summarizes conversations to manage context window."""

    # Thresholds for when to summarize
    DEFAULT_MESSAGE_THRESHOLD = 40  # Summarize when messages exceed this
    DEFAULT_TOKEN_THRESHOLD = 50000  # Summarize when tokens exceed this

    def __init__(
        self,
        llm_provider: "LLMProvider",
        model: str,
        message_threshold: int | None = None,
        token_threshold: int | None = None,
    ) -> None:
        """Initialize summarizer.

        Args:
            llm_provider: LLM provider for generating summaries
            message_threshold: Message count threshold for summarization
            token_threshold: Token count threshold for summarization
        """
        if not model:
            raise ValueError(
                "model is required for ConversationSummarizer; "
                "pass the agent's resolved model from DB/role defaults."
            )
        self._llm = llm_provider
        self._model = model
        self._tokenizer = Tokenizer(model)
        self._message_threshold = message_threshold or self.DEFAULT_MESSAGE_THRESHOLD
        self._token_threshold = token_threshold or self.DEFAULT_TOKEN_THRESHOLD

    def needs_summarization(
        self,
        messages: list[dict[str, Any]],
        _existing_summaries: int = 0,
    ) -> bool:
        """Check if conversation needs summarization.

        Args:
            messages: Current conversation messages
            existing_summaries: Number of existing summaries

        Returns:
            True if summarization is needed
        """
        # Always keep some messages unsummarized
        min_messages = 10

        if len(messages) <= min_messages:
            return False

        # Check message count threshold
        if len(messages) > self._message_threshold:
            return True

        # Check token threshold
        token_count = self._tokenizer.count_messages(messages)
        return token_count > self._token_threshold

    async def create_summary(
        self,
        agent_id: str,
        messages: list[dict[str, Any]],
        start_index: int = 0,
        end_index: int | None = None,
    ) -> ConversationSummary:
        """Create a summary of conversation messages.

        Args:
            agent_id: Agent ID for the conversation
            messages: Messages to summarize
            start_index: Start index of messages to summarize
            end_index: End index of messages (exclusive)

        Returns:
            ConversationSummary object
        """
        end_index = end_index or len(messages)
        messages_to_summarize = messages[start_index:end_index]

        if not messages_to_summarize:
            raise ValueError("No messages to summarize")

        # Format conversation for summarization
        conversation_text = self._format_conversation(messages_to_summarize)

        # Generate summary using LLM
        prompt = SUMMARIZATION_PROMPT.format(conversation=conversation_text)

        request = CompletionRequest(
            model=self._model,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=2000,
            temperature=0.3,  # Lower temperature for factual summaries
        )
        response = await self._llm.complete(request)

        summary_text = response.get("content", "")

        # Create summary object
        metadata = SummaryMetadata(
            messages_start_id=messages_to_summarize[0].get("id"),
            messages_end_id=messages_to_summarize[-1].get("id"),
            message_count=len(messages_to_summarize),
            token_count=estimate_tokens(summary_text),
        )
        summary = ConversationSummary(
            summary_id=str(uuid4()),
            agent_id=agent_id,
            summary=summary_text,
            metadata=metadata,
        )

        logger.info(
            "Created conversation summary",
            agent_id=agent_id,
            messages_summarized=len(messages_to_summarize),
            summary_tokens=summary.token_count,
        )

        return summary

    async def summarize_if_needed(
        self,
        agent_id: str,
        messages: list[dict[str, Any]],
        keep_recent: int = 10,
    ) -> tuple[list[dict[str, Any]], ConversationSummary | None]:
        """Summarize conversation if needed and return updated messages.

        Args:
            agent_id: Agent ID
            messages: Current messages
            keep_recent: Number of recent messages to keep unsummarized

        Returns:
            Tuple of (updated messages, new summary if created)
        """
        if not self.needs_summarization(messages):
            return messages, None

        # Summarize older messages, keep recent ones
        messages_to_summarize = messages[:-keep_recent] if len(messages) > keep_recent else []
        recent_messages = messages[-keep_recent:] if len(messages) > keep_recent else messages

        if not messages_to_summarize:
            return messages, None

        summary = await self.create_summary(
            agent_id=agent_id,
            messages=messages_to_summarize,
        )

        # Prepend summary as a system message
        summary_message = {
            "role": "system",
            "content": f"[Previous conversation summary]\n{summary.summary}",
            "is_summary": True,
        }

        updated_messages = [summary_message, *recent_messages]

        logger.info(
            "Conversation summarized",
            agent_id=agent_id,
            original_count=len(messages),
            new_count=len(updated_messages),
        )

        return updated_messages, summary

    def _format_conversation(self, messages: list[dict[str, Any]]) -> str:
        """Format messages for summarization prompt.

        Args:
            messages: Messages to format

        Returns:
            Formatted conversation string
        """
        lines = []
        for msg in messages:
            role = msg.get("role", "unknown").capitalize()
            content = msg.get("content", "")
            lines.append(f"{role}: {content}")
        return "\n\n".join(lines)

    def inject_summaries_into_context(
        self,
        messages: list[dict[str, Any]],
        summaries: list[ConversationSummary],
    ) -> list[dict[str, Any]]:
        """Inject summaries at the start of messages.

        Args:
            messages: Current messages
            summaries: Summaries to inject

        Returns:
            Messages with summaries injected
        """
        if not summaries:
            return messages

        # Combine all summaries
        combined_summary = "\n\n---\n\n".join(
            f"[Conversation summary {i + 1}]\n{s.summary}" for i, s in enumerate(summaries)
        )

        summary_message = {
            "role": "system",
            "content": combined_summary,
            "is_summary": True,
        }

        # Insert after any existing system message but before conversation
        result = []
        system_added = False

        for msg in messages:
            if msg.get("role") == "system" and not msg.get("is_summary"):
                result.append(msg)
                if not system_added:
                    result.append(summary_message)
                    system_added = True
            else:
                result.append(msg)

        if not system_added:
            result.insert(0, summary_message)

        return result
