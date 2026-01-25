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
from src.storage.gcs import S3Storage, get_storage

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
Storage = Annotated[S3Storage, Depends(get_storage)]


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
    storage: Storage,
    path: str = "/workspace",
) -> list[FileNode]:
    """List files in workspace directory."""
    # SECURITY: Validate path to prevent traversal attacks
    validated_path = validate_file_path(path)

    # Verify user has access to this workspace
    await verify_workspace_access(workspace_id, request, db)

    # Use S3 storage if configured (non-default bucket or custom endpoint)
    if settings.GCS_BUCKET != "podex-workspaces" or settings.GCS_ENDPOINT_URL:
        try:
            tree = await storage.get_file_tree(workspace_id, validated_path)
            return [FileNode(**node) for node in tree]
        except Exception:
            # Fall back to demo data on error
            logger.debug(
                "Failed to get file tree from storage, using demo data",
                workspace_id=workspace_id,
            )

    # Get template-specific demo files
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
    storage: Storage,
) -> FileContent:
    """Get file content."""
    # SECURITY: Validate path to prevent traversal attacks
    validated_path = validate_file_path(path)

    # Verify user has access to this workspace
    await verify_workspace_access(workspace_id, request, db)

    # Try S3 storage first if configured (non-default bucket or custom endpoint)
    if settings.GCS_BUCKET != "podex-workspaces" or settings.GCS_ENDPOINT_URL:
        try:
            content = await storage.get_file_text(workspace_id, validated_path)
            return FileContent(
                path=validated_path,
                content=content,
                language=get_language_from_path(validated_path),
            )
        except FileNotFoundError as e:
            raise HTTPException(status_code=404, detail="File not found") from e
        except Exception:
            # Fall back to demo data on error
            logger.debug(
                "Failed to get file content from storage, using demo data",
                workspace_id=workspace_id,
                path=validated_path,
            )

    # Fall back to template-specific demo data
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
    storage: Storage,
) -> FileContent:
    """Update file content."""
    # SECURITY: Validate path to prevent traversal attacks
    validated_path = validate_file_path(path)

    # Verify user has access to this workspace
    await verify_workspace_access(workspace_id, request, db)

    # Save to S3 if configured
    if settings.GCS_BUCKET != "podex-workspaces" or settings.GCS_ENDPOINT_URL:
        try:
            await storage.put_file(workspace_id, validated_path, body.content)
        except Exception:
            logger.exception("Failed to save file", workspace_id=workspace_id, path=validated_path)
            raise HTTPException(status_code=500, detail="Failed to save file") from None

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
    storage: Storage,
) -> FileContent:
    """Create a new file."""
    # SECURITY: Validate path to prevent traversal attacks
    validated_path = validate_file_path(body.path)

    # Verify user has access to this workspace
    await verify_workspace_access(workspace_id, request, db)

    # Create in S3 if configured
    if settings.GCS_BUCKET != "podex-workspaces" or settings.GCS_ENDPOINT_URL:
        # Check if file already exists before try block
        file_exists = await storage.file_exists(workspace_id, validated_path)
        if file_exists:
            raise HTTPException(status_code=409, detail="File already exists")

        try:
            await storage.put_file(workspace_id, validated_path, body.content)
        except Exception:
            logger.exception(
                "Failed to create file", workspace_id=workspace_id, path=validated_path
            )
            raise HTTPException(status_code=500, detail="Failed to create file") from None

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
    storage: Storage,
) -> dict[str, str]:
    """Delete a file or directory."""
    # SECURITY: Validate path to prevent traversal attacks
    validated_path = validate_file_path(path)

    # Verify user has access to this workspace
    await verify_workspace_access(workspace_id, request, db)

    # Delete from S3 if configured
    if settings.GCS_BUCKET != "podex-workspaces" or settings.GCS_ENDPOINT_URL:
        # Check file existence before try block
        file_exists = await storage.file_exists(workspace_id, validated_path)

        if file_exists:
            try:
                await storage.delete_file(workspace_id, validated_path)
            except Exception:
                logger.exception(
                    "Failed to delete file", workspace_id=workspace_id, path=validated_path
                )
                raise HTTPException(status_code=500, detail="Failed to delete file") from None
        else:
            # Try as directory
            try:
                deleted = await storage.delete_directory(workspace_id, validated_path)
            except Exception:
                logger.exception(
                    "Failed to delete directory", workspace_id=workspace_id, path=validated_path
                )
                raise HTTPException(status_code=500, detail="Failed to delete file") from None

            if deleted == 0:
                raise HTTPException(status_code=404, detail="File or directory not found")

    return {"deleted": validated_path}


@router.post("/{workspace_id}/files/move")
@limiter.limit(RATE_LIMIT_STANDARD)
async def move_file(
    workspace_id: str,
    body: MoveFileRequest,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
    storage: Storage,
) -> dict[str, str]:
    """Move or rename a file."""
    # SECURITY: Validate both paths to prevent traversal attacks
    validated_source = validate_file_path(body.source_path)
    validated_dest = validate_file_path(body.dest_path)

    # Verify user has access to this workspace
    await verify_workspace_access(workspace_id, request, db)

    # Move in S3 if configured
    if settings.GCS_BUCKET != "podex-workspaces" or settings.GCS_ENDPOINT_URL:
        # Check source file existence before try block
        source_exists = await storage.file_exists(workspace_id, validated_source)
        if not source_exists:
            raise HTTPException(status_code=404, detail="Source file not found")

        try:
            await storage.move_file(workspace_id, validated_source, validated_dest)
        except Exception:
            logger.exception("Failed to move file", workspace_id=workspace_id)
            raise HTTPException(status_code=500, detail="Failed to move file") from None

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
    storage: Storage,
) -> dict[str, Any]:
    """Initialize workspace with template files."""
    # Verify user has access to this workspace
    await verify_workspace_access(workspace_id, request, db)

    # Initialize with template-specific demo files if S3 is configured
    if settings.GCS_BUCKET != "podex-workspaces" or settings.GCS_ENDPOINT_URL:
        try:
            template_slug = await get_template_slug_for_workspace(workspace_id, db)
            demo_contents = get_demo_contents(template_slug)
            # Convert paths to relative paths
            template_files = {
                path.replace("/workspace/", ""): content for path, content in demo_contents.items()
            }
            return await storage.initialize_workspace(workspace_id, template_files)
        except Exception:
            logger.exception("Failed to initialize workspace", workspace_id=workspace_id)
            raise HTTPException(status_code=500, detail="Failed to initialize workspace") from None

    return {"workspace_id": workspace_id, "files_created": 0, "message": "S3 not configured"}


# ==================== Standby/Pause Routes ====================


class WorkspaceStatusResponse(BaseModel):
    """Workspace status response."""

    id: str
    status: str  # "pending", "running", "standby", "stopped", "error"
    standby_at: str | None
    last_activity: str | None


@router.post("/{workspace_id}/pause", response_model=WorkspaceStatusResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def pause_workspace(
    workspace_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> WorkspaceStatusResponse:
    """Pause a workspace (stop Docker container, enter standby mode)."""
    from datetime import UTC, datetime

    from src.services.workspace_router import workspace_router

    # Verify user has access to this workspace
    workspace = await verify_workspace_access(workspace_id, request, db)

    if workspace.status == "standby":
        raise HTTPException(status_code=400, detail="Workspace is already paused")

    if workspace.status not in ("running", "pending"):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot pause workspace in '{workspace.status}' state",
        )

    try:
        # Stop the container first
        user_id: str = getattr(request.state, "user_id", "") or ""
        await workspace_router.stop_workspace(workspace_id, user_id)

        # Only update DB status after container stop succeeds
        now = datetime.now(UTC)
        workspace.status = "standby"
        workspace.standby_at = now
        await db.commit()
        await db.refresh(workspace)

        logger.info("Workspace paused", workspace_id=workspace_id, user_id=user_id)

    except Exception:
        # Rollback any pending changes on failure
        await db.rollback()
        logger.exception("Failed to pause workspace", workspace_id=workspace_id)
        raise HTTPException(status_code=500, detail="Failed to pause workspace") from None

    return WorkspaceStatusResponse(
        id=workspace.id,
        status=workspace.status,
        standby_at=workspace.standby_at.isoformat() if workspace.standby_at else None,
        last_activity=workspace.last_activity.isoformat() if workspace.last_activity else None,
    )


@router.post("/{workspace_id}/resume", response_model=WorkspaceStatusResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def resume_workspace(
    workspace_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> WorkspaceStatusResponse:
    """Resume a paused workspace (restart Docker container).

    If the workspace doesn't exist in the compute service (common after standby),
    it will be recreated automatically.
    """
    from datetime import UTC, datetime

    from src.compute_client import compute_client
    from src.exceptions import ComputeServiceHTTPError
    from src.routes.sessions import build_workspace_config
    from src.services.workspace_router import workspace_router

    # Verify user has access to this workspace
    workspace = await verify_workspace_access(workspace_id, request, db)

    if workspace.status != "standby":
        raise HTTPException(
            status_code=400,
            detail=f"Cannot resume workspace in '{workspace.status}' state. "
            "Only 'standby' workspaces can be resumed.",
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
            # Workspace exists, try to restart it
            logger.info(
                "Workspace found, restarting",
                workspace_id=workspace_id,
                is_local_pod=bool(workspace.local_pod_id),
            )
            await workspace_router.restart_workspace(workspace_id, user_id)
        else:
            # Workspace doesn't exist in compute service (removed after standby)
            # Need to recreate it
            logger.info(
                "Workspace not found in compute service, recreating",
                workspace_id=workspace_id,
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

            # Create the workspace in compute service
            await compute_client.create_workspace(
                session_id=str(session.id),
                user_id=user_id,
                workspace_id=workspace_id,
                config=workspace_config,
            )

            logger.info(
                "Workspace recreated for resume",
                workspace_id=workspace_id,
                session_id=str(session.id),
            )

        # Update DB status after successful restart/recreation
        now = datetime.now(UTC)
        workspace.status = "running"
        workspace.standby_at = None
        workspace.last_activity = now
        await db.commit()
        await db.refresh(workspace)

        logger.info("Workspace resumed", workspace_id=workspace_id, user_id=user_id)

    except ComputeServiceHTTPError as e:
        await db.rollback()
        logger.exception(
            "Compute service error during resume",
            workspace_id=workspace_id,
            status_code=e.status_code,
        )
        raise HTTPException(
            status_code=500,
            detail=f"Failed to resume workspace: compute service error ({e.status_code})",
        ) from None
    except HTTPException:
        # Re-raise HTTP exceptions as-is
        await db.rollback()
        raise
    except Exception:
        # Rollback any pending changes on failure
        await db.rollback()
        logger.exception("Failed to resume workspace", workspace_id=workspace_id)
        raise HTTPException(status_code=500, detail="Failed to resume workspace") from None

    return WorkspaceStatusResponse(
        id=workspace.id,
        status=workspace.status,
        standby_at=None,
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
    """Get current workspace status."""
    # Verify user has access to this workspace
    workspace = await verify_workspace_access(workspace_id, request, db)

    return WorkspaceStatusResponse(
        id=workspace.id,
        status=workspace.status,
        standby_at=workspace.standby_at.isoformat() if workspace.standby_at else None,
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
            await terminal_manager.close_session(session_id)
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

    # Get history from hub
    history = get_terminal_history(workspace_id, limit)

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

    # Clear history
    clear_terminal_history(workspace_id)

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

    status: str  # running, standby, stopped, error
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

    # Update status if changed
    if workspace.status != body.status:
        workspace.status = body.status
        updated = True

        # Handle specific status transitions
        if body.status == "running":
            workspace.standby_at = None
            workspace.last_activity = now
        elif body.status == "standby":
            workspace.standby_at = now
        elif body.status == "stopped":
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
                    "status": body.status,
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
