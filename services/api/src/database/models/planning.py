"""Planning and progress tracking models."""

from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, _generate_uuid


class ExecutionPlan(Base):
    """Execution plan for planning mode."""

    __tablename__ = "execution_plans"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    session_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    agent_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("agents.id", ondelete="SET NULL"),
        index=True,
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    original_task: Mapped[str | None] = mapped_column(Text)
    steps: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False)
    current_step: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    status: Mapped[str] = mapped_column(
        String(50),
        default="pending_approval",
        nullable=False,
        index=True,
    )
    confidence_score: Mapped[float | None] = mapped_column(Float)
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
        index=True,
    )
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    approved_by: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="SET NULL"),
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class TaskProgress(Base):
    """Progress tracking for agent task execution."""

    __tablename__ = "task_progress"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_generate_uuid)
    session_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    agent_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("agents.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    steps: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB, nullable=False
    )  # [{id, description, status, started_at, completed_at, elapsed_ms}]
    current_step_index: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    overall_progress: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)  # 0-100
    status: Mapped[str] = mapped_column(
        String(20), default="running", nullable=False
    )  # running, completed, failed, cancelled
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
