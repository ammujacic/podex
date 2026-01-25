"""Tests for memory modules.

Tests cover:
- PodexMdParser and ProjectContext
- CodebaseQASearch and related dataclasses
- Wiki generator (basic imports)
- Memory retriever (basic imports)
"""

import pytest
from datetime import datetime
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch


class TestProjectContextDataclass:
    """Test ProjectContext dataclass."""

    def test_project_context_defaults(self):
        """Test ProjectContext default values."""
        from src.memory.podex_md_parser import ProjectContext

        ctx = ProjectContext()

        assert ctx.project_name == ""
        assert ctx.description == ""
        assert ctx.tech_stack == []
        assert ctx.architecture == ""
        assert ctx.key_patterns == []
        assert ctx.important_files == []
        assert ctx.coding_conventions == []
        assert ctx.common_commands == {}
        assert ctx.known_issues == []
        assert ctx.recent_changes == []
        assert ctx.custom_instructions == ""
        assert ctx.raw_content == ""
        assert ctx.last_modified is None

    def test_project_context_with_values(self):
        """Test ProjectContext with all values set."""
        from src.memory.podex_md_parser import ProjectContext

        ctx = ProjectContext(
            project_name="My Project",
            description="A test project",
            tech_stack=["Python", "FastAPI"],
            architecture="Microservices",
            key_patterns=["Repository pattern"],
            important_files=["main.py", "config.py"],
            coding_conventions=["Use black formatter"],
            common_commands={"test": "pytest"},
            known_issues=["Bug #123"],
            recent_changes=["Added feature X"],
            custom_instructions="Be helpful",
            raw_content="# My Project",
            last_modified=datetime(2024, 1, 1, 12, 0, 0),
        )

        assert ctx.project_name == "My Project"
        assert ctx.description == "A test project"
        assert len(ctx.tech_stack) == 2
        assert "Python" in ctx.tech_stack

    def test_project_context_to_dict(self):
        """Test ProjectContext to_dict method."""
        from src.memory.podex_md_parser import ProjectContext

        ctx = ProjectContext(
            project_name="Test",
            description="Description",
            tech_stack=["Python"],
            last_modified=datetime(2024, 1, 1, 12, 0, 0),
        )

        result = ctx.to_dict()

        assert result["project_name"] == "Test"
        assert result["description"] == "Description"
        assert result["tech_stack"] == ["Python"]
        assert result["last_modified"] == "2024-01-01T12:00:00"

    def test_project_context_to_dict_no_last_modified(self):
        """Test ProjectContext to_dict with no last_modified."""
        from src.memory.podex_md_parser import ProjectContext

        ctx = ProjectContext(project_name="Test")
        result = ctx.to_dict()

        assert result["last_modified"] is None

    def test_project_context_to_system_prompt(self):
        """Test ProjectContext to_system_prompt method."""
        from src.memory.podex_md_parser import ProjectContext

        ctx = ProjectContext(
            project_name="Test Project",
            description="A test project",
            tech_stack=["Python", "FastAPI"],
            architecture="Clean architecture",
            key_patterns=["DI pattern"],
            important_files=["main.py"],
            coding_conventions=["Use type hints"],
            common_commands={"test": "pytest", "run": "python main.py"},
            known_issues=["Issue 1"],
            recent_changes=["Change 1", "Change 2"],
            custom_instructions="Be concise",
        )

        prompt = ctx.to_system_prompt()

        assert "# Project: Test Project" in prompt
        assert "## Description" in prompt
        assert "A test project" in prompt
        assert "## Tech Stack" in prompt
        assert "Python" in prompt
        assert "## Architecture" in prompt
        assert "## Key Patterns" in prompt
        assert "## Important Files" in prompt
        assert "## Coding Conventions" in prompt
        assert "## Common Commands" in prompt
        assert "## Known Issues" in prompt
        assert "## Recent Changes" in prompt
        assert "## Custom Instructions" in prompt

    def test_project_context_to_system_prompt_minimal(self):
        """Test ProjectContext to_system_prompt with minimal data."""
        from src.memory.podex_md_parser import ProjectContext

        ctx = ProjectContext(project_name="Minimal")
        prompt = ctx.to_system_prompt()

        assert "# Project: Minimal" in prompt
        assert "## Description" not in prompt  # Empty description not included


class TestPodexMdParser:
    """Test PodexMdParser class."""

    def test_parser_initialization(self):
        """Test PodexMdParser initialization."""
        from src.memory.podex_md_parser import PodexMdParser

        parser = PodexMdParser()
        assert parser._workspace_path is None
        assert parser._cached_context is None

    def test_parser_initialization_with_workspace(self):
        """Test PodexMdParser initialization with workspace."""
        from src.memory.podex_md_parser import PodexMdParser

        parser = PodexMdParser(workspace_path="/workspace")
        assert parser._workspace_path == "/workspace"

    def test_parse_basic_content(self):
        """Test parsing basic PODEX.md content."""
        from src.memory.podex_md_parser import PodexMdParser

        content = """# My Project

## Description
This is a test project.

## Tech Stack
- Python
- FastAPI
- PostgreSQL
"""
        parser = PodexMdParser()
        ctx = parser.parse(content)

        assert ctx.project_name == "My Project"
        assert ctx.description == "This is a test project."
        assert len(ctx.tech_stack) == 3
        assert "Python" in ctx.tech_stack
        assert "FastAPI" in ctx.tech_stack
        assert "PostgreSQL" in ctx.tech_stack

    def test_parse_all_sections(self):
        """Test parsing all supported sections."""
        from src.memory.podex_md_parser import PodexMdParser

        content = """# Complete Project

## Description
Full description here.

## Technologies
- TypeScript
- React

## Architecture
Microservices architecture with API gateway.

## Key Patterns
- Repository pattern
- Factory pattern

## Important Files
- src/main.ts
- src/config.ts

## Coding Conventions
- Use ESLint
- Use Prettier

## Common Commands
`npm start`: Run the server
`npm test`: Run tests

## Known Issues
- Bug #1: Memory leak
- Bug #2: Slow queries

## Recent Changes
- Added auth
- Fixed styling

## Custom Instructions
Always add tests for new code.
"""
        parser = PodexMdParser()
        ctx = parser.parse(content)

        assert ctx.project_name == "Complete Project"
        assert "Full description here." in ctx.description
        assert len(ctx.tech_stack) == 2
        assert "Microservices" in ctx.architecture
        assert len(ctx.key_patterns) == 2
        assert len(ctx.important_files) == 2
        assert len(ctx.coding_conventions) == 2
        assert "npm start" in ctx.common_commands
        assert len(ctx.known_issues) == 2
        assert len(ctx.recent_changes) == 2
        assert "tests" in ctx.custom_instructions

    def test_parse_empty_content(self):
        """Test parsing empty content."""
        from src.memory.podex_md_parser import PodexMdParser

        parser = PodexMdParser()
        ctx = parser.parse("")

        assert ctx.project_name == ""
        assert ctx.description == ""

    def test_parse_numbered_list(self):
        """Test parsing numbered lists."""
        from src.memory.podex_md_parser import PodexMdParser

        content = """# Project

## Tech Stack
1. Python
2. Django
3. Redis
"""
        parser = PodexMdParser()
        ctx = parser.parse(content)

        assert len(ctx.tech_stack) == 3
        assert "Python" in ctx.tech_stack

    def test_normalize_section_name(self):
        """Test section name normalization."""
        from src.memory.podex_md_parser import PodexMdParser

        parser = PodexMdParser()

        # Test various aliases
        assert parser._normalize_section_name("About") == "description"
        assert parser._normalize_section_name("Technologies") == "tech_stack"
        assert parser._normalize_section_name("Key Patterns") == "key_patterns"
        assert parser._normalize_section_name("Scripts") == "common_commands"
        assert parser._normalize_section_name("Unknown Section") == "unknown_section"

    def test_extract_commands_various_formats(self):
        """Test extracting commands in various formats."""
        from src.memory.podex_md_parser import PodexMdParser

        content = """`npm start`: Run the server
- `npm test` - Run tests
"npm build": Build the project
"""
        parser = PodexMdParser()
        commands = parser._extract_commands(content)

        assert "npm start" in commands
        assert commands["npm start"] == "Run the server"
        assert "npm test" in commands
        assert "npm build" in commands

    def test_sections_constant(self):
        """Test SECTIONS constant contains expected sections."""
        from src.memory.podex_md_parser import PodexMdParser

        assert "description" in PodexMdParser.SECTIONS
        assert "tech_stack" in PodexMdParser.SECTIONS
        assert "architecture" in PodexMdParser.SECTIONS
        assert "coding_conventions" in PodexMdParser.SECTIONS


class TestCodeChunkDataclass:
    """Test CodeChunk dataclass."""

    def test_code_chunk_creation(self):
        """Test CodeChunk creation."""
        from src.memory.qa_search import CodeChunk

        chunk = CodeChunk(
            id="chunk-123",
            file_path="src/main.py",
            content="def main():\n    pass",
            start_line=1,
            end_line=2,
            chunk_type="function",
        )

        assert chunk.id == "chunk-123"
        assert chunk.file_path == "src/main.py"
        assert chunk.start_line == 1
        assert chunk.end_line == 2
        assert chunk.chunk_type == "function"
        assert chunk.metadata == {}
        assert chunk.embedding is None

    def test_code_chunk_with_metadata(self):
        """Test CodeChunk with metadata and embedding."""
        from src.memory.qa_search import CodeChunk

        chunk = CodeChunk(
            id="chunk-123",
            file_path="src/main.py",
            content="class Foo:\n    pass",
            start_line=1,
            end_line=2,
            chunk_type="class",
            metadata={"class_name": "Foo"},
            embedding=[0.1, 0.2, 0.3],
        )

        assert chunk.metadata == {"class_name": "Foo"}
        assert chunk.embedding == [0.1, 0.2, 0.3]


class TestSearchResultDataclass:
    """Test SearchResult dataclass."""

    def test_search_result_creation(self):
        """Test SearchResult creation."""
        from src.memory.qa_search import SearchResult, CodeChunk

        chunk = CodeChunk(
            id="chunk-1",
            file_path="main.py",
            content="code",
            start_line=1,
            end_line=10,
            chunk_type="function",
        )
        result = SearchResult(chunk=chunk, score=0.95)

        assert result.chunk == chunk
        assert result.score == 0.95
        assert result.highlights == []

    def test_search_result_with_highlights(self):
        """Test SearchResult with highlights."""
        from src.memory.qa_search import SearchResult, CodeChunk

        chunk = CodeChunk(
            id="chunk-1",
            file_path="main.py",
            content="def process():",
            start_line=1,
            end_line=1,
            chunk_type="function",
        )
        result = SearchResult(
            chunk=chunk,
            score=0.85,
            highlights=["process", "def"],
        )

        assert len(result.highlights) == 2
        assert "process" in result.highlights


class TestQAResultDataclass:
    """Test QAResult dataclass."""

    def test_qa_result_creation(self):
        """Test QAResult creation."""
        from src.memory.qa_search import QAResult, SearchResult, CodeChunk

        chunk = CodeChunk(
            id="chunk-1",
            file_path="main.py",
            content="def main(): pass",
            start_line=1,
            end_line=1,
            chunk_type="function",
        )
        source = SearchResult(chunk=chunk, score=0.9)

        qa_result = QAResult(
            query="What does main do?",
            answer="The main function is the entry point.",
            sources=[source],
            confidence=0.85,
        )

        assert qa_result.query == "What does main do?"
        assert qa_result.answer == "The main function is the entry point."
        assert len(qa_result.sources) == 1
        assert qa_result.confidence == 0.85
        assert qa_result.generated_at is not None

    def test_qa_result_to_dict(self):
        """Test QAResult to_dict method."""
        from src.memory.qa_search import QAResult, SearchResult, CodeChunk

        chunk = CodeChunk(
            id="chunk-1",
            file_path="main.py",
            content="def main(): print('hello')" * 20,  # Long content
            start_line=1,
            end_line=10,
            chunk_type="function",
        )
        source = SearchResult(chunk=chunk, score=0.9, highlights=["main"])

        qa_result = QAResult(
            query="What does main do?",
            answer="It prints hello.",
            sources=[source],
            confidence=0.9,
        )

        result_dict = qa_result.to_dict()

        assert result_dict["query"] == "What does main do?"
        assert result_dict["answer"] == "It prints hello."
        assert len(result_dict["sources"]) == 1
        assert result_dict["sources"][0]["file_path"] == "main.py"
        assert result_dict["sources"][0]["score"] == 0.9
        assert "..." in result_dict["sources"][0]["content_preview"]  # Truncated
        assert result_dict["confidence"] == 0.9
        assert "generated_at" in result_dict

    def test_qa_result_to_dict_short_content(self):
        """Test QAResult to_dict with short content (no truncation)."""
        from src.memory.qa_search import QAResult, SearchResult, CodeChunk

        chunk = CodeChunk(
            id="chunk-1",
            file_path="main.py",
            content="short",
            start_line=1,
            end_line=1,
            chunk_type="function",
        )
        source = SearchResult(chunk=chunk, score=0.9)

        qa_result = QAResult(
            query="Query",
            answer="Answer",
            sources=[source],
            confidence=0.8,
        )

        result_dict = qa_result.to_dict()
        assert "..." not in result_dict["sources"][0]["content_preview"]


class TestCodebaseQASearch:
    """Test CodebaseQASearch class."""

    def test_qa_search_initialization(self):
        """Test CodebaseQASearch initialization."""
        from src.memory.qa_search import CodebaseQASearch

        qa = CodebaseQASearch(workspace_path="/workspace")

        assert qa._workspace_path == "/workspace"
        assert qa._embedding_client is None
        assert qa._llm_client is None
        assert qa._chunks == []

    def test_qa_search_with_clients(self):
        """Test CodebaseQASearch initialization with clients."""
        from src.memory.qa_search import CodebaseQASearch

        mock_embedding = MagicMock()
        mock_llm = MagicMock()

        qa = CodebaseQASearch(
            workspace_path="/workspace",
            embedding_client=mock_embedding,
            llm_client=mock_llm,
        )

        assert qa._embedding_client == mock_embedding
        assert qa._llm_client == mock_llm

    def test_qa_search_constants(self):
        """Test CodebaseQASearch constants."""
        from src.memory.qa_search import CodebaseQASearch

        assert CodebaseQASearch.MAX_CHUNK_LINES == 50
        assert CodebaseQASearch.MIN_CHUNK_LINES == 5
        assert CodebaseQASearch.OVERLAP_LINES == 3
        assert ".py" in CodebaseQASearch.CODE_EXTENSIONS
        assert ".ts" in CodebaseQASearch.CODE_EXTENSIONS
        assert "node_modules" in CodebaseQASearch.SKIP_DIRS
        assert "__pycache__" in CodebaseQASearch.SKIP_DIRS


class TestWikiGeneratorModule:
    """Test wiki_generator module imports."""

    def test_wiki_generator_module_exists(self):
        """Test wiki_generator module can be imported."""
        from src.memory import wiki_generator
        assert wiki_generator is not None


class TestMemoryRetrieverModule:
    """Test retriever module."""

    def test_retriever_module_exists(self):
        """Test retriever module can be imported."""
        from src.memory import retriever
        assert retriever is not None

    def test_memory_retriever_class_exists(self):
        """Test MemoryRetriever class exists."""
        from src.memory.retriever import MemoryRetriever
        assert MemoryRetriever is not None


class TestKnowledgeBaseModule:
    """Test knowledge_base module."""

    def test_knowledge_base_module_exists(self):
        """Test knowledge_base module can be imported."""
        from src.memory import knowledge_base
        assert knowledge_base is not None

    def test_knowledge_base_class_exists(self):
        """Test KnowledgeBase class exists."""
        from src.memory.knowledge_base import KnowledgeBase
        assert KnowledgeBase is not None

    def test_memory_dataclass_exists(self):
        """Test Memory dataclass exists."""
        from src.memory.knowledge_base import Memory
        assert Memory is not None

    def test_memory_type_enum_exists(self):
        """Test MemoryType enum exists."""
        from src.memory.knowledge_base import MemoryType
        assert MemoryType is not None

    def test_memory_store_request_exists(self):
        """Test MemoryStoreRequest dataclass exists."""
        from src.memory.knowledge_base import MemoryStoreRequest
        assert MemoryStoreRequest is not None

    def test_memory_creation(self):
        """Test Memory creation."""
        from src.memory.knowledge_base import Memory, MemoryType

        memory = Memory(
            id="entry-123",
            user_id="user-456",
            content="Remember this",
            memory_type=MemoryType.FACT,
        )

        assert memory.id == "entry-123"
        assert memory.content == "Remember this"
        assert memory.memory_type == MemoryType.FACT
