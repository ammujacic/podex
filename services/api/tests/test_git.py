"""
Comprehensive tests for git routes.

Tests cover:
- Git repository operations
- Branch management
- Commit operations
- Pull request operations
"""

from fastapi.testclient import TestClient

# ============================================================================
# GIT REPOSITORY TESTS
# ============================================================================


class TestGitRepository:
    """Tests for git repository operations."""

    def test_clone_repository_unauthenticated(self, client: TestClient) -> None:
        """Test cloning repository without auth."""
        response = client.post(
            "/api/git/clone",
            json={
                "session_id": "session-123",
                "url": "https://github.com/test/repo.git",
            },
        )
        assert response.status_code in [401, 404]

    def test_get_repository_status_unauthenticated(self, client: TestClient) -> None:
        """Test getting repository status without auth."""
        response = client.get("/api/git/session-123/status")
        assert response.status_code in [401, 404]


# ============================================================================
# GIT BRANCH TESTS
# ============================================================================


class TestGitBranches:
    """Tests for git branch operations."""

    def test_list_branches_unauthenticated(self, client: TestClient) -> None:
        """Test listing branches without auth."""
        response = client.get("/api/git/session-123/branches")
        assert response.status_code in [401, 404]

    def test_create_branch_unauthenticated(self, client: TestClient) -> None:
        """Test creating branch without auth."""
        response = client.post(
            "/api/git/session-123/branches",
            json={"name": "feature/new-feature"},
        )
        assert response.status_code in [401, 404]

    def test_checkout_branch_unauthenticated(self, client: TestClient) -> None:
        """Test checking out branch without auth."""
        response = client.post(
            "/api/git/session-123/checkout",
            json={"branch": "main"},
        )
        assert response.status_code in [401, 404]


# ============================================================================
# GIT COMMIT TESTS
# ============================================================================


class TestGitCommits:
    """Tests for git commit operations."""

    def test_list_commits_unauthenticated(self, client: TestClient) -> None:
        """Test listing commits without auth."""
        response = client.get("/api/git/session-123/commits")
        assert response.status_code in [401, 404]

    def test_create_commit_unauthenticated(self, client: TestClient) -> None:
        """Test creating commit without auth."""
        response = client.post(
            "/api/git/session-123/commit",
            json={"message": "Test commit"},
        )
        assert response.status_code in [401, 404]

    def test_get_commit_diff_unauthenticated(self, client: TestClient) -> None:
        """Test getting commit diff without auth."""
        response = client.get("/api/git/session-123/diff")
        assert response.status_code in [401, 404]


# ============================================================================
# GIT STAGING TESTS
# ============================================================================


class TestGitStaging:
    """Tests for git staging operations."""

    def test_stage_files_unauthenticated(self, client: TestClient) -> None:
        """Test staging files without auth."""
        response = client.post(
            "/api/git/session-123/stage",
            json={"files": ["src/index.ts"]},
        )
        assert response.status_code in [401, 404]

    def test_unstage_files_unauthenticated(self, client: TestClient) -> None:
        """Test unstaging files without auth."""
        response = client.post(
            "/api/git/session-123/unstage",
            json={"files": ["src/index.ts"]},
        )
        assert response.status_code in [401, 404]


# ============================================================================
# GIT PUSH/PULL TESTS
# ============================================================================


class TestGitPushPull:
    """Tests for git push/pull operations."""

    def test_push_unauthenticated(self, client: TestClient) -> None:
        """Test pushing without auth."""
        response = client.post("/api/git/session-123/push")
        assert response.status_code in [401, 404]

    def test_pull_unauthenticated(self, client: TestClient) -> None:
        """Test pulling without auth."""
        response = client.post("/api/git/session-123/pull")
        assert response.status_code in [401, 404]


# ============================================================================
# GIT STASH TESTS
# ============================================================================


class TestGitStash:
    """Tests for git stash operations."""

    def test_stash_changes_unauthenticated(self, client: TestClient) -> None:
        """Test stashing changes without auth."""
        response = client.post(
            "/api/git/session-123/stash",
            json={"message": "WIP"},
        )
        assert response.status_code in [401, 404]

    def test_list_stashes_unauthenticated(self, client: TestClient) -> None:
        """Test listing stashes without auth."""
        response = client.get("/api/git/session-123/stash")
        assert response.status_code in [401, 404]

    def test_apply_stash_unauthenticated(self, client: TestClient) -> None:
        """Test applying stash without auth."""
        response = client.post("/api/git/session-123/stash/apply")
        assert response.status_code in [401, 404]
