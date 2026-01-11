"""File upload routes for images and files."""

import base64
import hashlib
import mimetypes
from datetime import UTC, datetime
from io import BytesIO
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
from src.exceptions import ComputeClientError
from src.middleware.rate_limit import RATE_LIMIT_UPLOAD, limiter

logger = structlog.get_logger()

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


def get_current_user_id(request: Request) -> str:
    """Get current user ID from request state."""
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return str(user_id)


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


def compute_checksum(content: bytes) -> str:
    """Compute SHA-256 checksum of content."""
    return hashlib.sha256(content).hexdigest()


@router.post("/{session_id}/upload", response_model=UploadResponse)
@limiter.limit(RATE_LIMIT_UPLOAD)
async def upload_file(
    session_id: str,
    request: Request,
    _response: Response,
    db: DbSession,
    file: UploadFile = File(...),  # noqa: B008
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

    # Validate file
    validate_file(file, MAX_FILE_SIZE, ALLOWED_FILE_TYPES)

    # Read content
    content = await read_file_content(file, MAX_FILE_SIZE)
    checksum = compute_checksum(content)

    # Generate unique filename
    file_id = str(uuid4())
    original_name = file.filename or "unnamed"
    ext = original_name.rsplit(".", 1)[-1] if "." in original_name else ""
    unique_filename = f"{file_id}.{ext}" if ext else file_id

    # Full path in workspace
    full_path = f"{path.rstrip('/')}/{unique_filename}"

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
    _response: Response,
    db: DbSession,
    file: UploadFile = File(...),  # noqa: B008
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

    # Validate image
    validate_file(file, MAX_IMAGE_SIZE, ALLOWED_IMAGE_TYPES)

    # Read content
    content = await read_file_content(file, MAX_IMAGE_SIZE)
    checksum = compute_checksum(content)

    # Try to get image dimensions
    width: int | None = None
    height: int | None = None
    try:
        from PIL import Image  # noqa: PLC0415

        img = Image.open(BytesIO(content))
        width, height = img.size
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
    full_path = f"{path.rstrip('/')}/{unique_filename}"

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
    _response: Response,
    db: DbSession,
    files: list[UploadFile] = File(...),  # noqa: B008
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

    for file in files:
        try:
            # Validate file
            validate_file(file, MAX_FILE_SIZE, ALLOWED_FILE_TYPES)

            # Read content
            content = await read_file_content(file, MAX_FILE_SIZE)
            checksum = compute_checksum(content)

            # Generate unique filename
            file_id = str(uuid4())
            original_name = file.filename or "unnamed"
            ext = original_name.rsplit(".", 1)[-1] if "." in original_name else ""
            unique_filename = f"{file_id}.{ext}" if ext else file_id
            full_path = f"{path.rstrip('/')}/{unique_filename}"

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

            total_size += len(content)
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
    _response: Response,
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

    checksum = compute_checksum(content)

    # Try to get image dimensions
    width: int | None = None
    height: int | None = None
    try:
        from PIL import Image  # noqa: PLC0415

        img = Image.open(BytesIO(content))
        width, height = img.size
    except ImportError:
        pass  # PIL not available
    except Exception:  # noqa: S110
        pass  # Failed to read image dimensions, not critical

    # Generate unique filename
    file_id = str(uuid4())
    ext = filename.rsplit(".", 1)[-1] if "." in filename else "png"
    unique_filename = f"{file_id}.{ext}"
    full_path = f"{path.rstrip('/')}/{unique_filename}"

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
