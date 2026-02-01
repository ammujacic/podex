"""
Pytest fixtures for Agent service tests.

This module provides test fixtures for:
- Test client for FastAPI
- Test data fixtures
- Integration test fixtures for Redis/PostgreSQL
"""

import asyncio
import os
from collections.abc import AsyncGenerator, Generator
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from httpx import ASGITransport, AsyncClient

from src.config import settings


# ============================================
# Integration Test Configuration
# ============================================

def is_redis_available() -> bool:
    """Check if Redis is available for integration tests.

    Uses RUN_INTEGRATION_TESTS or checks REDIS_URL environment variable.
    """
    if os.getenv("RUN_INTEGRATION_TESTS", "").lower() == "true":
        return True
    # In CI, REDIS_URL is set when Redis is available
    return bool(os.getenv("REDIS_URL"))


# Skip decorator for Redis-dependent tests
requires_redis = pytest.mark.skipif(
    not is_redis_available(),
    reason="Redis not available. Set RUN_INTEGRATION_TESTS=true or REDIS_URL to run."
)


def create_test_app() -> FastAPI:
    """Create a test FastAPI app with basic endpoints."""
    test_app = FastAPI(
        title="Podex Agent Service (Test)",
        version=settings.VERSION,
    )

    # Health check endpoint
    @test_app.get("/health")
    async def health_check() -> dict[str, str]:
        return {"status": "healthy", "version": settings.VERSION, "service": "agent"}

    # Agent endpoints
    @test_app.get("/agents")
    async def list_agents(_session_id: str | None = None) -> list[dict[str, Any]]:
        return []

    @test_app.post("/agents")
    async def create_agent(request_body: dict[str, Any]) -> dict[str, Any]:
        session_id = request_body.get("session_id")
        agent_type = request_body.get("type")
        if not session_id:
            raise HTTPException(status_code=422, detail="session_id required")
        if not agent_type:
            raise HTTPException(status_code=422, detail="type required")
        return {
            "id": "agent-123",
            "session_id": session_id,
            "type": agent_type,
            "status": "idle",
        }

    # Tools endpoint MUST be before {agent_id} to avoid route conflict
    @test_app.get("/agents/tools")
    async def list_tools() -> list[dict[str, Any]]:
        return [
            {"name": "read_file", "description": "Read a file"},
            {"name": "write_file", "description": "Write a file"},
        ]

    @test_app.get("/agents/{agent_id}")
    async def get_agent(agent_id: str) -> dict[str, Any]:
        if agent_id == "nonexistent":
            raise HTTPException(status_code=404, detail="Agent not found")
        return {
            "id": agent_id,
            "session_id": "session-123",
            "type": "architect",
            "status": "idle",
        }

    @test_app.delete("/agents/{agent_id}")
    async def delete_agent(agent_id: str) -> dict[str, str]:
        if agent_id == "nonexistent":
            raise HTTPException(status_code=404, detail="Agent not found")
        return {"status": "deleted"}

    @test_app.post("/agents/{agent_id}/message")
    async def send_message(agent_id: str, request_body: dict[str, Any]) -> dict[str, Any]:
        content = request_body.get("content")
        if not content:
            raise HTTPException(status_code=422, detail="content required")
        if agent_id == "nonexistent":
            raise HTTPException(status_code=404, detail="Agent not found")
        return {"task_id": "task-123", "status": "queued"}

    return test_app


# Create the test app
app = create_test_app()


@pytest.fixture
def mock_redis() -> MagicMock:
    """Mock Redis client."""
    mock = MagicMock()
    mock.get = AsyncMock(return_value=None)
    mock.set = AsyncMock(return_value=True)
    mock.delete = AsyncMock(return_value=1)
    mock.publish = AsyncMock(return_value=1)
    return mock


@pytest.fixture
def mock_llm_provider() -> MagicMock:
    """Mock LLM provider."""
    mock = MagicMock()
    mock.complete = AsyncMock(return_value={
        "content": "Test response from LLM",
        "finish_reason": "stop",
        "usage": {"input_tokens": 100, "output_tokens": 50},
    })
    return mock


@pytest.fixture
def test_agent() -> dict[str, Any]:
    """Create a test agent."""
    return {
        "id": "agent-123",
        "session_id": "session-123",
        "name": "Test Architect",
        "type": "architect",
        "status": "idle",
        "system_prompt": "You are a helpful AI architect.",
        "created_at": "2024-01-01T00:00:00Z",
    }


@pytest.fixture
def test_task() -> dict[str, Any]:
    """Create a test task."""
    return {
        "id": "task-123",
        "agent_id": "agent-123",
        "session_id": "session-123",
        "type": "message",
        "content": "Please analyze this code",
        "status": "pending",
        "created_at": "2024-01-01T00:00:00Z",
    }


@pytest.fixture
def test_app() -> FastAPI:
    """Get the test FastAPI app instance."""
    return app


@pytest.fixture
def client(test_app: FastAPI) -> Generator[TestClient, None, None]:
    """Create a synchronous test client."""
    with TestClient(test_app, raise_server_exceptions=False) as c:
        yield c


@pytest.fixture
async def async_client(test_app: FastAPI) -> AsyncGenerator[AsyncClient, None]:
    """Create an asynchronous test client."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app),
        base_url="http://test",
    ) as ac:
        yield ac


# ============================================
# Additional fixtures for comprehensive tests
# ============================================


@pytest.fixture
def mock_s3() -> MagicMock:
    """Mock S3 client for file storage."""
    mock = MagicMock()
    mock.upload_file = AsyncMock(return_value=True)
    mock.download_file = AsyncMock(return_value=b"file content")
    mock.delete_object = AsyncMock(return_value=True)
    mock.list_objects = AsyncMock(return_value={"Contents": []})
    mock.put_object = AsyncMock(return_value=True)
    mock.get_object = AsyncMock(return_value={"Body": b"file content"})
    return mock


@pytest.fixture
def mock_db() -> MagicMock:
    """Mock database connection."""
    mock = MagicMock()
    mock.execute = AsyncMock()
    mock.fetchone = AsyncMock()
    mock.fetchall = AsyncMock()
    return mock


@pytest.fixture
def mock_mcp_client() -> MagicMock:
    """Mock MCP client for tool integration."""
    mock = MagicMock()
    mock.connect = AsyncMock(return_value=True)
    mock.disconnect = AsyncMock(return_value=True)
    mock.list_tools = AsyncMock(return_value=[
        {"name": "read_file", "description": "Read file contents"},
        {"name": "write_file", "description": "Write to a file"},
        {"name": "list_directory", "description": "List directory contents"},
    ])
    mock.call_tool = AsyncMock(return_value={"result": "success"})
    mock.list_resources = AsyncMock(return_value=[])
    mock.read_resource = AsyncMock(return_value={"content": "resource data"})
    return mock


@pytest.fixture
def mock_anthropic_client() -> MagicMock:
    """Mock Anthropic API client."""
    mock = MagicMock()
    mock.messages = MagicMock()
    mock.messages.create = AsyncMock(return_value=MagicMock(
        content=[MagicMock(type="text", text="This is the AI response")],
        stop_reason="end_turn",
        usage=MagicMock(input_tokens=100, output_tokens=50),
    ))
    mock.messages.stream = MagicMock(return_value=MagicMock(
        __aiter__=AsyncMock(return_value=iter([
            MagicMock(
                type="content_block_delta",
                delta=MagicMock(type="text_delta", text="Stream"),
            ),
            MagicMock(
                type="content_block_delta",
                delta=MagicMock(type="text_delta", text=" response"),
            ),
        ]))
    ))
    return mock


@pytest.fixture
def test_conversation() -> list[dict[str, Any]]:
    """Create a test conversation history."""
    return [
        {"role": "user", "content": "Hello, can you help me?"},
        {"role": "assistant", "content": "Of course! What do you need help with?"},
        {"role": "user", "content": "Please analyze this code"},
    ]


@pytest.fixture
def test_tool_call() -> dict[str, Any]:
    """Create a test tool call."""
    return {
        "id": "tool-call-123",
        "type": "tool_use",
        "name": "read_file",
        "input": {"path": "/workspace/main.py"},
    }


@pytest.fixture
def test_tool_result() -> dict[str, Any]:
    """Create a test tool result."""
    return {
        "tool_use_id": "tool-call-123",
        "content": "def main():\n    print('Hello, World!')",
        "is_error": False,
    }


@pytest.fixture
def test_memory() -> dict[str, Any]:
    """Create a test agent memory entry."""
    return {
        "id": "memory-123",
        "agent_id": "agent-123",
        "session_id": "session-123",
        "content": "User prefers TypeScript over JavaScript",
        "type": "preference",
        "importance": 0.8,
        "created_at": "2024-01-01T00:00:00Z",
    }


@pytest.fixture
def test_execution_plan() -> dict[str, Any]:
    """Create a test execution plan."""
    return {
        "id": "plan-123",
        "agent_id": "agent-123",
        "session_id": "session-123",
        "steps": [
            {
                "id": "step-1",
                "action": "read_file",
                "params": {"path": "/workspace/src/index.ts"},
                "status": "completed",
            },
            {
                "id": "step-2",
                "action": "analyze_code",
                "params": {},
                "status": "in_progress",
            },
            {
                "id": "step-3",
                "action": "write_file",
                "params": {"path": "/workspace/src/utils.ts"},
                "status": "pending",
            },
        ],
        "status": "in_progress",
        "created_at": "2024-01-01T00:00:00Z",
    }


@pytest.fixture
def test_file_operations() -> list[dict[str, Any]]:
    """Create test file operation records."""
    return [
        {"type": "read", "path": "/workspace/src/index.ts", "timestamp": "2024-01-01T00:00:00Z"},
        {"type": "write", "path": "/workspace/src/utils.ts", "timestamp": "2024-01-01T00:01:00Z"},
        {"type": "delete", "path": "/workspace/temp.txt", "timestamp": "2024-01-01T00:02:00Z"},
    ]


@pytest.fixture
def test_workspace_context() -> dict[str, Any]:
    """Create a test workspace context."""
    return {
        "session_id": "session-123",
        "workspace_path": "/workspace",
        "files": [
            {"path": "/workspace/src/index.ts", "type": "file"},
            {"path": "/workspace/src/utils.ts", "type": "file"},
            {"path": "/workspace/package.json", "type": "file"},
        ],
        "git_status": {
            "branch": "main",
            "modified": ["src/index.ts"],
            "untracked": [],
        },
    }


@pytest.fixture
def mock_compute_client() -> MagicMock:
    """Mock ComputeClient for workspace operations."""
    mock = MagicMock()
    mock.workspace_id = "workspace-123"
    mock.user_id = "user-123"
    mock.read_file = AsyncMock(return_value="file content")
    mock.write_file = AsyncMock(return_value=True)
    mock.list_directory = AsyncMock(return_value=["file1.py", "file2.py"])
    mock.search_code = AsyncMock(return_value=[{"file": "main.py", "line": 10, "content": "result"}])
    mock.run_command = AsyncMock(return_value={"stdout": "output", "stderr": "", "exit_code": 0})
    mock.git_status = AsyncMock(return_value={"branch": "main", "modified": []})
    return mock


@pytest.fixture
def mock_llm_streaming() -> MagicMock:
    """Mock LLM provider with streaming support."""
    mock = MagicMock()

    # Non-streaming response
    mock.complete = AsyncMock(return_value={
        "content": "Test response",
        "finish_reason": "stop",
        "usage": {"input_tokens": 100, "output_tokens": 50},
        "tool_calls": [],
    })

    # Streaming response
    async def stream_generator():
        """Generate stream events."""
        yield {"type": "content_block_start", "index": 0, "content_block": {"type": "text"}}
        yield {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "Test"}}
        yield {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": " response"}}
        yield {"type": "content_block_stop", "index": 0}
        yield {"type": "message_delta", "delta": {"stop_reason": "end_turn"}}
        yield {"type": "message_stop"}

    mock.stream = AsyncMock(return_value=stream_generator())
    return mock


# ============================================
# Integration test fixtures (real DB/Redis)
# ============================================

@pytest.fixture(scope="session")
async def test_db_engine() -> AsyncGenerator[Any, None]:
    """Real PostgreSQL connection for integration tests.

    Connects to postgres-test from docker-compose.test.yml.
    Database URL: postgresql+asyncpg://test:test@localhost:5433/podex_test
    """
    import os
    from sqlalchemy.ext.asyncio import create_async_engine, AsyncEngine
    from sqlalchemy import text

    # Get database URL from environment or use default test URL
    db_url = os.getenv("DATABASE_URL", "postgresql+asyncpg://test:test@localhost:5433/podex_test")

    # Create async engine
    engine: AsyncEngine = create_async_engine(
        db_url,
        echo=False,
        pool_pre_ping=True,
        pool_size=5,
        max_overflow=10,
    )

    # Create tables (basic schema for testing)
    async with engine.begin() as conn:
        # Create agents table
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS agents (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                user_id TEXT,
                role TEXT NOT NULL,
                model TEXT NOT NULL,
                mode TEXT DEFAULT 'ask',
                status TEXT DEFAULT 'idle',
                system_prompt TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """))

        # Create messages table
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS messages (
                id SERIAL PRIMARY KEY,
                agent_id TEXT NOT NULL,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                tool_calls JSONB,
                tool_results JSONB,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """))

        # Create memories table (without VECTOR type for CI compatibility)
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS memories (
                id TEXT PRIMARY KEY,
                agent_id TEXT NOT NULL,
                session_id TEXT NOT NULL,
                content TEXT NOT NULL,
                embedding BYTEA,
                metadata JSONB,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """))

    yield engine

    # Cleanup
    await engine.dispose()


@pytest.fixture
async def clean_db(test_db_engine: Any) -> AsyncGenerator[None, None]:
    """Clean database between integration tests."""
    from sqlalchemy import text

    # Clean before test
    async with test_db_engine.begin() as conn:
        await conn.execute(text("TRUNCATE TABLE messages, agents CASCADE"))
        await conn.execute(text("DELETE FROM memories"))

    yield

    # Clean after test
    async with test_db_engine.begin() as conn:
        await conn.execute(text("TRUNCATE TABLE messages, agents CASCADE"))
        await conn.execute(text("DELETE FROM memories"))


@pytest.fixture(scope="session")
async def test_redis_client() -> AsyncGenerator[Any, None]:
    """Real Redis connection for integration tests.

    Connects to redis-test from docker-compose.test.yml.
    Redis URL: redis://localhost:6380
    """
    import os
    import redis.asyncio as aioredis

    # Get Redis URL from environment or use default test URL
    redis_url = os.getenv("REDIS_URL", "redis://localhost:6380")

    # Create async Redis client
    client = await aioredis.from_url(
        redis_url,
        encoding="utf-8",
        decode_responses=True,
    )

    # Test connection
    await client.ping()

    yield client

    # Cleanup
    await client.flushdb()
    await client.close()


@pytest.fixture
async def clean_redis(test_redis_client: Any) -> AsyncGenerator[None, None]:
    """Clean Redis between integration tests."""
    # Clean before test
    await test_redis_client.flushdb()

    yield

    # Clean after test
    await test_redis_client.flushdb()
