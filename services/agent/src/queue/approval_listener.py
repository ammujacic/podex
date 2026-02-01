"""Approval listener for distributed approval resolution via Redis pub/sub.

This module enables horizontal scaling of agent services by using Redis pub/sub
for approval responses instead of direct HTTP calls to specific instances.

When a tool needs approval:
1. ToolExecutor creates an asyncio.Future and registers it here
2. ToolExecutor notifies API (which notifies frontend via WebSocket)
3. User approves/rejects in frontend
4. API publishes response to Redis channel
5. This listener receives the message and resolves the matching Future
6. ToolExecutor continues execution

This pattern is similar to how control commands (abort/pause/resume) work,
but for approval-specific messages.
"""

import asyncio
import contextlib
import json
from typing import TYPE_CHECKING, Any

import structlog

if TYPE_CHECKING:
    from podex_shared.redis_client import RedisClient

logger = structlog.get_logger()


# Channel name (must match API service task_queue.py)
APPROVAL_RESPONSES_CHANNEL = "podex:approvals:responses"


class ApprovalListener:
    """Listens for approval responses via Redis pub/sub.

    This enables horizontal scaling by allowing any agent service instance
    to receive approval responses, not just the one that originally
    requested the approval.
    """

    def __init__(self, redis_client: "RedisClient") -> None:
        """Initialize approval listener.

        Args:
            redis_client: Redis client for pub/sub operations
        """
        self._redis = redis_client
        self._running = False
        self._listener_task: asyncio.Task[None] | None = None

        # Registry of pending approvals: approval_id -> asyncio.Future
        self._pending_approvals: dict[str, asyncio.Future[tuple[bool, bool]]] = {}
        # Lock for thread-safe access to _pending_approvals
        self._lock = asyncio.Lock()

    async def start(self) -> None:
        """Start the approval listener."""
        if self._running:
            return

        self._running = True
        self._listener_task = asyncio.create_task(self._run_listener())
        logger.info("Approval listener started")

    async def stop(self) -> None:
        """Stop the approval listener."""
        self._running = False
        if self._listener_task:
            self._listener_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._listener_task
        logger.info("Approval listener stopped")

    async def register_approval(
        self,
        approval_id: str,
    ) -> asyncio.Future[tuple[bool, bool]]:
        """Register a pending approval and return a Future to await.

        Args:
            approval_id: Unique approval request ID

        Returns:
            Future that will be resolved with (approved, add_to_allowlist)
        """
        future: asyncio.Future[tuple[bool, bool]] = asyncio.Future()

        async with self._lock:
            self._pending_approvals[approval_id] = future

        logger.debug("Approval registered", approval_id=approval_id)
        return future

    async def unregister_approval(self, approval_id: str) -> None:
        """Unregister a pending approval (e.g., on timeout).

        Args:
            approval_id: Approval request ID to unregister
        """
        async with self._lock:
            self._pending_approvals.pop(approval_id, None)

        logger.debug("Approval unregistered", approval_id=approval_id)

    async def _run_listener(self) -> None:
        """Main listener loop - subscribes to Redis channel and handles messages."""
        pubsub = self._redis.client.pubsub()

        try:
            await pubsub.subscribe(APPROVAL_RESPONSES_CHANNEL)
            logger.info(
                "Subscribed to approval responses channel",
                channel=APPROVAL_RESPONSES_CHANNEL,
            )

            while self._running:
                try:
                    message = await pubsub.get_message(
                        ignore_subscribe_messages=True,
                        timeout=1.0,
                    )

                    if message and message["type"] == "message":
                        await self._handle_message(message)

                except asyncio.CancelledError:
                    break
                except Exception:
                    logger.exception("Error processing approval message")
                    # Continue listening despite errors
                    await asyncio.sleep(0.1)

        finally:
            await pubsub.unsubscribe(APPROVAL_RESPONSES_CHANNEL)
            await pubsub.aclose()
            logger.info("Approval listener unsubscribed")

    async def _handle_message(self, message: dict[str, Any]) -> None:
        """Handle a received approval response message.

        Args:
            message: Redis pub/sub message with approval response data
        """
        try:
            # Parse message data
            data_str = message.get("data")
            if data_str is None:
                logger.warning("Received message without data field")
                return
            if isinstance(data_str, bytes):
                data_str = data_str.decode("utf-8")

            data = json.loads(data_str)

            approval_id = data.get("approval_id")
            approved = data.get("approved", False)
            add_to_allowlist = data.get("add_to_allowlist", False)

            if not approval_id:
                logger.warning("Received approval response without approval_id", data=data)
                return

            # Check if we have a pending approval for this ID
            async with self._lock:
                future = self._pending_approvals.pop(approval_id, None)

            if future and not future.done():
                # Resolve the Future - this unblocks the waiting ToolExecutor
                future.set_result((approved, add_to_allowlist))
                logger.info(
                    "Approval resolved via Redis",
                    approval_id=approval_id,
                    approved=approved,
                    add_to_allowlist=add_to_allowlist,
                )
            else:
                # This is normal - another instance might be handling this approval,
                # or the approval might have timed out
                logger.debug(
                    "Received approval response for unknown/completed approval",
                    approval_id=approval_id,
                )

        except json.JSONDecodeError:
            logger.warning("Failed to parse approval response message", message=message)
        except Exception:
            logger.exception("Error handling approval response")


# Global singleton
_approval_listener: ApprovalListener | None = None


def get_approval_listener() -> ApprovalListener | None:
    """Get the global approval listener instance."""
    return _approval_listener


def set_approval_listener(listener: ApprovalListener) -> None:
    """Set the global approval listener instance."""
    global _approval_listener
    _approval_listener = listener
