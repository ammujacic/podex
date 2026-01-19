"""Extension models: UserExtension, WorkspaceExtension."""

from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, _generate_uuid

if TYPE_CHECKING:
    from .core import User, Workspace


class UserExtension(Base):
    """User-level installed extensions (sync across all sessions/devices).

    Extensions installed at the user level follow the user everywhere
    and are automatically loaded in all their sessions.
    """

    __tablename__ = "user_extensions"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    user_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Extension identity (from Open VSX registry)
    # extension_id format: "namespace.name" e.g. "esbenp.prettier-vscode"
    extension_id: Mapped[str] = mapped_column(String(255), nullable=False)
    namespace: Mapped[str] = mapped_column(String(100), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    display_name: Mapped[str] = mapped_column(String(255), nullable=False)
    version: Mapped[str] = mapped_column(String(50), nullable=False)

    # State
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # Extension settings (user-specific configuration for this extension)
    settings: Mapped[dict[str, Any] | None] = mapped_column(JSONB)

    # Metadata from Open VSX
    icon_url: Mapped[str | None] = mapped_column(Text)
    publisher: Mapped[str | None] = mapped_column(String(255))

    installed_at: Mapped[datetime] = mapped_column(
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

    # Relationships
    user: Mapped["User"] = relationship("User", back_populates="extensions")

    # Unique constraint: user can't install same extension twice
    __table_args__ = (
        UniqueConstraint("user_id", "extension_id", name="uq_user_extensions_user_extension"),
    )


class WorkspaceExtension(Base):
    """Workspace-level installed extensions (persist in workspace across pods).

    Extensions installed at the workspace level are project-specific
    and only loaded when working in that workspace/session.
    """

    __tablename__ = "workspace_extensions"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    workspace_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Extension identity (from Open VSX registry)
    extension_id: Mapped[str] = mapped_column(String(255), nullable=False)
    namespace: Mapped[str] = mapped_column(String(100), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    display_name: Mapped[str] = mapped_column(String(255), nullable=False)
    version: Mapped[str] = mapped_column(String(50), nullable=False)

    # State
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # Extension settings (workspace-specific configuration)
    settings: Mapped[dict[str, Any] | None] = mapped_column(JSONB)

    # Metadata
    icon_url: Mapped[str | None] = mapped_column(Text)
    publisher: Mapped[str | None] = mapped_column(String(255))

    # Who installed this extension
    installed_by: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="SET NULL"),
    )

    installed_at: Mapped[datetime] = mapped_column(
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

    # Relationships
    workspace: Mapped["Workspace"] = relationship("Workspace", back_populates="extensions")
    installer: Mapped["User | None"] = relationship("User")

    # Unique constraint: workspace can't have same extension twice
    __table_args__ = (UniqueConstraint("workspace_id", "extension_id", name="uq_ws_ext_ws_ext"),)
