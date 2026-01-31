"""GeoIP lookup service using MaxMind GeoLite2 database.

This service provides IP-to-location lookups for device session tracking.
Uses the free GeoLite2-City database from MaxMind.

Setup:
1. Create a MaxMind account at https://www.maxmind.com/en/geolite2/signup
2. Download GeoLite2-City.mmdb from your account
3. Set GEOIP_DATABASE_PATH in config (default: /data/GeoLite2-City.mmdb)

The database can be auto-updated using MaxMind's geoipupdate tool.
If the database is not found, the service will gracefully return None for lookups.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

import structlog

from src.config import settings

if TYPE_CHECKING:
    import geoip2.database

logger = structlog.get_logger()


@dataclass
class GeoLocation:
    """Geolocation result for an IP address."""

    city: str | None
    country: str | None
    country_code: str | None
    latitude: float | None = None
    longitude: float | None = None


class GeoIPService:
    """Service for IP geolocation using MaxMind GeoLite2."""

    _instance: GeoIPService | None = None
    _reader: geoip2.database.Reader | None = None

    def __init__(self) -> None:
        """Initialize the GeoIP service."""
        self._db_path = settings.GEOIP_DATABASE_PATH
        self._initialized = False

    def _ensure_initialized(self) -> bool:
        """Lazily initialize the database reader."""
        if self._initialized:
            return self._reader is not None

        self._initialized = True

        if not Path(self._db_path).exists():
            logger.warning(
                "GeoIP database not found",
                path=self._db_path,
                hint="Download GeoLite2-City.mmdb from MaxMind",
            )
            return False

        try:
            import geoip2.database  # noqa: PLC0415

            self._reader = geoip2.database.Reader(self._db_path)
            logger.info("GeoIP database loaded", path=self._db_path)
            return True  # noqa: TRY300
        except Exception:
            logger.exception("Failed to load GeoIP database", path=self._db_path)
            return False

    def lookup(self, ip_address: str | None) -> GeoLocation | None:
        """Look up geolocation for an IP address.

        Args:
            ip_address: The IP address to look up.

        Returns:
            GeoLocation with city/country info, or None if lookup fails.
        """
        if not ip_address:
            return None

        # Skip private/local IPs
        if self._is_private_ip(ip_address):
            return None

        if not self._ensure_initialized():
            return None

        try:
            response = self._reader.city(ip_address)  # type: ignore[union-attr]

            return GeoLocation(
                city=response.city.name,
                country=response.country.name,
                country_code=response.country.iso_code,
                latitude=response.location.latitude,
                longitude=response.location.longitude,
            )
        except Exception as e:
            # GeoIP lookup failures are not critical - just log and continue
            logger.debug("GeoIP lookup failed", ip=ip_address, error=str(e))
            return None

    def _is_private_ip(self, ip_address: str) -> bool:
        """Check if an IP address is private/local."""
        # Simple check for common private ranges
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

    def close(self) -> None:
        """Close the database reader."""
        if self._reader:
            self._reader.close()
            self._reader = None
            self._initialized = False


# Singleton instance
_geoip_service: GeoIPService | None = None


def get_geoip_service() -> GeoIPService:
    """Get the singleton GeoIP service instance."""
    global _geoip_service
    if _geoip_service is None:
        _geoip_service = GeoIPService()
    return _geoip_service


def lookup_ip_location(ip_address: str | None) -> tuple[str | None, str | None, str | None]:
    """Convenience function to look up location for an IP.

    Args:
        ip_address: The IP address to look up.

    Returns:
        Tuple of (city, country, country_code), all may be None.
    """
    service = get_geoip_service()
    location = service.lookup(ip_address)

    if location:
        return location.city, location.country, location.country_code

    return None, None, None
