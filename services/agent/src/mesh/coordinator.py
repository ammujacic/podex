"""Coordinator for multi-agent task distribution and collaboration."""

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any
from uuid import uuid4

import structlog

from src.mesh.agent_bus import AgentBus, AgentEvent, EventType

if TYPE_CHECKING:
    from src.orchestrator import AgentOrchestrator

logger = structlog.get_logger()


@dataclass
class AgentInfo:
    """Information about an agent in the session."""

    agent_id: str
    role: str
    status: str = "idle"
    current_task: str | None = None
    last_activity: datetime = field(default_factory=lambda: datetime.now(UTC))
    capabilities: list[str] = field(default_factory=list)


@dataclass
class DelegateTaskParams:
    """Parameters for delegating a task to an agent."""

    session_id: str
    from_agent: str
    to_role: str
    task_description: str
    context: dict[str, Any] | None = None
    callback_event: str | None = None


@dataclass
class SharedContext:
    """Shared context across agents in a session."""

    session_id: str
    data: dict[str, Any] = field(default_factory=dict)
    contributing_agents: set[str] = field(default_factory=set)
    last_updated: datetime = field(default_factory=lambda: datetime.now(UTC))

    def update(self, agent_id: str, context: dict[str, Any]) -> None:
        """Update context with data from an agent."""
        self.data.update(context)
        self.contributing_agents.add(agent_id)
        self.last_updated = datetime.now(UTC)


class AgentCoordinator:
    """Coordinates multiple agents in a session.

    Features:
    - Track agent status and availability
    - Route tasks to appropriate agents
    - Manage shared context
    - Handle task callbacks
    """

    def __init__(
        self,
        agent_bus: AgentBus,
        orchestrator: "AgentOrchestrator | None" = None,
    ) -> None:
        """Initialize coordinator.

        Args:
            agent_bus: Agent message bus
            orchestrator: Optional orchestrator for agent management
        """
        self._bus = agent_bus
        self._orchestrator = orchestrator
        self._agents: dict[str, dict[str, AgentInfo]] = {}  # session_id -> agent_id -> info
        self._contexts: dict[str, SharedContext] = {}  # session_id -> context
        self._task_callbacks: dict[
            str,
            tuple[str, str],
        ] = {}  # event_id -> (agent_id, callback_event)

    async def register_agent(
        self,
        session_id: str,
        agent_id: str,
        role: str,
        capabilities: list[str] | None = None,
    ) -> None:
        """Register an agent in the session.

        Args:
            session_id: Session ID
            agent_id: Agent ID
            role: Agent role
            capabilities: Optional list of capabilities
        """
        if session_id not in self._agents:
            self._agents[session_id] = {}

        self._agents[session_id][agent_id] = AgentInfo(
            agent_id=agent_id,
            role=role,
            capabilities=capabilities or [],
        )

        # Subscribe to agent events
        await self._bus.subscribe_agent(session_id, agent_id, self._handle_agent_event)

        # Broadcast online status
        await self._bus.broadcast_status(session_id, agent_id, "online")

        logger.info(
            "Agent registered",
            session_id=session_id,
            agent_id=agent_id,
            role=role,
        )

    async def unregister_agent(self, session_id: str, agent_id: str) -> None:
        """Unregister an agent from the session.

        Args:
            session_id: Session ID
            agent_id: Agent ID
        """
        if session_id in self._agents and agent_id in self._agents[session_id]:
            del self._agents[session_id][agent_id]

        await self._bus.unsubscribe_agent(session_id, agent_id)
        await self._bus.broadcast_status(session_id, agent_id, "offline")

        logger.info("Agent unregistered", session_id=session_id, agent_id=agent_id)

    def get_session_agents(self, session_id: str) -> list[AgentInfo]:
        """Get all agents in a session.

        Args:
            session_id: Session ID

        Returns:
            List of agent info
        """
        return list(self._agents.get(session_id, {}).values())

    def get_available_agent(
        self,
        session_id: str,
        role: str,
    ) -> AgentInfo | None:
        """Get an available agent of a specific role.

        Args:
            session_id: Session ID
            role: Required role

        Returns:
            Available agent info or None
        """
        agents = self._agents.get(session_id, {})

        for agent in agents.values():
            if agent.role == role and agent.status == "idle":
                return agent

        return None

    async def delegate_task(self, params: DelegateTaskParams) -> str | None:
        """Delegate a task to an agent of a specific role.

        Args:
            params: Task delegation parameters

        Returns:
            Event ID if delegated, None otherwise
        """
        # Find available agent
        agent = self.get_available_agent(params.session_id, params.to_role)

        if not agent:
            logger.warning(
                "No available agent for role",
                session_id=params.session_id,
                role=params.to_role,
            )
            return None

        # Create task request event
        event = AgentEvent(
            id=str(uuid4()),
            event_type=EventType.TASK_REQUEST,
            session_id=params.session_id,
            from_agent=params.from_agent,
            to_agent=agent.agent_id,
            payload={
                "task": params.task_description,
                "context": params.context or {},
            },
        )

        # Register callback
        if params.callback_event:
            self._task_callbacks[event.id] = (params.from_agent, params.callback_event)

        # Update agent status
        agent.status = "busy"
        agent.current_task = params.task_description[:100]
        agent.last_activity = datetime.now(UTC)

        # Publish event
        await self._bus.publish(event)

        logger.info(
            "Task delegated",
            event_id=event.id,
            from_agent=params.from_agent,
            to_agent=agent.agent_id,
            role=params.to_role,
        )

        return event.id

    async def complete_task(
        self,
        session_id: str,
        agent_id: str,
        event_id: str,
        result: dict[str, Any],
    ) -> None:
        """Mark a task as completed.

        Args:
            session_id: Session ID
            agent_id: Agent that completed the task
            event_id: Original task request event ID
            result: Task result
        """
        # Update agent status
        if session_id in self._agents and agent_id in self._agents[session_id]:
            agent = self._agents[session_id][agent_id]
            agent.status = "idle"
            agent.current_task = None
            agent.last_activity = datetime.now(UTC)

        # Get original event
        event_key = AgentBus.EVENT_KEY.format(event_id=event_id)
        event_data = await self._bus._redis.get_json(event_key)

        if event_data and isinstance(event_data, dict):
            original_event = AgentEvent.from_dict(event_data)

            # Send completion reply
            await self._bus.reply_to_event(
                original_event,
                agent_id,
                EventType.TASK_COMPLETED,
                {"result": result},
            )

        # Trigger callback if registered (pop with default avoids concurrent KeyError)
        callback_data = self._task_callbacks.pop(event_id, None)
        if callback_data:
            from_agent, callback_event = callback_data
            await self._bus.send_message(
                session_id,
                agent_id,
                from_agent,
                f"Task completed: {callback_event}",
                EventType.MESSAGE,
            )

        logger.info(
            "Task completed",
            session_id=session_id,
            agent_id=agent_id,
            event_id=event_id,
        )

    async def fail_task(
        self,
        session_id: str,
        agent_id: str,
        event_id: str,
        error: str,
    ) -> None:
        """Mark a task as failed.

        Args:
            session_id: Session ID
            agent_id: Agent that failed
            event_id: Original task request event ID
            error: Error message
        """
        # Update agent status
        if session_id in self._agents and agent_id in self._agents[session_id]:
            agent = self._agents[session_id][agent_id]
            agent.status = "idle"
            agent.current_task = None

        # Get original event
        event_key = AgentBus.EVENT_KEY.format(event_id=event_id)
        event_data = await self._bus._redis.get_json(event_key)

        if event_data and isinstance(event_data, dict):
            original_event = AgentEvent.from_dict(event_data)

            # Send failure reply
            await self._bus.reply_to_event(
                original_event,
                agent_id,
                EventType.TASK_FAILED,
                {"error": error},
            )

        logger.error(
            "Task failed",
            session_id=session_id,
            agent_id=agent_id,
            event_id=event_id,
            error=error,
        )

    def get_shared_context(self, session_id: str) -> SharedContext:
        """Get shared context for a session.

        Args:
            session_id: Session ID

        Returns:
            Shared context
        """
        if session_id not in self._contexts:
            self._contexts[session_id] = SharedContext(session_id=session_id)
        return self._contexts[session_id]

    async def update_shared_context(
        self,
        session_id: str,
        agent_id: str,
        context: dict[str, Any],
    ) -> None:
        """Update shared context.

        Args:
            session_id: Session ID
            agent_id: Agent updating context
            context: Context data
        """
        shared = self.get_shared_context(session_id)
        shared.update(agent_id, context)

        # Broadcast update
        await self._bus.share_context(session_id, agent_id, context)

        logger.debug(
            "Shared context updated",
            session_id=session_id,
            agent_id=agent_id,
        )

    async def _handle_agent_event(self, event: AgentEvent) -> None:
        """Handle agent events for coordination.

        Args:
            event: Agent event
        """
        if event.event_type == EventType.TASK_COMPLETED:
            # Task completed - trigger callback if one was registered
            # The payload should contain: event_id, result
            event_id = event.payload.get("event_id")
            callback_data = self._task_callbacks.pop(event_id, None) if event_id else None
            if callback_data:
                from_agent, callback_event = callback_data
                result = event.payload.get("result", {})
                await self._bus.send_message(
                    event.session_id,
                    event.from_agent,
                    from_agent,
                    f"Task completed: {callback_event}. Result: {result}",
                    EventType.MESSAGE,
                )
                logger.info(
                    "Task callback triggered",
                    session_id=event.session_id,
                    event_id=event_id,
                    callback_event=callback_event,
                )

        elif event.event_type == EventType.TASK_FAILED:
            # Task failed - trigger callback with error and cleanup
            event_id = event.payload.get("event_id")
            error = event.payload.get("error", "Unknown error")

            # Update agent status to idle
            session_agents = self._agents.get(event.session_id, {})
            if event.from_agent in session_agents:
                agent = session_agents[event.from_agent]
                agent.status = "idle"
                agent.current_task = None

            # Trigger failure callback if registered (use pop with default to avoid KeyError)
            callback_data = self._task_callbacks.pop(event_id, None) if event_id else None
            if callback_data:
                from_agent, callback_event = callback_data
                await self._bus.send_message(
                    event.session_id,
                    event.from_agent,
                    from_agent,
                    f"Task failed: {callback_event}. Error: {error}",
                    EventType.MESSAGE,
                )
                logger.warning(
                    "Task failure callback triggered",
                    session_id=event.session_id,
                    event_id=event_id,
                    callback_event=callback_event,
                    error=error,
                )

        elif event.event_type == EventType.CONTEXT_UPDATE:
            # Update local shared context
            shared = self.get_shared_context(event.session_id)
            shared.update(event.from_agent, event.payload.get("context", {}))

        elif (
            event.event_type in (EventType.AGENT_BUSY, EventType.AGENT_IDLE)
            and event.session_id in self._agents
        ):
            # Update agent status
            status_agent = self._agents[event.session_id].get(event.from_agent)
            if status_agent:
                status_agent.status = event.payload.get("status", "idle")
                status_agent.current_task = event.payload.get("current_task")
                status_agent.last_activity = datetime.now(UTC)
