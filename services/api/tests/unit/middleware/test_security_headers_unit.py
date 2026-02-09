"""Unit tests for security headers middleware helpers."""

from __future__ import annotations

import pytest

from src.middleware import security_headers as sh


def test_build_csp_directives_production(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(sh.settings, "ENVIRONMENT", "production")
    monkeypatch.setattr(sh.settings, "CORS_ORIGINS_RAW", '["https://app.example.com"]')

    csp = sh._build_csp_directives()

    assert "default-src 'self'" in csp
    assert "script-src 'self'" in csp
    assert "frame-ancestors 'none'" in csp
    assert "connect-src" in csp
    assert "https://app.example.com" in csp
    assert "upgrade-insecure-requests" in csp


def test_build_csp_directives_development(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(sh.settings, "ENVIRONMENT", "development")
    monkeypatch.setattr(sh.settings, "CORS_ORIGINS_RAW", "[]")

    csp = sh._build_csp_directives()

    assert "default-src 'self'" in csp
    assert "unsafe-inline" in csp or "unsafe-eval" in csp  # dev allows for docs
    assert "upgrade-insecure-requests" not in csp


def test_build_csp_directives_empty_filtered(monkeypatch: pytest.MonkeyPatch) -> None:
    """Empty string directives are filtered out."""
    monkeypatch.setattr(sh.settings, "ENVIRONMENT", "development")
    monkeypatch.setattr(sh.settings, "CORS_ORIGINS_RAW", '["https://localhost:3000"]')

    csp = sh._build_csp_directives()

    assert ";;" not in csp
