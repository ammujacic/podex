"""Vision tools for agents to analyze images and generate code from designs."""

import json

import structlog

from src.vision.analyzer import DesignToCodeConfig, VisionAnalyzer, VisualDiffConfig

logger = structlog.get_logger()


class VisionAnalyzerHolder:
    """Singleton holder for the vision analyzer instance."""

    _instance: VisionAnalyzer | None = None

    @classmethod
    def get(cls) -> VisionAnalyzer:
        """Get or create vision analyzer."""
        if cls._instance is None:
            cls._instance = VisionAnalyzer()
        return cls._instance


def _get_analyzer() -> VisionAnalyzer:
    """Get or create vision analyzer."""
    return VisionAnalyzerHolder.get()


async def analyze_screenshot(
    image_path: str | None = None,
    image_base64: str | None = None,
    context: str | None = None,
) -> str:
    """Analyze a screenshot and describe its contents.

    Args:
        image_path: Path to screenshot file
        image_base64: Base64 encoded image data
        context: Additional context about what to look for

    Returns:
        JSON string with analysis results
    """
    logger.info("Analyzing screenshot", has_path=bool(image_path))

    if not image_path and not image_base64:
        return json.dumps(
            {
                "success": False,
                "error": "Either image_path or image_base64 must be provided",
            },
        )

    try:
        analyzer = _get_analyzer()
        result = await analyzer.analyze_screenshot(
            image_path=image_path,
            image_base64=image_base64,
            context=context,
        )

        return json.dumps(
            {
                "success": True,
                "analysis": result.to_dict(),
            },
        )

    except Exception as e:
        logger.error("Screenshot analysis failed", error=str(e))
        return json.dumps(
            {
                "success": False,
                "error": str(e),
            },
        )


async def design_to_code(
    image_path: str | None = None,
    image_base64: str | None = None,
    framework: str = "react",
    styling: str = "tailwind",
    include_responsive: bool = True,
) -> str:
    """Convert a design mockup or screenshot into code.

    Args:
        image_path: Path to design image
        image_base64: Base64 encoded image
        framework: Target framework (react, vue, html, svelte)
        styling: Styling approach (tailwind, css, styled-components)
        include_responsive: Include responsive design considerations

    Returns:
        JSON string with generated code
    """
    logger.info(
        "Converting design to code",
        framework=framework,
        styling=styling,
    )

    if not image_path and not image_base64:
        return json.dumps(
            {
                "success": False,
                "error": "Either image_path or image_base64 must be provided",
            },
        )

    try:
        analyzer = _get_analyzer()
        config = DesignToCodeConfig(
            image_path=image_path,
            image_base64=image_base64,
            framework=framework,
            styling=styling,
            include_responsive=include_responsive,
        )
        result = await analyzer.design_to_code(config)

        return json.dumps(
            {
                "success": True,
                "code": result.code,
                "framework": framework,
                "styling": styling,
                "description": result.description,
                "confidence": result.confidence,
            },
        )

    except Exception as e:
        logger.error("Design to code failed", error=str(e))
        return json.dumps(
            {
                "success": False,
                "error": str(e),
            },
        )


async def visual_diff(
    image1_path: str | None = None,
    image2_path: str | None = None,
    image1_base64: str | None = None,
    image2_base64: str | None = None,
) -> str:
    """Compare two images and describe visual differences.

    Args:
        image1_path: Path to first (before) image
        image2_path: Path to second (after) image
        image1_base64: Base64 of first image
        image2_base64: Base64 of second image

    Returns:
        JSON string with diff results
    """
    logger.info("Performing visual diff")

    # Validate inputs
    has_image1 = image1_path or image1_base64
    has_image2 = image2_path or image2_base64

    if not has_image1 or not has_image2:
        return json.dumps(
            {
                "success": False,
                "error": "Two images are required for comparison",
            },
        )

    try:
        analyzer = _get_analyzer()
        config = VisualDiffConfig(
            image1_path=image1_path,
            image2_path=image2_path,
            image1_base64=image1_base64,
            image2_base64=image2_base64,
        )
        result = await analyzer.visual_diff(config)

        return json.dumps(
            {
                "success": True,
                "summary": result.description,
                "differences": result.elements,
                "recommendations": result.suggestions,
                "severity": result.metadata.get("severity", "unknown"),
                "confidence": result.confidence,
            },
        )

    except Exception as e:
        logger.error("Visual diff failed", error=str(e))
        return json.dumps(
            {
                "success": False,
                "error": str(e),
            },
        )


async def analyze_accessibility(
    image_path: str | None = None,
    image_base64: str | None = None,
) -> str:
    """Analyze a UI screenshot for accessibility issues.

    Args:
        image_path: Path to screenshot
        image_base64: Base64 encoded image

    Returns:
        JSON string with accessibility analysis
    """
    logger.info("Analyzing accessibility")

    if not image_path and not image_base64:
        return json.dumps(
            {
                "success": False,
                "error": "Either image_path or image_base64 must be provided",
            },
        )

    try:
        analyzer = _get_analyzer()
        result = await analyzer.analyze_accessibility(
            image_path=image_path,
            image_base64=image_base64,
        )

        return json.dumps(
            {
                "success": True,
                "summary": result.description,
                "issues": result.elements,
                "recommendations": result.suggestions,
                "score": result.metadata.get("score", 0),
                "wcag_compliance": result.metadata.get("wcag_compliance", "unknown"),
                "confidence": result.confidence,
            },
        )

    except Exception as e:
        logger.error("Accessibility analysis failed", error=str(e))
        return json.dumps(
            {
                "success": False,
                "error": str(e),
            },
        )


async def extract_ui_elements(
    image_path: str | None = None,
    image_base64: str | None = None,
) -> str:
    """Extract UI elements from a screenshot.

    Args:
        image_path: Path to screenshot
        image_base64: Base64 encoded image

    Returns:
        JSON string with extracted elements
    """
    logger.info("Extracting UI elements")

    if not image_path and not image_base64:
        return json.dumps(
            {
                "success": False,
                "error": "Either image_path or image_base64 must be provided",
            },
        )

    try:
        analyzer = _get_analyzer()
        result = await analyzer.extract_ui_elements(
            image_path=image_path,
            image_base64=image_base64,
        )

        return json.dumps(
            {
                "success": True,
                "layout": result.description,
                "elements": result.elements,
                "component_count": result.metadata.get("component_count", 0),
                "confidence": result.confidence,
            },
        )

    except Exception as e:
        logger.error("UI element extraction failed", error=str(e))
        return json.dumps(
            {
                "success": False,
                "error": str(e),
            },
        )


# Tool definitions for registration
VISION_TOOLS = {
    "analyze_screenshot": {
        "function": analyze_screenshot,
        "description": (
            "Analyze a screenshot to understand its contents, identify UI "
            "elements, and describe the interface."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "image_path": {
                    "type": "string",
                    "description": "Path to the screenshot file",
                },
                "image_base64": {
                    "type": "string",
                    "description": "Base64 encoded image data",
                },
                "context": {
                    "type": "string",
                    "description": "Additional context about what to analyze",
                },
            },
        },
    },
    "design_to_code": {
        "function": design_to_code,
        "description": (
            "Convert a design mockup or screenshot into production-ready code. "
            "Supports React, Vue, HTML, and Svelte."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "image_path": {
                    "type": "string",
                    "description": "Path to the design image",
                },
                "image_base64": {
                    "type": "string",
                    "description": "Base64 encoded image",
                },
                "framework": {
                    "type": "string",
                    "enum": ["react", "vue", "html", "svelte"],
                    "description": "Target framework (default: react)",
                    "default": "react",
                },
                "styling": {
                    "type": "string",
                    "enum": ["tailwind", "css", "styled-components", "inline"],
                    "description": "Styling approach (default: tailwind)",
                    "default": "tailwind",
                },
                "include_responsive": {
                    "type": "boolean",
                    "description": "Include responsive design (default: true)",
                    "default": True,
                },
            },
        },
    },
    "visual_diff": {
        "function": visual_diff,
        "description": (
            "Compare two screenshots and describe the visual differences. "
            "Useful for reviewing UI changes."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "image1_path": {
                    "type": "string",
                    "description": "Path to first (before) image",
                },
                "image2_path": {
                    "type": "string",
                    "description": "Path to second (after) image",
                },
                "image1_base64": {
                    "type": "string",
                    "description": "Base64 of first image",
                },
                "image2_base64": {
                    "type": "string",
                    "description": "Base64 of second image",
                },
            },
        },
    },
    "analyze_accessibility": {
        "function": analyze_accessibility,
        "description": (
            "Analyze a UI screenshot for accessibility issues including color "
            "contrast, text sizing, and WCAG compliance."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "image_path": {
                    "type": "string",
                    "description": "Path to the screenshot",
                },
                "image_base64": {
                    "type": "string",
                    "description": "Base64 encoded image",
                },
            },
        },
    },
    "extract_ui_elements": {
        "function": extract_ui_elements,
        "description": (
            "Extract and identify all UI elements from a screenshot including "
            "buttons, inputs, menus, and other components."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "image_path": {
                    "type": "string",
                    "description": "Path to the screenshot",
                },
                "image_base64": {
                    "type": "string",
                    "description": "Base64 encoded image",
                },
            },
        },
    },
}
