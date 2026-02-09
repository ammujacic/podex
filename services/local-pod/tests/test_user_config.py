"""Tests for user configuration utilities in podex_local_pod.user_config."""

from __future__ import annotations

import os
from pathlib import Path

import platform
import pytest

from podex_local_pod import user_config


class TestConfigPaths:
    """Tests for get_config_dir and get_config_file."""

    def test_get_config_dir_windows_uses_appdata(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(platform, "system", lambda: "Windows")
        monkeypatch.setenv("APPDATA", "C:\\AppData")

        cfg_dir = user_config.get_config_dir()
        # Use joinpath-style comparison to avoid separator differences
        assert cfg_dir == Path("C:\\AppData") / "podex"

    def test_get_config_dir_darwin_prefers_xdg(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(platform, "system", lambda: "Darwin")
        monkeypatch.setenv("XDG_CONFIG_HOME", "/tmp/xdg")

        cfg_dir = user_config.get_config_dir()
        assert cfg_dir == Path("/tmp/xdg/podex")

    def test_get_config_dir_linux_defaults_to_dot_config(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(platform, "system", lambda: "Linux")
        monkeypatch.delenv("XDG_CONFIG_HOME", raising=False)

        cfg_dir = user_config.get_config_dir()
        assert cfg_dir == Path.home() / ".config" / "podex"

    def test_get_config_file_appends_config_json(self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
        # Force config dir to our temp directory
        monkeypatch.setattr(user_config, "get_config_dir", lambda: tmp_path / "cfg")
        cfg_file = user_config.get_config_file()
        assert cfg_file == tmp_path / "cfg" / "config.json"


class TestUserConfigLoadSave:
    """Tests for loading and saving UserConfig."""

    def test_load_returns_empty_when_missing(self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
        monkeypatch.setattr(user_config, "get_config_dir", lambda: tmp_path / "cfg")
        cfg = user_config.load_user_config()
        assert cfg.pod_token is None
        assert cfg.cloud_url is None
        assert cfg.pod_name is None

    def test_save_and_load_roundtrip(self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
        monkeypatch.setattr(user_config, "get_config_dir", lambda: tmp_path / "cfg")

        cfg = user_config.UserConfig(
            pod_token="pdx_pod_12345678abcdef",
            cloud_url="https://cloud.podex.dev",
            pod_name="local-test",
            extra={"foo": "bar"},
        )

        user_config.save_user_config(cfg)

        loaded = user_config.load_user_config()
        assert loaded.pod_token == cfg.pod_token
        assert loaded.cloud_url == cfg.cloud_url
        assert loaded.pod_name == cfg.pod_name
        assert loaded.extra == {"foo": "bar"}

        # Config file should exist on disk
        cfg_file = user_config.get_config_file()
        assert cfg_file.exists()

    def test_clear_user_config_deletes_file(self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
        monkeypatch.setattr(user_config, "get_config_dir", lambda: tmp_path / "cfg")

        cfg = user_config.UserConfig(pod_token="token")
        user_config.save_user_config(cfg)
        cfg_file = user_config.get_config_file()
        assert cfg_file.exists()

        deleted = user_config.clear_user_config()
        assert deleted is True
        assert not cfg_file.exists()

        # Second call should return False (already gone)
        assert user_config.clear_user_config() is False


class TestMaskToken:
    """Tests for mask_token utility."""

    def test_mask_token_not_set(self) -> None:
        assert user_config.mask_token(None) == "(not set)"
        assert user_config.mask_token("") == "(not set)"

    def test_mask_token_pod_prefix(self) -> None:
        token = "pdx_pod_12345678abcdef"
        masked = user_config.mask_token(token)
        assert masked.startswith("pdx_pod_")
        assert masked.endswith("...")
        # Should reveal only prefix of full token
        assert masked.startswith(token[:16])

    def test_mask_token_generic_long(self) -> None:
        token = "abcdefgh12345678"
        masked = user_config.mask_token(token)
        assert masked.startswith("abcdefgh")
        assert masked.endswith("...")

    def test_mask_token_short(self) -> None:
        token = "short"
        masked = user_config.mask_token(token)
        assert masked == "***"
