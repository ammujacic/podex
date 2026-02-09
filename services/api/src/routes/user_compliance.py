"""User-facing compliance routes for GDPR/CCPA data export requests."""

from __future__ import annotations

from datetime import datetime  # noqa: TC003
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.database.models import DataExportRequest

router = APIRouter()


class DataExportRequestCreate(BaseModel):
    """Create a data export request."""

    request_type: str = Field(
        default="export_data",
        pattern="^(export_data|data_portability)$",
    )
    data_categories: list[str] = Field(
        default=["profile", "sessions", "messages", "billing", "settings"],
        min_length=1,
    )


class DataExportRequestResponse(BaseModel):
    """Data export request response."""

    id: str
    request_type: str
    data_categories: list[str]
    status: str
    created_at: datetime
    completed_at: datetime | None
    download_expires_at: datetime | None

    model_config = ConfigDict(from_attributes=True)


async def get_current_user_id(request: Request) -> str:
    """Get current user ID from request state."""
    user_id: str | None = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user_id


@router.post(
    "/data-export",
    response_model=DataExportRequestResponse,
    status_code=status.HTTP_201_CREATED,
)
async def request_data_export(
    data: DataExportRequestCreate,
    request: Request,  # noqa: ARG001
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
) -> DataExportRequestResponse:
    """Request an export of your personal data (GDPR/CCPA).

    This creates a data export request that will be processed by administrators.
    You will be notified when your export is ready for download.

    Valid data categories:
    - profile: Your account information
    - sessions: Your development sessions
    - messages: Your conversation history with agents
    - billing: Your usage and billing records
    - settings: Your preferences and configuration
    """
    # Validate categories
    valid_categories = {"profile", "sessions", "messages", "billing", "settings"}
    invalid = set(data.data_categories) - valid_categories
    if invalid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid data categories: {', '.join(invalid)}",
        )

    # Check for existing pending request
    existing = await db.execute(
        select(DataExportRequest).where(
            DataExportRequest.user_id == user_id,
            DataExportRequest.status.in_(["pending", "processing"]),
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You already have a pending data export request",
        )

    # Create the export request
    export_request = DataExportRequest(
        id=str(uuid4()),
        user_id=user_id,
        request_type=data.request_type,
        data_categories=data.data_categories,
        status="pending",
    )

    db.add(export_request)
    await db.commit()
    await db.refresh(export_request)

    return DataExportRequestResponse(
        id=export_request.id,
        request_type=export_request.request_type,
        data_categories=export_request.data_categories,
        status=export_request.status,
        created_at=export_request.created_at,
        completed_at=export_request.completed_at,
        download_expires_at=export_request.download_expires_at,
    )


@router.get("/data-export", response_model=list[DataExportRequestResponse])
async def list_my_data_exports(
    request: Request,  # noqa: ARG001
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
) -> list[DataExportRequestResponse]:
    """List your data export requests."""
    result = await db.execute(
        select(DataExportRequest)
        .where(DataExportRequest.user_id == user_id)
        .order_by(DataExportRequest.created_at.desc())
        .limit(10)
    )
    requests = result.scalars().all()

    return [
        DataExportRequestResponse(
            id=r.id,
            request_type=r.request_type,
            data_categories=r.data_categories,
            status=r.status,
            created_at=r.created_at,
            completed_at=r.completed_at,
            download_expires_at=r.download_expires_at,
        )
        for r in requests
    ]


@router.get("/data-export/{request_id}", response_model=DataExportRequestResponse)
async def get_my_data_export(
    request_id: str,
    request: Request,  # noqa: ARG001
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
) -> DataExportRequestResponse:
    """Get status of a specific data export request."""
    result = await db.execute(
        select(DataExportRequest).where(
            DataExportRequest.id == request_id,
            DataExportRequest.user_id == user_id,
        )
    )
    export_request = result.scalar_one_or_none()

    if not export_request:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Export request not found",
        )

    return DataExportRequestResponse(
        id=export_request.id,
        request_type=export_request.request_type,
        data_categories=export_request.data_categories,
        status=export_request.status,
        created_at=export_request.created_at,
        completed_at=export_request.completed_at,
        download_expires_at=export_request.download_expires_at,
    )
