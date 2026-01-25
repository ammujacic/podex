"""Security utilities for Podex Local Pod.

Handles path validation against the mount allowlist to ensure
workspaces can only access authorized filesystem paths.
"""

import os
from pathlib import Path
from typing import Any

import structlog

logger = structlog.get_logger()


class PathSecurityError(Exception):
    """Raised when a path access is denied by security policy."""

    pass


class PathValidator:
    """Validates filesystem paths against the configured allowlist."""

    def __init__(
        self,
        mounts: list[dict[str, Any]],
        security: str = "allowlist",
    ) -> None:
        """Initialize the path validator.

        Args:
            mounts: List of allowed mount configurations.
            security: Security mode - "allowlist" or "unrestricted".
        """
        self.mounts = mounts
        self.security = security

        # Pre-resolve all mount paths for efficient checking
        self._allowed_paths: list[tuple[str, str]] = []
        for mount in mounts:
            resolved = str(Path(mount["path"]).resolve())
            mode = mount.get("mode", "rw")
            self._allowed_paths.append((resolved, mode))

    def is_unrestricted(self) -> bool:
        """Check if security is unrestricted."""
        return self.security == "unrestricted"

    def validate_path(self, path: str, require_write: bool = False) -> str:
        """Validate a path against the allowlist.

        Args:
            path: Path to validate.
            require_write: If True, path must be in a read-write mount.

        Returns:
            The resolved absolute path.

        Raises:
            PathSecurityError: If path is not allowed.
        """
        if self.is_unrestricted():
            return str(Path(path).resolve())

        resolved = str(Path(path).resolve())

        for allowed_path, mode in self._allowed_paths:
            # Check if resolved path is under the allowed path
            if resolved == allowed_path or resolved.startswith(allowed_path + os.sep):
                # Check write permission
                if require_write and mode == "ro":
                    raise PathSecurityError(f"Write access denied: {path} is in read-only mount")
                return resolved

        raise PathSecurityError(
            f"Access denied: {path} is outside allowed mounts. "
            f"Allowed paths: {[p for p, _ in self._allowed_paths]}"
        )

    def validate_working_dir(self, working_dir: str) -> str:
        """Validate a working directory.

        Args:
            working_dir: Working directory path.

        Returns:
            The resolved absolute path.

        Raises:
            PathSecurityError: If path is not allowed.
        """
        return self.validate_path(working_dir, require_write=False)

    def can_read(self, path: str) -> bool:
        """Check if a path can be read.

        Args:
            path: Path to check.

        Returns:
            True if readable, False otherwise.
        """
        try:
            self.validate_path(path, require_write=False)
            return True
        except PathSecurityError:
            return False

    def can_write(self, path: str) -> bool:
        """Check if a path can be written.

        Args:
            path: Path to check.

        Returns:
            True if writable, False otherwise.
        """
        try:
            self.validate_path(path, require_write=True)
            return True
        except PathSecurityError:
            return False

    def filter_command_paths(self, command: str) -> None:
        """Validate that a command doesn't access restricted paths.

        This is a best-effort validation for common path patterns in commands.
        It cannot catch all cases (e.g., environment variables, symlinks).

        Args:
            command: Shell command to validate.

        Raises:
            PathSecurityError: If command appears to access restricted paths.
        """
        if self.is_unrestricted():
            return

        # Extract potential paths from command
        # This catches common patterns like:
        # - Absolute paths: /home/user/...
        # - Home paths: ~/...
        # - Relative paths with ..: ../../../etc/passwd

        import shlex

        try:
            tokens = shlex.split(command)
        except ValueError:
            # Can't parse, allow it (will fail at execution if invalid)
            return

        for token in tokens:
            # Skip common flags
            if token.startswith("-"):
                continue

            # Check for path traversal attempts
            if ".." in token:
                # Resolve and validate
                try:
                    resolved = str(Path(token).resolve())
                    self.validate_path(resolved)
                except (PathSecurityError, OSError):
                    raise PathSecurityError(
                        f"Path traversal detected in command: {token}"
                    ) from None

            # Check absolute paths
            if token.startswith("/") or token.startswith("~"):
                try:
                    expanded = str(Path(token).expanduser())
                    if Path(expanded).is_absolute():
                        self.validate_path(expanded)
                except (PathSecurityError, OSError):
                    raise PathSecurityError(
                        f"Access to restricted path in command: {token}"
                    ) from None

    def get_mount_for_path(self, path: str) -> dict[str, Any] | None:
        """Get the mount configuration for a path.

        Args:
            path: Path to check.

        Returns:
            Mount configuration dict, or None if not in any mount.
        """
        if self.is_unrestricted():
            return None

        resolved = str(Path(path).resolve())

        for mount in self.mounts:
            mount_path = str(Path(mount["path"]).resolve())
            if resolved == mount_path or resolved.startswith(mount_path + os.sep):
                return mount

        return None


def create_validator(config: dict[str, Any]) -> PathValidator:
    """Create a PathValidator from configuration.

    Args:
        config: Full configuration dictionary.

    Returns:
        Configured PathValidator instance.
    """
    mounts = config.get("mounts", [])
    security = config.get("native", {}).get("security", "allowlist")
    return PathValidator(mounts=mounts, security=security)
