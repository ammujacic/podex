"""Base model and utilities for all SQLAlchemy models."""

from typing import Any, ClassVar
from uuid import uuid4

from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase


def _generate_uuid() -> str:
    """Generate a new UUID string."""
    return str(uuid4())


class Base(DeclarativeBase):
    """Base class for all models."""

    type_annotation_map: ClassVar[dict[type, type]] = {
        dict[str, Any]: JSONB,
    }
