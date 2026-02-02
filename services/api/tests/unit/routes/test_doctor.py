"""Unit tests for doctor helpers (no HTTP wiring)."""

from __future__ import annotations

import sys
from unittest.mock import AsyncMock, MagicMock

import pytest
from starlette.requests import Request
from starlette.responses import Response

from src.routes import doctor as doctor_module


class TestLLMProviders:
    """Tests for check_llm_providers helper."""

    def test_llm_providers_reflect_settings(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from src import config as config_module

        # Ensure no cloud keys by default
        monkeypatch.setattr(config_module.settings, "ANTHROPIC_API_KEY", None, raising=False)
        monkeypatch.setattr(config_module.settings, "OPENAI_API_KEY", None, raising=False)
        monkeypatch.setattr(config_module.settings, "OPENROUTER_API_KEY", None, raising=False)

        providers = doctor_module.check_llm_providers()
        names = {p.provider: p for p in providers}

        assert names["anthropic"].configured is False
        assert names["openai"].configured is False
        assert names["openrouter"].configured is False
        assert names["ollama"].configured is True
        assert names["ollama"].model is not None


class TestRecommendations:
    """Tests for generate_recommendations logic."""

    def make_service(self, name: str, status: str) -> doctor_module.ServiceHealth:
        return doctor_module.ServiceHealth(name=name, status=status)

    def make_provider(self, provider: str, configured: bool) -> doctor_module.LLMProviderStatus:
        return doctor_module.LLMProviderStatus(provider=provider, configured=configured)

    def test_recommendations_for_unhealthy_services(self) -> None:
        services = [
            self.make_service("PostgreSQL Database", "unhealthy"),
            self.make_service("Redis", "unhealthy"),
            self.make_service("Agent Service", "unhealthy"),
            self.make_service("Docker", "unhealthy"),
            self.make_service("Compute Service (ws-1)", "unhealthy"),
        ]
        providers = [self.make_provider("ollama", True)]

        recs = doctor_module.generate_recommendations(services, providers)
        joined = " ".join(recs)
        assert "Database connection failed" in joined
        assert "Redis connection failed" in joined
        assert "Agent service is not reachable" in joined
        assert "Docker is not running" in joined
        assert "Compute Service (ws-1)" in joined

    def test_recommendation_when_no_cloud_providers_configured(self) -> None:
        services = []
        providers = [
            self.make_provider("anthropic", False),
            self.make_provider("openai", False),
            self.make_provider("openrouter", False),
            self.make_provider("ollama", True),
        ]

        recs = doctor_module.generate_recommendations(services, providers)
        assert any("No cloud LLM providers are configured" in r for r in recs)

    def test_generate_recommendations_empty_lists_returns_empty(self) -> None:
        """Empty services and providers with one cloud provider configured returns no recs."""
        providers = [doctor_module.LLMProviderStatus(provider="anthropic", configured=True)]
        recs = doctor_module.generate_recommendations([], providers)
        assert recs == []

    def test_generate_recommendations_degraded_service_no_unhealthy_rec(self) -> None:
        """Degraded (not unhealthy) services do not add unhealthy recommendations."""
        services = [
            doctor_module.ServiceHealth(name="Agent Service", status="degraded"),
        ]
        providers = [doctor_module.LLMProviderStatus(provider="ollama", configured=True)]
        recs = doctor_module.generate_recommendations(services, providers)
        assert not any("Agent service is not reachable" in r for r in recs)


class TestPydanticModels:
    """Smoke tests for doctor Pydantic models (defaults and mappings)."""

    def test_service_health_defaults_and_serialization(self) -> None:
        health = doctor_module.ServiceHealth(name="db", status="healthy")

        assert health.name == "db"
        assert health.status == "healthy"
        # Optional fields should default to None
        assert health.latency_ms is None
        assert health.message is None
        assert health.details is None

        # Model should be JSON-serializable without error
        payload = health.model_dump()
        assert payload["name"] == "db"
        assert payload["status"] == "healthy"

    def test_doctor_report_nested_models_and_default_recommendations(self) -> None:
        system = doctor_module.SystemInfo(
            platform="test-os",
            python_version="3.12.0",
            app_version="1.0.0",
            environment="test",
            server_time="2025-01-01T00:00:00Z",
        )
        services = [
            doctor_module.ServiceHealth(name="db", status="healthy"),
            doctor_module.ServiceHealth(name="redis", status="healthy"),
        ]
        providers = [
            doctor_module.LLMProviderStatus(provider="anthropic", configured=False),
            doctor_module.LLMProviderStatus(provider="ollama", configured=True),
        ]

        report = doctor_module.DoctorReport(
            status="healthy",
            timestamp="2025-01-01T00:00:00Z",
            system=system,
            services=services,
            llm_providers=providers,
        )

        # recommendations should default to an empty list and be mutable
        assert report.recommendations == []
        report.recommendations.append("do something")
        assert "do something" in report.recommendations

        dumped = report.model_dump()
        assert dumped["system"]["platform"] == "test-os"
        assert len(dumped["services"]) == 2
        assert len(dumped["llm_providers"]) == 2


class TestDiagnosticHelpers:
    """Tests for individual diagnostic helper functions with mocked dependencies."""

    @pytest.mark.asyncio
    async def test_check_all_compute_services_no_servers(self) -> None:
        """When no servers exist, check_all_compute_services returns an 'unknown' ServiceHealth."""
        db = AsyncMock()
        execute_result = MagicMock()
        execute_result.scalars.return_value.all.return_value = []
        db.execute.return_value = execute_result

        result = await doctor_module.check_all_compute_services(db=db)
        assert len(result) == 1
        info = result[0]
        assert info.name == "Compute Services"
        assert info.status == "unknown"
        assert "No servers" in (info.message or "")

    @pytest.mark.asyncio
    async def test_check_all_compute_services_handles_exceptions(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Exceptions from per-server checks are converted into 'unknown' ServiceHealth entries."""
        # Fake servers returned from DB
        server = MagicMock()
        server.name = "srv-1"
        server.compute_service_url = "http://compute"

        db = AsyncMock()
        execute_result = MagicMock()
        execute_result.scalars.return_value.all.return_value = [server]
        db.execute.return_value = execute_result

        async def failing_check(name: str, url: str) -> doctor_module.ServiceHealth:  # type: ignore[override]
            raise RuntimeError("boom")

        monkeypatch.setattr(
            doctor_module,
            "check_compute_service_for_server",
            failing_check,
        )

        result = await doctor_module.check_all_compute_services(db=db)
        assert len(result) == 1
        info = result[0]
        assert info.name == "Compute Service (srv-1)"
        assert info.status == "unknown"
        assert "Check failed" in (info.message or "")

    @pytest.mark.asyncio
    async def test_check_compute_service_for_server_healthy_and_degraded(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """check_compute_service_for_server maps HTTP 200 vs non-200 into healthy/degraded."""

        class DummyResponse:
            def __init__(self, status_code: int, payload: dict[str, str]) -> None:
                self.status_code = status_code
                self._payload = payload

            def json(self) -> dict[str, str]:
                return self._payload

        class DummyClient:
            def __init__(self, timeout: float) -> None:  # type: ignore[unused-argument]
                pass

            async def __aenter__(self) -> "DummyClient":
                return self

            async def __aexit__(self, exc_type, exc, tb) -> None:  # type: ignore[override]
                return None

            async def get(self, url: str, headers: dict[str, str]) -> DummyResponse:  # noqa: ARG002
                if "healthy" in url:
                    return DummyResponse(200, {"version": "1.2.3"})
                return DummyResponse(500, {})

        monkeypatch.setattr(doctor_module, "httpx", MagicMock(AsyncClient=DummyClient))

        # Healthy response
        ok = await doctor_module.check_compute_service_for_server(
            "srv-healthy",
            "http://compute-healthy",
        )
        assert ok.status == "healthy"
        assert ok.details and ok.details.get("version") == "1.2.3"

        # Degraded response (non-200)
        degraded = await doctor_module.check_compute_service_for_server(
            "srv-bad",
            "http://compute-degraded",
        )
        assert degraded.status == "degraded"

    @pytest.mark.asyncio
    async def test_check_agent_service_unhealthy_on_request_error(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """check_agent_service returns unhealthy when the HTTP request fails."""

        class DummyClient:
            def __init__(self, timeout: float) -> None:  # type: ignore[unused-argument]
                pass

            async def __aenter__(self) -> "DummyClient":
                return self

            async def __aexit__(self, exc_type, exc, tb) -> None:  # type: ignore[override]
                return None

            async def get(self, url: str, headers: dict[str, str]) -> None:  # noqa: ARG002
                raise RuntimeError("boom")

        monkeypatch.setattr(doctor_module, "httpx", MagicMock(AsyncClient=DummyClient))

        result = await doctor_module.check_agent_service()
        assert result.status == "unhealthy"
        assert "Connection failed" in (result.message or "")

    @pytest.mark.asyncio
    async def test_quick_check_returns_basic_info(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """quick_check exposes version and environment from settings."""
        monkeypatch.setattr(doctor_module.settings, "VERSION", "test-version", raising=False)
        monkeypatch.setattr(doctor_module.settings, "ENVIRONMENT", "test-env", raising=False)
        # Disable slowapi limiter to avoid Redis connections in unit tests
        monkeypatch.setattr(doctor_module.limiter, "enabled", False, raising=False)

        request = Request({"type": "http", "method": "GET", "path": "/doctor/quick", "headers": []})
        response = Response()

        result = await doctor_module.quick_check(request=request, response=response)
        assert result["status"] == "ok"
        assert result["version"] == "test-version"
        assert result["environment"] == "test-env"

    @pytest.mark.asyncio
    async def test_check_database_healthy(self) -> None:
        """check_database returns healthy when SELECT 1 and table count succeed."""
        db = AsyncMock()
        scalar_result = MagicMock()
        scalar_result.scalar.return_value = 1
        tables_result = MagicMock()
        tables_result.scalar.return_value = 5
        db.execute.side_effect = [scalar_result, tables_result]

        result = await doctor_module.check_database(db=db)
        assert result.name == "PostgreSQL Database"
        assert result.status == "healthy"
        assert result.latency_ms is not None
        assert result.details is not None
        assert "tables" in result.details

    @pytest.mark.asyncio
    async def test_check_database_unhealthy_on_error(self) -> None:
        """check_database returns unhealthy when execute raises."""
        db = AsyncMock()
        db.execute.side_effect = RuntimeError("connection refused")

        result = await doctor_module.check_database(db=db)
        assert result.status == "unhealthy"
        assert "Connection failed" in (result.message or "")

    @pytest.mark.asyncio
    async def test_check_docker_healthy(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """check_docker returns healthy when docker.info() succeeds."""
        fake_client = MagicMock()
        fake_client.info.return_value = {
            "ContainersRunning": 2,
            "Images": 10,
            "ServerVersion": "20.10",
        }
        fake_docker = MagicMock()
        fake_docker.from_env.return_value = fake_client
        monkeypatch.setitem(sys.modules, "docker", fake_docker)

        result = await doctor_module.check_docker()
        assert result.name == "Docker"
        assert result.status == "healthy"
        assert result.details is not None
        assert result.details.get("containers_running") == 2

    @pytest.mark.asyncio
    async def test_check_docker_unhealthy_on_error(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """check_docker returns unhealthy when docker raises."""
        fake_docker = MagicMock()
        fake_docker.from_env.return_value.info.side_effect = RuntimeError("Cannot connect")
        monkeypatch.setitem(sys.modules, "docker", fake_docker)

        result = await doctor_module.check_docker()
        assert result.status == "unhealthy"
        assert "Docker not available" in (result.message or "")

    @pytest.mark.asyncio
    async def test_run_doctor_401_when_not_authenticated(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """run_doctor raises 401 when request has no user_id."""
        from fastapi import HTTPException

        monkeypatch.setattr(doctor_module.limiter, "enabled", False, raising=False)
        request = Request({"type": "http", "method": "GET", "path": "/doctor", "headers": []})
        if hasattr(request.state, "user_id"):
            delattr(request.state, "user_id")

        with pytest.raises(HTTPException) as exc:
            await doctor_module.run_doctor(
                request=request,
                response=Response(),
                db=AsyncMock(),
            )
        assert exc.value.status_code == 401

    @pytest.mark.asyncio
    async def test_run_doctor_returns_report_with_mocked_checks(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """run_doctor returns DoctorReport when all checks are mocked successfully."""
        from fastapi import HTTPException

        monkeypatch.setattr(doctor_module.limiter, "enabled", False, raising=False)
        db = AsyncMock()
        execute_result = MagicMock()
        execute_result.scalars.return_value.all.return_value = []
        db.execute.return_value = execute_result

        healthy = doctor_module.ServiceHealth(
            name="test", status="healthy", latency_ms=1.0, message="ok"
        )

        async def mock_check_db(db):  # noqa: ARG001
            return healthy

        async def mock_check_redis() -> doctor_module.ServiceHealth:
            return healthy

        async def mock_compute(db):  # noqa: ARG001
            return [healthy]

        async def mock_agent() -> doctor_module.ServiceHealth:
            return healthy

        async def mock_docker() -> doctor_module.ServiceHealth:
            return healthy

        monkeypatch.setattr(doctor_module, "check_database", mock_check_db)
        monkeypatch.setattr(doctor_module, "check_redis", mock_check_redis)
        monkeypatch.setattr(doctor_module, "check_all_compute_services", mock_compute)
        monkeypatch.setattr(doctor_module, "check_agent_service", mock_agent)
        monkeypatch.setattr(doctor_module, "check_docker", mock_docker)

        request = Request({"type": "http", "method": "GET", "path": "/doctor", "headers": []})
        request.state.user_id = "user-1"

        report = await doctor_module.run_doctor(request=request, response=Response(), db=db)
        assert report.status == "healthy"
        assert report.system is not None
        assert report.system.platform
        assert len(report.services) >= 1
        assert len(report.llm_providers) >= 1
        assert isinstance(report.recommendations, list)
