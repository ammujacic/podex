"""Context window manager for intelligent context handling."""

from typing import TYPE_CHECKING, Any

import structlog

from src.context.summarizer import ConversationSummarizer, ConversationSummary
from src.context.tokenizer import Tokenizer

if TYPE_CHECKING:
    from src.providers.llm import LLMProvider

logger = structlog.get_logger()


class ContextWindowManager:
    """Manages context window for agents.

    Handles:
    - Token counting and budget management
    - Automatic summarization when context grows too large
    - Injection of relevant memories/context
    - Subagent context isolation
    """

    # Default configuration
    DEFAULT_MAX_CONTEXT_TOKENS = 100000
    DEFAULT_OUTPUT_RESERVATION = 4096
    DEFAULT_BUFFER = 2000  # Safety buffer

    def __init__(
        self,
        llm_provider: "LLMProvider",
        model: str | None = None,
        max_context_tokens: int | None = None,
    ) -> None:
        """Initialize context manager.

        Args:
            llm_provider: LLM provider for summarization
            model: Model name for context limits
            max_context_tokens: Override for max context tokens
        """
        self._llm = llm_provider
        self._tokenizer = Tokenizer(model)
        self._summarizer = ConversationSummarizer(llm_provider)

        # Set context limits
        if max_context_tokens:
            self._max_tokens = max_context_tokens
        else:
            self._max_tokens = self._tokenizer.context_limit

        self._output_reservation = self.DEFAULT_OUTPUT_RESERVATION
        self._buffer = self.DEFAULT_BUFFER

        # Cache for summaries
        self._summaries: dict[str, list[ConversationSummary]] = {}

        # Token usage tracking
        self._total_input_tokens = 0
        self._total_output_tokens = 0

    @property
    def available_tokens(self) -> int:
        """Get available tokens for input context."""
        return self._max_tokens - self._output_reservation - self._buffer

    def get_token_usage(self) -> dict[str, int]:
        """Get cumulative token usage statistics."""
        return {
            "total_input_tokens": self._total_input_tokens,
            "total_output_tokens": self._total_output_tokens,
            "total_tokens": self._total_input_tokens + self._total_output_tokens,
        }

    def track_usage(self, input_tokens: int, output_tokens: int) -> None:
        """Track token usage from a completion.

        Args:
            input_tokens: Input tokens used
            output_tokens: Output tokens generated
        """
        self._total_input_tokens += input_tokens
        self._total_output_tokens += output_tokens

    async def prepare_context(
        self,
        agent_id: str,
        messages: list[dict[str, Any]],
        system_prompt: str,
        additional_context: str | None = None,
    ) -> tuple[list[dict[str, Any]], int]:
        """Prepare messages to fit within context window.

        Args:
            agent_id: Agent ID for the conversation
            messages: Conversation messages
            system_prompt: System prompt
            additional_context: Optional additional context to inject

        Returns:
            Tuple of (prepared messages, total token count)
        """
        # Calculate token budgets
        system_tokens = self._tokenizer.count(system_prompt)
        additional_tokens = self._tokenizer.count(additional_context) if additional_context else 0
        messages_budget = self.available_tokens - system_tokens - additional_tokens

        # Get existing summaries for this agent
        summaries = self._summaries.get(agent_id, [])

        # Check if we need to summarize
        messages_tokens = self._tokenizer.count_messages(messages)

        if messages_tokens > messages_budget:
            # Try summarization first
            messages, new_summary = await self._summarizer.summarize_if_needed(
                agent_id=agent_id,
                messages=messages,
                keep_recent=15,
            )

            if new_summary:
                if agent_id not in self._summaries:
                    self._summaries[agent_id] = []
                self._summaries[agent_id].append(new_summary)

            # Recalculate tokens
            messages_tokens = self._tokenizer.count_messages(messages)

        # If still too large, trim
        if messages_tokens > messages_budget:
            messages = self._tokenizer.trim_to_fit(
                messages=messages,
                system_prompt=system_prompt,
                buffer=self._buffer + additional_tokens,
                keep_recent=10,
            )
            messages_tokens = self._tokenizer.count_messages(messages)

        # Inject any existing summaries if not already included
        if summaries and not any(msg.get("is_summary") for msg in messages):
            messages = self._summarizer.inject_summaries_into_context(messages, summaries)
            messages_tokens = self._tokenizer.count_messages(messages)

        total_tokens = system_tokens + messages_tokens + additional_tokens

        logger.debug(
            "Context prepared",
            agent_id=agent_id,
            system_tokens=system_tokens,
            messages_tokens=messages_tokens,
            additional_tokens=additional_tokens,
            total_tokens=total_tokens,
            available=self.available_tokens,
        )

        return messages, total_tokens

    def estimate_context_size(
        self,
        messages: list[dict[str, Any]],
        system_prompt: str,
    ) -> dict[str, Any]:
        """Estimate context size without modifying messages.

        Args:
            messages: Conversation messages
            system_prompt: System prompt

        Returns:
            Dictionary with token counts and fit status
        """
        system_tokens = self._tokenizer.count(system_prompt)
        messages_tokens = self._tokenizer.count_messages(messages)
        total_tokens = system_tokens + messages_tokens

        return {
            "system_tokens": system_tokens,
            "messages_tokens": messages_tokens,
            "total_tokens": total_tokens,
            "available_tokens": self.available_tokens,
            "fits_in_context": total_tokens <= self.available_tokens,
            "overflow_tokens": max(0, total_tokens - self.available_tokens),
        }

    def create_subagent_context(
        self,
        parent_messages: list[dict[str, Any]],
        task_description: str,
        max_context_messages: int = 5,
    ) -> list[dict[str, Any]]:
        """Create isolated context for a subagent.

        Subagents get a fresh context with just the task and
        minimal parent context to prevent context pollution.

        Args:
            parent_messages: Parent conversation messages
            task_description: Task for the subagent
            max_context_messages: Max messages from parent to include

        Returns:
            Subagent context messages
        """
        # Extract relevant context from parent
        relevant_context = []

        if parent_messages:
            # Include most recent messages for context
            recent = parent_messages[-max_context_messages:]
            context_summary = "\n".join(
                f"- {msg.get('role', 'unknown')}: {msg.get('content', '')[:200]}..."
                for msg in recent
            )
            relevant_context.append(
                {
                    "role": "system",
                    "content": f"[Parent conversation context]\n{context_summary}",
                },
            )

        # Add the task
        relevant_context.append(
            {
                "role": "user",
                "content": task_description,
            },
        )

        return relevant_context

    def clear_summaries(self, agent_id: str) -> None:
        """Clear cached summaries for an agent.

        Args:
            agent_id: Agent ID to clear summaries for
        """
        if agent_id in self._summaries:
            del self._summaries[agent_id]
            logger.debug("Cleared summaries", agent_id=agent_id)

    def get_summaries(self, agent_id: str) -> list[ConversationSummary]:
        """Get cached summaries for an agent.

        Args:
            agent_id: Agent ID

        Returns:
            List of conversation summaries
        """
        return self._summaries.get(agent_id, [])


class ContextManagerHolder:
    """Singleton holder for the global context manager instance."""

    _instance: ContextWindowManager | None = None

    @classmethod
    def get(cls) -> ContextWindowManager | None:
        """Get the global context manager instance."""
        return cls._instance

    @classmethod
    def set(cls, manager: ContextWindowManager) -> None:
        """Set the global context manager instance."""
        cls._instance = manager


def get_context_manager() -> ContextWindowManager | None:
    """Get the global context manager instance."""
    return ContextManagerHolder.get()


def set_context_manager(manager: ContextWindowManager) -> None:
    """Set the global context manager instance."""
    ContextManagerHolder.set(manager)
