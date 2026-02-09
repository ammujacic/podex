"""Tests for subagent module.

Tests cover:
- SubagentManager
- Subagent dataclasses and enums
"""

import pytest
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch


class TestSubagentModuleImports:
    """Test subagent module imports."""

    def test_subagent_module_exists(self):
        """Test subagent module can be imported."""
        from src import subagent
        assert subagent is not None

    def test_manager_module_exists(self):
        """Test manager module can be imported."""
        from src.subagent import manager
        assert manager is not None


class TestSubagentManager:
    """Test SubagentManager class."""

    def test_subagent_manager_class_exists(self):
        """Test SubagentManager class exists."""
        from src.subagent.manager import SubagentManager
        assert SubagentManager is not None

    def test_subagent_class_exists(self):
        """Test Subagent class exists."""
        from src.subagent.manager import Subagent
        assert Subagent is not None

    def test_subagent_context_dataclass_exists(self):
        """Test SubagentContext dataclass exists."""
        from src.subagent.manager import SubagentContext
        assert SubagentContext is not None

    def test_subagent_status_enum_exists(self):
        """Test SubagentStatus enum exists."""
        from src.subagent.manager import SubagentStatus
        assert SubagentStatus is not None

    def test_subagent_uses_role_string(self):
        """Test Subagent uses role as a string field."""
        from src.subagent.manager import Subagent, SubagentContext

        subagent = Subagent(
            id="sub-1",
            parent_agent_id="agent-1",
            session_id="session-1",
            name="Test",
            role="researcher",
            task="Do something",
            context=SubagentContext(),
        )
        assert subagent.role == "researcher"
        assert isinstance(subagent.role, str)
