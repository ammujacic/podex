"""Unit tests for CSRF middleware origin check."""

from __future__ import annotations

import pytest

from src.middleware import csrf as csrf_mw


def test_is_allowed_origin_exact_match(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(csrf_mw.settings, "CORS_ORIGINS_RAW", '["https://app.example.com"]')
    monkeypatch.setattr(csrf_mw.settings, "ENVIRONMENT", "production")

    assert csrf_mw._is_allowed_origin("https://app.example.com") is True
    assert csrf_mw._is_allowed_origin("https://app.example.com/") is True


def test_is_allowed_origin_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(csrf_mw.settings, "CORS_ORIGINS_RAW", '["https://app.example.com"]')
    monkeypatch.setattr(csrf_mw.settings, "ENVIRONMENT", "production")

    assert csrf_mw._is_allowed_origin("https://evil.com") is False
    assert csrf_mw._is_allowed_origin("https://app.example.com.evil.com") is False


def test_is_allowed_origin_wildcard_production(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(csrf_mw.settings, "CORS_ORIGINS_RAW", '["*"]')
    monkeypatch.setattr(csrf_mw.settings, "ENVIRONMENT", "production")

    assert csrf_mw._is_allowed_origin("https://any.com") is False


def test_is_allowed_origin_wildcard_development(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(csrf_mw.settings, "CORS_ORIGINS_RAW", '["*"]')
    monkeypatch.setattr(csrf_mw.settings, "ENVIRONMENT", "development")

    assert csrf_mw._is_allowed_origin("https://localhost:3000") is True
