"""Tunnel management models for compute service."""

from pydantic import BaseModel, Field


class TunnelStartRequest(BaseModel):
    """Request to start a cloudflared tunnel."""

    token: str = Field(..., description="Cloudflare tunnel token")
    port: int = Field(..., ge=1, le=65535, description="Local port to tunnel")
    service_type: str = Field(
        default="http",
        pattern="^(http|ssh)$",
        description="Tunnel service type: http or ssh",
    )


class TunnelStopRequest(BaseModel):
    """Request to stop a cloudflared tunnel."""

    port: int = Field(..., ge=1, le=65535, description="Port of tunnel to stop")


class TunnelStatusResponse(BaseModel):
    """Response with tunnel status."""

    status: str = Field(..., description="Tunnel status: running, stopped, error")
    pid: int | None = Field(default=None, description="Process ID if running")
    error: str | None = Field(default=None, description="Error message if failed")


class TunnelStartResponse(BaseModel):
    """Response after starting a tunnel."""

    status: str = Field(..., description="Tunnel status: running or error")
    pid: int | None = Field(default=None, description="Process ID")
    error: str | None = Field(default=None, description="Error message if failed")
