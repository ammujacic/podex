"""Tests for input validation utilities."""

import pytest

from src.validation import (
    ValidationError,
    validate_id,
    validate_session_id,
    validate_user_id,
    validate_workspace_id,
)


class TestValidateId:
    """Tests for the generic validate_id function."""

    def test_valid_alphanumeric(self):
        """Valid alphanumeric IDs should pass."""
        assert validate_id("abc123", "test") == "abc123"

    def test_valid_with_underscore(self):
        """IDs with underscores should pass."""
        assert validate_id("user_123", "test") == "user_123"

    def test_valid_with_hyphen(self):
        """IDs with hyphens should pass."""
        assert validate_id("ws-abc-123", "test") == "ws-abc-123"

    def test_valid_uuid_style(self):
        """UUID-style IDs should pass."""
        assert validate_id("a1b2c3d4e5f6", "test") == "a1b2c3d4e5f6"

    def test_valid_workspace_prefix(self):
        """Workspace-style IDs should pass."""
        assert validate_id("ws_a1b2c3d4e5f6", "test") == "ws_a1b2c3d4e5f6"

    def test_empty_string_raises(self):
        """Empty string should raise ValidationError."""
        with pytest.raises(ValidationError, match="cannot be empty"):
            validate_id("", "test_id")

    def test_path_traversal_raises(self):
        """Path traversal attempts should raise ValidationError."""
        with pytest.raises(ValidationError, match="contains unsafe characters"):
            validate_id("../../../etc/passwd", "test_id")

    def test_path_traversal_partial_raises(self):
        """Partial path traversal attempts should raise ValidationError."""
        with pytest.raises(ValidationError, match="contains unsafe characters"):
            validate_id("valid_../bad", "test_id")

    def test_slash_raises(self):
        """Forward slashes should raise ValidationError."""
        with pytest.raises(ValidationError, match="contains unsafe characters"):
            validate_id("path/to/file", "test_id")

    def test_backslash_raises(self):
        """Backslashes should raise ValidationError."""
        with pytest.raises(ValidationError, match="contains unsafe characters"):
            validate_id("path\\to\\file", "test_id")

    def test_spaces_raise(self):
        """Spaces should raise ValidationError."""
        with pytest.raises(ValidationError, match="contains unsafe characters"):
            validate_id("user id", "test_id")

    def test_special_chars_raise(self):
        """Special characters should raise ValidationError."""
        special_chars = ["@", "#", "$", "%", "^", "&", "*", "(", ")", "!", "?"]
        for char in special_chars:
            with pytest.raises(ValidationError, match="contains unsafe characters"):
                validate_id(f"test{char}id", "test_id")

    def test_newline_raises(self):
        """Newlines should raise ValidationError."""
        with pytest.raises(ValidationError, match="contains unsafe characters"):
            validate_id("test\nid", "test_id")

    def test_tab_raises(self):
        """Tabs should raise ValidationError."""
        with pytest.raises(ValidationError, match="contains unsafe characters"):
            validate_id("test\tid", "test_id")

    def test_null_byte_raises(self):
        """Null bytes should raise ValidationError."""
        with pytest.raises(ValidationError, match="contains unsafe characters"):
            validate_id("test\x00id", "test_id")


class TestValidateWorkspaceId:
    """Tests for workspace ID validation."""

    def test_valid_workspace_id(self):
        """Valid workspace IDs should pass."""
        assert validate_workspace_id("ws_abc123def456") == "ws_abc123def456"

    def test_path_traversal_workspace_id(self):
        """Path traversal in workspace ID should raise."""
        with pytest.raises(ValidationError, match="workspace_id"):
            validate_workspace_id("../../../etc")


class TestValidateUserId:
    """Tests for user ID validation."""

    def test_valid_user_id(self):
        """Valid user IDs should pass."""
        assert validate_user_id("user_12345") == "user_12345"

    def test_path_traversal_user_id(self):
        """Path traversal in user ID should raise."""
        with pytest.raises(ValidationError, match="user_id"):
            validate_user_id("../../../etc")


class TestValidateSessionId:
    """Tests for session ID validation."""

    def test_valid_session_id(self):
        """Valid session IDs should pass."""
        assert validate_session_id("session-abc-123") == "session-abc-123"

    def test_path_traversal_session_id(self):
        """Path traversal in session ID should raise."""
        with pytest.raises(ValidationError, match="session_id"):
            validate_session_id("../etc/passwd")
