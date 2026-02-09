"""Unit tests for geolocation service."""

from __future__ import annotations

import pytest
import respx

from src.services import geolocation as geo


def test_is_private_ip_recognizes_common_ranges() -> None:
    assert geo._is_private_ip("10.0.0.1")
    assert geo._is_private_ip("192.168.1.5")
    assert geo._is_private_ip("127.0.0.1")
    assert geo._is_private_ip("172.16.0.1")
    assert geo._is_private_ip("::1")
    assert not geo._is_private_ip("8.8.8.8")
    assert not geo._is_private_ip("104.23.162.103")


@pytest.mark.asyncio
async def test_lookup_returns_none_for_private_ip() -> None:
    result = await geo.lookup_ip_location("10.0.0.1")
    assert result == (None, None, None)


@pytest.mark.asyncio
async def test_lookup_returns_none_for_none_ip() -> None:
    result = await geo.lookup_ip_location(None)
    assert result == (None, None, None)


@pytest.mark.asyncio
async def test_lookup_returns_cached_result() -> None:
    # Pre-populate cache
    geo._ip_cache["1.2.3.4"] = ("CachedCity", "CC", "CC")

    result = await geo.lookup_ip_location("1.2.3.4")
    assert result == ("CachedCity", "CC", "CC")

    # Clean up
    del geo._ip_cache["1.2.3.4"]


@pytest.mark.asyncio
@respx.mock
async def test_lookup_fetches_from_api() -> None:
    respx.get("https://ipinfo.io/8.8.8.8/json").mock(
        return_value=respx.MockResponse(
            200,
            json={
                "city": "San Francisco",
                "country": "US",
                "region": "California",
            },
        )
    )

    # Clear cache for this IP
    geo._ip_cache.pop("8.8.8.8", None)

    result = await geo.lookup_ip_location("8.8.8.8")
    assert result == ("San Francisco", "US", "US")

    # Clean up cache
    geo._ip_cache.pop("8.8.8.8", None)


@pytest.mark.asyncio
@respx.mock
async def test_lookup_handles_rate_limit() -> None:
    respx.get("https://ipinfo.io/9.9.9.9/json").mock(
        return_value=respx.MockResponse(429)
    )

    # Clear cache
    geo._ip_cache.pop("9.9.9.9", None)

    result = await geo.lookup_ip_location("9.9.9.9")
    assert result == (None, None, None)
