"""AI Code Completion Routes - Copilot-style inline code completions."""

import json
import re
import time
from typing import Annotated, Any, Literal
from uuid import uuid4

import structlog
from anthropic import AsyncAnthropic
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from openai import AsyncOpenAI
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.database import get_db
from src.database.models import Organization, OrganizationMember, UsageRecord
from src.middleware.auth import get_current_user
from src.middleware.rate_limit import RATE_LIMIT_AGENT, limiter
from src.services.org_limits import (
    LimitExceededError,
    ModelAccessDeniedError,
    OrgLimitsService,
)

logger = structlog.get_logger()
router = APIRouter()

# Minimum number of lines needed to strip markdown code block (opening, content, closing)
MIN_CODE_BLOCK_LINES = 2

# Estimated cost per 1000 tokens (in cents) - used for limit checking
# These are rough estimates; actual costs vary by model
ESTIMATED_COST_PER_1K_INPUT_TOKENS_CENTS = 1
ESTIMATED_COST_PER_1K_OUTPUT_TOKENS_CENTS = 3


async def _get_org_context(
    db: AsyncSession,
    user_id: str,
) -> tuple[Organization | None, OrganizationMember | None]:
    """Get user's organization context if they are an org member.

    Returns (org, member) tuple, or (None, None) if user is not in an org.
    """
    result = await db.execute(
        select(OrganizationMember, Organization)
        .join(Organization, OrganizationMember.organization_id == Organization.id)
        .where(OrganizationMember.user_id == user_id)
    )
    row = result.one_or_none()
    if row:
        return row[1], row[0]  # (org, member)
    return None, None


async def _check_org_limits_before_completion(
    db: AsyncSession,
    user_id: str,
    model: str | None,
    estimated_tokens: int = 500,
) -> tuple[Organization | None, OrganizationMember | None]:
    """Check org limits before making an LLM completion.

    Args:
        db: Database session
        user_id: User ID
        model: Model identifier to check access
        estimated_tokens: Estimated total tokens for cost calculation

    Returns:
        (org, member) tuple if user is in org, (None, None) otherwise

    Raises:
        HTTPException: If limits are exceeded or model access denied
    """
    org, member = await _get_org_context(db, user_id)

    if not org or not member:
        # Not in an org, personal billing applies
        return None, None

    limits_service = OrgLimitsService(db)

    # Estimate cost for limit check
    estimated_cost_cents = (estimated_tokens * ESTIMATED_COST_PER_1K_OUTPUT_TOKENS_CENTS) // 1000

    try:
        # Check spending limit
        await limits_service.check_spending_limit(member, org, estimated_cost_cents)

        # Check model access if model specified
        if model:
            # Extract model name without provider prefix for access check
            model_name = model.split(":", 1)[-1] if ":" in model else model
            await limits_service.check_model_access(member, org, model_name)

    except LimitExceededError as e:
        logger.warning(
            "Org limit exceeded for completion",
            user_id=user_id,
            org_id=org.id,
            error=str(e),
        )
        raise HTTPException(
            status_code=402,
            detail={
                "error_code": "limit_exceeded",
                "message": e.message,
                "limit_type": e.limit_type,
                "current": e.current,
                "limit": e.limit,
            },
        ) from e
    except ModelAccessDeniedError as e:
        logger.warning(
            "Model access denied",
            user_id=user_id,
            org_id=org.id,
            model=e.model,
        )
        raise HTTPException(
            status_code=403,
            detail={
                "error_code": "model_access_denied",
                "message": str(e),
                "model": e.model,
                "allowed_models": e.allowed_models,
            },
        ) from e

    return org, member


# Providers with implementation in this module (client code exists for these).
# Note: This is a code-level constraint, not configuration. Adding support for
# a new provider requires implementing the client code in this file.
# The database LLMProvider table stores metadata about all providers, but this
# list defines what this service can actually execute.
IMPLEMENTED_COMPLETION_PROVIDERS = ("ollama", "lmstudio", "anthropic", "openrouter")


async def _record_editor_usage(
    db: AsyncSession,
    user_id: str,
    result: "CompletionResult",
    usage_type: str = "editor_completion",
    org: Organization | None = None,
    member: OrganizationMember | None = None,
) -> None:
    """Record token usage from editor AI completions.

    Routes usage to organization billing if user is an org member,
    otherwise records to personal usage.

    Args:
        db: Database session
        user_id: User ID
        result: CompletionResult with usage data
        usage_type: Type of usage (editor_completion, editor_explain, editor_bugs)
        org: Organization if user is org member
        member: OrganizationMember if user is org member
    """
    if result.input_tokens == 0 and result.output_tokens == 0:
        return  # No usage to record

    try:
        # Calculate actual cost for billable usage
        is_billable = result.usage_source == "included"
        input_cost_cents = (
            (result.input_tokens * ESTIMATED_COST_PER_1K_INPUT_TOKENS_CENTS) // 1000
            if is_billable
            else 0
        )
        output_cost_cents = (
            (result.output_tokens * ESTIMATED_COST_PER_1K_OUTPUT_TOKENS_CENTS) // 1000
            if is_billable
            else 0
        )
        total_cost_cents = input_cost_cents + output_cost_cents

        # If user is in an org, record to org billing
        if org and member:
            limits_service = OrgLimitsService(db)

            # Record combined usage (input + output tokens)
            total_tokens = result.input_tokens + result.output_tokens
            await limits_service.record_usage_and_deduct(
                member=member,
                org=org,
                cost_cents=total_cost_cents,
                usage_type=f"{usage_type}_tokens",
                quantity=total_tokens,
                unit="tokens",
                model=result.model,
                metadata={
                    "input_tokens": result.input_tokens,
                    "output_tokens": result.output_tokens,
                    "provider": result.provider,
                    "usage_source": result.usage_source,
                },
            )

            logger.debug(
                "Recorded editor AI usage to organization",
                user_id=user_id,
                org_id=org.id,
                usage_type=usage_type,
                input_tokens=result.input_tokens,
                output_tokens=result.output_tokens,
                cost_cents=total_cost_cents,
                model=result.model,
            )
        else:
            # Personal billing - record to UsageRecord table
            if result.input_tokens > 0:
                input_record = UsageRecord(
                    id=str(uuid4()),
                    idempotency_key=f"editor:{user_id}:{uuid4()}:input",
                    user_id=user_id,
                    usage_type=f"{usage_type}_input",
                    quantity=result.input_tokens,
                    unit="tokens",
                    unit_price_cents=0,
                    base_cost_cents=input_cost_cents,
                    total_cost_cents=input_cost_cents,
                    model=result.model,
                    provider=result.provider,
                    usage_source=result.usage_source,
                    is_overage=False,
                )
                db.add(input_record)

            if result.output_tokens > 0:
                output_record = UsageRecord(
                    id=str(uuid4()),
                    idempotency_key=f"editor:{user_id}:{uuid4()}:output",
                    user_id=user_id,
                    usage_type=f"{usage_type}_output",
                    quantity=result.output_tokens,
                    unit="tokens",
                    unit_price_cents=0,
                    base_cost_cents=output_cost_cents,
                    total_cost_cents=output_cost_cents,
                    model=result.model,
                    provider=result.provider,
                    usage_source=result.usage_source,
                    is_overage=False,
                )
                db.add(output_record)

            await db.commit()

            logger.debug(
                "Recorded editor AI usage to personal billing",
                user_id=user_id,
                usage_type=usage_type,
                input_tokens=result.input_tokens,
                output_tokens=result.output_tokens,
                model=result.model,
                usage_source=result.usage_source,
            )
    except Exception:
        logger.exception("Failed to record editor AI usage")
        await db.rollback()


# Type alias for current user dependency
CurrentUser = Annotated[dict[str, Any], Depends(get_current_user)]


# ============================================================================
# Models
# ============================================================================


class InlineCompletionRequest(BaseModel):
    """Request for inline code completion."""

    prefix: str = Field(..., description="Code before the cursor position")
    suffix: str = Field(default="", description="Code after the cursor position")
    language: str = Field(..., description="Programming language (e.g., 'typescript', 'python')")
    file_path: str = Field(default="", description="Path to the file being edited")
    max_tokens: int = Field(default=128, ge=16, le=512, description="Maximum tokens to generate")
    model: str | None = Field(
        default=None,
        description="Model ID to use (e.g., 'claude-3-5-haiku', 'ollama:qwen2.5-coder')",
    )


class InlineCompletionResponse(BaseModel):
    """Response containing the code completion."""

    completion: str = Field(..., description="The suggested code completion")
    confidence: float = Field(default=1.0, description="Confidence score (0-1)")
    cached: bool = Field(default=False, description="Whether the response was from cache")


class CodeExplanationRequest(BaseModel):
    """Request for code explanation."""

    code: str = Field(..., description="Code to explain")
    language: str = Field(..., description="Programming language")
    detail_level: Literal["brief", "detailed", "comprehensive"] = Field(
        default="detailed",
        description="Level of detail in explanation",
    )
    model: str | None = Field(default=None, description="Model ID to use")


class CodeExplanationResponse(BaseModel):
    """Response containing the code explanation."""

    explanation: str = Field(..., description="Explanation of the code")
    summary: str = Field(..., description="Brief one-line summary")
    concepts: list[str] = Field(default_factory=list, description="Key concepts mentioned")


class BugDetectionRequest(BaseModel):
    """Request for bug detection."""

    code: str = Field(..., description="Code to analyze")
    language: str = Field(..., description="Programming language")
    model: str | None = Field(default=None, description="Model ID to use")


class Bug(BaseModel):
    """Detected bug information."""

    line: int = Field(..., description="Line number of the bug")
    column: int = Field(default=1, description="Column number")
    severity: Literal["error", "warning", "info"] = Field(..., description="Bug severity")
    message: str = Field(..., description="Description of the bug")
    suggestion: str = Field(default="", description="Suggested fix")


class BugDetectionResponse(BaseModel):
    """Response containing detected bugs."""

    bugs: list[Bug] = Field(default_factory=list, description="List of detected bugs")
    analysis_time_ms: float = Field(..., description="Time taken for analysis")


# ============================================================================
# LLM Clients - Multi-provider support
# ============================================================================


class CompletionResult:
    """Result from a completion request including usage data."""

    def __init__(
        self,
        text: str,
        input_tokens: int = 0,
        output_tokens: int = 0,
        model: str = "",
        provider: str = "anthropic",
    ) -> None:
        self.text = text
        self.input_tokens = input_tokens
        self.output_tokens = output_tokens
        self.model = model
        self.provider = provider

    @property
    def usage_source(self) -> str:
        """Determine usage source for billing."""
        if self.provider in ("ollama", "lmstudio"):
            return "local"
        if self.provider == "openrouter":
            return "included"  # Platform-provided via OpenRouter
        # Direct anthropic/openai API usage is "external"
        return "external"


class CompletionProvider:
    """Multi-provider LLM interface for code completions."""

    _anthropic_client: AsyncAnthropic | None = None
    _ollama_client: AsyncOpenAI | None = None
    _openrouter_client: AsyncOpenAI | None = None

    @classmethod
    def get_anthropic_client(cls) -> AsyncAnthropic:
        """Get or create Anthropic client."""
        if cls._anthropic_client is None:
            cls._anthropic_client = AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
        return cls._anthropic_client

    @classmethod
    def get_ollama_client(cls) -> AsyncOpenAI:
        """Get or create Ollama client (OpenAI-compatible API)."""
        if cls._ollama_client is None:
            cls._ollama_client = AsyncOpenAI(
                base_url=f"{settings.OLLAMA_URL}/v1",
                api_key="ollama",  # Ollama doesn't require a real API key
            )
        return cls._ollama_client

    @classmethod
    def get_openrouter_client(cls) -> AsyncOpenAI:
        """Get or create OpenRouter client (OpenAI-compatible API)."""
        if cls._openrouter_client is None:
            cls._openrouter_client = AsyncOpenAI(
                base_url="https://openrouter.ai/api/v1",
                api_key=settings.OPENROUTER_API_KEY or "",
            )
        return cls._openrouter_client

    @classmethod
    async def complete(
        cls,
        prompt: str,
        system_prompt: str,
        max_tokens: int = 128,
        temperature: float = 0.2,
    ) -> str:
        """Generate completion using configured provider.

        Returns text only for backwards compatibility.
        """
        result = await cls.complete_with_usage(prompt, system_prompt, max_tokens, temperature)
        return result.text

    @classmethod
    def _parse_model_id(cls, model_id: str | None) -> tuple[str, str | None]:
        """Parse model ID to determine provider and actual model name.

        Returns (provider, model_name) tuple.
        Model ID formats:
        - "ollama:model-name": use Ollama with specified model
        - "lmstudio:model-name": use LMStudio with specified model
        - "anthropic:model-name": use direct Anthropic API
        - "openrouter:model-name": use OpenRouter API

        Raises:
            ValueError: If model_id is empty or missing provider prefix
        """
        if not model_id:
            msg = "Model ID required (format: 'provider:model-name')"
            raise ValueError(msg)

        # Check for provider prefix
        if ":" in model_id:
            parts = model_id.split(":", 1)
            provider_prefix = parts[0].lower()
            model_name = parts[1] if len(parts) > 1 else None

            if provider_prefix in IMPLEMENTED_COMPLETION_PROVIDERS:
                return provider_prefix, model_name

            valid = ", ".join(IMPLEMENTED_COMPLETION_PROVIDERS)
            msg = f"Unknown provider '{provider_prefix}'. Valid: {valid}"
            raise ValueError(msg)

        # No prefix - require explicit provider
        msg = f"Model '{model_id}' missing provider prefix (format: 'provider:model')"
        raise ValueError(msg)

    @classmethod
    async def complete_with_usage(
        cls,
        prompt: str,
        system_prompt: str,
        max_tokens: int = 128,
        temperature: float = 0.2,
        model_id: str | None = None,
    ) -> CompletionResult:
        """Generate completion using specified provider with usage tracking.

        Args:
            prompt: The user prompt
            system_prompt: System instructions
            max_tokens: Maximum tokens to generate
            temperature: Sampling temperature
            model_id: Model ID in format 'provider:model-name' (required)
                - "ollama:model": use Ollama with model
                - "lmstudio:model": use LMStudio with model
                - "anthropic:model": use direct Anthropic API
                - "openrouter:model": use OpenRouter API

        Raises:
            ValueError: If model_id is not provided or has invalid format
        """
        provider, model_name = cls._parse_model_id(model_id)
        logger.debug(
            "Completion provider selected",
            provider=provider,
            model_name=model_name,
            original_model_id=model_id,
        )

        if provider in ("ollama", "lmstudio"):
            return await cls._complete_ollama_with_usage(
                prompt, system_prompt, max_tokens, temperature, model_name, provider
            )
        if provider == "anthropic":
            return await cls._complete_anthropic_with_usage(
                prompt, system_prompt, max_tokens, temperature, model_name
            )
        if provider == "openrouter":
            return await cls._complete_openrouter_with_usage(
                prompt, system_prompt, max_tokens, temperature, model_name
            )

        # No fallback - raise clear error
        msg = f"Unsupported provider '{provider}'. Use: ollama, lmstudio, anthropic, openrouter"
        raise ValueError(msg)

    @classmethod
    async def _complete_ollama(
        cls,
        prompt: str,
        system_prompt: str,
        max_tokens: int,
        temperature: float,
    ) -> str:
        """Complete using Ollama (local LLM)."""
        result = await cls._complete_ollama_with_usage(
            prompt, system_prompt, max_tokens, temperature
        )
        return result.text

    @classmethod
    async def _complete_ollama_with_usage(
        cls,
        prompt: str,
        system_prompt: str,
        max_tokens: int,
        temperature: float,
        model_name: str | None = None,
        provider_name: str = "ollama",
    ) -> CompletionResult:
        """Complete using Ollama or LMStudio (local LLM) with usage tracking."""
        client = cls.get_ollama_client()
        # Use specified model or fall back to settings
        model = model_name or settings.OLLAMA_MODEL  # e.g., "qwen2.5-coder:14b"

        response = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt},
            ],
            max_tokens=max_tokens,
            temperature=temperature,
        )

        text = ""
        if response.choices and response.choices[0].message.content:
            text = response.choices[0].message.content.strip()

        return CompletionResult(
            text=text,
            input_tokens=response.usage.prompt_tokens if response.usage else 0,
            output_tokens=response.usage.completion_tokens if response.usage else 0,
            model=model,
            provider=provider_name,
        )

    @classmethod
    async def _complete_anthropic(
        cls,
        prompt: str,
        system_prompt: str,
        max_tokens: int,
        temperature: float,
    ) -> str:
        """Complete using direct Anthropic API."""
        result = await cls._complete_anthropic_with_usage(
            prompt, system_prompt, max_tokens, temperature
        )
        return result.text

    @classmethod
    async def _complete_anthropic_with_usage(
        cls,
        prompt: str,
        system_prompt: str,
        max_tokens: int,
        temperature: float,
        model_name: str | None = None,
    ) -> CompletionResult:
        """Complete using direct Anthropic API with usage tracking."""
        client = cls.get_anthropic_client()
        # Use specified model or default to Haiku
        model_id = model_name or "claude-3-5-haiku-20241022"

        response = await client.messages.create(
            model=model_id,
            max_tokens=max_tokens,
            temperature=temperature,
            system=system_prompt,
            messages=[{"role": "user", "content": prompt}],
        )

        text = ""
        for block in response.content:
            if block.type == "text":
                text = block.text.strip()
                break

        return CompletionResult(
            text=text,
            input_tokens=response.usage.input_tokens if response.usage else 0,
            output_tokens=response.usage.output_tokens if response.usage else 0,
            model=model_id,
            provider="anthropic",
        )

    @classmethod
    async def _complete_openrouter_with_usage(
        cls,
        prompt: str,
        system_prompt: str,
        max_tokens: int,
        temperature: float,
        model_name: str | None = None,
    ) -> CompletionResult:
        """Complete using OpenRouter (OpenAI-compatible API) with usage tracking."""
        client = cls.get_openrouter_client()
        # Use specified model or default to a fast, capable model
        model = model_name or "anthropic/claude-3-5-haiku"

        response = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt},
            ],
            max_tokens=max_tokens,
            temperature=temperature,
        )

        text = ""
        if response.choices and response.choices[0].message.content:
            text = response.choices[0].message.content.strip()

        return CompletionResult(
            text=text,
            input_tokens=response.usage.prompt_tokens if response.usage else 0,
            output_tokens=response.usage.completion_tokens if response.usage else 0,
            model=model,
            provider="openrouter",
        )


# ============================================================================
# Completion Prompts
# ============================================================================

COMPLETION_SYSTEM_PROMPT = """You are an expert code completion assistant. \
Your task is to predict the most likely code continuation based on the context.

Rules:
1. Return ONLY the code completion, no explanations or markdown
2. Complete the current statement or expression naturally
3. Match the existing code style (indentation, naming conventions)
4. Keep completions concise - typically 1-3 lines
5. Don't repeat code that's already in the prefix
6. If the context suggests a specific pattern, follow it
7. Be contextually aware of variable names, types, and function signatures"""

EXPLANATION_SYSTEM_PROMPT = """You are a senior software engineer explaining code to a colleague. \
Provide clear, accurate explanations that help developers understand code quickly.

Your explanation should:
1. Start with a one-line summary
2. Explain the purpose and logic
3. Highlight any important patterns or techniques used
4. Note potential issues or areas for improvement if relevant
5. Be concise but thorough"""

BUG_DETECTION_SYSTEM_PROMPT = """You are an expert code reviewer focused on finding bugs. \
Analyze the provided code and identify any problems.

For each issue found, provide:
1. The line number where the issue occurs
2. Severity (error, warning, or info)
3. A clear description of the problem
4. A suggested fix

Focus on:
- Logic errors
- Type mismatches
- Null/undefined handling issues
- Resource leaks
- Security vulnerabilities
- Common language-specific pitfalls

Return findings as JSON array with keys: line, column, severity, message, suggestion

If no issues are found, return an empty array: []"""


# ============================================================================
# Routes
# ============================================================================


@router.post("/inline", response_model=InlineCompletionResponse)
@limiter.limit(RATE_LIMIT_AGENT)
async def get_inline_completion(
    body: InlineCompletionRequest,
    request: Request,  # noqa: ARG001
    response: Response,  # noqa: ARG001
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> InlineCompletionResponse:
    """
    Get an inline code completion suggestion.

    This endpoint provides Copilot-style code completions based on the
    code context (prefix and suffix around the cursor).
    """
    user_id = current_user.get("id")
    logger.info(
        "Inline completion request",
        language=body.language,
        prefix_length=len(body.prefix),
        user_id=user_id,
    )

    # Check org limits before making LLM call
    org, member = None, None
    if user_id:
        org, member = await _check_org_limits_before_completion(
            db, user_id, body.model, estimated_tokens=body.max_tokens
        )

    # Build the prompt
    prompt = f"""Complete the following {body.language} code. Return ONLY the completion.

### Code before cursor:
```{body.language}
{body.prefix}
```

### Code after cursor:
```{body.language}
{body.suffix}
```

### Completion:"""

    try:
        # Use multi-provider completion with usage tracking
        result = await CompletionProvider.complete_with_usage(
            prompt=prompt,
            system_prompt=COMPLETION_SYSTEM_PROMPT,
            max_tokens=body.max_tokens,
            temperature=0.2,  # Low temperature for predictable completions
            model_id=body.model,
        )

        # Track usage - routes to org or personal based on membership
        if user_id:
            await _record_editor_usage(
                db, user_id, result, "editor_completion", org=org, member=member
            )

        # Clean up the completion
        completion = result.text
        # Remove markdown code blocks if the model added them
        if completion.startswith("```"):
            lines = completion.split("\n")
            if len(lines) > MIN_CODE_BLOCK_LINES:
                completion = "\n".join(lines[1:-1])

        logger.info(
            "Completion generated",
            completion_length=len(completion),
            provider=result.provider,
            model=result.model,
            usage_source=result.usage_source,
            org_id=org.id if org else None,
        )

        return InlineCompletionResponse(
            completion=completion,
            confidence=1.0,
            cached=False,
        )

    except HTTPException:
        raise  # Re-raise limit/access errors as-is
    except Exception as e:
        logger.exception("Completion error", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to generate completion") from e


@router.post("/explain", response_model=CodeExplanationResponse)
@limiter.limit(RATE_LIMIT_AGENT)
async def explain_code(
    body: CodeExplanationRequest,
    request: Request,  # noqa: ARG001
    response: Response,  # noqa: ARG001
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> CodeExplanationResponse:
    """
    Get an AI-powered explanation of code.

    Analyzes the provided code and returns a detailed explanation
    of what it does and how it works.
    """
    user_id = current_user.get("id")
    logger.info(
        "Code explanation request",
        language=body.language,
        code_length=len(body.code),
        detail_level=body.detail_level,
        user_id=user_id,
    )

    # Check org limits before making LLM call
    org, member = None, None
    if user_id:
        org, member = await _check_org_limits_before_completion(
            db, user_id, body.model, estimated_tokens=1024
        )

    detail_instruction = {
        "brief": "Keep the explanation short, 2-3 sentences maximum.",
        "detailed": "Provide a thorough explanation with examples where helpful.",
        "comprehensive": "Provide an in-depth analysis covering all aspects of the code.",
    }

    prompt = f"""Explain the following {body.language} code.
{detail_instruction[body.detail_level]}

```{body.language}
{body.code}
```

Provide your response in this format:
SUMMARY: [One-line summary]
EXPLANATION: [Detailed explanation]
CONCEPTS: [Comma-separated list of key concepts]"""

    try:
        # Use multi-provider completion with usage tracking
        result = await CompletionProvider.complete_with_usage(
            prompt=prompt,
            system_prompt=EXPLANATION_SYSTEM_PROMPT,
            max_tokens=1024,
            temperature=0.3,
            model_id=body.model,
        )

        # Track usage - routes to org or personal based on membership
        if user_id:
            await _record_editor_usage(
                db, user_id, result, "editor_explain", org=org, member=member
            )

        # Parse the response
        text = result.text

        # Extract sections
        summary = ""
        explanation = ""
        concepts: list[str] = []

        lines = text.split("\n")
        current_section = ""

        for line in lines:
            if line.startswith("SUMMARY:"):
                summary = line[8:].strip()
                current_section = "summary"
            elif line.startswith("EXPLANATION:"):
                explanation = line[12:].strip()
                current_section = "explanation"
            elif line.startswith("CONCEPTS:"):
                concepts_str = line[9:].strip()
                concepts = [c.strip() for c in concepts_str.split(",") if c.strip()]
                current_section = "concepts"
            elif current_section == "explanation":
                explanation += "\n" + line

        return CodeExplanationResponse(
            explanation=explanation.strip(),
            summary=summary or explanation[:100],
            concepts=concepts,
        )

    except HTTPException:
        raise  # Re-raise limit/access errors as-is
    except Exception as e:
        logger.exception("Explanation error", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to explain code") from e


@router.post("/detect-bugs", response_model=BugDetectionResponse)
@limiter.limit(RATE_LIMIT_AGENT)
async def detect_bugs(
    body: BugDetectionRequest,
    request: Request,  # noqa: ARG001
    response: Response,  # noqa: ARG001
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> BugDetectionResponse:
    """
    Analyze code for potential bugs and issues.

    Uses AI to identify bugs, security issues, and code smells
    in the provided code snippet.
    """
    start_time = time.time()
    user_id = current_user.get("id")

    logger.info(
        "Bug detection request",
        language=body.language,
        code_length=len(body.code),
        user_id=user_id,
    )

    # Check org limits before making LLM call
    org, member = None, None
    if user_id:
        org, member = await _check_org_limits_before_completion(
            db, user_id, body.model, estimated_tokens=1024
        )

    # Add line numbers to help the model reference specific lines
    numbered_code = "\n".join(f"{i + 1}: {line}" for i, line in enumerate(body.code.split("\n")))

    prompt = f"""Analyze this {body.language} code for bugs and issues.

```{body.language}
{numbered_code}
```

Return a JSON array of any issues found. Each issue should have:
- line: number (the line number where the issue is)
- column: number (default 1)
- severity: "error" | "warning" | "info"
- message: string (description of the issue)
- suggestion: string (how to fix it)

Return ONLY valid JSON, no other text. If no issues found, return: []"""

    try:
        # Use the multi-provider completion interface so we can work with
        # Vertex, Anthropic, Ollama, etc. without requiring a direct
        # Anthropic API key in all environments.
        result = await CompletionProvider.complete_with_usage(
            prompt=prompt,
            system_prompt=BUG_DETECTION_SYSTEM_PROMPT,
            max_tokens=1024,
            temperature=0.2,
            model_id=body.model,
        )

        # Track usage - routes to org or personal based on membership
        if user_id:
            await _record_editor_usage(db, user_id, result, "editor_bugs", org=org, member=member)

        text = result.text

        # Extract JSON from the response
        try:
            # Try to find JSON array in the response
            if text.startswith("["):
                bugs_data = json.loads(text)
            else:
                # Try to extract JSON from markdown code block
                json_match = re.search(r"```(?:json)?\s*(\[[\s\S]*?\])\s*```", text)
                bugs_data = json.loads(json_match.group(1)) if json_match else []
        except json.JSONDecodeError:
            logger.warning("Failed to parse bug detection response as JSON")
            bugs_data = []

        # Convert to Bug objects
        bugs = []
        for bug_data in bugs_data:
            try:
                bugs.append(
                    Bug(
                        line=bug_data.get("line", 1),
                        column=bug_data.get("column", 1),
                        severity=bug_data.get("severity", "warning"),
                        message=bug_data.get("message", "Unknown issue"),
                        suggestion=bug_data.get("suggestion", ""),
                    ),
                )
            except Exception:
                logger.debug("Skipping invalid bug data", bug_data=bug_data)
                continue

        analysis_time_ms = (time.time() - start_time) * 1000

        return BugDetectionResponse(
            bugs=bugs,
            analysis_time_ms=analysis_time_ms,
        )

    except HTTPException:
        raise  # Re-raise limit/access errors as-is
    except Exception as e:
        logger.exception("Bug detection error", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to analyze code") from e
