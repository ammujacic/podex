"""Tests for deps module.

Tests cover:
- Internal service token authentication
"""

import pytest
from typing import Any
from unittest.mock import MagicMock, patch
from fastapi import HTTPException


class TestDepsModule:
    """Test deps module."""

    def test_deps_module_exists(self):
        """Test deps module can be imported."""
        from src import deps
        assert deps is not None

    def test_require_internal_service_token_function_exists(self):
        """Test require_internal_service_token function exists."""
        from src.deps import require_internal_service_token
        assert callable(require_internal_service_token)


class TestRequireInternalServiceToken:
    """Test require_internal_service_token function."""

    def test_dev_mode_no_token_configured_allows_request(self):
        """Test dev mode with no token configured allows all requests."""
        from src.deps import require_internal_service_token

        with patch("src.deps.settings") as mock_settings:
            mock_settings.ENVIRONMENT = "development"
            mock_settings.INTERNAL_SERVICE_TOKEN = None

            # Should not raise
            require_internal_service_token(None, None)

    def test_dev_mode_valid_header_token(self):
        """Test dev mode with valid X-Internal-Service-Token header."""
        from src.deps import require_internal_service_token

        with patch("src.deps.settings") as mock_settings:
            mock_settings.ENVIRONMENT = "development"
            mock_settings.INTERNAL_SERVICE_TOKEN = "secret-token"

            # Should not raise
            require_internal_service_token(
                x_internal_service_token="secret-token",
                authorization=None,
            )

    def test_dev_mode_valid_bearer_token(self):
        """Test dev mode with valid Bearer token."""
        from src.deps import require_internal_service_token

        with patch("src.deps.settings") as mock_settings:
            mock_settings.ENVIRONMENT = "development"
            mock_settings.INTERNAL_SERVICE_TOKEN = "secret-token"

            # Should not raise
            require_internal_service_token(
                x_internal_service_token=None,
                authorization="Bearer secret-token",
            )

    def test_dev_mode_invalid_token_raises(self):
        """Test dev mode with invalid token raises HTTPException."""
        from src.deps import require_internal_service_token

        with patch("src.deps.settings") as mock_settings:
            mock_settings.ENVIRONMENT = "development"
            mock_settings.INTERNAL_SERVICE_TOKEN = "secret-token"

            with pytest.raises(HTTPException) as exc_info:
                require_internal_service_token(
                    x_internal_service_token="wrong-token",
                    authorization=None,
                )

            assert exc_info.value.status_code == 401

    def test_dev_mode_missing_token_raises(self):
        """Test dev mode with missing token raises HTTPException."""
        from src.deps import require_internal_service_token

        with patch("src.deps.settings") as mock_settings:
            mock_settings.ENVIRONMENT = "development"
            mock_settings.INTERNAL_SERVICE_TOKEN = "secret-token"

            with pytest.raises(HTTPException) as exc_info:
                require_internal_service_token(
                    x_internal_service_token=None,
                    authorization=None,
                )

            assert exc_info.value.status_code == 401

    def test_production_mode_with_bearer_token(self):
        """Test production mode with Bearer token (IAM validated)."""
        from src.deps import require_internal_service_token

        with patch("src.deps.settings") as mock_settings:
            mock_settings.ENVIRONMENT = "production"

            # Should not raise - IAM validated
            require_internal_service_token(
                x_internal_service_token=None,
                authorization="Bearer gcp-id-token",
            )

    def test_production_mode_with_service_token_fallback(self):
        """Test production mode with service token fallback."""
        from src.deps import require_internal_service_token

        with patch("src.deps.settings") as mock_settings:
            mock_settings.ENVIRONMENT = "production"
            mock_settings.INTERNAL_SERVICE_TOKEN = "secret-token"

            # Should not raise
            require_internal_service_token(
                x_internal_service_token="secret-token",
                authorization=None,
            )

    def test_production_mode_missing_auth_raises(self):
        """Test production mode with missing authentication raises HTTPException."""
        from src.deps import require_internal_service_token

        with patch("src.deps.settings") as mock_settings:
            mock_settings.ENVIRONMENT = "production"
            mock_settings.INTERNAL_SERVICE_TOKEN = None

            with pytest.raises(HTTPException) as exc_info:
                require_internal_service_token(
                    x_internal_service_token=None,
                    authorization=None,
                )

            assert exc_info.value.status_code == 401
