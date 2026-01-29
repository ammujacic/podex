"""Extension marketplace routes with Open VSX proxy."""

from datetime import datetime
from typing import Annotated, Any

import httpx
import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.cache import cache_get, cache_set
from src.config import settings
from src.database import UserExtension, Workspace, WorkspaceExtension, get_db
from src.middleware.rate_limit import RATE_LIMIT_STANDARD, limiter
from src.websocket.hub import (
    emit_extension_installed,
    emit_extension_settings_changed,
    emit_extension_toggled,
    emit_extension_uninstalled,
)

logger = structlog.get_logger()

router = APIRouter()

# Type alias for database session dependency
DbSession = Annotated[AsyncSession, Depends(get_db)]

# Open VSX configuration
OPENVSX_BASE_URL = settings.OPENVSX_API_URL
OPENVSX_SEARCH_CACHE_TTL = 300  # 5 minutes for search results
OPENVSX_DETAIL_CACHE_TTL = 3600  # 1 hour for extension details

# HTTP status codes
HTTP_STATUS_OK = 200
HTTP_STATUS_NOT_FOUND = 404


# =============================================================================
# Pydantic Models
# =============================================================================


class OpenVSXExtension(BaseModel):
    """Extension from Open VSX API."""

    model_config = ConfigDict(populate_by_name=True)

    namespace: str
    name: str
    display_name: str | None = Field(default=None, alias="displayName")
    version: str
    description: str | None = None
    publisher_display_name: str | None = Field(default=None, alias="publisherDisplayName")
    verified: bool = False
    download_count: int = Field(default=0, alias="downloadCount")
    average_rating: float | None = Field(default=None, alias="averageRating")
    review_count: int = Field(default=0, alias="reviewCount")
    timestamp: str | None = None
    preview: bool = False
    categories: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    icon_url: str | None = Field(default=None, alias="iconUrl")
    repository: str | None = None
    license: str | None = None


class ExtensionSearchResult(BaseModel):
    """Search results from Open VSX."""

    model_config = ConfigDict(populate_by_name=True)

    extensions: list[OpenVSXExtension]
    total_size: int = Field(alias="totalSize")
    offset: int


class ExtensionDetailResponse(BaseModel):
    """Detailed extension info including files."""

    model_config = ConfigDict(populate_by_name=True)

    namespace: str
    name: str
    display_name: str | None = Field(default=None, alias="displayName")
    version: str
    description: str | None = None
    publisher_display_name: str | None = Field(default=None, alias="publisherDisplayName")
    verified: bool = False
    download_count: int = Field(default=0, alias="downloadCount")
    average_rating: float | None = Field(default=None, alias="averageRating")
    review_count: int = Field(default=0, alias="reviewCount")
    categories: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    icon_url: str | None = Field(default=None, alias="iconUrl")
    repository: str | None = None
    license: str | None = None
    readme: str | None = None
    changelog: str | None = None
    download_url: str | None = Field(default=None, alias="downloadUrl")
    manifest: dict[str, Any] | None = None


class InstallExtensionRequest(BaseModel):
    """Request to install an extension."""

    extension_id: str  # namespace.name format
    version: str | None = None  # None = latest
    scope: str = "user"  # "user" or "workspace"
    workspace_id: str | None = None  # Required if scope is "workspace"


class InstalledExtensionResponse(BaseModel):
    """Response for an installed extension."""

    id: str
    extension_id: str
    namespace: str
    name: str
    display_name: str
    version: str
    enabled: bool
    scope: str
    icon_url: str | None = None
    publisher: str | None = None
    settings: dict[str, Any] | None = None
    installed_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ExtensionSettingsUpdate(BaseModel):
    """Request to update extension settings."""

    settings: dict[str, Any]


# =============================================================================
# Helper Functions
# =============================================================================


def get_current_user_id(request: Request) -> str:
    """Get current user ID from request state."""
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    return str(user_id)


EXTENSION_ID_PARTS_COUNT = 2


def parse_extension_id(extension_id: str) -> tuple[str, str]:
    """Parse extension_id into namespace and name."""
    parts = extension_id.split(".", 1)
    if len(parts) != EXTENSION_ID_PARTS_COUNT:
        raise HTTPException(
            status_code=400,
            detail="Invalid extension_id format. Expected 'namespace.name'",
        )
    return parts[0], parts[1]


# =============================================================================
# Open VSX Marketplace Proxy Endpoints
# =============================================================================


@router.get("/marketplace/search", response_model=ExtensionSearchResult)
@limiter.limit(RATE_LIMIT_STANDARD)
async def search_extensions(
    request: Request,  # noqa: ARG001
    response: Response,  # noqa: ARG001
    query: str = Query("", max_length=200),
    category: str | None = Query(None),
    sort_by: str = Query("relevance", pattern="^(relevance|rating|downloadCount|timestamp)$"),
    sort_order: str = Query("desc", pattern="^(asc|desc)$"),
    size: int = Query(20, ge=1, le=50),
    offset: int = Query(0, ge=0),
) -> ExtensionSearchResult:
    """Search extensions in Open VSX marketplace."""
    # Build cache key
    cache_key = f"openvsx:search:{query}:{category}:{sort_by}:{sort_order}:{size}:{offset}"
    cached = await cache_get(cache_key)
    if cached:
        return ExtensionSearchResult(**cached)

    # Build Open VSX query
    params: dict[str, Any] = {
        "query": query,
        "size": size,
        "offset": offset,
        "sortBy": sort_by,
        "sortOrder": sort_order,
    }
    if category:
        params["category"] = category

    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            resp = await client.get(f"{OPENVSX_BASE_URL}/-/search", params=params)
            resp.raise_for_status()
            data = resp.json()
        except httpx.TimeoutException as err:
            logger.warning("Open VSX API timeout")
            raise HTTPException(status_code=504, detail="Marketplace request timed out") from err
        except httpx.HTTPError as err:
            logger.warning("Open VSX API error", error=str(err))
            raise HTTPException(
                status_code=502, detail="Marketplace temporarily unavailable"
            ) from err

    # Parse extensions with icon URL handling
    extensions = []
    for ext in data.get("extensions", []):
        icon_url = None
        if "files" in ext and isinstance(ext["files"], dict):
            icon_url = ext["files"].get("icon")

        extensions.append(
            OpenVSXExtension(
                namespace=ext.get("namespace", ""),
                name=ext.get("name", ""),
                display_name=ext.get("displayName"),
                version=ext.get("version", ""),
                description=ext.get("description"),
                publisher_display_name=ext.get("publisherDisplayName"),
                verified=ext.get("verified", False),
                download_count=ext.get("downloadCount", 0),
                average_rating=ext.get("averageRating"),
                review_count=ext.get("reviewCount", 0),
                timestamp=ext.get("timestamp"),
                preview=ext.get("preview", False),
                categories=ext.get("categories", []),
                tags=ext.get("tags", []),
                icon_url=icon_url,
                repository=ext.get("repository"),
                license=ext.get("license"),
            )
        )

    result = ExtensionSearchResult(
        extensions=extensions,
        total_size=data.get("totalSize", 0),
        offset=data.get("offset", 0),
    )

    # Cache result
    await cache_set(cache_key, result.model_dump(), ttl=OPENVSX_SEARCH_CACHE_TTL)
    return result


@router.get("/marketplace/{namespace}/{name}", response_model=ExtensionDetailResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_extension_detail(
    request: Request,  # noqa: ARG001
    response: Response,  # noqa: ARG001
    namespace: str,
    name: str,
    version: str | None = Query(None),
) -> ExtensionDetailResponse:
    """Get detailed info about an extension."""
    cache_key = f"openvsx:detail:{namespace}:{name}:{version or 'latest'}"
    cached = await cache_get(cache_key)
    if cached:
        return ExtensionDetailResponse(**cached)

    url = f"{OPENVSX_BASE_URL}/{namespace}/{name}"
    if version:
        url += f"/{version}"

    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            resp = await client.get(url)
            if resp.status_code == HTTP_STATUS_NOT_FOUND:
                raise HTTPException(status_code=404, detail="Extension not found")
            resp.raise_for_status()
            data = resp.json()
        except httpx.TimeoutException as err:
            logger.warning("Open VSX API timeout", namespace=namespace, name=name)
            raise HTTPException(status_code=504, detail="Request timed out") from err
        except httpx.HTTPError as err:
            logger.warning("Open VSX API error", error=str(err))
            raise HTTPException(
                status_code=502, detail="Extension not found or unavailable"
            ) from err

        # Fetch README if available
        readme = None
        files = data.get("files", {})
        if isinstance(files, dict) and "readme" in files:
            try:
                readme_resp = await client.get(files["readme"], timeout=5.0)
                if readme_resp.status_code == HTTP_STATUS_OK:
                    readme = readme_resp.text
            except httpx.HTTPError:
                pass  # README fetch failed, continue without it

    # Extract icon URL from files
    icon_url = None
    if isinstance(files, dict):
        icon_url = files.get("icon")

    result = ExtensionDetailResponse(
        namespace=data.get("namespace", namespace),
        name=data.get("name", name),
        display_name=data.get("displayName"),
        version=data.get("version", ""),
        description=data.get("description"),
        publisher_display_name=data.get("publisherDisplayName"),
        verified=data.get("verified", False),
        download_count=data.get("downloadCount", 0),
        average_rating=data.get("averageRating"),
        review_count=data.get("reviewCount", 0),
        categories=data.get("categories", []),
        tags=data.get("tags", []),
        icon_url=icon_url,
        repository=data.get("repository"),
        license=data.get("license"),
        readme=readme,
        download_url=files.get("download") if isinstance(files, dict) else None,
        manifest=data.get("manifest"),
    )

    await cache_set(cache_key, result.model_dump(), ttl=OPENVSX_DETAIL_CACHE_TTL)
    return result


@router.get("/marketplace/{namespace}/{name}/download")
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_extension_download_url(
    request: Request,  # noqa: ARG001
    response: Response,  # noqa: ARG001
    namespace: str,
    name: str,
    version: str | None = Query(None),
) -> dict[str, str]:
    """Get download URL for extension VSIX file."""
    url = f"{OPENVSX_BASE_URL}/{namespace}/{name}"
    if version:
        url += f"/{version}"

    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            resp = await client.get(url)
            if resp.status_code == HTTP_STATUS_NOT_FOUND:
                raise HTTPException(status_code=404, detail="Extension not found")
            resp.raise_for_status()
            data = resp.json()
        except httpx.HTTPError as err:
            logger.warning("Open VSX API error", error=str(err))
            raise HTTPException(status_code=502, detail="Extension not found") from err

    files = data.get("files", {})
    download_url = files.get("download") if isinstance(files, dict) else None
    if not download_url:
        raise HTTPException(status_code=404, detail="No download available for this extension")

    return {"download_url": download_url, "version": data.get("version", "")}


# =============================================================================
# Installed Extensions Management
# =============================================================================


@router.get("/installed", response_model=list[InstalledExtensionResponse])
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_installed_extensions(
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
    workspace_id: str | None = Query(None),
) -> list[InstalledExtensionResponse]:
    """Get all installed extensions for current user and optionally a workspace."""
    user_id = get_current_user_id(request)

    # Get user-level extensions
    user_result = await db.execute(
        select(UserExtension)
        .where(UserExtension.user_id == user_id)
        .order_by(UserExtension.installed_at.desc())
    )
    extensions: list[InstalledExtensionResponse] = [
        InstalledExtensionResponse(
            id=ext.id,
            extension_id=ext.extension_id,
            namespace=ext.namespace,
            name=ext.name,
            display_name=ext.display_name,
            version=ext.version,
            enabled=ext.enabled,
            scope="user",
            icon_url=ext.icon_url,
            publisher=ext.publisher,
            settings=ext.settings,
            installed_at=ext.installed_at,
        )
        for ext in user_result.scalars()
    ]

    # Get workspace-level extensions if workspace_id provided
    if workspace_id:
        ws_result = await db.execute(
            select(WorkspaceExtension)
            .where(WorkspaceExtension.workspace_id == workspace_id)
            .order_by(WorkspaceExtension.installed_at.desc())
        )
        extensions.extend(
            InstalledExtensionResponse(
                id=ext.id,
                extension_id=ext.extension_id,
                namespace=ext.namespace,
                name=ext.name,
                display_name=ext.display_name,
                version=ext.version,
                enabled=ext.enabled,
                scope="workspace",
                icon_url=ext.icon_url,
                publisher=ext.publisher,
                settings=ext.settings,
                installed_at=ext.installed_at,
            )
            for ext in ws_result.scalars()
        )

    return extensions


@router.post("/install", response_model=InstalledExtensionResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def install_extension(
    data: InstallExtensionRequest,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> InstalledExtensionResponse:
    """Install an extension at user or workspace level."""
    user_id = get_current_user_id(request)
    namespace, name = parse_extension_id(data.extension_id)

    # Fetch extension details from Open VSX to validate it exists
    url = f"{OPENVSX_BASE_URL}/{namespace}/{name}"
    if data.version:
        url += f"/{data.version}"

    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            resp = await client.get(url)
            if resp.status_code == HTTP_STATUS_NOT_FOUND:
                raise HTTPException(status_code=404, detail="Extension not found in marketplace")
            resp.raise_for_status()
            ext_data = resp.json()
        except httpx.HTTPError as err:
            logger.warning("Open VSX API error during install", error=str(err))
            raise HTTPException(status_code=502, detail="Could not verify extension") from err

    version = data.version or ext_data.get("version", "")
    display_name = ext_data.get("displayName") or name
    publisher = ext_data.get("publisherDisplayName")
    files = ext_data.get("files", {})
    icon_url = files.get("icon") if isinstance(files, dict) else None

    if data.scope == "user":
        # Check if already installed at user level
        existing = await db.execute(
            select(UserExtension).where(
                and_(
                    UserExtension.user_id == user_id,
                    UserExtension.extension_id == data.extension_id,
                )
            )
        )
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=409, detail="Extension already installed")

        ext = UserExtension(
            user_id=user_id,
            extension_id=data.extension_id,
            namespace=namespace,
            name=name,
            display_name=display_name,
            version=version,
            enabled=True,
            icon_url=icon_url,
            publisher=publisher,
        )
        db.add(ext)
        await db.commit()
        await db.refresh(ext)

        # Emit WebSocket event for cross-device sync
        await emit_extension_installed(
            user_id=user_id,
            extension_id=ext.extension_id,
            namespace=ext.namespace,
            name=ext.name,
            display_name=ext.display_name,
            version=ext.version,
            scope="user",
            icon_url=ext.icon_url,
        )

        return InstalledExtensionResponse(
            id=ext.id,
            extension_id=ext.extension_id,
            namespace=ext.namespace,
            name=ext.name,
            display_name=ext.display_name,
            version=ext.version,
            enabled=ext.enabled,
            scope="user",
            icon_url=ext.icon_url,
            publisher=ext.publisher,
            settings=ext.settings,
            installed_at=ext.installed_at,
        )

    if data.scope == "workspace":
        if not data.workspace_id:
            raise HTTPException(status_code=400, detail="workspace_id required for workspace scope")

        # Verify workspace exists and user has access
        ws_result = await db.execute(select(Workspace).where(Workspace.id == data.workspace_id))
        workspace = ws_result.scalar_one_or_none()
        if not workspace:
            raise HTTPException(status_code=404, detail="Workspace not found")

        # Check if already installed at workspace level
        existing = await db.execute(
            select(WorkspaceExtension).where(
                and_(
                    WorkspaceExtension.workspace_id == data.workspace_id,
                    WorkspaceExtension.extension_id == data.extension_id,
                )
            )
        )
        if existing.scalar_one_or_none():
            raise HTTPException(
                status_code=409, detail="Extension already installed in this workspace"
            )

        ws_ext = WorkspaceExtension(
            workspace_id=data.workspace_id,
            extension_id=data.extension_id,
            namespace=namespace,
            name=name,
            display_name=display_name,
            version=version,
            enabled=True,
            icon_url=icon_url,
            publisher=publisher,
            installed_by=user_id,
        )
        db.add(ws_ext)
        await db.commit()
        await db.refresh(ws_ext)

        # Emit WebSocket event for cross-device sync
        await emit_extension_installed(
            user_id=user_id,
            extension_id=ws_ext.extension_id,
            namespace=ws_ext.namespace,
            name=ws_ext.name,
            display_name=ws_ext.display_name,
            version=ws_ext.version,
            scope="workspace",
            workspace_id=data.workspace_id,
            icon_url=ws_ext.icon_url,
        )

        return InstalledExtensionResponse(
            id=ws_ext.id,
            extension_id=ws_ext.extension_id,
            namespace=ws_ext.namespace,
            name=ws_ext.name,
            display_name=ws_ext.display_name,
            version=ws_ext.version,
            enabled=ws_ext.enabled,
            scope="workspace",
            icon_url=ws_ext.icon_url,
            publisher=ws_ext.publisher,
            settings=ws_ext.settings,
            installed_at=ws_ext.installed_at,
        )

    raise HTTPException(status_code=400, detail="Invalid scope. Must be 'user' or 'workspace'")


@router.delete("/{extension_id}")
@limiter.limit(RATE_LIMIT_STANDARD)
async def uninstall_extension(
    extension_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
    scope: str = Query("user", pattern="^(user|workspace)$"),
    workspace_id: str | None = Query(None),
) -> dict[str, str]:
    """Uninstall an extension."""
    user_id = get_current_user_id(request)

    if scope == "user":
        result = await db.execute(
            select(UserExtension).where(
                and_(
                    UserExtension.user_id == user_id,
                    UserExtension.extension_id == extension_id,
                )
            )
        )
        ext = result.scalar_one_or_none()
        if not ext:
            raise HTTPException(status_code=404, detail="Extension not installed")

        await db.delete(ext)
        await db.commit()

        # Emit WebSocket event for cross-device sync
        await emit_extension_uninstalled(
            user_id=user_id,
            extension_id=extension_id,
            scope="user",
        )

    elif scope == "workspace":
        if not workspace_id:
            raise HTTPException(status_code=400, detail="workspace_id required for workspace scope")

        result = await db.execute(
            select(WorkspaceExtension).where(
                and_(
                    WorkspaceExtension.workspace_id == workspace_id,
                    WorkspaceExtension.extension_id == extension_id,
                )
            )
        )
        ext = result.scalar_one_or_none()
        if not ext:
            raise HTTPException(status_code=404, detail="Extension not installed in this workspace")

        await db.delete(ext)
        await db.commit()

        # Emit WebSocket event for cross-device sync
        await emit_extension_uninstalled(
            user_id=user_id,
            extension_id=extension_id,
            scope="workspace",
            workspace_id=workspace_id,
        )

    return {"status": "uninstalled", "extension_id": extension_id}


@router.patch("/{extension_id}/toggle", response_model=InstalledExtensionResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def toggle_extension(
    extension_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
    enabled: bool = Query(...),
    scope: str = Query("user", pattern="^(user|workspace)$"),
    workspace_id: str | None = Query(None),
) -> InstalledExtensionResponse:
    """Enable or disable an extension."""
    user_id = get_current_user_id(request)

    if scope == "user":
        result = await db.execute(
            select(UserExtension).where(
                and_(
                    UserExtension.user_id == user_id,
                    UserExtension.extension_id == extension_id,
                )
            )
        )
        ext = result.scalar_one_or_none()
        if not ext:
            raise HTTPException(status_code=404, detail="Extension not installed")

        ext.enabled = enabled
        await db.commit()
        await db.refresh(ext)

        # Emit WebSocket event for cross-device sync
        await emit_extension_toggled(
            user_id=user_id,
            extension_id=extension_id,
            enabled=enabled,
            scope="user",
        )

        return InstalledExtensionResponse(
            id=ext.id,
            extension_id=ext.extension_id,
            namespace=ext.namespace,
            name=ext.name,
            display_name=ext.display_name,
            version=ext.version,
            enabled=ext.enabled,
            scope="user",
            icon_url=ext.icon_url,
            publisher=ext.publisher,
            settings=ext.settings,
            installed_at=ext.installed_at,
        )

    if scope == "workspace":
        if not workspace_id:
            raise HTTPException(status_code=400, detail="workspace_id required for workspace scope")

        result = await db.execute(
            select(WorkspaceExtension).where(
                and_(
                    WorkspaceExtension.workspace_id == workspace_id,
                    WorkspaceExtension.extension_id == extension_id,
                )
            )
        )
        ext = result.scalar_one_or_none()
        if not ext:
            raise HTTPException(status_code=404, detail="Extension not installed in this workspace")

        ext.enabled = enabled
        await db.commit()
        await db.refresh(ext)

        # Emit WebSocket event for cross-device sync
        await emit_extension_toggled(
            user_id=user_id,
            extension_id=extension_id,
            enabled=enabled,
            scope="workspace",
            workspace_id=workspace_id,
        )

        return InstalledExtensionResponse(
            id=ext.id,
            extension_id=ext.extension_id,
            namespace=ext.namespace,
            name=ext.name,
            display_name=ext.display_name,
            version=ext.version,
            enabled=ext.enabled,
            scope="workspace",
            icon_url=ext.icon_url,
            publisher=ext.publisher,
            settings=ext.settings,
            installed_at=ext.installed_at,
        )

    raise HTTPException(status_code=400, detail="Invalid scope")


@router.patch("/{extension_id}/settings", response_model=InstalledExtensionResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def update_extension_settings(
    extension_id: str,
    data: ExtensionSettingsUpdate,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
    scope: str = Query("user", pattern="^(user|workspace)$"),
    workspace_id: str | None = Query(None),
) -> InstalledExtensionResponse:
    """Update extension settings."""
    user_id = get_current_user_id(request)

    if scope == "user":
        result = await db.execute(
            select(UserExtension).where(
                and_(
                    UserExtension.user_id == user_id,
                    UserExtension.extension_id == extension_id,
                )
            )
        )
        ext = result.scalar_one_or_none()
        if not ext:
            raise HTTPException(status_code=404, detail="Extension not installed")

        # Merge settings
        current_settings = ext.settings or {}
        current_settings.update(data.settings)
        ext.settings = current_settings
        await db.commit()
        await db.refresh(ext)

        # Emit WebSocket event for cross-device sync
        await emit_extension_settings_changed(
            user_id=user_id,
            extension_id=extension_id,
            settings=ext.settings,
            scope="user",
        )

        return InstalledExtensionResponse(
            id=ext.id,
            extension_id=ext.extension_id,
            namespace=ext.namespace,
            name=ext.name,
            display_name=ext.display_name,
            version=ext.version,
            enabled=ext.enabled,
            scope="user",
            icon_url=ext.icon_url,
            publisher=ext.publisher,
            settings=ext.settings,
            installed_at=ext.installed_at,
        )

    if scope == "workspace":
        if not workspace_id:
            raise HTTPException(status_code=400, detail="workspace_id required for workspace scope")

        result = await db.execute(
            select(WorkspaceExtension).where(
                and_(
                    WorkspaceExtension.workspace_id == workspace_id,
                    WorkspaceExtension.extension_id == extension_id,
                )
            )
        )
        ext = result.scalar_one_or_none()
        if not ext:
            raise HTTPException(status_code=404, detail="Extension not installed in this workspace")

        # Merge settings
        current_settings = ext.settings or {}
        current_settings.update(data.settings)
        ext.settings = current_settings
        await db.commit()
        await db.refresh(ext)

        # Emit WebSocket event for cross-device sync
        await emit_extension_settings_changed(
            user_id=user_id,
            extension_id=extension_id,
            settings=ext.settings,
            scope="workspace",
            workspace_id=workspace_id,
        )

        return InstalledExtensionResponse(
            id=ext.id,
            extension_id=ext.extension_id,
            namespace=ext.namespace,
            name=ext.name,
            display_name=ext.display_name,
            version=ext.version,
            enabled=ext.enabled,
            scope="workspace",
            icon_url=ext.icon_url,
            publisher=ext.publisher,
            settings=ext.settings,
            installed_at=ext.installed_at,
        )

    raise HTTPException(status_code=400, detail="Invalid scope")
