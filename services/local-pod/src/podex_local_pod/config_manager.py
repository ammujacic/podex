"""Configuration file manager for Podex Local Pod.

Handles reading, writing, and validating the local pod configuration file.
Default location: ~/.config/podex/local-pod.toml
"""

import tomllib
from pathlib import Path
from typing import Any

import structlog

logger = structlog.get_logger()

DEFAULT_CONFIG_DIR = Path.home() / ".config" / "podex"
DEFAULT_CONFIG_FILE = DEFAULT_CONFIG_DIR / "local-pod.toml"


class ConfigManager:
    """Manages the local pod configuration file."""

    def __init__(self, config_path: Path | None = None) -> None:
        """Initialize the config manager.

        Args:
            config_path: Custom config file path. Uses default if not provided.
        """
        self.config_path = config_path or DEFAULT_CONFIG_FILE

    def exists(self) -> bool:
        """Check if config file exists."""
        return self.config_path.exists()

    def load(self) -> dict[str, Any]:
        """Load configuration from file.

        Returns:
            Configuration dictionary, or empty dict with defaults if file doesn't exist.
        """
        if not self.config_path.exists():
            return self._default_config()

        try:
            with open(self.config_path, "rb") as f:
                data = tomllib.load(f)
                return self._merge_with_defaults(data)
        except Exception as e:
            logger.error("Failed to load config file", path=str(self.config_path), error=str(e))
            raise

    def save(self, config: dict[str, Any]) -> None:
        """Save configuration to file.

        Args:
            config: Configuration dictionary to save.
        """
        # Ensure directory exists
        self.config_path.parent.mkdir(parents=True, exist_ok=True)

        # Convert to TOML format
        toml_content = self._to_toml(config)

        with open(self.config_path, "w") as f:
            f.write(toml_content)

        logger.info("Configuration saved", path=str(self.config_path))

    def _default_config(self) -> dict[str, Any]:
        """Return default configuration."""
        return {
            "podex": {
                "pod_token": "",
                "cloud_url": "https://api.podex.dev",
                "pod_name": None,
                "max_workspaces": 3,
                "mode": "docker",
            },
            "native": {
                "workspace_dir": str(Path.home() / "podex-workspaces"),
                "security": "allowlist",
            },
            "mounts": [],
        }

    def _merge_with_defaults(self, data: dict[str, Any]) -> dict[str, Any]:
        """Merge loaded config with defaults for missing keys."""
        defaults = self._default_config()

        # Merge podex section
        if "podex" not in data:
            data["podex"] = {}
        for key, value in defaults["podex"].items():
            if key not in data["podex"]:
                data["podex"][key] = value

        # Merge native section
        if "native" not in data:
            data["native"] = {}
        for key, value in defaults["native"].items():
            if key not in data["native"]:
                data["native"][key] = value

        # Ensure mounts exists
        if "mounts" not in data:
            data["mounts"] = []

        return data

    def _to_toml(self, config: dict[str, Any]) -> str:
        """Convert configuration dict to TOML string.

        We manually format TOML since tomllib is read-only.
        """
        lines = []

        # [podex] section
        lines.append("[podex]")
        podex = config.get("podex", {})
        if podex.get("pod_token"):
            lines.append(f'pod_token = "{podex["pod_token"]}"')
        lines.append(f'cloud_url = "{podex.get("cloud_url", "https://api.podex.dev")}"')
        if podex.get("pod_name"):
            lines.append(f'pod_name = "{podex["pod_name"]}"')
        lines.append(f"max_workspaces = {podex.get('max_workspaces', 3)}")
        lines.append(f'mode = "{podex.get("mode", "docker")}"')
        lines.append("")

        # [native] section
        lines.append("[native]")
        native = config.get("native", {})
        workspace_dir = native.get("workspace_dir", str(Path.home() / "podex-workspaces"))
        lines.append(f'workspace_dir = "{workspace_dir}"')
        lines.append(f'security = "{native.get("security", "allowlist")}"')
        lines.append("")

        # [[mounts]] sections
        mounts = config.get("mounts", [])
        for mount in mounts:
            lines.append("[[mounts]]")
            lines.append(f'path = "{mount["path"]}"')
            lines.append(f'mode = "{mount.get("mode", "rw")}"')
            if mount.get("label"):
                lines.append(f'label = "{mount["label"]}"')
            lines.append("")

        return "\n".join(lines)

    # =========================================================================
    # Mount management helpers
    # =========================================================================

    def add_mount(
        self,
        path: str,
        mode: str = "rw",
        label: str | None = None,
    ) -> dict[str, Any]:
        """Add a mount to the configuration.

        Args:
            path: Filesystem path to allow.
            mode: "rw" for read-write, "ro" for read-only.
            label: Optional friendly name.

        Returns:
            Updated configuration.

        Raises:
            ValueError: If path already exists or is invalid.
        """
        # Resolve to absolute path
        resolved_path = str(Path(path).expanduser().resolve())

        # Validate path exists
        if not Path(resolved_path).exists():
            raise ValueError(f"Path does not exist: {resolved_path}")

        # Validate mode
        if mode not in ("rw", "ro"):
            raise ValueError(f"Invalid mode: {mode}. Must be 'rw' or 'ro'.")

        config = self.load()

        # Check for duplicates
        for mount in config["mounts"]:
            if mount["path"] == resolved_path:
                raise ValueError(f"Mount already exists: {resolved_path}")

        # Add mount
        mount_entry = {
            "path": resolved_path,
            "mode": mode,
        }
        if label:
            mount_entry["label"] = label
        else:
            # Default label to folder name
            mount_entry["label"] = Path(resolved_path).name

        config["mounts"].append(mount_entry)
        self.save(config)

        logger.info("Mount added", path=resolved_path, mode=mode, label=mount_entry["label"])
        return config

    def remove_mount(self, path: str) -> dict[str, Any]:
        """Remove a mount from the configuration.

        Args:
            path: Filesystem path to remove.

        Returns:
            Updated configuration.

        Raises:
            ValueError: If path not found.
        """
        resolved_path = str(Path(path).expanduser().resolve())
        config = self.load()

        original_len = len(config["mounts"])
        config["mounts"] = [m for m in config["mounts"] if m["path"] != resolved_path]

        if len(config["mounts"]) == original_len:
            raise ValueError(f"Mount not found: {resolved_path}")

        self.save(config)
        logger.info("Mount removed", path=resolved_path)
        return config

    def list_mounts(self) -> list[dict[str, Any]]:
        """List all configured mounts.

        Returns:
            List of mount configurations.
        """
        config = self.load()
        mounts: list[dict[str, Any]] = config.get("mounts", [])
        return mounts

    # =========================================================================
    # Mode management helpers
    # =========================================================================

    def set_mode(
        self,
        mode: str,
        workspace_dir: str | None = None,
        security: str | None = None,
    ) -> dict[str, Any]:
        """Set the execution mode.

        Args:
            mode: "docker" or "native".
            workspace_dir: Native mode workspace directory (only for native mode).
            security: Native mode security setting (only for native mode).

        Returns:
            Updated configuration.

        Raises:
            ValueError: If mode or options are invalid.
        """
        if mode not in ("docker", "native"):
            raise ValueError(f"Invalid mode: {mode}. Must be 'docker' or 'native'.")

        config = self.load()
        config["podex"]["mode"] = mode

        if mode == "native":
            if workspace_dir:
                resolved_dir = str(Path(workspace_dir).expanduser().resolve())
                config["native"]["workspace_dir"] = resolved_dir
            if security:
                if security not in ("allowlist", "unrestricted"):
                    raise ValueError(
                        f"Invalid security: {security}. Must be 'allowlist' or 'unrestricted'."
                    )
                config["native"]["security"] = security

        self.save(config)
        logger.info("Mode updated", mode=mode)
        return config

    def get_mode(self) -> str:
        """Get current execution mode.

        Returns:
            "docker" or "native".
        """
        config = self.load()
        mode: str = config.get("podex", {}).get("mode", "docker")
        return mode

    # =========================================================================
    # General config helpers
    # =========================================================================

    def set_value(self, key: str, value: Any) -> dict[str, Any]:
        """Set a configuration value.

        Args:
            key: Dot-notation key (e.g., "podex.pod_name", "native.security").
            value: Value to set.

        Returns:
            Updated configuration.
        """
        config = self.load()

        parts = key.split(".")
        if len(parts) == 1:
            # Top-level key in podex section
            config["podex"][parts[0]] = value
        elif len(parts) == 2:
            section, subkey = parts
            if section not in config:
                config[section] = {}
            config[section][subkey] = value
        else:
            raise ValueError(f"Invalid key format: {key}")

        self.save(config)
        logger.info("Config value set", key=key, value=value)
        return config

    def get_value(self, key: str) -> Any:
        """Get a configuration value.

        Args:
            key: Dot-notation key.

        Returns:
            Configuration value or None if not found.
        """
        config = self.load()

        parts = key.split(".")
        if len(parts) == 1:
            return config.get("podex", {}).get(parts[0])
        elif len(parts) == 2:
            section, subkey = parts
            return config.get(section, {}).get(subkey)

        return None
