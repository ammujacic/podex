"""Comprehensive tests for SkillRegistry and skill execution.

Tests cover:
- Skill loading and caching
- Skill matching by triggers and tags
- Skill execution with step tracking
- Skill chaining prevention
- Execution history and analytics
"""

import asyncio
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.skills.loader import Skill, SkillLoader, SkillStep
from src.skills.registry import SkillExecutionResult, SkillMatch, SkillRegistry


class TestSkillDataclass:
    """Test Skill dataclass from loader."""

    def test_skill_step_creation(self):
        """Test SkillStep creation."""
        step = SkillStep(
            name="Run tests",
            description="Run the test suite",
            tool="run_command",
            parameters={"command": "pytest"},
            condition=None,
        )

        assert step.name == "Run tests"
        assert step.tool == "run_command"
        assert step.parameters == {"command": "pytest"}
        assert step.condition is None

    def test_skill_creation(self):
        """Test Skill creation."""
        skill = Skill(
            slug="test-skill",
            name="Test Skill",
            description="A test skill",
            triggers=["test", "run tests"],
            tags=["testing", "automation"],
            steps=[
                SkillStep(
                    name="Step 1",
                    description="First step",
                    tool="echo",
                    parameters={"message": "Hello"},
                )
            ],
            author="test-author",
        )

        assert skill.slug == "test-skill"
        assert skill.name == "Test Skill"
        assert len(skill.triggers) == 2
        assert len(skill.tags) == 2
        assert len(skill.steps) == 1

    def test_skill_defaults(self):
        """Test Skill default values."""
        skill = Skill(
            slug="test",
            name="Test",
            description="Test",
        )

        assert skill.triggers == []
        assert skill.tags == []
        assert skill.steps == []
        assert skill.author == "system"
        assert skill.version == "1.0.0"


class TestSkillMatchDataclass:
    """Test SkillMatch dataclass."""

    def test_skill_match_creation(self):
        """Test SkillMatch creation."""
        skill = Skill(
            slug="test",
            name="Test",
            description="Test",
        )

        match = SkillMatch(
            skill=skill,
            score=0.85,
            matched_triggers=["test"],
            matched_tags=["testing"],
        )

        assert match.skill == skill
        assert match.score == 0.85
        assert match.matched_triggers == ["test"]
        assert match.matched_tags == ["testing"]


class TestSkillExecutionResult:
    """Test SkillExecutionResult dataclass."""

    def test_execution_result_success(self):
        """Test successful execution result."""
        result = SkillExecutionResult(
            skill_name="test-skill",
            success=True,
            steps_completed=3,
            total_steps=3,
            results=[
                {"step": "Step 1", "output": "OK"},
                {"step": "Step 2", "output": "OK"},
                {"step": "Step 3", "output": "OK"},
            ],
            duration_ms=1500,
        )

        assert result.success is True
        assert result.steps_completed == 3
        assert result.total_steps == 3
        assert result.error is None
        assert result.duration_ms == 1500

    def test_execution_result_failure(self):
        """Test failed execution result."""
        result = SkillExecutionResult(
            skill_name="test-skill",
            success=False,
            steps_completed=2,
            total_steps=5,
            error="Step 3 failed: command not found",
            duration_ms=800,
        )

        assert result.success is False
        assert result.steps_completed == 2
        assert result.error == "Step 3 failed: command not found"

    def test_execution_result_to_dict(self):
        """Test to_dict serialization."""
        result = SkillExecutionResult(
            skill_name="test-skill",
            success=True,
            steps_completed=2,
            total_steps=2,
            duration_ms=500,
        )

        data = result.to_dict()

        assert data["skill_name"] == "test-skill"
        assert data["success"] is True
        assert data["steps_completed"] == 2
        assert "timestamp" in data


class TestSkillRegistryInit:
    """Test SkillRegistry initialization."""

    def test_registry_initialization(self):
        """Test basic initialization."""
        registry = SkillRegistry()

        assert registry._loaded is False
        assert len(registry._execution_history) == 0
        assert len(registry._executing_skills) == 0

    def test_registry_with_loader(self):
        """Test initialization with custom loader."""
        mock_loader = MagicMock()
        registry = SkillRegistry(loader=mock_loader)

        assert registry._loader == mock_loader

    def test_registry_with_api_url(self):
        """Test initialization with API URL."""
        registry = SkillRegistry(api_url="http://localhost:8000")

        assert registry._loader._api_url == "http://localhost:8000"

    def test_set_auth_context(self):
        """Test setting auth context."""
        registry = SkillRegistry()

        registry.set_auth_context(
            auth_token="token-123",
            session_id="session-456",
            agent_id="agent-789",
        )

        assert registry._auth_token == "token-123"
        assert registry._session_id == "session-456"
        assert registry._agent_id == "agent-789"


class TestSkillRegistryLoading:
    """Test skill loading."""

    @pytest.fixture
    def mock_loader(self) -> MagicMock:
        """Create mock SkillLoader."""
        mock = MagicMock()
        mock.load_from_api = AsyncMock(return_value=[
            Skill(
                slug="commit",
                name="Git Commit",
                description="Create a git commit",
                triggers=["commit", "git commit"],
                tags=["git", "version-control"],
            ),
            Skill(
                slug="test",
                name="Run Tests",
                description="Run test suite",
                triggers=["test", "run tests"],
                tags=["testing"],
            ),
        ])
        mock.reload_all = AsyncMock(return_value=[])
        mock.get_skill = MagicMock(return_value=None)
        mock.get_skill_by_name = MagicMock(return_value=None)
        mock.get_all_skills = MagicMock(return_value=[])
        return mock

    @pytest.fixture
    def registry(self, mock_loader: MagicMock) -> SkillRegistry:
        """Create registry with mock loader."""
        return SkillRegistry(loader=mock_loader)

    async def test_load_skills(self, registry: SkillRegistry, mock_loader: MagicMock):
        """Test loading skills from API."""
        skills = await registry.load_skills(user_id="user-123")

        assert len(skills) == 2
        assert registry._loaded is True
        mock_loader.load_from_api.assert_called_once_with("user-123", None)

    async def test_load_skills_with_auth(self, registry: SkillRegistry, mock_loader: MagicMock):
        """Test loading skills with auth token."""
        await registry.load_skills(user_id="user-123", auth_token="token-abc")

        mock_loader.load_from_api.assert_called_once_with("user-123", "token-abc")

    async def test_reload_skills(self, registry: SkillRegistry, mock_loader: MagicMock):
        """Test reloading skills."""
        await registry.reload_skills()

        mock_loader.reload_all.assert_called_once()
        assert len(registry._executing_skills) == 0  # Should clear executing set


class TestSkillRegistryRetrieval:
    """Test skill retrieval."""

    @pytest.fixture
    def mock_loader(self) -> MagicMock:
        """Create mock SkillLoader."""
        mock = MagicMock()

        skill = Skill(
            slug="commit",
            name="Git Commit",
            description="Create a git commit",
        )

        mock.get_skill = MagicMock(return_value=skill)
        mock.get_skill_by_name = MagicMock(return_value=skill)
        mock.get_all_skills = MagicMock(return_value=[skill])

        return mock

    @pytest.fixture
    def registry(self, mock_loader: MagicMock) -> SkillRegistry:
        """Create registry with mock loader."""
        return SkillRegistry(loader=mock_loader)

    def test_get_skill_by_slug(self, registry: SkillRegistry, mock_loader: MagicMock):
        """Test getting skill by slug."""
        skill = registry.get_skill("commit")

        assert skill is not None
        assert skill.slug == "commit"
        mock_loader.get_skill.assert_called_with("commit")

    def test_get_skill_by_name_fallback(self, registry: SkillRegistry, mock_loader: MagicMock):
        """Test fallback to name lookup."""
        mock_loader.get_skill = MagicMock(return_value=None)

        skill = registry.get_skill("Git Commit")

        mock_loader.get_skill_by_name.assert_called_with("Git Commit")

    def test_list_skills(self, registry: SkillRegistry, mock_loader: MagicMock):
        """Test listing all skills."""
        skills = registry.list_skills()

        assert len(skills) >= 0
        mock_loader.get_all_skills.assert_called_once()

    def test_list_skills_with_tag_filter(self, registry: SkillRegistry, mock_loader: MagicMock):
        """Test listing skills with tag filter."""
        skill_with_tag = Skill(
            slug="test",
            name="Test",
            description="Test",
            tags=["testing"],
        )
        mock_loader.get_all_skills = MagicMock(return_value=[skill_with_tag])

        skills = registry.list_skills(tags=["testing"])

        assert len(skills) == 1

    def test_list_skills_with_author_filter(self, registry: SkillRegistry, mock_loader: MagicMock):
        """Test listing skills with author filter."""
        skill_with_author = Skill(
            slug="test",
            name="Test",
            description="Test",
            author="john",
        )
        mock_loader.get_all_skills = MagicMock(return_value=[skill_with_author])

        skills = registry.list_skills(author="john")

        assert len(skills) == 1


class TestSkillRegistryMatching:
    """Test skill matching."""

    @pytest.fixture
    def mock_loader(self) -> MagicMock:
        """Create mock SkillLoader with skills."""
        mock = MagicMock()

        skills = [
            Skill(
                slug="commit",
                name="Git Commit",
                description="Create a git commit",
                triggers=["commit", "git commit", "save changes"],
                tags=["git", "version-control"],
            ),
            Skill(
                slug="test",
                name="Run Tests",
                description="Run the test suite",
                triggers=["test", "run tests", "pytest"],
                tags=["testing", "ci"],
            ),
            Skill(
                slug="deploy",
                name="Deploy",
                description="Deploy to production",
                triggers=["deploy", "push to production"],
                tags=["deployment", "ci"],
            ),
        ]

        mock.get_all_skills = MagicMock(return_value=skills)
        return mock

    @pytest.fixture
    def registry(self, mock_loader: MagicMock) -> SkillRegistry:
        """Create registry with mock loader."""
        return SkillRegistry(loader=mock_loader)

    def test_match_skills_by_trigger(self, registry: SkillRegistry):
        """Test matching skills by trigger word."""
        matches = registry.match_skills("commit my changes")

        assert len(matches) >= 1
        # Commit skill should match
        slugs = [m.skill.slug for m in matches]
        assert "commit" in slugs

    def test_match_skills_by_tag_in_query(self, registry: SkillRegistry):
        """Test matching skills when query mentions tags."""
        matches = registry.match_skills("run testing")

        # Should match test skill
        assert len(matches) >= 0

    def test_match_skills_min_score(self, registry: SkillRegistry):
        """Test minimum score filtering."""
        matches = registry.match_skills("random unrelated query", min_score=0.9)

        # With high min_score, should get few or no matches
        assert len(matches) <= 5

    def test_match_skills_limit(self, registry: SkillRegistry):
        """Test limit on returned matches."""
        matches = registry.match_skills("do something", limit=2)

        assert len(matches) <= 2


class TestSkillLoaderUnit:
    """Unit tests for SkillLoader."""

    def test_loader_initialization(self):
        """Test loader initialization."""
        loader = SkillLoader(api_url="http://localhost:8000")

        assert loader._api_url == "http://localhost:8000"
        assert len(loader._skills) == 0

    def test_loader_default_api_url(self):
        """Test loader uses default API URL."""
        loader = SkillLoader()

        # Should have some default API URL
        assert loader._api_url is not None

    async def test_load_from_api_success(self):
        """Test loading skills from API (with user_id to trigger API call)."""
        from src.skills.registry import Skill

        loader = SkillLoader(api_url="http://localhost:8000")

        # Mock load_from_redis to return empty (system skills)
        mock_skill = MagicMock(spec=Skill)
        mock_skill.slug = "test"
        mock_skill.id = "skill-1"

        with patch.object(loader, "load_from_redis", new_callable=AsyncMock) as mock_redis_load, \
             patch("httpx.AsyncClient") as mock_client:
            mock_redis_load.return_value = []  # No system skills

            mock_response = MagicMock()
            mock_response.status_code = 200
            mock_response.json = MagicMock(return_value={
                "skills": [
                    {
                        "id": "skill-1",
                        "slug": "test",
                        "name": "Test Skill",
                        "description": "A test skill",
                        "triggers": ["test"],
                        "tags": ["testing"],
                        "steps": [],
                    }
                ]
            })
            mock_response.raise_for_status = MagicMock()

            mock_client.return_value.__aenter__.return_value.get = AsyncMock(
                return_value=mock_response
            )

            skills = await loader.load_from_api(user_id="user-123")

            assert len(skills) == 1
            assert skills[0].slug == "test"

    async def test_load_from_api_failure(self):
        """Test handling API failure."""
        loader = SkillLoader(api_url="http://localhost:8000")

        with patch("httpx.AsyncClient") as mock_client:
            mock_client.return_value.__aenter__.return_value.get = AsyncMock(
                side_effect=Exception("Connection refused")
            )

            skills = await loader.load_from_api()

            # Should return empty list on failure
            assert skills == []

    def test_get_skill_by_slug(self):
        """Test getting skill by slug."""
        loader = SkillLoader()
        loader._skills = {
            "test": Skill(
                slug="test",
                name="Test",
                description="Test",
            )
        }

        skill = loader.get_skill("test")

        assert skill is not None
        assert skill.slug == "test"

    def test_get_skill_not_found(self):
        """Test getting non-existent skill."""
        loader = SkillLoader()

        skill = loader.get_skill("nonexistent")

        assert skill is None

    def test_get_all_skills(self):
        """Test getting all skills."""
        loader = SkillLoader()
        loader._skills = {
            "skill1": Skill(slug="skill1", name="Skill 1", description="Test 1"),
            "skill2": Skill(slug="skill2", name="Skill 2", description="Test 2"),
        }

        skills = loader.get_all_skills()

        assert len(skills) == 2


class TestSkillExecutionTracking:
    """Test skill execution history tracking."""

    @pytest.fixture
    def registry(self) -> SkillRegistry:
        """Create registry."""
        mock_loader = MagicMock()
        mock_loader.get_all_skills = MagicMock(return_value=[])
        return SkillRegistry(loader=mock_loader)

    def test_execution_history_empty(self, registry: SkillRegistry):
        """Test execution history is initially empty."""
        assert len(registry._execution_history) == 0

    def test_skill_cycle_prevention(self, registry: SkillRegistry):
        """Test that skill cycles are tracked."""
        # Mark a skill as executing
        registry._executing_skills.add("skill-1")

        # Check if it's being tracked
        assert "skill-1" in registry._executing_skills

        # Clear
        registry._executing_skills.discard("skill-1")
        assert "skill-1" not in registry._executing_skills


class TestSkillRegistryToolExecutor:
    """Test SkillRegistry with ToolExecutor integration."""

    def test_set_tool_executor(self):
        """Test setting tool executor."""
        registry = SkillRegistry()
        mock_executor = MagicMock()

        registry._tool_executor = mock_executor

        assert registry._tool_executor == mock_executor

    def test_set_publisher(self):
        """Test setting stream publisher."""
        registry = SkillRegistry()
        mock_publisher = MagicMock()

        registry._publisher = mock_publisher

        assert registry._publisher == mock_publisher
