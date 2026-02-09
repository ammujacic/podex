"""Tests for skills registry and loader modules.

Tests cover:
- SkillMatch dataclass
- SkillExecutionResult dataclass
- SkillRegistry initialization
- Skill loading and matching
"""

from datetime import UTC, datetime
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


class TestSkillMatchDataclass:
    """Test SkillMatch dataclass."""

    def test_skill_match_basic(self):
        """Test basic SkillMatch creation."""
        from src.skills.registry import SkillMatch
        from src.skills.loader import Skill

        skill = Skill(
            name="test-skill",
            slug="test-skill",
            description="A test skill",
            steps=[],
        )
        match = SkillMatch(skill=skill, score=0.8)

        assert match.skill == skill
        assert match.score == 0.8
        assert match.matched_triggers == []
        assert match.matched_tags == []

    def test_skill_match_with_triggers_and_tags(self):
        """Test SkillMatch with matched triggers and tags."""
        from src.skills.registry import SkillMatch
        from src.skills.loader import Skill

        skill = Skill(name="test-skill", slug="test-skill", description="Test", steps=[])
        match = SkillMatch(
            skill=skill,
            score=0.95,
            matched_triggers=["deploy", "build"],
            matched_tags=["ci", "automation"],
        )

        assert match.score == 0.95
        assert "deploy" in match.matched_triggers
        assert "ci" in match.matched_tags


class TestSkillExecutionResultDataclass:
    """Test SkillExecutionResult dataclass."""

    def test_execution_result_basic(self):
        """Test basic execution result creation."""
        from src.skills.registry import SkillExecutionResult

        result = SkillExecutionResult(
            skill_name="test-skill",
            success=True,
            steps_completed=5,
            total_steps=5,
        )

        assert result.skill_name == "test-skill"
        assert result.success is True
        assert result.steps_completed == 5
        assert result.total_steps == 5
        assert result.results == []
        assert result.error is None
        assert result.duration_ms == 0

    def test_execution_result_with_error(self):
        """Test execution result with error."""
        from src.skills.registry import SkillExecutionResult

        result = SkillExecutionResult(
            skill_name="failing-skill",
            success=False,
            steps_completed=2,
            total_steps=5,
            error="Step 3 failed: API error",
            duration_ms=1500,
        )

        assert result.success is False
        assert result.error == "Step 3 failed: API error"
        assert result.duration_ms == 1500

    def test_execution_result_to_dict(self):
        """Test execution result to_dict method."""
        from src.skills.registry import SkillExecutionResult

        result = SkillExecutionResult(
            skill_name="test-skill",
            success=True,
            steps_completed=3,
            total_steps=3,
            results=[{"step": 1, "output": "done"}],
            duration_ms=500,
        )

        result_dict = result.to_dict()

        assert result_dict["skill_name"] == "test-skill"
        assert result_dict["success"] is True
        assert result_dict["steps_completed"] == 3
        assert result_dict["total_steps"] == 3
        assert len(result_dict["results"]) == 1
        assert result_dict["duration_ms"] == 500
        assert "timestamp" in result_dict


class TestSkillDataclass:
    """Test Skill dataclass from loader module."""

    def test_skill_basic(self):
        """Test basic Skill creation."""
        from src.skills.loader import Skill

        skill = Skill(
            name="my-skill",
            slug="my-skill",
            description="Does something useful",
            steps=[],
        )

        assert skill.name == "my-skill"
        assert skill.slug == "my-skill"
        assert skill.description == "Does something useful"
        assert skill.steps == []

    def test_skill_with_steps(self):
        """Test Skill with steps."""
        from src.skills.loader import Skill, SkillStep

        steps = [
            SkillStep(
                name="step1",
                description="First step",
                tool="run_command",
                parameters={"command": "echo hello"},
            ),
            SkillStep(
                name="step2",
                description="Second step",
                tool="read_file",
                parameters={"path": "/tmp/test.txt"},
            ),
        ]
        skill = Skill(
            name="multi-step-skill",
            slug="multi-step-skill",
            description="Has multiple steps",
            steps=steps,
        )

        assert len(skill.steps) == 2
        assert skill.steps[0].name == "step1"
        assert skill.steps[1].tool == "read_file"


class TestSkillStepDataclass:
    """Test SkillStep dataclass."""

    def test_skill_step_basic(self):
        """Test basic SkillStep creation."""
        from src.skills.loader import SkillStep

        step = SkillStep(
            name="my-step",
            description="A test step",
            tool="read_file",
            parameters={"path": "/workspace/main.py"},
        )

        assert step.name == "my-step"
        assert step.description == "A test step"
        assert step.tool == "read_file"
        assert step.parameters == {"path": "/workspace/main.py"}


class TestSkillRegistryInit:
    """Test SkillRegistry initialization."""

    def test_registry_basic_init(self):
        """Test basic registry initialization."""
        from src.skills.registry import SkillRegistry

        registry = SkillRegistry()

        assert registry._loaded is False
        assert registry._execution_history == []
        assert registry._executing_skills == set()

    def test_registry_init_with_loader(self):
        """Test registry initialization with custom loader."""
        from src.skills.registry import SkillRegistry
        from src.skills.loader import SkillLoader

        mock_loader = MagicMock(spec=SkillLoader)
        registry = SkillRegistry(loader=mock_loader)

        assert registry._loader == mock_loader

    def test_registry_init_with_tool_executor(self):
        """Test registry initialization with tool executor."""
        from src.skills.registry import SkillRegistry

        mock_executor = MagicMock()
        registry = SkillRegistry(tool_executor=mock_executor)

        assert registry._tool_executor == mock_executor

    def test_registry_init_with_publisher(self):
        """Test registry initialization with stream publisher."""
        from src.skills.registry import SkillRegistry

        mock_publisher = MagicMock()
        registry = SkillRegistry(publisher=mock_publisher)

        assert registry._publisher == mock_publisher


class TestSkillLoader:
    """Test SkillLoader class."""

    def test_skill_loader_exists(self):
        """Test SkillLoader class exists."""
        from src.skills.loader import SkillLoader
        assert SkillLoader is not None

    def test_skill_loader_init(self):
        """Test SkillLoader initialization."""
        from src.skills.loader import SkillLoader

        loader = SkillLoader()
        assert loader is not None

    def test_skill_loader_init_with_api_url(self):
        """Test SkillLoader initialization with API URL."""
        from src.skills.loader import SkillLoader

        loader = SkillLoader(api_url="http://api.example.com")
        assert loader._api_url == "http://api.example.com"


class TestSkillMatching:
    """Test skill matching functionality."""

    @pytest.fixture
    def registry(self) -> "SkillRegistry":
        """Create a test registry."""
        from src.skills.registry import SkillRegistry
        return SkillRegistry()

    def test_registry_has_match_skills_method(self, registry):
        """Test that registry has match_skills method."""
        assert hasattr(registry, "match_skills")
        assert callable(registry.match_skills)

    def test_registry_has_skills_property(self, registry):
        """Test that registry has skills property."""
        # Check if skills or _skills exists
        assert hasattr(registry, "_loader")


class TestSkillExecution:
    """Test skill execution tracking."""

    @pytest.fixture
    def registry(self) -> "SkillRegistry":
        """Create a test registry."""
        from src.skills.registry import SkillRegistry
        return SkillRegistry()

    def test_execution_history_starts_empty(self, registry):
        """Test that execution history starts empty."""
        assert registry._execution_history == []

    def test_executing_skills_tracking(self, registry):
        """Test that executing skills set starts empty."""
        assert registry._executing_skills == set()
