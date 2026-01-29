"""Pytest configuration for shared service tests."""

import os
from collections.abc import AsyncIterator
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
import redis.asyncio as redis

# Check if integration tests should run
RUN_INTEGRATION_TESTS = os.getenv("RUN_INTEGRATION_TESTS", "false").lower() == "true"
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6380")


@pytest.fixture
def mock_redis_client() -> MagicMock:
    """Create a mock Redis client."""
    client = MagicMock()
    client.get = AsyncMock(return_value=None)
    client.set = AsyncMock(return_value=True)
    client.delete = AsyncMock(return_value=1)
    client.exists = AsyncMock(return_value=0)
    client.expire = AsyncMock(return_value=True)
    client.hget = AsyncMock(return_value=None)
    client.hset = AsyncMock(return_value=1)
    client.hgetall = AsyncMock(return_value={})
    client.hdel = AsyncMock(return_value=1)
    client.publish = AsyncMock(return_value=1)
    client.pubsub = MagicMock()
    client.close = AsyncMock()
    return client


@pytest.fixture
def mock_http_client() -> MagicMock:
    """Create a mock HTTPX async client."""
    client = MagicMock()
    response = MagicMock()
    response.status_code = 200
    response.json.return_value = {"success": True}
    response.raise_for_status = MagicMock()
    client.post = AsyncMock(return_value=response)
    client.get = AsyncMock(return_value=response)
    client.aclose = AsyncMock()
    return client


@pytest.fixture
def sample_usage_event_data() -> dict[str, Any]:
    """Sample usage event data."""
    return {
        "user_id": "user-123",
        "session_id": "session-456",
        "workspace_id": "workspace-789",
        "model": "claude-sonnet-4-20250514",
        "input_tokens": 1000,
        "output_tokens": 500,
    }


@pytest.fixture
def sample_session_state_data() -> dict[str, Any]:
    """Sample session state data."""
    return {
        "session_id": "session-123",
        "user_id": "user-456",
        "name": "Test Session",
        "workspaces": [],
        "agents": [],
        "viewers": [],
        "shared_with": [],
        "created_at": "2025-01-01T00:00:00Z",
        "updated_at": "2025-01-01T00:00:00Z",
        "last_activity": "2025-01-01T00:00:00Z",
        "version": 0,
    }


@pytest.fixture
def sample_workspace_config_data() -> dict[str, Any]:
    """Sample workspace config data."""
    return {
        "tier": "starter",
        "architecture": "x86_64",
        "gpu_type": "none",
        "os_version": "ubuntu-22.04",
        "python_version": "3.12",
        "node_version": "20",
        "storage_gb": 20,
        "timeout_hours": 24,
    }


@pytest.fixture
async def real_redis_client() -> AsyncIterator[redis.Redis]:
    """Create a real Redis client for integration tests.

    Only available when RUN_INTEGRATION_TESTS=true.
    """
    if not RUN_INTEGRATION_TESTS:
        pytest.skip("Integration tests disabled (set RUN_INTEGRATION_TESTS=true)")

    client = redis.from_url(REDIS_URL, decode_responses=True)
    try:
        await client.ping()
        yield client
    finally:
        await client.flushdb()  # Clean up test data
        await client.close()


@pytest.fixture
async def redis_with_encryption() -> AsyncIterator[redis.Redis]:
    """Real Redis client with encryption enabled for testing redis_crypto."""
    if not RUN_INTEGRATION_TESTS:
        pytest.skip("Integration tests disabled")

    # Set encryption key for tests
    os.environ["REDIS_ENCRYPTION_KEY"] = "test-encryption-key-for-testing"

    client = redis.from_url(REDIS_URL, decode_responses=True)
    try:
        await client.ping()
        yield client
    finally:
        await client.flushdb()
        await client.close()
        # Clean up env var
        if "REDIS_ENCRYPTION_KEY" in os.environ:
            del os.environ["REDIS_ENCRYPTION_KEY"]
        # Clear crypto cache
        from podex_shared.redis_crypto import clear_key_cache

        clear_key_cache()


@pytest.fixture
def mock_gcs_client() -> MagicMock:
    """Mock Google Cloud Storage client."""
    client = MagicMock()
    bucket = MagicMock()
    blob = MagicMock()

    # Mock blob operations
    blob.exists = MagicMock(return_value=True)
    blob.download_as_bytes = MagicMock(return_value=b"test content")
    blob.download_as_string = MagicMock(return_value="test content")
    blob.upload_from_string = MagicMock()
    blob.upload_from_file = MagicMock()
    blob.delete = MagicMock()
    blob.generate_signed_url = MagicMock(
        return_value="https://storage.googleapis.com/test-bucket/test-key"
    )
    blob.name = "test-key"
    blob.size = 100

    # Mock bucket operations
    bucket.blob = MagicMock(return_value=blob)
    bucket.copy_blob = MagicMock(return_value=blob)
    bucket.exists = MagicMock(return_value=True)
    bucket.create = MagicMock()

    # Mock client operations
    client.bucket = MagicMock(return_value=bucket)
    client.get_bucket = MagicMock(return_value=bucket)
    client.create_bucket = MagicMock(return_value=bucket)
    client.list_blobs = MagicMock(return_value=[])

    return client


@pytest.fixture
def mock_speech_client() -> MagicMock:
    """Mock Google Cloud Speech client."""

    client = MagicMock()

    # Mock transcription response
    result = MagicMock()
    result.alternatives = [
        MagicMock(
            transcript="Hello world",
            confidence=0.95,
            words=[
                MagicMock(
                    word="Hello",
                    start_time=MagicMock(total_seconds=MagicMock(return_value=0.0)),
                    end_time=MagicMock(total_seconds=MagicMock(return_value=0.5)),
                ),
                MagicMock(
                    word="world",
                    start_time=MagicMock(total_seconds=MagicMock(return_value=0.5)),
                    end_time=MagicMock(total_seconds=MagicMock(return_value=1.0)),
                ),
            ],
        )
    ]
    result.result_end_time = MagicMock(total_seconds=MagicMock(return_value=1.0))
    result.language_code = "en-US"

    response = MagicMock()
    response.results = [result]

    client.recognize = MagicMock(return_value=response)
    client.long_running_recognize = MagicMock(return_value=MagicMock(name="operation-123"))

    return client


@pytest.fixture
def mock_tts_client() -> MagicMock:
    """Mock Google Cloud TTS client."""
    client = MagicMock()

    # Mock synthesis response
    response = MagicMock()
    response.audio_content = b"fake-audio-data"

    client.synthesize_speech = MagicMock(return_value=response)

    # Mock list voices response
    voice = MagicMock()
    voice.name = "en-US-Neural2-J"
    voice.language_codes = ["en-US"]
    voice.ssml_gender = 1  # MALE
    voice.natural_sample_rate_hertz = 24000

    voices_response = MagicMock()
    voices_response.voices = [voice]

    client.list_voices = MagicMock(return_value=voices_response)

    return client
