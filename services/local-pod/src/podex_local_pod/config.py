"""Configuration for Podex Local Pod agent."""

from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


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

    # Workspace limits
    max_workspaces: int = Field(
        default=3,
        ge=1,
        le=10,
        description="Maximum concurrent workspaces",
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


def load_config(config_file: str | Path | None = None) -> LocalPodConfig:
    """Load configuration from environment and optional config file.

    Args:
        config_file: Optional path to a config file

    Returns:
        Loaded configuration
    """
    if config_file:
        # Load from file if provided
        import tomllib

        config_path = Path(config_file)
        if config_path.exists():
            with open(config_path, "rb") as f:
                data = tomllib.load(f)
                return LocalPodConfig(**data.get("podex", {}))

    # Load from environment
    return LocalPodConfig()
