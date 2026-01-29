"""Input validation utilities for compute service."""

from __future__ import annotations

import re

# Pattern for valid IDs: alphanumeric, underscores, hyphens only
# This prevents path traversal (../) and command injection
SAFE_ID_PATTERN = re.compile(r"^[a-zA-Z0-9_-]+$")


class ValidationError(ValueError):
    """Raised when input validation fails."""


def validate_id(value: str, id_type: str = "ID") -> str:
    """Validate that an ID contains only safe characters.

    Prevents path traversal attacks (e.g., '../../../etc') and
    command injection by ensuring IDs contain only alphanumeric
    characters, underscores, and hyphens.

    Args:
        value: The ID value to validate
        id_type: Description of the ID type for error messages

    Returns:
        The validated ID (unchanged if valid)

    Raises:
        ValidationError: If the ID contains unsafe characters
    """
    if not value:
        raise ValidationError(f"Invalid {id_type}: cannot be empty")

    if not SAFE_ID_PATTERN.match(value):
        raise ValidationError(f"Invalid {id_type}: contains unsafe characters")

    return value


def validate_workspace_id(workspace_id: str) -> str:
    """Validate a workspace ID."""
    return validate_id(workspace_id, "workspace_id")


def validate_user_id(user_id: str) -> str:
    """Validate a user ID."""
    return validate_id(user_id, "user_id")


def validate_session_id(session_id: str) -> str:
    """Validate a session ID."""
    return validate_id(session_id, "session_id")
