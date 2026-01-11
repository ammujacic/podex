"""Pod template routes."""

from typing import Annotated, Any

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.cache import (
    cache_delete,
    cache_get,
    cache_set,
    invalidate_pattern,
    template_key,
    templates_list_key,
)
from src.config import settings
from src.database.connection import get_db
from src.database.models import PodTemplate
from src.middleware.rate_limit import RATE_LIMIT_STANDARD, limiter

logger = structlog.get_logger()

router = APIRouter()

# Type alias for database session dependency
DbSession = Annotated[AsyncSession, Depends(get_db)]

# Icon identifier to CDN URL mapping
ICON_URL_MAP: dict[str, str] = {
    "nodejs": "https://cdn.simpleicons.org/nodedotjs/339933",
    "python": "https://cdn.simpleicons.org/python/3776AB",
    "go": "https://cdn.simpleicons.org/go/00ADD8",
    "rust": "https://cdn.simpleicons.org/rust/DEA584",
    "typescript": "https://cdn.simpleicons.org/typescript/3178C6",
    "javascript": "https://cdn.simpleicons.org/javascript/F7DF1E",
    "react": "https://cdn.simpleicons.org/react/61DAFB",
    "docker": "https://cdn.simpleicons.org/docker/2496ED",
    "layers": "https://cdn.simpleicons.org/stackblitz/1389FD",
}


def get_icon_url(icon: str | None) -> str | None:
    """Convert icon identifier to CDN URL."""
    if not icon:
        return None
    return ICON_URL_MAP.get(icon)


# Predefined official templates
OFFICIAL_TEMPLATES = [
    {
        "name": "Node.js",
        "slug": "nodejs",
        "description": "Node.js development environment with npm, yarn, and pnpm",
        "icon": "nodejs",
        "base_image": "podex/workspace:latest",
        "pre_install_commands": [
            # Install fnm (Fast Node Manager)
            "curl -fsSL https://fnm.vercel.app/install | bash",
            # Install Node.js 20 (call fnm directly by full path)
            "$HOME/.local/share/fnm/fnm install 20 && $HOME/.local/share/fnm/fnm default 20",
            # Install global npm packages (use fnm exec to run npm in the right context)
            "$HOME/.local/share/fnm/fnm exec npm install -g yarn pnpm",
        ],
        "environment_variables": {
            "NODE_ENV": "development",
            "PATH": "$HOME/.local/share/fnm/aliases/default/bin:$HOME/.local/share/fnm:$PATH",
        },
        "default_ports": [
            {"port": 3000, "label": "Dev Server", "protocol": "http"},
            {"port": 5173, "label": "Vite", "protocol": "http"},
        ],
        "language_versions": {"node": "20"},
        "is_official": True,
        "is_public": True,
    },
    {
        "name": "Python",
        "slug": "python",
        "description": "Python development with poetry, pip, and common tools",
        "icon": "python",
        "base_image": "podex/workspace:latest",
        "pre_install_commands": [],  # Workspace image has Python 3.12, poetry, etc. pre-installed
        "environment_variables": {
            "PYTHONDONTWRITEBYTECODE": "1",
        },
        "default_ports": [
            {"port": 8000, "label": "FastAPI", "protocol": "http"},
            {"port": 5000, "label": "Flask", "protocol": "http"},
        ],
        "language_versions": {"python": "3.12"},
        "is_official": True,
        "is_public": True,
    },
    {
        "name": "Full Stack",
        "slug": "fullstack",
        "description": "Node.js + Python for full-stack development",
        "icon": "layers",
        "base_image": "podex/workspace:latest",
        # Workspace image has Node.js 20, Python 3.12, poetry, etc. pre-installed
        "pre_install_commands": [],
        "environment_variables": {
            "NODE_ENV": "development",
            "PYTHONDONTWRITEBYTECODE": "1",
        },
        "default_ports": [
            {"port": 3000, "label": "Frontend", "protocol": "http"},
            {"port": 8000, "label": "Backend API", "protocol": "http"},
        ],
        "language_versions": {"node": "20", "python": "3.12"},
        "is_official": True,
        "is_public": True,
    },
    {
        "name": "Go",
        "slug": "golang",
        "description": "Go development environment",
        "icon": "go",
        "base_image": "podex/workspace:latest",
        "pre_install_commands": [
            "wget https://go.dev/dl/go1.22.0.linux-amd64.tar.gz",
            "sudo tar -C /usr/local -xzf go1.22.0.linux-amd64.tar.gz",
            "rm go1.22.0.linux-amd64.tar.gz",
        ],
        "environment_variables": {
            "GOPATH": "/home/dev/go",
            "PATH": "/usr/local/go/bin:/home/dev/go/bin:$PATH",
        },
        "default_ports": [{"port": 8080, "label": "Go Server", "protocol": "http"}],
        "language_versions": {"go": "1.22"},
        "is_official": True,
        "is_public": True,
    },
    {
        "name": "Rust",
        "slug": "rust",
        "description": "Rust development with cargo",
        "icon": "rust",
        "base_image": "podex/workspace:latest",
        "pre_install_commands": [
            "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y",
        ],
        "environment_variables": {"PATH": "/home/dev/.cargo/bin:$PATH"},
        "default_ports": [{"port": 8080, "label": "Server", "protocol": "http"}],
        "language_versions": {"rust": "stable"},
        "is_official": True,
        "is_public": True,
    },
    {
        "name": "Blank",
        "slug": "blank",
        "description": "Minimal environment - start from scratch",
        "icon": "box",
        "base_image": "podex/workspace:latest",
        "pre_install_commands": [],
        "environment_variables": {},
        "default_ports": [{"port": 3000, "label": "Dev Server", "protocol": "http"}],
        "language_versions": {},
        "is_official": True,
        "is_public": True,
    },
]


class PodTemplateResponse(BaseModel):
    """Pod template response."""

    id: str
    name: str
    slug: str
    description: str | None
    icon: str | None
    icon_url: str | None = None  # Computed CDN URL for the icon
    base_image: str
    pre_install_commands: list[str] | None
    environment_variables: dict[str, str] | None
    default_ports: list[dict[str, Any]] | None
    language_versions: dict[str, str] | None
    is_public: bool
    is_official: bool
    owner_id: str | None
    usage_count: int


class CreateTemplateRequest(BaseModel):
    """Request to create a custom template."""

    name: str
    slug: str
    description: str | None = None
    icon: str | None = None
    base_image: str = "podex/workspace:latest"
    pre_install_commands: list[str] | None = None
    environment_variables: dict[str, str] | None = None
    default_ports: list[dict[str, Any]] | None = None
    language_versions: dict[str, str] | None = None
    is_public: bool = False


class UpdateTemplateRequest(BaseModel):
    """Request to update a template."""

    name: str | None = None
    description: str | None = None
    icon: str | None = None
    pre_install_commands: list[str] | None = None
    environment_variables: dict[str, str] | None = None
    default_ports: list[dict[str, Any]] | None = None
    language_versions: dict[str, str] | None = None
    is_public: bool | None = None


@router.get("", response_model=list[PodTemplateResponse])
@limiter.limit(RATE_LIMIT_STANDARD)
async def list_templates(
    request: Request,
    response: Response,
    db: DbSession,
    *,
    include_private: bool = Query(default=False),
) -> list[PodTemplateResponse]:
    """List available pod templates."""
    user_id = getattr(request.state, "user_id", None)

    # Try cache first
    cache_key = templates_list_key(include_private=include_private, user_id=user_id)
    cached = await cache_get(cache_key)
    if cached is not None:
        logger.debug("Templates cache hit", include_private=include_private)
        return [PodTemplateResponse(**t) for t in cached]

    # Build query - public templates + user's own templates
    if include_private and user_id:
        query = select(PodTemplate).where(
            or_(
                PodTemplate.is_public == True,  # noqa: E712
                PodTemplate.owner_id == user_id,
            ),
        )
    else:
        query = select(PodTemplate).where(PodTemplate.is_public == True)  # noqa: E712

    query = query.order_by(PodTemplate.is_official.desc(), PodTemplate.usage_count.desc())

    result = await db.execute(query)
    templates = result.scalars().all()

    template_list = [
        PodTemplateResponse(
            id=t.id,
            name=t.name,
            slug=t.slug,
            description=t.description,
            icon=t.icon,
            icon_url=get_icon_url(t.icon),
            base_image=t.base_image,
            pre_install_commands=t.pre_install_commands,
            environment_variables=t.environment_variables,
            default_ports=t.default_ports,
            language_versions=t.language_versions,
            is_public=t.is_public,
            is_official=t.is_official,
            owner_id=t.owner_id,
            usage_count=t.usage_count,
        )
        for t in templates
    ]

    # Cache the result
    await cache_set(cache_key, template_list, ttl=settings.CACHE_TTL_TEMPLATES)

    return template_list


@router.get("/{template_id}", response_model=PodTemplateResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_template(
    template_id: str,
    request: Request,
    response: Response,
    db: DbSession,
) -> PodTemplateResponse:
    """Get a specific pod template."""
    user_id = getattr(request.state, "user_id", None)

    # Try cache first
    cache_key = template_key(template_id)
    cached = await cache_get(cache_key)
    if cached is not None:
        # Check access for cached template
        if not cached.get("is_public") and cached.get("owner_id") != user_id:
            raise HTTPException(status_code=403, detail="Access denied")
        logger.debug("Template cache hit", template_id=template_id)
        return PodTemplateResponse(**cached)

    # Try by ID first, then by slug
    result = await db.execute(
        select(PodTemplate).where(
            or_(PodTemplate.id == template_id, PodTemplate.slug == template_id),
        ),
    )
    template = result.scalar_one_or_none()

    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    # Check access
    if not template.is_public and template.owner_id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    template_response = PodTemplateResponse(
        id=template.id,
        name=template.name,
        slug=template.slug,
        description=template.description,
        icon=template.icon,
        icon_url=get_icon_url(template.icon),
        base_image=template.base_image,
        pre_install_commands=template.pre_install_commands,
        environment_variables=template.environment_variables,
        default_ports=template.default_ports,
        language_versions=template.language_versions,
        is_public=template.is_public,
        is_official=template.is_official,
        owner_id=template.owner_id,
        usage_count=template.usage_count,
    )

    # Cache the result
    await cache_set(cache_key, template_response, ttl=settings.CACHE_TTL_TEMPLATES)

    return template_response


@router.post("", response_model=PodTemplateResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def create_template(
    request_data: CreateTemplateRequest,
    request: Request,
    response: Response,
    db: DbSession,
) -> PodTemplateResponse:
    """Create a custom pod template."""
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")

    # Check slug uniqueness
    existing = await db.execute(select(PodTemplate).where(PodTemplate.slug == request_data.slug))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Template slug already exists")

    template = PodTemplate(
        name=request_data.name,
        slug=request_data.slug,
        description=request_data.description,
        icon=request_data.icon,
        base_image=request_data.base_image,
        pre_install_commands=request_data.pre_install_commands,
        environment_variables=request_data.environment_variables,
        default_ports=request_data.default_ports,
        language_versions=request_data.language_versions,
        is_public=request_data.is_public,
        is_official=False,
        owner_id=user_id,
    )

    db.add(template)
    await db.commit()
    await db.refresh(template)

    # Invalidate templates list cache
    await invalidate_pattern("templates:list:*")

    return PodTemplateResponse(
        id=template.id,
        name=template.name,
        slug=template.slug,
        description=template.description,
        icon=template.icon,
        icon_url=get_icon_url(template.icon),
        base_image=template.base_image,
        pre_install_commands=template.pre_install_commands,
        environment_variables=template.environment_variables,
        default_ports=template.default_ports,
        language_versions=template.language_versions,
        is_public=template.is_public,
        is_official=template.is_official,
        owner_id=template.owner_id,
        usage_count=template.usage_count,
    )


@router.patch("/{template_id}", response_model=PodTemplateResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def update_template(
    template_id: str,
    request_data: UpdateTemplateRequest,
    request: Request,
    response: Response,
    db: DbSession,
) -> PodTemplateResponse:
    """Update a custom pod template."""
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")

    result = await db.execute(select(PodTemplate).where(PodTemplate.id == template_id))
    template = result.scalar_one_or_none()

    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    if template.owner_id != user_id:
        raise HTTPException(status_code=403, detail="Cannot modify this template")

    if template.is_official:
        raise HTTPException(status_code=403, detail="Cannot modify official templates")

    # Update fields
    if request_data.name is not None:
        template.name = request_data.name
    if request_data.description is not None:
        template.description = request_data.description
    if request_data.icon is not None:
        template.icon = request_data.icon
    if request_data.pre_install_commands is not None:
        template.pre_install_commands = request_data.pre_install_commands
    if request_data.environment_variables is not None:
        template.environment_variables = request_data.environment_variables
    if request_data.default_ports is not None:
        template.default_ports = request_data.default_ports
    if request_data.language_versions is not None:
        template.language_versions = request_data.language_versions
    if request_data.is_public is not None:
        template.is_public = request_data.is_public

    await db.commit()
    await db.refresh(template)

    # Invalidate caches
    await cache_delete(template_key(template_id))
    await cache_delete(template_key(template.slug))
    await invalidate_pattern("templates:list:*")

    return PodTemplateResponse(
        id=template.id,
        name=template.name,
        slug=template.slug,
        description=template.description,
        icon=template.icon,
        icon_url=get_icon_url(template.icon),
        base_image=template.base_image,
        pre_install_commands=template.pre_install_commands,
        environment_variables=template.environment_variables,
        default_ports=template.default_ports,
        language_versions=template.language_versions,
        is_public=template.is_public,
        is_official=template.is_official,
        owner_id=template.owner_id,
        usage_count=template.usage_count,
    )


@router.delete("/{template_id}")
@limiter.limit(RATE_LIMIT_STANDARD)
async def delete_template(
    template_id: str,
    request: Request,
    response: Response,
    db: DbSession,
) -> dict[str, Any]:
    """Delete a custom pod template."""
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")

    result = await db.execute(select(PodTemplate).where(PodTemplate.id == template_id))
    template = result.scalar_one_or_none()

    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    if template.owner_id != user_id:
        raise HTTPException(status_code=403, detail="Cannot delete this template")

    if template.is_official:
        raise HTTPException(status_code=403, detail="Cannot delete official templates")

    slug = template.slug
    await db.delete(template)
    await db.commit()

    # Invalidate caches
    await cache_delete(template_key(template_id))
    await cache_delete(template_key(slug))
    await invalidate_pattern("templates:list:*")

    return {"deleted": template_id}


@router.post("/seed-official")
@limiter.limit(RATE_LIMIT_STANDARD)
async def seed_official_templates(
    request: Request,
    response: Response,
    db: DbSession,
    *,
    update_existing: bool = False,
) -> dict[str, Any]:
    """Seed official templates (admin only, called during setup).

    Args:
        update_existing: If True, update existing templates with new configuration.
    """
    created = 0
    updated = 0
    for template_data in OFFICIAL_TEMPLATES:
        # Check if exists
        result = await db.execute(
            select(PodTemplate).where(PodTemplate.slug == template_data["slug"]),
        )
        existing = result.scalar_one_or_none()

        if existing:
            if update_existing:
                # Update existing template
                for key, value in template_data.items():
                    if key != "slug":  # Don't update slug
                        setattr(existing, key, value)
                updated += 1
            continue

        template = PodTemplate(**template_data)
        db.add(template)
        created += 1

    await db.commit()

    # Invalidate templates cache if any were created or updated
    if created > 0 or updated > 0:
        await invalidate_pattern("templates:*")

    return {"created": created, "updated": updated, "total": len(OFFICIAL_TEMPLATES)}
