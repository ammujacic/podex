"""Hardware specifications provider that fetches from API database.

This module provides cached access to hardware specifications stored in the
API database, allowing dynamic configuration of workspace tier resources
without redeploying the compute service.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import httpx
import structlog

from src.config import settings

logger = structlog.get_logger()

# Cache duration in seconds (5 minutes)
CACHE_TTL_SECONDS = 300


@dataclass
class HardwareSpec:
    """Hardware specification for a workspace tier."""

    id: str
    tier: str
    display_name: str
    description: str | None
    architecture: str
    vcpu: int
    memory_mb: int
    gpu_type: str | None
    gpu_memory_gb: int | None
    gpu_count: int
    is_gpu: bool
    requires_gke: bool
    storage_gb: int  # Fixed storage per tier, enforced via XFS quotas
    bandwidth_mbps: int | None  # Network bandwidth allocation in Mbps
    hourly_rate_cents: int
    is_available: bool
    requires_subscription: str | None
    region_availability: list[str]


class HardwareSpecsProvider:
    """Provider for hardware specifications with caching.

    Fetches hardware specs from the API database and caches them to minimize
    network calls. The cache is refreshed periodically or on-demand.
    """

    def __init__(
        self,
        api_base_url: str | None = None,
        service_token: str | None = None,
        cache_ttl: int = CACHE_TTL_SECONDS,
    ) -> None:
        """Initialize the hardware specs provider.

        Args:
            api_base_url: Base URL for the API service
            service_token: Service-to-service auth token
            cache_ttl: Cache time-to-live in seconds
        """
        self._api_base_url = api_base_url or settings.api_base_url
        self._service_token = service_token or settings.internal_service_token
        self._cache_ttl = cache_ttl

        # Cache storage
        self._specs_cache: dict[str, HardwareSpec] = {}
        self._cache_timestamp: datetime | None = None
        self._lock = asyncio.Lock()

        # Fallback specs for when API is unavailable
        self._fallback_specs = self._get_fallback_specs()

    def _get_fallback_specs(self) -> dict[str, HardwareSpec]:
        """Get fallback specs for when API is unavailable.

        These are minimal defaults that allow the service to function
        even if the API is temporarily unreachable. Includes both ARM and x86.
        """
        # Each tuple: tier, name, arch, vcpu, memory, storage, bw, rate
        defaults = [
            # ARM tiers (best value)
            ("starter_arm", "Starter (ARM)", "arm64", 2, 4096, 20, 100, 2),
            ("pro_arm", "Pro (ARM)", "arm64", 4, 8192, 50, 250, 3),
            ("power_arm", "Power (ARM)", "arm64", 8, 16384, 100, 500, 5),
            ("enterprise_arm", "Enterprise (ARM)", "arm64", 16, 32768, 200, 1000, 8),
            # x86 tiers
            ("starter", "Starter (x86)", "x86_64", 2, 4096, 20, 100, 3),
            ("pro", "Pro (x86)", "x86_64", 4, 8192, 50, 250, 6),
            ("power", "Power (x86)", "x86_64", 8, 16384, 100, 500, 10),
            ("enterprise", "Enterprise (x86)", "x86_64", 16, 32768, 200, 1000, 15),
            # GPU tiers
            ("gpu_starter", "GPU Starter", "x86_64", 8, 65536, 100, 500, 40),
            ("gpu_pro", "GPU Pro", "x86_64", 24, 262144, 500, 1000, 180),
        ]

        specs = {}
        for tier, name, arch, vcpu, memory, storage, bandwidth, rate in defaults:
            specs[tier] = HardwareSpec(
                id=f"fallback-{tier}",
                tier=tier,
                display_name=name,
                description=f"Fallback {name} tier",
                architecture=arch,
                vcpu=vcpu,
                memory_mb=memory,
                gpu_type=None,
                gpu_memory_gb=None,
                gpu_count=0,
                is_gpu=tier.startswith("gpu_"),
                requires_gke=False,
                storage_gb=storage,
                bandwidth_mbps=bandwidth,
                hourly_rate_cents=rate,
                is_available=True,
                requires_subscription=None,
                region_availability=[],
            )

        return specs

    async def get_all_specs(self, *, force_refresh: bool = False) -> dict[str, HardwareSpec]:
        """Get all hardware specifications.

        Args:
            force_refresh: If True, bypass cache and fetch from API

        Returns:
            Dict mapping tier names to HardwareSpec objects
        """
        async with self._lock:
            # Check if cache is valid
            if not force_refresh and self._is_cache_valid():
                return self._specs_cache.copy()

            # Fetch from API
            specs = await self._fetch_specs()
            if specs:
                self._specs_cache = specs
                self._cache_timestamp = datetime.now(UTC)
                return specs.copy()

            # Return cached data if available (even if stale)
            if self._specs_cache:
                logger.warning("Using stale hardware specs cache")
                return self._specs_cache.copy()

            # Return fallback specs
            logger.warning("Using fallback hardware specs")
            return self._fallback_specs.copy()

    async def get_spec(self, tier: str, *, force_refresh: bool = False) -> HardwareSpec | None:
        """Get hardware specification for a specific tier.

        Args:
            tier: Tier name (e.g., "starter", "pro")
            force_refresh: If True, bypass cache and fetch from API

        Returns:
            HardwareSpec if found, None otherwise
        """
        specs = await self.get_all_specs(force_refresh=force_refresh)
        return specs.get(tier)

    def _is_cache_valid(self) -> bool:
        """Check if the cache is still valid."""
        if not self._cache_timestamp or not self._specs_cache:
            return False

        age = (datetime.now(UTC) - self._cache_timestamp).total_seconds()
        return age < self._cache_ttl

    async def _fetch_specs(self) -> dict[str, HardwareSpec] | None:
        """Fetch hardware specs from the API.

        Returns:
            Dict of specs if successful, None on error
        """
        try:
            headers = {}
            if self._service_token:
                headers["Authorization"] = f"Bearer {self._service_token}"

            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(
                    f"{self._api_base_url}/api/billing/hardware-specs",
                    headers=headers,
                )

                if response.status_code != 200:
                    logger.error(
                        "Failed to fetch hardware specs",
                        status_code=response.status_code,
                        response=response.text[:200],
                    )
                    return None

                data = response.json()
                return self._parse_specs(data)

        except httpx.RequestError as e:
            logger.error("Request error fetching hardware specs", error=str(e))
            return None
        except Exception:
            logger.exception("Unexpected error fetching hardware specs")
            return None

    def _parse_specs(self, data: list[dict[str, Any]]) -> dict[str, HardwareSpec]:
        """Parse API response into HardwareSpec objects."""
        specs = {}

        for item in data:
            try:
                spec = HardwareSpec(
                    id=item["id"],
                    tier=item["tier"],
                    display_name=item["display_name"],
                    description=item.get("description"),
                    architecture=item.get("architecture", "x86_64"),
                    vcpu=item["vcpu"],
                    memory_mb=item["memory_mb"],
                    gpu_type=item.get("gpu_type"),
                    gpu_memory_gb=item.get("gpu_memory_gb"),
                    gpu_count=item.get("gpu_count", 0),
                    is_gpu=item.get("is_gpu", False),
                    requires_gke=item.get("requires_gke", False),
                    storage_gb=item.get("storage_gb", 20),
                    bandwidth_mbps=item.get("bandwidth_mbps"),  # Network bandwidth in Mbps
                    # API returns hourly_rate in dollars, convert to cents
                    hourly_rate_cents=int(item.get("hourly_rate", 0) * 100),
                    is_available=item.get("is_available", True),
                    requires_subscription=item.get("requires_subscription"),
                    region_availability=item.get("region_availability", []),
                )
                specs[spec.tier] = spec

            except KeyError as e:
                logger.warning(
                    "Missing field in hardware spec", field=str(e), tier=item.get("tier")
                )
                continue

        return specs

    async def refresh_cache(self) -> bool:
        """Force refresh the cache.

        Returns:
            True if refresh was successful, False otherwise
        """
        specs = await self._fetch_specs()
        if specs:
            async with self._lock:
                self._specs_cache = specs
                self._cache_timestamp = datetime.now(UTC)
            return True
        return False


# Global instance
_provider: HardwareSpecsProvider | None = None


def get_hardware_specs_provider() -> HardwareSpecsProvider:
    """Get the global hardware specs provider instance."""
    global _provider
    if _provider is None:
        _provider = HardwareSpecsProvider()
    return _provider


def init_hardware_specs_provider(
    api_base_url: str | None = None,
    service_token: str | None = None,
    cache_ttl: int = CACHE_TTL_SECONDS,
) -> HardwareSpecsProvider:
    """Initialize the global hardware specs provider.

    Args:
        api_base_url: Base URL for the API service
        service_token: Service-to-service auth token
        cache_ttl: Cache time-to-live in seconds

    Returns:
        The initialized provider
    """
    global _provider
    _provider = HardwareSpecsProvider(
        api_base_url=api_base_url,
        service_token=service_token,
        cache_ttl=cache_ttl,
    )
    return _provider
