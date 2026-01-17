"""AI Code Completion Routes - Copilot-style inline code completions."""

import json
import re
import time
from typing import Annotated, Any, Literal

import structlog
from anthropic import AsyncAnthropic, AsyncAnthropicVertex
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from openai import AsyncOpenAI
from pydantic import BaseModel, Field

from src.config import settings
from src.middleware.auth import get_current_user
from src.middleware.rate_limit import RATE_LIMIT_AGENT, limiter

logger = structlog.get_logger()
router = APIRouter()

# Minimum number of lines needed to strip markdown code block (opening, content, closing)
MIN_CODE_BLOCK_LINES = 2

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


class CodeExplanationResponse(BaseModel):
    """Response containing the code explanation."""

    explanation: str = Field(..., description="Explanation of the code")
    summary: str = Field(..., description="Brief one-line summary")
    concepts: list[str] = Field(default_factory=list, description="Key concepts mentioned")


class BugDetectionRequest(BaseModel):
    """Request for bug detection."""

    code: str = Field(..., description="Code to analyze")
    language: str = Field(..., description="Programming language")


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


class CompletionProvider:
    """Multi-provider LLM interface for code completions."""

    _anthropic_client: AsyncAnthropic | None = None
    _ollama_client: AsyncOpenAI | None = None
    _vertex_client: AsyncAnthropicVertex | None = None

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
    def get_vertex_client(cls) -> AsyncAnthropicVertex:
        """Get or create Vertex AI client for Claude models."""
        if cls._vertex_client is None:
            if not settings.GCP_PROJECT_ID:

                class GCPProjectIDRequiredError(ValueError):
                    def __init__(self) -> None:
                        super().__init__("GCP_PROJECT_ID required for Vertex AI")

                raise GCPProjectIDRequiredError
            cls._vertex_client = AsyncAnthropicVertex(
                project_id=settings.GCP_PROJECT_ID,
                region=settings.GCP_REGION,
            )
        return cls._vertex_client

    @classmethod
    async def complete(
        cls,
        prompt: str,
        system_prompt: str,
        max_tokens: int = 128,
        temperature: float = 0.2,
    ) -> str:
        """Generate completion using configured provider.

        Uses LLM_PROVIDER setting:
        - vertex (default): Claude Haiku on Google Cloud Vertex AI
        - ollama: Local LLM via Ollama
        - anthropic: Direct Anthropic API
        """
        provider = settings.LLM_PROVIDER

        try:
            if provider == "vertex":
                return await cls._complete_vertex(prompt, system_prompt, max_tokens, temperature)
            if provider == "ollama":
                return await cls._complete_ollama(prompt, system_prompt, max_tokens, temperature)
            if provider == "anthropic":
                return await cls._complete_anthropic(prompt, system_prompt, max_tokens, temperature)
            # Fallback to vertex for unknown provider
            logger.warning("Unknown LLM provider, falling back to vertex", provider=provider)
            return await cls._complete_vertex(prompt, system_prompt, max_tokens, temperature)
        except Exception as e:
            # If primary provider fails and we have Ollama configured, try it as fallback
            if provider != "ollama" and settings.OLLAMA_URL:
                logger.warning(
                    "Primary provider failed, trying Ollama fallback",
                    provider=provider,
                    error=str(e),
                )
                try:
                    return await cls._complete_ollama(
                        prompt, system_prompt, max_tokens, temperature
                    )
                except Exception as fallback_error:
                    logger.exception("Ollama fallback also failed", error=str(fallback_error))
                    raise e from fallback_error
            raise

    @classmethod
    async def _complete_vertex(
        cls,
        prompt: str,
        system_prompt: str,
        max_tokens: int,
        temperature: float,
    ) -> str:
        """Complete using Google Cloud Vertex AI with Claude Haiku."""
        # Use Claude 3.5 Haiku on Vertex AI for fast completions
        model_id = "claude-3-5-haiku-20241022"

        client = cls.get_vertex_client()
        response = await client.messages.create(
            model=model_id,
            max_tokens=max_tokens,
            temperature=temperature,
            system=system_prompt,
            messages=[{"role": "user", "content": prompt}],
        )

        # Extract text from Anthropic format response
        for block in response.content:
            if block.type == "text":
                return block.text.strip()

        return ""

    @classmethod
    async def _complete_ollama(
        cls,
        prompt: str,
        system_prompt: str,
        max_tokens: int,
        temperature: float,
    ) -> str:
        """Complete using Ollama (local LLM)."""
        client = cls.get_ollama_client()
        model = settings.OLLAMA_MODEL  # e.g., "qwen2.5-coder:14b"

        response = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt},
            ],
            max_tokens=max_tokens,
            temperature=temperature,
        )

        if response.choices and response.choices[0].message.content:
            return response.choices[0].message.content.strip()
        return ""

    @classmethod
    async def _complete_anthropic(
        cls,
        prompt: str,
        system_prompt: str,
        max_tokens: int,
        temperature: float,
    ) -> str:
        """Complete using direct Anthropic API."""
        client = cls.get_anthropic_client()

        response = await client.messages.create(
            model="claude-3-5-haiku-20241022",
            max_tokens=max_tokens,
            temperature=temperature,
            system=system_prompt,
            messages=[{"role": "user", "content": prompt}],
        )

        for block in response.content:
            if block.type == "text":
                return block.text.strip()
        return ""


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
) -> InlineCompletionResponse:
    """
    Get an inline code completion suggestion.

    This endpoint provides Copilot-style code completions based on the
    code context (prefix and suffix around the cursor).
    """
    logger.info(
        "Inline completion request",
        language=body.language,
        prefix_length=len(body.prefix),
        user_id=current_user.get("id"),
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
        # Use multi-provider completion
        completion = await CompletionProvider.complete(
            prompt=prompt,
            system_prompt=COMPLETION_SYSTEM_PROMPT,
            max_tokens=body.max_tokens,
            temperature=0.2,  # Low temperature for predictable completions
        )

        # Clean up the completion
        # Remove markdown code blocks if the model added them
        if completion.startswith("```"):
            lines = completion.split("\n")
            if len(lines) > MIN_CODE_BLOCK_LINES:
                completion = "\n".join(lines[1:-1])

        logger.info(
            "Completion generated",
            completion_length=len(completion),
            provider=settings.LLM_PROVIDER,
        )

        return InlineCompletionResponse(
            completion=completion,
            confidence=1.0,
            cached=False,
        )

    except Exception as e:
        logger.exception("Completion error", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to generate completion") from e


@router.post("/explain", response_model=CodeExplanationResponse)
@limiter.limit(RATE_LIMIT_AGENT)
async def explain_code(
    body: CodeExplanationRequest,
    request: Request,  # noqa: ARG001
    response: Response,  # noqa: ARG001
    _current_user: CurrentUser,
) -> CodeExplanationResponse:
    """
    Get an AI-powered explanation of code.

    Analyzes the provided code and returns a detailed explanation
    of what it does and how it works.
    """
    logger.info(
        "Code explanation request",
        language=body.language,
        code_length=len(body.code),
        detail_level=body.detail_level,
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
        client = CompletionProvider.get_anthropic_client()

        api_response = await client.messages.create(
            model="claude-3-5-sonnet-20241022",
            max_tokens=1024,
            temperature=0.3,
            system=EXPLANATION_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": prompt}],
        )

        # Parse the response
        text = ""
        for block in api_response.content:
            if block.type == "text":
                text = block.text
                break

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

    except Exception as e:
        logger.exception("Explanation error", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to explain code") from e


@router.post("/detect-bugs", response_model=BugDetectionResponse)
@limiter.limit(RATE_LIMIT_AGENT)
async def detect_bugs(
    body: BugDetectionRequest,
    request: Request,  # noqa: ARG001
    response: Response,  # noqa: ARG001
    _current_user: CurrentUser,
) -> BugDetectionResponse:
    """
    Analyze code for potential bugs and issues.

    Uses AI to identify bugs, security issues, and code smells
    in the provided code snippet.
    """
    start_time = time.time()

    logger.info(
        "Bug detection request",
        language=body.language,
        code_length=len(body.code),
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
        client = CompletionProvider.get_anthropic_client()

        api_response = await client.messages.create(
            model="claude-3-5-sonnet-20241022",
            max_tokens=1024,
            temperature=0.2,
            system=BUG_DETECTION_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": prompt}],
        )

        # Parse the response
        text = ""
        for block in api_response.content:
            if block.type == "text":
                text = block.text.strip()
                break

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

    except Exception as e:
        logger.exception("Bug detection error", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to analyze code") from e
