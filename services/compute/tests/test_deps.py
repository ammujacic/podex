"""Tests for dependency injection."""

from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from src.deps import (
    OrchestratorSingleton,
    get_compute_manager,
    get_user_id,
    verify_internal_api_key,
)


class TestInternalAuth:
    """Tests for internal authentication."""

    def test_internal_auth_no_key_configured_dev(self) -> None:
        """Test no API key in development mode."""
        mock_settings = MagicMock()
        mock_settings.internal_api_key = ""
        mock_settings.environment = "development"

        with patch("src.deps.settings", mock_settings):
            # Should not raise in development
            verify_internal_api_key(None)

    def test_internal_auth_no_key_configured_prod(self) -> None:
        """Test no API key configured in production returns 401.

        In production mode, authentication is required via:
        - Bearer token (Authorization header) - primary
        - API key (X-Internal-API-Key) - fallback

        When neither is provided, it's an auth failure (401), not server error.
        """
        mock_settings = MagicMock()
        mock_settings.internal_api_key = ""
        mock_settings.environment = "production"

        with patch("src.deps.settings", mock_settings):
            with pytest.raises(HTTPException) as exc:
                verify_internal_api_key(None)
            assert exc.value.status_code == 401

    def test_internal_auth_missing_key(self) -> None:
        """Test missing API key when configured."""
        mock_settings = MagicMock()
        mock_settings.internal_api_key = "correct-key"
        mock_settings.environment = "development"

        with patch("src.deps.settings", mock_settings):
            with pytest.raises(HTTPException) as exc:
                verify_internal_api_key(None)
            assert exc.value.status_code == 401
            assert "Missing" in exc.value.detail

    def test_internal_auth_invalid_key(self) -> None:
        """Test invalid internal API key."""
        mock_settings = MagicMock()
        mock_settings.internal_api_key = "correct-key"
        mock_settings.environment = "development"

        with patch("src.deps.settings", mock_settings):
            with pytest.raises(HTTPException) as exc:
                verify_internal_api_key("wrong-key")
            assert exc.value.status_code == 401
            assert "Invalid" in exc.value.detail

    def test_internal_auth_valid_key(self) -> None:
        """Test valid internal API key."""
        mock_settings = MagicMock()
        mock_settings.internal_api_key = "test-api-key-123"
        mock_settings.environment = "development"

        with patch("src.deps.settings", mock_settings):
            verify_internal_api_key("test-api-key-123")


class TestUserIdExtraction:
    """Tests for user ID extraction from headers."""

    def test_get_user_id_success(self) -> None:
        """Test successful user ID extraction."""
        result = get_user_id("user_123")
        assert result == "user_123"

    def test_get_user_id_missing(self) -> None:
        """Test missing user ID."""
        with pytest.raises(HTTPException) as exc:
            get_user_id(None)
        assert exc.value.status_code == 401
        assert "Missing user ID" in exc.value.detail


class TestOrchestratorSingleton:
    """Tests for orchestrator singleton."""

    def teardown_method(self) -> None:
        """Clear singleton after each test."""
        OrchestratorSingleton.clear_instance()

    def test_get_orchestrator(self) -> None:
        """Test getting orchestrator instance."""
        orchestrator = OrchestratorSingleton.get_orchestrator()
        assert orchestrator is not None

    def test_get_orchestrator_singleton(self) -> None:
        """Test singleton pattern returns same instance."""
        orchestrator1 = OrchestratorSingleton.get_orchestrator()
        orchestrator2 = OrchestratorSingleton.get_orchestrator()
        assert orchestrator1 is orchestrator2

    def test_get_compute_manager(self) -> None:
        """Test getting compute manager instance."""
        manager = OrchestratorSingleton.get_compute_manager()
        assert manager is not None

    def test_clear_instance(self) -> None:
        """Test clearing singleton instance."""
        OrchestratorSingleton.get_orchestrator()
        OrchestratorSingleton.clear_instance()
        assert OrchestratorSingleton._orchestrator is None
        assert OrchestratorSingleton._compute_manager is None


class TestGetComputeManager:
    """Tests for get_compute_manager function."""

    def teardown_method(self) -> None:
        """Clear singleton after each test."""
        OrchestratorSingleton.clear_instance()

    def test_get_compute_manager(self) -> None:
        """Test getting compute manager via dependency."""
        manager = get_compute_manager()
        assert manager is not None
