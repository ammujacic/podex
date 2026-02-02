"""Unit tests for password validation and strength helpers."""

from __future__ import annotations

import pytest

from src.utils import password_validator as pv


def test_validate_password_length_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(pv.settings, "PASSWORD_MIN_LENGTH", 8)
    monkeypatch.setattr(pv.settings, "PASSWORD_MAX_LENGTH", 128)
    monkeypatch.setattr(pv.settings, "PASSWORD_REQUIRE_COMPLEXITY", False)
    monkeypatch.setattr(pv.settings, "PASSWORD_CHECK_COMMON", False)

    r = pv.validate_password("short")
    assert not r.is_valid
    assert any("at least" in e for e in r.errors)

    r2 = pv.validate_password("x" * 200)
    assert not r2.is_valid
    assert any("no more" in e for e in r2.errors)


def test_validate_password_complexity_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(pv.settings, "PASSWORD_MIN_LENGTH", 6)
    monkeypatch.setattr(pv.settings, "PASSWORD_MAX_LENGTH", 128)
    monkeypatch.setattr(pv.settings, "PASSWORD_REQUIRE_COMPLEXITY", True)
    monkeypatch.setattr(pv.settings, "PASSWORD_CHECK_COMMON", False)

    r = pv.validate_password("alllowercase1!")
    assert not r.is_valid
    assert any("uppercase" in e for e in r.errors)

    r2 = pv.validate_password("NoDigitOrSpecial!")
    assert not r2.is_valid


def test_validate_password_common_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(pv.settings, "PASSWORD_MIN_LENGTH", 6)
    monkeypatch.setattr(pv.settings, "PASSWORD_MAX_LENGTH", 128)
    monkeypatch.setattr(pv.settings, "PASSWORD_REQUIRE_COMPLEXITY", False)
    monkeypatch.setattr(pv.settings, "PASSWORD_CHECK_COMMON", True)

    r = pv.validate_password("password")
    assert not r.is_valid
    assert any("common" in e for e in r.errors)


def test_validate_password_valid(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(pv.settings, "PASSWORD_MIN_LENGTH", 8)
    monkeypatch.setattr(pv.settings, "PASSWORD_MAX_LENGTH", 128)
    monkeypatch.setattr(pv.settings, "PASSWORD_REQUIRE_COMPLEXITY", True)
    monkeypatch.setattr(pv.settings, "PASSWORD_CHECK_COMMON", False)

    r = pv.validate_password("SecureP@ss1")
    assert r.is_valid
    assert r.errors == []


def test_is_common_password() -> None:
    assert pv._is_common_password("password") is True
    assert pv._is_common_password("Password") is True
    assert pv._is_common_password("UncommonXyZ99!") is False


def test_get_password_strength() -> None:
    assert pv.get_password_strength("123456") in ("weak", "fair")
    assert pv.get_password_strength("SecureP@ssw0rdLong") in ("good", "strong", "very_strong")


def test_score_to_rating() -> None:
    assert pv._score_to_rating(0) == "weak"
    assert pv._score_to_rating(2) == "weak"
    assert pv._score_to_rating(4) == "fair"
    assert pv._score_to_rating(6) == "good"
    assert pv._score_to_rating(8) == "strong"
    assert pv._score_to_rating(10) == "very_strong"


def test_count_sequential_patterns() -> None:
    assert pv._count_sequential_patterns("abc") >= 1
    assert pv._count_sequential_patterns("123") >= 1
    # No sequential run: "xYz" lowercased is "xyz" (alpha seq), so use something without abc/123
    assert pv._count_sequential_patterns("xQ7#mK") == 0
