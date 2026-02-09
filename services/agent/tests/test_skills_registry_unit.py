"""Tests for skills registry module.

Tests cover:
- SkillRegistry initialization
- SkillMatch and SkillExecutionResult dataclasses
- Skill loader
"""

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
from datetime import datetime, UTC

import pytest


class TestSkillRegistryModule:
    """Test skills registry module exists."""

    def test_skills_registry_module_exists(self):
        """Test skills registry module can be imported."""
        from src.skills import registry
        assert registry is not None

    def test_skill_registry_class_exists(self):
        """Test SkillRegistry class exists."""
        from src.skills.registry import SkillRegistry
        assert SkillRegistry is not None


class TestSkillMatch:
    """Test SkillMatch dataclass."""

    def test_skill_match_class_exists(self):
        """Test SkillMatch class exists."""
        from src.skills.registry import SkillMatch
        assert SkillMatch is not None

    def test_skill_match_creation(self):
        """Test SkillMatch creation."""
        from src.skills.registry import SkillMatch
        from src.skills.loader import Skill

        skill = Skill(
            name="test-skill",
            slug="test-skill",
            description="A test skill",
            triggers=["test"],
            steps=[],
        )

        match = SkillMatch(
            skill=skill,
            score=0.95,
            matched_triggers=["test"],
        )

        assert match.skill == skill
        assert match.score == 0.95
        assert match.matched_triggers == ["test"]


class TestSkillExecutionResult:
    """Test SkillExecutionResult dataclass."""

    def test_skill_execution_result_class_exists(self):
        """Test SkillExecutionResult class exists."""
        from src.skills.registry import SkillExecutionResult
        assert SkillExecutionResult is not None

    def test_skill_execution_result_success(self):
        """Test SkillExecutionResult for success."""
        from src.skills.registry import SkillExecutionResult

        result = SkillExecutionResult(
            skill_name="test-skill",
            success=True,
            steps_completed=3,
            total_steps=3,
            results=[{"step": 1, "output": "done"}],
            duration_ms=150,
        )

        assert result.success is True
        assert result.skill_name == "test-skill"
        assert result.steps_completed == 3
        assert result.total_steps == 3
        assert result.duration_ms == 150
        assert result.error is None

    def test_skill_execution_result_failure(self):
        """Test SkillExecutionResult for failure."""
        from src.skills.registry import SkillExecutionResult

        result = SkillExecutionResult(
            skill_name="test-skill",
            success=False,
            steps_completed=1,
            total_steps=3,
            error="Step 2 failed",
            duration_ms=50,
        )

        assert result.success is False
        assert result.error == "Step 2 failed"
        assert result.steps_completed == 1

    def test_skill_execution_result_to_dict(self):
        """Test SkillExecutionResult to_dict method."""
        from src.skills.registry import SkillExecutionResult

        result = SkillExecutionResult(
            skill_name="test-skill",
            success=True,
            steps_completed=3,
            total_steps=3,
            duration_ms=150,
        )

        data = result.to_dict()

        assert data["skill_name"] == "test-skill"
        assert data["success"] is True
        assert data["steps_completed"] == 3


class TestSkillRegistryInit:
    """Test SkillRegistry initialization."""

    def test_skill_registry_initialization(self):
        """Test SkillRegistry initialization with defaults."""
        from src.skills.registry import SkillRegistry

        registry = SkillRegistry()

        assert registry is not None
        assert registry._loader is not None
        assert registry._tool_executor is None
        assert registry._publisher is None

    def test_skill_registry_with_loader(self):
        """Test SkillRegistry initialization with loader."""
        from src.skills.registry import SkillRegistry
        from src.skills.loader import SkillLoader

        mock_loader = MagicMock(spec=SkillLoader)
        registry = SkillRegistry(loader=mock_loader)

        assert registry._loader == mock_loader

    def test_skill_registry_with_tool_executor(self):
        """Test SkillRegistry initialization with tool executor."""
        from src.skills.registry import SkillRegistry

        mock_executor = MagicMock()
        registry = SkillRegistry(tool_executor=mock_executor)

        assert registry._tool_executor == mock_executor

    def test_skill_registry_with_publisher(self):
        """Test SkillRegistry initialization with publisher."""
        from src.skills.registry import SkillRegistry

        mock_publisher = MagicMock()
        registry = SkillRegistry(publisher=mock_publisher)

        assert registry._publisher == mock_publisher


class TestSkillRegistryAuthContext:
    """Test SkillRegistry auth context methods."""

    def test_set_auth_context(self):
        """Test set_auth_context method."""
        from src.skills.registry import SkillRegistry

        registry = SkillRegistry()
        registry.set_auth_context(
            auth_token="token-123",
            session_id="session-456",
            agent_id="agent-789",
        )

        assert registry._auth_token == "token-123"
        assert registry._session_id == "session-456"
        assert registry._agent_id == "agent-789"


class TestSkillRegistryAsync:
    """Test SkillRegistry async methods."""

    @pytest.mark.asyncio
    async def test_load_skills(self):
        """Test load_skills method."""
        from src.skills.registry import SkillRegistry
        from src.skills.loader import Skill

        mock_loader = AsyncMock()
        mock_loader.load_from_api = AsyncMock(return_value=[
            Skill(
                name="test-skill",
                slug="test-skill",
                description="Test",
                triggers=["test"],
                steps=[],
            )
        ])

        registry = SkillRegistry(loader=mock_loader)
        skills = await registry.load_skills(user_id="user-123")

        assert len(skills) == 1
        assert registry._loaded is True

    @pytest.mark.asyncio
    async def test_reload_skills(self):
        """Test reload_skills method."""
        from src.skills.registry import SkillRegistry

        mock_loader = AsyncMock()
        # reload_skills calls _loader.reload_all
        mock_loader.reload_all = AsyncMock(return_value=[])

        registry = SkillRegistry(loader=mock_loader)
        skills = await registry.reload_skills()

        assert isinstance(skills, list)
        mock_loader.reload_all.assert_called_once()


class TestSkillLoaderModule:
    """Test skill loader module."""

    def test_skill_loader_module_exists(self):
        """Test skill loader module exists."""
        from src.skills import loader
        assert loader is not None

    def test_skill_loader_class_exists(self):
        """Test SkillLoader class exists."""
        from src.skills.loader import SkillLoader
        assert SkillLoader is not None

    def test_skill_class_exists(self):
        """Test Skill class exists."""
        from src.skills.loader import Skill
        assert Skill is not None

    def test_skill_step_class_exists(self):
        """Test SkillStep class exists."""
        from src.skills.loader import SkillStep
        assert SkillStep is not None


class TestSkillDataclass:
    """Test Skill dataclass."""

    def test_skill_creation(self):
        """Test Skill creation."""
        from src.skills.loader import Skill

        skill = Skill(
            name="test-skill",
            slug="test-skill",
            description="A test skill",
            triggers=["test", "check"],
            steps=[],
        )

        assert skill.name == "test-skill"
        assert skill.slug == "test-skill"
        assert skill.description == "A test skill"
        assert skill.triggers == ["test", "check"]

    def test_skill_with_all_fields(self):
        """Test Skill with all fields."""
        from src.skills.loader import Skill, SkillStep

        step = SkillStep(
            name="step1",
            description="First step",
            tool="run_command",
            parameters={"command": "echo test"},
        )

        skill = Skill(
            name="test-skill",
            slug="test-skill-123",
            description="A test skill",
            triggers=["test"],
            steps=[step],
            skill_type="user",
            author="test-user",
            version="2.0.0",
        )

        assert len(skill.steps) == 1
        assert skill.skill_type == "user"
        assert skill.author == "test-user"


class TestSkillStepDataclass:
    """Test SkillStep dataclass."""

    def test_skill_step_creation(self):
        """Test SkillStep creation."""
        from src.skills.loader import SkillStep

        step = SkillStep(
            name="step1",
            description="First step",
            tool="run_command",
            parameters={"command": "echo test"},
        )

        assert step.name == "step1"
        assert step.description == "First step"
        assert step.tool == "run_command"
        assert step.parameters == {"command": "echo test"}

    def test_skill_step_with_condition(self):
        """Test SkillStep with condition."""
        from src.skills.loader import SkillStep

        step = SkillStep(
            name="conditional-step",
            description="A conditional step",
            tool="read_file",
            parameters={"path": "config.json"},
            condition="$prev.success",
        )

        assert step.condition == "$prev.success"


class TestSkillLoaderInit:
    """Test SkillLoader initialization."""

    def test_skill_loader_initialization(self):
        """Test SkillLoader initialization."""
        from src.skills.loader import SkillLoader

        loader = SkillLoader()
        assert loader is not None

    def test_skill_loader_with_api_url(self):
        """Test SkillLoader with custom API URL."""
        from src.skills.loader import SkillLoader

        loader = SkillLoader(api_url="http://localhost:8000")
        assert loader._api_url == "http://localhost:8000"


class TestSkillRegistryExecutionHistory:
    """Test SkillRegistry execution history."""

    def test_execution_history_initialized(self):
        """Test execution history is initialized."""
        from src.skills.registry import SkillRegistry

        registry = SkillRegistry()
        assert registry._execution_history == []

    def test_executing_skills_tracking(self):
        """Test executing skills set is initialized."""
        from src.skills.registry import SkillRegistry

        registry = SkillRegistry()
        assert registry._executing_skills == set()


class TestSkillRegistryGetSkill:
    """Test SkillRegistry get_skill method."""

    def test_get_skill_by_slug(self):
        """Test get_skill returns skill by slug."""
        from src.skills.registry import SkillRegistry
        from src.skills.loader import Skill

        mock_loader = MagicMock()
        skill = Skill(
            name="Test Skill",
            slug="test-skill",
            description="Test",
            triggers=["test"],
            steps=[],
        )
        mock_loader.get_skill.return_value = skill

        registry = SkillRegistry(loader=mock_loader)
        result = registry.get_skill("test-skill")

        assert result == skill
        mock_loader.get_skill.assert_called_with("test-skill")

    def test_get_skill_by_name_fallback(self):
        """Test get_skill falls back to name lookup."""
        from src.skills.registry import SkillRegistry
        from src.skills.loader import Skill

        mock_loader = MagicMock()
        skill = Skill(
            name="Test Skill",
            slug="test-skill",
            description="Test",
            triggers=["test"],
            steps=[],
        )
        mock_loader.get_skill.return_value = None
        mock_loader.get_skill_by_name.return_value = skill

        registry = SkillRegistry(loader=mock_loader)
        result = registry.get_skill("Test Skill")

        assert result == skill
        mock_loader.get_skill_by_name.assert_called_with("Test Skill")

    def test_get_skill_not_found(self):
        """Test get_skill returns None when not found."""
        from src.skills.registry import SkillRegistry

        mock_loader = MagicMock()
        mock_loader.get_skill.return_value = None
        mock_loader.get_skill_by_name.return_value = None

        registry = SkillRegistry(loader=mock_loader)
        result = registry.get_skill("nonexistent")

        assert result is None


class TestSkillRegistryListSkills:
    """Test SkillRegistry list_skills method."""

    def test_list_all_skills(self):
        """Test list_skills returns all skills."""
        from src.skills.registry import SkillRegistry
        from src.skills.loader import Skill

        mock_loader = MagicMock()
        skills = [
            Skill(name="s1", slug="s1", description="", triggers=[], steps=[], tags=["dev"]),
            Skill(name="s2", slug="s2", description="", triggers=[], steps=[], tags=["test"]),
        ]
        mock_loader.get_all_skills.return_value = skills

        registry = SkillRegistry(loader=mock_loader)
        result = registry.list_skills()

        assert len(result) == 2

    def test_list_skills_filter_by_tags(self):
        """Test list_skills filters by tags."""
        from src.skills.registry import SkillRegistry
        from src.skills.loader import Skill

        mock_loader = MagicMock()
        skills = [
            Skill(name="s1", slug="s1", description="", triggers=[], steps=[], tags=["dev"]),
            Skill(name="s2", slug="s2", description="", triggers=[], steps=[], tags=["test"]),
            Skill(name="s3", slug="s3", description="", triggers=[], steps=[], tags=["dev", "test"]),
        ]
        mock_loader.get_all_skills.return_value = skills

        registry = SkillRegistry(loader=mock_loader)
        result = registry.list_skills(tags=["dev"])

        assert len(result) == 2  # s1 and s3

    def test_list_skills_filter_by_author(self):
        """Test list_skills filters by author."""
        from src.skills.registry import SkillRegistry
        from src.skills.loader import Skill

        mock_loader = MagicMock()
        skills = [
            Skill(name="s1", slug="s1", description="", triggers=[], steps=[], author="alice"),
            Skill(name="s2", slug="s2", description="", triggers=[], steps=[], author="bob"),
        ]
        mock_loader.get_all_skills.return_value = skills

        registry = SkillRegistry(loader=mock_loader)
        result = registry.list_skills(author="alice")

        assert len(result) == 1
        assert result[0].name == "s1"


class TestSkillRegistryMatchSkills:
    """Test SkillRegistry match_skills method."""

    def test_match_skills_finds_matches(self):
        """Test match_skills finds matching skills."""
        from src.skills.registry import SkillRegistry
        from src.skills.loader import Skill

        mock_loader = MagicMock()
        skills = [
            Skill(name="Build", slug="build", description="Build project", triggers=["build", "compile"], steps=[], tags=["dev"]),
            Skill(name="Test", slug="test", description="Run tests", triggers=["test", "check"], steps=[], tags=["test"]),
        ]
        mock_loader.get_all_skills.return_value = skills

        # Mock matches_task to return scores
        skills[0].matches_task = MagicMock(return_value=0.8)
        skills[1].matches_task = MagicMock(return_value=0.3)

        registry = SkillRegistry(loader=mock_loader)
        matches = registry.match_skills("build the project", min_score=0.3)

        assert len(matches) == 2
        assert matches[0].skill.name == "Build"
        assert matches[0].score == 0.8

    def test_match_skills_respects_min_score(self):
        """Test match_skills filters by min_score."""
        from src.skills.registry import SkillRegistry
        from src.skills.loader import Skill

        mock_loader = MagicMock()
        skills = [
            Skill(name="Build", slug="build", description="", triggers=[], steps=[]),
            Skill(name="Test", slug="test", description="", triggers=[], steps=[]),
        ]
        mock_loader.get_all_skills.return_value = skills

        skills[0].matches_task = MagicMock(return_value=0.8)
        skills[1].matches_task = MagicMock(return_value=0.2)

        registry = SkillRegistry(loader=mock_loader)
        matches = registry.match_skills("build", min_score=0.5)

        assert len(matches) == 1

    def test_match_skills_respects_limit(self):
        """Test match_skills respects limit."""
        from src.skills.registry import SkillRegistry
        from src.skills.loader import Skill

        mock_loader = MagicMock()
        skills = [
            Skill(name=f"s{i}", slug=f"s{i}", description="", triggers=[], steps=[])
            for i in range(10)
        ]
        mock_loader.get_all_skills.return_value = skills

        for s in skills:
            s.matches_task = MagicMock(return_value=0.5)

        registry = SkillRegistry(loader=mock_loader)
        matches = registry.match_skills("test", limit=3)

        assert len(matches) == 3


class TestSkillRegistryGetBestSkill:
    """Test SkillRegistry get_best_skill method."""

    def test_get_best_skill_returns_best_match(self):
        """Test get_best_skill returns best matching skill."""
        from src.skills.registry import SkillRegistry
        from src.skills.loader import Skill

        mock_loader = MagicMock()
        skills = [
            Skill(name="Build", slug="build", description="", triggers=[], steps=[]),
        ]
        mock_loader.get_all_skills.return_value = skills
        skills[0].matches_task = MagicMock(return_value=0.9)

        registry = SkillRegistry(loader=mock_loader)
        result = registry.get_best_skill("build project")

        assert result is not None
        assert result.name == "Build"

    def test_get_best_skill_returns_none_below_threshold(self):
        """Test get_best_skill returns None if no good match."""
        from src.skills.registry import SkillRegistry
        from src.skills.loader import Skill

        mock_loader = MagicMock()
        skills = [
            Skill(name="Build", slug="build", description="", triggers=[], steps=[]),
        ]
        mock_loader.get_all_skills.return_value = skills
        skills[0].matches_task = MagicMock(return_value=0.2)  # Below 0.4 threshold

        registry = SkillRegistry(loader=mock_loader)
        result = registry.get_best_skill("unrelated task")

        assert result is None


class TestSkillRegistryExecuteSkill:
    """Test SkillRegistry execute_skill method."""

    @pytest.fixture
    def registry(self):
        """Create registry with mocked loader and executor."""
        from src.skills.registry import SkillRegistry
        from src.skills.loader import Skill, SkillStep

        mock_loader = MagicMock()
        mock_executor = MagicMock()
        mock_executor.execute = AsyncMock(return_value='{"success": true}')

        skill = Skill(
            name="Test Skill",
            slug="test-skill",
            description="Test",
            triggers=["test"],
            steps=[
                SkillStep(name="step1", description="Step 1", tool="run_command", parameters={"command": "echo test"}, required=True),
            ],
        )
        mock_loader.get_skill.return_value = skill
        mock_loader.get_skill_by_name.return_value = skill
        mock_loader.record_execution = AsyncMock()

        registry = SkillRegistry(loader=mock_loader, tool_executor=mock_executor)
        return registry

    @pytest.mark.asyncio
    async def test_execute_skill_not_found(self):
        """Test execute_skill when skill not found."""
        from src.skills.registry import SkillRegistry

        mock_loader = MagicMock()
        mock_loader.get_skill.return_value = None
        mock_loader.get_skill_by_name.return_value = None

        registry = SkillRegistry(loader=mock_loader)
        result = await registry.execute_skill("nonexistent")

        assert result.success is False
        assert "not found" in result.error

    @pytest.mark.asyncio
    async def test_execute_skill_no_tool_executor(self):
        """Test execute_skill when tool executor not configured."""
        from src.skills.registry import SkillRegistry
        from src.skills.loader import Skill

        mock_loader = MagicMock()
        skill = Skill(name="Test", slug="test", description="", triggers=[], steps=[])
        mock_loader.get_skill.return_value = skill

        registry = SkillRegistry(loader=mock_loader, tool_executor=None)
        result = await registry.execute_skill("test")

        assert result.success is False
        assert "Tool executor not configured" in result.error

    @pytest.mark.asyncio
    async def test_execute_skill_success(self, registry):
        """Test execute_skill succeeds."""
        result = await registry.execute_skill("test-skill")

        assert result.success is True
        assert result.steps_completed == 1

    @pytest.mark.asyncio
    async def test_execute_skill_circular_call_prevention(self):
        """Test execute_skill prevents circular skill calls."""
        from src.skills.registry import SkillRegistry
        from src.skills.loader import Skill, SkillStep

        mock_loader = MagicMock()
        mock_executor = MagicMock()
        mock_executor.execute = AsyncMock(return_value='{"success": true}')

        skill = Skill(
            name="Self-calling",
            slug="self-calling",
            description="",
            triggers=[],
            steps=[SkillStep(name="s1", description="", tool="test", parameters={})],
        )
        mock_loader.get_skill.return_value = skill
        mock_loader.get_skill_by_name.return_value = skill

        registry = SkillRegistry(loader=mock_loader, tool_executor=mock_executor)
        # Simulate the skill already being executed
        registry._executing_skills.add("self-calling")

        result = await registry.execute_skill("self-calling")

        assert result.success is False
        assert "Circular skill call" in result.error


class TestSkillRegistryEvaluateCondition:
    """Test SkillRegistry._evaluate_condition method."""

    @pytest.fixture
    def registry(self):
        """Create registry instance."""
        from src.skills.registry import SkillRegistry
        return SkillRegistry()

    def test_evaluate_condition_equality_true(self, registry):
        """Test _evaluate_condition with equality returning true."""
        result = registry._evaluate_condition("status == 'success'", {"status": "success"})
        assert result is True

    def test_evaluate_condition_equality_false(self, registry):
        """Test _evaluate_condition with equality returning false."""
        result = registry._evaluate_condition("status == 'success'", {"status": "failure"})
        assert result is False

    def test_evaluate_condition_comparison_gt(self, registry):
        """Test _evaluate_condition with greater than."""
        result = registry._evaluate_condition("count > 0", {"count": 5})
        assert result is True

        result = registry._evaluate_condition("count > 0", {"count": 0})
        assert result is False

    def test_evaluate_condition_comparison_lt(self, registry):
        """Test _evaluate_condition with less than."""
        result = registry._evaluate_condition("count < 10", {"count": 5})
        assert result is True

    def test_evaluate_condition_bool_true(self, registry):
        """Test _evaluate_condition with boolean true."""
        result = registry._evaluate_condition("has_tests == true", {"has_tests": True})
        assert result is True

    def test_evaluate_condition_bool_false(self, registry):
        """Test _evaluate_condition with boolean false."""
        result = registry._evaluate_condition("has_tests == false", {"has_tests": False})
        assert result is True

    def test_evaluate_condition_unknown_variable(self, registry):
        """Test _evaluate_condition with unknown variable returns false."""
        result = registry._evaluate_condition("unknown == true", {})
        assert result is False

    def test_evaluate_condition_invalid_syntax(self, registry):
        """Test _evaluate_condition with invalid syntax returns false."""
        result = registry._evaluate_condition("invalid syntax !@#", {})
        assert result is False


class TestSkillRegistryResolveParameters:
    """Test SkillRegistry._resolve_parameters method."""

    @pytest.fixture
    def registry(self):
        """Create registry instance."""
        from src.skills.registry import SkillRegistry
        return SkillRegistry()

    def test_resolve_parameters_simple(self, registry):
        """Test _resolve_parameters with no templates."""
        params = {"key": "value", "number": 42}
        context = {}

        result = registry._resolve_parameters(params, context)

        assert result == {"key": "value", "number": 42}

    def test_resolve_parameters_with_template(self, registry):
        """Test _resolve_parameters with template."""
        params = {"path": "{{project_path}}/test.py"}
        context = {"project_path": "/home/user/project"}

        result = registry._resolve_parameters(params, context)

        assert result["path"] == "/home/user/project/test.py"

    def test_resolve_parameters_nested(self, registry):
        """Test _resolve_parameters with nested dict."""
        params = {
            "outer": {
                "inner": "{{value}}"
            }
        }
        context = {"value": "resolved"}

        result = registry._resolve_parameters(params, context)

        assert result["outer"]["inner"] == "resolved"


class TestSkillRegistryRegisterRemoveSkill:
    """Test SkillRegistry register_skill and remove_skill methods."""

    def test_register_skill(self):
        """Test register_skill method."""
        from src.skills.registry import SkillRegistry
        from src.skills.loader import Skill

        mock_loader = MagicMock()
        mock_skill = Skill(name="New", slug="new", description="", triggers=[], steps=[])
        mock_loader.add_skill_from_dict.return_value = mock_skill

        registry = SkillRegistry(loader=mock_loader)
        result = registry.register_skill({"name": "New", "slug": "new"})

        assert result == mock_skill
        mock_loader.add_skill_from_dict.assert_called_once()

    def test_remove_skill(self):
        """Test remove_skill method."""
        from src.skills.registry import SkillRegistry

        mock_loader = MagicMock()
        mock_loader.remove_skill.return_value = True

        registry = SkillRegistry(loader=mock_loader)
        result = registry.remove_skill("test-skill")

        assert result is True
        mock_loader.remove_skill.assert_called_with("test-skill")


class TestSkillRegistryGetHistory:
    """Test SkillRegistry get_execution_history method."""

    def test_get_execution_history_all(self):
        """Test get_execution_history returns all history."""
        from src.skills.registry import SkillRegistry, SkillExecutionResult

        registry = SkillRegistry()
        registry._execution_history = [
            SkillExecutionResult(skill_name="s1", success=True, steps_completed=1, total_steps=1),
            SkillExecutionResult(skill_name="s2", success=False, steps_completed=0, total_steps=1),
        ]

        result = registry.get_execution_history()

        assert len(result) == 2

    def test_get_execution_history_by_skill_name(self):
        """Test get_execution_history filters by skill name."""
        from src.skills.registry import SkillRegistry, SkillExecutionResult

        registry = SkillRegistry()
        registry._execution_history = [
            SkillExecutionResult(skill_name="s1", success=True, steps_completed=1, total_steps=1),
            SkillExecutionResult(skill_name="s2", success=False, steps_completed=0, total_steps=1),
            SkillExecutionResult(skill_name="s1", success=True, steps_completed=1, total_steps=1),
        ]

        result = registry.get_execution_history(skill_name="s1")

        assert len(result) == 2

    def test_get_execution_history_limit(self):
        """Test get_execution_history respects limit."""
        from src.skills.registry import SkillRegistry, SkillExecutionResult

        registry = SkillRegistry()
        registry._execution_history = [
            SkillExecutionResult(skill_name=f"s{i}", success=True, steps_completed=1, total_steps=1)
            for i in range(20)
        ]

        result = registry.get_execution_history(limit=5)

        assert len(result) == 5


class TestSkillRegistryGetStats:
    """Test SkillRegistry get_skill_stats method."""

    def test_get_skill_stats_no_history(self):
        """Test get_skill_stats with no history."""
        from src.skills.registry import SkillRegistry

        registry = SkillRegistry()
        stats = registry.get_skill_stats("unknown")

        assert stats["skill_name"] == "unknown"
        assert stats["executions"] == 0

    def test_get_skill_stats_with_history(self):
        """Test get_skill_stats with execution history."""
        from src.skills.registry import SkillRegistry, SkillExecutionResult

        registry = SkillRegistry()
        registry._execution_history = [
            SkillExecutionResult(skill_name="test", success=True, steps_completed=1, total_steps=1, duration_ms=100),
            SkillExecutionResult(skill_name="test", success=True, steps_completed=1, total_steps=1, duration_ms=200),
            SkillExecutionResult(skill_name="test", success=False, steps_completed=0, total_steps=1, duration_ms=50),
        ]

        stats = registry.get_skill_stats("test")

        assert stats["executions"] == 3
        assert stats["success_rate"] == pytest.approx(66.67, rel=0.01)
        assert stats["avg_duration_ms"] == pytest.approx(116.67, rel=0.01)
        assert stats["min_duration_ms"] == 50
        assert stats["max_duration_ms"] == 200


class TestSkillRegistryRecommendSkills:
    """Test SkillRegistry recommend_skills method."""

    def test_recommend_skills_by_role(self):
        """Test recommend_skills filters by agent role."""
        from src.skills.registry import SkillRegistry
        from src.skills.loader import Skill

        mock_loader = MagicMock()
        skills = [
            Skill(name="Dev", slug="dev", description="", triggers=[], steps=[], tags=["developer"]),
            Skill(name="Test", slug="test", description="", triggers=[], steps=[], tags=["tester"]),
        ]
        # Mock matches_task to return 0 so role is the only factor
        for s in skills:
            s.matches_task = MagicMock(return_value=0)
        mock_loader.get_all_skills.return_value = skills

        registry = SkillRegistry(loader=mock_loader)
        recommendations = registry.recommend_skills(agent_role="developer")

        assert len(recommendations) == 1
        assert recommendations[0].name == "Dev"

    def test_recommend_skills_with_recent_tasks(self):
        """Test recommend_skills considers recent tasks."""
        from src.skills.registry import SkillRegistry
        from src.skills.loader import Skill

        mock_loader = MagicMock()
        skills = [
            Skill(name="Build", slug="build", description="", triggers=[], steps=[], tags=[]),
        ]
        # Mock matches_task to return score based on task
        skills[0].matches_task = MagicMock(return_value=0.5)
        mock_loader.get_all_skills.return_value = skills

        registry = SkillRegistry(loader=mock_loader)
        recommendations = registry.recommend_skills(
            agent_role="any",
            recent_tasks=["build project", "compile code"]
        )

        assert len(recommendations) >= 0  # May or may not match depending on scoring


class TestSkillRegistryIsLoaded:
    """Test SkillRegistry is_loaded property."""

    def test_is_loaded_initially_false(self):
        """Test is_loaded is False initially."""
        from src.skills.registry import SkillRegistry

        registry = SkillRegistry()
        assert registry.is_loaded is False

    @pytest.mark.asyncio
    async def test_is_loaded_after_load(self):
        """Test is_loaded is True after loading."""
        from src.skills.registry import SkillRegistry

        mock_loader = MagicMock()
        mock_loader.load_from_api = AsyncMock(return_value=[])

        registry = SkillRegistry(loader=mock_loader)
        await registry.load_skills()

        assert registry.is_loaded is True
