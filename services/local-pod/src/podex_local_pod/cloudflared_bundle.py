"""Resolve or bundle cloudflared for tunnel operations.

When running in Docker, cloudflared is installed in the image. When running
natively, we check PATH first, then ~/.local/share/podex-local-pod/cloudflared;
if missing, we download it from GitHub releases (plan: "Bundled in podex-local-pod process").
"""

from __future__ import annotations

import platform
import shutil
import stat
import sys
from pathlib import Path

import structlog

logger = structlog.get_logger()

_CLOUDFLARED_BASE = "https://github.com/cloudflare/cloudflared/releases/latest/download"
_BUNDLE_DIR = Path.home() / ".local" / "share" / "podex-local-pod"
_BUNDLE_BIN = _BUNDLE_DIR / ("cloudflared.exe" if sys.platform == "win32" else "cloudflared")


def _asset_name() -> str | None:
    machine = platform.machine().lower()
    if sys.platform == "darwin":
        if machine in ("x86_64", "amd64"):
            return "cloudflared-darwin-amd64.tgz"
        if machine in ("arm64", "aarch64"):
            return "cloudflared-darwin-arm64.tgz"
        return None
    if sys.platform == "linux":
        if machine in ("x86_64", "amd64"):
            return "cloudflared-linux-amd64"
        if machine in ("arm64", "aarch64"):
            return "cloudflared-linux-arm64"
        return None
    return None


def _download(url: str, dest: Path) -> None:
    import urllib.request

    _BUNDLE_DIR.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".tmp")
    try:
        with urllib.request.urlopen(url, timeout=60) as r:
            data = r.read()
        tmp.write_bytes(data)
        tmp.rename(dest)
        logger.info("Downloaded cloudflared", path=str(dest))
    except Exception as e:
        if tmp.exists():
            tmp.unlink(missing_ok=True)
        raise RuntimeError(f"Failed to download cloudflared: {e}") from e


def _extract_tgz(tgz_path: Path, dest: Path) -> None:
    import tarfile

    with tarfile.open(tgz_path, "r:gz") as tf:
        found = None
        for m in tf.getmembers():
            if m.type != tarfile.REGTYPE:
                continue
            base = Path(m.name).name
            if base == "cloudflared":
                found = m
                break
        if not found:
            raise RuntimeError("cloudflared binary not found in tgz")
        found.name = dest.name
        tf.extract(found, dest.parent)
    tgz_path.unlink(missing_ok=True)
    dest.chmod(dest.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


def get_cloudflared_path() -> str:
    """Return path to cloudflared binary, using PATH, bundled cache, or download."""
    exe = shutil.which("cloudflared")
    if exe:
        return exe

    if _BUNDLE_BIN.exists():
        return str(_BUNDLE_BIN)

    asset = _asset_name()
    if not asset:
        raise RuntimeError(
            f"cloudflared not on PATH and no bundle for {sys.platform}/{platform.machine()}. "
            "Install it: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation"
        )

    url = f"{_CLOUDFLARED_BASE}/{asset}"
    if asset.endswith(".tgz"):
        tgz = _BUNDLE_DIR / "cloudflared.tgz"
        _download(url, tgz)
        _extract_tgz(tgz, _BUNDLE_BIN)
    else:
        _download(url, _BUNDLE_BIN)
        _BUNDLE_BIN.chmod(_BUNDLE_BIN.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)

    return str(_BUNDLE_BIN)
