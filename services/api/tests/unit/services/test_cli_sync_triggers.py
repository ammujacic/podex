"""Unit tests for CLI sync triggers.

Tests trigger methods that initiate CLI synchronization for skills and MCPs.
"""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID, uuid4

import pytest

from src.services.cli_sync_triggers import CLISyncTriggers


@pytest.fixture
def mock_db():
    """Mock database session."""
    return AsyncMock()


@pytest.fixture
def user_id():
    """Mock user ID."""
    return uuid4()


@pytest.mark.unit
@pytest.mark.asyncio
async def test_on_skill_created_foreground(mock_db, user_id):
    """Test skill created trigger in foreground mode."""
    with patch("src.services.cli_sync_triggers.CLISyncTriggers._sync_skill") as mock_sync:
        await CLISyncTriggers.on_skill_created(
            mock_db, user_id, "skill123", skill_type="user", background=False
        )

        mock_sync.assert_called_once_with(mock_db, user_id, "skill123", "user")


@pytest.mark.unit
@pytest.mark.asyncio
async def test_on_skill_created_background(mock_db, user_id):
    """Test skill created trigger in background mode."""
    with patch("src.services.cli_sync_triggers.asyncio.create_task") as mock_create_task:
        await CLISyncTriggers.on_skill_created(
            mock_db, user_id, "skill123", skill_type="user", background=True
        )

        mock_create_task.assert_called_once()


@pytest.mark.unit
@pytest.mark.asyncio
async def test_on_skill_updated_foreground(mock_db, user_id):
    """Test skill updated trigger in foreground mode."""
    with patch("src.services.cli_sync_triggers.CLISyncTriggers._sync_skill") as mock_sync:
        await CLISyncTriggers.on_skill_updated(
            mock_db, user_id, "skill123", skill_type="user", background=False
        )

        mock_sync.assert_called_once_with(mock_db, user_id, "skill123", "user")


@pytest.mark.unit
@pytest.mark.asyncio
async def test_on_skill_deleted_foreground(mock_db, user_id):
    """Test skill deleted trigger in foreground mode."""
    with patch("src.services.cli_sync_triggers.CLISyncTriggers._remove_skill") as mock_remove:
        await CLISyncTriggers.on_skill_deleted(mock_db, user_id, "skill123", background=False)

        mock_remove.assert_called_once_with(mock_db, user_id, "skill123")


@pytest.mark.unit
@pytest.mark.asyncio
async def test_on_skill_enabled_foreground(mock_db, user_id):
    """Test skill enabled trigger in foreground mode."""
    with patch("src.services.cli_sync_triggers.CLISyncTriggers._sync_skill") as mock_sync:
        await CLISyncTriggers.on_skill_enabled(
            mock_db, user_id, "skill123", skill_type="system", background=False
        )

        mock_sync.assert_called_once_with(mock_db, user_id, "skill123", "system")


@pytest.mark.unit
@pytest.mark.asyncio
async def test_on_skill_disabled_foreground(mock_db, user_id):
    """Test skill disabled trigger in foreground mode."""
    with patch("src.services.cli_sync_triggers.CLISyncTriggers._remove_skill") as mock_remove:
        await CLISyncTriggers.on_skill_disabled(mock_db, user_id, "skill123", background=False)

        mock_remove.assert_called_once_with(mock_db, user_id, "skill123")


@pytest.mark.unit
@pytest.mark.asyncio
async def test_on_mcp_created_foreground(mock_db, user_id):
    """Test MCP created trigger in foreground mode."""
    with patch("src.services.cli_sync_triggers.CLISyncTriggers._sync_mcp") as mock_sync:
        await CLISyncTriggers.on_mcp_created(mock_db, user_id, "mcp123", background=False)

        mock_sync.assert_called_once_with(mock_db, user_id, "mcp123")


@pytest.mark.unit
@pytest.mark.asyncio
async def test_on_mcp_updated_foreground(mock_db, user_id):
    """Test MCP updated trigger in foreground mode."""
    with patch("src.services.cli_sync_triggers.CLISyncTriggers._sync_mcp") as mock_sync:
        await CLISyncTriggers.on_mcp_updated(mock_db, user_id, "mcp123", background=False)

        mock_sync.assert_called_once_with(mock_db, user_id, "mcp123")


@pytest.mark.unit
@pytest.mark.asyncio
async def test_on_mcp_enabled_foreground(mock_db, user_id):
    """Test MCP enabled trigger in foreground mode."""
    with patch("src.services.cli_sync_triggers.CLISyncTriggers._sync_mcp") as mock_sync:
        await CLISyncTriggers.on_mcp_enabled(mock_db, user_id, "mcp123", background=False)

        mock_sync.assert_called_once_with(mock_db, user_id, "mcp123")


@pytest.mark.unit
@pytest.mark.asyncio
async def test_on_mcp_disabled(mock_db, user_id):
    """Test MCP disabled trigger (should log but not sync)."""
    await CLISyncTriggers.on_mcp_disabled(mock_db, user_id, "mcp123", _background=False)

    # Should complete without error (just logs)


@pytest.mark.unit
@pytest.mark.asyncio
async def test_on_workspace_start(mock_db, user_id):
    """Test workspace start trigger."""
    await CLISyncTriggers.on_workspace_start(mock_db, user_id, "workspace123")

    # Should complete without error (just logs)


@pytest.mark.unit
@pytest.mark.asyncio
async def test_on_workspace_file_change_cli_config(mock_db, user_id):
    """Test workspace file change for CLI config file."""
    mock_service = AsyncMock()
    mock_service.sync_from_cli = AsyncMock()

    with patch("src.services.cli_sync_triggers.CLISyncService", return_value=mock_service):
        await CLISyncTriggers.on_workspace_file_change(
            mock_db, user_id, "workspace123", ".claude/config.json"
        )

        mock_service.sync_from_cli.assert_called_once_with(
            user_id=user_id,
            cli_name="claude_code",
            workspace_path="/workspaces/workspace123",
        )


@pytest.mark.unit
@pytest.mark.asyncio
async def test_on_workspace_file_change_non_cli_file(mock_db, user_id):
    """Test workspace file change for non-CLI config file."""
    with patch("src.services.cli_sync_triggers.CLISyncService") as mock_service:
        await CLISyncTriggers.on_workspace_file_change(
            mock_db, user_id, "workspace123", "some_other_file.txt"
        )

        # Should not create service for non-CLI files
        mock_service.assert_not_called()


@pytest.mark.unit
@pytest.mark.asyncio
async def test_on_workspace_file_change_error_handling(mock_db, user_id):
    """Test workspace file change with sync error."""
    mock_service = AsyncMock()
    mock_service.sync_from_cli = AsyncMock(side_effect=Exception("Sync failed"))

    with patch("src.services.cli_sync_triggers.CLISyncService", return_value=mock_service):
        # Should not raise exception
        await CLISyncTriggers.on_workspace_file_change(
            mock_db, user_id, "workspace123", ".codex/config.toml"
        )


@pytest.mark.unit
@pytest.mark.asyncio
async def test_sync_skill_success(mock_db, user_id):
    """Test private _sync_skill method success."""
    mock_result = MagicMock()
    mock_result.errors = []
    mock_result.skills_synced = 1

    mock_service = AsyncMock()
    mock_service.sync_skill = AsyncMock(return_value=mock_result)

    with patch("src.services.cli_sync_triggers.CLISyncService", return_value=mock_service):
        await CLISyncTriggers._sync_skill(mock_db, user_id, "skill123", "user")

        mock_service.sync_skill.assert_called_once_with(
            user_id=user_id,
            skill_id="skill123",
            skill_type="user",
        )


@pytest.mark.unit
@pytest.mark.asyncio
async def test_sync_skill_with_errors(mock_db, user_id):
    """Test private _sync_skill method with errors."""
    mock_result = MagicMock()
    mock_result.errors = ["Error 1", "Error 2"]

    mock_service = AsyncMock()
    mock_service.sync_skill = AsyncMock(return_value=mock_result)

    with patch("src.services.cli_sync_triggers.CLISyncService", return_value=mock_service):
        await CLISyncTriggers._sync_skill(mock_db, user_id, "skill123", "user")

        # Should complete despite errors (just logs warning)


@pytest.mark.unit
@pytest.mark.asyncio
async def test_sync_skill_exception(mock_db, user_id):
    """Test private _sync_skill method with exception."""
    mock_service = AsyncMock()
    mock_service.sync_skill = AsyncMock(side_effect=Exception("Failed"))

    with patch("src.services.cli_sync_triggers.CLISyncService", return_value=mock_service):
        # Should not raise exception (logs error)
        await CLISyncTriggers._sync_skill(mock_db, user_id, "skill123", "user")


@pytest.mark.unit
@pytest.mark.asyncio
async def test_remove_skill_success(mock_db, user_id):
    """Test private _remove_skill method success."""
    mock_result = MagicMock()
    mock_result.errors = []

    mock_service = AsyncMock()
    mock_service.remove_skill_from_cli = AsyncMock(return_value=mock_result)

    with patch("src.services.cli_sync_triggers.CLISyncService", return_value=mock_service):
        await CLISyncTriggers._remove_skill(mock_db, user_id, "skill123")

        mock_service.remove_skill_from_cli.assert_called_once_with(
            user_id=user_id,
            skill_id="skill123",
        )


@pytest.mark.unit
@pytest.mark.asyncio
async def test_remove_skill_with_errors(mock_db, user_id):
    """Test private _remove_skill method with errors."""
    mock_result = MagicMock()
    mock_result.errors = ["Error removing skill"]

    mock_service = AsyncMock()
    mock_service.remove_skill_from_cli = AsyncMock(return_value=mock_result)

    with patch("src.services.cli_sync_triggers.CLISyncService", return_value=mock_service):
        await CLISyncTriggers._remove_skill(mock_db, user_id, "skill123")

        # Should complete despite errors


@pytest.mark.unit
@pytest.mark.asyncio
async def test_remove_skill_exception(mock_db, user_id):
    """Test private _remove_skill method with exception."""
    mock_service = AsyncMock()
    mock_service.remove_skill_from_cli = AsyncMock(side_effect=Exception("Failed"))

    with patch("src.services.cli_sync_triggers.CLISyncService", return_value=mock_service):
        # Should not raise exception
        await CLISyncTriggers._remove_skill(mock_db, user_id, "skill123")


@pytest.mark.unit
@pytest.mark.asyncio
async def test_sync_mcp_success(mock_db, user_id):
    """Test private _sync_mcp method success."""
    mock_result = MagicMock()
    mock_result.errors = []
    mock_result.mcps_synced = 1

    mock_service = AsyncMock()
    mock_service.sync_mcp = AsyncMock(return_value=mock_result)

    with patch("src.services.cli_sync_triggers.CLISyncService", return_value=mock_service):
        await CLISyncTriggers._sync_mcp(mock_db, user_id, "mcp123")

        mock_service.sync_mcp.assert_called_once_with(
            user_id=user_id,
            mcp_id="mcp123",
        )


@pytest.mark.unit
@pytest.mark.asyncio
async def test_sync_mcp_exception(mock_db, user_id):
    """Test private _sync_mcp method with exception."""
    mock_service = AsyncMock()
    mock_service.sync_mcp = AsyncMock(side_effect=Exception("Failed"))

    with patch("src.services.cli_sync_triggers.CLISyncService", return_value=mock_service):
        # Should not raise exception
        await CLISyncTriggers._sync_mcp(mock_db, user_id, "mcp123")
