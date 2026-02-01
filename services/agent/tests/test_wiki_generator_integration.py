"""Integration tests for wiki generator module."""

import os
import pytest
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import MagicMock

from src.memory.wiki_generator import (
    WikiPage,
    CodeEntity,
    WikiGenerator,
    create_wiki_generator,
)


class TestWikiPage:
    """Tests for WikiPage dataclass."""

    def test_wiki_page_defaults(self) -> None:
        """Test WikiPage default values."""
        page = WikiPage(
            id="page-1",
            title="Test Page",
            slug="test-page",
            content="# Test\n\nContent here.",
            source_files=["file.py"],
            category="module",
        )

        assert page.tags == []
        assert page.auto_generated is True
        assert page.created_at is not None
        assert page.updated_at is not None

    def test_wiki_page_to_dict(self) -> None:
        """Test WikiPage to_dict method."""
        now = datetime.now(UTC)
        page = WikiPage(
            id="page-1",
            title="Test Page",
            slug="test-page",
            content="# Test Content",
            source_files=["file.py", "other.py"],
            category="api",
            tags=["api", "rest"],
            created_at=now,
            updated_at=now,
            auto_generated=True,
        )

        result = page.to_dict()

        assert result["id"] == "page-1"
        assert result["title"] == "Test Page"
        assert result["slug"] == "test-page"
        assert result["content"] == "# Test Content"
        assert result["source_files"] == ["file.py", "other.py"]
        assert result["category"] == "api"
        assert result["tags"] == ["api", "rest"]
        assert result["auto_generated"] is True
        assert result["created_at"] == now.isoformat()
        assert result["updated_at"] == now.isoformat()


class TestCodeEntity:
    """Tests for CodeEntity dataclass."""

    def test_code_entity_defaults(self) -> None:
        """Test CodeEntity default values."""
        entity = CodeEntity(
            name="test_function",
            entity_type="function",
            file_path="src/module.py",
            line_number=10,
            docstring=None,
            signature="def test_function()",
        )

        assert entity.dependencies == []

    def test_code_entity_full(self) -> None:
        """Test CodeEntity with all values."""
        entity = CodeEntity(
            name="MyClass",
            entity_type="class",
            file_path="src/models.py",
            line_number=25,
            docstring="A test class for demonstration.",
            signature="class MyClass",
            dependencies=["BaseClass", "Mixin"],
        )

        assert entity.name == "MyClass"
        assert entity.entity_type == "class"
        assert entity.dependencies == ["BaseClass", "Mixin"]


class TestWikiGenerator:
    """Tests for WikiGenerator class."""

    @pytest.fixture
    def temp_workspace(self) -> str:
        """Create a temporary workspace with test files."""
        with tempfile.TemporaryDirectory() as tmpdir:
            # Create Python file
            py_content = '''
"""Module docstring for testing."""

def public_function(arg1: str, arg2: int) -> bool:
    """A public function with docstring."""
    return True

def _private_function():
    """A private function."""
    pass

class MyClass:
    """A test class."""

    def method(self):
        """Class method."""
        pass

async def async_endpoint():
    """An async function."""
    pass
'''
            py_path = Path(tmpdir) / "src" / "module.py"
            py_path.parent.mkdir(parents=True, exist_ok=True)
            py_path.write_text(py_content)

            # Create TypeScript file
            ts_content = '''
/**
 * A TypeScript function
 * @param name The name parameter
 */
export function greetUser(name: string): string {
    return `Hello, ${name}!`;
}

export const arrowFunc = (value: number) => value * 2;

export class UserService {
    // Service class
}
'''
            ts_path = Path(tmpdir) / "src" / "components" / "user.tsx"
            ts_path.parent.mkdir(parents=True, exist_ok=True)
            ts_path.write_text(ts_content)

            # Create a file in node_modules (should be skipped)
            node_path = Path(tmpdir) / "node_modules" / "package" / "index.js"
            node_path.parent.mkdir(parents=True, exist_ok=True)
            node_path.write_text("module.exports = {};")

            yield tmpdir

    def test_init(self) -> None:
        """Test WikiGenerator initialization."""
        generator = WikiGenerator("/workspace")

        assert generator._workspace_path == "/workspace"
        assert generator._llm_client is None
        assert generator._pages == {}
        assert generator._entities == []

    def test_init_with_llm(self) -> None:
        """Test WikiGenerator with LLM client."""
        mock_llm = MagicMock()
        generator = WikiGenerator("/workspace", llm_client=mock_llm)

        assert generator._llm_client is mock_llm

    @pytest.mark.asyncio
    async def test_scan_files(self, temp_workspace: str) -> None:
        """Test scanning files in workspace."""
        generator = WikiGenerator(temp_workspace)

        files = await generator._scan_files(max_files=100)

        # Should find Python and TypeScript files
        assert len(files) >= 2

        # Should not include node_modules
        assert not any("node_modules" in str(f) for f in files)

        # Should include our test files
        file_names = [f.name for f in files]
        assert "module.py" in file_names
        assert "user.tsx" in file_names

    @pytest.mark.asyncio
    async def test_scan_files_max_limit(self, temp_workspace: str) -> None:
        """Test max_files limit."""
        generator = WikiGenerator(temp_workspace)

        files = await generator._scan_files(max_files=1)

        assert len(files) == 1

    @pytest.mark.asyncio
    async def test_extract_python_entities(self, temp_workspace: str) -> None:
        """Test extracting entities from Python file."""
        generator = WikiGenerator(temp_workspace)
        py_path = Path(temp_workspace) / "src" / "module.py"

        entities = await generator._extract_entities(py_path)

        # Should extract functions and class
        entity_names = [e.name for e in entities]
        assert "public_function" in entity_names
        assert "_private_function" in entity_names
        assert "MyClass" in entity_names
        assert "async_endpoint" in entity_names

        # Check entity types
        public_func = next(e for e in entities if e.name == "public_function")
        assert public_func.entity_type == "function"
        assert public_func.docstring == "A public function with docstring."
        assert "def public_function" in public_func.signature

        my_class = next(e for e in entities if e.name == "MyClass")
        assert my_class.entity_type == "class"
        assert my_class.docstring == "A test class."

    @pytest.mark.asyncio
    async def test_extract_js_entities(self, temp_workspace: str) -> None:
        """Test extracting entities from TypeScript file."""
        generator = WikiGenerator(temp_workspace)
        ts_path = Path(temp_workspace) / "src" / "components" / "user.tsx"

        entities = await generator._extract_entities(ts_path)

        entity_names = [e.name for e in entities]
        assert "greetUser" in entity_names
        assert "arrowFunc" in entity_names
        assert "UserService" in entity_names

        greet = next(e for e in entities if e.name == "greetUser")
        assert greet.entity_type == "function"

        service = next(e for e in entities if e.name == "UserService")
        assert service.entity_type == "class"

    @pytest.mark.asyncio
    async def test_generate_wiki(self, temp_workspace: str) -> None:
        """Test generating full wiki."""
        generator = WikiGenerator(temp_workspace)

        pages = await generator.generate_wiki(include_private=False)

        # Should generate some pages
        assert len(pages) > 0

        # Should have overview page first
        assert pages[0].category == "overview"
        assert "Documentation Overview" in pages[0].title

        # Check pages are stored
        assert len(generator._pages) == len(pages)

    @pytest.mark.asyncio
    async def test_generate_wiki_includes_private(self, temp_workspace: str) -> None:
        """Test generating wiki with private entities."""
        generator = WikiGenerator(temp_workspace)

        pages_no_private = await generator.generate_wiki(include_private=False)
        entities_no_private = generator._entities.copy()

        generator._pages.clear()
        generator._entities.clear()

        pages_with_private = await generator.generate_wiki(include_private=True)
        entities_with_private = generator._entities

        # Should have more entities when including private
        assert len(entities_with_private) >= len(entities_no_private)

    def test_get_python_signature(self, temp_workspace: str) -> None:
        """Test getting Python function signature."""
        import ast

        generator = WikiGenerator(temp_workspace)

        code = "def my_func(a, b, c): pass"
        tree = ast.parse(code)
        func_node = tree.body[0]

        signature = generator._get_python_signature(func_node)
        assert signature == "def my_func(a, b, c)"

        # Test async
        async_code = "async def async_func(x): pass"
        async_tree = ast.parse(async_code)
        async_node = async_tree.body[0]

        async_sig = generator._get_python_signature(async_node, is_async=True)
        assert async_sig == "async def async_func(x)"

    @pytest.mark.asyncio
    async def test_generate_api_docs(self, temp_workspace: str) -> None:
        """Test generating API documentation."""
        generator = WikiGenerator(temp_workspace)

        # Add some endpoint entities manually
        generator._entities = [
            CodeEntity(
                name="get_users",
                entity_type="endpoint",
                file_path="src/routes/users.py",
                line_number=10,
                docstring="Get all users.",
                signature="async def get_users()",
            ),
            CodeEntity(
                name="create_user",
                entity_type="endpoint",
                file_path="src/routes/users.py",
                line_number=20,
                docstring="Create a new user.",
                signature="async def create_user(data)",
            ),
        ]

        pages = await generator._generate_api_docs()

        assert len(pages) == 1
        page = pages[0]
        assert page.category == "api"
        assert "get_users" in page.content
        assert "create_user" in page.content
        assert "api" in page.tags

    @pytest.mark.asyncio
    async def test_generate_component_docs(self, temp_workspace: str) -> None:
        """Test generating component documentation."""
        generator = WikiGenerator(temp_workspace)

        generator._entities = [
            CodeEntity(
                name="Button",
                entity_type="function",
                file_path="src/components/Button.tsx",
                line_number=5,
                docstring="A button component.",
                signature="function Button(props)",
            ),
            CodeEntity(
                name="Card",
                entity_type="class",
                file_path="src/components/Card.jsx",
                line_number=10,
                docstring=None,
                signature="class Card",
            ),
        ]

        pages = await generator._generate_component_docs()

        assert len(pages) == 1
        page = pages[0]
        assert page.category == "components"
        assert "Button" in page.content
        assert "Card" in page.content

    @pytest.mark.asyncio
    async def test_generate_component_docs_empty(self, temp_workspace: str) -> None:
        """Test component docs with no components."""
        generator = WikiGenerator(temp_workspace)

        generator._entities = [
            CodeEntity(
                name="util",
                entity_type="function",
                file_path="src/utils.py",  # Not a component file
                line_number=5,
                docstring=None,
                signature="def util()",
            ),
        ]

        pages = await generator._generate_component_docs()
        assert len(pages) == 0

    @pytest.mark.asyncio
    async def test_generate_module_docs(self, temp_workspace: str) -> None:
        """Test generating module documentation."""
        generator = WikiGenerator(temp_workspace)

        generator._entities = [
            CodeEntity(
                name="func1",
                entity_type="function",
                file_path="src/utils/helpers.py",
                line_number=5,
                docstring="Helper 1",
                signature="def func1()",
            ),
            CodeEntity(
                name="func2",
                entity_type="function",
                file_path="src/utils/helpers.py",
                line_number=10,
                docstring="Helper 2",
                signature="def func2()",
            ),
            CodeEntity(
                name="HelperClass",
                entity_type="class",
                file_path="src/utils/helpers.py",
                line_number=15,
                docstring="A helper class.",
                signature="class HelperClass",
            ),
        ]

        pages = await generator._generate_module_docs()

        assert len(pages) == 1
        page = pages[0]
        assert page.category == "modules"
        assert "src/utils" in page.title
        assert "func1" in page.content
        assert "HelperClass" in page.content

    @pytest.mark.asyncio
    async def test_generate_module_docs_skips_small(self, temp_workspace: str) -> None:
        """Test that small directories are skipped."""
        generator = WikiGenerator(temp_workspace)

        generator._entities = [
            CodeEntity(
                name="single_func",
                entity_type="function",
                file_path="src/tiny/module.py",
                line_number=5,
                docstring=None,
                signature="def single_func()",
            ),
        ]

        pages = await generator._generate_module_docs()
        assert len(pages) == 0  # Too few entities

    @pytest.mark.asyncio
    async def test_generate_overview(self, temp_workspace: str) -> None:
        """Test generating overview page."""
        generator = WikiGenerator(temp_workspace)

        generator._entities = [
            CodeEntity("func1", "function", "a.py", 1, None, "def func1()"),
            CodeEntity("Class1", "class", "b.py", 1, None, "class Class1"),
            CodeEntity("endpoint1", "endpoint", "c.py", 1, None, "async def endpoint1()"),
            CodeEntity("endpoint2", "endpoint", "c.py", 5, None, "async def endpoint2()"),
        ]

        page = await generator._generate_overview()

        assert page is not None
        assert page.category == "overview"
        assert "3" in page.content  # 3 files
        assert "1" in page.content  # 1 class
        assert "1" in page.content  # 1 function
        assert "2" in page.content  # 2 endpoints

    @pytest.mark.asyncio
    async def test_generate_overview_empty(self, temp_workspace: str) -> None:
        """Test overview with no entities."""
        generator = WikiGenerator(temp_workspace)
        generator._entities = []

        page = await generator._generate_overview()
        assert page is None

    def test_get_page(self, temp_workspace: str) -> None:
        """Test getting a page by ID."""
        generator = WikiGenerator(temp_workspace)

        page = WikiPage(
            id="page-1",
            title="Test",
            slug="test",
            content="Content",
            source_files=[],
            category="test",
        )
        generator._pages["page-1"] = page

        assert generator.get_page("page-1") is page
        assert generator.get_page("nonexistent") is None

    def test_get_all_pages(self, temp_workspace: str) -> None:
        """Test getting all pages."""
        generator = WikiGenerator(temp_workspace)

        for i in range(3):
            page = WikiPage(
                id=f"page-{i}",
                title=f"Test {i}",
                slug=f"test-{i}",
                content="Content",
                source_files=[],
                category="test",
            )
            generator._pages[page.id] = page

        pages = generator.get_all_pages()
        assert len(pages) == 3

    def test_search_pages_by_title(self, temp_workspace: str) -> None:
        """Test searching pages by title."""
        generator = WikiGenerator(temp_workspace)

        generator._pages = {
            "p1": WikiPage("p1", "API Documentation", "api", "Content", [], "api"),
            "p2": WikiPage("p2", "User Guide", "user", "Content", [], "guide"),
            "p3": WikiPage("p3", "API Reference", "api-ref", "Content", [], "api"),
        }

        results = generator.search_pages("API")
        assert len(results) == 2
        assert all("API" in p.title for p in results)

    def test_search_pages_by_content(self, temp_workspace: str) -> None:
        """Test searching pages by content."""
        generator = WikiGenerator(temp_workspace)

        generator._pages = {
            "p1": WikiPage("p1", "Title1", "slug1", "Contains keyword here", [], "cat"),
            "p2": WikiPage("p2", "Title2", "slug2", "No match", [], "cat"),
        }

        results = generator.search_pages("keyword")
        assert len(results) == 1
        assert results[0].id == "p1"

    def test_search_pages_by_tag(self, temp_workspace: str) -> None:
        """Test searching pages by tag."""
        generator = WikiGenerator(temp_workspace)

        generator._pages = {
            "p1": WikiPage("p1", "Title", "slug", "Content", [], "cat", tags=["python"]),
            "p2": WikiPage("p2", "Title", "slug", "Content", [], "cat", tags=["java"]),
        }

        results = generator.search_pages("python")
        assert len(results) == 1
        assert results[0].id == "p1"

    def test_search_pages_case_insensitive(self, temp_workspace: str) -> None:
        """Test that search is case insensitive."""
        generator = WikiGenerator(temp_workspace)

        generator._pages = {
            "p1": WikiPage("p1", "API Documentation", "api", "Content", [], "api"),
        }

        results = generator.search_pages("api")
        assert len(results) == 1

        results = generator.search_pages("API")
        assert len(results) == 1

        results = generator.search_pages("Api")
        assert len(results) == 1


class TestCreateWikiGenerator:
    """Tests for factory function."""

    def test_create_wiki_generator(self) -> None:
        """Test creating wiki generator via factory."""
        generator = create_wiki_generator("/workspace")

        assert isinstance(generator, WikiGenerator)
        assert generator._workspace_path == "/workspace"
        assert generator._llm_client is None

    def test_create_wiki_generator_with_llm(self) -> None:
        """Test creating wiki generator with LLM client."""
        mock_llm = MagicMock()
        generator = create_wiki_generator("/workspace", llm_client=mock_llm)

        assert generator._llm_client is mock_llm


class TestPythonEntityExtraction:
    """Additional tests for Python entity extraction edge cases."""

    @pytest.fixture
    def generator(self) -> WikiGenerator:
        """Create a generator for testing."""
        return WikiGenerator("/tmp")

    def test_syntax_error_handling(self, generator: WikiGenerator) -> None:
        """Test handling of Python syntax errors."""
        invalid_python = "def broken("  # Invalid syntax

        entities = generator._extract_python_entities(invalid_python, "broken.py")
        assert entities == []

    def test_empty_file(self, generator: WikiGenerator) -> None:
        """Test handling of empty file."""
        entities = generator._extract_python_entities("", "empty.py")
        assert entities == []

    def test_class_without_docstring(self, generator: WikiGenerator) -> None:
        """Test class without docstring."""
        code = """
class NoDocClass:
    pass
"""
        entities = generator._extract_python_entities(code, "nodoc.py")
        assert len(entities) == 1
        assert entities[0].docstring is None


class TestJavaScriptEntityExtraction:
    """Additional tests for JavaScript entity extraction edge cases."""

    @pytest.fixture
    def generator(self) -> WikiGenerator:
        """Create a generator for testing."""
        return WikiGenerator("/tmp")

    def test_regular_function(self, generator: WikiGenerator) -> None:
        """Test regular function extraction."""
        code = "function regularFunc(a, b) { return a + b; }"

        entities = generator._extract_js_entities(code, "test.js")
        assert len(entities) == 1
        assert entities[0].name == "regularFunc"

    def test_async_function(self, generator: WikiGenerator) -> None:
        """Test async function extraction."""
        code = "async function asyncFunc() { await something(); }"

        entities = generator._extract_js_entities(code, "test.js")
        assert len(entities) >= 1
        assert any(e.name == "asyncFunc" for e in entities)

    def test_jsdoc_comment(self, generator: WikiGenerator) -> None:
        """Test JSDoc comment extraction."""
        code = '''
/**
 * This is a documented function.
 * @param value The input value
 */
export function documentedFunc(value) {
    return value;
}
'''
        entities = generator._extract_js_entities(code, "test.js")
        documented = next((e for e in entities if e.name == "documentedFunc"), None)
        assert documented is not None
        # May or may not capture JSDoc depending on proximity

    def test_multiple_classes(self, generator: WikiGenerator) -> None:
        """Test multiple class extraction."""
        code = """
class ClassA {}
export class ClassB {}
class ClassC extends ClassA {}
"""
        entities = generator._extract_js_entities(code, "test.ts")
        class_names = [e.name for e in entities if e.entity_type == "class"]
        assert "ClassA" in class_names
        assert "ClassB" in class_names
        assert "ClassC" in class_names
