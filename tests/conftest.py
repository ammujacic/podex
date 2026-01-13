"""
Pytest configuration and fixtures for agent integration tests.
"""
import os
import sys
import time
import pytest
import requests
from typing import Generator, Dict, Any

# Add the project root to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

# Check if we should skip local-only tests
SKIP_LOCAL_TESTS = os.getenv("SKIP_AGENT_TESTS", "false").lower() == "true" or os.getenv("CI") == "true"


def pytest_configure(config):
    """Configure pytest with custom markers and settings."""
    config.addinivalue_line(
        "markers", "local_only: mark test as requiring local services (skipped in CI)"
    )


def pytest_collection_modifyitems(config, items):
    """Modify test collection to skip local_only tests in CI."""
    if SKIP_LOCAL_TESTS:
        skip_local = pytest.mark.skip(reason="Skipping local-only tests (no Ollama in CI)")
        for item in items:
            if "local_only" in item.keywords:
                item.add_marker(skip_local)


@pytest.fixture(scope="session")
def base_url() -> str:
    """Base URL for API service."""
    return os.getenv("API_BASE_URL", "http://localhost:3001")


@pytest.fixture(scope="session")
def agent_service_url() -> str:
    """Base URL for Agent service."""
    return os.getenv("AGENT_BASE_URL", "http://localhost:3002")


@pytest.fixture(scope="session")
def web_url() -> str:
    """Base URL for Web frontend."""
    return os.getenv("WEB_BASE_URL", "http://localhost:3000")


@pytest.fixture(scope="session")
def test_user_credentials() -> Dict[str, str]:
    """Test user credentials for authentication."""
    return {
        "email": os.getenv("TEST_USER_EMAIL", "admin@podex.dev"),
        "password": os.getenv("TEST_USER_PASSWORD", "AdminPassword123!"),
    }


@pytest.fixture(scope="session")
def wait_for_services(base_url: str, agent_service_url: str, web_url: str):
    """Wait for all services to be ready."""
    services = {
        "API": f"{base_url}/health",
        "Agent": f"{agent_service_url}/health",
        "Web": web_url,
    }

    max_retries = 30
    retry_delay = 2

    for service_name, url in services.items():
        print(f"\nWaiting for {service_name} service at {url}...")
        for i in range(max_retries):
            try:
                response = requests.get(url, timeout=5)
                if response.status_code in (200, 404):  # 404 is OK for web (Next.js)
                    print(f"✓ {service_name} service is ready")
                    break
            except requests.exceptions.RequestException:
                if i == max_retries - 1:
                    pytest.fail(f"❌ {service_name} service not ready after {max_retries * retry_delay}s")
                time.sleep(retry_delay)

    # Extra grace period for services to fully initialize
    time.sleep(5)
    yield


@pytest.fixture(scope="session")
def auth_token(base_url: str, test_user_credentials: Dict[str, str], wait_for_services) -> str:
    """Authenticate and return access token."""
    response = requests.post(
        f"{base_url}/api/auth/login",
        json=test_user_credentials,
        timeout=10
    )

    if response.status_code != 200:
        pytest.fail(f"Failed to authenticate: {response.status_code} - {response.text}")

    data = response.json()
    return data["access_token"]


@pytest.fixture
def api_client(base_url: str, auth_token: str):
    """HTTP client with authentication for API calls."""
    class APIClient:
        def __init__(self, base_url: str, token: str):
            self.base_url = base_url
            self.headers = {
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json"
            }

        def get(self, path: str, **kwargs) -> requests.Response:
            return requests.get(f"{self.base_url}{path}", headers=self.headers, **kwargs)

        def post(self, path: str, **kwargs) -> requests.Response:
            return requests.post(f"{self.base_url}{path}", headers=self.headers, **kwargs)

        def put(self, path: str, **kwargs) -> requests.Response:
            return requests.put(f"{self.base_url}{path}", headers=self.headers, **kwargs)

        def patch(self, path: str, **kwargs) -> requests.Response:
            return requests.patch(f"{self.base_url}{path}", headers=self.headers, **kwargs)

        def delete(self, path: str, **kwargs) -> requests.Response:
            return requests.delete(f"{self.base_url}{path}", headers=self.headers, **kwargs)

    return APIClient(base_url, auth_token)


@pytest.fixture
def test_session(api_client) -> Generator[str, None, None]:
    """Create a test session and clean it up after the test."""
    # Create session
    response = api_client.post(
        "/api/sessions",
        json={"name": f"Test Session {int(time.time())}"},
        timeout=10
    )
    assert response.status_code == 200, f"Failed to create session: {response.text}"

    session_id = response.json()["id"]
    print(f"\n✓ Created test session: {session_id}")

    yield session_id

    # Cleanup: delete session
    try:
        response = api_client.delete(f"/api/sessions/{session_id}", timeout=10)
        if response.status_code == 200:
            print(f"✓ Cleaned up test session: {session_id}")
    except Exception as e:
        print(f"⚠️  Failed to cleanup session {session_id}: {e}")


@pytest.fixture
def ollama_model() -> str:
    """Ollama model to use for tests."""
    return os.getenv("OLLAMA_MODEL", "qwen2.5-coder:14b")


@pytest.fixture
def test_timeout() -> int:
    """Timeout for agent operations in seconds."""
    return int(os.getenv("TEST_TIMEOUT", "120"))
