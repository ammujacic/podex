"""Workspace management routes."""

import os
import re
from pathlib import Path
from typing import Annotated, Any

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.database.connection import get_db
from src.database.models import PodTemplate, Session, SessionShare, Workspace
from src.middleware.rate_limit import RATE_LIMIT_STANDARD, RATE_LIMIT_UPLOAD, limiter

logger = structlog.get_logger()

router = APIRouter()

# Allowed workspace root paths
ALLOWED_WORKSPACE_ROOTS = {"/workspace", "/home/user", "/app"}

# Dangerous path patterns
_DANGEROUS_PATH_PATTERNS = re.compile(
    r"(^|/)\.\.(/|$)|"  # Parent directory traversal
    r"^\s*~|"  # Home directory expansion
    r"[\x00-\x1f]|"  # Control characters
    r"^/etc|^/proc|^/sys|^/dev|"  # System directories
    r"^/root|^/var/run|^/var/log"  # Sensitive directories
)


def validate_file_path(path: str, workspace_root: str = "/workspace") -> str:
    """Validate and normalize a file path to prevent path traversal attacks.

    Args:
        path: The file path to validate.
        workspace_root: The allowed root directory for the workspace.

    Returns:
        The normalized, validated path.

    Raises:
        HTTPException: If the path is invalid or attempts traversal.
    """
    if not path:
        raise HTTPException(status_code=400, detail="Path cannot be empty")

    # Check for null bytes (common attack vector)
    if "\x00" in path:
        logger.warning("Path contains null byte", path=path[:50])
        raise HTTPException(status_code=400, detail="Invalid path: contains null byte")

    # Check for dangerous patterns
    if _DANGEROUS_PATH_PATTERNS.search(path):
        logger.warning("Path contains dangerous pattern", path=path[:100])
        raise HTTPException(status_code=400, detail="Invalid path: contains forbidden pattern")

    # Normalize the path
    normalized = os.path.normpath(path)

    # Ensure path doesn't escape workspace root
    if not normalized.startswith(workspace_root):
        # Check if it's a relative path that should be under workspace root
        if not path.startswith("/"):
            normalized = os.path.normpath(str(Path(workspace_root) / path))
        else:
            # Check against allowed roots
            is_allowed = any(normalized.startswith(root) for root in ALLOWED_WORKSPACE_ROOTS)
            if not is_allowed:
                logger.warning(
                    "Path traversal attempt detected",
                    path=path[:100],
                    normalized=normalized[:100],
                )
                raise HTTPException(
                    status_code=400,
                    detail="Invalid path: access outside workspace not allowed",
                )

    # Final validation - ensure we're still within allowed bounds after normalization
    if ".." in normalized:
        raise HTTPException(status_code=400, detail="Invalid path: directory traversal not allowed")

    return normalized


# Type aliases for dependencies
DbSession = Annotated[AsyncSession, Depends(get_db)]


async def verify_workspace_access(
    workspace_id: str,
    request: Request,
    db: AsyncSession,
) -> Workspace:
    """Verify user has access to the workspace.

    Access is granted if the user:
    1. Owns the session associated with the workspace, OR
    2. Has been shared access via SessionShare

    Args:
        workspace_id: The workspace ID to check.
        request: The FastAPI request (for user_id extraction).
        db: Database session.

    Returns:
        The workspace if access is granted.

    Raises:
        HTTPException: If workspace not found or access denied.
    """
    from sqlalchemy.orm import selectinload

    result = await db.execute(
        select(Workspace)
        .where(Workspace.id == workspace_id)
        .options(selectinload(Workspace.session))
    )
    workspace = result.scalar_one_or_none()

    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")

    # Get user ID from request state (set by auth middleware)
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    # Check if user owns the session associated with this workspace
    session_result = await db.execute(select(Session).where(Session.workspace_id == workspace_id))
    session = session_result.scalar_one_or_none()

    # If no session is linked, this is an orphaned workspace - deny access
    if not session:
        raise HTTPException(status_code=403, detail="Workspace has no associated session")

    # Owner always has access
    if session.owner_id == user_id:
        return workspace

    # Check if user has been shared access to this session
    share_result = await db.execute(
        select(SessionShare)
        .where(SessionShare.session_id == session.id)
        .where(SessionShare.shared_with_id == user_id)
    )
    share = share_result.scalar_one_or_none()

    if share:
        # User has shared access
        return workspace

    # No access - not owner and not shared
    raise HTTPException(status_code=403, detail="Not authorized to access this workspace")


class WorkspaceResponse(BaseModel):
    """Workspace response."""

    id: str
    session_id: str | None
    container_id: str | None
    status: str
    s3_bucket: str | None
    s3_prefix: str | None
    root_path: str
    ports: list[dict[str, object]]


class FileNode(BaseModel):
    """File tree node."""

    name: str
    path: str
    type: str  # file or directory
    children: list["FileNode"] | None = None


class FileContent(BaseModel):
    """File content response."""

    path: str
    content: str
    language: str


# =============================================================================
# Demo Template Data - Language-specific file trees and contents
# =============================================================================

# Python template
_PYTHON_FILE_TREE = [
    FileNode(
        name="src",
        path="/workspace/src",
        type="directory",
        children=[
            FileNode(name="__init__.py", path="/workspace/src/__init__.py", type="file"),
            FileNode(name="main.py", path="/workspace/src/main.py", type="file"),
            FileNode(name="utils.py", path="/workspace/src/utils.py", type="file"),
        ],
    ),
    FileNode(
        name="tests",
        path="/workspace/tests",
        type="directory",
        children=[
            FileNode(name="__init__.py", path="/workspace/tests/__init__.py", type="file"),
            FileNode(name="test_main.py", path="/workspace/tests/test_main.py", type="file"),
        ],
    ),
    FileNode(name="requirements.txt", path="/workspace/requirements.txt", type="file"),
    FileNode(name="pyproject.toml", path="/workspace/pyproject.toml", type="file"),
    FileNode(name="README.md", path="/workspace/README.md", type="file"),
]

_PYTHON_CONTENTS = {
    "/workspace/src/__init__.py": '''"""Main package for the application."""

__version__ = "0.1.0"
''',
    "/workspace/src/main.py": '''"""Main application entry point."""

from src.utils import greet


def main() -> None:
    """Run the main application."""
    message = greet("Podex")
    print(message)


if __name__ == "__main__":
    main()
''',
    "/workspace/src/utils.py": '''"""Utility functions."""


def greet(name: str) -> str:
    """Return a greeting message.

    Args:
        name: The name to greet.

    Returns:
        A greeting string.
    """
    return f"Hello, {name}! Welcome to your Python workspace."


def add(a: int, b: int) -> int:
    """Add two numbers.

    Args:
        a: First number.
        b: Second number.

    Returns:
        The sum of a and b.
    """
    return a + b
''',
    "/workspace/tests/__init__.py": '''"""Test package."""
''',
    "/workspace/tests/test_main.py": '''"""Tests for main module."""

import pytest

from src.utils import add, greet


def test_greet() -> None:
    """Test the greet function."""
    result = greet("World")
    assert "Hello, World!" in result


def test_add() -> None:
    """Test the add function."""
    assert add(2, 3) == 5
    assert add(-1, 1) == 0
''',
    "/workspace/requirements.txt": """pytest>=7.4.0
ruff>=0.1.0
mypy>=1.7.0
""",
    "/workspace/pyproject.toml": """[project]
name = "my-python-app"
version = "0.1.0"
description = "A Python application built with Podex"
requires-python = ">=3.10"
dependencies = []

[project.optional-dependencies]
dev = ["pytest", "ruff", "mypy"]

[tool.ruff]
line-length = 100
target-version = "py310"

[tool.mypy]
python_version = "3.10"
strict = true
""",
    "/workspace/README.md": """# My Python App

A Python application built with Podex.

## Getting Started

```bash
# Install dependencies
pip install -r requirements.txt

# Run the application
python -m src.main

# Run tests
pytest
```
""",
}

# Node.js template
_NODEJS_FILE_TREE = [
    FileNode(
        name="src",
        path="/workspace/src",
        type="directory",
        children=[
            FileNode(name="index.ts", path="/workspace/src/index.ts", type="file"),
            FileNode(name="app.ts", path="/workspace/src/app.ts", type="file"),
            FileNode(name="utils.ts", path="/workspace/src/utils.ts", type="file"),
        ],
    ),
    FileNode(name="package.json", path="/workspace/package.json", type="file"),
    FileNode(name="tsconfig.json", path="/workspace/tsconfig.json", type="file"),
    FileNode(name="README.md", path="/workspace/README.md", type="file"),
]

_NODEJS_CONTENTS = {
    "/workspace/src/index.ts": """import { App } from './app';

const app = new App();
app.run();
""",
    "/workspace/src/app.ts": """import { greet } from './utils';

export class App {
  run(): void {
    const message = greet('Podex');
    console.log(message);
  }
}
""",
    "/workspace/src/utils.ts": """/**
 * Return a greeting message.
 * @param name - The name to greet
 * @returns A greeting string
 */
export function greet(name: string): string {
  return `Hello, ${name}! Welcome to your Node.js workspace.`;
}

/**
 * Add two numbers.
 * @param a - First number
 * @param b - Second number
 * @returns The sum of a and b
 */
export function add(a: number, b: number): number {
  return a + b;
}
""",
    "/workspace/package.json": """{
  "name": "my-nodejs-app",
  "version": "1.0.0",
  "description": "A Node.js application built with Podex",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsx src/index.ts",
    "test": "vitest"
  },
  "dependencies": {},
  "devDependencies": {
    "typescript": "^5.3.0",
    "tsx": "^4.7.0",
    "vitest": "^1.2.0"
  }
}
""",
    "/workspace/tsconfig.json": """{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
""",
    "/workspace/README.md": """# My Node.js App

A Node.js application built with Podex.

## Getting Started

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build for production
npm run build

# Run tests
npm test
```
""",
}

# Go template
_GOLANG_FILE_TREE = [
    FileNode(
        name="cmd",
        path="/workspace/cmd",
        type="directory",
        children=[
            FileNode(name="main.go", path="/workspace/cmd/main.go", type="file"),
        ],
    ),
    FileNode(
        name="internal",
        path="/workspace/internal",
        type="directory",
        children=[
            FileNode(
                name="app",
                path="/workspace/internal/app",
                type="directory",
                children=[
                    FileNode(name="app.go", path="/workspace/internal/app/app.go", type="file"),
                ],
            ),
        ],
    ),
    FileNode(name="go.mod", path="/workspace/go.mod", type="file"),
    FileNode(name="README.md", path="/workspace/README.md", type="file"),
]

_GOLANG_CONTENTS = {
    "/workspace/cmd/main.go": """package main

import (
	"fmt"

	"myapp/internal/app"
)

func main() {
	application := app.New()
	message := application.Greet("Podex")
	fmt.Println(message)
}
""",
    "/workspace/internal/app/app.go": """package app

import "fmt"

// App represents the main application.
type App struct{}

// New creates a new App instance.
func New() *App {
	return &App{}
}

// Greet returns a greeting message.
func (a *App) Greet(name string) string {
	return fmt.Sprintf("Hello, %s! Welcome to your Go workspace.", name)
}

// Add returns the sum of two integers.
func Add(a, b int) int {
	return a + b
}
""",
    "/workspace/go.mod": """module myapp

go 1.21
""",
    "/workspace/README.md": """# My Go App

A Go application built with Podex.

## Getting Started

```bash
# Run the application
go run cmd/main.go

# Build the binary
go build -o bin/app cmd/main.go

# Run tests
go test ./...
```
""",
}

# Rust template
_RUST_FILE_TREE = [
    FileNode(
        name="src",
        path="/workspace/src",
        type="directory",
        children=[
            FileNode(name="main.rs", path="/workspace/src/main.rs", type="file"),
            FileNode(name="lib.rs", path="/workspace/src/lib.rs", type="file"),
        ],
    ),
    FileNode(name="Cargo.toml", path="/workspace/Cargo.toml", type="file"),
    FileNode(name="README.md", path="/workspace/README.md", type="file"),
]

_RUST_CONTENTS = {
    "/workspace/src/main.rs": """use myapp::greet;

fn main() {
    let message = greet("Podex");
    println!("{}", message);
}
""",
    "/workspace/src/lib.rs": """//! A Rust application built with Podex.

/// Returns a greeting message.
///
/// # Arguments
///
/// * `name` - The name to greet
///
/// # Examples
///
/// ```
/// let message = myapp::greet("World");
/// assert!(message.contains("Hello, World!"));
/// ```
pub fn greet(name: &str) -> String {
    format!("Hello, {}! Welcome to your Rust workspace.", name)
}

/// Adds two numbers.
///
/// # Arguments
///
/// * `a` - First number
/// * `b` - Second number
pub fn add(a: i32, b: i32) -> i32 {
    a + b
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_greet() {
        let result = greet("World");
        assert!(result.contains("Hello, World!"));
    }

    #[test]
    fn test_add() {
        assert_eq!(add(2, 3), 5);
        assert_eq!(add(-1, 1), 0);
    }
}
""",
    "/workspace/Cargo.toml": """[package]
name = "myapp"
version = "0.1.0"
edition = "2021"
description = "A Rust application built with Podex"

[dependencies]

[dev-dependencies]
""",
    "/workspace/README.md": """# My Rust App

A Rust application built with Podex.

## Getting Started

```bash
# Run the application
cargo run

# Build for release
cargo build --release

# Run tests
cargo test
```
""",
}

# Fullstack template (React frontend + Python backend)
_FULLSTACK_FILE_TREE = [
    FileNode(
        name="frontend",
        path="/workspace/frontend",
        type="directory",
        children=[
            FileNode(
                name="src",
                path="/workspace/frontend/src",
                type="directory",
                children=[
                    FileNode(name="App.tsx", path="/workspace/frontend/src/App.tsx", type="file"),
                    FileNode(
                        name="index.tsx", path="/workspace/frontend/src/index.tsx", type="file"
                    ),
                ],
            ),
            FileNode(name="package.json", path="/workspace/frontend/package.json", type="file"),
        ],
    ),
    FileNode(
        name="backend",
        path="/workspace/backend",
        type="directory",
        children=[
            FileNode(
                name="src",
                path="/workspace/backend/src",
                type="directory",
                children=[
                    FileNode(
                        name="__init__.py", path="/workspace/backend/src/__init__.py", type="file"
                    ),
                    FileNode(name="main.py", path="/workspace/backend/src/main.py", type="file"),
                    FileNode(name="api.py", path="/workspace/backend/src/api.py", type="file"),
                ],
            ),
            FileNode(
                name="requirements.txt", path="/workspace/backend/requirements.txt", type="file"
            ),
        ],
    ),
    FileNode(name="README.md", path="/workspace/README.md", type="file"),
]

_FULLSTACK_CONTENTS = {
    "/workspace/frontend/src/App.tsx": """import React, { useState, useEffect } from 'react';

interface Message {
  message: string;
}

export function App() {
  const [greeting, setGreeting] = useState<string>('Loading...');

  useEffect(() => {
    fetch('/api/hello')
      .then(res => res.json())
      .then((data: Message) => setGreeting(data.message))
      .catch(() => setGreeting('Hello from Podex!'));
  }, []);

  return (
    <div className="container">
      <h1>{greeting}</h1>
      <p>Edit this file to get started with your fullstack app.</p>
    </div>
  );
}
""",
    "/workspace/frontend/src/index.tsx": """import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
""",
    "/workspace/frontend/package.json": """{
  "name": "frontend",
  "version": "1.0.0",
  "scripts": {
    "dev": "vite",
    "build": "vite build"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  },
  "devDependencies": {
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "typescript": "^5.3.0",
    "vite": "^5.0.0",
    "@vitejs/plugin-react": "^4.2.0"
  }
}
""",
    "/workspace/backend/src/__init__.py": '''"""Backend API package."""
''',
    "/workspace/backend/src/main.py": '''"""Main application entry point."""

import uvicorn

from src.api import app

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
''',
    "/workspace/backend/src/api.py": '''"""API routes."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="My Fullstack App")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/hello")
async def hello() -> dict[str, str]:
    """Return a greeting message."""
    return {"message": "Hello from your Podex backend!"}


@app.get("/api/health")
async def health() -> dict[str, str]:
    """Health check endpoint."""
    return {"status": "healthy"}
''',
    "/workspace/backend/requirements.txt": """fastapi>=0.109.0
uvicorn>=0.27.0
""",
    "/workspace/README.md": """# My Fullstack App

A fullstack application with React frontend and Python backend, built with Podex.

## Getting Started

### Backend
```bash
cd backend
pip install -r requirements.txt
python -m src.main
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```
""",
}

# Blank template
_BLANK_FILE_TREE = [
    FileNode(name="README.md", path="/workspace/README.md", type="file"),
]

_BLANK_CONTENTS = {
    "/workspace/README.md": """# My Project

A blank workspace ready for your code.

## Getting Started

Start adding your files and code here!
""",
}

# Template registry mapping slugs to file trees and contents
_TEMPLATE_FILE_TREES: dict[str, list[FileNode]] = {
    "python": _PYTHON_FILE_TREE,
    "nodejs": _NODEJS_FILE_TREE,
    "golang": _GOLANG_FILE_TREE,
    "rust": _RUST_FILE_TREE,
    "fullstack": _FULLSTACK_FILE_TREE,
    "blank": _BLANK_FILE_TREE,
}

_TEMPLATE_CONTENTS: dict[str, dict[str, str]] = {
    "python": _PYTHON_CONTENTS,
    "nodejs": _NODEJS_CONTENTS,
    "golang": _GOLANG_CONTENTS,
    "rust": _RUST_CONTENTS,
    "fullstack": _FULLSTACK_CONTENTS,
    "blank": _BLANK_CONTENTS,
}


async def get_template_slug_for_workspace(workspace_id: str, db: AsyncSession) -> str:
    """Get the template slug for a workspace.

    Args:
        workspace_id: The workspace ID.
        db: Database session.

    Returns:
        The template slug, or "nodejs" as default.
    """
    # Find the session for this workspace
    session_result = await db.execute(select(Session).where(Session.workspace_id == workspace_id))
    session = session_result.scalar_one_or_none()

    if not session or not session.template_id:
        return "nodejs"  # Default fallback

    # Get the template
    template_result = await db.execute(
        select(PodTemplate).where(PodTemplate.id == session.template_id)
    )
    template = template_result.scalar_one_or_none()

    if not template:
        return "nodejs"

    return template.slug


def get_demo_file_tree(template_slug: str = "nodejs") -> list[FileNode]:
    """Get demo file tree for a specific template.

    Args:
        template_slug: The template slug (python, nodejs, golang, rust, fullstack, blank).

    Returns:
        List of FileNode objects representing the file tree.
    """
    return _TEMPLATE_FILE_TREES.get(template_slug, _NODEJS_FILE_TREE)


def get_demo_contents(template_slug: str = "nodejs") -> dict[str, str]:
    """Get demo file contents for a specific template.

    Args:
        template_slug: The template slug (python, nodejs, golang, rust, fullstack, blank).

    Returns:
        Dictionary mapping file paths to their contents.
    """
    return _TEMPLATE_CONTENTS.get(template_slug, _NODEJS_CONTENTS)


@router.get("/{workspace_id}", response_model=WorkspaceResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_workspace(
    workspace_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> WorkspaceResponse:
    """Get workspace details."""
    # Verify user has access to this workspace
    workspace = await verify_workspace_access(workspace_id, request, db)

    return WorkspaceResponse(
        id=workspace.id,
        session_id=workspace.session.id if workspace.session else None,
        container_id=workspace.container_id,
        status=workspace.status,
        s3_bucket=workspace.s3_bucket,
        s3_prefix=workspace.s3_prefix,
        root_path="/workspace",
        ports=[
            {"internal": 3000, "external": 8080, "protocol": "http", "label": "Dev Server"},
        ],
    )


@router.get("/{workspace_id}/files", response_model=list[FileNode])
@limiter.limit(RATE_LIMIT_STANDARD)
async def list_files(
    workspace_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
    path: str = "/workspace",
) -> list[FileNode]:
    """List files in workspace directory."""
    # SECURITY: Validate path to prevent traversal attacks
    validate_file_path(path)

    # Verify user has access to this workspace
    await verify_workspace_access(workspace_id, request, db)

    # Get template-specific demo files (actual file ops via workspace containers)
    template_slug = await get_template_slug_for_workspace(workspace_id, db)
    return get_demo_file_tree(template_slug)


def get_language_from_path(path: str) -> str:
    """Determine language from file extension."""
    extension = path.split(".")[-1].lower()
    language_map = {
        "tsx": "typescript",
        "ts": "typescript",
        "json": "json",
        "js": "javascript",
        "jsx": "javascript",
        "py": "python",
        "md": "markdown",
        "css": "css",
        "html": "html",
        "yml": "yaml",
        "yaml": "yaml",
        "sh": "shell",
        "bash": "shell",
        "sql": "sql",
        "go": "go",
        "rs": "rust",
        "java": "java",
        "c": "c",
        "cpp": "cpp",
        "h": "c",
        "hpp": "cpp",
    }
    return language_map.get(extension, "plaintext")


@router.get("/{workspace_id}/files/content", response_model=FileContent)
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_file_content(
    workspace_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    path: str,
    db: DbSession,
) -> FileContent:
    """Get file content."""
    # SECURITY: Validate path to prevent traversal attacks
    validated_path = validate_file_path(path)

    # Verify user has access to this workspace
    await verify_workspace_access(workspace_id, request, db)

    # Use template-specific demo data (actual file ops via workspace containers)
    template_slug = await get_template_slug_for_workspace(workspace_id, db)
    demo_contents = get_demo_contents(template_slug)
    demo_content = demo_contents.get(validated_path)

    if demo_content is None:
        raise HTTPException(status_code=404, detail="File not found")

    return FileContent(
        path=validated_path, content=demo_content, language=get_language_from_path(validated_path)
    )


class UpdateFileRequest(BaseModel):
    """Request to update file content."""

    content: str


@router.put("/{workspace_id}/files/content", response_model=FileContent)
@limiter.limit(RATE_LIMIT_UPLOAD)
async def update_file_content(
    workspace_id: str,
    path: str,
    body: UpdateFileRequest,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> FileContent:
    """Update file content.

    Note: File operations are handled by workspace containers.
    This endpoint validates access and returns the updated content.
    """
    # SECURITY: Validate path to prevent traversal attacks
    validated_path = validate_file_path(path)

    # Verify user has access to this workspace
    await verify_workspace_access(workspace_id, request, db)

    return FileContent(
        path=validated_path,
        content=body.content,
        language=get_language_from_path(validated_path),
    )


class CreateFileRequest(BaseModel):
    """Request to create a new file."""

    path: str
    content: str = ""


class DeleteFileRequest(BaseModel):
    """Request to delete a file or directory."""

    path: str


class MoveFileRequest(BaseModel):
    """Request to move/rename a file."""

    source_path: str
    dest_path: str


@router.post("/{workspace_id}/files", response_model=FileContent)
@limiter.limit(RATE_LIMIT_UPLOAD)
async def create_file(
    workspace_id: str,
    body: CreateFileRequest,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> FileContent:
    """Create a new file.

    Note: File operations are handled by workspace containers.
    This endpoint validates access and returns the file content.
    """
    # SECURITY: Validate path to prevent traversal attacks
    validated_path = validate_file_path(body.path)

    # Verify user has access to this workspace
    await verify_workspace_access(workspace_id, request, db)

    return FileContent(
        path=validated_path,
        content=body.content,
        language=get_language_from_path(validated_path),
    )


@router.delete("/{workspace_id}/files")
@limiter.limit(RATE_LIMIT_STANDARD)
async def delete_file(
    workspace_id: str,
    path: str,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> dict[str, str]:
    """Delete a file or directory.

    Note: File operations are handled by workspace containers.
    This endpoint validates access and confirms deletion.
    """
    # SECURITY: Validate path to prevent traversal attacks
    validated_path = validate_file_path(path)

    # Verify user has access to this workspace
    await verify_workspace_access(workspace_id, request, db)

    return {"deleted": validated_path}


@router.post("/{workspace_id}/files/move")
@limiter.limit(RATE_LIMIT_STANDARD)
async def move_file(
    workspace_id: str,
    body: MoveFileRequest,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> dict[str, str]:
    """Move or rename a file.

    Note: File operations are handled by workspace containers.
    This endpoint validates access and confirms the move.
    """
    # SECURITY: Validate both paths to prevent traversal attacks
    validated_source = validate_file_path(body.source_path)
    validated_dest = validate_file_path(body.dest_path)

    # Verify user has access to this workspace
    await verify_workspace_access(workspace_id, request, db)

    return {
        "source": validated_source,
        "destination": validated_dest,
    }


@router.post("/{workspace_id}/initialize")
@limiter.limit(RATE_LIMIT_UPLOAD)
async def initialize_workspace_files(
    workspace_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> dict[str, Any]:
    """Initialize workspace with template files.

    Note: Workspace initialization is handled by workspace containers.
    This endpoint validates access and confirms initialization.
    """
    # Verify user has access to this workspace
    await verify_workspace_access(workspace_id, request, db)

    return {
        "workspace_id": workspace_id,
        "files_created": 0,
        "message": "Initialization handled by container",
    }


# ==================== Standby/Pause Routes ====================


class WorkspaceStatusResponse(BaseModel):
    """Workspace status response."""

    id: str
    status: str  # "pending", "running", "stopped", "error"
    last_activity: str | None


@router.post("/{workspace_id}/start", response_model=WorkspaceStatusResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def start_workspace(
    workspace_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> WorkspaceStatusResponse:
    """Start a stopped workspace (creates new pod with existing storage mounted).

    If the workspace doesn't exist in the compute service,
    it will be recreated automatically with the GCS bucket mounted.
    """
    from datetime import UTC, datetime

    from src.compute_client import get_compute_client_for_workspace
    from src.exceptions import ComputeServiceHTTPError
    from src.routes.sessions import build_workspace_config
    from src.services.workspace_router import workspace_router

    # Verify user has access to this workspace
    workspace = await verify_workspace_access(workspace_id, request, db)

    # Normalize any legacy 'standby' state to 'stopped' - we no longer support standby.
    if workspace.status == "standby":
        workspace.status = "stopped"
        workspace.standby_at = None
        await db.commit()
        await db.refresh(workspace)

    # Allow starting only from explicitly stopped state
    if workspace.status != "stopped":
        raise HTTPException(
            status_code=400,
            detail=f"Cannot start workspace in '{workspace.status}' state. "
            "Only stopped workspaces can be started.",
        )

    user_id: str = getattr(request.state, "user_id", "") or ""

    # Check compute credits before resuming workspace (only for cloud workspaces)
    # Local pod workspaces don't consume cloud credits
    if not workspace.local_pod_id:
        from src.services.credit_enforcement import (
            check_credits_available,
            create_billing_error_detail,
        )

        credit_check = await check_credits_available(db, user_id, "compute")

        if not credit_check.can_proceed:
            raise HTTPException(
                status_code=402,  # Payment Required
                detail=create_billing_error_detail(
                    credit_check,
                    "compute",
                    (
                        "Compute credits exhausted. Please upgrade your plan or "
                        "add credits to resume your workspace."
                    ),
                ),
            )

    try:
        # First, check if the workspace exists in the compute/pod
        workspace_info = await workspace_router.get_workspace(workspace_id, user_id)

        if workspace_info is not None:
            # Workspace exists, try to restart it (routes to local pod or cloud as appropriate)
            logger.info(
                "Workspace found, restarting",
                workspace_id=workspace_id,
                is_local_pod=bool(workspace.local_pod_id),
            )
            await workspace_router.restart_workspace(workspace_id, user_id)
        else:
            # Workspace doesn't exist in backend (local pod or compute) and needs to be recreated.
            # IMPORTANT: Route recreation based on workspace type so local-pod workspaces are never
            # accidentally provisioned on the cloud/compute service.
            logger.info(
                "Workspace not found in backend, recreating",
                workspace_id=workspace_id,
                is_local_pod=bool(workspace.local_pod_id),
            )

            # Get the session associated with this workspace
            session_result = await db.execute(
                select(Session).where(Session.workspace_id == workspace_id)
            )
            session = session_result.scalar_one_or_none()

            if not session:
                raise HTTPException(  # noqa: TRY301
                    status_code=404,
                    detail="Session not found for this workspace",
                )

            if workspace.local_pod_id:
                # Local pod workspace: re-create it on the pod, do NOT fall back to compute.
                from src.websocket.local_pod_hub import PodNotConnectedError, call_pod

                # Build minimal workspace config for local pod; mount_path from session settings
                workspace_config: dict[str, Any] = {}
                if session.settings and session.settings.get("mount_path"):
                    workspace_config["mount_path"] = session.settings.get("mount_path")

                try:
                    await call_pod(
                        str(workspace.local_pod_id),
                        "workspace.create",
                        {
                            "workspace_id": workspace_id,
                            "session_id": str(session.id),
                            "user_id": user_id,
                            "config": workspace_config,
                        },
                        rpc_timeout=30,
                    )
                    logger.info(
                        "Workspace recreated on local pod during start",
                        workspace_id=workspace_id,
                        pod_id=str(workspace.local_pod_id),
                    )
                except PodNotConnectedError as e:
                    logger.warning(
                        "Local pod not connected while recreating workspace on start",
                        workspace_id=workspace_id,
                        pod_id=str(workspace.local_pod_id),
                        error=str(e),
                    )
                    raise HTTPException(
                        status_code=503,
                        detail="Local pod is not connected. Please start your local pod.",
                    ) from None
                except TimeoutError:
                    logger.warning(
                        "Local pod workspace recreation timed out during start",
                        workspace_id=workspace_id,
                        pod_id=str(workspace.local_pod_id),
                    )
                    raise HTTPException(
                        status_code=504,
                        detail="Timed out while recreating workspace on local pod.",
                    ) from None
            else:
                # Cloud/compute-backed workspace: recreate via compute service with storage mounted
                logger.info(
                    "Workspace not found in compute service, recreating with storage mounted",
                    workspace_id=workspace_id,
                    session_id=str(session.id),
                )

                # Determine tier from session settings
                tier = session.settings.get("tier", "starter") if session.settings else "starter"

                # Build workspace config
                workspace_config = await build_workspace_config(
                    db,
                    session.template_id,
                    session.git_url,
                    tier,
                    user_id=user_id,
                )

                # Create the workspace in compute service (GCS bucket will be mounted)
                compute = await get_compute_client_for_workspace(workspace_id)
                await compute.create_workspace(
                    session_id=str(session.id),
                    user_id=user_id,
                    workspace_id=workspace_id,
                    config=workspace_config,
                )

                logger.info(
                    "Workspace recreated with storage mounted",
                    workspace_id=workspace_id,
                    session_id=str(session.id),
                )

        # Update DB status after successful restart/recreation
        now = datetime.now(UTC)
        workspace.status = "running"
        workspace.last_activity = now
        await db.commit()
        await db.refresh(workspace)

        logger.info("Workspace started", workspace_id=workspace_id, user_id=user_id)

    except ComputeServiceHTTPError as e:
        await db.rollback()
        logger.exception(
            "Compute service error during start",
            workspace_id=workspace_id,
            status_code=e.status_code,
        )
        raise HTTPException(
            status_code=500,
            detail=f"Failed to start workspace: compute service error ({e.status_code})",
        ) from None
    except HTTPException:
        # Re-raise HTTP exceptions as-is
        await db.rollback()
        raise
    except Exception:
        # Rollback any pending changes on failure
        await db.rollback()
        logger.exception("Failed to start workspace", workspace_id=workspace_id)
        raise HTTPException(status_code=500, detail="Failed to start workspace") from None

    return WorkspaceStatusResponse(
        id=workspace.id,
        status=workspace.status,
        last_activity=workspace.last_activity.isoformat() if workspace.last_activity else None,
    )


@router.get("/{workspace_id}/status", response_model=WorkspaceStatusResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_workspace_status(
    workspace_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> WorkspaceStatusResponse:
    """Get current workspace status, syncing from compute/local pod when possible."""
    from src.services.workspace_router import workspace_router

    # Verify user has access to this workspace
    workspace = await verify_workspace_access(workspace_id, request, db)
    user_id: str = getattr(request.state, "user_id", "") or ""

    # Sync from compute/local pod so we return actual state (and keep DB in sync)
    try:
        info = await workspace_router.get_workspace(workspace_id, user_id)
        if isinstance(info, dict) and "status" in info:
            new_status = info["status"]
            if new_status == "standby":
                new_status = "stopped"
            if workspace.status != new_status:
                workspace.status = new_status
                await db.commit()
                await db.refresh(workspace)
    except Exception as e:
        logger.debug(
            "Could not sync workspace status from compute, using DB value",
            workspace_id=workspace_id,
            error=str(e),
        )

    return WorkspaceStatusResponse(
        id=workspace.id,
        status=workspace.status,
        last_activity=workspace.last_activity.isoformat() if workspace.last_activity else None,
    )


class WorkspaceForceStopResponse(BaseModel):
    """Response from force-stopping a workspace."""

    workspace_id: str
    previous_status: str
    success: bool
    message: str
    terminal_sessions_closed: int = 0


@router.post("/{workspace_id}/force-stop", response_model=WorkspaceForceStopResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def force_stop_workspace(
    workspace_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> WorkspaceForceStopResponse:
    """Force-stop a stuck or unresponsive workspace.

    This performs an aggressive cleanup:
    - Forcefully stops the container (even if unresponsive)
    - Kills all terminal sessions for this workspace
    - Sets status to 'stopped'
    - Notifies all connected clients

    Use when normal pause/stop doesn't work or the container is unresponsive.
    This is more aggressive than pause and should be used as a last resort.
    """
    from sqlalchemy import select

    from src.database.models import Session as SessionModel
    from src.services.workspace_router import workspace_router
    from src.terminal.manager import terminal_manager
    from src.websocket.hub import emit_to_session

    # Verify user has access to this workspace
    workspace = await verify_workspace_access(workspace_id, request, db)
    user_id: str = getattr(request.state, "user_id", "") or ""

    previous_status = workspace.status

    # Force close all terminal sessions for this workspace
    sessions_to_close = [
        sid
        for sid, session in terminal_manager.sessions.items()
        if session.workspace_id == workspace_id
    ]
    for session_id in sessions_to_close:
        try:
            # kill_tmux=True ensures local pod tmux sessions are properly cleaned up
            await terminal_manager.close_session(session_id, kill_tmux=True)
        except Exception as e:
            logger.warning(
                "Failed to close terminal session during force-stop",
                session_id=session_id,
                error=str(e),
            )

    # Force stop container (even if unresponsive - best effort)
    try:
        await workspace_router.stop_workspace(workspace_id, user_id)
    except Exception as e:
        logger.warning(
            "Failed to stop workspace via compute service during force-stop",
            workspace_id=workspace_id,
            error=str(e),
        )
        # Continue anyway - update our state regardless

    # Update status to stopped
    workspace.status = "stopped"
    workspace.standby_at = None
    await db.commit()

    # Get session for notification
    session_result = await db.execute(
        select(SessionModel).where(SessionModel.workspace_id == workspace_id)
    )
    session = session_result.scalar_one_or_none()

    if session:
        await emit_to_session(
            str(session.id),
            "workspace_force_stopped",
            {
                "workspace_id": workspace_id,
                "previous_status": previous_status,
                "terminal_sessions_closed": len(sessions_to_close),
            },
        )

    logger.info(
        "Workspace force-stopped",
        workspace_id=workspace_id,
        previous_status=previous_status,
        terminal_sessions_closed=len(sessions_to_close),
    )

    return WorkspaceForceStopResponse(
        workspace_id=workspace_id,
        previous_status=previous_status,
        success=True,
        message=f"Workspace force-stopped. {len(sessions_to_close)} terminal sessions closed.",
        terminal_sessions_closed=len(sessions_to_close),
    )


class WorkspaceHealthResponse(BaseModel):
    """Workspace health check response."""

    workspace_id: str
    healthy: bool
    latency_ms: float | None
    status: str
    container_responsive: bool
    last_activity: str | None
    error: str | None = None


@router.get("/{workspace_id}/health", response_model=WorkspaceHealthResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def check_workspace_health(
    workspace_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> WorkspaceHealthResponse:
    """Check workspace container health and responsiveness.

    Executes a lightweight command to verify the container is responsive.
    Returns health status, latency, and any error details.

    Use this to verify a workspace is working before performing operations,
    or to diagnose issues with unresponsive workspaces.
    """
    from src.services.workspace_router import workspace_router

    workspace = await verify_workspace_access(workspace_id, request, db)
    user_id: str = getattr(request.state, "user_id", "") or ""

    if workspace.status != "running":
        return WorkspaceHealthResponse(
            workspace_id=workspace_id,
            healthy=False,
            latency_ms=None,
            status=workspace.status,
            container_responsive=False,
            last_activity=workspace.last_activity.isoformat() if workspace.last_activity else None,
            error=f"Workspace is in '{workspace.status}' state, not running",
        )

    # Perform health check
    health = await workspace_router.health_check_workspace(workspace_id, user_id)

    return WorkspaceHealthResponse(
        workspace_id=workspace_id,
        healthy=health.get("healthy", False),
        latency_ms=health.get("latency_ms"),
        status=workspace.status,
        container_responsive=health.get("healthy", False),
        last_activity=workspace.last_activity.isoformat() if workspace.last_activity else None,
        error=health.get("error"),
    )


# ==================== Workspace Exec (run command in workspace) ====================


class WorkspaceExecRequest(BaseModel):
    """Request to run a command in the workspace."""

    command: str
    working_dir: str | None = None
    timeout: int = 120


class WorkspaceExecResponse(BaseModel):
    """Response from workspace exec."""

    exit_code: int
    stdout: str
    stderr: str


@router.post("/{workspace_id}/exec", response_model=WorkspaceExecResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def exec_in_workspace(
    workspace_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    body: WorkspaceExecRequest,
    db: DbSession,
) -> WorkspaceExecResponse:
    """Run a shell command in the workspace (e.g. for installs, scripts)."""
    from src.services.workspace_router import workspace_router

    workspace = await verify_workspace_access(workspace_id, request, db)
    user_id: str = getattr(request.state, "user_id", "") or ""

    result = await workspace_router.exec_command(
        workspace_id=workspace.id,
        user_id=user_id,
        command=body.command,
        working_dir=body.working_dir,
        exec_timeout=body.timeout,
    )
    return WorkspaceExecResponse(
        exit_code=result.get("exit_code", -1),
        stdout=result.get("stdout", ""),
        stderr=result.get("stderr", ""),
    )


# ==================== Tunnels (Cloudflare external exposure) ====================


class ExposePortRequest(BaseModel):
    """Request to expose a workspace port via tunnel."""

    port: int


class TunnelItem(BaseModel):
    """Single tunnel record (no token)."""

    id: str
    workspace_id: str
    port: int
    public_url: str
    status: str
    created_at: str
    updated_at: str


class TunnelListResponse(BaseModel):
    """List of tunnels for a workspace."""

    tunnels: list[TunnelItem]
    total: int


class TunnelStatusResponse(BaseModel):
    """Daemon health for tunnel operations."""

    status: str
    connected: bool
    error: str | None = None


@router.post("/{workspace_id}/tunnels", response_model=TunnelItem, status_code=201)
@limiter.limit(RATE_LIMIT_STANDARD)
async def expose_port(
    workspace_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    body: ExposePortRequest,
    db: DbSession,
) -> TunnelItem:
    """Expose a workspace port to the internet via Cloudflare Tunnel.

    Only supported for workspaces on a local pod. Creates tunnel, DNS, and
    starts cloudflared on the pod.
    """
    from src.services.tunnel_manager import create_tunnel_for_workspace
    from src.websocket.local_pod_hub import PodNotConnectedError

    await verify_workspace_access(workspace_id, request, db)
    port = body.port
    if port < 1 or port > 65535:
        raise HTTPException(status_code=400, detail="Port must be 1-65535")

    try:
        rec = await create_tunnel_for_workspace(db, workspace_id, port)
    except PodNotConnectedError as e:
        raise HTTPException(
            status_code=503,
            detail=f"Local pod not connected: {e.pod_id}",
        ) from e
    except RuntimeError as e:
        logger.warning("Tunnel create failed", workspace_id=workspace_id, port=port, error=str(e))
        raise HTTPException(status_code=500, detail=str(e)) from e

    return TunnelItem(
        id=rec.id,
        workspace_id=rec.workspace_id,
        port=rec.port,
        public_url=rec.public_url,
        status=rec.status,
        created_at=rec.created_at.isoformat(),
        updated_at=rec.updated_at.isoformat(),
    )


@router.delete("/{workspace_id}/tunnels/{port}", status_code=204)
@limiter.limit(RATE_LIMIT_STANDARD)
async def unexpose_port(
    workspace_id: str,
    port: int,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> None:
    """Stop tunnel and remove port exposure."""
    from src.services.tunnel_manager import delete_tunnel_for_workspace, list_tunnels

    await verify_workspace_access(workspace_id, request, db)
    if port < 1 or port > 65535:
        raise HTTPException(status_code=400, detail="Port must be 1-65535")

    tunnels = await list_tunnels(db, workspace_id)
    if not any(t.port == port for t in tunnels):
        raise HTTPException(status_code=404, detail="No tunnel for this port")

    await delete_tunnel_for_workspace(db, workspace_id, port)


@router.get("/{workspace_id}/tunnels", response_model=TunnelListResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def list_workspace_tunnels(
    workspace_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> TunnelListResponse:
    """List active tunnels for a workspace."""
    from src.services.tunnel_manager import list_tunnels

    await verify_workspace_access(workspace_id, request, db)
    tunnels = await list_tunnels(db, workspace_id)
    return TunnelListResponse(
        tunnels=[
            TunnelItem(
                id=t.id,
                workspace_id=t.workspace_id,
                port=t.port,
                public_url=t.public_url,
                status=t.status,
                created_at=t.created_at.isoformat(),
                updated_at=t.updated_at.isoformat(),
            )
            for t in tunnels
        ],
        total=len(tunnels),
    )


@router.get("/{workspace_id}/tunnel-status", response_model=TunnelStatusResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_tunnel_status(
    workspace_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> TunnelStatusResponse:
    """Get tunnel daemon health for the workspace's pod."""
    from src.services.tunnel_manager import get_tunnel_status as _get_status

    await verify_workspace_access(workspace_id, request, db)
    out = await _get_status(workspace_id)
    return TunnelStatusResponse(
        status=out.get("status", "unknown"),
        connected=out.get("connected", False),
        error=out.get("error"),
    )


# ==================== SSH Tunnel (VS Code Remote-SSH) ====================


class SSHTunnelResponse(BaseModel):
    """SSH tunnel info for VS Code Remote-SSH access."""

    enabled: bool
    hostname: str | None = None
    public_url: str | None = None
    status: str | None = None
    connection_string: str | None = None
    proxy_command: str | None = None
    ssh_config_snippet: str | None = None


class SSHTunnelEnableRequest(BaseModel):
    """Request to enable SSH tunnel."""

    # No parameters needed - SSH always uses port 22


@router.post("/{workspace_id}/ssh-tunnel", response_model=SSHTunnelResponse, status_code=201)
@limiter.limit(RATE_LIMIT_STANDARD)
async def enable_ssh_tunnel(
    workspace_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> SSHTunnelResponse:
    """Enable SSH tunnel for VS Code Remote-SSH access.

    Creates a Cloudflare tunnel with SSH service type (ssh://localhost:22).
    Users connect via cloudflared ProxyCommand in their SSH config.

    Only supported for workspaces on a local pod with sshd running.
    """
    from src.services.tunnel_manager import (
        create_ssh_tunnel_for_workspace,
        get_ssh_tunnel,
    )
    from src.websocket.local_pod_hub import PodNotConnectedError

    await verify_workspace_access(workspace_id, request, db)

    # Check if SSH tunnel already exists
    existing = await get_ssh_tunnel(db, workspace_id)
    if existing:
        return _build_ssh_tunnel_response(existing)

    try:
        rec = await create_ssh_tunnel_for_workspace(db, workspace_id)
    except PodNotConnectedError as e:
        raise HTTPException(
            status_code=503,
            detail=f"Local pod not connected: {e.pod_id}",
        ) from e
    except RuntimeError as e:
        logger.warning("SSH tunnel create failed", workspace_id=workspace_id, error=str(e))
        raise HTTPException(status_code=500, detail=str(e)) from e

    return _build_ssh_tunnel_response(rec)


@router.delete("/{workspace_id}/ssh-tunnel", status_code=204)
@limiter.limit(RATE_LIMIT_STANDARD)
async def disable_ssh_tunnel(
    workspace_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> None:
    """Disable SSH tunnel for a workspace.

    Stops the cloudflared daemon, removes DNS record, and deletes the tunnel.
    """
    from src.services.tunnel_manager import delete_ssh_tunnel_for_workspace, get_ssh_tunnel

    await verify_workspace_access(workspace_id, request, db)

    # Check if SSH tunnel exists
    existing = await get_ssh_tunnel(db, workspace_id)
    if not existing:
        raise HTTPException(status_code=404, detail="No SSH tunnel for this workspace")

    await delete_ssh_tunnel_for_workspace(db, workspace_id)


@router.get("/{workspace_id}/ssh-tunnel", response_model=SSHTunnelResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_ssh_tunnel_info(
    workspace_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> SSHTunnelResponse:
    """Get SSH tunnel status and connection info for VS Code Remote-SSH.

    Returns:
        - enabled: Whether SSH tunnel is active
        - hostname: The SSH tunnel hostname (e.g., workspace-ssh.tunnel.podex.dev)
        - connection_string: SSH connection command for users
        - proxy_command: cloudflared command for SSH config
        - ssh_config_snippet: Ready-to-use SSH config block
    """
    from src.services.tunnel_manager import get_ssh_tunnel

    await verify_workspace_access(workspace_id, request, db)

    rec = await get_ssh_tunnel(db, workspace_id)
    if not rec:
        return SSHTunnelResponse(enabled=False)

    return _build_ssh_tunnel_response(rec)


def _build_ssh_tunnel_response(rec: Any) -> SSHTunnelResponse:
    """Build SSH tunnel response with connection info."""
    hostname = rec.public_url  # For SSH, public_url is the hostname
    # Default username in workspace containers is 'podex'
    username = "podex"
    connection_string = f"ssh {username}@{hostname}"
    proxy_command = f"cloudflared access ssh --hostname {hostname}"
    ssh_config_snippet = f"""Host {hostname}
    User {username}
    ProxyCommand cloudflared access ssh --hostname %h
    StrictHostKeyChecking no
    UserKnownHostsFile /dev/null"""

    return SSHTunnelResponse(
        enabled=True,
        hostname=hostname,
        public_url=hostname,
        status=rec.status,
        connection_string=connection_string,
        proxy_command=proxy_command,
        ssh_config_snippet=ssh_config_snippet,
    )


# ==================== Terminal History ====================


class TerminalHistoryEntry(BaseModel):
    """Terminal history entry."""

    output: str
    timestamp: str


class TerminalHistoryResponse(BaseModel):
    """Response for terminal history."""

    workspace_id: str
    entries: list[TerminalHistoryEntry]
    total: int


# Maximum terminal history entries to prevent large payloads
MAX_TERMINAL_HISTORY_ENTRIES = 250


@router.get("/{workspace_id}/terminal/history", response_model=TerminalHistoryResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_terminal_history_endpoint(
    workspace_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
    limit: int = 100,
) -> TerminalHistoryResponse:
    """Get terminal output history for a workspace.

    Args:
        workspace_id: The workspace ID
        limit: Maximum number of history entries to return (default: 100, max: 250)

    Returns:
        Terminal output history with timestamps
    """
    from src.websocket.hub import get_terminal_history

    # Verify user has access to this workspace
    await verify_workspace_access(workspace_id, request, db)

    # Clamp limit to prevent large payloads
    limit = max(1, min(MAX_TERMINAL_HISTORY_ENTRIES, limit))

    # Get history from hub (stored in Redis)
    history = await get_terminal_history(workspace_id, limit)

    return TerminalHistoryResponse(
        workspace_id=workspace_id,
        entries=[
            TerminalHistoryEntry(
                output=entry["output"],
                timestamp=entry["timestamp"],
            )
            for entry in history
        ],
        total=len(history),
    )


@router.delete("/{workspace_id}/terminal/history")
@limiter.limit(RATE_LIMIT_STANDARD)
async def clear_terminal_history_endpoint(
    workspace_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> dict[str, str]:
    """Clear terminal output history for a workspace.

    Args:
        workspace_id: The workspace ID

    Returns:
        Confirmation message
    """
    from src.websocket.hub import clear_terminal_history

    # Verify user has access to this workspace
    await verify_workspace_access(workspace_id, request, db)

    # Clear history (from Redis)
    await clear_terminal_history(workspace_id)

    return {"message": "Terminal history cleared"}


# ==================== Internal Endpoints (Compute Service) ====================


def verify_internal_service_token(request: Request) -> None:
    """Verify internal service-to-service token.

    Used by compute service to notify API about workspace state changes.
    """
    import secrets as sec

    token = request.headers.get("X-Internal-Service-Token")

    # In development with no token configured, allow requests
    if not settings.INTERNAL_SERVICE_TOKEN:
        if settings.ENVIRONMENT == "production":
            raise HTTPException(
                status_code=500,
                detail="Internal service token not configured",
            )
        return

    if not token:
        raise HTTPException(
            status_code=401,
            detail="Missing internal service token",
        )

    if not sec.compare_digest(token, settings.INTERNAL_SERVICE_TOKEN):
        raise HTTPException(
            status_code=401,
            detail="Invalid internal service token",
        )


class WorkspaceStatusSyncRequest(BaseModel):
    """Request to sync workspace status from compute service."""

    status: str  # running, stopped, error
    container_id: str | None = None


class WorkspaceStatusSyncResponse(BaseModel):
    """Response from workspace status sync."""

    workspace_id: str
    status: str
    updated: bool
    session_id: str | None = None


@router.post(
    "/{workspace_id}/internal/sync-status",
    response_model=WorkspaceStatusSyncResponse,
    include_in_schema=False,  # Hide from public API docs
)
async def sync_workspace_status_from_compute(
    workspace_id: str,
    request: Request,
    body: WorkspaceStatusSyncRequest,
    db: DbSession,
) -> WorkspaceStatusSyncResponse:
    """Sync workspace status from compute service.

    This internal endpoint is called by the compute service when it rediscovers
    a workspace (e.g., after a service restart) or when a workspace status changes
    outside of a user-initiated action.

    This ensures the API database stays in sync with actual compute state.
    """
    from datetime import UTC, datetime

    from sqlalchemy.orm import selectinload

    from src.websocket.hub import emit_to_session

    # Verify internal service token
    verify_internal_service_token(request)

    # Find the workspace in database
    result = await db.execute(
        select(Workspace)
        .where(Workspace.id == workspace_id)
        .options(selectinload(Workspace.session))
    )
    workspace = result.scalar_one_or_none()

    if not workspace:
        logger.warning(
            "Compute sync: workspace not found",
            workspace_id=workspace_id,
            status=body.status,
        )
        raise HTTPException(status_code=404, detail="Workspace not found")

    # Get the associated session
    session_id = None
    if workspace.session:
        session_id = str(workspace.session.id)

    old_status = workspace.status
    now = datetime.now(UTC)
    updated = False

    # Update status if changed, normalizing any legacy 'standby' input to 'stopped'
    new_status = "stopped" if body.status == "standby" else body.status

    if workspace.status != new_status:
        workspace.status = new_status
        updated = True

        # Handle specific status transitions
        if new_status == "running":
            workspace.standby_at = None
            workspace.last_activity = now
        elif new_status == "stopped":
            workspace.standby_at = None

        # Update container_id if provided
        if body.container_id:
            workspace.container_id = body.container_id

        await db.commit()
        await db.refresh(workspace)

        logger.info(
            "Compute sync: updated workspace status",
            workspace_id=workspace_id,
            old_status=old_status,
            new_status=body.status,
            session_id=session_id,
        )

        # Emit WebSocket event to notify connected clients
        if session_id:
            await emit_to_session(
                session_id,
                "workspace_status",
                {
                    "workspace_id": workspace_id,
                    "status": new_status,
                    "standby_at": workspace.standby_at.isoformat()
                    if workspace.standby_at
                    else None,
                    "last_activity": workspace.last_activity.isoformat()
                    if workspace.last_activity
                    else None,
                },
            )
    else:
        logger.debug(
            "Compute sync: status unchanged",
            workspace_id=workspace_id,
            status=body.status,
        )

    return WorkspaceStatusSyncResponse(
        workspace_id=workspace_id,
        status=workspace.status,
        updated=updated,
        session_id=session_id,
    )
