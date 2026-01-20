"""Terminal-integrated agent management routes.

Terminal agents run inside workspace containers via the compute service.
This module proxies terminal I/O to the compute service's terminal WebSocket.
"""

import asyncio
import contextlib
import os
import re
import shlex
import time
from typing import Annotated, Any
from uuid import UUID, uuid4

import structlog
from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
    Request,
    WebSocket,
    WebSocketDisconnect,
)
from jose import JWTError, jwt
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth_constants import COOKIE_ACCESS_TOKEN
from src.compute_client import ComputeClient
from src.config import settings
from src.database import (
    ExternalAgentEnvProfile,
    TerminalAgentSession,
    TerminalIntegratedAgentType,
    User,
    get_db,
)
from src.middleware.admin import require_admin
from src.middleware.auth import get_current_user
from src.services.token_blacklist import is_token_revoked
from src.terminal.manager import terminal_manager

logger = structlog.get_logger()

router = APIRouter()

# SECURITY: POSIX-compliant environment variable name pattern
# Must start with letter or underscore, followed by letters, digits, or underscores
# Also validate length to prevent abuse
ENV_VAR_NAME_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
ENV_VAR_NAME_MAX_LENGTH = 128  # Reasonable limit for env var names
ENV_VAR_VALUE_MAX_LENGTH = 32768  # 32KB max value length


class InvalidWorkDirError(HTTPException):
    """Exception raised for invalid working directory paths."""

    def __init__(self, detail: str) -> None:
        super().__init__(status_code=400, detail=detail)


def validate_env_var_name(name: str) -> bool:
    """Validate that an environment variable name is POSIX-compliant and safe.

    SECURITY: Prevents shell injection through malformed env var names.
    """
    if not name or len(name) > ENV_VAR_NAME_MAX_LENGTH:
        return False
    return bool(ENV_VAR_NAME_PATTERN.match(name))


async def validate_ws_token(token: str | None, db: AsyncSession) -> str | None:
    """Validate JWT token for WebSocket connections.

    WebSocket connections can't send Authorization headers, so the token
    is passed as a query parameter instead.

    SECURITY: Only accepts access tokens (type="access"), not refresh tokens.
    Also checks token blacklist to ensure revoked tokens cannot be used.

    Returns:
        User ID if token is valid, None otherwise.
    """
    if not token:
        return None

    try:
        payload = jwt.decode(
            token,
            settings.JWT_SECRET_KEY,
            algorithms=[settings.JWT_ALGORITHM],
        )

        # SECURITY: Only accept access tokens, not refresh tokens
        # This prevents refresh token reuse as access tokens
        token_type = payload.get("type")
        if token_type and token_type != "access":
            logger.warning("Non-access token used for WebSocket auth", token_type=token_type)
            return None

        user_id_value = payload.get("sub")
        if not user_id_value:
            return None

        # SECURITY: Check token blacklist for revoked tokens
        token_jti = payload.get("jti")
        if token_jti and await is_token_revoked(token_jti):
            logger.warning("Revoked token used for terminal WebSocket", jti=token_jti[:8] + "...")
            return None

        user_id_str = str(user_id_value)

        # Verify user exists and is active
        result = await db.execute(select(User).where(User.id == user_id_str))
        user = result.scalar_one_or_none()
        if not user or not user.is_active:
            return None

        return user_id_str
    except JWTError:
        return None


# Type aliases
DbSession = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[dict[str, str | None], Depends(get_current_user)]


class TerminalAgentTypeResponse(BaseModel):
    """Response model for terminal agent types."""

    id: str
    name: str
    slug: str
    logo_url: str | None
    description: str | None
    is_enabled: bool
    created_at: str
    updated_at: str


class TerminalAgentTypeDetailResponse(BaseModel):
    """Detailed response model for terminal agent types (includes commands)."""

    id: str
    name: str
    slug: str
    logo_url: str | None
    description: str | None
    is_enabled: bool
    check_installed_command: list[str] | None
    version_command: list[str] | None
    install_command: list[str] | None
    update_command: list[str] | None
    run_command: list[str]
    default_env_template: dict[str, str] | None
    created_at: str
    updated_at: str


class EnvProfileResponse(BaseModel):
    """Response model for environment profiles."""

    id: str
    name: str
    agent_type_id: str | None
    env_vars: dict[str, str]
    created_at: str
    updated_at: str


class TerminalAgentSessionResponse(BaseModel):
    """Response model for terminal agent sessions."""

    id: str
    user_id: str
    workspace_id: str
    agent_type_id: str
    env_profile_id: str | None
    status: str
    created_at: str
    last_heartbeat_at: str


class CreateTerminalAgentRequest(BaseModel):
    """Request model for creating a terminal agent session."""

    workspace_id: str  # The compute workspace to run the agent in
    agent_type_id: str
    env_profile_id: str | None = None
    working_directory: str | None = None  # Relative path within workspace (default: /home/dev)


class CreateEnvProfileRequest(BaseModel):
    """Request model for creating an environment profile."""

    name: str
    agent_type_id: str | None = None
    env_vars: dict[str, str]


class CreateTerminalAgentTypeRequest(BaseModel):
    """Request model for creating a new terminal agent type."""

    name: str
    slug: str
    logo_url: str | None = None
    description: str | None = None
    check_installed_command: list[str] | None = None
    version_command: list[str] | None = None
    install_command: list[str] | None = None
    update_command: list[str] | None = None
    run_command: list[str]
    default_env_template: dict[str, str] | None = None


class TerminalAgentSessionManager:
    """Manages terminal agent sessions that run in workspace containers.

    Uses the existing terminal_manager to proxy to compute service.
    Each terminal agent session gets a unique terminal_id for the workspace.
    """

    def __init__(self) -> None:
        self.sessions: dict[str, dict[str, Any]] = {}
        self._lock = asyncio.Lock()
        self._shutting_down = False
        self._output_queues: dict[str, asyncio.Queue[str]] = {}

    async def shutdown(self) -> None:
        """Signal that the server is shutting down and close all sessions."""
        self._shutting_down = True

        async with self._lock:
            session_ids = list(self.sessions.keys())

        for session_id in session_ids:
            try:
                await self.close_session(session_id)
                logger.info("Closed terminal agent session during shutdown", session_id=session_id)
            except Exception as e:
                logger.warning(
                    "Error closing terminal agent session during shutdown",
                    session_id=session_id,
                    error=str(e),
                )

    @property
    def is_shutting_down(self) -> bool:
        """Check if the server is shutting down."""
        return self._shutting_down

    async def create_session(
        self,
        session_id: str,
        workspace_id: str,
        agent_type: TerminalIntegratedAgentType,
        env_profile: ExternalAgentEnvProfile | None,
        working_directory: str | None,
        user_id: str,
    ) -> dict[str, Any]:
        """Create a new terminal agent session in a workspace container.

        This creates a terminal session via the compute service and starts
        the agent process inside the workspace container.
        """
        async with self._lock:
            if session_id in self.sessions:
                return self.sessions[session_id]

            # Create output queue for this session
            output_queue: asyncio.Queue[str] = asyncio.Queue()
            self._output_queues[session_id] = output_queue

            # Create callback to capture terminal output
            async def on_output(_ws_id: str, output: str) -> None:
                """Store output in queue for WebSocket clients."""
                if session_id in self._output_queues:
                    await self._output_queues[session_id].put(output)

            logger.info(
                "Creating terminal agent session",
                session_id=session_id,
                workspace_id=workspace_id,
                agent_type=agent_type.slug,
            )

            try:
                # Create terminal session via terminal_manager (proxies to compute service)
                # Pass session_id so each terminal agent gets its own tmux session
                await terminal_manager.create_session(
                    workspace_id=workspace_id,
                    on_output=on_output,
                    session_id=session_id,  # Unique session for this terminal agent
                )

                # Build the startup command
                # SECURITY: Validate and sanitize working directory
                work_dir = working_directory or "/home/dev"

                # SECURITY: Prevent directory traversal attacks
                # Only allow absolute paths starting with /home/ or relative paths within workspace
                def _raise_path_traversal_error() -> None:
                    raise InvalidWorkDirError(  # noqa: TRY003, TRY301
                        "Invalid working directory: path traversal not allowed"
                    )

                def _raise_invalid_home_path_error() -> None:
                    raise InvalidWorkDirError(  # noqa: TRY003, TRY301
                        "Invalid working directory: must be under /home"
                    )

                if ".." in work_dir:
                    _raise_path_traversal_error()
                # Normalize path and verify it's safe
                normalized = os.path.normpath(work_dir)
                # Only allow paths under /home or relative paths that don't escape
                if normalized.startswith("/") and not normalized.startswith("/home"):
                    _raise_invalid_home_path_error()

                safe_work_dir = shlex.quote(normalized)

                # SECURITY: Quote each command part to prevent injection
                if agent_type.run_command:
                    run_cmd = " ".join(shlex.quote(part) for part in agent_type.run_command)
                else:
                    run_cmd = ""

                # Set environment variables if env_profile provided
                # SECURITY: Use shlex.quote for both key and value
                env_setup = ""
                if env_profile and env_profile.env_vars:
                    for key, value in env_profile.env_vars.items():
                        # SECURITY: Validate key is POSIX-compliant env var name
                        if not validate_env_var_name(key):
                            logger.warning(
                                "Skipping invalid env var name",
                                key=key[:50],  # Truncate to avoid log injection
                                session_id=session_id,
                            )
                            continue
                        # SECURITY: Validate value length to prevent abuse
                        if len(value) > ENV_VAR_VALUE_MAX_LENGTH:
                            logger.warning(
                                "Skipping env var with oversized value",
                                key=key,
                                value_length=len(value),
                                session_id=session_id,
                            )
                            continue
                        # Use shlex.quote for the value
                        safe_value = shlex.quote(value)
                        env_setup += f"export {key}={safe_value} && "

                # Build full startup command: cd to directory, set env, run agent
                startup_cmd = f"cd {safe_work_dir} && {env_setup}{run_cmd}\n"

                # Give the terminal a moment to initialize
                await asyncio.sleep(0.5)

                # Send the startup command to launch the agent (use session_id as key)
                success = await terminal_manager.write_input(session_id, startup_cmd)
                if not success:
                    raise RuntimeError("Failed to send startup command")  # noqa: TRY003, TRY301

                session_data = {
                    "session_id": session_id,
                    "workspace_id": workspace_id,
                    "agent_type": agent_type,
                    "env_profile": env_profile,
                    "working_directory": work_dir,
                    "status": "running",
                    "created_at": time.time(),
                    "last_heartbeat": time.time(),
                    "user_id": user_id,
                }

                self.sessions[session_id] = session_data

                logger.info(
                    "Terminal agent session created",
                    session_id=session_id,
                    workspace_id=workspace_id,
                    run_command=run_cmd,
                )

                return session_data

            except Exception as e:
                # Clean up on failure
                self._output_queues.pop(session_id, None)
                await terminal_manager.close_session(session_id)
                logger.exception(
                    "Failed to create terminal agent session",
                    session_id=session_id,
                    error=str(e),
                )
                # SECURITY: Don't expose internal error details to client
                raise HTTPException(
                    status_code=500,
                    detail="Failed to start terminal agent. Please try again or contact support.",
                )

    async def get_session(self, session_id: str) -> dict[str, Any] | None:
        """Get a terminal session by ID."""
        async with self._lock:
            return self.sessions.get(session_id)

    async def reattach_session(
        self,
        session_id: str,
        workspace_id: str,
        agent_type: TerminalIntegratedAgentType,
        env_profile: ExternalAgentEnvProfile | None,
        user_id: str,
    ) -> dict[str, Any]:
        """Reattach to an existing terminal agent session after disconnect.

        This is used when a client reconnects after a page refresh or network
        interruption. The tmux session is still running in the container,
        so we just need to re-establish the connection without re-running
        the startup command.
        """
        async with self._lock:
            # If session already exists in memory, return it
            if session_id in self.sessions:
                return self.sessions[session_id]

            # Create output queue for this session
            output_queue: asyncio.Queue[str] = asyncio.Queue()
            self._output_queues[session_id] = output_queue

            # Create callback to capture terminal output
            async def on_output(_ws_id: str, output: str) -> None:
                """Store output in queue for WebSocket clients."""
                if session_id in self._output_queues:
                    await self._output_queues[session_id].put(output)

            logger.info(
                "Reattaching to terminal agent session",
                session_id=session_id,
                workspace_id=workspace_id,
                agent_type=agent_type.slug,
            )

            try:
                # Re-establish terminal connection via terminal_manager
                # This will reattach to the existing tmux session
                await terminal_manager.create_session(
                    workspace_id=workspace_id,
                    on_output=on_output,
                    session_id=session_id,  # Use same session ID to reattach to tmux
                )

                # NOTE: We do NOT send the startup command here since the agent
                # is already running in the existing tmux session

                session_data = {
                    "session_id": session_id,
                    "workspace_id": workspace_id,
                    "agent_type": agent_type,
                    "env_profile": env_profile,
                    "working_directory": "/home/dev",  # Default, not stored in DB
                    "status": "running",
                    "created_at": time.time(),
                    "last_heartbeat": time.time(),
                    "user_id": user_id,
                    "reattached": True,  # Flag to indicate this was a reattach
                }

                self.sessions[session_id] = session_data

                logger.info(
                    "Terminal agent session reattached",
                    session_id=session_id,
                    workspace_id=workspace_id,
                )

                return session_data

            except Exception as e:
                # Clean up on failure
                self._output_queues.pop(session_id, None)
                await terminal_manager.close_session(session_id)
                logger.exception(
                    "Failed to reattach terminal agent session",
                    session_id=session_id,
                    error=str(e),
                )
                raise RuntimeError("Reattach failed") from e  # noqa: TRY003

    async def close_session(self, session_id: str) -> bool:
        """Close a terminal agent session."""
        async with self._lock:
            session = self.sessions.get(session_id)
            if not session:
                return False

            try:
                # Close the terminal session in compute service (use session_id as key)
                await terminal_manager.close_session(session_id)

                # Clean up output queue
                self._output_queues.pop(session_id, None)

                del self.sessions[session_id]
                logger.info("Terminal agent session closed", session_id=session_id)
                return True
            except Exception as e:
                logger.exception(
                    "Error closing terminal agent session", session_id=session_id, error=str(e)
                )
                return False

    async def read_output(self, session_id: str, timeout: float = 0.1) -> str | None:
        """Read output from a terminal agent session."""
        queue = self._output_queues.get(session_id)
        if not queue:
            return None

        try:
            return await asyncio.wait_for(queue.get(), timeout=timeout)
        except TimeoutError:
            return None
        except Exception:
            return None

    async def write_input(self, session_id: str, data: str) -> bool:
        """Write input to a terminal agent session."""
        session = await self.get_session(session_id)
        if not session:
            return False

        # Use session_id as key for terminal_manager
        return await terminal_manager.write_input(session_id, data)

    async def resize_terminal(self, session_id: str, rows: int, cols: int) -> bool:
        """Resize the terminal."""
        session = await self.get_session(session_id)
        if not session:
            return False

        # Use session_id as key for terminal_manager
        return await terminal_manager.resize(session_id, rows, cols)


# Global session manager
terminal_session_manager = TerminalAgentSessionManager()


@router.get("/terminal-agent-types", response_model=list[TerminalAgentTypeResponse])
async def list_terminal_agent_types(db: DbSession) -> list[TerminalAgentTypeResponse]:
    """List all enabled terminal-integrated agent types."""
    result = await db.execute(
        select(TerminalIntegratedAgentType).where(TerminalIntegratedAgentType.is_enabled.is_(True))
    )
    agent_types = result.scalars().all()

    return [
        TerminalAgentTypeResponse(
            id=str(at.id),
            name=at.name,
            slug=at.slug,
            logo_url=at.logo_url,
            description=at.description,
            is_enabled=at.is_enabled,
            created_at=at.created_at.isoformat(),
            updated_at=at.updated_at.isoformat(),
        )
        for at in agent_types
    ]


@router.post("", response_model=TerminalAgentSessionResponse)
async def create_terminal_agent_session(
    request: CreateTerminalAgentRequest,
    current_user: CurrentUser,
    db: DbSession,
) -> TerminalAgentSessionResponse:
    """Create a new terminal agent session in a workspace container."""
    user_id = current_user["id"]
    if not user_id:
        raise HTTPException(status_code=401, detail="User ID not found")

    # Get agent type
    result = await db.execute(
        select(TerminalIntegratedAgentType).where(
            TerminalIntegratedAgentType.id == UUID(request.agent_type_id),
            TerminalIntegratedAgentType.is_enabled.is_(True),
        )
    )
    agent_type = result.scalar_one_or_none()
    if not agent_type:
        raise HTTPException(status_code=404, detail="Agent type not found or disabled")

    # Get env profile if specified
    env_profile: ExternalAgentEnvProfile | None = None
    if request.env_profile_id:
        env_profile_result = await db.execute(
            select(ExternalAgentEnvProfile).where(
                ExternalAgentEnvProfile.id == UUID(request.env_profile_id),
                ExternalAgentEnvProfile.user_id == user_id,
            )
        )
        env_profile = env_profile_result.scalar_one_or_none()
        if not env_profile:
            raise HTTPException(status_code=404, detail="Environment profile not found")

    # Check if agent is installed in the workspace, install if needed
    compute_client = ComputeClient()
    is_installed = await _check_installation_in_workspace(
        compute_client, request.workspace_id, user_id, agent_type
    )
    if not is_installed:
        success = await _install_agent_in_workspace(
            compute_client, request.workspace_id, user_id, agent_type
        )
        if not success:
            # SECURITY: Log agent name internally but give generic message to client
            logger.error("Failed to install terminal agent", agent_type=agent_type.name)
            raise HTTPException(
                status_code=500,
                detail="Failed to install terminal agent. Please try again or contact support.",
            )

    # Create database session record
    session_id = str(uuid4())
    db_session = TerminalAgentSession(
        id=session_id,
        user_id=user_id,
        workspace_id=request.workspace_id,
        agent_type_id=agent_type.id,
        env_profile_id=env_profile.id if env_profile else None,
        status="starting",
    )
    db.add(db_session)
    await db.commit()

    # Create actual terminal session in the workspace
    try:
        await terminal_session_manager.create_session(
            session_id=session_id,
            workspace_id=request.workspace_id,
            agent_type=agent_type,
            env_profile=env_profile,
            working_directory=request.working_directory,
            user_id=user_id,
        )

        # Update status
        db_session.status = "running"
        await db.commit()

    except Exception as e:
        db_session.status = "error"
        await db.commit()
        raise HTTPException(status_code=500, detail=f"Failed to create session: {e!s}")

    return TerminalAgentSessionResponse(
        id=db_session.id,
        user_id=str(db_session.user_id),
        workspace_id=db_session.workspace_id,
        agent_type_id=str(db_session.agent_type_id),
        env_profile_id=str(db_session.env_profile_id) if db_session.env_profile_id else None,
        status=db_session.status,
        created_at=db_session.created_at.isoformat(),
        last_heartbeat_at=db_session.last_heartbeat_at.isoformat(),
    )


@router.get("/env-profiles", response_model=list[EnvProfileResponse])
async def list_env_profiles(current_user: CurrentUser, db: DbSession) -> list[EnvProfileResponse]:
    """List environment profiles for the current user."""
    result = await db.execute(
        select(ExternalAgentEnvProfile).where(ExternalAgentEnvProfile.user_id == current_user["id"])
    )
    profiles = result.scalars().all()

    return [
        EnvProfileResponse(
            id=str(p.id),
            name=p.name,
            agent_type_id=str(p.agent_type_id) if p.agent_type_id else None,
            env_vars=p.env_vars,
            created_at=p.created_at.isoformat(),
            updated_at=p.updated_at.isoformat(),
        )
        for p in profiles
    ]


@router.post("/env-profiles", response_model=EnvProfileResponse)
async def create_env_profile(
    request: CreateEnvProfileRequest,
    current_user: CurrentUser,
    db: DbSession,
) -> EnvProfileResponse:
    """Create a new environment profile."""
    # SECURITY: Validate env var names before storing
    if request.env_vars:
        invalid_keys = [key for key in request.env_vars if not validate_env_var_name(key)]
        if invalid_keys:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid environment variable names: {', '.join(invalid_keys[:5])}. "
                f"Names must start with a letter or underscore and contain only "
                f"alphanumeric characters and underscores.",
            )
        # SECURITY: Validate value lengths
        oversized_keys = [
            key for key, value in request.env_vars.items() if len(value) > ENV_VAR_VALUE_MAX_LENGTH
        ]
        if oversized_keys:
            raise HTTPException(
                status_code=400,
                detail=f"Environment variable values too large: {', '.join(oversized_keys[:5])}. "
                f"Maximum value length is {ENV_VAR_VALUE_MAX_LENGTH} characters.",
            )

    profile = ExternalAgentEnvProfile(
        user_id=current_user["id"],
        name=request.name,
        agent_type_id=UUID(request.agent_type_id) if request.agent_type_id else None,
        env_vars=request.env_vars,
    )
    db.add(profile)
    await db.commit()

    return EnvProfileResponse(
        id=str(profile.id),
        name=profile.name,
        agent_type_id=str(profile.agent_type_id) if profile.agent_type_id else None,
        env_vars=profile.env_vars,
        created_at=profile.created_at.isoformat(),
        updated_at=profile.updated_at.isoformat(),
    )


# ==================== Admin routes ====================
# NOTE: These MUST be defined BEFORE /{session_id} routes to avoid path conflicts


class UpdateTerminalAgentTypeRequest(BaseModel):
    """Request model for updating a terminal agent type."""

    name: str | None = None
    slug: str | None = None
    logo_url: str | None = None
    description: str | None = None
    check_installed_command: list[str] | None = None
    version_command: list[str] | None = None
    install_command: list[str] | None = None
    update_command: list[str] | None = None
    run_command: list[str] | None = None
    default_env_template: dict[str, str] | None = None
    is_enabled: bool | None = None


@router.get("/admin/terminal-agent-types", response_model=list[TerminalAgentTypeDetailResponse])
@require_admin
async def admin_list_terminal_agent_types(
    _request: Request,
    db: DbSession,
) -> list[TerminalAgentTypeDetailResponse]:
    """Admin: List all terminal agent types (requires admin role)."""
    result = await db.execute(select(TerminalIntegratedAgentType))
    agent_types = result.scalars().all()

    return [
        TerminalAgentTypeDetailResponse(
            id=str(at.id),
            name=at.name,
            slug=at.slug,
            logo_url=at.logo_url,
            description=at.description,
            is_enabled=at.is_enabled,
            check_installed_command=at.check_installed_command,
            version_command=at.version_command,
            install_command=at.install_command,
            update_command=at.update_command,
            run_command=at.run_command or [],
            default_env_template=at.default_env_template,
            created_at=at.created_at.isoformat(),
            updated_at=at.updated_at.isoformat(),
        )
        for at in agent_types
    ]


@router.post("/admin/terminal-agent-types", response_model=TerminalAgentTypeResponse)
@require_admin
async def admin_create_terminal_agent_type(
    request: Request,
    data: CreateTerminalAgentTypeRequest,
    db: DbSession,
) -> TerminalAgentTypeResponse:
    """Admin: Create a new terminal agent type."""
    # Check if slug already exists
    result = await db.execute(
        select(TerminalIntegratedAgentType).where(TerminalIntegratedAgentType.slug == data.slug)
    )
    if result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Slug already exists")

    agent_type = TerminalIntegratedAgentType(
        name=data.name,
        slug=data.slug,
        logo_url=data.logo_url,
        description=data.description,
        check_installed_command=data.check_installed_command,
        version_command=data.version_command,
        install_command=data.install_command,
        update_command=data.update_command,
        run_command=data.run_command,
        default_env_template=data.default_env_template,
        is_enabled=True,
        created_by_admin_id=request.state.user_id,
    )
    db.add(agent_type)
    await db.commit()

    return TerminalAgentTypeResponse(
        id=str(agent_type.id),
        name=agent_type.name,
        slug=agent_type.slug,
        logo_url=agent_type.logo_url,
        description=agent_type.description,
        is_enabled=agent_type.is_enabled,
        created_at=agent_type.created_at.isoformat(),
        updated_at=agent_type.updated_at.isoformat(),
    )


@router.put("/admin/terminal-agent-types/{agent_id}", response_model=TerminalAgentTypeResponse)
@require_admin
async def admin_update_terminal_agent_type(
    _request: Request,
    agent_id: str,
    data: UpdateTerminalAgentTypeRequest,
    db: DbSession,
) -> TerminalAgentTypeResponse:
    """Admin: Update a terminal agent type."""
    result = await db.execute(
        select(TerminalIntegratedAgentType).where(TerminalIntegratedAgentType.id == UUID(agent_id))
    )
    agent_type = result.scalar_one_or_none()
    if not agent_type:
        raise HTTPException(status_code=404, detail="Agent type not found")

    # Update fields if provided
    if data.name is not None:
        agent_type.name = data.name
    if data.slug is not None:
        # Check if new slug conflicts with another agent
        slug_check = await db.execute(
            select(TerminalIntegratedAgentType).where(
                TerminalIntegratedAgentType.slug == data.slug,
                TerminalIntegratedAgentType.id != UUID(agent_id),
            )
        )
        if slug_check.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="Slug already exists")
        agent_type.slug = data.slug
    if data.logo_url is not None:
        agent_type.logo_url = data.logo_url
    if data.description is not None:
        agent_type.description = data.description
    if data.check_installed_command is not None:
        agent_type.check_installed_command = data.check_installed_command
    if data.version_command is not None:
        agent_type.version_command = data.version_command
    if data.install_command is not None:
        agent_type.install_command = data.install_command
    if data.update_command is not None:
        agent_type.update_command = data.update_command
    if data.run_command is not None:
        agent_type.run_command = data.run_command
    if data.default_env_template is not None:
        agent_type.default_env_template = data.default_env_template
    if data.is_enabled is not None:
        agent_type.is_enabled = data.is_enabled

    agent_type.updated_at = func.now()
    await db.commit()
    await db.refresh(agent_type)

    return TerminalAgentTypeResponse(
        id=str(agent_type.id),
        name=agent_type.name,
        slug=agent_type.slug,
        logo_url=agent_type.logo_url,
        description=agent_type.description,
        is_enabled=agent_type.is_enabled,
        created_at=agent_type.created_at.isoformat(),
        updated_at=agent_type.updated_at.isoformat(),
    )


@router.delete("/admin/terminal-agent-types/{agent_id}")
@require_admin
async def admin_delete_terminal_agent_type(
    _request: Request,
    agent_id: str,
    db: DbSession,
) -> dict[str, str]:
    """Admin: Delete a terminal agent type."""
    result = await db.execute(
        select(TerminalIntegratedAgentType).where(TerminalIntegratedAgentType.id == UUID(agent_id))
    )
    agent_type = result.scalar_one_or_none()
    if not agent_type:
        raise HTTPException(status_code=404, detail="Agent type not found")

    await db.delete(agent_type)
    await db.commit()

    return {"status": "deleted"}


# ==================== Session routes ====================
# NOTE: These MUST come AFTER fixed path routes like /admin/* and /env-profiles


@router.get("/{session_id}", response_model=TerminalAgentSessionResponse)
async def get_terminal_agent_session(
    session_id: str,
    current_user: CurrentUser,
    db: DbSession,
) -> TerminalAgentSessionResponse:
    """Get a terminal agent session by ID."""
    result = await db.execute(
        select(TerminalAgentSession).where(
            TerminalAgentSession.id == session_id,
            TerminalAgentSession.user_id == current_user["id"],
        )
    )
    db_session = result.scalar_one_or_none()
    if not db_session:
        raise HTTPException(status_code=404, detail="Session not found")

    return TerminalAgentSessionResponse(
        id=str(db_session.id),
        user_id=str(db_session.user_id),
        workspace_id=db_session.workspace_id,
        agent_type_id=str(db_session.agent_type_id),
        env_profile_id=str(db_session.env_profile_id) if db_session.env_profile_id else None,
        status=db_session.status,
        created_at=db_session.created_at.isoformat(),
        last_heartbeat_at=db_session.last_heartbeat_at.isoformat(),
    )


@router.delete("/{session_id}")
async def close_terminal_agent_session(
    session_id: str,
    current_user: CurrentUser,
    db: DbSession,
) -> dict[str, str]:
    """Close a terminal agent session."""
    # Verify ownership
    result = await db.execute(
        select(TerminalAgentSession).where(
            TerminalAgentSession.id == session_id,
            TerminalAgentSession.user_id == current_user["id"],
        )
    )
    db_session = result.scalar_one_or_none()
    if not db_session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Close the actual session
    await terminal_session_manager.close_session(session_id)

    # Update database
    db_session.status = "exited"
    await db.commit()

    return {"message": "Session closed"}


@router.websocket("/{session_id}/ws")
async def terminal_agent_websocket(
    websocket: WebSocket,
    session_id: str,
    db: DbSession,
    token: str | None = Query(default=None),
) -> None:
    """WebSocket endpoint for terminal agent interaction.

    WebSocket connections can't send Authorization headers, so authentication
    is done via a token query parameter.
    """
    # Validate token before accepting the connection
    if not token:
        token = websocket.cookies.get(COOKIE_ACCESS_TOKEN)
    user_id = await validate_ws_token(token, db)
    if not user_id:
        await websocket.close(code=1008)  # Policy violation - unauthorized
        return

    await websocket.accept()

    # Verify session ownership
    result = await db.execute(
        select(TerminalAgentSession).where(
            TerminalAgentSession.id == session_id,
            TerminalAgentSession.user_id == user_id,
        )
    )
    db_session = result.scalar_one_or_none()
    if not db_session:
        await websocket.close(code=1008)  # Policy violation - not owner
        return

    # Check if terminal session exists in memory
    if not await terminal_session_manager.get_session(session_id):
        # Session not in memory - try to reattach if DB says it's still running
        # This handles page refresh / reconnection scenarios where the tmux
        # session is still alive but the in-memory state was lost
        if db_session.status == "running":
            logger.info(
                "Attempting to reattach to terminal agent session",
                session_id=session_id,
                workspace_id=db_session.workspace_id,
            )

            # Load agent type for reattachment
            agent_type_result = await db.execute(
                select(TerminalIntegratedAgentType).where(
                    TerminalIntegratedAgentType.id == db_session.agent_type_id
                )
            )
            agent_type = agent_type_result.scalar_one_or_none()

            if not agent_type:
                await websocket.send_json(
                    {"type": "error", "message": "Agent type not found. Please restart the agent."}
                )
                await websocket.close(code=1011)
                return

            # Load env profile if one was used
            env_profile: ExternalAgentEnvProfile | None = None
            if db_session.env_profile_id:
                env_profile_result = await db.execute(
                    select(ExternalAgentEnvProfile).where(
                        ExternalAgentEnvProfile.id == db_session.env_profile_id
                    )
                )
                env_profile = env_profile_result.scalar_one_or_none()

            try:
                # Attempt to reattach to the existing tmux session
                await terminal_session_manager.reattach_session(
                    session_id=session_id,
                    workspace_id=db_session.workspace_id,
                    agent_type=agent_type,
                    env_profile=env_profile,
                    user_id=user_id,
                )
                logger.info(
                    "Successfully reattached to terminal agent session",
                    session_id=session_id,
                )
            except Exception as e:
                # Reattach failed - tmux session may have died
                logger.warning(
                    "Failed to reattach to terminal agent session",
                    session_id=session_id,
                    error=str(e),
                )
                # Mark session as exited since we can't reconnect
                db_session.status = "exited"
                await db.commit()

                await websocket.send_json(
                    {
                        "type": "error",
                        "message": "Terminal session ended. Please restart the agent.",
                    }
                )
                await websocket.close(code=1011)
                return
        else:
            # DB session is not running - can't reattach
            await websocket.send_json(
                {
                    "type": "error",
                    "message": "Terminal agent session not found. Please restart the agent.",
                }
            )
            await websocket.close(code=1011)
            return

    try:
        while not terminal_session_manager.is_shutting_down:
            # Read output from terminal
            output = await terminal_session_manager.read_output(session_id)

            # Session was closed or lost
            if output is None and not await terminal_session_manager.get_session(session_id):
                await websocket.send_json({"type": "error", "message": "Terminal session ended"})
                break

            if output:
                await websocket.send_json({"type": "output", "data": output})

            # Check for client messages
            try:
                message = await asyncio.wait_for(websocket.receive_json(), timeout=0.1)
                if message.get("type") == "input":
                    data = message.get("data", "")
                    await terminal_session_manager.write_input(session_id, data)
                elif message.get("type") == "resize":
                    rows = message.get("rows", 24)
                    cols = message.get("cols", 80)
                    await terminal_session_manager.resize_terminal(session_id, rows, cols)
                elif message.get("type") == "heartbeat":
                    # Update last heartbeat
                    db_session.last_heartbeat_at = func.now()
                    await db.commit()

            except TimeoutError:
                continue

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.exception("Terminal agent WebSocket error", session_id=session_id, error=str(e))
    finally:
        # Ensure WebSocket is closed
        with contextlib.suppress(Exception):
            await websocket.close()


_MIN_BASH_CMD_PARTS = 3  # Minimum parts for bash -c pattern: ["bash", "-c", "command"]


def _build_shell_command(cmd_parts: list[str]) -> str:
    """Build a shell command from parts, handling bash -c properly.

    SECURITY: Uses shlex.quote for all user-controlled values to prevent
    shell injection attacks.

    If the command starts with 'bash -lc' or 'bash -c', the remaining parts
    are the command string that should be passed as a single argument.
    """
    if not cmd_parts:
        return ""

    # Check for bash -c or bash -lc pattern
    if len(cmd_parts) >= _MIN_BASH_CMD_PARTS and cmd_parts[0] == "bash":
        flags = cmd_parts[1]
        # SECURITY: Only allow known safe flags
        if flags in ("-c", "-lc", "-cl"):
            # Everything after the flags is the command string
            # SECURITY: Quote the entire command string to prevent injection
            cmd_string = " ".join(cmd_parts[2:])
            return f"bash {shlex.quote(flags)} {shlex.quote(cmd_string)}"

    # Default: quote each part to prevent injection
    return " ".join(shlex.quote(part) for part in cmd_parts)


async def _check_installation_in_workspace(
    compute_client: ComputeClient,
    workspace_id: str,
    user_id: str,
    agent_type: TerminalIntegratedAgentType,
) -> bool:
    """Check if the agent is installed in the workspace container."""
    if not agent_type.check_installed_command:
        return True  # Assume installed if no check command

    try:
        command = _build_shell_command(agent_type.check_installed_command)
        logger.info(
            "Checking agent installation",
            workspace_id=workspace_id,
            agent=agent_type.slug,
            command=command,
        )
        result = await compute_client.exec_command(workspace_id, user_id, command)
        exit_code = int(result.get("exit_code", 1))
        is_installed = exit_code == 0
        logger.info(
            "Installation check result",
            workspace_id=workspace_id,
            agent=agent_type.slug,
            is_installed=is_installed,
            exit_code=exit_code,
            stdout=str(result.get("stdout", ""))[:200],
            stderr=str(result.get("stderr", ""))[:200],
        )
        return is_installed
    except Exception as e:
        logger.warning(
            "Failed to check agent installation",
            workspace_id=workspace_id,
            agent=agent_type.slug,
            error=str(e),
        )
        return False


async def _install_agent_in_workspace(
    compute_client: ComputeClient,
    workspace_id: str,
    user_id: str,
    agent_type: TerminalIntegratedAgentType,
) -> bool:
    """Install the agent in the workspace container."""
    if not agent_type.install_command:
        logger.warning(
            "No install command for agent",
            workspace_id=workspace_id,
            agent=agent_type.slug,
        )
        return False

    try:
        command = _build_shell_command(agent_type.install_command)
        logger.info(
            "Installing agent in workspace",
            workspace_id=workspace_id,
            agent=agent_type.slug,
            command=command,
        )
        result = await compute_client.exec_command(
            workspace_id,
            user_id,
            command,
            exec_timeout=300,  # 5 min timeout for install
        )
        exit_code = int(result.get("exit_code", 1))
        success = exit_code == 0
        stdout_str = str(result.get("stdout", ""))
        stderr_str = str(result.get("stderr", ""))
        logger.info(
            "Installation result",
            workspace_id=workspace_id,
            agent=agent_type.slug,
            success=success,
            exit_code=exit_code,
            stdout=stdout_str[:500],
            stderr=stderr_str[:500],
        )
        if not success:
            logger.warning(
                "Agent installation failed",
                workspace_id=workspace_id,
                agent=agent_type.slug,
                stderr=stderr_str,
            )
        return success
    except Exception as e:
        logger.exception(
            "Failed to install agent",
            workspace_id=workspace_id,
            agent=agent_type.slug,
            error=str(e),
        )
        return False
