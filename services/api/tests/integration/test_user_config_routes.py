"""Integration tests for user config routes.

Covers: GET/PATCH /user/config, GET /user/config/tours (auth required).
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient


# -----------------------------------------------------------------------------
# Get config
# -----------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_user_config_requires_auth(test_client: AsyncClient) -> None:
    """GET /user/config without auth returns 401."""
    resp = await test_client.get(
        "/api/user/config",
        headers={"X-Requested-With": "XMLHttpRequest", "Origin": "http://test"},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_get_user_config_success(
    test_client: AsyncClient,
    auth_headers_with_db: dict[str, str],
) -> None:
    """GET /user/config with auth returns config (defaults or existing)."""
    resp = await test_client.get("/api/user/config", headers=auth_headers_with_db)
    assert resp.status_code == 200
    data = resp.json()
    assert "id" in data
    assert "user_id" in data
    assert "default_shell" in data
    assert "theme" in data


# -----------------------------------------------------------------------------
# Update config
# -----------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_patch_user_config_success(
    test_client: AsyncClient,
    auth_headers_with_db: dict[str, str],
) -> None:
    """PATCH /user/config updates config and returns updated config."""
    resp = await test_client.patch(
        "/api/user/config",
        headers=auth_headers_with_db,
        json={"theme": "dark", "git_name": "Test User"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["theme"] == "dark"
    assert data["git_name"] == "Test User"


# -----------------------------------------------------------------------------
# Tours
# -----------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_user_config_tours_requires_auth(test_client: AsyncClient) -> None:
    """GET /user/config/tours without auth returns 401."""
    resp = await test_client.get(
        "/api/user/config/tours",
        headers={"X-Requested-With": "XMLHttpRequest", "Origin": "http://test"},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_get_user_config_tours_success(
    test_client: AsyncClient,
    auth_headers_with_db: dict[str, str],
) -> None:
    """GET /user/config/tours with auth returns completed_tours list."""
    resp = await test_client.get("/api/user/config/tours", headers=auth_headers_with_db)
    assert resp.status_code == 200
    data = resp.json()
    assert "completed_tours" in data
    assert isinstance(data["completed_tours"], list)
