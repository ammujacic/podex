"""File upload routes for images and files."""

import base64
import hashlib
import mimetypes
import os
from datetime import UTC, datetime
from io import BytesIO
from pathlib import PurePath
from typing import Annotated, Any
from uuid import uuid4

import structlog
from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, Response, UploadFile
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.compute_client import compute_client
from src.database import Session as SessionModel
from src.database import get_db
from src.database.models import UsageQuota
from src.exceptions import ComputeClientError
from src.middleware.auth import get_current_user_id
from src.middleware.rate_limit import RATE_LIMIT_UPLOAD, limiter

logger = structlog.get_logger()


async def check_storage_quota(db: AsyncSession, user_id: str, upload_size_bytes: int) -> None:
    """Check if user has storage quota available for an upload.

    SECURITY: Enforces storage limits BEFORE accepting uploads to prevent
    users from exceeding their quota by uploading files that are rejected later.

    Args:
        db: Database session
        user_id: User ID
        upload_size_bytes: Size of the upload in bytes

    Raises:
        HTTPException: If storage quota would be exceeded
    """
    quota_result = await db.execute(
        select(UsageQuota)
        .where(UsageQuota.user_id == user_id)
        .where(UsageQuota.quota_type == "storage_gb")
    )
    quota = quota_result.scalar_one_or_none()

    if not quota:
        # No quota defined = no limit (or use system default)
        return

    # Convert upload size to GB (with ceiling to avoid undercount)
    import math

    upload_size_gb = (
        math.ceil(upload_size_bytes / (1024 * 1024 * 1024) * 1000) / 1000
    )  # Keep 3 decimal precision

    # Check if adding this upload would exceed quota
    new_usage = quota.current_usage + upload_size_gb
    if new_usage > quota.limit_value and not quota.overage_allowed:
        raise HTTPException(
            status_code=413,
            detail=f"Storage quota exceeded. Current: {quota.current_usage}GB, "
            f"Limit: {quota.limit_value}GB, Upload: {upload_size_gb:.3f}GB",
        )


# ============================================================================
# Magic Byte Signatures for File Type Verification
# SECURITY: Verify file content matches claimed type to prevent spoofing
# ============================================================================

# Magic bytes for common file types
FILE_SIGNATURES: dict[str, list[tuple[bytes, int]]] = {
    # Images
    "image/jpeg": [(b"\xff\xd8\xff", 0)],
    "image/png": [(b"\x89PNG\r\n\x1a\n", 0)],
    "image/gif": [(b"GIF87a", 0), (b"GIF89a", 0)],
    "image/webp": [(b"RIFF", 0), (b"WEBP", 8)],  # RIFF....WEBP
    "image/bmp": [(b"BM", 0)],
    # Documents
    "application/pdf": [(b"%PDF", 0)],
    # Archives
    "application/zip": [(b"PK\x03\x04", 0), (b"PK\x05\x06", 0)],  # Normal and empty
    "application/gzip": [(b"\x1f\x8b", 0)],
    "application/x-tar": [(b"ustar", 257)],  # POSIX tar
    # Note: text/* and application/json are not checked as they don't have signatures
}

# File types that don't need magic byte verification (text-based)
TEXT_BASED_TYPES = {
    "text/plain",
    "text/markdown",
    "text/csv",
    "text/html",
    "text/css",
    "text/javascript",
    "application/json",
    "application/xml",
    "application/javascript",
    "image/svg+xml",  # SVG is XML-based
}


def verify_file_signature(content: bytes, claimed_type: str) -> bool:
    """Verify file content matches claimed MIME type using magic bytes.

    SECURITY: This prevents content-type spoofing attacks where a malicious
    file is uploaded with a safe content-type header but actually contains
    different content (e.g., an executable disguised as an image).

    Args:
        content: The raw file bytes.
        claimed_type: The claimed MIME type from the upload.

    Returns:
        True if the content matches the claimed type or type doesn't need verification.
        False if the content doesn't match the claimed type.
    """
    # Text-based types don't have magic signatures
    if claimed_type in TEXT_BASED_TYPES:
        return True

    # Check if we have signatures for this type
    signatures = FILE_SIGNATURES.get(claimed_type)
    if not signatures:
        # No signature defined - allow with warning
        logger.warning(
            "No magic signature defined for content type",
            content_type=claimed_type,
        )
        return True

    # Check all signature variants for this type
    for signature, offset in signatures:
        if (
            len(content) >= offset + len(signature)
            and content[offset : offset + len(signature)] == signature
        ):
            return True

    # Special case for WebP: needs both RIFF and WEBP
    if (
        claimed_type == "image/webp"
        and len(content) >= 12
        and content[0:4] == b"RIFF"
        and content[8:12] == b"WEBP"
    ):
        return True

    # No signature matched
    logger.warning(
        "File signature does not match claimed content type",
        claimed_type=claimed_type,
        content_preview=content[:16].hex() if content else "empty",
    )
    return False


router = APIRouter()

# Type alias for database session dependency
DbSession = Annotated[AsyncSession, Depends(get_db)]

# Allowed file types for uploads
ALLOWED_IMAGE_TYPES = {
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "image/svg+xml",
    "image/bmp",
}

ALLOWED_FILE_TYPES = {
    # Images
    *ALLOWED_IMAGE_TYPES,
    # Documents
    "application/pdf",
    "text/plain",
    "text/markdown",
    "text/csv",
    # Archives
    "application/zip",
    "application/gzip",
    "application/x-tar",
    # Code
    "application/json",
    "application/xml",
    "text/html",
    "text/css",
    "text/javascript",
    "application/javascript",
}

# Max file sizes
MAX_IMAGE_SIZE = 10 * 1024 * 1024  # 10MB for images
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB for other files


class UploadResponse(BaseModel):
    """Response for file upload."""

    id: str
    filename: str
    content_type: str
    size: int
    url: str
    path: str
    checksum: str
    created_at: str


class ImageUploadResponse(BaseModel):
    """Response for image upload with base64 data."""

    id: str
    filename: str
    content_type: str
    size: int
    url: str
    path: str
    base64_data: str  # For direct use with vision models
    checksum: str
    width: int | None = None
    height: int | None = None
    created_at: str


class BulkUploadResponse(BaseModel):
    """Response for bulk file upload."""

    uploaded: list[UploadResponse]
    failed: list[dict[str, str]]
    total_size: int


async def verify_session_access(
    session_id: str,
    request: Request,
    db: AsyncSession,
) -> SessionModel:
    """Verify user has access to the session."""
    user_id = get_current_user_id(request)

    query = select(SessionModel).where(SessionModel.id == session_id)
    result = await db.execute(query)
    session = result.scalar_one_or_none()

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if session.owner_id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    return session


def validate_file(file: UploadFile, max_size: int, allowed_types: set[str]) -> None:
    """Validate uploaded file."""
    # Check content type
    content_type = file.content_type or mimetypes.guess_type(file.filename or "")[0]
    if not content_type or content_type not in allowed_types:
        raise HTTPException(
            status_code=400,
            detail=f"File type not allowed. Allowed types: {', '.join(allowed_types)}",
        )

    # Check file size (if available in headers)
    if file.size and file.size > max_size:
        raise HTTPException(
            status_code=400,
            detail=f"File too large. Maximum size is {max_size // (1024 * 1024)}MB",
        )


async def read_file_content(file: UploadFile, max_size: int) -> bytes:
    """Read file content with size validation."""
    content = await file.read()
    if len(content) > max_size:
        raise HTTPException(
            status_code=400,
            detail=f"File too large. Maximum size is {max_size // (1024 * 1024)}MB",
        )
    return content


async def compute_checksum(content: bytes) -> str:
    """Compute SHA-256 checksum of content.

    PERFORMANCE: Uses asyncio.to_thread to avoid blocking the event loop
    for large files.
    """
    import asyncio

    return await asyncio.to_thread(lambda: hashlib.sha256(content).hexdigest())


def validate_upload_path(path: str) -> str:
    """Validate and normalize upload path to prevent path traversal attacks.

    Args:
        path: The upload directory path.

    Returns:
        The normalized, safe path.

    Raises:
        HTTPException: If the path is invalid or attempts path traversal.
    """
    # Check for null bytes
    if "\x00" in path:
        raise HTTPException(status_code=400, detail="Invalid path: null bytes not allowed")

    # Check path length
    if len(path) > 1024:
        raise HTTPException(status_code=400, detail="Invalid path: path too long")

    # Reject empty paths
    if not path or not path.strip():
        path = "uploads"  # Default path

    # Normalize backslashes to forward slashes
    clean_path = path.replace("\\", "/")

    # Check for URL-encoded traversal
    if "%2e" in path.lower() or "%2f" in path.lower():
        raise HTTPException(
            status_code=400,
            detail="Invalid path: URL-encoded characters not allowed",
        )

    # Normalize the path
    normalized = os.path.normpath(clean_path)

    # Check for path traversal attempts
    if normalized.startswith(("..", "/")):
        raise HTTPException(
            status_code=400,
            detail="Invalid path: absolute paths and path traversal are not allowed",
        )

    # Check for any remaining .. after normalization
    if ".." in PurePath(normalized).parts:
        raise HTTPException(
            status_code=400,
            detail="Invalid path: path traversal is not allowed",
        )

    # Ensure path is under uploads or user-specified directory
    return normalized


@router.post("/{session_id}/upload", response_model=UploadResponse)
@limiter.limit(RATE_LIMIT_UPLOAD)
async def upload_file(
    session_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
    file: UploadFile = File(...),
    path: str = Query(default="uploads", description="Target directory path in workspace"),
) -> UploadResponse:
    """Upload a file to the session workspace.

    Args:
        session_id: The session ID
        file: The file to upload (multipart/form-data)
        path: Target directory path in workspace (default: uploads)

    Returns:
        Upload response with file metadata and URL
    """
    session = await verify_session_access(session_id, request, db)
    user_id = get_current_user_id(request)

    # Validate upload path to prevent traversal attacks
    safe_path = validate_upload_path(path)

    # Validate file
    validate_file(file, MAX_FILE_SIZE, ALLOWED_FILE_TYPES)

    # Read content
    content = await read_file_content(file, MAX_FILE_SIZE)

    # SECURITY: Check storage quota BEFORE accepting upload
    await check_storage_quota(db, user_id, len(content))

    # SECURITY: Verify file content matches claimed type
    content_type = (
        file.content_type
        or mimetypes.guess_type(file.filename or "")[0]
        or "application/octet-stream"
    )
    if not verify_file_signature(content, content_type):
        raise HTTPException(
            status_code=400,
            detail="File content does not match the declared content type. "
            "File may be corrupted or spoofed.",
        )

    checksum = await compute_checksum(content)

    # Generate unique filename
    file_id = str(uuid4())
    original_name = file.filename or "unnamed"
    ext = original_name.rsplit(".", 1)[-1] if "." in original_name else ""
    unique_filename = f"{file_id}.{ext}" if ext else file_id

    # Full path in workspace
    full_path = f"{safe_path.rstrip('/')}/{unique_filename}"

    # Upload to workspace via compute service
    if session.workspace_id:
        try:
            # For binary files, encode as base64 in content
            content_type = file.content_type or "application/octet-stream"
            if content_type.startswith("text/") or content_type in (
                "application/json",
                "application/xml",
                "application/javascript",
            ):
                # Text content - send as-is
                file_content = content.decode("utf-8", errors="replace")
            else:
                # Binary content - encode as base64 with marker
                file_content = f"__base64__:{base64.b64encode(content).decode('ascii')}"

            await compute_client.write_file(
                session.workspace_id,
                user_id,
                full_path,
                file_content,
            )

            logger.info(
                "File uploaded to workspace",
                session_id=session_id,
                workspace_id=session.workspace_id,
                path=full_path,
                size=len(content),
            )
        except ComputeClientError as e:
            logger.exception("Failed to upload file", error=str(e))
            raise HTTPException(status_code=503, detail="Failed to upload file") from e

    return UploadResponse(
        id=file_id,
        filename=original_name,
        content_type=file.content_type or "application/octet-stream",
        size=len(content),
        url=f"/api/sessions/{session_id}/files/content?path={full_path}",
        path=full_path,
        checksum=checksum,
        created_at=datetime.now(UTC).isoformat(),
    )


@router.post("/{session_id}/upload/image", response_model=ImageUploadResponse)
@limiter.limit(RATE_LIMIT_UPLOAD)
async def upload_image(
    session_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
    file: UploadFile = File(...),
    path: str = Query(default="uploads/images", description="Target directory path"),
) -> ImageUploadResponse:
    """Upload an image to the session workspace.

    This endpoint is optimized for images and returns base64 data
    that can be directly used with vision models.

    Args:
        session_id: The session ID
        file: The image file to upload
        path: Target directory path (default: uploads/images)

    Returns:
        Image upload response with base64 data for vision models
    """
    session = await verify_session_access(session_id, request, db)
    user_id = get_current_user_id(request)

    # Validate upload path to prevent traversal attacks
    safe_path = validate_upload_path(path)

    # Validate image
    validate_file(file, MAX_IMAGE_SIZE, ALLOWED_IMAGE_TYPES)

    # Read content
    content = await read_file_content(file, MAX_IMAGE_SIZE)

    # SECURITY: Check storage quota BEFORE accepting upload
    await check_storage_quota(db, user_id, len(content))

    # SECURITY: Verify image content matches claimed type
    content_type = file.content_type or mimetypes.guess_type(file.filename or "")[0] or "image/png"
    if not verify_file_signature(content, content_type):
        raise HTTPException(
            status_code=400,
            detail="Image content does not match the declared content type. "
            "File may be corrupted or spoofed.",
        )

    checksum = await compute_checksum(content)

    # Try to get image dimensions
    # PERFORMANCE: Use asyncio.to_thread to avoid blocking the event loop
    width: int | None = None
    height: int | None = None
    try:
        import asyncio

        from PIL import Image

        def _get_dimensions() -> tuple[int, int]:
            img = Image.open(BytesIO(content))
            return img.size

        width, height = await asyncio.to_thread(_get_dimensions)
    except ImportError:
        logger.debug("PIL not available, skipping image dimension extraction")
    except Exception as e:
        logger.debug("Could not extract image dimensions", error=str(e))

    # Generate unique filename
    file_id = str(uuid4())
    original_name = file.filename or "image"
    ext = original_name.rsplit(".", 1)[-1] if "." in original_name else "png"
    unique_filename = f"{file_id}.{ext}"

    # Full path in workspace
    full_path = f"{safe_path.rstrip('/')}/{unique_filename}"

    # Upload to workspace
    if session.workspace_id:
        try:
            # Images are binary - encode as base64
            file_content = f"__base64__:{base64.b64encode(content).decode('ascii')}"
            await compute_client.write_file(
                session.workspace_id,
                user_id,
                full_path,
                file_content,
            )

            logger.info(
                "Image uploaded to workspace",
                session_id=session_id,
                workspace_id=session.workspace_id,
                path=full_path,
                size=len(content),
                dimensions=f"{width}x{height}" if width and height else "unknown",
            )
        except ComputeClientError as e:
            logger.exception("Failed to upload image", error=str(e))
            raise HTTPException(status_code=503, detail="Failed to upload image") from e

    # Generate base64 data for vision models
    content_type = file.content_type or f"image/{ext}"
    base64_data = f"data:{content_type};base64,{base64.b64encode(content).decode('ascii')}"

    return ImageUploadResponse(
        id=file_id,
        filename=original_name,
        content_type=content_type,
        size=len(content),
        url=f"/api/sessions/{session_id}/files/content?path={full_path}",
        path=full_path,
        base64_data=base64_data,
        checksum=checksum,
        width=width,
        height=height,
        created_at=datetime.now(UTC).isoformat(),
    )


@router.post("/{session_id}/upload/bulk", response_model=BulkUploadResponse)
@limiter.limit(RATE_LIMIT_UPLOAD)
async def upload_files_bulk(
    session_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
    files: list[UploadFile] = File(...),
    path: str = Query(default="uploads", description="Target directory path"),
) -> BulkUploadResponse:
    """Upload multiple files at once.

    Args:
        session_id: The session ID
        files: List of files to upload (max 10)
        path: Target directory path

    Returns:
        Bulk upload response with successful and failed uploads
    """
    session = await verify_session_access(session_id, request, db)
    user_id = get_current_user_id(request)

    # Validate upload path to prevent traversal attacks
    safe_path = validate_upload_path(path)

    # Limit number of files
    max_files = 10
    if len(files) > max_files:
        raise HTTPException(
            status_code=400,
            detail=f"Too many files. Maximum is {max_files} files per request",
        )

    uploaded: list[UploadResponse] = []
    failed: list[dict[str, str]] = []
    total_size = 0

    # SECURITY: Calculate total size and check quota BEFORE processing uploads
    file_contents: list[tuple[UploadFile, bytes]] = []
    for file in files:
        try:
            validate_file(file, MAX_FILE_SIZE, ALLOWED_FILE_TYPES)
            content = await read_file_content(file, MAX_FILE_SIZE)
            file_contents.append((file, content))
            total_size += len(content)
        except HTTPException as e:
            failed.append({"filename": file.filename or "unknown", "error": e.detail})

    # Check storage quota for total upload size
    if total_size > 0:
        await check_storage_quota(db, user_id, total_size)

    for file, content in file_contents:
        try:
            checksum = await compute_checksum(content)

            # Generate unique filename
            file_id = str(uuid4())
            original_name = file.filename or "unnamed"
            ext = original_name.rsplit(".", 1)[-1] if "." in original_name else ""
            unique_filename = f"{file_id}.{ext}" if ext else file_id
            full_path = f"{safe_path.rstrip('/')}/{unique_filename}"

            # Upload to workspace
            if session.workspace_id:
                content_type = file.content_type or "application/octet-stream"
                if content_type.startswith("text/") or content_type in (
                    "application/json",
                    "application/xml",
                    "application/javascript",
                ):
                    file_content = content.decode("utf-8", errors="replace")
                else:
                    file_content = f"__base64__:{base64.b64encode(content).decode('ascii')}"

                await compute_client.write_file(
                    session.workspace_id,
                    user_id,
                    full_path,
                    file_content,
                )

            uploaded.append(
                UploadResponse(
                    id=file_id,
                    filename=original_name,
                    content_type=file.content_type or "application/octet-stream",
                    size=len(content),
                    url=f"/api/sessions/{session_id}/files/content?path={full_path}",
                    path=full_path,
                    checksum=checksum,
                    created_at=datetime.now(UTC).isoformat(),
                )
            )

        except HTTPException as e:
            failed.append({"filename": file.filename or "unnamed", "error": str(e.detail)})
        except Exception as e:
            logger.exception("Failed to upload file", filename=file.filename, error=str(e))
            failed.append({"filename": file.filename or "unnamed", "error": str(e)})

    logger.info(
        "Bulk upload completed",
        session_id=session_id,
        uploaded=len(uploaded),
        failed=len(failed),
        total_size=total_size,
    )

    return BulkUploadResponse(
        uploaded=uploaded,
        failed=failed,
        total_size=total_size,
    )


@router.post("/{session_id}/upload/base64", response_model=ImageUploadResponse)
@limiter.limit(RATE_LIMIT_UPLOAD)
async def upload_image_base64(
    session_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
    data: dict[str, Any],
) -> ImageUploadResponse:
    """Upload an image from base64 data.

    This is useful for uploading screenshots or canvas data from the browser.

    Request body:
        {
            "base64_data": "data:image/png;base64,...",
            "filename": "screenshot.png",  // optional
            "path": "uploads/images"  // optional
        }
    """
    session = await verify_session_access(session_id, request, db)
    user_id = get_current_user_id(request)

    base64_data = data.get("base64_data")
    if not base64_data:
        raise HTTPException(status_code=400, detail="base64_data is required")

    filename = data.get("filename", "image.png")
    path = data.get("path", "uploads/images")

    # Validate upload path to prevent traversal attacks
    safe_path = validate_upload_path(path)

    # Parse data URL
    if base64_data.startswith("data:"):
        # Format: data:image/png;base64,<data>
        try:
            header, encoded = base64_data.split(",", 1)
            content_type = header.split(":")[1].split(";")[0]
        except (ValueError, IndexError):
            raise HTTPException(status_code=400, detail="Invalid base64 data URL format") from None
    else:
        # Raw base64 - assume PNG
        encoded = base64_data
        content_type = "image/png"

    # Validate content type
    if content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=400, detail=f"Image type not allowed: {content_type}")

    # Decode base64
    try:
        content = base64.b64decode(encoded)
    except Exception as e:
        raise HTTPException(status_code=400, detail="Invalid base64 encoding") from e

    # Validate size
    if len(content) > MAX_IMAGE_SIZE:
        raise HTTPException(
            status_code=400,
            detail=f"Image too large. Maximum size is {MAX_IMAGE_SIZE // (1024 * 1024)}MB",
        )

    # SECURITY: Check storage quota BEFORE accepting upload
    await check_storage_quota(db, user_id, len(content))

    checksum = await compute_checksum(content)

    # Try to get image dimensions
    # PERFORMANCE: Use asyncio.to_thread to avoid blocking the event loop
    width: int | None = None
    height: int | None = None
    try:
        import asyncio

        from PIL import Image

        def _get_dimensions() -> tuple[int, int]:
            img = Image.open(BytesIO(content))
            return img.size

        width, height = await asyncio.to_thread(_get_dimensions)
    except ImportError:
        logger.debug("PIL not available, cannot extract image dimensions")
    except Exception as e:
        logger.debug("Failed to read image dimensions (non-critical)", error=str(e))

    # Generate unique filename
    file_id = str(uuid4())
    ext = filename.rsplit(".", 1)[-1] if "." in filename else "png"
    unique_filename = f"{file_id}.{ext}"
    full_path = f"{safe_path.rstrip('/')}/{unique_filename}"

    # Upload to workspace
    if session.workspace_id:
        try:
            file_content = f"__base64__:{base64.b64encode(content).decode('ascii')}"
            await compute_client.write_file(
                session.workspace_id,
                user_id,
                full_path,
                file_content,
            )
        except ComputeClientError as e:
            logger.exception("Failed to upload image", error=str(e))
            raise HTTPException(status_code=503, detail="Failed to upload image") from e

    # Return with base64 data for immediate use
    return ImageUploadResponse(
        id=file_id,
        filename=filename,
        content_type=content_type,
        size=len(content),
        url=f"/api/sessions/{session_id}/files/content?path={full_path}",
        path=full_path,
        base64_data=f"data:{content_type};base64,{base64.b64encode(content).decode('ascii')}",
        checksum=checksum,
        width=width,
        height=height,
        created_at=datetime.now(UTC).isoformat(),
    )
