"""Configuration for Podex Local Pod agent."""

from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class MountConfig(BaseModel):
    """Configuration for an allowed filesystem mount."""

    path: str = Field(description="Absolute path to the mount")
    mode: Literal["rw", "ro"] = Field(default="rw", description="Read-write or read-only")
    label: str | None = Field(default=None, description="Friendly name for the mount")


class NativeConfig(BaseModel):
    """Configuration for native execution mode."""

    workspace_dir: str = Field(
        default=str(Path.home() / "podex-workspaces"),
        description="Directory for workspace files in native mode",
    )
    security: Literal["allowlist", "unrestricted"] = Field(
        default="allowlist",
        description="Security mode: 'allowlist' restricts to configured mounts, 'unrestricted' allows full access",
    )


class LocalPodConfig(BaseSettings):
    """Configuration for the local pod agent."""

    model_config = SettingsConfigDict(
        env_prefix="PODEX_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Required: Authentication token from Podex
    pod_token: str = Field(
        default="",
        description="Authentication token from Podex (pdx_pod_xxx)",
    )

    # Cloud connection
    cloud_url: str = Field(
        default="https://api.podex.dev",
        description="Podex cloud API URL",
    )

    # Pod identification
    pod_name: str | None = Field(
        default=None,
        description="Display name for this pod (optional, uses hostname if not set)",
    )

    # Execution mode: "docker" or "native"
    mode: Literal["docker", "native"] = Field(
        default="docker",
        description="Execution mode: 'docker' runs in containers, 'native' runs directly on host",
    )

    # Native mode configuration
    native: NativeConfig = Field(
        default_factory=NativeConfig,
        description="Native mode settings",
    )

    # Allowed mounts (used for docker volumes and native path restrictions)
    mounts: list[MountConfig] = Field(
        default_factory=list,
        description="List of allowed filesystem mounts",
    )

    # Docker configuration
    docker_host: str = Field(
        default="unix:///var/run/docker.sock",
        description="Docker daemon socket",
    )
    docker_network: str = Field(
        default="podex-local",
        description="Docker network for workspaces",
    )
    workspace_image: str = Field(
        default="podex/workspace:latest",
        description="Docker image for workspaces",
    )

    # Heartbeat interval (seconds)
    heartbeat_interval: int = Field(
        default=30,
        ge=10,
        le=300,
        description="Heartbeat interval in seconds",
    )

    # Reconnection settings
    reconnect_delay: int = Field(
        default=1,
        description="Initial reconnection delay in seconds",
    )
    reconnect_delay_max: int = Field(
        default=30,
        description="Maximum reconnection delay in seconds",
    )

    # Logging
    log_level: str = Field(
        default="INFO",
        description="Log level (DEBUG, INFO, WARNING, ERROR)",
    )

    def get_mounts_as_dicts(self) -> list[dict[str, Any]]:
        """Get mounts as list of dictionaries for serialization."""
        return [m.model_dump() for m in self.mounts]

    def is_native_mode(self) -> bool:
        """Check if running in native mode."""
        return self.mode == "native"

    def is_docker_mode(self) -> bool:
        """Check if running in docker mode."""
        return self.mode == "docker"


DEFAULT_CONFIG_PATH = Path.home() / ".config" / "podex" / "local-pod.toml"


def load_config(config_file: str | Path | None = None) -> LocalPodConfig:
    """Load configuration from config file, with environment variable overrides.

    Priority (highest to lowest):
    1. Environment variables (PODEX_*)
    2. Provided config file
    3. Default config file (~/.config/podex/local-pod.toml)
    4. Default values

    Args:
        config_file: Optional path to a config file

    Returns:
        Loaded configuration
    """
    import tomllib

    # Determine config file path
    config_path = Path(config_file) if config_file else DEFAULT_CONFIG_PATH

    # Load from file if it exists
    file_config: dict[str, Any] = {}
    if config_path.exists():
        with open(config_path, "rb") as f:
            data = tomllib.load(f)
            file_config = data.get("podex", {})

            # Handle nested native config
            if "native" in data:
                file_config["native"] = NativeConfig(**data["native"])

            # Handle mounts list
            if "mounts" in data:
                file_config["mounts"] = [MountConfig(**m) for m in data["mounts"]]

    # Create config - environment variables will override file values
    return LocalPodConfig(**file_config)
