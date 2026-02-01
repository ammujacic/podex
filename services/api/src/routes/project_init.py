"""Project initialization routes.

Provides /init command functionality to generate AGENTS.md and project context.
"""

from typing import Annotated

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.compute_client import get_compute_client_for_workspace
from src.database.connection import get_db
from src.database.models import Session
from src.middleware.rate_limit import RATE_LIMIT_STANDARD, limiter

logger = structlog.get_logger()

router = APIRouter(prefix="/init", tags=["init"])

DbSession = Annotated[AsyncSession, Depends(get_db)]


# =============================================================================
# Request/Response Models
# =============================================================================


class ProjectInitRequest(BaseModel):
    """Request to initialize project."""

    session_id: str
    include_dependencies: bool = Field(default=True, description="Analyze dependencies")
    include_structure: bool = Field(default=True, description="Include directory structure")
    custom_context: str | None = Field(default=None, description="Additional context to include")


class ProjectInfo(BaseModel):
    """Detected project information."""

    name: str
    type: str  # e.g., "nextjs", "python", "go", "rust", "unknown"
    language: str
    framework: str | None
    package_manager: str | None
    has_tests: bool
    has_ci: bool
    git_initialized: bool


class ProjectInitResponse(BaseModel):
    """Response with generated AGENTS.md content."""

    success: bool
    project_info: ProjectInfo | None
    agents_md_content: str
    file_path: str
    created: bool  # Whether file was created (vs already existed)
    message: str


# =============================================================================
# Project Detection Logic
# =============================================================================


FRAMEWORK_INDICATORS = {
    # JavaScript/TypeScript frameworks
    "nextjs": ["next.config.js", "next.config.mjs", "next.config.ts"],
    "react": ["vite.config.js", "vite.config.ts", "create-react-app"],
    "vue": ["vue.config.js", "vite.config.ts", "nuxt.config.js"],
    "angular": ["angular.json"],
    "svelte": ["svelte.config.js"],
    "express": ["express"],  # Check package.json
    "fastify": ["fastify"],
    # Python frameworks
    "django": ["manage.py", "django"],
    "fastapi": ["fastapi"],
    "flask": ["flask"],
    # Go frameworks
    "gin": ["gin-gonic/gin"],
    "fiber": ["gofiber/fiber"],
    "echo": ["labstack/echo"],
    # Rust frameworks
    "actix": ["actix-web"],
    "axum": ["axum"],
    "rocket": ["rocket"],
}

LANGUAGE_BY_FILE = {
    "package.json": "javascript",
    "tsconfig.json": "typescript",
    "pyproject.toml": "python",
    "requirements.txt": "python",
    "setup.py": "python",
    "go.mod": "go",
    "Cargo.toml": "rust",
    "pom.xml": "java",
    "build.gradle": "java",
    "Gemfile": "ruby",
    "mix.exs": "elixir",
}

PACKAGE_MANAGER_BY_FILE = {
    "package-lock.json": "npm",
    "yarn.lock": "yarn",
    "pnpm-lock.yaml": "pnpm",
    "bun.lockb": "bun",
    "Pipfile.lock": "pipenv",
    "poetry.lock": "poetry",
    "uv.lock": "uv",
}


async def detect_project_info(
    workspace_id: str,
    user_id: str,
) -> ProjectInfo:
    """Detect project type and configuration.

    Args:
        workspace_id: Workspace ID
        user_id: User ID for compute client auth

    Returns:
        Detected project information
    """
    # Get file listing from workspace
    try:
        compute = await get_compute_client_for_workspace(workspace_id)
        files_response = await compute.list_files(workspace_id, ".", user_id)
        entries: list[dict[str, str]] = (
            files_response.get("entries", []) if isinstance(files_response, dict) else []
        )
        root_files = {f["name"] for f in entries}
    except Exception as e:
        logger.warning("Failed to list workspace files", error=str(e))
        root_files = set()

    # Detect language
    language = "unknown"
    for indicator_file, lang in LANGUAGE_BY_FILE.items():
        if indicator_file in root_files:
            language = lang
            break

    # Detect package manager
    package_manager = None
    for lock_file, pm in PACKAGE_MANAGER_BY_FILE.items():
        if lock_file in root_files:
            package_manager = pm
            break

    # Detect framework
    framework = None
    for fw_name, indicators in FRAMEWORK_INDICATORS.items():
        for indicator in indicators:
            if indicator in root_files:
                framework = fw_name
                break
        if framework:
            break

    # Determine project type
    if framework:
        project_type = framework
    elif language != "unknown":
        project_type = language
    else:
        project_type = "unknown"

    # Check for tests
    has_tests = any(
        f in root_files
        for f in ["tests", "test", "__tests__", "spec", "pytest.ini", "jest.config.js"]
    )

    # Check for CI
    has_ci = ".github" in root_files or ".gitlab-ci.yml" in root_files or ".circleci" in root_files

    # Check for git
    git_initialized = ".git" in root_files

    # Try to get project name from package.json or similar
    project_name = "project"
    try:
        if "package.json" in root_files:
            pkg_response = await compute.read_file(workspace_id, "package.json", user_id)
            if pkg_response.get("success"):
                import json

                pkg = json.loads(pkg_response.get("content", "{}"))
                project_name = pkg.get("name", "project")
        elif "pyproject.toml" in root_files:
            # Simple extraction for Python projects
            project_name = "python-project"
        elif "go.mod" in root_files:
            mod_response = await compute.read_file(workspace_id, "go.mod", user_id)
            if mod_response.get("success"):
                content = mod_response.get("content", "")
                for line in content.splitlines():
                    if line.startswith("module "):
                        project_name = line.split()[-1].split("/")[-1]
                        break
    except Exception as e:
        logger.debug("Project name detection failure (non-critical)", error=str(e))

    return ProjectInfo(
        name=project_name,
        type=project_type,
        language=language,
        framework=framework,
        package_manager=package_manager,
        has_tests=has_tests,
        has_ci=has_ci,
        git_initialized=git_initialized,
    )


def generate_agents_md(
    project_info: ProjectInfo,
    custom_context: str | None = None,
) -> str:
    """Generate AGENTS.md content based on project info.

    Args:
        project_info: Detected project information
        custom_context: Optional custom context to include

    Returns:
        Generated AGENTS.md content
    """
    sections = []

    # Header
    sections.append(f"# {project_info.name}")
    sections.append("")
    sections.append("This file provides context for AI agents working on this project.")
    sections.append("")

    # Project Overview
    sections.append("## Project Overview")
    sections.append("")
    sections.append(f"- **Language**: {project_info.language}")
    if project_info.framework:
        sections.append(f"- **Framework**: {project_info.framework}")
    if project_info.package_manager:
        sections.append(f"- **Package Manager**: {project_info.package_manager}")
    sections.append("")

    # Development Commands
    sections.append("## Development Commands")
    sections.append("")

    if project_info.language in ("javascript", "typescript"):
        pm = project_info.package_manager or "npm"
        sections.append("```bash")
        sections.append("# Install dependencies")
        sections.append(f"{pm} install")
        sections.append("")
        sections.append("# Start development server")
        sections.append(f"{pm} run dev")
        sections.append("")
        sections.append("# Run tests")
        sections.append(f"{pm} test")
        sections.append("")
        sections.append("# Build for production")
        sections.append(f"{pm} run build")
        sections.append("```")
    elif project_info.language == "python":
        sections.append("```bash")
        sections.append("# Install dependencies")
        if project_info.package_manager == "poetry":
            sections.append("poetry install")
        elif project_info.package_manager == "uv":
            sections.append("uv sync")
        else:
            sections.append("pip install -r requirements.txt")
        sections.append("")
        sections.append("# Run tests")
        sections.append("pytest")
        sections.append("")
        if project_info.framework == "fastapi":
            sections.append("# Start development server")
            sections.append("uvicorn main:app --reload")
        elif project_info.framework == "django":
            sections.append("# Start development server")
            sections.append("python manage.py runserver")
        sections.append("```")
    elif project_info.language == "go":
        sections.append("```bash")
        sections.append("# Install dependencies")
        sections.append("go mod download")
        sections.append("")
        sections.append("# Run tests")
        sections.append("go test ./...")
        sections.append("")
        sections.append("# Build")
        sections.append("go build ./...")
        sections.append("```")
    elif project_info.language == "rust":
        sections.append("```bash")
        sections.append("# Build")
        sections.append("cargo build")
        sections.append("")
        sections.append("# Run tests")
        sections.append("cargo test")
        sections.append("")
        sections.append("# Run")
        sections.append("cargo run")
        sections.append("```")
    else:
        sections.append("_Add your development commands here._")
    sections.append("")

    # Code Style
    sections.append("## Code Style")
    sections.append("")
    if project_info.language in ("javascript", "typescript"):
        sections.append("- Use TypeScript for type safety")
        sections.append("- Follow ESLint/Prettier configuration")
        sections.append("- Prefer functional components with hooks")
        sections.append("- Use meaningful variable and function names")
    elif project_info.language == "python":
        sections.append("- Follow PEP 8 style guide")
        sections.append("- Use type hints for function signatures")
        sections.append("- Use ruff for linting and formatting")
        sections.append("- Keep functions focused and well-documented")
    elif project_info.language == "go":
        sections.append("- Follow standard Go conventions")
        sections.append("- Use gofmt for formatting")
        sections.append("- Handle errors explicitly")
        sections.append("- Write table-driven tests")
    elif project_info.language == "rust":
        sections.append("- Follow Rust idioms and conventions")
        sections.append("- Use clippy for linting")
        sections.append("- Prefer Result over panic")
        sections.append("- Document public APIs")
    else:
        sections.append("_Add your code style guidelines here._")
    sections.append("")

    # Testing
    sections.append("## Testing")
    sections.append("")
    if project_info.has_tests:
        sections.append("This project has tests. Please ensure:")
        sections.append("- All new features have corresponding tests")
        sections.append("- Tests pass before committing")
        sections.append("- Test coverage is maintained or improved")
    else:
        sections.append("_Consider adding tests to this project._")
    sections.append("")

    # Architecture section for user customization
    sections.append("## Architecture")
    sections.append("")
    sections.append("_Describe the project architecture here:_")
    sections.append("")
    sections.append("- Key directories and their purposes")
    sections.append("- Important patterns used")
    sections.append("- External services/APIs")
    sections.append("")

    # Custom context
    if custom_context:
        sections.append("## Additional Context")
        sections.append("")
        sections.append(custom_context)
        sections.append("")

    # Agent Instructions
    sections.append("## Agent Instructions")
    sections.append("")
    sections.append("When working on this project:")
    sections.append("")
    sections.append(
        "1. **Read before modifying** - Always read existing code before making changes"
    )
    sections.append("2. **Follow patterns** - Match existing code style and patterns")
    sections.append("3. **Test changes** - Run tests after making changes")
    sections.append("4. **Small commits** - Make focused, incremental changes")
    sections.append("5. **Ask questions** - If requirements are unclear, ask for clarification")
    sections.append("")

    return "\n".join(sections)


# =============================================================================
# Routes
# =============================================================================


@router.post("/project", response_model=ProjectInitResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def init_project(
    data: ProjectInitRequest,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> ProjectInitResponse:
    """Initialize project with AGENTS.md file.

    Analyzes the project structure and generates an AGENTS.md file
    with context for AI agents.

    If AGENTS.md already exists, returns its current content.
    """
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    # Get session and workspace
    session_result = await db.execute(select(Session).where(Session.id == data.session_id))
    session = session_result.scalar_one_or_none()

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if session.owner_id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    if not session.workspace_id:
        raise HTTPException(status_code=400, detail="Session has no workspace")

    workspace_id = session.workspace_id

    # Check if AGENTS.md already exists
    compute = await get_compute_client_for_workspace(workspace_id)
    try:
        existing = await compute.read_file(workspace_id, "AGENTS.md", user_id)
        if existing.get("success"):
            return ProjectInitResponse(
                success=True,
                project_info=None,
                agents_md_content=existing.get("content", ""),
                file_path="AGENTS.md",
                created=False,
                message="AGENTS.md already exists",
            )
    except Exception as e:
        logger.debug("AGENTS.md does not exist, will create new file", error=str(e))

    # Detect project info
    project_info = await detect_project_info(workspace_id, user_id)

    # Generate AGENTS.md content
    agents_md_content = generate_agents_md(project_info, data.custom_context)

    # Write the file
    try:
        await compute.write_file(workspace_id, user_id, "AGENTS.md", agents_md_content)
    except Exception as e:
        # SECURITY: Log full error internally but don't expose to client
        logger.warning("Failed to write AGENTS.md", error=str(e))
        raise HTTPException(
            status_code=500,
            detail="Failed to write AGENTS.md. Please try again or contact support.",
        ) from e

    logger.info(
        "Project initialized",
        session_id=data.session_id,
        project_type=project_info.type,
        language=project_info.language,
    )

    return ProjectInitResponse(
        success=True,
        project_info=project_info,
        agents_md_content=agents_md_content,
        file_path="AGENTS.md",
        created=True,
        message=f"Created AGENTS.md for {project_info.type} project",
    )


@router.get("/project/{session_id}/info", response_model=ProjectInfo)
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_project_info(
    session_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> ProjectInfo:
    """Get detected project information without creating AGENTS.md."""
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    # Get session and workspace
    session_result = await db.execute(select(Session).where(Session.id == session_id))
    session = session_result.scalar_one_or_none()

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if session.owner_id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    if not session.workspace_id:
        raise HTTPException(status_code=400, detail="Session has no workspace")

    return await detect_project_info(session.workspace_id, user_id)
