"""Preview environment management for deployment testing."""

import asyncio
import os
import tempfile
from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import Enum
from pathlib import Path
from typing import Any
from uuid import uuid4

import structlog

logger = structlog.get_logger()

# Secure temp directory path
_TEMP_DIR = str(Path(tempfile.gettempdir()))


class PreviewStatus(str, Enum):
    """Status of a preview environment."""

    PENDING = "pending"
    BUILDING = "building"
    DEPLOYING = "deploying"
    RUNNING = "running"
    FAILED = "failed"
    STOPPED = "stopped"
    EXPIRED = "expired"


@dataclass
class PreviewConfig:
    """Configuration for creating a preview environment."""

    branch: str = "main"
    build_command: str | None = None
    start_command: str | None = None
    env_vars: dict[str, str] | None = None


@dataclass
class PreviewEnvironment:
    """A preview deployment environment."""

    id: str
    session_id: str
    workspace_path: str
    branch: str
    status: PreviewStatus = PreviewStatus.PENDING
    url: str | None = None
    port: int | None = None
    container_id: str | None = None
    process_id: int | None = None
    build_output: str = ""
    deploy_output: str = ""
    error: str | None = None
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    started_at: datetime | None = None
    expires_at: datetime | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary."""
        return {
            "id": self.id,
            "session_id": self.session_id,
            "workspace_path": self.workspace_path,
            "branch": self.branch,
            "status": self.status.value,
            "url": self.url,
            "port": self.port,
            "container_id": self.container_id,
            "error": self.error,
            "created_at": self.created_at.isoformat(),
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "expires_at": self.expires_at.isoformat() if self.expires_at else None,
            "metadata": self.metadata,
        }


class PreviewManager:
    """Manages preview deployment environments.

    Features:
    - Spin up preview environments for branches
    - Build and deploy applications
    - Port management
    - Container or process-based isolation
    - Automatic cleanup and expiration
    """

    def __init__(
        self,
        base_port: int = 3100,
        max_previews: int = 10,
        preview_ttl_hours: int = 24,
    ) -> None:
        """Initialize preview manager.

        Args:
            base_port: Starting port for preview environments
            max_previews: Maximum concurrent previews
            preview_ttl_hours: Hours before preview expires
        """
        self._base_port = base_port
        self._max_previews = max_previews
        self._preview_ttl = preview_ttl_hours * 3600
        self._previews: dict[str, PreviewEnvironment] = {}
        self._used_ports: set[int] = set()
        self._background_tasks: set[asyncio.Task[None]] = set()

    def _allocate_port(self) -> int:
        """Allocate an available port."""
        for port in range(self._base_port, self._base_port + 100):
            if port not in self._used_ports:
                self._used_ports.add(port)
                return port
        raise RuntimeError("No available ports for preview")

    def _release_port(self, port: int) -> None:
        """Release a port."""
        self._used_ports.discard(port)

    async def create_preview(
        self,
        session_id: str,
        workspace_path: str,
        config: PreviewConfig | None = None,
    ) -> PreviewEnvironment:
        """Create a new preview environment.

        Args:
            session_id: Session ID
            workspace_path: Path to workspace
            config: Preview configuration including branch, commands, and env vars

        Returns:
            Preview environment
        """
        config = config or PreviewConfig()
        if len(self._previews) >= self._max_previews:
            # Clean up expired previews
            await self._cleanup_expired()
            if len(self._previews) >= self._max_previews:
                raise RuntimeError(f"Maximum previews ({self._max_previews}) reached")

        preview_id = str(uuid4())[:8]
        port = self._allocate_port()

        preview = PreviewEnvironment(
            id=preview_id,
            session_id=session_id,
            workspace_path=workspace_path,
            branch=config.branch,
            port=port,
            metadata={
                "build_command": config.build_command,
                "start_command": config.start_command,
                "env_vars": config.env_vars or {},
            },
        )

        self._previews[preview_id] = preview

        logger.info(
            "Creating preview environment",
            preview_id=preview_id,
            branch=config.branch,
            port=port,
        )

        # Build and deploy in background, keeping reference to prevent GC
        task = asyncio.create_task(self._deploy_preview(preview))
        self._background_tasks.add(task)
        task.add_done_callback(self._background_tasks.discard)

        return preview

    async def _deploy_preview(self, preview: PreviewEnvironment) -> None:
        """Build and deploy a preview environment."""
        try:
            # Checkout branch
            preview.status = PreviewStatus.BUILDING
            await self._run_command(
                ["git", "checkout", preview.branch],
                cwd=preview.workspace_path,
            )

            # Run build if specified
            build_cmd = preview.metadata.get("build_command")
            if build_cmd:
                result = await self._run_command(
                    build_cmd.split(),
                    cwd=preview.workspace_path,
                )
                preview.build_output = result

            # Start the application
            preview.status = PreviewStatus.DEPLOYING
            start_cmd = preview.metadata.get("start_command")

            if start_cmd:
                # Prepare environment
                env = os.environ.copy()
                env.update(preview.metadata.get("env_vars", {}))
                env["PORT"] = str(preview.port)

                # Start process
                process = await asyncio.create_subprocess_shell(
                    start_cmd,
                    cwd=preview.workspace_path,
                    env=env,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )

                preview.process_id = process.pid
                preview.status = PreviewStatus.RUNNING
                preview.started_at = datetime.now(UTC)
                preview.url = f"http://localhost:{preview.port}"
                preview.expires_at = datetime.fromtimestamp(
                    datetime.now(UTC).timestamp() + self._preview_ttl,
                    tz=UTC,
                )

                logger.info(
                    "Preview deployed",
                    preview_id=preview.id,
                    url=preview.url,
                    pid=preview.process_id,
                )
            else:
                # No start command - just mark as running for static files
                preview.status = PreviewStatus.RUNNING
                preview.url = f"file://{preview.workspace_path}"

        except Exception as e:
            preview.status = PreviewStatus.FAILED
            preview.error = str(e)
            logger.error("Preview deployment failed", preview_id=preview.id, error=str(e))

    async def _run_command(
        self,
        cmd: list[str],
        cwd: str,
    ) -> str:
        """Run a command and return output."""
        process = await asyncio.create_subprocess_exec(
            *cmd,
            cwd=cwd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        stdout, stderr = await process.communicate()
        output = stdout.decode() + stderr.decode()

        if process.returncode != 0:
            raise RuntimeError(f"Command failed: {output}")

        return output

    async def get_preview(self, preview_id: str) -> PreviewEnvironment | None:
        """Get a preview by ID."""
        return self._previews.get(preview_id)

    async def get_session_previews(self, session_id: str) -> list[PreviewEnvironment]:
        """Get all previews for a session."""
        return [p for p in self._previews.values() if p.session_id == session_id]

    async def stop_preview(self, preview_id: str) -> bool:
        """Stop a preview environment.

        Args:
            preview_id: Preview ID

        Returns:
            True if stopped successfully
        """
        preview = self._previews.get(preview_id)
        if not preview:
            return False

        try:
            # Stop process
            if preview.process_id:
                try:
                    os.kill(preview.process_id, 15)  # SIGTERM
                    await asyncio.sleep(2)
                    os.kill(preview.process_id, 9)  # SIGKILL if still running
                except ProcessLookupError:
                    pass

            # Stop container
            if preview.container_id:
                await self._run_command(
                    ["docker", "stop", preview.container_id],
                    cwd=_TEMP_DIR,
                )

            # Release port
            if preview.port:
                self._release_port(preview.port)

            preview.status = PreviewStatus.STOPPED

            logger.info("Preview stopped", preview_id=preview_id)
            return True

        except Exception as e:
            logger.error("Failed to stop preview", preview_id=preview_id, error=str(e))
            preview.error = str(e)
            return False

    async def delete_preview(self, preview_id: str) -> bool:
        """Delete a preview environment.

        Args:
            preview_id: Preview ID

        Returns:
            True if deleted successfully
        """
        if preview_id not in self._previews:
            return False

        await self.stop_preview(preview_id)
        del self._previews[preview_id]

        logger.info("Preview deleted", preview_id=preview_id)
        return True

    async def get_preview_logs(
        self,
        preview_id: str,
        _lines: int = 100,
    ) -> str:
        """Get logs from a preview environment."""
        preview = self._previews.get(preview_id)
        if not preview:
            return "Preview not found"

        logs = []
        if preview.build_output:
            logs.append("=== BUILD OUTPUT ===\n" + preview.build_output)
        if preview.deploy_output:
            logs.append("=== DEPLOY OUTPUT ===\n" + preview.deploy_output)
        if preview.error:
            logs.append("=== ERROR ===\n" + preview.error)

        return "\n\n".join(logs) if logs else "No logs available"

    async def _cleanup_expired(self) -> None:
        """Clean up expired preview environments."""
        now = datetime.now(UTC)
        expired = [p.id for p in self._previews.values() if p.expires_at and p.expires_at < now]

        for preview_id in expired:
            await self.delete_preview(preview_id)
            logger.info("Expired preview cleaned up", preview_id=preview_id)

    async def rollback_preview(
        self,
        preview_id: str,
        to_commit: str,
    ) -> bool:
        """Rollback a preview to a specific commit.

        Args:
            preview_id: Preview ID
            to_commit: Commit hash to rollback to

        Returns:
            True if rollback successful
        """
        preview = self._previews.get(preview_id)
        if not preview:
            return False

        try:
            # Stop current deployment
            await self.stop_preview(preview_id)

            # Reset to commit
            await self._run_command(
                ["git", "reset", "--hard", to_commit],
                cwd=preview.workspace_path,
            )

            # Redeploy
            await self._deploy_preview(preview)

            logger.info(
                "Preview rolled back",
                preview_id=preview_id,
                to_commit=to_commit,
            )
            return True

        except Exception as e:
            logger.error(
                "Rollback failed",
                preview_id=preview_id,
                error=str(e),
            )
            preview.error = str(e)
            return False
