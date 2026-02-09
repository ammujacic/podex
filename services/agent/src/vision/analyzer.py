"""Vision LLM integration for image analysis and understanding."""

import base64
import json
import os
import re
from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import Enum
from pathlib import Path
from typing import Any

import anthropic
import structlog

logger = structlog.get_logger()


class AnalysisType(str, Enum):
    """Types of visual analysis."""

    SCREENSHOT = "screenshot"
    DESIGN = "design"
    DIFF = "diff"
    UI_ELEMENTS = "ui_elements"
    ACCESSIBILITY = "accessibility"
    CODE_GENERATION = "code_generation"


@dataclass
class DesignToCodeConfig:
    """Configuration for design-to-code conversion."""

    image_path: str | Path | None = None
    image_bytes: bytes | None = None
    image_base64: str | None = None
    framework: str = "react"
    styling: str = "tailwind"
    include_responsive: bool = True


@dataclass
class VisualDiffConfig:
    """Configuration for visual diff comparison."""

    image1_path: str | Path | None = None
    image2_path: str | Path | None = None
    image1_bytes: bytes | None = None
    image2_bytes: bytes | None = None
    image1_base64: str | None = None
    image2_base64: str | None = None


@dataclass
class AnalysisResult:
    """Result of visual analysis."""

    analysis_type: AnalysisType
    description: str
    elements: list[dict[str, Any]] = field(default_factory=list)
    suggestions: list[str] = field(default_factory=list)
    code: str | None = None
    confidence: float = 0.0
    metadata: dict[str, Any] = field(default_factory=dict)
    timestamp: datetime = field(default_factory=lambda: datetime.now(UTC))

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary."""
        return {
            "analysis_type": self.analysis_type.value,
            "description": self.description,
            "elements": self.elements,
            "suggestions": self.suggestions,
            "code": self.code,
            "confidence": self.confidence,
            "metadata": self.metadata,
            "timestamp": self.timestamp.isoformat(),
        }


class VisionAnalyzer:
    """Analyzes images using vision-capable LLMs.

    Features:
    - Screenshot analysis and description
    - UI element detection
    - Design-to-code generation
    - Visual diff comparison
    - Accessibility analysis
    """

    def __init__(
        self,
        model: str = "claude-3-5-sonnet-20241022",
        api_key: str | None = None,
    ) -> None:
        """Initialize vision analyzer.

        Args:
            model: Vision-capable model to use
            api_key: API key (uses env if not provided)
        """
        self._model = model
        self._api_key = api_key
        self._client: Any = None

    async def _get_client(self) -> Any:
        """Get or create Anthropic client."""
        if self._client is None:
            self._client = anthropic.AsyncAnthropic(
                api_key=self._api_key or os.environ.get("ANTHROPIC_API_KEY"),
            )
        return self._client

    def _encode_image(self, image_path: str | Path) -> tuple[str, str]:
        """Encode image to base64.

        Args:
            image_path: Path to image file

        Returns:
            Tuple of (base64_data, media_type)
        """
        path = Path(image_path)
        suffix = path.suffix.lower()

        media_types = {
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".gif": "image/gif",
            ".webp": "image/webp",
        }

        media_type = media_types.get(suffix, "image/png")

        with path.open("rb") as f:
            data = base64.b64encode(f.read()).decode("utf-8")

        return data, media_type

    def _encode_image_bytes(self, image_bytes: bytes, _media_type: str = "image/png") -> str:
        """Encode image bytes to base64."""
        return base64.b64encode(image_bytes).decode("utf-8")

    async def analyze_screenshot(
        self,
        image_path: str | Path | None = None,
        image_bytes: bytes | None = None,
        image_base64: str | None = None,
        context: str | None = None,
    ) -> AnalysisResult:
        """Analyze a screenshot and describe its contents.

        Args:
            image_path: Path to image file
            image_bytes: Raw image bytes
            image_base64: Base64 encoded image
            context: Additional context about the screenshot

        Returns:
            Analysis result with description and elements
        """
        logger.info("Analyzing screenshot")

        # Prepare image data
        if image_path:
            image_data, media_type = self._encode_image(image_path)
        elif image_bytes:
            image_data = self._encode_image_bytes(image_bytes)
            media_type = "image/png"
        elif image_base64:
            image_data = image_base64
            media_type = "image/png"
        else:
            return AnalysisResult(
                analysis_type=AnalysisType.SCREENSHOT,
                description="No image provided",
                confidence=0.0,
            )

        prompt = """Analyze this screenshot and provide:

1. A detailed description of what you see
2. List of UI elements (buttons, forms, menus, etc.)
3. The overall purpose/function of this interface
4. Any issues or improvements you notice

Format your response as JSON:
{
    "description": "...",
    "elements": [{"type": "...", "label": "...", "location": "..."}],
    "purpose": "...",
    "suggestions": ["..."]
}"""

        if context:
            prompt = f"Context: {context}\n\n{prompt}"

        try:
            client = await self._get_client()
            response = await client.messages.create(
                model=self._model,
                max_tokens=2000,
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "image",
                                "source": {
                                    "type": "base64",
                                    "media_type": media_type,
                                    "data": image_data,
                                },
                            },
                            {
                                "type": "text",
                                "text": prompt,
                            },
                        ],
                    },
                ],
            )

            content = response.content[0].text

            # Parse JSON response
            try:
                # Find JSON in response
                json_match = re.search(r"\{.*\}", content, re.DOTALL)
                data = json.loads(json_match.group()) if json_match else {"description": content}
            except json.JSONDecodeError:
                data = {"description": content}

            return AnalysisResult(
                analysis_type=AnalysisType.SCREENSHOT,
                description=data.get("description", content),
                elements=data.get("elements", []),
                suggestions=data.get("suggestions", []),
                confidence=0.9,
                metadata={
                    "purpose": data.get("purpose", ""),
                    "model": self._model,
                },
            )

        except Exception as e:
            logger.error("Screenshot analysis failed", error=str(e))
            return AnalysisResult(
                analysis_type=AnalysisType.SCREENSHOT,
                description=f"Analysis failed: {e!s}",
                confidence=0.0,
            )

    async def design_to_code(self, config: DesignToCodeConfig) -> AnalysisResult:
        """Convert a design mockup to code.

        Args:
            config: Design-to-code configuration containing image source
                    and output preferences (framework, styling, responsive).

        Returns:
            Analysis result with generated code
        """
        logger.info(
            "Converting design to code",
            framework=config.framework,
            styling=config.styling,
        )

        # Prepare image data
        if config.image_path:
            image_data, media_type = self._encode_image(config.image_path)
        elif config.image_bytes:
            image_data = self._encode_image_bytes(config.image_bytes)
            media_type = "image/png"
        elif config.image_base64:
            image_data = config.image_base64
            media_type = "image/png"
        else:
            return AnalysisResult(
                analysis_type=AnalysisType.CODE_GENERATION,
                description="No image provided",
                confidence=0.0,
            )

        framework_templates = {
            "react": "React functional component with TypeScript",
            "vue": "Vue 3 Composition API component",
            "html": "semantic HTML5",
            "svelte": "Svelte component",
        }

        styling_templates = {
            "tailwind": "Tailwind CSS classes",
            "css": "CSS modules",
            "styled-components": "styled-components",
            "inline": "inline styles",
        }

        framework_desc = framework_templates.get(config.framework, config.framework)
        styling_desc = styling_templates.get(config.styling, config.styling)

        prompt = f"""Convert this design/mockup into production-ready code.

Requirements:
- Framework: {framework_desc}
- Styling: {styling_desc}
- Include responsive design: {config.include_responsive}

Provide:
1. Complete, working code that matches the design
2. Use semantic HTML elements
3. Include proper accessibility attributes (aria-labels, roles)
4. Add helpful comments for complex sections

Output the code directly without additional explanation. Use proper indentation and formatting."""

        try:
            client = await self._get_client()
            response = await client.messages.create(
                model=self._model,
                max_tokens=4000,
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "image",
                                "source": {
                                    "type": "base64",
                                    "media_type": media_type,
                                    "data": image_data,
                                },
                            },
                            {
                                "type": "text",
                                "text": prompt,
                            },
                        ],
                    },
                ],
            )

            code = response.content[0].text

            # Extract code blocks if wrapped in markdown
            code_match = re.search(r"```(?:\w+)?\n(.*?)```", code, re.DOTALL)
            if code_match:
                code = code_match.group(1)

            return AnalysisResult(
                analysis_type=AnalysisType.CODE_GENERATION,
                description=f"Generated {config.framework} component with {config.styling}",
                code=code,
                confidence=0.85,
                metadata={
                    "framework": config.framework,
                    "styling": config.styling,
                    "responsive": config.include_responsive,
                    "model": self._model,
                },
            )

        except Exception as e:
            logger.error("Design to code failed", error=str(e))
            return AnalysisResult(
                analysis_type=AnalysisType.CODE_GENERATION,
                description=f"Code generation failed: {e!s}",
                confidence=0.0,
            )

    async def visual_diff(self, config: VisualDiffConfig) -> AnalysisResult:
        """Compare two images and describe differences.

        Args:
            config: Visual diff configuration containing image sources
                    for both images to compare.

        Returns:
            Analysis result with differences
        """
        logger.info("Performing visual diff")

        # Prepare image data
        images = []
        for path, bytes_data, b64 in [
            (config.image1_path, config.image1_bytes, config.image1_base64),
            (config.image2_path, config.image2_bytes, config.image2_base64),
        ]:
            if path:
                data, media_type = self._encode_image(path)
            elif bytes_data:
                data = self._encode_image_bytes(bytes_data)
                media_type = "image/png"
            elif b64:
                data = b64
                media_type = "image/png"
            else:
                return AnalysisResult(
                    analysis_type=AnalysisType.DIFF,
                    description="Two images required for comparison",
                    confidence=0.0,
                )

            images.append({"data": data, "media_type": media_type})

        prompt = """Compare these two images and describe:

1. What are the key differences between them?
2. What elements have changed (added, removed, modified)?
3. Are there any layout or positioning changes?
4. Color or styling differences?

Format your response as JSON:
{
    "summary": "Brief summary of differences",
    "differences": [
        {"type": "added|removed|modified", "element": "...", "description": "..."}
    ],
    "severity": "none|minor|moderate|major",
    "recommendations": ["..."]
}"""

        try:
            client = await self._get_client()
            response = await client.messages.create(
                model=self._model,
                max_tokens=2000,
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "text",
                                "text": "Image 1 (before):",
                            },
                            {
                                "type": "image",
                                "source": {
                                    "type": "base64",
                                    "media_type": images[0]["media_type"],
                                    "data": images[0]["data"],
                                },
                            },
                            {
                                "type": "text",
                                "text": "Image 2 (after):",
                            },
                            {
                                "type": "image",
                                "source": {
                                    "type": "base64",
                                    "media_type": images[1]["media_type"],
                                    "data": images[1]["data"],
                                },
                            },
                            {
                                "type": "text",
                                "text": prompt,
                            },
                        ],
                    },
                ],
            )

            content = response.content[0].text

            # Parse JSON response
            try:
                json_match = re.search(r"\{.*\}", content, re.DOTALL)
                parsed_data = json.loads(json_match.group()) if json_match else {"summary": content}
            except json.JSONDecodeError:
                parsed_data = {"summary": content}

            return AnalysisResult(
                analysis_type=AnalysisType.DIFF,
                description=parsed_data.get("summary", content),
                elements=parsed_data.get("differences", []),
                suggestions=parsed_data.get("recommendations", []),
                confidence=0.85,
                metadata={
                    "severity": parsed_data.get("severity", "unknown"),
                    "model": self._model,
                },
            )

        except Exception as e:
            logger.error("Visual diff failed", error=str(e))
            return AnalysisResult(
                analysis_type=AnalysisType.DIFF,
                description=f"Diff failed: {e!s}",
                confidence=0.0,
            )

    async def analyze_accessibility(
        self,
        image_path: str | Path | None = None,
        image_bytes: bytes | None = None,
        image_base64: str | None = None,
    ) -> AnalysisResult:
        """Analyze UI for accessibility issues.

        Args:
            image_path: Path to image
            image_bytes: Image bytes
            image_base64: Base64 encoded image

        Returns:
            Analysis result with accessibility findings
        """
        logger.info("Analyzing accessibility")

        # Prepare image data
        if image_path:
            image_data, media_type = self._encode_image(image_path)
        elif image_bytes:
            image_data = self._encode_image_bytes(image_bytes)
            media_type = "image/png"
        elif image_base64:
            image_data = image_base64
            media_type = "image/png"
        else:
            return AnalysisResult(
                analysis_type=AnalysisType.ACCESSIBILITY,
                description="No image provided",
                confidence=0.0,
            )

        prompt = """Analyze this UI for accessibility issues. Check for:

1. Color contrast (WCAG AA/AAA compliance)
2. Text readability and sizing
3. Interactive element sizing (touch targets)
4. Visual hierarchy and focus indicators
5. Potential issues for screen readers

Format your response as JSON:
{
    "summary": "Overall accessibility assessment",
    "issues": [
        {"severity": "critical|major|minor", "category": "...",
         "description": "...", "recommendation": "..."}
    ],
    "score": 0-100,
    "wcag_compliance": "A|AA|AAA|none"
}"""

        try:
            client = await self._get_client()
            response = await client.messages.create(
                model=self._model,
                max_tokens=2000,
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "image",
                                "source": {
                                    "type": "base64",
                                    "media_type": media_type,
                                    "data": image_data,
                                },
                            },
                            {
                                "type": "text",
                                "text": prompt,
                            },
                        ],
                    },
                ],
            )

            content = response.content[0].text

            # Parse JSON response
            try:
                json_match = re.search(r"\{.*\}", content, re.DOTALL)
                data = json.loads(json_match.group()) if json_match else {"summary": content}
            except json.JSONDecodeError:
                data = {"summary": content}

            # Convert issues to suggestions format
            suggestions = []
            for issue in data.get("issues", []):
                suggestions.append(
                    f"[{issue.get('severity', 'info').upper()}] {issue.get('category', '')}: "
                    f"{issue.get('description', '')} - {issue.get('recommendation', '')}",
                )

            return AnalysisResult(
                analysis_type=AnalysisType.ACCESSIBILITY,
                description=data.get("summary", content),
                elements=data.get("issues", []),
                suggestions=suggestions,
                confidence=0.8,
                metadata={
                    "score": data.get("score", 0),
                    "wcag_compliance": data.get("wcag_compliance", "unknown"),
                    "model": self._model,
                },
            )

        except Exception as e:
            logger.error("Accessibility analysis failed", error=str(e))
            return AnalysisResult(
                analysis_type=AnalysisType.ACCESSIBILITY,
                description=f"Analysis failed: {e!s}",
                confidence=0.0,
            )

    async def extract_ui_elements(
        self,
        image_path: str | Path | None = None,
        image_bytes: bytes | None = None,
        image_base64: str | None = None,
    ) -> AnalysisResult:
        """Extract UI elements from a screenshot.

        Args:
            image_path: Path to image
            image_bytes: Image bytes
            image_base64: Base64 encoded image

        Returns:
            Analysis result with UI elements
        """
        logger.info("Extracting UI elements")

        # Prepare image data
        if image_path:
            image_data, media_type = self._encode_image(image_path)
        elif image_bytes:
            image_data = self._encode_image_bytes(image_bytes)
            media_type = "image/png"
        elif image_base64:
            image_data = image_base64
            media_type = "image/png"
        else:
            return AnalysisResult(
                analysis_type=AnalysisType.UI_ELEMENTS,
                description="No image provided",
                confidence=0.0,
            )

        prompt = """Identify and list all UI elements in this interface. For each element, provide:

1. Element type (button, input, link, menu, etc.)
2. Text/label content
3. Approximate position (top-left, center, bottom-right, etc.)
4. State (if visible - active, disabled, selected, etc.)
5. Any interactivity hints

Format as JSON:
{
    "elements": [
        {
            "type": "button|input|link|menu|card|image|text|form|...",
            "label": "text content",
            "position": "approximate location",
            "state": "normal|active|disabled|selected",
            "interactive": true|false
        }
    ],
    "layout": "description of overall layout",
    "component_count": number
}"""

        try:
            client = await self._get_client()
            response = await client.messages.create(
                model=self._model,
                max_tokens=2000,
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "image",
                                "source": {
                                    "type": "base64",
                                    "media_type": media_type,
                                    "data": image_data,
                                },
                            },
                            {
                                "type": "text",
                                "text": prompt,
                            },
                        ],
                    },
                ],
            )

            content = response.content[0].text

            # Parse JSON response
            try:
                json_match = re.search(r"\{.*\}", content, re.DOTALL)
                if json_match:
                    data = json.loads(json_match.group())
                else:
                    data = {"elements": [], "layout": content}
            except json.JSONDecodeError:
                data = {"elements": [], "layout": content}

            return AnalysisResult(
                analysis_type=AnalysisType.UI_ELEMENTS,
                description=data.get("layout", ""),
                elements=data.get("elements", []),
                confidence=0.85,
                metadata={
                    "component_count": data.get("component_count", len(data.get("elements", []))),
                    "model": self._model,
                },
            )

        except Exception as e:
            logger.error("UI element extraction failed", error=str(e))
            return AnalysisResult(
                analysis_type=AnalysisType.UI_ELEMENTS,
                description=f"Extraction failed: {e!s}",
                confidence=0.0,
            )
