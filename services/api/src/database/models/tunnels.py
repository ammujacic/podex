"""Tunnel models for external workspace exposure via Cloudflare."""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from src.database.encrypted_types import EncryptedString

from .base import Base, _generate_uuid


class WorkspaceTunnel(Base):
    """Tunnel exposing a workspace port to the internet via Cloudflare.

    One record per (workspace, port). Tunnel token is encrypted at rest.
    """

    __tablename__ = "workspace_tunnels"
    __table_args__ = (UniqueConstraint("workspace_id", "port", name="uq_workspace_tunnel_ws_port"),)

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    workspace_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    port: Mapped[int] = mapped_column(Integer, nullable=False)
    tunnel_id: Mapped[str] = mapped_column(String(256), nullable=False, index=True)
    tunnel_token: Mapped[str] = mapped_column(EncryptedString, nullable=False)
    public_url: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(50), default="starting", nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
