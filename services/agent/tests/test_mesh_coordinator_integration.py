"""Integration tests for mesh coordinator."""

import pytest
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

from src.mesh.coordinator import (
    AgentCoordinator,
    AgentInfo,
    DelegateTaskParams,
    SharedContext,
)
from src.mesh.agent_bus import AgentBus, AgentEvent, EventType


class TestAgentInfo:
    """Tests for AgentInfo dataclass."""

    def test_agent_info_defaults(self) -> None:
        """Test AgentInfo default values."""
        info = AgentInfo(agent_id="agent-1", role="coder")

        assert info.agent_id == "agent-1"
        assert info.role == "coder"
        assert info.status == "idle"
        assert info.current_task is None
        assert info.capabilities == []
        assert info.last_activity is not None

    def test_agent_info_custom_values(self) -> None:
        """Test AgentInfo with custom values."""
        info = AgentInfo(
            agent_id="agent-2",
            role="reviewer",
            status="busy",
            current_task="Reviewing code",
            capabilities=["python", "javascript"],
        )

        assert info.status == "busy"
        assert info.current_task == "Reviewing code"
        assert "python" in info.capabilities


class TestDelegateTaskParams:
    """Tests for DelegateTaskParams dataclass."""

    def test_delegate_task_params_minimal(self) -> None:
        """Test DelegateTaskParams with minimal values."""
        params = DelegateTaskParams(
            session_id="session-1",
            from_agent="agent-1",
            to_role="coder",
            task_description="Write some code",
        )

        assert params.session_id == "session-1"
        assert params.context is None
        assert params.callback_event is None

    def test_delegate_task_params_full(self) -> None:
        """Test DelegateTaskParams with all values."""
        params = DelegateTaskParams(
            session_id="session-1",
            from_agent="agent-1",
            to_role="coder",
            task_description="Write some code",
            context={"priority": "high"},
            callback_event="task_completed",
        )

        assert params.context == {"priority": "high"}
        assert params.callback_event == "task_completed"


class TestSharedContext:
    """Tests for SharedContext dataclass."""

    def test_shared_context_defaults(self) -> None:
        """Test SharedContext default values."""
        ctx = SharedContext(session_id="session-1")

        assert ctx.session_id == "session-1"
        assert ctx.data == {}
        assert ctx.contributing_agents == set()
        assert ctx.last_updated is not None

    def test_shared_context_update(self) -> None:
        """Test SharedContext update method."""
        ctx = SharedContext(session_id="session-1")

        ctx.update("agent-1", {"key1": "value1"})
        ctx.update("agent-2", {"key2": "value2"})

        assert ctx.data == {"key1": "value1", "key2": "value2"}
        assert "agent-1" in ctx.contributing_agents
        assert "agent-2" in ctx.contributing_agents

    def test_shared_context_update_overwrites(self) -> None:
        """Test that SharedContext update overwrites existing keys."""
        ctx = SharedContext(session_id="session-1")

        ctx.update("agent-1", {"key": "original"})
        ctx.update("agent-2", {"key": "updated"})

        assert ctx.data["key"] == "updated"


class TestAgentCoordinator:
    """Tests for AgentCoordinator class."""

    @pytest.fixture
    def mock_bus(self) -> MagicMock:
        """Create a mock AgentBus."""
        bus = MagicMock(spec=AgentBus)
        bus.subscribe_agent = AsyncMock()
        bus.unsubscribe_agent = AsyncMock()
        bus.broadcast_status = AsyncMock()
        bus.publish = AsyncMock()
        bus.send_message = AsyncMock()
        bus.share_context = AsyncMock()
        bus.reply_to_event = AsyncMock()
        bus._redis = MagicMock()
        bus._redis.get_json = AsyncMock()
        bus.EVENT_KEY = "podex:event:{event_id}"
        return bus

    @pytest.fixture
    def coordinator(self, mock_bus: MagicMock) -> AgentCoordinator:
        """Create an AgentCoordinator with mock bus."""
        return AgentCoordinator(agent_bus=mock_bus)

    @pytest.mark.asyncio
    async def test_register_agent(
        self, coordinator: AgentCoordinator, mock_bus: MagicMock
    ) -> None:
        """Test registering an agent."""
        await coordinator.register_agent(
            session_id="session-1",
            agent_id="agent-1",
            role="coder",
            capabilities=["python"],
        )

        agents = coordinator.get_session_agents("session-1")
        assert len(agents) == 1
        assert agents[0].agent_id == "agent-1"
        assert agents[0].role == "coder"
        assert "python" in agents[0].capabilities

        mock_bus.subscribe_agent.assert_called_once()
        mock_bus.broadcast_status.assert_called_with("session-1", "agent-1", "online")

    @pytest.mark.asyncio
    async def test_unregister_agent(
        self, coordinator: AgentCoordinator, mock_bus: MagicMock
    ) -> None:
        """Test unregistering an agent."""
        await coordinator.register_agent(
            session_id="session-1", agent_id="agent-1", role="coder"
        )

        await coordinator.unregister_agent("session-1", "agent-1")

        agents = coordinator.get_session_agents("session-1")
        assert len(agents) == 0

        mock_bus.unsubscribe_agent.assert_called_once()
        mock_bus.broadcast_status.assert_called_with("session-1", "agent-1", "offline")

    def test_get_session_agents_empty(self, coordinator: AgentCoordinator) -> None:
        """Test getting agents from empty session."""
        agents = coordinator.get_session_agents("nonexistent")
        assert agents == []

    @pytest.mark.asyncio
    async def test_get_available_agent(self, coordinator: AgentCoordinator) -> None:
        """Test getting an available agent."""
        await coordinator.register_agent(
            session_id="session-1", agent_id="agent-1", role="coder"
        )
        await coordinator.register_agent(
            session_id="session-1", agent_id="agent-2", role="reviewer"
        )

        agent = coordinator.get_available_agent("session-1", "coder")
        assert agent is not None
        assert agent.agent_id == "agent-1"

    @pytest.mark.asyncio
    async def test_get_available_agent_busy(self, coordinator: AgentCoordinator) -> None:
        """Test getting agent when all are busy."""
        await coordinator.register_agent(
            session_id="session-1", agent_id="agent-1", role="coder"
        )

        # Make agent busy
        coordinator._agents["session-1"]["agent-1"].status = "busy"

        agent = coordinator.get_available_agent("session-1", "coder")
        assert agent is None

    def test_get_available_agent_wrong_role(self, coordinator: AgentCoordinator) -> None:
        """Test getting agent with wrong role."""
        agent = coordinator.get_available_agent("session-1", "tester")
        assert agent is None

    @pytest.mark.asyncio
    async def test_delegate_task_success(
        self, coordinator: AgentCoordinator, mock_bus: MagicMock
    ) -> None:
        """Test successful task delegation."""
        await coordinator.register_agent(
            session_id="session-1", agent_id="agent-1", role="coder"
        )

        params = DelegateTaskParams(
            session_id="session-1",
            from_agent="orchestrator",
            to_role="coder",
            task_description="Write a function",
        )

        event_id = await coordinator.delegate_task(params)

        assert event_id is not None
        mock_bus.publish.assert_called_once()

        # Agent should be busy now
        agent = coordinator._agents["session-1"]["agent-1"]
        assert agent.status == "busy"
        assert agent.current_task == "Write a function"

    @pytest.mark.asyncio
    async def test_delegate_task_no_available_agent(
        self, coordinator: AgentCoordinator
    ) -> None:
        """Test task delegation when no agent available."""
        params = DelegateTaskParams(
            session_id="session-1",
            from_agent="orchestrator",
            to_role="coder",
            task_description="Write a function",
        )

        event_id = await coordinator.delegate_task(params)
        assert event_id is None

    @pytest.mark.asyncio
    async def test_delegate_task_with_callback(
        self, coordinator: AgentCoordinator, mock_bus: MagicMock
    ) -> None:
        """Test task delegation with callback."""
        await coordinator.register_agent(
            session_id="session-1", agent_id="agent-1", role="coder"
        )

        params = DelegateTaskParams(
            session_id="session-1",
            from_agent="orchestrator",
            to_role="coder",
            task_description="Write a function",
            callback_event="on_complete",
        )

        event_id = await coordinator.delegate_task(params)

        assert event_id is not None
        assert event_id in coordinator._task_callbacks
        assert coordinator._task_callbacks[event_id] == ("orchestrator", "on_complete")

    @pytest.mark.asyncio
    async def test_complete_task(
        self, coordinator: AgentCoordinator, mock_bus: MagicMock
    ) -> None:
        """Test completing a task."""
        await coordinator.register_agent(
            session_id="session-1", agent_id="agent-1", role="coder"
        )

        # Make agent busy
        coordinator._agents["session-1"]["agent-1"].status = "busy"

        # Mock event data
        mock_bus._redis.get_json.return_value = {
            "id": "event-1",
            "event_type": "task_request",
            "session_id": "session-1",
            "from_agent": "orchestrator",
            "to_agent": "agent-1",
            "payload": {},
            "timestamp": datetime.now(UTC).isoformat(),
        }

        await coordinator.complete_task(
            session_id="session-1",
            agent_id="agent-1",
            event_id="event-1",
            result={"output": "Done"},
        )

        # Agent should be idle
        agent = coordinator._agents["session-1"]["agent-1"]
        assert agent.status == "idle"
        assert agent.current_task is None

        mock_bus.reply_to_event.assert_called_once()

    @pytest.mark.asyncio
    async def test_complete_task_with_callback(
        self, coordinator: AgentCoordinator, mock_bus: MagicMock
    ) -> None:
        """Test completing task triggers callback."""
        await coordinator.register_agent(
            session_id="session-1", agent_id="agent-1", role="coder"
        )

        # Register callback
        coordinator._task_callbacks["event-1"] = ("orchestrator", "on_complete")

        mock_bus._redis.get_json.return_value = None

        await coordinator.complete_task(
            session_id="session-1",
            agent_id="agent-1",
            event_id="event-1",
            result={"output": "Done"},
        )

        # Callback should be triggered
        mock_bus.send_message.assert_called_once()
        assert "event-1" not in coordinator._task_callbacks

    @pytest.mark.asyncio
    async def test_fail_task(
        self, coordinator: AgentCoordinator, mock_bus: MagicMock
    ) -> None:
        """Test failing a task."""
        await coordinator.register_agent(
            session_id="session-1", agent_id="agent-1", role="coder"
        )

        coordinator._agents["session-1"]["agent-1"].status = "busy"

        mock_bus._redis.get_json.return_value = {
            "id": "event-1",
            "event_type": "task_request",
            "session_id": "session-1",
            "from_agent": "orchestrator",
            "to_agent": "agent-1",
            "payload": {},
            "timestamp": datetime.now(UTC).isoformat(),
        }

        await coordinator.fail_task(
            session_id="session-1",
            agent_id="agent-1",
            event_id="event-1",
            error="Something went wrong",
        )

        agent = coordinator._agents["session-1"]["agent-1"]
        assert agent.status == "idle"

    def test_get_shared_context_creates_new(self, coordinator: AgentCoordinator) -> None:
        """Test getting shared context creates new if not exists."""
        ctx = coordinator.get_shared_context("session-1")

        assert ctx is not None
        assert ctx.session_id == "session-1"
        assert ctx.data == {}

    def test_get_shared_context_returns_existing(
        self, coordinator: AgentCoordinator
    ) -> None:
        """Test getting shared context returns existing."""
        ctx1 = coordinator.get_shared_context("session-1")
        ctx1.data["key"] = "value"

        ctx2 = coordinator.get_shared_context("session-1")
        assert ctx2.data["key"] == "value"

    @pytest.mark.asyncio
    async def test_update_shared_context(
        self, coordinator: AgentCoordinator, mock_bus: MagicMock
    ) -> None:
        """Test updating shared context."""
        await coordinator.update_shared_context(
            session_id="session-1",
            agent_id="agent-1",
            context={"findings": ["issue1", "issue2"]},
        )

        ctx = coordinator.get_shared_context("session-1")
        assert ctx.data["findings"] == ["issue1", "issue2"]
        assert "agent-1" in ctx.contributing_agents

        mock_bus.share_context.assert_called_once()

    @pytest.mark.asyncio
    async def test_handle_agent_event_task_completed(
        self, coordinator: AgentCoordinator, mock_bus: MagicMock
    ) -> None:
        """Test handling task completed event."""
        # Register callback
        coordinator._task_callbacks["event-1"] = ("orchestrator", "on_complete")

        event = AgentEvent(
            id="reply-1",
            event_type=EventType.TASK_COMPLETED,
            session_id="session-1",
            from_agent="agent-1",
            to_agent=None,
            payload={"event_id": "event-1", "result": {"output": "Done"}},
        )

        await coordinator._handle_agent_event(event)

        mock_bus.send_message.assert_called_once()
        assert "event-1" not in coordinator._task_callbacks

    @pytest.mark.asyncio
    async def test_handle_agent_event_task_failed(
        self, coordinator: AgentCoordinator, mock_bus: MagicMock
    ) -> None:
        """Test handling task failed event."""
        await coordinator.register_agent(
            session_id="session-1", agent_id="agent-1", role="coder"
        )
        coordinator._agents["session-1"]["agent-1"].status = "busy"
        coordinator._task_callbacks["event-1"] = ("orchestrator", "on_complete")

        event = AgentEvent(
            id="reply-1",
            event_type=EventType.TASK_FAILED,
            session_id="session-1",
            from_agent="agent-1",
            to_agent=None,
            payload={"event_id": "event-1", "error": "Task failed"},
        )

        await coordinator._handle_agent_event(event)

        # Agent should be idle
        agent = coordinator._agents["session-1"]["agent-1"]
        assert agent.status == "idle"

        # Callback should be triggered
        mock_bus.send_message.assert_called_once()

    @pytest.mark.asyncio
    async def test_handle_agent_event_context_update(
        self, coordinator: AgentCoordinator
    ) -> None:
        """Test handling context update event."""
        event = AgentEvent(
            id="ctx-1",
            event_type=EventType.CONTEXT_UPDATE,
            session_id="session-1",
            from_agent="agent-1",
            to_agent=None,
            payload={"context": {"new_finding": "important"}},
        )

        await coordinator._handle_agent_event(event)

        ctx = coordinator.get_shared_context("session-1")
        assert ctx.data.get("new_finding") == "important"

    @pytest.mark.asyncio
    async def test_handle_agent_event_status_update(
        self, coordinator: AgentCoordinator
    ) -> None:
        """Test handling agent status update event."""
        await coordinator.register_agent(
            session_id="session-1", agent_id="agent-1", role="coder"
        )

        event = AgentEvent(
            id="status-1",
            event_type=EventType.AGENT_BUSY,
            session_id="session-1",
            from_agent="agent-1",
            to_agent=None,
            payload={"status": "busy", "current_task": "Working on feature"},
        )

        await coordinator._handle_agent_event(event)

        agent = coordinator._agents["session-1"]["agent-1"]
        assert agent.status == "busy"
        assert agent.current_task == "Working on feature"
