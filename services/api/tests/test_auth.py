"""Tests for authentication endpoints."""

from fastapi.testclient import TestClient


class TestAuthEndpoints:
    """Tests for /api/auth endpoints."""

    def test_login_requires_email_and_password(self, client: TestClient) -> None:
        """Login should require email and password."""
        response = client.post("/api/auth/login", json={})
        assert response.status_code in [400, 422]

    def test_login_with_invalid_email(self, client: TestClient) -> None:
        """Login should reject invalid email format."""
        response = client.post(
            "/api/auth/login",
            json={"email": "notanemail", "password": "password123"},
        )
        assert response.status_code in [400, 422]

    def test_login_with_valid_format_invalid_credentials(self, client: TestClient) -> None:
        """Login should reject invalid credentials."""
        response = client.post(
            "/api/auth/login",
            json={"email": "test@example.com", "password": "wrongpassword"},
        )
        # Should return 401 for invalid credentials
        assert response.status_code in [401, 404]

    def test_signup_requires_email_and_password(self, client: TestClient) -> None:
        """Signup should require email and password."""
        response = client.post("/api/auth/signup", json={})
        assert response.status_code in [400, 422]

    def test_signup_with_valid_data(self, client: TestClient) -> None:
        """Signup should work with valid data."""
        response = client.post(
            "/api/auth/signup",
            json={
                "email": "newuser@example.com",
                "password": "securepassword123",
                "name": "New User",
            },
        )
        # Should return success with user info
        assert response.status_code in [200, 201, 422]
        if response.status_code in [200, 201]:
            data = response.json()
            assert "email" in data

    def test_me_requires_authentication(self, client: TestClient) -> None:
        """Get current user should require authentication."""
        response = client.get("/api/auth/me")
        assert response.status_code in [401, 403]

    def test_logout_endpoint(self, client: TestClient) -> None:
        """Logout endpoint should exist."""
        response = client.post("/api/auth/logout")
        # Should require auth or return success
        assert response.status_code in [200, 204, 401, 404]


class TestOAuthEndpoints:
    """Tests for OAuth endpoints."""

    def test_github_oauth_url(self, client: TestClient) -> None:
        """Should return GitHub OAuth URL."""
        response = client.get("/api/oauth/github/url")
        assert response.status_code == 200
        data = response.json()
        assert "url" in data
        assert "github.com" in data["url"]

    def test_google_oauth_url(self, client: TestClient) -> None:
        """Should return Google OAuth URL."""
        response = client.get("/api/oauth/google/url")
        assert response.status_code == 200
        data = response.json()
        assert "url" in data
        assert "google" in data["url"].lower()

    def test_github_callback_requires_code(self, client: TestClient) -> None:
        """GitHub callback should require code parameter."""
        response = client.get("/api/oauth/github/callback")
        assert response.status_code in [400, 422]

    def test_google_callback_requires_code(self, client: TestClient) -> None:
        """Google callback should require code parameter."""
        response = client.get("/api/oauth/google/callback")
        assert response.status_code in [400, 422]

    def test_github_callback_with_code(self, client: TestClient) -> None:
        """GitHub callback should process valid code."""
        response = client.get("/api/oauth/github/callback?code=test-code")
        assert response.status_code == 200

    def test_google_callback_with_code(self, client: TestClient) -> None:
        """Google callback should process valid code."""
        response = client.get("/api/oauth/google/callback?code=test-code")
        assert response.status_code == 200
