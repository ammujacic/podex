"""Tests for cloudflared bundle resolution."""

from __future__ import annotations

from pathlib import Path

import platform
import pytest

from podex_local_pod import cloudflared_bundle


class TestGetCloudflaredPath:
    """Tests for get_cloudflared_path resolution order and error cases."""

    def test_uses_path_when_available(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """If cloudflared is on PATH, that path is returned and nothing else is touched."""
        monkeypatch.setattr(cloudflared_bundle.shutil, "which", lambda _: "/usr/bin/cloudflared")

        # Make sure bundled bin would look missing to prove PATH wins
        monkeypatch.setattr(
            cloudflared_bundle, "_BUNDLE_BIN", Path("/nonexistent/bundled/cloudflared")
        )

        path = cloudflared_bundle.get_cloudflared_path()
        assert path == "/usr/bin/cloudflared"

    def test_uses_bundled_bin_when_present(self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
        """If bundled binary exists, it is returned."""
        bundled = tmp_path / "cloudflared"
        bundled.write_text("dummy")

        monkeypatch.setattr(cloudflared_bundle.shutil, "which", lambda _: None)
        monkeypatch.setattr(cloudflared_bundle, "_BUNDLE_BIN", bundled)

        path = cloudflared_bundle.get_cloudflared_path()
        assert path == str(bundled)

    def test_raises_when_no_asset_for_platform(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """If no asset name can be determined, raises RuntimeError with guidance."""
        monkeypatch.setattr(cloudflared_bundle.shutil, "which", lambda _: None)
        # Force _BUNDLE_BIN to look missing
        monkeypatch.setattr(
            cloudflared_bundle, "_BUNDLE_BIN", Path("/nonexistent/bundled/cloudflared")
        )
        monkeypatch.setattr(cloudflared_bundle, "_asset_name", lambda: None)

        with pytest.raises(RuntimeError) as exc:
            cloudflared_bundle.get_cloudflared_path()

        msg = str(exc.value)
        assert "cloudflared not on PATH" in msg
        assert "Install it:" in msg

    def test_downloads_non_tgz_asset(self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
        """For non-tgz assets, downloads directly to bundled bin and marks executable."""
        bundled = tmp_path / "cloudflared-linux-amd64"

        monkeypatch.setattr(cloudflared_bundle.shutil, "which", lambda _: None)
        monkeypatch.setattr(cloudflared_bundle, "_BUNDLE_BIN", bundled)
        monkeypatch.setattr(cloudflared_bundle, "_asset_name", lambda: "cloudflared-linux-amd64")

        calls: dict[str, str] = {}

        def fake_download(url: str, dest: Path) -> None:
            calls["url"] = url
            calls["dest"] = str(dest)
            dest.write_text("binary")

        monkeypatch.setattr(cloudflared_bundle, "_download", fake_download)
        monkeypatch.setattr(cloudflared_bundle, "_extract_tgz", lambda *_, **__: None)

        # chmod will fail on non-existent file unless we create it in fake_download
        monkeypatch.setattr(
            cloudflared_bundle.stat,
            "S_IXUSR",
            0o100,
        )

        path = cloudflared_bundle.get_cloudflared_path()
        assert path == str(bundled)
        assert calls["url"].endswith("/cloudflared-linux-amd64")
        assert calls["dest"] == str(bundled)

    def test_downloads_and_extracts_tgz_asset(self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
        """For tgz assets, downloads archive and calls _extract_tgz."""
        bundled = tmp_path / "cloudflared"
        tgz = tmp_path / "cloudflared.tgz"

        monkeypatch.setattr(cloudflared_bundle.shutil, "which", lambda _: None)
        monkeypatch.setattr(cloudflared_bundle, "_BUNDLE_BIN", bundled)
        monkeypatch.setattr(cloudflared_bundle, "_BUNDLE_DIR", tmp_path)
        monkeypatch.setattr(cloudflared_bundle, "_asset_name", lambda: "cloudflared-darwin-arm64.tgz")

        calls: dict[str, str] = {}

        def fake_download(url: str, dest: Path) -> None:
            calls["url"] = url
            calls["dest"] = str(dest)
            dest.write_text("tgz-data")

        def fake_extract(src: Path, dest_bin: Path) -> None:
            calls["extract_src"] = str(src)
            calls["extract_dest"] = str(dest_bin)
            dest_bin.write_text("binary")

        monkeypatch.setattr(cloudflared_bundle, "_download", fake_download)
        monkeypatch.setattr(cloudflared_bundle, "_extract_tgz", fake_extract)

        path = cloudflared_bundle.get_cloudflared_path()
        assert path == str(bundled)
        assert calls["url"].endswith("/cloudflared-darwin-arm64.tgz")
        assert Path(calls["dest"]) == tgz
        assert Path(calls["extract_src"]) == tgz
        assert Path(calls["extract_dest"]) == bundled
