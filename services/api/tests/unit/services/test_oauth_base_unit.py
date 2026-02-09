"""Unit tests for OAuth base (PKCE, state, is_token_expired, dataclasses)."""

from __future__ import annotations

import base64
import hashlib
from unittest.mock import patch

import pytest

from src.services.oauth.base import (
    OAuthCredentials,
    OAuthState,
    OAuthProvider,
    generate_pkce,
    generate_state,
)


def test_generate_pkce_returns_two_strings() -> None:
    verifier, challenge = generate_pkce()
    assert isinstance(verifier, str) and isinstance(challenge, str)
    assert 43 <= len(verifier) <= 128
    assert len(challenge) >= 32


def test_generate_pkce_challenge_is_base64url_of_sha256_verifier() -> None:
    verifier, challenge = generate_pkce()
    expected = (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest())
        .decode()
        .rstrip("=")
    )
    assert challenge == expected


def test_generate_pkce_challenge_has_no_padding() -> None:
    _, challenge = generate_pkce()
    assert "=" not in challenge


def test_generate_state_returns_string() -> None:
    s = generate_state()
    assert isinstance(s, str)
    assert len(s) >= 32


def test_oauth_credentials_dataclass() -> None:
    c = OAuthCredentials(
        access_token="at",
        refresh_token="rt",
        expires_at=12345,
        scopes="read",
        token_type="Bearer",
    )
    assert c.access_token == "at"
    assert c.refresh_token == "rt"
    assert c.expires_at == 12345
    assert c.scopes == "read"
    assert c.token_type == "Bearer"


def test_oauth_state_dataclass() -> None:
    s = OAuthState(state="s", code_verifier="cv", redirect_uri="https://x/cb", provider="google")
    assert s.state == "s"
    assert s.code_verifier == "cv"
    assert s.redirect_uri == "https://x/cb"
    assert s.provider == "google"


def test_is_token_expired_when_past_expiry() -> None:
    """Concrete provider stub to test is_token_expired."""

    class StubProvider(OAuthProvider):
        provider_id = "stub"
        display_name = "Stub"

        async def get_auth_url(self, state: str, code_challenge: str, redirect_uri: str) -> str:
            return ""

        async def exchange_code(
            self, code: str, code_verifier: str, redirect_uri: str
        ) -> OAuthCredentials:
            return OAuthCredentials("", None, 0)

        async def refresh_token(self, refresh_token: str) -> OAuthCredentials:
            return OAuthCredentials("", None, 0)

        async def revoke_token(self, access_token: str) -> bool:
            return True

        async def get_user_info(self, access_token: str) -> dict:
            return {}

    provider = StubProvider()
    # expires_at in the past
    with patch("src.services.oauth.base.time.time", return_value=2000):
        assert provider.is_token_expired(1000) is True
        assert provider.is_token_expired(1999) is True


def test_is_token_expired_when_within_buffer() -> None:
    class StubProvider(OAuthProvider):
        provider_id = "stub"
        display_name = "Stub"

        async def get_auth_url(self, state: str, code_challenge: str, redirect_uri: str) -> str:
            return ""

        async def exchange_code(
            self, code: str, code_verifier: str, redirect_uri: str
        ) -> OAuthCredentials:
            return OAuthCredentials("", None, 0)

        async def refresh_token(self, refresh_token: str) -> OAuthCredentials:
            return OAuthCredentials("", None, 0)

        async def revoke_token(self, access_token: str) -> bool:
            return True

        async def get_user_info(self, access_token: str) -> dict:
            return {}

    provider = StubProvider()
    # buffer_seconds=300: expires_at=2500, now=2000 -> 500s left -> not expired
    with patch("src.services.oauth.base.time.time", return_value=2000):
        assert provider.is_token_expired(2500, buffer_seconds=300) is False
    # expires_at=2299, now=2000 -> 299s left, within 300s buffer -> expired
    with patch("src.services.oauth.base.time.time", return_value=2000):
        assert provider.is_token_expired(2299, buffer_seconds=300) is True
