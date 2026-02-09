"""Comprehensive tests for workspace routes."""

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException

from src.managers.base import ComputeManager
from src.models.workspace import (
    WorkspaceConfig,
    WorkspaceInfo,
    WorkspaceStatus,
)
from src.routes.workspaces import verify_workspace_ownership


class TestVerifyWorkspaceOwnership:
    """Tests for workspace ownership verification."""

    @pytest.fixture
    def sample_workspace(self) -> WorkspaceInfo:
        """Create a sample workspace."""
        return WorkspaceInfo(
            id="ws_123",
            user_id="user_456",
            session_id="sess_789",
            status=WorkspaceStatus.RUNNING,
            tier="starter_arm",
            host="localhost",
            port=3000,
            created_at=datetime.now(UTC),
            last_activity=datetime.now(UTC),
        )

    @pytest.fixture
    def mock_compute_manager(self, sample_workspace: WorkspaceInfo) -> MagicMock:
        """Create mock compute manager."""
        mock = MagicMock(spec=ComputeManager)
        mock.get_workspace = AsyncMock(return_value=sample_workspace)
        return mock

    @pytest.mark.asyncio
    async def test_verify_ownership_success(
        self, sample_workspace: WorkspaceInfo, mock_compute_manager: MagicMock
    ) -> None:
        """Test successful ownership verification."""
        result = await verify_workspace_ownership(
            workspace_id="ws_123",
            user_id="user_456",
            compute=mock_compute_manager,
        )
        assert result == sample_workspace

    @pytest.mark.asyncio
    async def test_verify_ownership_not_found(
        self, mock_compute_manager: MagicMock
    ) -> None:
        """Test 404 when workspace not found."""
        mock_compute_manager.get_workspace = AsyncMock(return_value=None)

        with pytest.raises(HTTPException) as exc:
            await verify_workspace_ownership(
                workspace_id="ws_nonexistent",
                user_id="user_456",
                compute=mock_compute_manager,
            )

        assert exc.value.status_code == 404
        assert "not found" in exc.value.detail.lower()

    @pytest.mark.asyncio
    async def test_verify_ownership_wrong_user(
        self, sample_workspace: WorkspaceInfo, mock_compute_manager: MagicMock
    ) -> None:
        """Test 403 when user doesn't own workspace."""
        with pytest.raises(HTTPException) as exc:
            await verify_workspace_ownership(
                workspace_id="ws_123",
                user_id="wrong_user",  # Different user
                compute=mock_compute_manager,
            )

        assert exc.value.status_code == 403
        assert "not authorized" in exc.value.detail.lower()


class TestWorkspaceInfoModel:
    """Additional tests for WorkspaceInfo model."""

    def test_workspace_info_with_container_id(self) -> None:
        """Test WorkspaceInfo with container ID."""
        info = WorkspaceInfo(
            id="ws_123",
            user_id="user_456",
            session_id="sess_789",
            status=WorkspaceStatus.RUNNING,
            tier="pro_arm",
            host="172.17.0.2",
            port=3000,
            created_at=datetime.now(UTC),
            last_activity=datetime.now(UTC),
            container_id="abc123def456",
        )
        assert info.container_id == "abc123def456"
        assert info.tier == "pro_arm"

    def test_workspace_status_transitions(self) -> None:
        """Test all workspace status values."""
        statuses = [
            WorkspaceStatus.CREATING,
            WorkspaceStatus.RUNNING,
            WorkspaceStatus.STOPPING,
            WorkspaceStatus.STOPPED,
            WorkspaceStatus.ERROR,
        ]
        for status in statuses:
            info = WorkspaceInfo(
                id="ws_123",
                user_id="user_456",
                session_id="sess_789",
                status=status,
                tier="starter_arm",
                host="localhost",
                port=3000,
                created_at=datetime.now(UTC),
                last_activity=datetime.now(UTC),
            )
            assert info.status == status


class TestWorkspaceConfigValidation:
    """Tests for WorkspaceConfig validation."""

    def test_config_with_repos(self) -> None:
        """Test config with multiple repos."""
        config = WorkspaceConfig(
            tier="power_arm",
            repos=[
                "https://github.com/user/repo1",
                "https://github.com/user/repo2",
            ],
        )
        assert len(config.repos) == 2

    def test_config_with_environment(self) -> None:
        """Test config with environment variables."""
        config = WorkspaceConfig(
            environment={
                "NODE_ENV": "development",
                "API_KEY": "secret123",
            },
        )
        assert config.environment["NODE_ENV"] == "development"
        assert config.environment["API_KEY"] == "secret123"

    def test_config_all_tiers(self) -> None:
        """Test config with all tier values."""
        # Tiers are now strings, not enums - test the main tier names
        for tier in ["starter_arm", "pro_arm", "power_arm", "enterprise_arm", "starter", "pro", "power", "enterprise"]:
            config = WorkspaceConfig(tier=tier)
            assert config.tier == tier
