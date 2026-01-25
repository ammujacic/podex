"""Pytest fixtures for integration tests with real Docker."""

import pytest


@pytest.fixture(scope="session")
def docker_client():
    """Real Docker client for integration tests."""
    try:
        import docker

        client = docker.from_env()
        # Verify Docker is accessible
        client.ping()
        yield client
    except Exception as e:
        pytest.skip(f"Docker not available: {e}")


@pytest.fixture
def test_image():
    """Ensure test image is available."""
    # Use a small Alpine image for tests
    return "alpine:latest"


@pytest.fixture
async def cleanup_containers(docker_client):
    """Cleanup test containers after each test."""
    created_containers = []

    yield created_containers

    # Cleanup
    for container_id in created_containers:
        try:
            container = docker_client.containers.get(container_id)
            container.stop(timeout=1)
            container.remove(force=True)
        except Exception:
            pass  # Container may already be removed


@pytest.fixture
def test_network(docker_client):
    """Create test network."""
    network = docker_client.networks.create("podex-test-integration", driver="bridge")
    yield network
    try:
        network.remove()
    except Exception:
        pass  # Network may already be removed
