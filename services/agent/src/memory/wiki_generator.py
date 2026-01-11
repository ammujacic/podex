"""Auto-generate wiki documentation from codebase analysis."""

import re
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

import structlog

logger = structlog.get_logger()


@dataclass
class WikiPage:
    """A wiki page generated from code analysis."""

    id: str
    title: str
    slug: str
    content: str
    source_files: list[str]
    category: str
    tags: list[str] = field(default_factory=list)
    created_at: datetime = field(default_factory=datetime.utcnow)
    updated_at: datetime = field(default_factory=datetime.utcnow)
    auto_generated: bool = True

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for API responses."""
        return {
            "id": self.id,
            "title": self.title,
            "slug": self.slug,
            "content": self.content,
            "source_files": self.source_files,
            "category": self.category,
            "tags": self.tags,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
            "auto_generated": self.auto_generated,
        }


@dataclass
class CodeEntity:
    """A code entity extracted for documentation."""

    name: str
    entity_type: str  # "function", "class", "module", "endpoint"
    file_path: str
    line_number: int
    docstring: str | None
    signature: str | None
    dependencies: list[str] = field(default_factory=list)


class WikiGenerator:
    """
    Auto-generates wiki documentation from codebase.

    Features:
    - Extract docstrings and comments
    - Generate API endpoint documentation
    - Create architecture diagrams descriptions
    - Build component documentation
    - Track documentation freshness
    """

    # File patterns to analyze
    PYTHON_PATTERNS = ["**/*.py"]
    TYPESCRIPT_PATTERNS = ["**/*.ts", "**/*.tsx"]
    JAVASCRIPT_PATTERNS = ["**/*.js", "**/*.jsx"]

    # Directories to skip
    SKIP_DIRS = ["node_modules", "__pycache__", ".git", "dist", "build", "venv", ".venv"]

    def __init__(self, workspace_path: str, llm_client: Any = None):
        self._workspace_path = workspace_path
        self._llm_client = llm_client
        self._pages: dict[str, WikiPage] = {}
        self._entities: list[CodeEntity] = []

    async def generate_wiki(
        self,
        include_private: bool = False,
        max_files: int = 100,
    ) -> list[WikiPage]:
        """
        Generate wiki pages from codebase analysis.

        Args:
            include_private: Include private/internal entities
            max_files: Maximum files to analyze

        Returns:
            List of generated wiki pages
        """
        pages = []

        # Scan for code files
        files = await self._scan_files(max_files)

        # Extract entities from files
        self._entities = []
        for file_path in files:
            entities = await self._extract_entities(file_path)
            if not include_private:
                entities = [e for e in entities if not e.name.startswith("_")]
            self._entities.extend(entities)

        logger.info(
            "wiki_entities_extracted",
            total_files=len(files),
            total_entities=len(self._entities),
        )

        # Generate pages by category
        pages.extend(await self._generate_api_docs())
        pages.extend(await self._generate_component_docs())
        pages.extend(await self._generate_module_docs())

        # Generate overview page
        overview = await self._generate_overview()
        if overview:
            pages.insert(0, overview)

        # Store pages
        for page in pages:
            self._pages[page.id] = page

        logger.info("wiki_generated", total_pages=len(pages))
        return pages

    async def _scan_files(self, max_files: int) -> list[Path]:
        """Scan workspace for code files."""
        files = []
        workspace = Path(self._workspace_path)

        all_patterns = self.PYTHON_PATTERNS + self.TYPESCRIPT_PATTERNS + self.JAVASCRIPT_PATTERNS

        for pattern in all_patterns:
            for path in workspace.glob(pattern):
                # Skip excluded directories
                if any(skip in path.parts for skip in self.SKIP_DIRS):
                    continue

                files.append(path)
                if len(files) >= max_files:
                    break

            if len(files) >= max_files:
                break

        return files

    async def _extract_entities(self, file_path: Path) -> list[CodeEntity]:
        """Extract code entities from a file."""
        entities = []

        try:
            content = file_path.read_text()
            relative_path = str(file_path.relative_to(self._workspace_path))
            suffix = file_path.suffix

            if suffix == ".py":
                entities = self._extract_python_entities(content, relative_path)
            elif suffix in [".ts", ".tsx", ".js", ".jsx"]:
                entities = self._extract_js_entities(content, relative_path)

        except Exception as e:
            logger.warning("entity_extraction_failed", file=str(file_path), error=str(e))

        return entities

    def _extract_python_entities(self, content: str, file_path: str) -> list[CodeEntity]:
        """Extract entities from Python file."""
        import ast

        entities = []

        try:
            tree = ast.parse(content)

            for node in ast.walk(tree):
                if isinstance(node, ast.FunctionDef):
                    docstring = ast.get_docstring(node)
                    signature = self._get_python_signature(node)
                    entities.append(
                        CodeEntity(
                            name=node.name,
                            entity_type="function",
                            file_path=file_path,
                            line_number=node.lineno,
                            docstring=docstring,
                            signature=signature,
                        )
                    )

                elif isinstance(node, ast.ClassDef):
                    docstring = ast.get_docstring(node)
                    entities.append(
                        CodeEntity(
                            name=node.name,
                            entity_type="class",
                            file_path=file_path,
                            line_number=node.lineno,
                            docstring=docstring,
                            signature=f"class {node.name}",
                        )
                    )

                elif isinstance(node, ast.AsyncFunctionDef):
                    docstring = ast.get_docstring(node)
                    signature = self._get_python_signature(node, is_async=True)
                    # Check if it's an API endpoint
                    entity_type = (
                        "endpoint"
                        if any(
                            d.attr in ["get", "post", "put", "delete", "patch"]
                            for d in node.decorator_list
                            if isinstance(d, ast.Attribute)
                        )
                        else "function"
                    )

                    entities.append(
                        CodeEntity(
                            name=node.name,
                            entity_type=entity_type,
                            file_path=file_path,
                            line_number=node.lineno,
                            docstring=docstring,
                            signature=signature,
                        )
                    )

        except SyntaxError:
            pass

        return entities

    def _get_python_signature(self, node: Any, is_async: bool = False) -> str:
        """Get function signature from AST node."""
        args = []
        for arg in node.args.args:
            args.append(arg.arg)
        prefix = "async def " if is_async else "def "
        return f"{prefix}{node.name}({', '.join(args)})"

    def _extract_js_entities(self, content: str, file_path: str) -> list[CodeEntity]:
        """Extract entities from JavaScript/TypeScript file."""
        entities = []

        # Function patterns
        function_patterns = [
            # export function name(...)
            r"export\s+(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)",
            # export const name = (...)
            r"export\s+const\s+(\w+)\s*=\s*(?:async\s+)?\(([^)]*)\)\s*=>",
            # function name(...)
            r"(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)",
        ]

        # Class pattern
        class_pattern = r"(?:export\s+)?class\s+(\w+)"

        # Find JSDoc comments
        jsdoc_pattern = r"/\*\*([\s\S]*?)\*/\s*(?=export|function|class|const)"
        jsdoc_matches = list(re.finditer(jsdoc_pattern, content))

        for pattern in function_patterns:
            for match in re.finditer(pattern, content, re.MULTILINE):
                name = match.group(1)
                params = match.group(2) if len(match.groups()) > 1 else ""
                line_num = content[: match.start()].count("\n") + 1

                # Find associated JSDoc
                docstring = None
                for jsdoc in jsdoc_matches:
                    if jsdoc.end() <= match.start() + 100:  # Close proximity
                        docstring = jsdoc.group(1).strip()
                        docstring = re.sub(r"\s*\*\s*", " ", docstring).strip()

                entities.append(
                    CodeEntity(
                        name=name,
                        entity_type="function",
                        file_path=file_path,
                        line_number=line_num,
                        docstring=docstring,
                        signature=f"function {name}({params})",
                    )
                )

        for match in re.finditer(class_pattern, content, re.MULTILINE):
            name = match.group(1)
            line_num = content[: match.start()].count("\n") + 1

            entities.append(
                CodeEntity(
                    name=name,
                    entity_type="class",
                    file_path=file_path,
                    line_number=line_num,
                    docstring=None,
                    signature=f"class {name}",
                )
            )

        return entities

    async def _generate_api_docs(self) -> list[WikiPage]:
        """Generate API endpoint documentation."""
        endpoints = [e for e in self._entities if e.entity_type == "endpoint"]

        if not endpoints:
            return []

        import uuid

        # Group by file
        by_file: dict[str, list[CodeEntity]] = {}
        for endpoint in endpoints:
            if endpoint.file_path not in by_file:
                by_file[endpoint.file_path] = []
            by_file[endpoint.file_path].append(endpoint)

        pages = []
        for file_path, file_endpoints in by_file.items():
            content_lines = [f"# API Endpoints: {file_path.split('/')[-1]}\n"]

            for ep in file_endpoints:
                content_lines.append(f"## {ep.name}")
                content_lines.append(f"**File:** `{ep.file_path}:{ep.line_number}`")
                content_lines.append(f"**Signature:** `{ep.signature}`")
                if ep.docstring:
                    content_lines.append(f"\n{ep.docstring}\n")
                content_lines.append("---\n")

            page = WikiPage(
                id=str(uuid.uuid4()),
                title=f"API: {file_path.split('/')[-1].replace('.py', '')}",
                slug=f"api-{file_path.replace('/', '-').replace('.py', '')}",
                content="\n".join(content_lines),
                source_files=[file_path],
                category="api",
                tags=["api", "endpoints"],
            )
            pages.append(page)

        return pages

    async def _generate_component_docs(self) -> list[WikiPage]:
        """Generate component documentation for React/Vue components."""
        components = [
            e
            for e in self._entities
            if e.entity_type in ["class", "function"]
            and any(ext in e.file_path for ext in [".tsx", ".jsx", ".vue"])
        ]

        if not components:
            return []

        import uuid

        content_lines = ["# Components\n"]
        source_files = set()

        for comp in sorted(components, key=lambda c: c.name):
            content_lines.append(f"## {comp.name}")
            content_lines.append(f"**File:** `{comp.file_path}:{comp.line_number}`")
            if comp.docstring:
                content_lines.append(f"\n{comp.docstring}\n")
            content_lines.append("")
            source_files.add(comp.file_path)

        if len(content_lines) <= 1:
            return []

        page = WikiPage(
            id=str(uuid.uuid4()),
            title="Components",
            slug="components",
            content="\n".join(content_lines),
            source_files=list(source_files),
            category="components",
            tags=["react", "components", "ui"],
        )

        return [page]

    async def _generate_module_docs(self) -> list[WikiPage]:
        """Generate module documentation."""
        modules = [e for e in self._entities if e.entity_type in ["class", "function"]]

        # Group by directory
        by_dir: dict[str, list[CodeEntity]] = {}
        for entity in modules:
            dir_path = "/".join(entity.file_path.split("/")[:-1]) or "root"
            if dir_path not in by_dir:
                by_dir[dir_path] = []
            by_dir[dir_path].append(entity)

        import uuid

        pages = []

        for dir_path, entities in by_dir.items():
            if len(entities) < 3:  # Skip small directories
                continue

            content_lines = [f"# Module: {dir_path}\n"]

            # Group by entity type
            classes = [e for e in entities if e.entity_type == "class"]
            functions = [e for e in entities if e.entity_type == "function"]

            if classes:
                content_lines.append("## Classes\n")
                for cls in sorted(classes, key=lambda c: c.name):
                    content_lines.append(f"### {cls.name}")
                    content_lines.append(f"**File:** `{cls.file_path}:{cls.line_number}`")
                    if cls.docstring:
                        content_lines.append(f"\n{cls.docstring}\n")
                    content_lines.append("")

            if functions:
                content_lines.append("## Functions\n")
                for func in sorted(functions, key=lambda f: f.name)[:20]:  # Limit
                    content_lines.append(f"### {func.name}")
                    content_lines.append(f"`{func.signature}`")
                    if func.docstring:
                        docstring = (
                            func.docstring[:200] + "..."
                            if len(func.docstring) > 200
                            else func.docstring
                        )
                        content_lines.append(f"\n{docstring}\n")
                    content_lines.append("")

            page = WikiPage(
                id=str(uuid.uuid4()),
                title=f"Module: {dir_path}",
                slug=f"module-{dir_path.replace('/', '-')}",
                content="\n".join(content_lines),
                source_files=list(set(e.file_path for e in entities)),
                category="modules",
                tags=["module", dir_path.split("/")[0] if "/" in dir_path else dir_path],
            )
            pages.append(page)

        return pages

    async def _generate_overview(self) -> WikiPage | None:
        """Generate project overview page."""
        import uuid

        if not self._entities:
            return None

        # Count statistics
        total_files = len(set(e.file_path for e in self._entities))
        total_classes = len([e for e in self._entities if e.entity_type == "class"])
        total_functions = len([e for e in self._entities if e.entity_type == "function"])
        total_endpoints = len([e for e in self._entities if e.entity_type == "endpoint"])

        content = f"""# Project Documentation

## Overview

This documentation was auto-generated from the codebase.

## Statistics

| Metric | Count |
|--------|-------|
| Files Analyzed | {total_files} |
| Classes | {total_classes} |
| Functions | {total_functions} |
| API Endpoints | {total_endpoints} |

## Categories

- **API**: REST API endpoint documentation
- **Components**: UI component documentation
- **Modules**: Module and library documentation

## Last Updated

{datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")}
"""

        return WikiPage(
            id=str(uuid.uuid4()),
            title="Documentation Overview",
            slug="overview",
            content=content,
            source_files=[],
            category="overview",
            tags=["overview", "index"],
        )

    def get_page(self, page_id: str) -> WikiPage | None:
        """Get a wiki page by ID."""
        return self._pages.get(page_id)

    def get_all_pages(self) -> list[WikiPage]:
        """Get all wiki pages."""
        return list(self._pages.values())

    def search_pages(self, query: str) -> list[WikiPage]:
        """Search wiki pages by content."""
        query_lower = query.lower()
        return [
            page
            for page in self._pages.values()
            if query_lower in page.title.lower()
            or query_lower in page.content.lower()
            or any(query_lower in tag for tag in page.tags)
        ]


# Factory function
def create_wiki_generator(workspace_path: str, llm_client: Any = None) -> WikiGenerator:
    """Create a wiki generator for a workspace."""
    return WikiGenerator(workspace_path, llm_client)
