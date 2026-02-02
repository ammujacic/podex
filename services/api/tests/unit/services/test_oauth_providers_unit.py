"""Unit tests for OAuth providers (get_auth_url URL building)."""

from __future__ import annotations

import pytest

from src.services.oauth.anthropic import AnthropicOAuthProvider, ANTHROPIC_AUTHORIZE_URL
from src.services.oauth.google import GoogleOAuthProvider, GOOGLE_AUTHORIZE_URL


@pytest.mark.asyncio
async def test_anthropic_get_auth_url_builds_correct_url() -> None:
    provider = AnthropicOAuthProvider()
    url = await provider.get_auth_url(
        state="my-state",
        code_challenge="my-challenge",
        redirect_uri="https://ignored/callback",
    )
    assert url.startswith(ANTHROPIC_AUTHORIZE_URL + "?")
    assert "state=my-state" in url or "state=my%2Dstate" in url
    assert "code_challenge=my-challenge" in url or "code_challenge=my%2Dchallenge" in url
    assert "code_challenge_method=S256" in url
    assert "response_type=code" in url


@pytest.mark.asyncio
async def test_google_get_auth_url_builds_correct_url_when_configured() -> None:
    import os
    from unittest.mock import patch

    with patch.dict(os.environ, {"GOOGLE_OAUTH_CLIENT_ID": "cid", "GOOGLE_OAUTH_CLIENT_SECRET": "secret"}):
        provider = GoogleOAuthProvider()
    url = await provider.get_auth_url(
        state="s1",
        code_challenge="cc1",
        redirect_uri="https://app/callback",
    )
    assert url.startswith(GOOGLE_AUTHORIZE_URL + "?")
    assert "client_id=cid" in url
    assert "redirect_uri=" in url
    assert "code_challenge=cc1" in url or "code_challenge=cc%31" in url
    assert "code_challenge_method=S256" in url
    assert "state=s1" in url
