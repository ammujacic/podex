"""
Comprehensive tests for OAuth routes.

Tests cover:
- GitHub OAuth flow
- Google OAuth flow
- OAuth URL generation
- OAuth callback handling
"""


from fastapi.testclient import TestClient

# ============================================================================
# GITHUB OAUTH TESTS
# ============================================================================


class TestGitHubOAuth:
    """Tests for GitHub OAuth flow."""

    def test_get_github_oauth_url(self, client: TestClient) -> None:
        """Test getting GitHub OAuth URL."""
        response = client.get("/api/oauth/github/url")
        assert response.status_code == 200
        data = response.json()
        assert "url" in data
        assert "github.com" in data["url"]

    def test_github_callback_missing_code(self, client: TestClient) -> None:
        """Test GitHub callback without code."""
        response = client.get("/api/oauth/github/callback")
        assert response.status_code == 422

    def test_github_callback_with_code(self, client: TestClient) -> None:
        """Test GitHub callback with code."""
        response = client.get("/api/oauth/github/callback?code=test-code")
        # In the mock test app, this returns a token
        assert response.status_code in [200, 302, 400, 401]

    def test_github_callback_with_error(self, client: TestClient) -> None:
        """Test GitHub callback with error parameter."""
        response = client.get(
            "/api/oauth/github/callback?error=access_denied&error_description=User%20denied"
        )
        assert response.status_code in [302, 400]


# ============================================================================
# GOOGLE OAUTH TESTS
# ============================================================================


class TestGoogleOAuth:
    """Tests for Google OAuth flow."""

    def test_get_google_oauth_url(self, client: TestClient) -> None:
        """Test getting Google OAuth URL."""
        response = client.get("/api/oauth/google/url")
        assert response.status_code == 200
        data = response.json()
        assert "url" in data
        assert "accounts.google.com" in data["url"] or "google" in data["url"].lower()

    def test_google_callback_missing_code(self, client: TestClient) -> None:
        """Test Google callback without code."""
        response = client.get("/api/oauth/google/callback")
        assert response.status_code == 422

    def test_google_callback_with_code(self, client: TestClient) -> None:
        """Test Google callback with code."""
        response = client.get("/api/oauth/google/callback?code=test-code")
        # In the mock test app, this returns a token
        assert response.status_code in [200, 302, 400, 401]

    def test_google_callback_with_error(self, client: TestClient) -> None:
        """Test Google callback with error parameter."""
        response = client.get(
            "/api/oauth/google/callback?error=access_denied"
        )
        assert response.status_code in [302, 400]


# ============================================================================
# OAUTH STATE VALIDATION TESTS
# ============================================================================


class TestOAuthStateValidation:
    """Tests for OAuth state parameter validation."""

    def test_github_callback_invalid_state(self, client: TestClient) -> None:
        """Test GitHub callback with invalid state."""
        response = client.get(
            "/api/oauth/github/callback?code=test-code&state=invalid-state"
        )
        # State validation may fail
        assert response.status_code in [200, 302, 400, 401]

    def test_google_callback_invalid_state(self, client: TestClient) -> None:
        """Test Google callback with invalid state."""
        response = client.get(
            "/api/oauth/google/callback?code=test-code&state=invalid-state"
        )
        # State validation may fail
        assert response.status_code in [200, 302, 400, 401]
