"""Event-driven message bus for agent communication."""

import asyncio
from collections.abc import Callable, Coroutine
from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import Enum
from typing import Any
from uuid import uuid4

import structlog

from podex_shared.redis_client import RedisClient

logger = structlog.get_logger()


class EventType(str, Enum):
    """Types of events in the agent mesh."""

    # Task events
    TASK_REQUEST = "task_request"
    TASK_ACCEPTED = "task_accepted"
    TASK_COMPLETED = "task_completed"
    TASK_FAILED = "task_failed"

    # Agent status
    AGENT_ONLINE = "agent_online"
    AGENT_OFFLINE = "agent_offline"
    AGENT_BUSY = "agent_busy"
    AGENT_IDLE = "agent_idle"

    # Communication
    MESSAGE = "message"
    QUESTION = "question"
    ANSWER = "answer"
    BROADCAST = "broadcast"

    # Context sharing
    CONTEXT_UPDATE = "context_update"
    CONTEXT_REQUEST = "context_request"


@dataclass
class TaskRequestParams:
    """Parameters for requesting a task from another agent."""

    session_id: str
    from_agent: str
    to_agent_role: str
    task_description: str
    context: dict[str, Any] | None = None
    timeout: float = 300.0


@dataclass
class AgentEvent:
    """An event in the agent mesh."""

    id: str
    event_type: EventType
    session_id: str
    from_agent: str
    to_agent: str | None  # None for broadcasts
    payload: dict[str, Any]
    timestamp: datetime = field(default_factory=lambda: datetime.now(UTC))
    reply_to: str | None = None  # ID of event being replied to
    ttl: int = 3600  # Time to live in seconds

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary."""
        return {
            "id": self.id,
            "event_type": self.event_type.value,
            "session_id": self.session_id,
            "from_agent": self.from_agent,
            "to_agent": self.to_agent,
            "payload": self.payload,
            "timestamp": self.timestamp.isoformat(),
            "reply_to": self.reply_to,
            "ttl": self.ttl,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "AgentEvent":
        """Create from dictionary."""
        return cls(
            id=data["id"],
            event_type=EventType(data["event_type"]),
            session_id=data["session_id"],
            from_agent=data["from_agent"],
            to_agent=data.get("to_agent"),
            payload=data.get("payload", {}),
            timestamp=datetime.fromisoformat(data["timestamp"])
            if data.get("timestamp")
            else datetime.now(UTC),
            reply_to=data.get("reply_to"),
            ttl=data.get("ttl", 3600),
        )


EventHandler = Callable[[AgentEvent], Coroutine[Any, Any, None]]


class AgentBus:
    """Event-driven message bus for agent communication.

    Features:
    - Pub/sub messaging between agents
    - Direct messaging to specific agents
    - Broadcast to all agents in session
    - Request/response pattern support
    - Event persistence for reliability

    Redis channels:
        podex:mesh:{session_id}:events  - Session-wide event stream
        podex:mesh:{session_id}:agent:{agent_id}  - Direct agent messages
    """

    SESSION_CHANNEL = "podex:mesh:{session_id}:events"
    AGENT_CHANNEL = "podex:mesh:{session_id}:agent:{agent_id}"
    EVENT_KEY = "podex:mesh:event:{event_id}"
    PENDING_REPLIES_KEY = "podex:mesh:{session_id}:pending:{event_id}"

    EVENT_TTL = 3600  # 1 hour

    def __init__(self, redis_client: RedisClient) -> None:
        """Initialize agent bus.

        Args:
            redis_client: Redis client instance
        """
        self._redis = redis_client
        self._handlers: dict[str, list[EventHandler]] = {}
        self._agent_handlers: dict[str, EventHandler] = {}
        self._pending_replies: dict[str, asyncio.Future[AgentEvent]] = {}
        self._subscribed_sessions: set[str] = set()
        self._subscribed_agents: set[tuple[str, str]] = set()  # (session_id, agent_id)

    async def subscribe_session(
        self,
        session_id: str,
        handler: EventHandler,
    ) -> None:
        """Subscribe to all events in a session.

        Args:
            session_id: Session ID to subscribe to
            handler: Event handler callback
        """
        if session_id not in self._handlers:
            self._handlers[session_id] = []
        self._handlers[session_id].append(handler)

        if session_id not in self._subscribed_sessions:
            channel = self.SESSION_CHANNEL.format(session_id=session_id)
            await self._redis.subscribe(channel, self._handle_session_event)
            self._subscribed_sessions.add(session_id)

        logger.debug("Subscribed to session", session_id=session_id)

    async def subscribe_agent(
        self,
        session_id: str,
        agent_id: str,
        handler: EventHandler,
    ) -> None:
        """Subscribe to direct messages for an agent.

        Args:
            session_id: Session ID
            agent_id: Agent ID
            handler: Event handler callback
        """
        key = f"{session_id}:{agent_id}"
        self._agent_handlers[key] = handler

        sub_key = (session_id, agent_id)
        if sub_key not in self._subscribed_agents:
            channel = self.AGENT_CHANNEL.format(session_id=session_id, agent_id=agent_id)
            await self._redis.subscribe(channel, self._handle_agent_event)
            self._subscribed_agents.add(sub_key)

        logger.debug("Agent subscribed", session_id=session_id, agent_id=agent_id)

    async def unsubscribe_session(self, session_id: str) -> None:
        """Unsubscribe from a session.

        Args:
            session_id: Session ID to unsubscribe from
        """
        if session_id in self._handlers:
            del self._handlers[session_id]

        if session_id in self._subscribed_sessions:
            channel = self.SESSION_CHANNEL.format(session_id=session_id)
            await self._redis.unsubscribe(channel)
            self._subscribed_sessions.discard(session_id)

    async def unsubscribe_agent(self, session_id: str, agent_id: str) -> None:
        """Unsubscribe an agent.

        Args:
            session_id: Session ID
            agent_id: Agent ID
        """
        key = f"{session_id}:{agent_id}"
        if key in self._agent_handlers:
            del self._agent_handlers[key]

        sub_key = (session_id, agent_id)
        if sub_key in self._subscribed_agents:
            channel = self.AGENT_CHANNEL.format(session_id=session_id, agent_id=agent_id)
            await self._redis.unsubscribe(channel)
            self._subscribed_agents.discard(sub_key)

    async def publish(self, event: AgentEvent) -> str:
        """Publish an event.

        Args:
            event: Event to publish

        Returns:
            Event ID
        """
        # Store event
        event_key = self.EVENT_KEY.format(event_id=event.id)
        await self._redis.set_json(event_key, event.to_dict(), ex=event.ttl)

        # Publish to appropriate channel
        if event.to_agent:
            # Direct message
            channel = self.AGENT_CHANNEL.format(
                session_id=event.session_id,
                agent_id=event.to_agent,
            )
        else:
            # Broadcast to session
            channel = self.SESSION_CHANNEL.format(session_id=event.session_id)

        await self._redis.publish(channel, event.to_dict())

        logger.debug(
            "Event published",
            event_id=event.id,
            event_type=event.event_type.value,
            from_agent=event.from_agent,
            to_agent=event.to_agent,
        )

        return event.id

    async def send_message(
        self,
        session_id: str,
        from_agent: str,
        to_agent: str | None,
        message: str,
        event_type: EventType = EventType.MESSAGE,
    ) -> str:
        """Send a message to another agent or broadcast.

        Args:
            session_id: Session ID
            from_agent: Sending agent ID
            to_agent: Target agent ID (None for broadcast)
            message: Message content
            event_type: Event type

        Returns:
            Event ID
        """
        event = AgentEvent(
            id=str(uuid4()),
            event_type=event_type,
            session_id=session_id,
            from_agent=from_agent,
            to_agent=to_agent,
            payload={"message": message},
        )

        return await self.publish(event)

    async def request_task(self, params: TaskRequestParams) -> AgentEvent | None:
        """Request a task from another agent and wait for completion.

        Args:
            params: Task request parameters

        Returns:
            Task completion event or None if timed out
        """
        event = AgentEvent(
            id=str(uuid4()),
            event_type=EventType.TASK_REQUEST,
            session_id=params.session_id,
            from_agent=params.from_agent,
            to_agent=None,  # Will be picked up by appropriate agent
            payload={
                "task": params.task_description,
                "target_role": params.to_agent_role,
                "context": params.context or {},
            },
        )

        # Create future for reply
        future: asyncio.Future[AgentEvent] = asyncio.Future()
        self._pending_replies[event.id] = future

        # Store pending reply info
        pending_key = self.PENDING_REPLIES_KEY.format(
            session_id=params.session_id, event_id=event.id
        )
        await self._redis.set_json(
            pending_key,
            {
                "from_agent": params.from_agent,
                "target_role": params.to_agent_role,
            },
            ex=int(params.timeout) + 60,
        )

        # Publish request
        await self.publish(event)

        # Wait for reply
        try:
            reply = await asyncio.wait_for(future, timeout=params.timeout)
            return reply
        except TimeoutError:
            logger.warning(
                "Task request timed out",
                event_id=event.id,
                from_agent=params.from_agent,
            )
            return None
        finally:
            self._pending_replies.pop(event.id, None)
            await self._redis.delete(pending_key)

    async def reply_to_event(
        self,
        original_event: AgentEvent,
        from_agent: str,
        event_type: EventType,
        payload: dict[str, Any],
    ) -> str:
        """Reply to an event.

        Args:
            original_event: Event being replied to
            from_agent: Agent sending reply
            event_type: Reply event type
            payload: Reply payload

        Returns:
            Reply event ID
        """
        reply = AgentEvent(
            id=str(uuid4()),
            event_type=event_type,
            session_id=original_event.session_id,
            from_agent=from_agent,
            to_agent=original_event.from_agent,
            payload=payload,
            reply_to=original_event.id,
        )

        return await self.publish(reply)

    async def broadcast_status(
        self,
        session_id: str,
        agent_id: str,
        status: str,
        current_task: str | None = None,
    ) -> str:
        """Broadcast agent status to the session.

        Args:
            session_id: Session ID
            agent_id: Agent ID
            status: Status string
            current_task: Optional current task

        Returns:
            Event ID
        """
        event_type = {
            "online": EventType.AGENT_ONLINE,
            "offline": EventType.AGENT_OFFLINE,
            "busy": EventType.AGENT_BUSY,
            "idle": EventType.AGENT_IDLE,
        }.get(status, EventType.BROADCAST)

        event = AgentEvent(
            id=str(uuid4()),
            event_type=event_type,
            session_id=session_id,
            from_agent=agent_id,
            to_agent=None,
            payload={
                "status": status,
                "current_task": current_task,
            },
        )

        return await self.publish(event)

    async def share_context(
        self,
        session_id: str,
        from_agent: str,
        context: dict[str, Any],
    ) -> str:
        """Share context with other agents in the session.

        Args:
            session_id: Session ID
            from_agent: Agent sharing context
            context: Context data to share

        Returns:
            Event ID
        """
        event = AgentEvent(
            id=str(uuid4()),
            event_type=EventType.CONTEXT_UPDATE,
            session_id=session_id,
            from_agent=from_agent,
            to_agent=None,
            payload={"context": context},
        )

        return await self.publish(event)

    async def _handle_session_event(self, data: dict[str, Any]) -> None:
        """Handle a session event from Redis."""
        try:
            event = AgentEvent.from_dict(data)
            session_id = event.session_id

            # Check for pending reply
            if event.reply_to and event.reply_to in self._pending_replies:
                future = self._pending_replies[event.reply_to]
                if not future.done():
                    future.set_result(event)

            # Call session handlers
            handlers = self._handlers.get(session_id, [])
            for handler in handlers:
                try:
                    await handler(event)
                except Exception as e:
                    logger.error("Session handler error", error=str(e))

        except Exception as e:
            logger.error("Failed to handle session event", error=str(e))

    async def _handle_agent_event(self, data: dict[str, Any]) -> None:
        """Handle a direct agent event from Redis."""
        try:
            event = AgentEvent.from_dict(data)

            # Check for pending reply
            if event.reply_to and event.reply_to in self._pending_replies:
                future = self._pending_replies[event.reply_to]
                if not future.done():
                    future.set_result(event)

            # Call agent handler
            key = f"{event.session_id}:{event.to_agent}"
            handler = self._agent_handlers.get(key)
            if handler:
                try:
                    await handler(event)
                except Exception as e:
                    logger.error("Agent handler error", error=str(e))

        except Exception as e:
            logger.error("Failed to handle agent event", error=str(e))
