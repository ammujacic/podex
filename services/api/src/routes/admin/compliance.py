"""Admin compliance routes for SOC 2 compliance features."""

from __future__ import annotations

import json
import tempfile
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.audit_logger import AuditAction, AuditLogger
from src.database import get_db
from src.database.models import (
    AccessReview,
    AuditLog,
    ConversationMessage,
    ConversationSession,
    DataExportRequest,
    DataRetentionPolicy,
    Session,
    UsageRecord,
    User,
    UserConfig,
    UserSubscription,
)
from src.middleware.admin import get_admin_user_id

router = APIRouter()


async def get_admin_user(request: Request) -> dict[str, Any]:
    """Get admin user info from request as a dependency."""
    user_id = get_admin_user_id(request)
    return {
        "id": user_id,
        "email": getattr(request.state, "user_email", None),
        "role": getattr(request.state, "user_role", None),
    }


# ============================================================================
# Request/Response Models
# ============================================================================


class DataRetentionPolicyCreate(BaseModel):
    """Create a new data retention policy."""

    name: str = Field(..., min_length=1, max_length=100)
    data_type: str = Field(..., min_length=1, max_length=50)
    retention_days: int = Field(..., ge=1)
    archive_after_days: int | None = Field(None, ge=1)
    delete_after_archive_days: int | None = Field(None, ge=1)
    description: str | None = None
    legal_basis: str | None = None
    is_enabled: bool = True


class DataRetentionPolicyUpdate(BaseModel):
    """Update a data retention policy."""

    name: str | None = Field(None, min_length=1, max_length=100)
    retention_days: int | None = Field(None, ge=1)
    archive_after_days: int | None = None
    delete_after_archive_days: int | None = None
    description: str | None = None
    legal_basis: str | None = None
    is_enabled: bool | None = None


class DataRetentionPolicyResponse(BaseModel):
    """Data retention policy response."""

    id: str
    name: str
    data_type: str
    retention_days: int
    archive_after_days: int | None
    delete_after_archive_days: int | None
    description: str | None
    legal_basis: str | None
    is_enabled: bool
    last_executed_at: datetime | None
    records_archived: int
    records_deleted: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AccessReviewCreate(BaseModel):
    """Create a new access review."""

    review_type: str = Field(..., min_length=1, max_length=50)
    review_period_start: datetime
    review_period_end: datetime
    target_user_id: str | None = None
    due_date: datetime | None = None
    notes: str | None = None


class AccessReviewUpdate(BaseModel):
    """Update an access review."""

    status: str | None = Field(None, pattern="^(pending|in_progress|completed|cancelled)$")
    findings: dict[str, Any] | None = None
    actions_taken: list[dict[str, Any]] | None = None
    notes: str | None = None


class AccessReviewResponse(BaseModel):
    """Access review response."""

    id: str
    review_type: str
    review_period_start: datetime
    review_period_end: datetime
    status: str
    target_user_id: str | None
    reviewer_id: str | None
    findings: dict[str, Any] | None
    actions_taken: list[dict[str, Any]] | None
    notes: str | None
    initiated_at: datetime
    completed_at: datetime | None
    due_date: datetime | None

    model_config = ConfigDict(from_attributes=True)


class DataExportRequestResponse(BaseModel):
    """Data export request response."""

    id: str
    user_id: str
    request_type: str
    data_categories: list[str]
    status: str
    processed_by: str | None
    error_message: str | None
    export_file_size_bytes: int | None
    download_expires_at: datetime | None
    download_count: int
    created_at: datetime
    started_at: datetime | None
    completed_at: datetime | None

    model_config = ConfigDict(from_attributes=True)


class ComplianceStats(BaseModel):
    """Compliance dashboard statistics."""

    # Data retention
    total_policies: int
    enabled_policies: int
    policies_executed_last_24h: int
    total_archived: int
    total_deleted: int

    # Access reviews
    pending_reviews: int
    in_progress_reviews: int
    completed_reviews_30d: int
    overdue_reviews: int

    # Data exports
    pending_exports: int
    completed_exports_30d: int
    failed_exports_30d: int


class RetentionExecutionResult(BaseModel):
    """Result of running retention policies."""

    policy_id: str
    data_type: str
    records_archived: int
    records_deleted: int
    execution_time_ms: int
    errors: list[str]


# ============================================================================
# Data Retention Policy Routes
# ============================================================================


@router.get("/retention/policies", response_model=list[DataRetentionPolicyResponse])
async def list_retention_policies(
    db: AsyncSession = Depends(get_db),
    admin: dict[str, Any] = Depends(get_admin_user),
) -> list[DataRetentionPolicyResponse]:
    """List all data retention policies."""
    query = select(DataRetentionPolicy).order_by(DataRetentionPolicy.data_type)
    result = await db.execute(query)
    policies = result.scalars().all()
    return [DataRetentionPolicyResponse.model_validate(p) for p in policies]


@router.post(
    "/retention/policies",
    response_model=DataRetentionPolicyResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_retention_policy(
    request: DataRetentionPolicyCreate,
    db: AsyncSession = Depends(get_db),
    admin: dict[str, Any] = Depends(get_admin_user),
) -> DataRetentionPolicyResponse:
    """Create a new data retention policy."""

    # Check for duplicate data_type
    existing = await db.execute(
        select(DataRetentionPolicy).where(DataRetentionPolicy.data_type == request.data_type)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Policy for data type '{request.data_type}' already exists",
        )

    policy = DataRetentionPolicy(
        id=str(uuid4()),
        name=request.name,
        data_type=request.data_type,
        retention_days=request.retention_days,
        archive_after_days=request.archive_after_days,
        delete_after_archive_days=request.delete_after_archive_days,
        description=request.description,
        legal_basis=request.legal_basis,
        is_enabled=request.is_enabled,
        created_by=admin.get("id"),
    )

    db.add(policy)
    await db.commit()
    await db.refresh(policy)

    return DataRetentionPolicyResponse.model_validate(policy)


@router.patch("/retention/policies/{policy_id}", response_model=DataRetentionPolicyResponse)
async def update_retention_policy(
    policy_id: str,
    request: DataRetentionPolicyUpdate,
    db: AsyncSession = Depends(get_db),
    admin: dict[str, Any] = Depends(get_admin_user),
) -> DataRetentionPolicyResponse:
    """Update a data retention policy."""
    query = select(DataRetentionPolicy).where(DataRetentionPolicy.id == policy_id)
    result = await db.execute(query)
    policy = result.scalar_one_or_none()

    if not policy:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Policy not found",
        )

    update_data = request.model_dump(exclude_unset=True)
    if update_data:
        await db.execute(
            update(DataRetentionPolicy)
            .where(DataRetentionPolicy.id == policy_id)
            .values(**update_data)
        )
        await db.commit()
        await db.refresh(policy)

    return DataRetentionPolicyResponse.model_validate(policy)


@router.delete("/retention/policies/{policy_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_retention_policy(
    policy_id: str,
    db: AsyncSession = Depends(get_db),
    admin: dict[str, Any] = Depends(get_admin_user),
) -> None:
    """Delete a data retention policy."""
    result = await db.execute(
        select(DataRetentionPolicy).where(DataRetentionPolicy.id == policy_id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Policy not found",
        )

    await db.execute(delete(DataRetentionPolicy).where(DataRetentionPolicy.id == policy_id))
    await db.commit()


@router.post("/retention/run", response_model=list[RetentionExecutionResult])
async def run_retention_policies(
    policy_id: str | None = Query(None),
    dry_run: bool = Query(True),
    db: AsyncSession = Depends(get_db),
    admin: dict[str, Any] = Depends(get_admin_user),
) -> list[RetentionExecutionResult]:
    """Execute data retention policies.

    If policy_id is provided, only that policy is executed.
    Set dry_run=false to actually delete/archive data.
    """
    import time

    # Get policies to execute
    query = select(DataRetentionPolicy).where(DataRetentionPolicy.is_enabled == True)
    if policy_id:
        query = query.where(DataRetentionPolicy.id == policy_id)

    result = await db.execute(query)
    policies = result.scalars().all()

    results = []
    for policy in policies:
        start_time = time.time()
        errors: list[str] = []
        records_archived = 0
        records_deleted = 0

        now = datetime.now(UTC)
        retention_cutoff = now - timedelta(days=policy.retention_days)
        archive_cutoff = (
            now - timedelta(days=policy.archive_after_days) if policy.archive_after_days else None
        )
        delete_archived_cutoff = (
            now - timedelta(days=policy.archive_after_days + policy.delete_after_archive_days)
            if policy.archive_after_days and policy.delete_after_archive_days
            else None
        )

        try:
            if policy.data_type == "audit_logs":
                # Delete old audit logs beyond retention period
                if not dry_run:
                    delete_result = await db.execute(
                        delete(AuditLog).where(AuditLog.created_at < retention_cutoff)
                    )
                    records_deleted = getattr(delete_result, "rowcount", 0)
                else:
                    # Count for dry run
                    count_result = await db.execute(
                        select(func.count(AuditLog.id)).where(
                            AuditLog.created_at < retention_cutoff
                        )
                    )
                    records_deleted = count_result.scalar() or 0

            elif policy.data_type == "sessions":
                # Archive sessions older than archive_after_days
                if archive_cutoff:
                    if not dry_run:
                        archive_result = await db.execute(
                            update(Session)
                            .where(
                                Session.created_at < archive_cutoff,
                                Session.archived_at.is_(None),
                            )
                            .values(archived_at=now, archived_by=admin.get("id"))
                        )
                        records_archived = getattr(archive_result, "rowcount", 0)
                    else:
                        count_result = await db.execute(
                            select(func.count(Session.id)).where(
                                Session.created_at < archive_cutoff,
                                Session.archived_at.is_(None),
                            )
                        )
                        records_archived = count_result.scalar() or 0

                # Delete archived sessions older than delete_after_archive_days
                if delete_archived_cutoff:
                    if not dry_run:
                        delete_result = await db.execute(
                            delete(Session).where(
                                Session.archived_at.is_not(None),
                                Session.archived_at < delete_archived_cutoff,
                            )
                        )
                        records_deleted = getattr(delete_result, "rowcount", 0)
                    else:
                        count_result = await db.execute(
                            select(func.count(Session.id)).where(
                                Session.archived_at.is_not(None),
                                Session.archived_at < delete_archived_cutoff,
                            )
                        )
                        records_deleted = count_result.scalar() or 0

            elif policy.data_type == "messages":
                # Delete messages from conversation sessions older than retention period
                # Messages are cascade deleted with sessions, but this allows direct cleanup
                if not dry_run:
                    delete_result = await db.execute(
                        delete(ConversationMessage).where(
                            ConversationMessage.created_at < retention_cutoff
                        )
                    )
                    records_deleted = getattr(delete_result, "rowcount", 0)
                else:
                    count_result = await db.execute(
                        select(func.count(ConversationMessage.id)).where(
                            ConversationMessage.created_at < retention_cutoff
                        )
                    )
                    records_deleted = count_result.scalar() or 0

            elif policy.data_type == "usage_records":
                # Delete old usage records
                if not dry_run:
                    delete_result = await db.execute(
                        delete(UsageRecord).where(UsageRecord.created_at < retention_cutoff)
                    )
                    records_deleted = getattr(delete_result, "rowcount", 0)
                else:
                    count_result = await db.execute(
                        select(func.count(UsageRecord.id)).where(
                            UsageRecord.created_at < retention_cutoff
                        )
                    )
                    records_deleted = count_result.scalar() or 0

            else:
                errors.append(f"Unknown data type: {policy.data_type}")

        except Exception as e:
            errors.append(str(e))

        # Update policy execution tracking
        if not dry_run and not errors:
            await db.execute(
                update(DataRetentionPolicy)
                .where(DataRetentionPolicy.id == policy.id)
                .values(
                    last_executed_at=now,
                    records_archived=policy.records_archived + records_archived,
                    records_deleted=policy.records_deleted + records_deleted,
                )
            )

        execution_time_ms = int((time.time() - start_time) * 1000)

        results.append(
            RetentionExecutionResult(
                policy_id=policy.id,
                data_type=policy.data_type,
                records_archived=records_archived,
                records_deleted=records_deleted,
                execution_time_ms=execution_time_ms,
                errors=errors,
            )
        )

    if not dry_run:
        await db.commit()

        # Audit log the retention execution
        audit = AuditLogger(db).set_context(user_id=admin.get("id"))
        await audit.log_admin_action(
            AuditAction.ADMIN_DATA_EXPORTED,
            resource_type="retention_policy",
            details={
                "action": "retention_executed",
                "policies_executed": len(results),
                "total_archived": sum(r.records_archived for r in results),
                "total_deleted": sum(r.records_deleted for r in results),
                "dry_run": dry_run,
            },
        )

    return results


# ============================================================================
# Access Review Routes
# ============================================================================


@router.get("/access-reviews", response_model=list[AccessReviewResponse])
async def list_access_reviews(
    status_filter: str | None = Query(None, alias="status"),
    review_type: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    admin: dict[str, Any] = Depends(get_admin_user),
) -> list[AccessReviewResponse]:
    """List access reviews with filtering."""
    conditions = []
    if status_filter:
        conditions.append(AccessReview.status == status_filter)
    if review_type:
        conditions.append(AccessReview.review_type == review_type)

    query = select(AccessReview).order_by(AccessReview.initiated_at.desc())
    if conditions:
        query = query.where(*conditions)
    query = query.offset((page - 1) * page_size).limit(page_size)

    result = await db.execute(query)
    reviews = result.scalars().all()
    return [AccessReviewResponse.model_validate(r) for r in reviews]


@router.post(
    "/access-reviews", response_model=AccessReviewResponse, status_code=status.HTTP_201_CREATED
)
async def initiate_access_review(
    request: AccessReviewCreate,
    db: AsyncSession = Depends(get_db),
    admin: dict[str, Any] = Depends(get_admin_user),
) -> AccessReviewResponse:
    """Initiate a new access review."""

    review = AccessReview(
        id=str(uuid4()),
        review_type=request.review_type,
        review_period_start=request.review_period_start,
        review_period_end=request.review_period_end,
        target_user_id=request.target_user_id,
        reviewer_id=admin.get("id"),
        due_date=request.due_date,
        notes=request.notes,
        status="pending",
    )

    db.add(review)
    await db.commit()
    await db.refresh(review)

    return AccessReviewResponse.model_validate(review)


@router.get("/access-reviews/{review_id}", response_model=AccessReviewResponse)
async def get_access_review(
    review_id: str,
    db: AsyncSession = Depends(get_db),
    admin: dict[str, Any] = Depends(get_admin_user),
) -> AccessReviewResponse:
    """Get a specific access review."""
    query = select(AccessReview).where(AccessReview.id == review_id)
    result = await db.execute(query)
    review = result.scalar_one_or_none()

    if not review:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Access review not found",
        )

    return AccessReviewResponse.model_validate(review)


@router.patch("/access-reviews/{review_id}", response_model=AccessReviewResponse)
async def update_access_review(
    review_id: str,
    request: AccessReviewUpdate,
    db: AsyncSession = Depends(get_db),
    admin: dict[str, Any] = Depends(get_admin_user),
) -> AccessReviewResponse:
    """Update an access review."""
    query = select(AccessReview).where(AccessReview.id == review_id)
    result = await db.execute(query)
    review = result.scalar_one_or_none()

    if not review:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Access review not found",
        )

    update_data = request.model_dump(exclude_unset=True)
    if update_data:
        # Set completed_at if status is being set to completed
        if update_data.get("status") == "completed" and review.status != "completed":
            update_data["completed_at"] = datetime.now(UTC)

        await db.execute(
            update(AccessReview).where(AccessReview.id == review_id).values(**update_data)
        )
        await db.commit()
        await db.refresh(review)

    return AccessReviewResponse.model_validate(review)


@router.get("/access-reviews/generate-report", response_model=dict)
async def generate_access_report(
    review_type: str = Query(...),
    db: AsyncSession = Depends(get_db),
    admin: dict[str, Any] = Depends(get_admin_user),
) -> dict[str, Any]:
    """Generate an access report for review.

    Returns users with their access levels for the specified review type.
    """
    if review_type == "admin_access":
        # Get all admin users
        query = select(User).where(User.role.in_(["admin", "super_admin"]))
        result = await db.execute(query)
        users = result.scalars().all()

        return {
            "review_type": review_type,
            "generated_at": datetime.now(UTC).isoformat(),
            "total_users": len(users),
            "users": [
                {
                    "id": u.id,
                    "email": u.email,
                    "name": u.name,
                    "role": u.role,
                    "is_active": u.is_active,
                    "created_at": u.created_at.isoformat() if u.created_at else None,
                    "last_login_at": None,  # Would need to track this
                }
                for u in users
            ],
        }
    if review_type == "user_access":
        # Get all active users
        count_query = select(func.count(User.id)).where(User.is_active == True)
        total = (await db.execute(count_query)).scalar() or 0

        return {
            "review_type": review_type,
            "generated_at": datetime.now(UTC).isoformat(),
            "total_active_users": total,
            "summary": "Full user list available in admin user management",
        }
    return {
        "review_type": review_type,
        "generated_at": datetime.now(UTC).isoformat(),
        "message": f"Report generation for '{review_type}' not yet implemented",
    }


# ============================================================================
# Data Export Request Routes (Admin View)
# ============================================================================


@router.get("/data-exports", response_model=list[DataExportRequestResponse])
async def list_data_export_requests(
    status_filter: str | None = Query(None, alias="status"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    admin: dict[str, Any] = Depends(get_admin_user),
) -> list[DataExportRequestResponse]:
    """List all data export requests (admin view)."""
    query = select(DataExportRequest).order_by(DataExportRequest.created_at.desc())
    if status_filter:
        query = query.where(DataExportRequest.status == status_filter)
    query = query.offset((page - 1) * page_size).limit(page_size)

    result = await db.execute(query)
    requests = result.scalars().all()
    return [DataExportRequestResponse.model_validate(r) for r in requests]


@router.post("/data-exports/{request_id}/process", response_model=DataExportRequestResponse)
async def process_data_export(
    request_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    admin: dict[str, Any] = Depends(get_admin_user),
) -> DataExportRequestResponse:
    """Process a pending data export request.

    This endpoint collects all user data based on requested categories
    and generates a JSON export file.
    """
    query = select(DataExportRequest).where(DataExportRequest.id == request_id)
    result = await db.execute(query)
    export_request = result.scalar_one_or_none()

    if not export_request:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Export request not found",
        )

    if export_request.status != "pending":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Request is already {export_request.status}",
        )

    now = datetime.now(UTC)

    # Mark as processing
    await db.execute(
        update(DataExportRequest)
        .where(DataExportRequest.id == request_id)
        .values(
            status="processing",
            processed_by=admin.get("id"),
            started_at=now,
        )
    )
    await db.commit()

    try:
        # Collect user data based on requested categories
        user_id = export_request.user_id
        categories = export_request.data_categories
        export_data: dict[str, Any] = {
            "export_metadata": {
                "request_id": request_id,
                "user_id": user_id,
                "request_type": export_request.request_type,
                "data_categories": categories,
                "generated_at": now.isoformat(),
            }
        }

        # Profile data
        if "profile" in categories:
            user_result = await db.execute(select(User).where(User.id == user_id))
            user = user_result.scalar_one_or_none()
            if user:
                export_data["profile"] = {
                    "id": user.id,
                    "email": user.email,
                    "name": user.name,
                    "avatar_url": user.avatar_url,
                    "oauth_provider": user.oauth_provider,
                    "is_active": user.is_active,
                    "role": user.role,
                    "mfa_enabled": user.mfa_enabled,
                    "account_type": user.account_type,
                    "created_at": user.created_at.isoformat() if user.created_at else None,
                    "updated_at": user.updated_at.isoformat() if user.updated_at else None,
                }

        # Sessions data
        if "sessions" in categories:
            sessions_result = await db.execute(
                select(Session).where(Session.owner_id == user_id).limit(1000)
            )
            sessions = sessions_result.scalars().all()
            export_data["sessions"] = [
                {
                    "id": s.id,
                    "name": s.name,
                    "git_url": s.git_url,
                    "branch": s.branch,
                    "status": s.status,
                    "created_at": s.created_at.isoformat() if s.created_at else None,
                    "archived_at": s.archived_at.isoformat() if s.archived_at else None,
                }
                for s in sessions
            ]

        # Messages data
        if "messages" in categories:
            # Get messages from user's sessions via conversation sessions
            messages_query = (
                select(ConversationMessage)
                .join(
                    ConversationSession,
                    ConversationMessage.conversation_session_id == ConversationSession.id,
                )
                .join(Session, ConversationSession.session_id == Session.id)
                .where(Session.owner_id == user_id)
                .limit(5000)
            )
            messages_result = await db.execute(messages_query)
            messages = messages_result.scalars().all()
            export_data["messages"] = [
                {
                    "id": m.id,
                    "role": m.role,
                    "content": m.content[:1000] if m.content else None,  # Truncate large messages
                    "created_at": m.created_at.isoformat() if m.created_at else None,
                }
                for m in messages
            ]

        # Billing data
        if "billing" in categories:
            # Usage records
            usage_result = await db.execute(
                select(UsageRecord).where(UsageRecord.user_id == user_id).limit(1000)
            )
            usage_records = usage_result.scalars().all()

            # Subscription
            sub_result = await db.execute(
                select(UserSubscription).where(UserSubscription.user_id == user_id)
            )
            subscription = sub_result.scalar_one_or_none()

            export_data["billing"] = {
                "subscription": {
                    "plan_id": subscription.plan_id if subscription else None,
                    "status": subscription.status if subscription else None,
                    "billing_cycle": subscription.billing_cycle if subscription else None,
                }
                if subscription
                else None,
                "usage_records": [
                    {
                        "id": u.id,
                        "usage_type": u.usage_type,
                        "quantity": u.quantity,
                        "unit": u.unit,
                        "cost_usd": u.total_cost_cents / 100.0 if u.total_cost_cents else None,
                        "created_at": u.created_at.isoformat() if u.created_at else None,
                    }
                    for u in usage_records
                ],
            }

        # Settings/Config data
        if "settings" in categories:
            config_result = await db.execute(
                select(UserConfig).where(UserConfig.user_id == user_id)
            )
            config = config_result.scalar_one_or_none()
            if config:
                export_data["settings"] = {
                    "default_shell": config.default_shell,
                    "default_editor": config.default_editor,
                    "git_name": config.git_name,
                    "git_email": config.git_email,
                    "theme": config.theme,
                    "editor_theme": config.editor_theme,
                    "updated_at": config.updated_at.isoformat() if config.updated_at else None,
                }
            else:
                export_data["settings"] = {}

        # Write export to temporary file
        export_dir = Path(tempfile.gettempdir())
        export_filename = f"data_export_{user_id}_{request_id}.json"
        export_path = export_dir / export_filename

        # Note: Using blocking file I/O here as this is an admin export operation
        # that runs infrequently and the data needs to be written synchronously
        with export_path.open("w") as f:
            json.dump(export_data, f, indent=2, default=str)

        file_size = export_path.stat().st_size
        download_expires = now + timedelta(days=7)

        # Update request with completion info
        await db.execute(
            update(DataExportRequest)
            .where(DataExportRequest.id == request_id)
            .values(
                status="completed",
                completed_at=now,
                export_file_path=str(export_path),
                export_file_size_bytes=file_size,
                download_expires_at=download_expires,
            )
        )
        await db.commit()

        # Audit log the export
        audit = AuditLogger(db).set_context(request=request, user_id=admin.get("id"))
        await audit.log_admin_action(
            AuditAction.ADMIN_DATA_EXPORTED,
            resource_type="data_export",
            resource_id=request_id,
            details={
                "target_user_id": user_id,
                "categories": categories,
                "file_size_bytes": file_size,
            },
        )

    except Exception as e:
        # Mark as failed
        await db.execute(
            update(DataExportRequest)
            .where(DataExportRequest.id == request_id)
            .values(
                status="failed",
                error_message=str(e),
                completed_at=now,
            )
        )
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Export failed: {e!s}",
        )

    await db.refresh(export_request)
    return DataExportRequestResponse.model_validate(export_request)


@router.get("/data-exports/{request_id}/download")
async def download_data_export(
    request_id: str,
    db: AsyncSession = Depends(get_db),
    admin: dict[str, Any] = Depends(get_admin_user),
) -> FileResponse:
    """Download a completed data export file."""
    query = select(DataExportRequest).where(DataExportRequest.id == request_id)
    result = await db.execute(query)
    export_request = result.scalar_one_or_none()

    if not export_request:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Export request not found",
        )

    if export_request.status != "completed":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Export is not ready (status: {export_request.status})",
        )

    if not export_request.export_file_path or not Path(export_request.export_file_path).exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Export file not found",
        )

    now = datetime.now(UTC)
    if export_request.download_expires_at and export_request.download_expires_at < now:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="Export download has expired",
        )

    # Increment download count
    await db.execute(
        update(DataExportRequest)
        .where(DataExportRequest.id == request_id)
        .values(download_count=export_request.download_count + 1)
    )
    await db.commit()

    return FileResponse(
        path=export_request.export_file_path,
        filename=f"data_export_{export_request.user_id}.json",
        media_type="application/json",
    )


# ============================================================================
# Compliance Dashboard Stats
# ============================================================================


@router.get("/stats", response_model=ComplianceStats)
async def get_compliance_stats(
    db: AsyncSession = Depends(get_db),
    admin: dict[str, Any] = Depends(get_admin_user),
) -> ComplianceStats:
    """Get compliance dashboard statistics."""
    now = datetime.now(UTC)
    last_24h = now - timedelta(hours=24)
    last_30d = now - timedelta(days=30)

    # Data retention stats
    total_policies = (await db.execute(select(func.count(DataRetentionPolicy.id)))).scalar() or 0
    enabled_policies = (
        await db.execute(
            select(func.count(DataRetentionPolicy.id)).where(DataRetentionPolicy.is_enabled == True)
        )
    ).scalar() or 0
    policies_executed_24h = (
        await db.execute(
            select(func.count(DataRetentionPolicy.id)).where(
                DataRetentionPolicy.last_executed_at >= last_24h
            )
        )
    ).scalar() or 0
    total_archived = (
        await db.execute(select(func.sum(DataRetentionPolicy.records_archived)))
    ).scalar() or 0
    total_deleted = (
        await db.execute(select(func.sum(DataRetentionPolicy.records_deleted)))
    ).scalar() or 0

    # Access review stats
    pending_reviews = (
        await db.execute(
            select(func.count(AccessReview.id)).where(AccessReview.status == "pending")
        )
    ).scalar() or 0
    in_progress_reviews = (
        await db.execute(
            select(func.count(AccessReview.id)).where(AccessReview.status == "in_progress")
        )
    ).scalar() or 0
    completed_reviews_30d = (
        await db.execute(
            select(func.count(AccessReview.id)).where(
                AccessReview.status == "completed",
                AccessReview.completed_at >= last_30d,
            )
        )
    ).scalar() or 0
    overdue_reviews = (
        await db.execute(
            select(func.count(AccessReview.id)).where(
                AccessReview.status.in_(["pending", "in_progress"]),
                AccessReview.due_date < now,
            )
        )
    ).scalar() or 0

    # Data export stats
    pending_exports = (
        await db.execute(
            select(func.count(DataExportRequest.id)).where(
                DataExportRequest.status.in_(["pending", "processing"])
            )
        )
    ).scalar() or 0
    completed_exports_30d = (
        await db.execute(
            select(func.count(DataExportRequest.id)).where(
                DataExportRequest.status == "completed",
                DataExportRequest.completed_at >= last_30d,
            )
        )
    ).scalar() or 0
    failed_exports_30d = (
        await db.execute(
            select(func.count(DataExportRequest.id)).where(
                DataExportRequest.status == "failed",
                DataExportRequest.completed_at >= last_30d,
            )
        )
    ).scalar() or 0

    return ComplianceStats(
        total_policies=total_policies,
        enabled_policies=enabled_policies,
        policies_executed_last_24h=policies_executed_24h,
        total_archived=total_archived,
        total_deleted=total_deleted,
        pending_reviews=pending_reviews,
        in_progress_reviews=in_progress_reviews,
        completed_reviews_30d=completed_reviews_30d,
        overdue_reviews=overdue_reviews,
        pending_exports=pending_exports,
        completed_exports_30d=completed_exports_30d,
        failed_exports_30d=failed_exports_30d,
    )
