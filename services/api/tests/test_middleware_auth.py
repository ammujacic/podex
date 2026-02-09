"""Comprehensive tests for authentication middleware."""

from typing import Any
from unittest.mock import MagicMock

import pytest
from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient
from jose import jwt as jose_jwt

from src.middleware.auth import (
    PUBLIC_PATHS,
    AuthMiddleware,
    _is_public_path,
    get_current_user,
    get_current_user_id,
)


class TestIsPublicPath:
    """Tests for _is_public_path function."""

    def test_exact_match_public_path(self) -> None:
        """Test exact match for public and private paths."""
        assert _is_public_path("/health") is True
        assert _is_public_path("/api/docs") is False
        assert _is_public_path("/api/redoc") is False
        assert _is_public_path("/api/openapi.json") is False

    def test_auth_endpoints_are_public(self) -> None:
        """Test auth endpoints are public."""
        assert _is_public_path("/api/auth/login") is True
        assert _is_public_path("/api/auth/register") is True
        assert _is_public_path("/api/auth/refresh") is True
        assert _is_public_path("/api/auth/password/check") is True

    def test_oauth_endpoints_are_public(self) -> None:
        """Test OAuth login/signup endpoints are public (but link-authorize requires auth)."""
        # Authorize endpoints for login/signup
        assert _is_public_path("/api/oauth/github/authorize") is True
        assert _is_public_path("/api/oauth/github/callback") is True
        assert _is_public_path("/api/oauth/github/callback-auto") is True
        assert _is_public_path("/api/oauth/google/authorize") is True
        assert _is_public_path("/api/oauth/google/callback") is True
        assert _is_public_path("/api/oauth/google/callback-auto") is True
        # Link-authorize requires authentication (for account linking)
        assert _is_public_path("/api/oauth/github/link-authorize") is False
        assert _is_public_path("/api/oauth/google/link-authorize") is False

    def test_preview_endpoints_require_auth(self) -> None:
        """Test preview endpoints are not public."""
        assert _is_public_path("/api/preview") is False
        assert _is_public_path("/api/preview/some-preview-id") is False

    def test_template_endpoints_require_auth(self) -> None:
        """Test template endpoints are not public."""
        assert _is_public_path("/api/templates") is False
        assert _is_public_path("/api/templates/nodejs") is False

    def test_webhook_endpoints_are_public(self) -> None:
        """Test webhook endpoints are public."""
        assert _is_public_path("/api/webhooks") is True
        assert _is_public_path("/api/webhooks/stripe") is True

    def test_socket_io_is_public(self) -> None:
        """Test socket.io endpoints are public."""
        assert _is_public_path("/socket.io") is True
        assert _is_public_path("/socket.io/") is True
        assert _is_public_path("/socket.io/connect") is True

    def test_private_paths(self) -> None:
        """Test private paths are not public."""
        assert _is_public_path("/api/sessions") is False
        assert _is_public_path("/api/agents") is False
        assert _is_public_path("/api/workspaces") is False
        assert _is_public_path("/api/user/profile") is False

    def test_path_traversal_prevention(self) -> None:
        """Test that path traversal doesn't bypass auth."""
        # These should not match /api/templates prefix without proper boundary
        assert _is_public_path("/api/templatesx") is False

    def test_prefix_match_with_slash(self) -> None:
        """Test prefix matching requires proper boundary."""
        # /socket.io is a prefix path, so subpaths work
        assert _is_public_path("/socket.io/") is True
        assert _is_public_path("/socket.io/connect") is True
        # But similar paths without proper boundary don't match
        assert _is_public_path("/socket.iox") is False
        # OAuth paths are exact matches, not prefixes
        assert _is_public_path("/api/oauth/github/callbackx") is False

    def test_admin_settings_public_requires_auth(self) -> None:
        """Test admin public settings endpoint is not public."""
        assert _is_public_path("/api/admin/settings/public") is False
        assert _is_public_path("/api/admin/settings/public/some-setting") is False


class TestGetCurrentUserId:
    """Tests for get_current_user_id function."""

    def test_get_user_id_success(self) -> None:
        """Test successful user ID extraction."""
        mock_request = MagicMock(spec=Request)
        mock_request.state.user_id = "user-123"

        result = get_current_user_id(mock_request)
        assert result == "user-123"

    def test_get_user_id_missing(self) -> None:
        """Test exception when user ID is missing."""
        mock_request = MagicMock(spec=Request)
        mock_request.state = MagicMock(spec=[])  # No user_id attribute

        with pytest.raises(HTTPException) as exc:
            get_current_user_id(mock_request)

        assert exc.value.status_code == 401
        assert "Not authenticated" in exc.value.detail

    def test_get_user_id_none(self) -> None:
        """Test exception when user ID is None."""
        mock_request = MagicMock(spec=Request)
        mock_request.state.user_id = None

        with pytest.raises(HTTPException) as exc:
            get_current_user_id(mock_request)

        assert exc.value.status_code == 401

    def test_get_user_id_converts_to_string(self) -> None:
        """Test that user ID is converted to string."""
        mock_request = MagicMock(spec=Request)
        mock_request.state.user_id = 12345  # Integer

        result = get_current_user_id(mock_request)
        assert result == "12345"
        assert isinstance(result, str)


class TestGetCurrentUser:
    """Tests for get_current_user function."""

    @pytest.mark.asyncio
    async def test_get_current_user_success(self) -> None:
        """Test successful user info extraction."""
        mock_request = MagicMock(spec=Request)
        mock_request.state.user_id = "user-123"
        mock_request.state.user_role = "admin"

        result = await get_current_user(mock_request)
        assert result["id"] == "user-123"
        assert result["role"] == "admin"

    @pytest.mark.asyncio
    async def test_get_current_user_default_role(self) -> None:
        """Test default role when not set."""
        mock_request = MagicMock(spec=Request)
        mock_request.state.user_id = "user-123"
        # Simulate missing user_role attribute
        del mock_request.state.user_role

        result = await get_current_user(mock_request)
        assert result["id"] == "user-123"
        assert result["role"] == "member"

    @pytest.mark.asyncio
    async def test_get_current_user_not_authenticated(self) -> None:
        """Test exception when user is not authenticated."""
        mock_request = MagicMock(spec=Request)
        mock_request.state = MagicMock(spec=[])

        with pytest.raises(HTTPException) as exc:
            await get_current_user(mock_request)

        assert exc.value.status_code == 401
        assert "Not authenticated" in exc.value.detail


class TestAuthMiddleware:
    """Tests for AuthMiddleware class."""

    @pytest.fixture
    def app_with_middleware(self) -> FastAPI:
        """Create a test app with auth middleware."""
        app = FastAPI()

        @app.get("/health")
        async def health() -> dict[str, str]:
            return {"status": "healthy"}

        @app.get("/api/auth/login")
        async def login() -> dict[str, str]:
            return {"message": "login page"}

        @app.get("/api/sessions")
        async def list_sessions(request: Request) -> dict[str, Any]:
            return {"user_id": request.state.user_id}

        @app.get("/api/user/profile")
        async def profile(request: Request) -> dict[str, Any]:
            return {"user_id": request.state.user_id, "role": request.state.user_role}

        app.add_middleware(AuthMiddleware)
        return app

    @pytest.fixture
    def client(self, app_with_middleware: FastAPI) -> TestClient:
        """Create test client."""
        return TestClient(app_with_middleware, raise_server_exceptions=False)

    def test_public_path_no_auth_required(self, client: TestClient) -> None:
        """Test public paths don't require authentication."""
        response = client.get("/health")
        assert response.status_code == 200

    def test_public_auth_path_no_auth_required(self, client: TestClient) -> None:
        """Test public auth paths don't require authentication."""
        response = client.get("/api/auth/login")
        assert response.status_code == 200

    def test_options_request_allowed(self, client: TestClient) -> None:
        """Test OPTIONS requests are allowed (CORS preflight)."""
        response = client.options("/api/sessions")
        # OPTIONS might return 405 if route doesn't explicitly support it,
        # but middleware should not return 401
        assert response.status_code != 401

    def test_protected_path_requires_auth(self, client: TestClient) -> None:
        """Test protected paths require authentication."""
        response = client.get("/api/sessions")
        assert response.status_code == 401
        assert "Authentication required" in response.json()["detail"]

    def test_invalid_auth_header_format(self, client: TestClient) -> None:
        """Test invalid authorization header format."""
        response = client.get(
            "/api/sessions",
            headers={"Authorization": "InvalidFormat token123"},
        )
        assert response.status_code == 401

    def test_missing_bearer_prefix(self, client: TestClient) -> None:
        """Test missing Bearer prefix."""
        response = client.get(
            "/api/sessions",
            headers={"Authorization": "token123"},
        )
        assert response.status_code == 401

    def test_expired_jwt_token(self, client: TestClient) -> None:
        """Test expired JWT token is rejected."""
        import time

        from src.config import settings

        token = jose_jwt.encode(
            {"sub": "user-123", "exp": int(time.time()) - 3600},  # Expired 1 hour ago
            settings.JWT_SECRET_KEY,
            algorithm=settings.JWT_ALGORITHM,
        )

        response = client.get(
            "/api/sessions",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 401
        assert "Invalid or expired token" in response.json()["detail"]

    def test_invalid_jwt_signature(self, client: TestClient) -> None:
        """Test invalid JWT signature is rejected."""
        token = jose_jwt.encode(
            {"sub": "user-123"},
            "wrong-secret-key",
            algorithm="HS256",
        )

        response = client.get(
            "/api/sessions",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 401

    def test_malformed_jwt_token(self, client: TestClient) -> None:
        """Test malformed JWT token is rejected."""
        response = client.get(
            "/api/sessions",
            headers={"Authorization": "Bearer not.a.valid.jwt.token"},
        )
        assert response.status_code == 401

    def test_jwt_without_sub_claim(self, client: TestClient) -> None:
        """Test JWT without sub claim is rejected."""
        from src.config import settings

        token = jose_jwt.encode(
            {"role": "admin"},  # No 'sub' claim
            settings.JWT_SECRET_KEY,
            algorithm=settings.JWT_ALGORITHM,
        )

        response = client.get(
            "/api/sessions",
            headers={"Authorization": f"Bearer {token}"},
        )
        # Middleware rejects tokens without a user ID (sub claim)
        assert response.status_code == 401
        assert "missing user ID" in response.json()["detail"]


class TestPublicPathsList:
    """Tests for PUBLIC_PATHS configuration."""

    def test_public_paths_is_list_of_tuples(self) -> None:
        """Test PUBLIC_PATHS structure."""
        assert isinstance(PUBLIC_PATHS, list)
        for item in PUBLIC_PATHS:
            assert isinstance(item, tuple)
            assert len(item) == 2
            assert isinstance(item[0], str)
            assert isinstance(item[1], bool)

    def test_health_is_exact_match(self) -> None:
        """Test /health is exact match only."""
        for path, is_prefix in PUBLIC_PATHS:
            if path == "/health":
                assert is_prefix is False
                break

    def test_oauth_paths_are_exact_match(self) -> None:
        """Test OAuth paths are exact matches (not prefixes) for security."""
        for path, is_prefix in PUBLIC_PATHS:
            if "oauth" in path:
                # All OAuth paths should be exact matches to prevent
                # accidentally exposing link-authorize or other subpaths
                assert is_prefix is False, f"{path} should be exact match"

    def test_socket_io_is_prefix(self) -> None:
        """Test socket.io allows subpaths."""
        for path, is_prefix in PUBLIC_PATHS:
            if path == "/socket.io":
                assert is_prefix is True
                break
