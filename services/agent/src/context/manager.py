"""Context window manager for intelligent context handling."""

from typing import TYPE_CHECKING, Any

import structlog

from src.config import get_context_limits
from src.context.summarizer import ConversationSummarizer, ConversationSummary
from src.context.tokenizer import Tokenizer

if TYPE_CHECKING:
    from src.providers.llm import LLMProvider

logger = structlog.get_logger()


def format_browser_context(browser_context: dict[str, Any]) -> str:
    """Format browser context data as structured markdown for LLM consumption.

    Takes browser context captured from the frontend (console logs, network requests,
    errors, HTML snapshot, etc.) and formats it into readable markdown that helps
    the agent understand the current browser state for debugging assistance.

    Args:
        browser_context: Dictionary containing browser state data:
            - url: Current page URL
            - timestamp: When context was captured
            - consoleLogs: List of console entries with level, message, timestamp
            - networkRequests: List of network requests with method, url, status
            - errors: List of JavaScript errors with message, stack
            - htmlSnapshot: Optional HTML content (may be truncated)
            - metadata: Browser metadata (userAgent, viewportSize)

    Returns:
        Formatted markdown string representing the browser context
    """
    if not browser_context:
        return ""

    sections = []

    # Page info header
    url = browser_context.get("url", "Unknown")
    timestamp = browser_context.get("timestamp", "")
    title = browser_context.get("title", "")

    page_header = f"## Browser Context\n**URL**: {url}"
    if title:
        page_header += f"\n**Title**: {title}"
    if timestamp:
        page_header += f"\n**Captured**: {timestamp}"

    sections.append(page_header)

    # Metadata
    metadata = browser_context.get("metadata", {})
    if metadata:
        meta_parts = []
        if metadata.get("userAgent"):
            # Shorten user agent for brevity
            ua = metadata["userAgent"]
            if len(ua) > 100:
                ua = ua[:100] + "..."
            meta_parts.append(f"User-Agent: {ua}")
        if metadata.get("viewportSize"):
            vp = metadata["viewportSize"]
            meta_parts.append(f"Viewport: {vp.get('width', '?')}x{vp.get('height', '?')}")
        if meta_parts:
            sections.append("**Metadata**: " + " | ".join(meta_parts))

    # JavaScript errors (highest priority)
    errors = browser_context.get("errors", [])
    if errors:
        error_section = ["### JavaScript Errors"]
        for err in errors[:10]:  # Limit to 10 errors
            error_type = err.get("type", "Error")
            message = err.get("message", "Unknown error")
            timestamp = err.get("timestamp", "")
            stack = err.get("stack", "")

            error_entry = f"**[{error_type}]** {message}"
            if timestamp:
                error_entry += f" _(at {timestamp})_"
            error_section.append(error_entry)

            if stack:
                # Truncate long stack traces
                stack_lines = stack.split("\n")[:5]
                truncated_stack = "\n".join(stack_lines)
                if len(stack.split("\n")) > 5:
                    truncated_stack += "\n... (truncated)"
                error_section.append(f"```\n{truncated_stack}\n```")

        sections.append("\n".join(error_section))

    # Console output (filtered to show most relevant)
    console_logs = browser_context.get("consoleLogs", [])
    if console_logs:
        # Separate by level for organized display
        errors_logs = [log for log in console_logs if log.get("level") == "error"]
        warn_logs = [log for log in console_logs if log.get("level") == "warn"]
        other_logs = [log for log in console_logs if log.get("level") not in ("error", "warn")]

        console_section = ["### Console Output"]

        # Show errors first
        if errors_logs:
            console_section.append("**Errors:**")
            for log in errors_logs[:10]:
                msg = log.get("message", "")[:200]  # Truncate long messages
                console_section.append(f"- `[ERROR]` {msg}")

        # Then warnings
        if warn_logs:
            console_section.append("**Warnings:**")
            for log in warn_logs[:10]:
                msg = log.get("message", "")[:200]
                console_section.append(f"- `[WARN]` {msg}")

        # Then other logs (limited)
        if other_logs:
            console_section.append("**Logs:**")
            for log in other_logs[:15]:
                level = log.get("level", "log").upper()
                msg = log.get("message", "")[:200]
                console_section.append(f"- `[{level}]` {msg}")

        if len(console_section) > 1:  # Only add if we have actual content
            sections.append("\n".join(console_section))

    # Network requests (focus on failed requests)
    network_requests = browser_context.get("networkRequests", [])
    if network_requests:
        # Separate failed and successful requests
        failed_requests = [
            req for req in network_requests if (req.get("status", 0) >= 400 or req.get("error"))
        ]
        successful_requests = [
            req
            for req in network_requests
            if req.get("status", 0) > 0 and req.get("status", 0) < 400 and not req.get("error")
        ]

        network_section = ["### Network Requests"]

        if failed_requests:
            network_section.append("**Failed Requests:**")
            for req in failed_requests[:10]:
                method = req.get("method", "GET")
                url = req.get("url", "")
                # Truncate long URLs
                if len(url) > 80:
                    url = url[:77] + "..."
                status = req.get("status", 0)
                status_text = req.get("statusText", "")
                error = req.get("error", "")
                duration = req.get("duration")

                entry = f"- `{method} {url}` → **{status}**"
                if status_text:
                    entry += f" {status_text}"
                if error:
                    entry += f" ({error})"
                if duration:
                    entry += f" [{duration}ms]"
                network_section.append(entry)

        if successful_requests:
            network_section.append(
                f"**Successful Requests:** {len(successful_requests)} requests completed"
            )
            # Show summary of request types
            by_type: dict[str, int] = {}
            for req in successful_requests:
                req_type = req.get("type", "other")
                by_type[req_type] = by_type.get(req_type, 0) + 1
            type_summary = ", ".join(f"{count} {t}" for t, count in sorted(by_type.items()))
            if type_summary:
                network_section.append(f"  Types: {type_summary}")

        if len(network_section) > 1:
            sections.append("\n".join(network_section))

    # HTML snapshot (truncated, at the end as it's large)
    html_snapshot = browser_context.get("htmlSnapshot")
    if html_snapshot:
        # Already truncated on frontend, but double-check
        max_html_size = 30000
        if len(html_snapshot) > max_html_size:
            html_snapshot = html_snapshot[:max_html_size] + "\n<!-- truncated -->"

        html_section = ["### HTML Snapshot", "```html", html_snapshot, "```"]
        sections.append("\n".join(html_section))

    return "\n\n".join(sections)


# Safety buffer for token calculations
DEFAULT_BUFFER = 2000


class ContextWindowManager:
    """Manages context window for agents.

    Handles:
    - Token counting and budget management
    - Automatic summarization when context grows too large
    - Injection of relevant memories/context
    - Subagent context isolation

    Note: This class requires settings to be loaded from Redis cache.
    Use create_context_manager_with_settings() factory to create instances.
    """

    def __init__(
        self,
        llm_provider: "LLMProvider",
        model: str | None = None,
        max_context_tokens: int | None = None,
        output_reservation: int | None = None,
    ) -> None:
        """Initialize context manager.

        Args:
            llm_provider: LLM provider for summarization
            model: Model name for context limits
            max_context_tokens: Max context tokens (required - from settings)
            output_reservation: Output token reservation (required - from settings)

        Raises:
            ValueError: If max_context_tokens or output_reservation not provided
        """
        if max_context_tokens is None:
            raise ValueError(
                "max_context_tokens is required - use create_context_manager_with_settings()"
            )
        if output_reservation is None:
            raise ValueError(
                "output_reservation is required - use create_context_manager_with_settings()"
            )

        if not model:
            msg = "model is required - use create_context_manager_with_settings()"
            raise ValueError(msg)

        self._llm = llm_provider
        self._tokenizer = Tokenizer(model)
        self._summarizer = ConversationSummarizer(llm_provider, model)

        # Set context limits (values are required)
        self._max_tokens = max_context_tokens
        self._output_reservation = output_reservation
        self._buffer = DEFAULT_BUFFER

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


async def create_context_manager_with_settings(
    llm_provider: "LLMProvider",
    model: str | None = None,
) -> ContextWindowManager:
    """Create a ContextWindowManager with settings loaded from Redis cache.

    This factory function fetches context limits from the platform settings
    cache and creates a properly configured ContextWindowManager.

    Args:
        llm_provider: LLM provider for summarization
        model: Model name for context limits

    Returns:
        Configured ContextWindowManager instance

    Raises:
        SettingsNotAvailableError: If settings are not available in Redis cache
    """
    limits = await get_context_limits()
    return ContextWindowManager(
        llm_provider=llm_provider,
        model=model,
        max_context_tokens=limits["max_tokens"],
        output_reservation=limits["output_reservation"],
    )
