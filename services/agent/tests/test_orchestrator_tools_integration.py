"""Integration tests for orchestrator tools with Redis."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from typing import Any

from tests.conftest import requires_redis


class TestOrchestratorToolsUnit:
    """Unit tests for orchestrator tools (no Redis required)."""

    @pytest.mark.asyncio
    async def test_create_execution_plan_redis_connection_error(self) -> None:
        """Test that create_execution_plan handles Redis connection errors."""
        from src.tools.orchestrator_tools import create_execution_plan

        # Mock Redis to fail connection
        with patch("src.tools.orchestrator_tools.get_redis_client") as mock_redis:
            mock_client = MagicMock()
            mock_client.connect = AsyncMock(side_effect=Exception("Connection refused"))
            mock_redis.return_value = mock_client

            result = await create_execution_plan(
                session_id="session-123",
                agent_id="agent-123",
                task_description="Test task",
            )

            assert result["success"] is False
            assert "Redis connection failed" in result["error"]

    @pytest.mark.asyncio
    async def test_delegate_task_invalid_role(self) -> None:
        """Test that delegate_task rejects invalid roles."""
        from src.tools.orchestrator_tools import delegate_task

        # Mock config reader to return limited roles
        with patch("src.tools.orchestrator_tools.get_config_reader") as mock_config:
            mock_reader = MagicMock()
            mock_reader.is_delegatable_role = AsyncMock(return_value=False)
            mock_reader.get_delegatable_roles = AsyncMock(
                return_value=[{"role": "coder"}, {"role": "reviewer"}]
            )
            mock_config.return_value = mock_reader

            result = await delegate_task(
                session_id="session-123",
                parent_agent_id="parent-123",
                agent_role="invalid_role",
                description="Test task",
            )

            assert result["success"] is False
            assert "Invalid agent role" in result["error"]
            assert "coder" in result["error"]
            assert "reviewer" in result["error"]

    @pytest.mark.asyncio
    async def test_delegate_task_max_concurrent_exceeded(self) -> None:
        """Test that delegate_task handles max concurrent limit."""
        from src.tools.orchestrator_tools import delegate_task

        with patch("src.tools.orchestrator_tools.get_config_reader") as mock_config:
            mock_reader = MagicMock()
            mock_reader.is_delegatable_role = AsyncMock(return_value=True)
            mock_config.return_value = mock_reader

            with patch("src.tools.orchestrator_tools.get_subagent_manager") as mock_manager:
                mock_mgr = MagicMock()
                mock_mgr.spawn_subagent = AsyncMock(
                    side_effect=ValueError("Max concurrent subagents exceeded")
                )
                mock_manager.return_value = mock_mgr

                result = await delegate_task(
                    session_id="session-123",
                    parent_agent_id="parent-123",
                    agent_role="coder",
                    description="Test task",
                )

                assert result["success"] is False
                assert "Max concurrent" in result["error"]

    @pytest.mark.asyncio
    async def test_create_custom_agent_empty_model(self) -> None:
        """Test that create_custom_agent requires model."""
        from src.tools.orchestrator_tools import create_custom_agent

        result = await create_custom_agent(
            session_id="session-123",
            name="Test Agent",
            system_prompt="You are a test agent",
            tools=["read_file"],
            model="",  # Empty model
        )

        assert result["success"] is False
        assert "Model is required" in result["error"]

    @pytest.mark.asyncio
    async def test_create_custom_agent_invalid_tools(self) -> None:
        """Test that create_custom_agent validates tools."""
        from src.tools.orchestrator_tools import create_custom_agent

        with patch("src.tools.orchestrator_tools.get_config_reader") as mock_config:
            mock_reader = MagicMock()
            mock_reader.get_tool_names = AsyncMock(
                return_value={"read_file", "write_file", "run_command"}
            )
            mock_config.return_value = mock_reader

            result = await create_custom_agent(
                session_id="session-123",
                name="Test Agent",
                system_prompt="You are a test agent",
                tools=["read_file", "invalid_tool"],
                model="claude-sonnet-4-20250514",
            )

            assert result["success"] is False
            assert "Invalid tools" in result["error"]
            assert "invalid_tool" in result["error"]

    @pytest.mark.asyncio
    async def test_create_custom_agent_no_tools_from_config(self) -> None:
        """Test that create_custom_agent handles missing tools config."""
        from src.tools.orchestrator_tools import create_custom_agent

        with patch("src.tools.orchestrator_tools.get_config_reader") as mock_config:
            mock_reader = MagicMock()
            mock_reader.get_tool_names = AsyncMock(return_value=set())
            mock_config.return_value = mock_reader

            result = await create_custom_agent(
                session_id="session-123",
                name="Test Agent",
                system_prompt="You are a test agent",
                tools=["read_file"],
                model="claude-sonnet-4-20250514",
            )

            assert result["success"] is False
            assert "Failed to load tools" in result["error"]

    @pytest.mark.asyncio
    async def test_delegate_to_custom_agent_not_found(self) -> None:
        """Test that delegate_to_custom_agent handles missing agent."""
        from src.tools.orchestrator_tools import delegate_to_custom_agent

        with patch("src.tools.orchestrator_tools.get_redis_client") as mock_redis:
            mock_client = MagicMock()
            mock_client.connect = AsyncMock()
            mock_client.get_json = AsyncMock(return_value=None)
            mock_redis.return_value = mock_client

            result = await delegate_to_custom_agent(
                session_id="session-123",
                agent_id="nonexistent-agent",
                message="Test message",
            )

            assert result["success"] is False
            assert "not found" in result["error"]

    @pytest.mark.asyncio
    async def test_get_subagent_status_not_found(self) -> None:
        """Test that get_subagent_status handles missing subagent."""
        from src.tools.orchestrator_tools import get_subagent_status

        with patch("src.tools.orchestrator_tools.get_subagent_manager") as mock_manager:
            mock_mgr = MagicMock()
            mock_mgr.get_subagent = MagicMock(return_value=None)
            mock_manager.return_value = mock_mgr

            result = await get_subagent_status("nonexistent-subagent")

            assert result["success"] is False
            assert "not found" in result["error"]

    @pytest.mark.asyncio
    async def test_get_subagent_status_success(self) -> None:
        """Test successful subagent status retrieval."""
        from src.tools.orchestrator_tools import get_subagent_status
        from src.subagent import SubagentStatus

        with patch("src.tools.orchestrator_tools.get_subagent_manager") as mock_manager:
            mock_subagent = MagicMock()
            mock_subagent.id = "subagent-123"
            mock_subagent.status = SubagentStatus.RUNNING
            mock_subagent.role = "coder"
            mock_subagent.task = "Write some code"
            mock_subagent.result_summary = None
            mock_subagent.error = None
            mock_subagent.context.tokens_used = 100
            mock_subagent.background = True

            mock_mgr = MagicMock()
            mock_mgr.get_subagent = MagicMock(return_value=mock_subagent)
            mock_manager.return_value = mock_mgr

            result = await get_subagent_status("subagent-123")

            assert result["success"] is True
            assert result["subagent_id"] == "subagent-123"
            assert result["role"] == "coder"
            assert result["status"] == "running"
            assert result["background"] is True

    @pytest.mark.asyncio
    async def test_wait_for_subagents_timeout(self) -> None:
        """Test wait_for_subagents with timeout."""
        from src.tools.orchestrator_tools import wait_for_subagents

        with patch("src.tools.orchestrator_tools.get_subagent_manager") as mock_manager:
            mock_mgr = MagicMock()
            mock_mgr.wait_for_subagent = AsyncMock(side_effect=TimeoutError())
            mock_manager.return_value = mock_mgr

            result = await wait_for_subagents(
                subagent_ids=["subagent-1", "subagent-2"],
                timeout_seconds=1,
            )

            assert result["success"] is False
            assert result["completed"] == 0
            assert result["total"] == 2
            assert "subagent-1" in result["results"]
            assert result["results"]["subagent-1"]["status"] == "timeout"

    @pytest.mark.asyncio
    async def test_wait_for_subagents_success(self) -> None:
        """Test successful wait for subagents."""
        from src.tools.orchestrator_tools import wait_for_subagents
        from src.subagent import SubagentStatus

        with patch("src.tools.orchestrator_tools.get_subagent_manager") as mock_manager:
            mock_subagent = MagicMock()
            mock_subagent.status = SubagentStatus.COMPLETED
            mock_subagent.result_summary = "Task completed successfully"
            mock_subagent.error = None
            mock_subagent.role = "coder"
            mock_subagent.context.tokens_used = 200

            mock_mgr = MagicMock()
            mock_mgr.wait_for_subagent = AsyncMock(return_value=mock_subagent)
            mock_manager.return_value = mock_mgr

            result = await wait_for_subagents(
                subagent_ids=["subagent-1"],
                timeout_seconds=10,
            )

            assert result["success"] is True
            assert result["completed"] == 1
            assert result["total"] == 1
            assert result["results"]["subagent-1"]["status"] == "completed"
            assert result["results"]["subagent-1"]["result"] == "Task completed successfully"

    @pytest.mark.asyncio
    async def test_get_active_subagents(self) -> None:
        """Test getting active subagents."""
        from src.tools.orchestrator_tools import get_active_subagents
        from src.subagent import SubagentStatus

        with patch("src.tools.orchestrator_tools.get_subagent_manager") as mock_manager:
            mock_active = MagicMock()
            mock_active.id = "active-1"
            mock_active.role = "coder"
            mock_active.task = "Writing code..."
            mock_active.status = SubagentStatus.RUNNING
            mock_active.background = False
            mock_active.context.tokens_used = 50

            mock_completed = MagicMock()
            mock_completed.id = "completed-1"
            mock_completed.role = "reviewer"
            mock_completed.task = "Reviewing code"
            mock_completed.status = SubagentStatus.COMPLETED
            mock_completed.result_summary = "Code looks good"

            mock_mgr = MagicMock()
            mock_mgr.get_subagents = MagicMock(return_value=[mock_active, mock_completed])
            mock_mgr.get_active_subagents = MagicMock(return_value=[mock_active])
            mock_manager.return_value = mock_mgr

            result = await get_active_subagents("parent-123")

            assert result["success"] is True
            assert result["stats"]["total"] == 2
            assert result["stats"]["active"] == 1
            assert result["stats"]["completed"] == 1
            assert len(result["active_subagents"]) == 1
            assert result["active_subagents"][0]["subagent_id"] == "active-1"

    @pytest.mark.asyncio
    async def test_synthesize_results(self) -> None:
        """Test synthesizing results from subagents."""
        from src.tools.orchestrator_tools import synthesize_results
        from src.subagent import SubagentStatus

        with patch("src.tools.orchestrator_tools.get_subagent_manager") as mock_manager:
            mock_subagent1 = MagicMock()
            mock_subagent1.id = "subagent-1"
            mock_subagent1.role = "coder"
            mock_subagent1.task = "Write feature"
            mock_subagent1.status = SubagentStatus.COMPLETED
            mock_subagent1.result_summary = "Feature implemented"
            mock_subagent1.error = None
            mock_subagent1.context.tokens_used = 100

            mock_subagent2 = MagicMock()
            mock_subagent2.id = "subagent-2"
            mock_subagent2.role = "tester"
            mock_subagent2.task = "Write tests"
            mock_subagent2.status = SubagentStatus.COMPLETED
            mock_subagent2.result_summary = "Tests passing"
            mock_subagent2.error = None
            mock_subagent2.context.tokens_used = 80

            mock_mgr = MagicMock()
            mock_mgr.get_subagent = MagicMock(
                side_effect=lambda x: mock_subagent1 if x == "subagent-1" else mock_subagent2
            )
            mock_manager.return_value = mock_mgr

            result = await synthesize_results(
                subagent_ids=["subagent-1", "subagent-2"],
                synthesis_instructions="Combine the results",
            )

            assert result["success"] is True
            assert result["subagent_count"] == 2
            assert len(result["results"]) == 2
            assert result["synthesis_instructions"] == "Combine the results"


@pytest.mark.integration
@requires_redis
class TestOrchestratorToolsRedisIntegration:
    """Integration tests for orchestrator tools with Redis."""

    @pytest.mark.asyncio
    async def test_create_custom_agent_full_flow(self) -> None:
        """Test complete custom agent creation flow with Redis."""
        from src.tools.orchestrator_tools import create_custom_agent
        from podex_shared.redis_client import RedisClient
        from src.config import settings

        # Create a fresh Redis client for this test to avoid event loop issues
        redis = RedisClient(settings.REDIS_URL)
        await redis.connect()

        stored_data: dict[str, Any] = {}

        # Create mock Redis that stores data locally
        mock_redis = MagicMock()
        mock_redis.connect = AsyncMock()
        mock_redis.set_json = AsyncMock(side_effect=lambda k, v, **kw: stored_data.update({k: v}))
        mock_redis.disconnect = AsyncMock()

        # Mock config reader to allow tools
        with patch("src.tools.orchestrator_tools.get_config_reader") as mock_config:
            mock_reader = MagicMock()
            mock_reader.get_tool_names = AsyncMock(
                return_value={"read_file", "write_file", "run_command"}
            )
            mock_config.return_value = mock_reader

            # Mock get_redis_client to return our mock
            with patch("src.tools.orchestrator_tools.get_redis_client") as mock_redis_factory:
                mock_redis_factory.return_value = mock_redis

                result = await create_custom_agent(
                    session_id="test-session",
                    name="Integration Test Agent",
                    system_prompt="You are a helpful test agent",
                    tools=["read_file", "write_file"],
                    model="claude-sonnet-4-20250514",
                )

                assert result["success"] is True
                assert result["name"] == "Integration Test Agent"
                assert "agent_id" in result

                # Verify mock was called correctly
                mock_redis.connect.assert_called_once()
                mock_redis.set_json.assert_called_once()

                # Check stored data
                key = list(stored_data.keys())[0]
                stored = stored_data[key]
                assert stored["name"] == "Integration Test Agent"
                assert stored["tools"] == ["read_file", "write_file"]

        # Cleanup the fresh redis client we created
        await redis.disconnect()
