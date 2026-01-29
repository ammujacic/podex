"""User configuration routes."""

import re
from datetime import UTC, datetime
from typing import Annotated, Any

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.cache import cache_delete, cache_get, cache_set, user_config_key
from src.config import settings
from src.database.connection import get_db
from src.database.models import User, UserConfig
from src.middleware.rate_limit import RATE_LIMIT_STANDARD, limiter

logger = structlog.get_logger()

router = APIRouter()

# Type alias for database session dependency
DbSession = Annotated[AsyncSession, Depends(get_db)]


# Mapping of request field names to config attribute names
CONFIG_FIELD_MAP = [
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


# Maximum tour ID length
MAX_TOUR_ID_LENGTH = 50

# SECURITY: LLM API key patterns for validation by provider
# These patterns help ensure API keys are in the expected format
LLM_API_KEY_PATTERNS = {
    "openai": re.compile(r"^sk-[a-zA-Z0-9]{20,}$"),  # sk-... format
    "anthropic": re.compile(r"^sk-ant-[a-zA-Z0-9-]{20,}$"),  # sk-ant-... format
    "google": re.compile(r"^[a-zA-Z0-9_-]{30,}$"),  # Google AI Studio keys
    "ollama": re.compile(r"^.{0,200}$"),  # Ollama typically uses no key or custom
    "lmstudio": re.compile(r"^.{0,200}$"),  # LM Studio typically uses no key or custom
}


class UserConfigResponse(BaseModel):
    """User config response."""

    id: str
    user_id: str
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

        config = UserConfig(user_id=user_id)
        db.add(config)
        await db.commit()
        await db.refresh(config)

    config_response = UserConfigResponse(
        id=config.id,
        user_id=config.user_id,
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

        config = UserConfig(user_id=user_id)
        db.add(config)

    # Update fields using helper function
    _apply_config_updates(config, request_data)

    await db.commit()
    await db.refresh(config)

    # Invalidate cache
    await cache_delete(user_config_key(user_id))

    config_response = UserConfigResponse(
        id=config.id,
        user_id=config.user_id,
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


# ============================================================================
# Local Model Discovery
# ============================================================================


class DiscoverLocalModelsRequest(BaseModel):
    """Request to discover models from a local provider."""

    provider: str = Field(..., description="Provider: ollama or lmstudio")
    base_url: str = Field(..., description="Base URL of the local provider server")


class DiscoveredModel(BaseModel):
    """A discovered model from a local provider."""

    id: str
    name: str
    size: int | None = None
    modified_at: str | None = None


class DiscoverLocalModelsResponse(BaseModel):
    """Response with discovered models."""

    models: list[DiscoveredModel]
    success: bool
    error: str | None = None


@router.post("/discover-local-models", response_model=DiscoverLocalModelsResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def discover_local_models(
    request_data: DiscoverLocalModelsRequest,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> DiscoverLocalModelsResponse:
    """Discover available models from a local LLM provider (Ollama or LM Studio)."""
    import httpx

    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")

    provider = request_data.provider.lower()
    base_url = request_data.base_url.rstrip("/")

    if provider not in {"ollama", "lmstudio"}:
        return DiscoverLocalModelsResponse(
            models=[],
            success=False,
            error=f"Unsupported provider: {provider}. Supported: ollama, lmstudio",
        )

    try:
        # Ollama uses /api/tags endpoint, LM Studio uses OpenAI-compatible /v1/models
        endpoint = f"{base_url}/api/tags" if provider == "ollama" else f"{base_url}/v1/models"

        async with httpx.AsyncClient(timeout=10.0) as client:
            http_response = await client.get(endpoint)
            http_response.raise_for_status()
            data = http_response.json()

        # Parse response based on provider
        models: list[DiscoveredModel] = []
        if provider == "ollama":
            # Ollama returns: {"models": [{"name": "...", "size": ..., "modified_at": "..."}, ...]}
            for model in data.get("models", []):
                models.append(
                    DiscoveredModel(
                        id=model.get("name", ""),
                        name=model.get("name", ""),
                        size=model.get("size"),
                        modified_at=model.get("modified_at"),
                    )
                )
        else:  # lmstudio
            # LM Studio uses OpenAI format: {"data": [{"id": "...", ...}, ...]}
            for model in data.get("data", []):
                models.append(
                    DiscoveredModel(
                        id=model.get("id", ""),
                        name=model.get("id", ""),  # LM Studio uses id as name
                    )
                )

        logger.info(
            "Discovered local models",
            user_id=user_id,
            provider=provider,
            base_url=base_url,
            model_count=len(models),
        )

        # Save discovered models to user config for later retrieval
        result = await db.execute(select(UserConfig).where(UserConfig.user_id == user_id))
        config = result.scalar_one_or_none()

        if not config:
            config = UserConfig(
                user_id=user_id,
                agent_preferences={"local_llm_config": {}},
            )
            db.add(config)
        elif not config.agent_preferences:
            config.agent_preferences = {"local_llm_config": {}}

        # Update local LLM config with discovered models (assign new dict so JSONB is persisted)
        prefs = (config.agent_preferences or {}).copy()
        local_config = dict(prefs.get("local_llm_config") or {})
        local_config[provider] = {
            "base_url": base_url,
            "models": [
                {"id": m.id, "name": m.name, "size": m.size, "modified_at": m.modified_at}
                for m in models
            ],
            "discovered_at": datetime.now(UTC).isoformat(),
        }
        prefs["local_llm_config"] = local_config
        config.agent_preferences = prefs
        await db.commit()
        await db.refresh(config)
        await cache_delete(user_config_key(user_id))

        return DiscoverLocalModelsResponse(models=models, success=True)

    except httpx.HTTPStatusError as e:
        error_msg = f"HTTP {e.response.status_code}: {e.response.text[:200]}"
        logger.warning(
            "Failed to discover local models - HTTP error",
            user_id=user_id,
            provider=provider,
            base_url=base_url,
            error=error_msg,
        )
        return DiscoverLocalModelsResponse(
            models=[],
            success=False,
            error=error_msg,
        )
    except httpx.RequestError as e:
        error_msg = f"Connection error: {e!s}"
        logger.warning(
            "Failed to discover local models - connection error",
            user_id=user_id,
            provider=provider,
            base_url=base_url,
            error=error_msg,
        )
        return DiscoverLocalModelsResponse(
            models=[],
            success=False,
            error=error_msg,
        )
    except Exception as e:
        error_msg = f"Error: {e!s}"
        logger.exception(
            "Failed to discover local models",
            user_id=user_id,
            provider=provider,
            base_url=base_url,
            error=error_msg,
        )
        return DiscoverLocalModelsResponse(
            models=[],
            success=False,
            error=error_msg,
        )


@router.get("/local-llm-config", response_model=dict[str, Any])
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_local_llm_config(
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> dict[str, Any]:
    """Get saved local LLM configuration (base URLs and discovered models)."""
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")

    result = await db.execute(select(UserConfig).where(UserConfig.user_id == user_id))
    config = result.scalar_one_or_none()

    if not config or not config.agent_preferences:
        return {}

    local_config = config.agent_preferences.get("local_llm_config", {})
    if not isinstance(local_config, dict):
        return {}
    return local_config


class SaveLocalLLMUrlRequest(BaseModel):
    """Request to save a local LLM provider URL."""

    provider: str = Field(..., description="Provider: ollama or lmstudio")
    base_url: str = Field(..., description="Base URL of the local provider server")


@router.post("/local-llm-config/url", response_model=dict[str, Any])
@limiter.limit(RATE_LIMIT_STANDARD)
async def save_local_llm_url(
    request_data: SaveLocalLLMUrlRequest,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> dict[str, Any]:
    """Save a local LLM provider URL (without discovering models)."""
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")

    provider = request_data.provider.lower()
    base_url = request_data.base_url.rstrip("/")

    if provider not in {"ollama", "lmstudio"}:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported provider: {provider}. Supported: ollama, lmstudio",
        )

    result = await db.execute(select(UserConfig).where(UserConfig.user_id == user_id))
    config = result.scalar_one_or_none()

    if not config:
        config = UserConfig(
            user_id=user_id,
            agent_preferences={"local_llm_config": {}},
        )
        db.add(config)
    elif not config.agent_preferences:
        config.agent_preferences = {"local_llm_config": {}}

    # Update local LLM config with URL; preserve existing models, assign new dict so JSONB persists
    prefs = (config.agent_preferences or {}).copy()
    local_config = dict(prefs.get("local_llm_config") or {})
    existing = local_config.get(provider)
    if not isinstance(existing, dict):
        local_config[provider] = {"base_url": base_url, "models": []}
    else:
        local_config[provider] = {**existing, "base_url": base_url}
    prefs["local_llm_config"] = local_config
    config.agent_preferences = prefs
    await db.commit()
    await db.refresh(config)
    await cache_delete(user_config_key(user_id))

    logger.info(
        "Saved local LLM URL",
        user_id=user_id,
        provider=provider,
        base_url=base_url,
    )

    return local_config
