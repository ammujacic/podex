"""Unit tests for GeoIPService and helpers."""

from __future__ import annotations

from typing import Any

import pytest

from src.services import geolocation as geo


def test_is_private_ip_recognizes_common_ranges() -> None:
    service = geo.GeoIPService()
    assert service._is_private_ip("10.0.0.1")
    assert service._is_private_ip("192.168.1.5")
    assert service._is_private_ip("127.0.0.1")
    assert not service._is_private_ip("8.8.8.8")


def test_lookup_returns_none_for_private_ip(monkeypatch: pytest.MonkeyPatch) -> None:
    service = geo.GeoIPService()
    # Ensure we don't touch filesystem/reader for this test
    monkeypatch.setattr(service, "_ensure_initialized", lambda: True)
    assert service.lookup("10.0.0.1") is None


def test_lookup_returns_none_when_not_initialized(monkeypatch: pytest.MonkeyPatch) -> None:
    service = geo.GeoIPService()
    monkeypatch.setattr(service, "_ensure_initialized", lambda: False)
    assert service.lookup("8.8.8.8") is None


def test_lookup_ip_location_uses_service(monkeypatch: pytest.MonkeyPatch) -> None:
    class FakeService:
        def lookup(self, ip: str | None) -> geo.GeoLocation | None:  # noqa: ARG002
            return geo.GeoLocation(city="X", country="Y", country_code="Z")

    monkeypatch.setattr(geo, "get_geoip_service", lambda: FakeService())
    city, country, code = geo.lookup_ip_location("1.2.3.4")
    assert (city, country, code) == ("X", "Y", "Z")
