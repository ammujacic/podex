"""Tests for mesh agent bus module.

Tests cover:
- EventType enum
- AgentEvent dataclass
- TaskRequestParams dataclass
- AgentBus basic functionality
"""

from datetime import UTC, datetime
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


class TestEventTypeEnum:
    """Test EventType enum."""

    def test_task_events_exist(self):
        """Test task event types exist."""
        from src.mesh.agent_bus import EventType

        assert EventType.TASK_REQUEST is not None
        assert EventType.TASK_ACCEPTED is not None
        assert EventType.TASK_COMPLETED is not None
        assert EventType.TASK_FAILED is not None

    def test_agent_status_events_exist(self):
        """Test agent status event types exist."""
        from src.mesh.agent_bus import EventType

        assert EventType.AGENT_ONLINE is not None
        assert EventType.AGENT_OFFLINE is not None
        assert EventType.AGENT_BUSY is not None
        assert EventType.AGENT_IDLE is not None

    def test_communication_events_exist(self):
        """Test communication event types exist."""
        from src.mesh.agent_bus import EventType

        assert EventType.MESSAGE is not None
        assert EventType.QUESTION is not None
        assert EventType.ANSWER is not None
        assert EventType.BROADCAST is not None

    def test_context_events_exist(self):
        """Test context event types exist."""
        from src.mesh.agent_bus import EventType

        assert EventType.CONTEXT_UPDATE is not None
        assert EventType.CONTEXT_REQUEST is not None


class TestTaskRequestParams:
    """Test TaskRequestParams dataclass."""

    def test_basic_creation(self):
        """Test basic TaskRequestParams creation."""
        from src.mesh.agent_bus import TaskRequestParams

        params = TaskRequestParams(
            session_id="session-123",
            from_agent="agent-1",
            to_agent_role="analyst",
            task_description="Analyze the code",
        )

        assert params.session_id == "session-123"
        assert params.from_agent == "agent-1"
        assert params.to_agent_role == "analyst"
        assert params.task_description == "Analyze the code"
        assert params.timeout == 300.0  # default

    def test_with_context(self):
        """Test TaskRequestParams with context."""
        from src.mesh.agent_bus import TaskRequestParams

        params = TaskRequestParams(
            session_id="session-123",
            from_agent="agent-1",
            to_agent_role="analyst",
            task_description="Analyze",
            context={"file": "/main.py"},
            timeout=60.0,
        )

        assert params.context == {"file": "/main.py"}
        assert params.timeout == 60.0


class TestAgentEvent:
    """Test AgentEvent dataclass."""

    def test_basic_creation(self):
        """Test basic AgentEvent creation."""
        from src.mesh.agent_bus import AgentEvent, EventType

        event = AgentEvent(
            id="event-123",
            event_type=EventType.TASK_REQUEST,
            session_id="session-456",
            from_agent="agent-1",
            to_agent="agent-2",
            payload={"task": "analyze"},
        )

        assert event.id == "event-123"
        assert event.event_type == EventType.TASK_REQUEST
        assert event.session_id == "session-456"
        assert event.from_agent == "agent-1"
        assert event.to_agent == "agent-2"

    def test_broadcast_event_has_none_to_agent(self):
        """Test broadcast event has None to_agent."""
        from src.mesh.agent_bus import AgentEvent, EventType

        event = AgentEvent(
            id="event-broadcast",
            event_type=EventType.BROADCAST,
            session_id="session-123",
            from_agent="agent-1",
            to_agent=None,
            payload={"message": "hello all"},
        )

        assert event.to_agent is None

    def test_to_dict(self):
        """Test AgentEvent to_dict method."""
        from src.mesh.agent_bus import AgentEvent, EventType

        event = AgentEvent(
            id="event-123",
            event_type=EventType.MESSAGE,
            session_id="session-456",
            from_agent="agent-1",
            to_agent="agent-2",
            payload={"text": "hello"},
        )

        data = event.to_dict()

        assert data["id"] == "event-123"
        assert data["event_type"] == "message"
        assert data["session_id"] == "session-456"
        assert data["payload"] == {"text": "hello"}

    def test_from_dict(self):
        """Test AgentEvent from_dict class method."""
        from src.mesh.agent_bus import AgentEvent, EventType

        data = {
            "id": "event-123",
            "event_type": "task_request",
            "session_id": "session-456",
            "from_agent": "agent-1",
            "to_agent": "agent-2",
            "payload": {"task": "analyze"},
            "timestamp": "2024-01-01T12:00:00+00:00",
        }

        event = AgentEvent.from_dict(data)

        assert event.id == "event-123"
        assert event.event_type == EventType.TASK_REQUEST
        assert event.from_agent == "agent-1"


class TestAgentBus:
    """Test AgentBus class."""

    def test_agent_bus_class_exists(self):
        """Test AgentBus class exists."""
        from src.mesh.agent_bus import AgentBus
        assert AgentBus is not None
