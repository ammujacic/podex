"""Tests for dependency injection."""

from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from src.deps import (
    OrchestratorSingleton,
    get_compute_manager,
    get_user_id,
    validate_internal_auth,
)


class TestInternalAuth:
    """Tests for internal authentication."""

    def test_internal_auth_no_token_configured_dev(self) -> None:
        """Test no service token in development mode - fails closed with 500.

        SECURITY: Even in development, if no token is configured,
        the service should fail closed (500) rather than allowing access.
        """
        mock_settings = MagicMock()
        mock_settings.internal_service_token = ""
        mock_settings.environment = "development"

        with patch("src.deps.settings", mock_settings):
            with pytest.raises(HTTPException) as exc:
                validate_internal_auth(None)
            assert exc.value.status_code == 500
            assert "not configured" in exc.value.detail

    def test_internal_auth_no_token_configured_prod(self) -> None:
        """Test no service token configured in production returns 500.

        SECURITY: Fail closed - if no token is configured, the service
        returns 500 (misconfiguration) rather than allowing unauthenticated access.
        """
        mock_settings = MagicMock()
        mock_settings.internal_service_token = ""
        mock_settings.environment = "production"

        with patch("src.deps.settings", mock_settings):
            with pytest.raises(HTTPException) as exc:
                validate_internal_auth(None)
            assert exc.value.status_code == 500
            assert "not configured" in exc.value.detail

    def test_internal_auth_missing_token(self) -> None:
        """Test missing service token when configured."""
        mock_settings = MagicMock()
        mock_settings.internal_service_token = "correct-token"
        mock_settings.environment = "development"

        with patch("src.deps.settings", mock_settings):
            with pytest.raises(HTTPException) as exc:
                validate_internal_auth(None)
            assert exc.value.status_code == 401
            assert "Missing" in exc.value.detail

    def test_internal_auth_invalid_token(self) -> None:
        """Test invalid internal service token."""
        mock_settings = MagicMock()
        mock_settings.internal_service_token = "correct-token"
        mock_settings.environment = "development"

        with patch("src.deps.settings", mock_settings):
            with pytest.raises(HTTPException) as exc:
                validate_internal_auth("wrong-token")
            assert exc.value.status_code == 401
            assert "Invalid" in exc.value.detail

    def test_internal_auth_valid_token(self) -> None:
        """Test valid internal service token."""
        mock_settings = MagicMock()
        mock_settings.internal_service_token = "test-service-token-123"
        mock_settings.environment = "development"

        with patch("src.deps.settings", mock_settings):
            validate_internal_auth("test-service-token-123")


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
