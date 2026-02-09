"""Tests for health tools module.

Tests cover:
- HealthAnalysisConfig dataclass
- analyze_project_health function
- get_health_score function
- apply_health_fix function
- list_health_checks function
"""

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from src.tools.health_tools import (
    HealthAnalysisConfig,
    analyze_project_health,
    get_health_score,
    apply_health_fix,
    list_health_checks,
)


class TestHealthToolsModule:
    """Test health tools module exists."""

    def test_health_tools_module_exists(self):
        """Test health tools module can be imported."""
        from src.tools import health_tools
        assert health_tools is not None


class TestHealthAnalysisConfig:
    """Test HealthAnalysisConfig dataclass."""

    def test_health_analysis_config_exists(self):
        """Test HealthAnalysisConfig class exists."""
        assert HealthAnalysisConfig is not None

    def test_basic_creation(self):
        """Test creating basic config."""
        config = HealthAnalysisConfig(
            session_id="session-123",
            user_id="user-456",
        )

        assert config.session_id == "session-123"
        assert config.user_id == "user-456"
        assert config.workspace_id is None
        assert config.working_directory is None

    def test_with_optional_fields(self):
        """Test creating config with optional fields."""
        config = HealthAnalysisConfig(
            session_id="session-123",
            user_id="user-456",
            workspace_id="workspace-789",
            working_directory="src/components",
        )

        assert config.workspace_id == "workspace-789"
        assert config.working_directory == "src/components"


class TestAnalyzeProjectHealth:
    """Test analyze_project_health function."""

    @pytest.fixture
    def config(self):
        """Create test config."""
        return HealthAnalysisConfig(
            session_id="session-123",
            user_id="user-456",
            workspace_id="workspace-789",
            working_directory="src",
        )

    @pytest.fixture
    def mock_settings(self):
        """Create mock settings."""
        settings = MagicMock()
        settings.API_BASE_URL = "http://localhost:8000"
        settings.INTERNAL_SERVICE_TOKEN = "test-token"
        return settings

    def test_analyze_project_health_exists(self):
        """Test analyze_project_health function exists."""
        assert analyze_project_health is not None
        assert callable(analyze_project_health)

    async def test_analyze_success(self, config, mock_settings):
        """Test successful health analysis."""
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "id": "health-123",
            "status": "pending",
        }
        mock_response.raise_for_status = MagicMock()

        with patch("src.tools.health_tools.get_settings", return_value=mock_settings), \
             patch("httpx.AsyncClient") as mock_client:
            mock_client_instance = AsyncMock()
            mock_client_instance.post = AsyncMock(return_value=mock_response)
            mock_client.return_value.__aenter__.return_value = mock_client_instance

            result = await analyze_project_health(config)

        assert result["success"] is True
        assert result["message"] == "Health analysis started"
        assert result["health_score_id"] == "health-123"
        assert result["status"] == "pending"

    async def test_analyze_without_workspace_id(self, mock_settings):
        """Test analysis without workspace_id."""
        config = HealthAnalysisConfig(
            session_id="session-123",
            user_id="user-456",
            working_directory="src",
        )

        mock_response = MagicMock()
        mock_response.json.return_value = {"id": "health-123", "status": "pending"}
        mock_response.raise_for_status = MagicMock()

        with patch("src.tools.health_tools.get_settings", return_value=mock_settings), \
             patch("httpx.AsyncClient") as mock_client:
            mock_client_instance = AsyncMock()
            mock_client_instance.post = AsyncMock(return_value=mock_response)
            mock_client.return_value.__aenter__.return_value = mock_client_instance

            result = await analyze_project_health(config)

        assert result["success"] is True

    async def test_analyze_http_error(self, config, mock_settings):
        """Test HTTP error during analysis."""
        mock_response = MagicMock()
        mock_response.status_code = 500
        mock_response.text = "Internal Server Error"
        error = httpx.HTTPStatusError(
            "Server error",
            request=MagicMock(),
            response=mock_response,
        )

        with patch("src.tools.health_tools.get_settings", return_value=mock_settings), \
             patch("httpx.AsyncClient") as mock_client:
            mock_client_instance = AsyncMock()
            mock_client_instance.post = AsyncMock(side_effect=error)
            mock_client.return_value.__aenter__.return_value = mock_client_instance

            result = await analyze_project_health(config)

        assert result["success"] is False
        assert "error" in result
        assert "Internal Server Error" in result["error"]

    async def test_analyze_general_exception(self, config, mock_settings):
        """Test general exception during analysis."""
        with patch("src.tools.health_tools.get_settings", return_value=mock_settings), \
             patch("httpx.AsyncClient") as mock_client:
            mock_client_instance = AsyncMock()
            mock_client_instance.post = AsyncMock(side_effect=Exception("Network error"))
            mock_client.return_value.__aenter__.return_value = mock_client_instance

            result = await analyze_project_health(config)

        assert result["success"] is False
        assert "Network error" in result["error"]

    async def test_analyze_without_service_token(self, config):
        """Test analysis without service token."""
        settings = MagicMock()
        settings.API_BASE_URL = "http://localhost:8000"
        settings.INTERNAL_SERVICE_TOKEN = None

        mock_response = MagicMock()
        mock_response.json.return_value = {"id": "health-123", "status": "pending"}
        mock_response.raise_for_status = MagicMock()

        with patch("src.tools.health_tools.get_settings", return_value=settings), \
             patch("httpx.AsyncClient") as mock_client:
            mock_client_instance = AsyncMock()
            mock_client_instance.post = AsyncMock(return_value=mock_response)
            mock_client.return_value.__aenter__.return_value = mock_client_instance

            result = await analyze_project_health(config)

        assert result["success"] is True


class TestGetHealthScore:
    """Test get_health_score function."""

    @pytest.fixture
    def mock_settings(self):
        """Create mock settings."""
        settings = MagicMock()
        settings.API_BASE_URL = "http://localhost:8000"
        settings.INTERNAL_SERVICE_TOKEN = "test-token"
        return settings

    def test_get_health_score_exists(self):
        """Test get_health_score function exists."""
        assert get_health_score is not None
        assert callable(get_health_score)

    async def test_get_score_success(self, mock_settings):
        """Test successful score retrieval."""
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "overall_score": 85,
            "status": "completed",
            "analyzed_at": "2024-01-15T10:00:00Z",
            "categories": {
                "code_quality": 90,
                "test_coverage": 80,
                "security": 85,
            },
            "recommendations": ["Add more tests", "Fix linting issues"],
        }
        mock_response.raise_for_status = MagicMock()

        with patch("src.tools.health_tools.get_settings", return_value=mock_settings), \
             patch("httpx.AsyncClient") as mock_client:
            mock_client_instance = AsyncMock()
            mock_client_instance.get = AsyncMock(return_value=mock_response)
            mock_client.return_value.__aenter__.return_value = mock_client_instance

            result = await get_health_score("session-123", "user-456")

        assert result["success"] is True
        assert result["has_score"] is True
        assert result["overall_score"] == 85
        assert result["status"] == "completed"
        assert "code_quality" in result["categories"]
        assert len(result["recommendations"]) == 2

    async def test_get_score_no_result(self, mock_settings):
        """Test when no score exists."""
        mock_response = MagicMock()
        mock_response.json.return_value = None
        mock_response.raise_for_status = MagicMock()

        with patch("src.tools.health_tools.get_settings", return_value=mock_settings), \
             patch("httpx.AsyncClient") as mock_client:
            mock_client_instance = AsyncMock()
            mock_client_instance.get = AsyncMock(return_value=mock_response)
            mock_client.return_value.__aenter__.return_value = mock_client_instance

            result = await get_health_score("session-123", "user-456")

        assert result["success"] is True
        assert result["has_score"] is False
        assert "No health analysis" in result["message"]

    async def test_get_score_404_error(self, mock_settings):
        """Test 404 error returns no score."""
        mock_response = MagicMock()
        mock_response.status_code = 404
        error = httpx.HTTPStatusError(
            "Not found",
            request=MagicMock(),
            response=mock_response,
        )

        with patch("src.tools.health_tools.get_settings", return_value=mock_settings), \
             patch("httpx.AsyncClient") as mock_client:
            mock_client_instance = AsyncMock()
            mock_client_instance.get = AsyncMock(side_effect=error)
            mock_client.return_value.__aenter__.return_value = mock_client_instance

            result = await get_health_score("session-123", "user-456")

        assert result["success"] is True
        assert result["has_score"] is False

    async def test_get_score_other_http_error(self, mock_settings):
        """Test other HTTP errors."""
        mock_response = MagicMock()
        mock_response.status_code = 500
        mock_response.text = "Server error"
        error = httpx.HTTPStatusError(
            "Server error",
            request=MagicMock(),
            response=mock_response,
        )

        with patch("src.tools.health_tools.get_settings", return_value=mock_settings), \
             patch("httpx.AsyncClient") as mock_client:
            mock_client_instance = AsyncMock()
            mock_client_instance.get = AsyncMock(side_effect=error)
            mock_client.return_value.__aenter__.return_value = mock_client_instance

            result = await get_health_score("session-123", "user-456")

        assert result["success"] is False
        assert "Server error" in result["error"]

    async def test_get_score_general_exception(self, mock_settings):
        """Test general exception."""
        with patch("src.tools.health_tools.get_settings", return_value=mock_settings), \
             patch("httpx.AsyncClient") as mock_client:
            mock_client_instance = AsyncMock()
            mock_client_instance.get = AsyncMock(side_effect=Exception("Network error"))
            mock_client.return_value.__aenter__.return_value = mock_client_instance

            result = await get_health_score("session-123", "user-456")

        assert result["success"] is False
        assert "Network error" in result["error"]


class TestApplyHealthFix:
    """Test apply_health_fix function."""

    @pytest.fixture
    def mock_settings(self):
        """Create mock settings."""
        settings = MagicMock()
        settings.API_BASE_URL = "http://localhost:8000"
        settings.INTERNAL_SERVICE_TOKEN = "test-token"
        return settings

    def test_apply_health_fix_exists(self):
        """Test apply_health_fix function exists."""
        assert apply_health_fix is not None
        assert callable(apply_health_fix)

    async def test_apply_fix_success(self, mock_settings):
        """Test successful fix application."""
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "command": "npm audit fix",
            "output": "Fixed 5 vulnerabilities",
            "exit_code": 0,
        }
        mock_response.raise_for_status = MagicMock()

        with patch("src.tools.health_tools.get_settings", return_value=mock_settings), \
             patch("httpx.AsyncClient") as mock_client:
            mock_client_instance = AsyncMock()
            mock_client_instance.post = AsyncMock(return_value=mock_response)
            mock_client.return_value.__aenter__.return_value = mock_client_instance

            result = await apply_health_fix(
                session_id="session-123",
                user_id="user-456",
                recommendation_id="rec-789",
            )

        assert result["success"] is True
        assert result["message"] == "Fix applied successfully"
        assert result["command"] == "npm audit fix"
        assert result["exit_code"] == 0

    async def test_apply_fix_with_workspace_id(self, mock_settings):
        """Test fix with workspace_id."""
        mock_response = MagicMock()
        mock_response.json.return_value = {"command": "fix", "output": "done"}
        mock_response.raise_for_status = MagicMock()

        with patch("src.tools.health_tools.get_settings", return_value=mock_settings), \
             patch("httpx.AsyncClient") as mock_client:
            mock_client_instance = AsyncMock()
            mock_client_instance.post = AsyncMock(return_value=mock_response)
            mock_client.return_value.__aenter__.return_value = mock_client_instance

            result = await apply_health_fix(
                session_id="session-123",
                user_id="user-456",
                recommendation_id="rec-789",
                workspace_id="workspace-abc",
            )

        assert result["success"] is True

    async def test_apply_fix_http_error(self, mock_settings):
        """Test HTTP error during fix."""
        mock_response = MagicMock()
        mock_response.status_code = 400
        mock_response.text = "Invalid recommendation"
        error = httpx.HTTPStatusError(
            "Bad request",
            request=MagicMock(),
            response=mock_response,
        )

        with patch("src.tools.health_tools.get_settings", return_value=mock_settings), \
             patch("httpx.AsyncClient") as mock_client:
            mock_client_instance = AsyncMock()
            mock_client_instance.post = AsyncMock(side_effect=error)
            mock_client.return_value.__aenter__.return_value = mock_client_instance

            result = await apply_health_fix(
                session_id="session-123",
                user_id="user-456",
                recommendation_id="rec-789",
            )

        assert result["success"] is False
        assert "Invalid recommendation" in result["error"]

    async def test_apply_fix_general_exception(self, mock_settings):
        """Test general exception during fix."""
        with patch("src.tools.health_tools.get_settings", return_value=mock_settings), \
             patch("httpx.AsyncClient") as mock_client:
            mock_client_instance = AsyncMock()
            mock_client_instance.post = AsyncMock(side_effect=Exception("Timeout"))
            mock_client.return_value.__aenter__.return_value = mock_client_instance

            result = await apply_health_fix(
                session_id="session-123",
                user_id="user-456",
                recommendation_id="rec-789",
            )

        assert result["success"] is False
        assert "Timeout" in result["error"]


class TestListHealthChecks:
    """Test list_health_checks function."""

    @pytest.fixture
    def mock_settings(self):
        """Create mock settings."""
        settings = MagicMock()
        settings.API_BASE_URL = "http://localhost:8000"
        settings.INTERNAL_SERVICE_TOKEN = "test-token"
        return settings

    def test_list_health_checks_exists(self):
        """Test list_health_checks function exists."""
        assert list_health_checks is not None
        assert callable(list_health_checks)

    async def test_list_checks_success(self, mock_settings):
        """Test successful checks listing."""
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "checks": [
                {"id": "check-1", "name": "ESLint", "category": "code_quality"},
                {"id": "check-2", "name": "Jest", "category": "test_coverage"},
            ],
            "total": 2,
        }
        mock_response.raise_for_status = MagicMock()

        with patch("src.tools.health_tools.get_settings", return_value=mock_settings), \
             patch("httpx.AsyncClient") as mock_client:
            mock_client_instance = AsyncMock()
            mock_client_instance.get = AsyncMock(return_value=mock_response)
            mock_client.return_value.__aenter__.return_value = mock_client_instance

            result = await list_health_checks(
                session_id="session-123",
                user_id="user-456",
            )

        assert result["success"] is True
        assert len(result["checks"]) == 2
        assert result["total"] == 2

    async def test_list_checks_with_category(self, mock_settings):
        """Test listing checks filtered by category."""
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "checks": [{"id": "check-1", "name": "ESLint", "category": "code_quality"}],
            "total": 1,
        }
        mock_response.raise_for_status = MagicMock()

        with patch("src.tools.health_tools.get_settings", return_value=mock_settings), \
             patch("httpx.AsyncClient") as mock_client:
            mock_client_instance = AsyncMock()
            mock_client_instance.get = AsyncMock(return_value=mock_response)
            mock_client.return_value.__aenter__.return_value = mock_client_instance

            result = await list_health_checks(
                session_id="session-123",
                user_id="user-456",
                category="code_quality",
            )

        assert result["success"] is True
        assert result["total"] == 1

    async def test_list_checks_http_error(self, mock_settings):
        """Test HTTP error during listing."""
        mock_response = MagicMock()
        mock_response.status_code = 500
        mock_response.text = "Server error"
        error = httpx.HTTPStatusError(
            "Server error",
            request=MagicMock(),
            response=mock_response,
        )

        with patch("src.tools.health_tools.get_settings", return_value=mock_settings), \
             patch("httpx.AsyncClient") as mock_client:
            mock_client_instance = AsyncMock()
            mock_client_instance.get = AsyncMock(side_effect=error)
            mock_client.return_value.__aenter__.return_value = mock_client_instance

            result = await list_health_checks(
                session_id="session-123",
                user_id="user-456",
            )

        assert result["success"] is False
        assert "Server error" in result["error"]

    async def test_list_checks_general_exception(self, mock_settings):
        """Test general exception during listing."""
        with patch("src.tools.health_tools.get_settings", return_value=mock_settings), \
             patch("httpx.AsyncClient") as mock_client:
            mock_client_instance = AsyncMock()
            mock_client_instance.get = AsyncMock(side_effect=Exception("Connection refused"))
            mock_client.return_value.__aenter__.return_value = mock_client_instance

            result = await list_health_checks(
                session_id="session-123",
                user_id="user-456",
            )

        assert result["success"] is False
        assert "Connection refused" in result["error"]
