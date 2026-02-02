"""Unit tests for tunnel_manager pure helpers (hostname/URL builders)."""

from __future__ import annotations

from unittest.mock import patch

import pytest

from src.services import tunnel_manager as tm


@patch.object(tm, "TUNNEL_DOMAIN", "tunnels.example.com")
def test_hostname() -> None:
    assert tm._hostname("ws-123", 3000) == "ws-123-p3000.tunnels.example.com"
    assert tm._hostname("abc", 80) == "abc-p80.tunnels.example.com"


@patch.object(tm, "TUNNEL_DOMAIN", "tunnels.example.com")
def test_public_url() -> None:
    assert tm._public_url("ws-123", 3000) == "https://ws-123-p3000.tunnels.example.com"
    assert tm._public_url("abc", 443) == "https://abc-p443.tunnels.example.com"


@patch.object(tm, "TUNNEL_DOMAIN", "tunnels.example.com")
def test_ssh_hostname() -> None:
    assert tm._ssh_hostname("ws-456") == "ws-456-ssh.tunnels.example.com"


@patch.object(tm, "TUNNEL_DOMAIN", "tunnels.example.com")
def test_ssh_public_url() -> None:
    assert tm._ssh_public_url("ws-456") == "ws-456-ssh.tunnels.example.com"


def test_ssh_port_constant() -> None:
    assert tm.SSH_PORT == 22
