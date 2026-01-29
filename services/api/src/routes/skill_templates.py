"""API routes for skill templates management."""

from __future__ import annotations

import json
import re
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.database.models import SkillTemplate, UserSkill
from src.middleware.auth import get_current_user

router = APIRouter(prefix="/skill-templates", tags=["skill-templates"])


# ============================================================================
# Request/Response Models
# ============================================================================


class TemplateVariableResponse(BaseModel):
    """A template variable definition."""

    name: str
    type: str  # string, number, boolean, array
    description: str
    default: Any | None = None
    required: bool = False


class TemplateStepResponse(BaseModel):
    """A template step definition."""

    name: str
    description: str
    tool: str | None = None
    skill: str | None = None
    parameters: dict[str, Any] | None = None
    condition: str | None = None
    on_success: str | None = None
    on_failure: str | None = None
    parallel_with: list[str] | None = None


class SkillTemplateResponse(BaseModel):
    """Response containing template details."""

    id: str
    name: str
    slug: str
    description: str
    category: str
    icon: str | None
    default_triggers: list[str] | None
    default_tags: list[str] | None
    required_tools: list[str] | None
    step_templates: list[dict[str, Any]] | None
    variables: list[dict[str, Any]] | None
    is_system: bool
    usage_count: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class SkillTemplateListResponse(BaseModel):
    """List of skill templates."""

    templates: list[SkillTemplateResponse]
    total: int
    categories: list[str]


class CreateSkillFromTemplateRequest(BaseModel):
    """Request to create a skill from a template."""

    name: str = Field(..., min_length=1, max_length=100)
    slug: str = Field(..., min_length=1, max_length=100, pattern=r"^[a-z0-9_-]+$")
    description: str | None = None
    variables: dict[str, Any] = Field(default_factory=dict)
    customize_steps: bool = False
    custom_steps: list[dict[str, Any]] | None = None


class SkillFromTemplateResponse(BaseModel):
    """Response after creating a skill from template."""

    id: str
    name: str
    slug: str
    description: str
    version: str
    triggers: list[str]
    tags: list[str]
    required_tools: list[str]
    steps: list[dict[str, Any]]
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ============================================================================
# Routes
# ============================================================================


@router.get("", response_model=SkillTemplateListResponse)
async def list_skill_templates(
    category: str | None = Query(None, description="Filter by category"),
    search: str | None = Query(None, description="Search by name or description"),
    db: AsyncSession = Depends(get_db),
    user: dict[str, str | None] = Depends(get_current_user),  # noqa: ARG001
) -> SkillTemplateListResponse:
    """List available skill templates."""
    # Build query
    query = select(SkillTemplate)

    if category:
        query = query.where(SkillTemplate.category == category)

    if search:
        search_pattern = f"%{search}%"
        query = query.where(
            (SkillTemplate.name.ilike(search_pattern))
            | (SkillTemplate.description.ilike(search_pattern))
        )

    query = query.order_by(SkillTemplate.usage_count.desc(), SkillTemplate.name)

    result = await db.execute(query)
    templates = result.scalars().all()

    # Get unique categories
    categories_query = select(SkillTemplate.category).distinct()
    categories_result = await db.execute(categories_query)
    categories = [row[0] for row in categories_result if row[0]]

    return SkillTemplateListResponse(
        templates=[SkillTemplateResponse.model_validate(t) for t in templates],
        total=len(templates),
        categories=sorted(categories),
    )


@router.get("/{slug}", response_model=SkillTemplateResponse)
async def get_skill_template(
    slug: str,
    db: AsyncSession = Depends(get_db),
    user: dict[str, str | None] = Depends(get_current_user),  # noqa: ARG001
) -> SkillTemplateResponse:
    """Get a specific skill template by slug."""
    query = select(SkillTemplate).where(SkillTemplate.slug == slug)
    result = await db.execute(query)
    template = result.scalar_one_or_none()

    if not template:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Template not found",
        )

    return SkillTemplateResponse.model_validate(template)


@router.post("/{slug}/create-skill", response_model=SkillFromTemplateResponse)
async def create_skill_from_template(
    slug: str,
    request: CreateSkillFromTemplateRequest,
    db: AsyncSession = Depends(get_db),
    user: dict[str, str | None] = Depends(get_current_user),
) -> SkillFromTemplateResponse:
    """Create a new skill from a template."""
    user_id = user["id"]

    # Get template
    template_query = select(SkillTemplate).where(SkillTemplate.slug == slug)
    template_result = await db.execute(template_query)
    template = template_result.scalar_one_or_none()

    if not template:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Template not found",
        )

    # Check for duplicate slug
    existing_query = select(UserSkill).where(
        UserSkill.user_id == user_id,
        UserSkill.slug == request.slug,
    )
    existing = (await db.execute(existing_query)).scalar_one_or_none()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Skill with slug '{request.slug}' already exists",
        )

    # Prepare steps - apply variable substitution
    if request.customize_steps and request.custom_steps:
        steps = request.custom_steps
    else:
        steps = _apply_variables(template.step_templates or [], request.variables)

    # Create skill
    now = datetime.now(UTC)
    description = request.description or template.description

    skill = UserSkill(
        id=str(uuid4()),
        user_id=user_id,
        name=request.name,
        slug=request.slug,
        description=description,
        version="1.0.0",
        triggers=_apply_variable_list(template.default_triggers or [], request.variables),
        tags=template.default_tags or [],
        required_tools=template.required_tools or [],
        steps=steps,
        system_prompt=None,
        generated_by_agent=False,
        source_conversation_id=None,
        is_public=False,
        usage_count=0,
        created_at=now,
        updated_at=now,
    )

    db.add(skill)

    # Increment template usage count
    await db.execute(
        update(SkillTemplate)
        .where(SkillTemplate.id == template.id)
        .values(usage_count=SkillTemplate.usage_count + 1)
    )

    await db.commit()
    await db.refresh(skill)

    return SkillFromTemplateResponse.model_validate(skill)


@router.get("/{slug}/preview", response_model=dict)
async def preview_skill_from_template(
    slug: str,
    variables: str | None = Query(None, description="JSON-encoded variables"),
    db: AsyncSession = Depends(get_db),
    user: dict[str, str | None] = Depends(get_current_user),  # noqa: ARG001
) -> dict[str, Any]:
    """Preview a skill that would be created from a template with given variables."""
    # Get template
    query = select(SkillTemplate).where(SkillTemplate.slug == slug)
    result = await db.execute(query)
    template = result.scalar_one_or_none()

    if not template:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Template not found",
        )

    # Parse variables
    vars_dict: dict[str, Any] = {}
    if variables:
        try:
            vars_dict = json.loads(variables)
        except json.JSONDecodeError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid JSON for variables",
            )

    # Generate preview
    return {
        "name": f"New {template.name}",
        "description": template.description,
        "triggers": _apply_variable_list(template.default_triggers or [], vars_dict),
        "tags": template.default_tags or [],
        "required_tools": template.required_tools or [],
        "steps": _apply_variables(template.step_templates or [], vars_dict),
        "variables_used": list(vars_dict.keys()),
        "template": {
            "name": template.name,
            "category": template.category,
            "icon": template.icon,
        },
    }


# ============================================================================
# Helper Functions
# ============================================================================


def _apply_variables(
    steps: list[dict[str, Any]], variables: dict[str, Any]
) -> list[dict[str, Any]]:
    """Apply variable substitution to step templates."""
    result: list[dict[str, Any]] = []
    for step in steps:
        new_step: dict[str, Any] = {}
        for key, value in step.items():
            if isinstance(value, str):
                # Replace {{var}} patterns
                for var_name, var_value in variables.items():
                    pattern = r"\{\{\s*" + re.escape(var_name) + r"\s*\}\}"
                    value = re.sub(pattern, str(var_value), value)
                new_step[key] = value
            elif isinstance(value, dict):
                new_step[key] = _apply_variables_to_dict(value, variables)
            elif isinstance(value, list):
                new_step[key] = _apply_variable_list(value, variables)
            else:
                new_step[key] = value
        result.append(new_step)
    return result


def _apply_variables_to_dict(obj: dict[str, Any], variables: dict[str, Any]) -> dict[str, Any]:
    """Apply variable substitution to a dictionary."""
    result: dict[str, Any] = {}
    for key, value in obj.items():
        if isinstance(value, str):
            for var_name, var_value in variables.items():
                pattern = r"\{\{\s*" + re.escape(var_name) + r"\s*\}\}"
                value = re.sub(pattern, str(var_value), value)
            result[key] = value
        elif isinstance(value, dict):
            result[key] = _apply_variables_to_dict(value, variables)
        elif isinstance(value, list):
            result[key] = _apply_variable_list(value, variables)
        else:
            result[key] = value
    return result


def _apply_variable_list(items: list[Any], variables: dict[str, Any]) -> list[Any]:
    """Apply variable substitution to a list."""
    result: list[Any] = []
    for item in items:
        if isinstance(item, str):
            for var_name, var_value in variables.items():
                pattern = r"\{\{\s*" + re.escape(var_name) + r"\s*\}\}"
                item = re.sub(pattern, str(var_value), item)
            result.append(item)
        elif isinstance(item, dict):
            result.append(_apply_variables_to_dict(item, variables))
        elif isinstance(item, list):
            result.append(_apply_variable_list(item, variables))
        else:
            result.append(item)
    return result
