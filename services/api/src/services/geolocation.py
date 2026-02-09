"""IP geolocation service using ipinfo.io API.

This service provides IP-to-location lookups for device session tracking.
Uses the ipinfo.io API which has a free tier (50k requests/month).

Setup:
1. Sign up at https://ipinfo.io/signup (optional - works without token at lower rate limits)
2. Get your API token from the dashboard
3. Set IPINFO_TOKEN in your environment/config

Results are cached in-memory to reduce API calls.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx
import structlog

from src.config import settings

logger = structlog.get_logger()

_CACHE_SIZE = 1000
_ip_cache: dict[str, tuple[str | None, str | None, str | None]] = {}


@dataclass
class GeoLocation:
    """Geolocation result for an IP address."""

    city: str | None
    country: str | None
    country_code: str | None
    region: str | None = None
    latitude: float | None = None
    longitude: float | None = None


def _is_private_ip(ip_address: str) -> bool:
    """Check if an IP address is private/local."""
    private_prefixes = (
        "10.",
        "172.16.",
        "172.17.",
        "172.18.",
        "172.19.",
        "172.20.",
        "172.21.",
        "172.22.",
        "172.23.",
        "172.24.",
        "172.25.",
        "172.26.",
        "172.27.",
        "172.28.",
        "172.29.",
        "172.30.",
        "172.31.",
        "192.168.",
        "127.",
        "::1",
        "fe80:",
        "fc00:",
        "fd00:",
    )
    return ip_address.startswith(private_prefixes)


async def lookup_ip_location(
    ip_address: str | None,
) -> tuple[str | None, str | None, str | None]:
    """Look up geolocation for an IP address.

    Args:
        ip_address: The IP address to look up.

    Returns:
        Tuple of (city, country, country_code), all may be None.
    """
    if not ip_address or _is_private_ip(ip_address):
        return None, None, None

    # Check cache
    if ip_address in _ip_cache:
        return _ip_cache[ip_address]

    # Fetch from ipinfo.io
    token = getattr(settings, "IPINFO_TOKEN", None)
    url = f"https://ipinfo.io/{ip_address}/json"
    if token:
        url += f"?token={token}"

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(url)

            if response.status_code == 429:
                logger.warning("ipinfo.io rate limit reached")
                return None, None, None

            if response.status_code != 200:
                return None, None, None

            data: dict[str, Any] = response.json()
            country_code = data.get("country")
            result = (data.get("city"), country_code, country_code)

            # Cache result
            if len(_ip_cache) < _CACHE_SIZE:
                _ip_cache[ip_address] = result

            return result
    except Exception as e:
        logger.debug("ipinfo.io lookup error", ip=ip_address, error=str(e))
        return None, None, None
