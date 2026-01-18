"""User configuration and dotfiles routes."""

import re
from datetime import UTC, datetime
from typing import Annotated, Any

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.cache import cache_delete, cache_get, cache_set, user_config_key
from src.config import settings
from src.database.connection import get_db
from src.database.models import User, UserConfig
from src.middleware.rate_limit import RATE_LIMIT_SENSITIVE, RATE_LIMIT_STANDARD, limiter
from src.storage.gcs import get_storage

logger = structlog.get_logger()

router = APIRouter()

# Type alias for database session dependency
DbSession = Annotated[AsyncSession, Depends(get_db)]


# Mapping of request field names to config attribute names
CONFIG_FIELD_MAP = [
    "sync_dotfiles",
    "dotfiles_repo",
    "dotfiles_paths",
    "default_shell",
    "default_editor",
    "git_name",
    "git_email",
    "default_template_id",
    "theme",
    "editor_theme",
    "default_standby_timeout_minutes",
    "custom_keybindings",
    "editor_settings",
    "ui_preferences",
    "voice_preferences",
    "agent_preferences",
]


def _apply_config_updates(
    config: UserConfig,
    request_data: "UpdateUserConfigRequest",
) -> None:
    """Apply updates from request data to config object."""
    for field in CONFIG_FIELD_MAP:
        value = getattr(request_data, field, None)
        if value is not None:
            setattr(config, field, value)


# Valid git URL pattern for dotfiles repos (only allow GitHub for now)
DOTFILES_REPO_PATTERN = re.compile(
    r"^https://github\.com/[a-zA-Z0-9][-a-zA-Z0-9]*/[a-zA-Z0-9._-]+/?$",
)

# Valid dotfiles path pattern (prevent path traversal and dangerous paths)
DOTFILES_PATH_PATTERN = re.compile(r"^\.?[a-zA-Z0-9][a-zA-Z0-9._/-]*$")

# Maximum tour ID length
MAX_TOUR_ID_LENGTH = 50

# SECURITY: Dotfiles upload limits
MAX_DOTFILE_SIZE_BYTES = 1024 * 1024  # 1 MB per file
MAX_DOTFILES_PER_UPLOAD = 20  # Maximum files per upload request

# SECURITY: LLM API key patterns for validation by provider
# These patterns help ensure API keys are in the expected format
LLM_API_KEY_PATTERNS = {
    "openai": re.compile(r"^sk-[a-zA-Z0-9]{20,}$"),  # sk-... format
    "anthropic": re.compile(r"^sk-ant-[a-zA-Z0-9-]{20,}$"),  # sk-ant-... format
    "google": re.compile(r"^[a-zA-Z0-9_-]{30,}$"),  # Google AI Studio keys
    "ollama": re.compile(r"^.{0,200}$"),  # Ollama typically uses no key or custom
    "lmstudio": re.compile(r"^.{0,200}$"),  # LM Studio typically uses no key or custom
}

# Paths that should never be synced (security sensitive)
FORBIDDEN_DOTFILE_PATHS = {
    ".ssh/id_rsa",
    ".ssh/id_ed25519",
    ".ssh/id_ecdsa",
    ".ssh/id_dsa",
    ".gnupg",
    ".aws/credentials",
    ".netrc",
}


def validate_dotfiles_repo(repo_url: str) -> None:
    """Validate dotfiles repository URL.

    Raises:
        HTTPException: If the URL is invalid or not allowed.
    """
    if not repo_url:
        return

    if not DOTFILES_REPO_PATTERN.match(repo_url):
        raise HTTPException(
            status_code=400,
            detail="Invalid dotfiles repository URL. Only GitHub repositories are supported.",
        )


def validate_dotfiles_paths(paths: list[str]) -> None:
    """Validate dotfiles paths.

    Raises:
        HTTPException: If any path is invalid or forbidden.
    """
    if not paths:
        return

    for path in paths:
        # Check for path traversal
        if ".." in path or path.startswith("/"):
            msg = f"Invalid dotfile path: {path}. Cannot contain '..' or start with '/'"
            raise HTTPException(status_code=400, detail=msg)

        # Check pattern
        if not DOTFILES_PATH_PATTERN.match(path):
            msg = f"Invalid dotfile path: {path}. Only alphanumeric, dot, _, / allowed"
            raise HTTPException(status_code=400, detail=msg)

        # Check forbidden paths
        if path in FORBIDDEN_DOTFILE_PATHS or any(
            path.startswith(forbidden) for forbidden in FORBIDDEN_DOTFILE_PATHS
        ):
            raise HTTPException(
                status_code=400,
                detail=f"Forbidden dotfile path: {path}. This path contains sensitive data.",
            )


# Default dotfiles paths to sync
DEFAULT_DOTFILES = [
    ".bashrc",
    ".zshrc",
    ".gitconfig",
    ".npmrc",
    ".vimrc",
    ".profile",
    ".config/starship.toml",
    ".ssh/config",  # Only the config, not keys
    # CLI agent config directories
    ".claude/",
    ".claude.json",
    ".codex/",
    ".gemini/",
    ".opencode/",
]


class UserConfigResponse(BaseModel):
    """User config response."""

    id: str
    user_id: str
    sync_dotfiles: bool
    dotfiles_repo: str | None
    dotfiles_paths: list[str] | None
    default_shell: str
    default_editor: str
    git_name: str | None
    git_email: str | None
    default_template_id: str | None
    theme: str
    editor_theme: str
    default_standby_timeout_minutes: int | None  # None = Never
    custom_keybindings: dict[str, Any] | None
    editor_settings: dict[str, Any] | None
    ui_preferences: dict[str, Any] | None
    voice_preferences: dict[str, Any] | None
    agent_preferences: dict[str, Any] | None


class UpdateUserConfigRequest(BaseModel):
    """Request to update user config."""

    sync_dotfiles: bool | None = None
    dotfiles_repo: str | None = None
    dotfiles_paths: list[str] | None = None
    default_shell: str | None = None
    default_editor: str | None = None
    git_name: str | None = None
    git_email: str | None = None
    default_template_id: str | None = None
    theme: str | None = None
    editor_theme: str | None = None
    default_standby_timeout_minutes: int | None = None
    custom_keybindings: dict[str, Any] | None = None
    editor_settings: dict[str, Any] | None = None
    ui_preferences: dict[str, Any] | None = None
    voice_preferences: dict[str, Any] | None = None
    agent_preferences: dict[str, Any] | None = None


class DotfileContent(BaseModel):
    """Dotfile content."""

    path: str
    content: str


class DotfilesUploadRequest(BaseModel):
    """Request to upload dotfiles."""

    files: list[DotfileContent]

    @property
    def validated_files(self) -> list[DotfileContent]:
        """Validate and return files with security checks."""

        class TooManyFilesError(ValueError):
            def __init__(self, max_files: int) -> None:
                super().__init__(f"Too many files (max {max_files})")

        class FileTooLargeError(ValueError):
            def __init__(self, path: str, max_size_kb: int) -> None:
                super().__init__(f"File {path} too large (max {max_size_kb}KB)")

        if len(self.files) > MAX_DOTFILES_PER_UPLOAD:
            raise TooManyFilesError(MAX_DOTFILES_PER_UPLOAD)
        for f in self.files:
            if len(f.content.encode("utf-8")) > MAX_DOTFILE_SIZE_BYTES:
                raise FileTooLargeError(f.path, MAX_DOTFILE_SIZE_BYTES // 1024)
        return self.files


@router.get("", response_model=UserConfigResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_user_config(
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> UserConfigResponse:
    """Get current user's configuration."""
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")

    # Try cache first
    cache_key = user_config_key(user_id)
    cached = await cache_get(cache_key)
    if cached is not None:
        logger.debug("User config cache hit", user_id=user_id)
        return UserConfigResponse(**cached)

    result = await db.execute(select(UserConfig).where(UserConfig.user_id == user_id))
    config = result.scalar_one_or_none()

    # Create default config if not exists
    if not config:
        # Verify user exists before creating config
        user_result = await db.execute(select(User).where(User.id == user_id))
        user = user_result.scalar_one_or_none()
        if not user:
            raise HTTPException(
                status_code=401,
                detail="Invalid authentication token - user not found",
            )

        config = UserConfig(
            user_id=user_id,
            dotfiles_paths=DEFAULT_DOTFILES,
            s3_dotfiles_path=f"users/{user_id}/dotfiles",
        )
        db.add(config)
        await db.commit()
        await db.refresh(config)

    config_response = UserConfigResponse(
        id=config.id,
        user_id=config.user_id,
        sync_dotfiles=config.sync_dotfiles,
        dotfiles_repo=config.dotfiles_repo,
        dotfiles_paths=config.dotfiles_paths,
        default_shell=config.default_shell,
        default_editor=config.default_editor,
        git_name=config.git_name,
        git_email=config.git_email,
        default_template_id=config.default_template_id,
        theme=config.theme,
        editor_theme=config.editor_theme,
        default_standby_timeout_minutes=config.default_standby_timeout_minutes,
        custom_keybindings=config.custom_keybindings,
        editor_settings=config.editor_settings,
        ui_preferences=config.ui_preferences,
        voice_preferences=config.voice_preferences,
        agent_preferences=config.agent_preferences,
    )

    # Cache the result
    await cache_set(cache_key, config_response, ttl=settings.CACHE_TTL_USER_CONFIG)

    return config_response


@router.patch("", response_model=UserConfigResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def update_user_config(
    request_data: UpdateUserConfigRequest,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> UserConfigResponse:
    """Update current user's configuration."""
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")

    result = await db.execute(select(UserConfig).where(UserConfig.user_id == user_id))
    config = result.scalar_one_or_none()

    # Create if not exists
    if not config:
        # Verify user exists before creating config
        user_result = await db.execute(select(User).where(User.id == user_id))
        user = user_result.scalar_one_or_none()
        if not user:
            raise HTTPException(
                status_code=401,
                detail="Invalid authentication token - user not found",
            )

        config = UserConfig(
            user_id=user_id,
            dotfiles_paths=DEFAULT_DOTFILES,
            s3_dotfiles_path=f"users/{user_id}/dotfiles",
        )
        db.add(config)

    # Validate dotfiles inputs before updating
    if request_data.dotfiles_repo is not None:
        validate_dotfiles_repo(request_data.dotfiles_repo)
    if request_data.dotfiles_paths is not None:
        validate_dotfiles_paths(request_data.dotfiles_paths)

    # Update fields using helper function
    _apply_config_updates(config, request_data)

    await db.commit()
    await db.refresh(config)

    # Invalidate cache
    await cache_delete(user_config_key(user_id))

    config_response = UserConfigResponse(
        id=config.id,
        user_id=config.user_id,
        sync_dotfiles=config.sync_dotfiles,
        dotfiles_repo=config.dotfiles_repo,
        dotfiles_paths=config.dotfiles_paths,
        default_shell=config.default_shell,
        default_editor=config.default_editor,
        git_name=config.git_name,
        git_email=config.git_email,
        default_template_id=config.default_template_id,
        theme=config.theme,
        editor_theme=config.editor_theme,
        default_standby_timeout_minutes=config.default_standby_timeout_minutes,
        custom_keybindings=config.custom_keybindings,
        editor_settings=config.editor_settings,
        ui_preferences=config.ui_preferences,
        voice_preferences=config.voice_preferences,
        agent_preferences=config.agent_preferences,
    )

    # Cache the new value
    await cache_set(user_config_key(user_id), config_response, ttl=settings.CACHE_TTL_USER_CONFIG)

    return config_response


@router.get("/dotfiles", response_model=list[DotfileContent])
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_dotfiles(
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> list[DotfileContent]:
    """Get user's synced dotfiles content."""
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")

    storage = get_storage()

    # Get user config to find S3 path
    result = await db.execute(select(UserConfig).where(UserConfig.user_id == user_id))
    config = result.scalar_one_or_none()

    if not config or not config.dotfiles_paths:
        return []

    dotfiles = []
    for path in config.dotfiles_paths:
        try:
            # Read from S3 user dotfiles prefix
            content = await storage.get_file_text(
                f"user-{user_id}",  # Use user ID as workspace ID for dotfiles
                path,
            )
            dotfiles.append(DotfileContent(path=path, content=content))
        except FileNotFoundError:
            # File doesn't exist yet, skip
            logger.debug("Dotfile not found, skipping", path=path, user_id=user_id)
            continue
        except Exception:
            # Other errors, skip with logging
            logger.warning("Failed to read dotfile, skipping", path=path, user_id=user_id)
            continue

    return dotfiles


@router.post("/dotfiles")
@limiter.limit(RATE_LIMIT_SENSITIVE)  # Stricter rate limit for upload operations
async def upload_dotfiles(
    request_data: DotfilesUploadRequest,
    request: Request,
    response: Response,  # noqa: ARG001
    _db: DbSession,
) -> dict[str, Any]:
    """Upload/sync user's dotfiles to S3."""
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")

    # SECURITY: Validate file count and sizes before processing
    try:
        validated_files = request_data.validated_files
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    # Validate all paths (security check for path traversal, forbidden paths)
    validate_dotfiles_paths([f.path for f in validated_files])

    storage = get_storage()

    uploaded = 0
    errors = []

    for file in validated_files:
        try:
            await storage.put_file(
                f"user-{user_id}",  # Use user ID as workspace ID for dotfiles
                file.path,
                file.content,
            )
            uploaded += 1
        except Exception:
            # Log the actual error but don't expose internals to client
            logger.exception("Failed to upload dotfile", path=file.path, user_id=user_id)
            errors.append({"path": file.path, "error": "Failed to upload file"})

    return {
        "uploaded": uploaded,
        "errors": errors,
    }


@router.delete("/dotfiles/{path:path}")
@limiter.limit(RATE_LIMIT_STANDARD)
async def delete_dotfile(
    path: str,
    request: Request,
    response: Response,  # noqa: ARG001
    _db: DbSession,
) -> dict[str, Any]:
    """Delete a specific dotfile from S3."""
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")

    # Validate path to prevent path traversal
    validate_dotfiles_paths([path])

    storage = get_storage()

    try:
        await storage.delete_file(f"user-{user_id}", path)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail="File not found") from e
    except Exception:
        # Log the actual error but don't expose internals to client
        logger.exception("Failed to delete dotfile", path=path, user_id=user_id)
        raise HTTPException(status_code=500, detail="Failed to delete file") from None
    return {"deleted": path}


@router.post("/dotfiles/sync-from-repo")
@limiter.limit("5/hour")  # SECURITY: Very strict rate limit - this clones git repos
async def sync_dotfiles_from_repo(
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> dict[str, Any]:
    """Sync dotfiles from user's dotfiles git repository."""
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")

    result = await db.execute(select(UserConfig).where(UserConfig.user_id == user_id))
    config = result.scalar_one_or_none()

    if not config or not config.dotfiles_repo:
        raise HTTPException(status_code=400, detail="No dotfiles repository configured")

    import asyncio
    import shutil
    import tempfile
    from pathlib import Path

    # Get dotfiles configuration
    dotfiles_repo = config.dotfiles_repo
    dotfiles_branch = config.dotfiles_branch or "main"
    dotfiles_files = config.dotfiles_files or [".bashrc", ".zshrc", ".gitconfig", ".vimrc"]

    temp_dir = None
    synced_files: list[str] = []
    errors: list[str] = []

    try:
        # Create temp directory for cloning
        temp_dir = tempfile.mkdtemp(prefix="podex-dotfiles-")
        clone_path = Path(temp_dir) / "repo"

        # Clone the repository (shallow clone for speed)
        clone_cmd = [
            "git",
            "clone",
            "--depth",
            "1",
            "--branch",
            dotfiles_branch,
            dotfiles_repo,
            str(clone_path),
        ]
        process = await asyncio.create_subprocess_exec(
            *clone_cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=60)

        if process.returncode != 0:
            error_msg = stderr.decode() if stderr else "Unknown git error"
            raise HTTPException(  # noqa: TRY301
                status_code=400, detail=f"Clone failed: {error_msg}"
            )

        # Upload specified files to GCS
        from google.cloud import storage  # type: ignore[attr-defined,import-untyped]

        gcs_client = storage.Client(project=settings.GCP_PROJECT_ID)
        bucket = gcs_client.bucket(settings.GCS_BUCKET)

        for dotfile in dotfiles_files:
            file_path = clone_path / dotfile.lstrip("/").lstrip("~").lstrip("./")
            if file_path.exists() and file_path.is_file():
                try:
                    gcs_key = f"dotfiles/{user_id}/{dotfile.lstrip('./')}"
                    blob = bucket.blob(gcs_key)
                    blob.upload_from_filename(str(file_path))
                    synced_files.append(dotfile)
                    logger.info("Synced dotfile to GCS", user_id=user_id, file=dotfile)
                except Exception as e:
                    errors.append(f"{dotfile}: {e!s}")
                    logger.warning(
                        "Failed to sync dotfile", user_id=user_id, file=dotfile, error=str(e)
                    )
            else:
                errors.append(f"{dotfile}: File not found in repository")

        # Update config with last sync time
        config.dotfiles_last_sync = datetime.now(UTC)
        await db.commit()

    except TimeoutError:
        raise HTTPException(status_code=504, detail="Timeout cloning dotfiles repository") from None
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error syncing dotfiles", user_id=user_id)
        raise HTTPException(status_code=500, detail=f"Error syncing dotfiles: {e!s}") from None
    finally:
        # Clean up temp directory
        if temp_dir:
            shutil.rmtree(temp_dir, ignore_errors=True)

    return {
        "status": "success"
        if synced_files and not errors
        else "partial"
        if synced_files
        else "error",
        "message": f"Synced {len(synced_files)} files"
        + (f", {len(errors)} errors" if errors else ""),
        "repo": dotfiles_repo,
        "synced_files": synced_files,
        "errors": errors if errors else None,
    }


# Tour completion endpoints for cross-device persistence


class CompletedToursResponse(BaseModel):
    """Response containing list of completed tours."""

    completed_tours: list[str]


@router.get("/tours", response_model=CompletedToursResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_completed_tours(
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> CompletedToursResponse:
    """Get list of completed onboarding tours for the user."""
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")

    result = await db.execute(select(UserConfig).where(UserConfig.user_id == user_id))
    config = result.scalar_one_or_none()

    if not config:
        return CompletedToursResponse(completed_tours=[])

    return CompletedToursResponse(completed_tours=config.completed_tours or [])


@router.post("/tours/{tour_id}/complete")
@limiter.limit(RATE_LIMIT_STANDARD)
async def complete_tour(
    tour_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> CompletedToursResponse:
    """Mark a tour as completed."""
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")

    # Validate tour_id (alphanumeric and hyphens only, max 50 chars)
    if (
        not tour_id
        or len(tour_id) > MAX_TOUR_ID_LENGTH
        or not re.match(r"^[a-zA-Z0-9-]+$", tour_id)
    ):
        raise HTTPException(status_code=400, detail="Invalid tour ID")

    result = await db.execute(select(UserConfig).where(UserConfig.user_id == user_id))
    config = result.scalar_one_or_none()

    # Create config if not exists
    if not config:
        config = UserConfig(
            user_id=user_id,
            dotfiles_paths=DEFAULT_DOTFILES,
            s3_dotfiles_path=f"users/{user_id}/dotfiles",
            completed_tours=[tour_id],
        )
        db.add(config)
    else:
        # Add tour to completed list if not already there
        completed = config.completed_tours or []
        if tour_id not in completed:
            config.completed_tours = [*completed, tour_id]

    await db.commit()
    await db.refresh(config)

    # Invalidate cache
    await cache_delete(user_config_key(user_id))

    return CompletedToursResponse(completed_tours=config.completed_tours or [])


@router.delete("/tours/{tour_id}")
@limiter.limit(RATE_LIMIT_STANDARD)
async def uncomplete_tour(
    tour_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> CompletedToursResponse:
    """Remove a tour from the completed list (allows re-watching)."""
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")

    result = await db.execute(select(UserConfig).where(UserConfig.user_id == user_id))
    config = result.scalar_one_or_none()

    if not config:
        return CompletedToursResponse(completed_tours=[])

    # Remove tour from completed list
    completed = config.completed_tours or []
    if tour_id in completed:
        config.completed_tours = [t for t in completed if t != tour_id]
        await db.commit()
        await db.refresh(config)

    # Invalidate cache
    await cache_delete(user_config_key(user_id))

    return CompletedToursResponse(completed_tours=config.completed_tours or [])


@router.delete("/tours")
@limiter.limit(RATE_LIMIT_STANDARD)
async def reset_all_tours(
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> CompletedToursResponse:
    """Reset all completed tours (allows re-watching all tutorials)."""
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")

    result = await db.execute(select(UserConfig).where(UserConfig.user_id == user_id))
    config = result.scalar_one_or_none()

    if config:
        config.completed_tours = []
        await db.commit()
        await db.refresh(config)

    # Invalidate cache
    await cache_delete(user_config_key(user_id))

    return CompletedToursResponse(completed_tours=[])


# ============================================================================
# LLM API Keys Management
# ============================================================================

# Valid provider names for API keys
# Cloud providers: openai, anthropic, google
# Local providers: ollama, lmstudio
VALID_LLM_PROVIDERS = {"openai", "anthropic", "google", "ollama", "lmstudio"}


class LLMApiKeysResponse(BaseModel):
    """Response with list of configured LLM providers (not the actual keys)."""

    providers: list[str]  # List of provider names that have keys configured


class SetLLMApiKeyRequest(BaseModel):
    """Request to set an LLM API key for a provider."""

    provider: str
    api_key: str


class RemoveLLMApiKeyRequest(BaseModel):
    """Request to remove an LLM API key."""

    provider: str


@router.get("/llm-api-keys")
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_llm_api_keys(
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> LLMApiKeysResponse:
    """Get list of LLM providers with configured API keys.

    Returns the provider names only, not the actual keys (security).
    """
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")

    result = await db.execute(select(UserConfig).where(UserConfig.user_id == user_id))
    config = result.scalar_one_or_none()

    if not config or not config.llm_api_keys:
        return LLMApiKeysResponse(providers=[])

    # Return only provider names, not the actual keys
    providers = list(config.llm_api_keys.keys())
    return LLMApiKeysResponse(providers=providers)


@router.post("/llm-api-keys")
@limiter.limit(RATE_LIMIT_STANDARD)
async def set_llm_api_key(
    data: SetLLMApiKeyRequest,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> LLMApiKeysResponse:
    """Set an LLM API key for a provider.

    The key is stored encrypted in the database.
    """
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")

    # Validate provider
    provider_lower = data.provider.lower()
    if provider_lower not in VALID_LLM_PROVIDERS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid provider. Must be one of: {', '.join(sorted(VALID_LLM_PROVIDERS))}",
        )

    # SECURITY: Validate API key format using provider-specific patterns
    # This helps prevent storing invalid/malicious data in the database
    if not data.api_key:
        raise HTTPException(status_code=400, detail="API key is required")

    key_pattern = LLM_API_KEY_PATTERNS.get(provider_lower)
    if (
        key_pattern
        and not key_pattern.match(data.api_key)
        and provider_lower in {"openai", "anthropic", "google"}
    ):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid API key format for {provider_lower}. Please check your API key.",
        )

    result = await db.execute(select(UserConfig).where(UserConfig.user_id == user_id))
    config = result.scalar_one_or_none()

    if not config:
        # Create config with the API key
        config = UserConfig(
            user_id=user_id,
            dotfiles_paths=DEFAULT_DOTFILES,
            s3_dotfiles_path=f"users/{user_id}/dotfiles",
            llm_api_keys={provider_lower: data.api_key},
        )
        db.add(config)
    else:
        # Update existing config
        current_keys = config.llm_api_keys or {}
        current_keys[provider_lower] = data.api_key
        config.llm_api_keys = current_keys

    await db.commit()
    await db.refresh(config)

    # Invalidate cache
    await cache_delete(user_config_key(user_id))

    logger.info(
        "User set LLM API key",
        user_id=user_id,
        provider=provider_lower,
    )

    providers = list(config.llm_api_keys.keys()) if config.llm_api_keys else []
    return LLMApiKeysResponse(providers=providers)


@router.delete("/llm-api-keys/{provider}")
@limiter.limit(RATE_LIMIT_STANDARD)
async def remove_llm_api_key(
    provider: str,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> LLMApiKeysResponse:
    """Remove an LLM API key for a provider."""
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")

    provider_lower = provider.lower()

    result = await db.execute(select(UserConfig).where(UserConfig.user_id == user_id))
    config = result.scalar_one_or_none()

    if not config or not config.llm_api_keys:
        return LLMApiKeysResponse(providers=[])

    # Remove the key
    current_keys = config.llm_api_keys or {}
    if provider_lower in current_keys:
        del current_keys[provider_lower]
        config.llm_api_keys = current_keys if current_keys else None
        await db.commit()
        await db.refresh(config)

    # Invalidate cache
    await cache_delete(user_config_key(user_id))

    logger.info(
        "User removed LLM API key",
        user_id=user_id,
        provider=provider_lower,
    )

    providers = list(config.llm_api_keys.keys()) if config.llm_api_keys else []
    return LLMApiKeysResponse(providers=providers)
