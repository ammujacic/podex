"""Admin LLM Model management routes.

Provides dynamic management of LLM models available on the platform,
including capabilities, pricing tiers, and agent type defaults.
"""

import secrets
from datetime import datetime
from typing import Annotated, Any

import structlog
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.database import get_db
from src.database.models import (
    LLMModel,
    PlatformSetting,
    SubscriptionPlan,
    UserConfig,
    UserOAuthToken,
    UserSubscription,
)
from src.middleware.admin import get_admin_user_id, require_admin, require_super_admin
from src.middleware.auth import get_optional_user_id
from src.middleware.rate_limit import RATE_LIMIT_STANDARD, limiter

logger = structlog.get_logger()

router = APIRouter()
DbSession = Annotated[AsyncSession, Depends(get_db)]


# ==================== Pydantic Models ====================


class ModelCapabilities(BaseModel):
    """Model capability flags."""

    vision: bool = Field(default=False, description="Supports image input")
    thinking: bool = Field(default=False, description="Supports extended thinking")
    thinking_coming_soon: bool = Field(default=False, description="Extended thinking coming soon")
    tool_use: bool = Field(default=True, description="Supports tool/function calling")
    streaming: bool = Field(default=True, description="Supports streaming responses")
    json_mode: bool = Field(default=True, description="Supports JSON output mode")


class CreateModelRequest(BaseModel):
    """Request to create a new LLM model."""

    model_id: str = Field(..., description="Unique provider model ID")
    display_name: str = Field(..., min_length=1, max_length=100)
    provider: str = Field(..., description="Provider: vertex, anthropic, openai, ollama")
    family: str = Field(
        default="anthropic", description="Model family: anthropic, gemini, llama, mistral"
    )
    description: str | None = None
    cost_tier: str = Field(default="medium", description="Cost tier: low, medium, high, premium")
    capabilities: ModelCapabilities = Field(default_factory=ModelCapabilities)
    context_window: int = Field(default=200000, description="Maximum context window tokens")
    max_output_tokens: int = Field(default=8192, description="Maximum output tokens")
    input_cost_per_million: float = Field(
        default=0.0, description="Input cost per million tokens (USD)"
    )
    output_cost_per_million: float = Field(
        default=0.0, description="Output cost per million tokens (USD)"
    )
    is_enabled: bool = True
    is_default: bool = Field(default=False, description="Is this a platform default model")
    is_user_key_model: bool = Field(default=False, description="Requires user's own API key")


class UpdateModelRequest(BaseModel):
    """Request to update an LLM model."""

    display_name: str | None = None
    description: str | None = None
    cost_tier: str | None = None
    capabilities: ModelCapabilities | None = None
    context_window: int | None = None
    max_output_tokens: int | None = None
    input_cost_per_million: float | None = None
    output_cost_per_million: float | None = None
    is_enabled: bool | None = None
    is_default: bool | None = None
    is_user_key_model: bool | None = None
    sort_order: int | None = None


class ModelResponse(BaseModel):
    """LLM model response."""

    id: str
    model_id: str
    display_name: str
    provider: str
    family: str
    description: str | None
    cost_tier: str
    capabilities: dict[str, Any]
    context_window: int
    max_output_tokens: int
    input_cost_per_million: float
    output_cost_per_million: float
    is_enabled: bool
    is_default: bool
    is_user_key_model: bool
    sort_order: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AgentTypeDefaults(BaseModel):
    """Default model settings for an agent type."""

    model_id: str
    temperature: float = 0.7
    max_tokens: int = 4096


class UpdateAgentDefaultsRequest(BaseModel):
    """Request to update agent type defaults."""

    agent_type: str = Field(
        ...,
        description="Agent type: architect, coder, reviewer, tester, chat, etc.",
    )
    model_id: str
    temperature: float | None = None
    max_tokens: int | None = None


class AgentDefaultsResponse(BaseModel):
    """Response with all agent type defaults."""

    defaults: dict[str, AgentTypeDefaults]


# ==================== Model CRUD Routes ====================


def _model_to_response(m: LLMModel) -> ModelResponse:
    """Convert LLMModel to ModelResponse."""
    metadata = m.model_metadata or {}
    return ModelResponse(
        id=m.id,
        model_id=m.model_id,
        display_name=m.display_name,
        provider=m.provider,
        family=m.family,
        description=metadata.get("description"),
        cost_tier=m.cost_tier,
        capabilities=m.capabilities or {},
        context_window=m.context_window,
        max_output_tokens=m.max_output_tokens,
        input_cost_per_million=m.input_cost_per_million or 0.0,
        output_cost_per_million=m.output_cost_per_million or 0.0,
        is_enabled=m.is_enabled,
        is_default=m.is_default,
        is_user_key_model=m.is_user_key_model,
        sort_order=m.sort_order,
        created_at=m.created_at,
        updated_at=m.updated_at,
    )


@router.get("", response_model=list[ModelResponse])
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def list_models(
    request: Request,
    response: Response,
    db: DbSession,
    provider: Annotated[str | None, Query(description="Filter by provider")] = None,
    family: Annotated[str | None, Query(description="Filter by model family")] = None,
    enabled_only: Annotated[bool, Query(description="Only show enabled models")] = False,
) -> list[ModelResponse]:
    """List all LLM models."""
    query = select(LLMModel).order_by(LLMModel.sort_order, LLMModel.provider, LLMModel.display_name)

    if provider:
        query = query.where(LLMModel.provider == provider)
    if family:
        query = query.where(LLMModel.family == family)
    if enabled_only:
        query = query.where(LLMModel.is_enabled == True)

    result = await db.execute(query)
    models = result.scalars().all()

    return [_model_to_response(m) for m in models]


@router.post("", response_model=ModelResponse, status_code=201)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def create_model(
    request: Request,
    response: Response,
    data: CreateModelRequest,
    db: DbSession,
) -> ModelResponse:
    """Create a new LLM model."""
    admin_id = get_admin_user_id(request)

    # Check for duplicate model_id
    existing = await db.execute(select(LLMModel).where(LLMModel.model_id == data.model_id))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Model ID already exists")

    model = LLMModel(
        model_id=data.model_id,
        display_name=data.display_name,
        provider=data.provider,
        family=data.family,
        cost_tier=data.cost_tier,
        capabilities=data.capabilities.model_dump(),
        context_window=data.context_window,
        max_output_tokens=data.max_output_tokens,
        input_cost_per_million=data.input_cost_per_million,
        output_cost_per_million=data.output_cost_per_million,
        is_enabled=data.is_enabled,
        is_default=data.is_default,
        model_metadata={"description": data.description} if data.description else None,
    )

    db.add(model)
    await db.commit()
    await db.refresh(model)

    logger.info("Admin created LLM model", admin_id=admin_id, model_id=model.model_id)

    return _model_to_response(model)


@router.get("/agent-defaults", response_model=AgentDefaultsResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def get_agent_defaults(
    request: Request,
    response: Response,
    db: DbSession,
) -> AgentDefaultsResponse:
    """Get default model settings for all agent types."""
    result = await db.execute(
        select(PlatformSetting).where(PlatformSetting.key == "agent_model_defaults")
    )
    setting = result.scalar_one_or_none()

    if not setting or not isinstance(setting.value, dict):
        raise HTTPException(
            status_code=500,
            detail="agent_model_defaults not configured. Run database seeds.",
        )

    return AgentDefaultsResponse(
        defaults={k: AgentTypeDefaults(**v) for k, v in setting.value.items()}
    )


@router.put("/agent-defaults/{agent_type}", response_model=AgentDefaultsResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def update_agent_default(
    agent_type: str,
    request: Request,
    response: Response,
    data: UpdateAgentDefaultsRequest,
    db: DbSession,
) -> AgentDefaultsResponse:
    """Update default model settings for a specific agent type."""
    admin_id = get_admin_user_id(request)

    valid_agent_types = {
        "architect",
        "coder",
        "reviewer",
        "tester",
        "chat",
        "security",
        "devops",
        "documentator",
        "agent_builder",
        "orchestrator",
        "custom",
        "claude-code",
        "gemini-cli",
        "openai-codex",
    }

    if agent_type not in valid_agent_types:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid agent type. Must be one of: {', '.join(valid_agent_types)}",
        )

    # Verify model exists
    model_result = await db.execute(select(LLMModel).where(LLMModel.model_id == data.model_id))
    model = model_result.scalar_one_or_none()

    if not model:
        raise HTTPException(status_code=400, detail=f"Model {data.model_id} not found")

    if not model.is_enabled:
        raise HTTPException(status_code=400, detail=f"Model {data.model_id} is disabled")

    # Get the setting from database
    result = await db.execute(
        select(PlatformSetting).where(PlatformSetting.key == "agent_model_defaults")
    )
    setting = result.scalar_one_or_none()

    if not setting or not isinstance(setting.value, dict):
        raise HTTPException(
            status_code=500,
            detail="agent_model_defaults not configured. Run database seeds.",
        )

    # Update the specific agent type
    current_value = setting.value
    current_value[agent_type] = {
        "model_id": data.model_id,
        "temperature": data.temperature
        if data.temperature is not None
        else current_value.get(agent_type, {}).get("temperature", 0.7),
        "max_tokens": data.max_tokens
        if data.max_tokens is not None
        else current_value.get(agent_type, {}).get("max_tokens", 4096),
    }
    setting.value = current_value
    setting.updated_by = admin_id

    await db.commit()
    await db.refresh(setting)

    logger.info(
        "Admin updated agent default",
        admin_id=admin_id,
        agent_type=agent_type,
        model_id=data.model_id,
    )

    return AgentDefaultsResponse(
        defaults={k: AgentTypeDefaults(**v) for k, v in setting.value.items()}
    )


# ==================== Model CRUD Routes (with path parameters) ====================


@router.get("/{model_id}", response_model=ModelResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def get_model(
    model_id: str,
    request: Request,
    response: Response,
    db: DbSession,
) -> ModelResponse:
    """Get a specific LLM model."""
    result = await db.execute(select(LLMModel).where(LLMModel.model_id == model_id))
    model = result.scalar_one_or_none()

    if not model:
        raise HTTPException(status_code=404, detail="Model not found")

    return _model_to_response(model)


@router.patch("/{model_id}", response_model=ModelResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
@require_admin
async def update_model(
    model_id: str,
    request: Request,
    response: Response,
    data: UpdateModelRequest,
    db: DbSession,
) -> ModelResponse:
    """Update an LLM model."""
    admin_id = get_admin_user_id(request)

    result = await db.execute(select(LLMModel).where(LLMModel.model_id == model_id))
    model = result.scalar_one_or_none()

    if not model:
        raise HTTPException(status_code=404, detail="Model not found")

    update_data = data.model_dump(exclude_unset=True)

    # Handle nested capabilities
    if capabilities := update_data.get("capabilities"):
        update_data["capabilities"] = capabilities.model_dump()

    # Handle description - store in metadata
    if "description" in update_data:
        metadata = model.model_metadata or {}
        metadata["description"] = update_data.pop("description")
        model.model_metadata = metadata

    for field, value in update_data.items():
        setattr(model, field, value)

    await db.commit()
    await db.refresh(model)

    logger.info("Admin updated LLM model", admin_id=admin_id, model_id=model_id)

    return _model_to_response(model)


@router.delete("/{model_id}")
@limiter.limit(RATE_LIMIT_STANDARD)
@require_super_admin
async def delete_model(
    model_id: str,
    request: Request,
    response: Response,
    db: DbSession,
) -> dict[str, str]:
    """Delete an LLM model (super admin only)."""
    admin_id = get_admin_user_id(request)

    result = await db.execute(select(LLMModel).where(LLMModel.model_id == model_id))
    model = result.scalar_one_or_none()

    if not model:
        raise HTTPException(status_code=404, detail="Model not found")

    await db.delete(model)
    await db.commit()

    logger.info("Admin deleted LLM model", admin_id=admin_id, model_id=model_id)

    return {"message": f"Model {model_id} deleted"}


# ==================== Public Routes (for regular users) ====================


class PublicModelResponse(BaseModel):
    """Public model response (limited info for users)."""

    model_id: str
    display_name: str
    provider: str
    family: str
    description: str | None
    cost_tier: str
    capabilities: dict[str, Any]
    context_window: int
    max_output_tokens: int
    is_default: bool
    input_cost_per_million: float | None = None  # Base cost (provider cost)
    output_cost_per_million: float | None = None  # Base cost (provider cost)
    good_for: list[str] = Field(default_factory=list, description="Use cases this model excels at")
    # User-specific pricing (with margin applied)
    user_input_cost_per_million: float | None = None
    user_output_cost_per_million: float | None = None
    llm_margin_percent: int | None = None


# Create a separate router for public endpoints
public_router = APIRouter()


async def _get_llm_margin(db: AsyncSession, user_id: str) -> int:
    """Get the LLM margin percentage for a user based on their subscription plan.

    Args:
        db: Database session
        user_id: The user ID

    Returns:
        LLM margin percentage (0 if no subscription)
    """
    # Get user's active subscription
    sub_result = await db.execute(
        select(UserSubscription)
        .where(UserSubscription.user_id == user_id)
        .where(UserSubscription.status.in_(["active", "trialing"])),
    )
    subscription = sub_result.scalar_one_or_none()

    if not subscription:
        return 0

    # Get the plan
    plan_result = await db.execute(
        select(SubscriptionPlan).where(SubscriptionPlan.id == subscription.plan_id),
    )
    plan = plan_result.scalar_one_or_none()

    return plan.llm_margin_percent if plan else 0


def _apply_margin_to_price(base_price: float | None, margin_percent: int) -> float | None:
    """Apply margin percentage to a price.

    Args:
        base_price: The base provider cost
        margin_percent: The margin percentage (e.g., 15 for 15%)

    Returns:
        Price with margin applied, or None if base_price is None
    """
    if base_price is None:
        return None
    if margin_percent <= 0:
        return base_price
    return base_price * (1 + margin_percent / 100)


@public_router.get("/available", response_model=list[PublicModelResponse])
@limiter.limit(RATE_LIMIT_STANDARD)
async def list_available_models(
    request: Request,
    response: Response,
    db: DbSession,
    provider: Annotated[str | None, Query(description="Filter by provider")] = None,
    family: Annotated[str | None, Query(description="Filter by model family")] = None,
) -> list[PublicModelResponse]:
    """List all available LLM models for users.

    Returns only enabled platform models (not user-key models).
    If the user is authenticated, includes user-specific pricing with their
    subscription plan's LLM margin applied.
    """
    query = (
        select(LLMModel)
        .where(LLMModel.is_enabled == True)
        .where(LLMModel.is_user_key_model == False)
        .order_by(LLMModel.sort_order, LLMModel.display_name)
    )

    if provider:
        query = query.where(LLMModel.provider == provider)
    if family:
        query = query.where(LLMModel.family == family)

    result = await db.execute(query)
    models = result.scalars().all()

    # Get user-specific margin if authenticated
    user_id = get_optional_user_id(request)
    llm_margin = 0
    if user_id:
        llm_margin = await _get_llm_margin(db, user_id)

    responses = []
    for m in models:
        user_input = (
            _apply_margin_to_price(m.input_cost_per_million, llm_margin) if user_id else None
        )
        user_output = (
            _apply_margin_to_price(m.output_cost_per_million, llm_margin) if user_id else None
        )

        responses.append(
            PublicModelResponse(
                model_id=m.model_id,
                display_name=m.display_name,
                provider=m.provider,
                family=m.family,
                description=(m.model_metadata or {}).get("description"),
                cost_tier=m.cost_tier,
                capabilities=m.capabilities or {},
                context_window=m.context_window,
                max_output_tokens=m.max_output_tokens,
                is_default=m.is_default,
                input_cost_per_million=m.input_cost_per_million,
                output_cost_per_million=m.output_cost_per_million,
                good_for=(m.model_metadata or {}).get("good_for", []),
                user_input_cost_per_million=user_input,
                user_output_cost_per_million=user_output,
                llm_margin_percent=llm_margin if user_id else None,
            )
        )

    return responses


@public_router.get("/defaults", response_model=AgentDefaultsResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_public_agent_defaults(
    request: Request,
    response: Response,
    db: DbSession,
) -> AgentDefaultsResponse:
    """Get default model settings for all agent types (public).

    Returns the platform-configured defaults for each agent type.
    """
    result = await db.execute(
        select(PlatformSetting).where(PlatformSetting.key == "agent_model_defaults")
    )
    setting = result.scalar_one_or_none()

    if not setting or not isinstance(setting.value, dict):
        raise HTTPException(
            status_code=500,
            detail="agent_model_defaults not configured. Run database seeds.",
        )

    return AgentDefaultsResponse(
        defaults={k: AgentTypeDefaults(**v) for k, v in setting.value.items()}
    )


# ==================== User Provider Models ====================
# These are models available when users configure their own API keys


class UserProviderModelResponse(BaseModel):
    """Model available via user's API key."""

    model_id: str
    display_name: str
    provider: str  # openai, anthropic, google, ollama, lmstudio
    family: str
    description: str | None
    cost_tier: str  # low, medium, high, premium
    capabilities: dict[str, Any]
    context_window: int
    max_output_tokens: int
    is_user_key: bool = True  # Always true for user-provider models
    input_cost_per_million: float | None = None
    output_cost_per_million: float | None = None
    good_for: list[str] = Field(default_factory=list, description="Use cases this model excels at")


@public_router.get("/user-providers", response_model=list[UserProviderModelResponse])
@limiter.limit(RATE_LIMIT_STANDARD)
async def list_user_provider_models(
    request: Request,
    response: Response,
    db: DbSession,
) -> list[UserProviderModelResponse]:
    """List models available via user's configured API keys.

    Returns models for providers where the user has set up an API key.
    Models are managed in the database by admins (is_user_key_model=True).
    """
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        # Not authenticated - return empty list
        return []

    # Get user's configured API key providers
    config_result = await db.execute(select(UserConfig).where(UserConfig.user_id == user_id))
    config = config_result.scalar_one_or_none()

    # Get user's OAuth-connected providers
    oauth_result = await db.execute(
        select(UserOAuthToken)
        .where(UserOAuthToken.user_id == user_id)
        .where(UserOAuthToken.status == "connected")
    )
    oauth_tokens = oauth_result.scalars().all()
    oauth_providers = [t.provider for t in oauth_tokens]

    models: list[UserProviderModelResponse] = []

    # Combine API key providers and OAuth providers
    configured_providers: list[str] = []
    if config and config.llm_api_keys:
        configured_providers.extend(list(config.llm_api_keys.keys()))
    configured_providers.extend(oauth_providers)
    # Remove duplicates while preserving order
    configured_providers = list(dict.fromkeys(configured_providers))

    # Add models from configured providers (API keys + OAuth)
    if configured_providers:
        # Query user-key models from database where provider matches user's configured keys
        query = (
            select(LLMModel)
            .where(LLMModel.is_enabled == True)
            .where(LLMModel.is_user_key_model == True)
            .where(LLMModel.provider.in_(configured_providers))
            .order_by(LLMModel.sort_order, LLMModel.display_name)
        )

        result = await db.execute(query)
        db_models = result.scalars().all()

        models.extend(
            [
                UserProviderModelResponse(
                    model_id=m.model_id,
                    display_name=m.display_name,
                    provider=m.provider,
                    family=m.family,
                    description=(m.model_metadata or {}).get("description"),
                    cost_tier=m.cost_tier,
                    capabilities=m.capabilities or {},
                    context_window=m.context_window,
                    max_output_tokens=m.max_output_tokens,
                    is_user_key=True,
                    input_cost_per_million=m.input_cost_per_million,
                    output_cost_per_million=m.output_cost_per_million,
                    good_for=(m.model_metadata or {}).get("good_for", []),
                )
                for m in db_models
            ]
        )

    # Note: Local models (Ollama, LM Studio) are NOT included here.
    # They are shown in the "Local" tab via the useOllamaModels hook on the frontend.

    return models


# ==================== Internal API for Agent Service ====================
# These endpoints are for internal service-to-service communication


def _verify_service_token(authorization: str | None) -> bool:
    """Verify the internal service token for service-to-service calls.

    SECURITY: Always requires a valid token, even in development.
    """
    if not authorization:
        logger.warning("Missing authorization header for service token")
        return False

    if not authorization.startswith("Bearer "):
        logger.warning("Invalid authorization format - expected Bearer token")
        return False

    token = authorization[7:]

    expected_token = settings.INTERNAL_SERVICE_TOKEN
    if not expected_token:
        logger.error(
            "INTERNAL_SERVICE_TOKEN not configured - rejecting service request",
            environment=settings.ENVIRONMENT,
        )
        return False

    # Constant-time comparison to prevent timing attacks
    return secrets.compare_digest(token.encode(), expected_token.encode())


class ModelCapabilitiesResponse(BaseModel):
    """Model capabilities for agent service."""

    model_id: str
    provider: str
    supports_vision: bool
    supports_thinking: bool
    thinking_coming_soon: bool
    supports_tool_use: bool
    supports_streaming: bool
    context_window: int
    max_output_tokens: int


@public_router.get("/capabilities", response_model=dict[str, ModelCapabilitiesResponse])
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_all_model_capabilities(
    request: Request,
    response: Response,
    db: DbSession,
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, ModelCapabilitiesResponse]:
    """Get capabilities for all enabled models (internal API for agent service).

    Returns a dictionary mapping model_id to capabilities for quick lookup.
    Requires internal service token authentication.
    """
    if not _verify_service_token(authorization):
        raise HTTPException(status_code=401, detail="Invalid service token")

    query = select(LLMModel).where(LLMModel.is_enabled == True)

    result = await db.execute(query)
    models = result.scalars().all()

    return {
        m.model_id: ModelCapabilitiesResponse(
            model_id=m.model_id,
            provider=m.provider,
            supports_vision=(m.capabilities or {}).get("vision", False),
            supports_thinking=(m.capabilities or {}).get("thinking", False),
            thinking_coming_soon=(m.capabilities or {}).get("thinking_coming_soon", False),
            supports_tool_use=(m.capabilities or {}).get("tool_use", True),
            supports_streaming=(m.capabilities or {}).get("streaming", True),
            context_window=m.context_window,
            max_output_tokens=m.max_output_tokens,
        )
        for m in models
    }


@public_router.get("/capabilities/{model_id}", response_model=ModelCapabilitiesResponse | None)
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_model_capabilities(
    model_id: str,
    request: Request,
    response: Response,
    db: DbSession,
    authorization: Annotated[str | None, Header()] = None,
) -> ModelCapabilitiesResponse | None:
    """Get capabilities for a specific model (internal API for agent service).

    Requires internal service token authentication.
    """
    if not _verify_service_token(authorization):
        raise HTTPException(status_code=401, detail="Invalid service token")

    result = await db.execute(
        select(LLMModel).where(LLMModel.model_id == model_id).where(LLMModel.is_enabled == True)
    )
    m = result.scalar_one_or_none()

    if not m:
        return None

    return ModelCapabilitiesResponse(
        model_id=m.model_id,
        provider=m.provider,
        supports_vision=(m.capabilities or {}).get("vision", False),
        supports_thinking=(m.capabilities or {}).get("thinking", False),
        thinking_coming_soon=(m.capabilities or {}).get("thinking_coming_soon", False),
        supports_tool_use=(m.capabilities or {}).get("tool_use", True),
        supports_streaming=(m.capabilities or {}).get("streaming", True),
        context_window=m.context_window,
        max_output_tokens=m.max_output_tokens,
    )
