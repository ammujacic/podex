"""Unit tests for Cloudflare client helpers (no real HTTP)."""

from __future__ import annotations

from typing import Any

import pytest

from src.services import cloudflare_client as cf


def test_check_success_does_nothing() -> None:
    cf._check({"success": True})  # should not raise


def test_check_raises_on_error_message() -> None:
    with pytest.raises(RuntimeError) as exc:
        cf._check({"success": False, "errors": [{"message": "bad things"}]})
    assert "Cloudflare API error: bad things" in str(exc.value)


@pytest.mark.asyncio
async def test_create_tunnel_requires_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    """create_tunnel should fail fast when settings are missing."""
    monkeypatch.setattr(cf.settings, "CLOUDFLARE_ACCOUNT_ID", "")
    monkeypatch.setattr(cf.settings, "CLOUDFLARE_API_TOKEN", "")

    with pytest.raises(RuntimeError) as exc:
        await cf.create_tunnel("name")
    assert "CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID must be set" in str(exc.value)


@pytest.mark.asyncio
async def test_create_dns_cname_requires_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    """create_dns_cname should fail fast when settings are missing."""
    monkeypatch.setattr(cf.settings, "CLOUDFLARE_ZONE_ID", "")
    monkeypatch.setattr(cf.settings, "CLOUDFLARE_API_TOKEN", "")

    with pytest.raises(RuntimeError) as exc:
        await cf.create_dns_cname("host", "target")
    assert "CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID must be set" in str(exc.value)


@pytest.mark.asyncio
async def test_delete_tunnel_requires_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(cf.settings, "CLOUDFLARE_ACCOUNT_ID", "")
    monkeypatch.setattr(cf.settings, "CLOUDFLARE_API_TOKEN", "")

    with pytest.raises(RuntimeError):
        await cf.delete_tunnel("tid")


@pytest.mark.asyncio
async def test_delete_dns_record_by_name_requires_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(cf.settings, "CLOUDFLARE_ZONE_ID", "")
    monkeypatch.setattr(cf.settings, "CLOUDFLARE_API_TOKEN", "")

    with pytest.raises(RuntimeError):
        await cf.delete_dns_record_by_name("host")
