"""Integration tests for /doctor routes using the real FastAPI app.

These tests focus on:
- Authentication behavior for the main /doctor endpoint
- Exercising the async helper orchestration with mocked dependencies
"""

from __future__ import annotations

from typing import Any, List

import pytest
from httpx import AsyncClient

from src.routes import doctor as doctor_module


@pytest.mark.asyncio
async def test_doctor_requires_authentication(async_client: AsyncClient) -> None:
    """The main /doctor endpoint should require authentication."""
    # NOTE: We intentionally use the bare async_client fixture here which
    # does not attach auth headers, to verify the 401 path.
    response = await async_client.get("/api/doctor")

    assert response.status_code == 401
    body = response.json()
    assert body["detail"] in ("Not authenticated", "Authentication required")


@pytest.mark.asyncio
async def test_doctor_returns_report_with_mocked_checks(
    test_client: AsyncClient,
    auth_headers_with_db: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Run /doctor with all external checks mocked to avoid network/IO."""

    async def fake_check_database(db: Any) -> doctor_module.ServiceHealth:  # noqa: ARG001
        return doctor_module.ServiceHealth(
            name="PostgreSQL Database",
            status="healthy",
            latency_ms=1.23,
            message="OK",
        )

    async def fake_check_redis() -> doctor_module.ServiceHealth:
        return doctor_module.ServiceHealth(
            name="Redis",
            status="healthy",
            latency_ms=0.5,
            message="OK",
        )

    async def fake_check_all_compute_services(db: Any) -> List[doctor_module.ServiceHealth]:  # noqa: ARG001
        return [
            doctor_module.ServiceHealth(
                name="Compute Service (ws-1)",
                status="healthy",
                latency_ms=2.0,
                message="OK",
            )
        ]

    async def fake_check_agent_service() -> doctor_module.ServiceHealth:
        return doctor_module.ServiceHealth(
            name="Agent Service",
            status="healthy",
            latency_ms=3.0,
            message="OK",
        )

    async def fake_check_docker() -> doctor_module.ServiceHealth:
        return doctor_module.ServiceHealth(
            name="Docker",
            status="healthy",
            latency_ms=4.0,
            message="OK",
        )

    def fake_check_llm_providers() -> list[doctor_module.LLMProviderStatus]:
        return [
            doctor_module.LLMProviderStatus(provider="anthropic", configured=False),
            doctor_module.LLMProviderStatus(provider="openai", configured=False),
            doctor_module.LLMProviderStatus(provider="openrouter", configured=False),
            doctor_module.LLMProviderStatus(provider="ollama", configured=True, model="llama3"),
        ]

    monkeypatch.setattr(doctor_module, "check_database", fake_check_database)
    monkeypatch.setattr(doctor_module, "check_redis", fake_check_redis)
    monkeypatch.setattr(doctor_module, "check_all_compute_services", fake_check_all_compute_services)
    monkeypatch.setattr(doctor_module, "check_agent_service", fake_check_agent_service)
    monkeypatch.setattr(doctor_module, "check_docker", fake_check_docker)
    monkeypatch.setattr(doctor_module, "check_llm_providers", fake_check_llm_providers)

    response = await test_client.get("/api/doctor", headers=auth_headers_with_db)

    assert response.status_code == 200
    data = response.json()

    # Overall status should be healthy when all services are healthy
    assert data["status"] == "healthy"
    assert data["system"]["environment"]
    assert data["system"]["app_version"]

    service_names = {s["name"] for s in data["services"]}
    assert "PostgreSQL Database" in service_names
    assert "Redis" in service_names
    assert any(name.startswith("Compute Service") for name in service_names)


@pytest.mark.asyncio
async def test_doctor_handles_failing_checks(
    test_client: AsyncClient,
    auth_headers_with_db: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """When individual checks raise exceptions, /doctor should degrade gracefully."""

    async def failing_check_database(db: Any) -> doctor_module.ServiceHealth:  # noqa: ARG001
        raise RuntimeError("database offline")

    async def failing_check_all_compute_services(db: Any) -> list[doctor_module.ServiceHealth]:  # noqa: ARG001
        raise RuntimeError("compute down")

    async def unhealthy_redis() -> doctor_module.ServiceHealth:
        return doctor_module.ServiceHealth(
            name="Redis",
            status="unhealthy",
            latency_ms=10.0,
            message="Connection failed",
        )

    async def unhealthy_agent() -> doctor_module.ServiceHealth:
        return doctor_module.ServiceHealth(
            name="Agent Service",
            status="degraded",
            latency_ms=15.0,
            message="High latency",
        )

    async def unhealthy_docker() -> doctor_module.ServiceHealth:
        return doctor_module.ServiceHealth(
            name="Docker",
            status="unhealthy",
            latency_ms=20.0,
            message="Not running",
        )

    def fake_check_llm_providers() -> list[doctor_module.LLMProviderStatus]:
        # No cloud providers configured -> should add recommendation
        return [
            doctor_module.LLMProviderStatus(provider="anthropic", configured=False),
            doctor_module.LLMProviderStatus(provider="openai", configured=False),
            doctor_module.LLMProviderStatus(provider="openrouter", configured=False),
            doctor_module.LLMProviderStatus(provider="ollama", configured=True, model="llama3"),
        ]

    monkeypatch.setattr(doctor_module, "check_database", failing_check_database)
    monkeypatch.setattr(doctor_module, "check_redis", unhealthy_redis)
    monkeypatch.setattr(doctor_module, "check_all_compute_services", failing_check_all_compute_services)
    monkeypatch.setattr(doctor_module, "check_agent_service", unhealthy_agent)
    monkeypatch.setattr(doctor_module, "check_docker", unhealthy_docker)
    monkeypatch.setattr(doctor_module, "check_llm_providers", fake_check_llm_providers)

    response = await test_client.get("/api/doctor", headers=auth_headers_with_db)

    assert response.status_code == 200
    data = response.json()

    # With some unhealthy and failing checks, overall status should not be "healthy"
    assert data["status"] in {"degraded", "unhealthy"}

    # Database and compute failures should be reported as unknown status
    db_service = next(s for s in data["services"] if s["name"] == "PostgreSQL Database")
    assert db_service["status"] == "unknown"
    assert "failed" in db_service["message"].lower()

    compute_service = next(s for s in data["services"] if s["name"] == "Compute Services")
    assert compute_service["status"] == "unknown"

    # Should recommend configuring at least one cloud provider
    assert any(
        "No cloud LLM providers are configured" in rec for rec in data.get("recommendations", [])
    )


@pytest.mark.asyncio
async def test_doctor_quick_returns_status(
    test_client: AsyncClient,
    auth_headers_with_db: dict[str, str],
) -> None:
    """GET /doctor/quick returns status/version/environment (with auth; /api is protected)."""
    response = await test_client.get("/api/doctor/quick", headers=auth_headers_with_db)

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "version" in data
    assert "environment" in data
