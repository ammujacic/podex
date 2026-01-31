"""User configuration management for Podex CLI.

Handles persistent storage of user settings like pod tokens.
Config is stored in:
- Linux/macOS: ~/.config/podex/config.json
- Windows: %APPDATA%/podex/config.json
"""

import json
import os
import platform
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


def get_config_dir() -> Path:
    """Get the platform-appropriate config directory.

    Returns:
        Path to the config directory.
    """
    system = platform.system().lower()

    if system == "windows":
        # Windows: Use APPDATA
        base = os.environ.get("APPDATA")
        if base:
            return Path(base) / "podex"
        # Fallback to user home
        return Path.home() / ".podex"

    elif system == "darwin":
        # macOS: Use ~/.config/podex (XDG-style) or ~/Library/Application Support
        # We prefer XDG for consistency with Linux
        xdg_config = os.environ.get("XDG_CONFIG_HOME")
        if xdg_config:
            return Path(xdg_config) / "podex"
        return Path.home() / ".config" / "podex"

    else:
        # Linux and others: Use XDG_CONFIG_HOME or ~/.config
        xdg_config = os.environ.get("XDG_CONFIG_HOME")
        if xdg_config:
            return Path(xdg_config) / "podex"
        return Path.home() / ".config" / "podex"


def get_config_file() -> Path:
    """Get the path to the config file.

    Returns:
        Path to config.json
    """
    return get_config_dir() / "config.json"


@dataclass
class UserConfig:
    """User configuration for Podex CLI."""

    # Pod token for authentication
    pod_token: str | None = None

    # Cloud URL (optional override)
    cloud_url: str | None = None

    # Pod name (optional override)
    pod_name: str | None = None

    # Additional settings can be added here
    extra: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Convert config to dictionary for JSON serialization."""
        data: dict[str, Any] = {}
        if self.pod_token:
            data["pod_token"] = self.pod_token
        if self.cloud_url:
            data["cloud_url"] = self.cloud_url
        if self.pod_name:
            data["pod_name"] = self.pod_name
        if self.extra:
            data["extra"] = self.extra
        return data

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "UserConfig":
        """Create config from dictionary."""
        return cls(
            pod_token=data.get("pod_token"),
            cloud_url=data.get("cloud_url"),
            pod_name=data.get("pod_name"),
            extra=data.get("extra", {}),
        )


def load_user_config() -> UserConfig:
    """Load user config from disk.

    Returns:
        UserConfig instance (empty if file doesn't exist).
    """
    config_file = get_config_file()

    if not config_file.exists():
        return UserConfig()

    try:
        with open(config_file) as f:
            data = json.load(f)
        return UserConfig.from_dict(data)
    except (json.JSONDecodeError, OSError):
        # Return empty config on error
        return UserConfig()


def save_user_config(config: UserConfig) -> None:
    """Save user config to disk.

    Args:
        config: UserConfig instance to save.
    """
    config_dir = get_config_dir()
    config_file = get_config_file()

    # Create directory if needed
    config_dir.mkdir(parents=True, exist_ok=True)

    # Write config with restricted permissions
    with open(config_file, "w") as f:
        json.dump(config.to_dict(), f, indent=2)

    # Set file permissions to owner-only on Unix
    if platform.system().lower() != "windows":
        os.chmod(config_file, 0o600)


def clear_user_config() -> bool:
    """Clear user config file.

    Returns:
        True if file was deleted, False if it didn't exist.
    """
    config_file = get_config_file()

    if config_file.exists():
        config_file.unlink()
        return True
    return False


def mask_token(token: str | None) -> str:
    """Mask a token for display, showing only prefix.

    Args:
        token: The full token.

    Returns:
        Masked token string.
    """
    if not token:
        return "(not set)"

    if token.startswith("pdx_pod_"):
        # Show prefix: pdx_pod_XXXXXXXX...
        prefix = token[:16]  # "pdx_pod_" + 8 chars
        return f"{prefix}..."

    # Generic masking
    if len(token) > 8:
        return f"{token[:8]}..."
    return "***"
