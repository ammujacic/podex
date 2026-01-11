"""Preview models shared across services."""

from pydantic import BaseModel


class PortInfo(BaseModel):
    """Information about an active port in a workspace."""

    port: int
    process_name: str
    state: str = "LISTEN"
    protocol: str = "http"
    label: str | None = None

    def __init__(self, **data: object) -> None:
        """Initialize with auto-generated label if not provided."""
        super().__init__(**data)
        if self.label is None:
            self.label = self.process_name or f"Port {self.port}"


class PreviewInfo(BaseModel):
    """Preview information for a workspace."""

    workspace_id: str
    status: str
    active_ports: list[PortInfo]
    preview_base_url: str
    container_id: str | None = None
