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
    """Ensure test image is available.

    Uses debian:stable-slim which includes bash (required by docker_manager).
    Alpine doesn't have bash by default.
    """
    return "debian:stable-slim"


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
    """Create or reuse test network.

    Handles the case where the network already exists from a previous
    test run that didn't clean up properly.
    """
    network_name = "podex-test-integration"
    try:
        # Try to get existing network first
        network = docker_client.networks.get(network_name)
    except Exception:
        # Network doesn't exist, create it
        network = docker_client.networks.create(network_name, driver="bridge")

    yield network

    try:
        # Remove all containers from the network first
        network.reload()
        for container in network.containers:
            try:
                network.disconnect(container, force=True)
            except Exception:
                pass
        network.remove()
    except Exception:
        pass  # Network may be in use or already removed
