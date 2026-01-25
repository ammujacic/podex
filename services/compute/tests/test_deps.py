"""Tests for dependency injection."""

from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from src.config import Settings
from src.deps import (
    ComputeManagerSingleton,
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
        - GCP IAM (Authorization: Bearer token) - primary
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

        with patch("src.deps.settings", mock_settings):
            with pytest.raises(HTTPException) as exc:
                verify_internal_api_key(None)
            assert exc.value.status_code == 401
            assert "Missing" in exc.value.detail

    def test_internal_auth_invalid_key(self) -> None:
        """Test invalid internal API key."""
        mock_settings = MagicMock()
        mock_settings.internal_api_key = "correct-key"

        with patch("src.deps.settings", mock_settings):
            with pytest.raises(HTTPException) as exc:
                verify_internal_api_key("wrong-key")
            assert exc.value.status_code == 401
            assert "Invalid" in exc.value.detail

    def test_internal_auth_valid_key(self) -> None:
        """Test valid internal API key."""
        mock_settings = MagicMock()
        mock_settings.internal_api_key = "test-api-key-123"

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


class TestComputeManagerSingleton:
    """Tests for compute manager singleton."""

    def teardown_method(self) -> None:
        """Clear singleton after each test."""
        ComputeManagerSingleton.clear_instance()

    def test_get_instance_docker_mode(self) -> None:
        """Test getting Docker manager instance."""
        mock_settings = MagicMock()
        mock_settings.compute_mode = "docker"

        with patch("src.deps.settings", mock_settings):
            manager = ComputeManagerSingleton.get_instance()
            # In Docker mode, should create DockerComputeManager
            assert manager is not None

    def test_get_instance_singleton(self) -> None:
        """Test singleton pattern returns same instance."""
        mock_settings = MagicMock()
        mock_settings.compute_mode = "docker"

        with patch("src.deps.settings", mock_settings):
            manager1 = ComputeManagerSingleton.get_instance()
            manager2 = ComputeManagerSingleton.get_instance()
            assert manager1 is manager2

    def test_clear_instance(self) -> None:
        """Test clearing singleton instance."""
        mock_settings = MagicMock()
        mock_settings.compute_mode = "docker"

        with patch("src.deps.settings", mock_settings):
            ComputeManagerSingleton.get_instance()
            ComputeManagerSingleton.clear_instance()
            assert ComputeManagerSingleton._instance is None


class TestGetComputeManager:
    """Tests for get_compute_manager function."""

    def teardown_method(self) -> None:
        """Clear singleton after each test."""
        ComputeManagerSingleton.clear_instance()

    def test_get_compute_manager(self) -> None:
        """Test getting compute manager via dependency."""
        mock_settings = MagicMock()
        mock_settings.compute_mode = "docker"

        with patch("src.deps.settings", mock_settings):
            manager = get_compute_manager()
            assert manager is not None


class TestSettingsComputeMode:
    """Tests for compute mode settings."""

    def test_settings_compute_mode_docker(self) -> None:
        """Test settings for docker compute mode."""
        settings = Settings(compute_mode="docker")
        assert settings.compute_mode == "docker"

    def test_settings_compute_mode_gcp(self) -> None:
        """Test settings for gcp compute mode."""
        settings = Settings(compute_mode="gcp")
        assert settings.compute_mode == "gcp"
