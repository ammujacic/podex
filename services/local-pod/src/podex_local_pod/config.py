"""Configuration for Podex Local Pod agent.

Simplified configuration - the local pod runs in native unrestricted mode,
executing commands at whatever working_dir the backend provides.
"""

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class LocalPodConfig(BaseSettings):
    """Configuration for the local pod agent.

    The local pod is a stateless executor - it receives working_dir with
    each RPC call and executes commands at that path. No mode selection,
    no security restrictions, no mount configuration needed.
    """

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


def load_config() -> LocalPodConfig:
    """Load configuration from environment variables.

    Configuration is loaded from:
    1. Environment variables (PODEX_*)
    2. .env file (if present)
    3. Default values

    Returns:
        Loaded configuration
    """
    return LocalPodConfig()
