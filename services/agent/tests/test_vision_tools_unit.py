"""Tests for vision tools module.

Tests cover:
- VisionAnalyzerHolder singleton
- analyze_screenshot function
- design_to_code function
- visual_diff function
- analyze_accessibility function
- extract_ui_elements function
- VISION_TOOLS registry
"""

import json
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.tools.vision_tools import (
    VisionAnalyzerHolder,
    analyze_screenshot,
    design_to_code,
    visual_diff,
    analyze_accessibility,
    extract_ui_elements,
    VISION_TOOLS,
)


class TestVisionToolsModule:
    """Test vision tools module exists."""

    def test_vision_tools_module_exists(self):
        """Test vision tools module can be imported."""
        from src.tools import vision_tools
        assert vision_tools is not None


class TestVisionAnalyzerHolder:
    """Test VisionAnalyzerHolder singleton."""

    def test_holder_class_exists(self):
        """Test VisionAnalyzerHolder class exists."""
        assert VisionAnalyzerHolder is not None

    def test_holder_get_creates_instance(self):
        """Test get creates analyzer instance."""
        # Reset for test
        VisionAnalyzerHolder._instance = None

        with patch("src.tools.vision_tools.VisionAnalyzer") as MockAnalyzer:
            mock_instance = MagicMock()
            MockAnalyzer.return_value = mock_instance

            result = VisionAnalyzerHolder.get()

            assert result is mock_instance
            MockAnalyzer.assert_called_once()

    def test_holder_get_returns_same_instance(self):
        """Test get returns same instance."""
        VisionAnalyzerHolder._instance = None

        with patch("src.tools.vision_tools.VisionAnalyzer") as MockAnalyzer:
            mock_instance = MagicMock()
            MockAnalyzer.return_value = mock_instance

            result1 = VisionAnalyzerHolder.get()
            result2 = VisionAnalyzerHolder.get()

            assert result1 is result2
            MockAnalyzer.assert_called_once()  # Only called once


class TestAnalyzeScreenshot:
    """Test analyze_screenshot function."""

    def test_analyze_screenshot_exists(self):
        """Test analyze_screenshot function exists."""
        assert analyze_screenshot is not None
        assert callable(analyze_screenshot)

    async def test_analyze_screenshot_no_input(self):
        """Test analyze_screenshot with no input."""
        result = await analyze_screenshot()

        parsed = json.loads(result)
        assert parsed["success"] is False
        assert "image_path or image_base64" in parsed["error"]

    async def test_analyze_screenshot_with_path(self):
        """Test analyze_screenshot with path."""
        mock_result = MagicMock()
        mock_result.to_dict.return_value = {
            "description": "A login page",
            "elements": ["input", "button"],
        }

        mock_analyzer = MagicMock()
        mock_analyzer.analyze_screenshot = AsyncMock(return_value=mock_result)

        with patch.object(VisionAnalyzerHolder, "get", return_value=mock_analyzer):
            result = await analyze_screenshot(image_path="/path/to/image.png")

        parsed = json.loads(result)
        assert parsed["success"] is True
        assert "analysis" in parsed

    async def test_analyze_screenshot_with_base64(self):
        """Test analyze_screenshot with base64."""
        mock_result = MagicMock()
        mock_result.to_dict.return_value = {"description": "Test"}

        mock_analyzer = MagicMock()
        mock_analyzer.analyze_screenshot = AsyncMock(return_value=mock_result)

        with patch.object(VisionAnalyzerHolder, "get", return_value=mock_analyzer):
            result = await analyze_screenshot(
                image_base64="iVBORw0KGgoAAAANS...",
                context="Look for buttons",
            )

        parsed = json.loads(result)
        assert parsed["success"] is True

    async def test_analyze_screenshot_error(self):
        """Test analyze_screenshot handles errors."""
        mock_analyzer = MagicMock()
        mock_analyzer.analyze_screenshot = AsyncMock(
            side_effect=Exception("Vision API error")
        )

        with patch.object(VisionAnalyzerHolder, "get", return_value=mock_analyzer):
            result = await analyze_screenshot(image_path="/path/to/image.png")

        parsed = json.loads(result)
        assert parsed["success"] is False
        assert "Vision API error" in parsed["error"]


class TestDesignToCode:
    """Test design_to_code function."""

    def test_design_to_code_exists(self):
        """Test design_to_code function exists."""
        assert design_to_code is not None
        assert callable(design_to_code)

    async def test_design_to_code_no_input(self):
        """Test design_to_code with no input."""
        result = await design_to_code()

        parsed = json.loads(result)
        assert parsed["success"] is False
        assert "image_path or image_base64" in parsed["error"]

    async def test_design_to_code_success(self):
        """Test design_to_code success."""
        mock_result = MagicMock()
        mock_result.code = "<div>Generated code</div>"
        mock_result.description = "A button component"
        mock_result.confidence = 0.9

        mock_analyzer = MagicMock()
        mock_analyzer.design_to_code = AsyncMock(return_value=mock_result)

        with patch.object(VisionAnalyzerHolder, "get", return_value=mock_analyzer):
            result = await design_to_code(
                image_path="/path/to/design.png",
                framework="react",
                styling="tailwind",
                include_responsive=True,
            )

        parsed = json.loads(result)
        assert parsed["success"] is True
        assert parsed["code"] == "<div>Generated code</div>"
        assert parsed["framework"] == "react"
        assert parsed["styling"] == "tailwind"
        assert parsed["confidence"] == 0.9

    async def test_design_to_code_error(self):
        """Test design_to_code handles errors."""
        mock_analyzer = MagicMock()
        mock_analyzer.design_to_code = AsyncMock(
            side_effect=Exception("Code generation failed")
        )

        with patch.object(VisionAnalyzerHolder, "get", return_value=mock_analyzer):
            result = await design_to_code(image_path="/path/to/design.png")

        parsed = json.loads(result)
        assert parsed["success"] is False
        assert "Code generation failed" in parsed["error"]


class TestVisualDiff:
    """Test visual_diff function."""

    def test_visual_diff_exists(self):
        """Test visual_diff function exists."""
        assert visual_diff is not None
        assert callable(visual_diff)

    async def test_visual_diff_missing_images(self):
        """Test visual_diff with missing images."""
        # Missing image1
        result = await visual_diff(image2_path="/path/to/after.png")
        parsed = json.loads(result)
        assert parsed["success"] is False
        assert "Two images are required" in parsed["error"]

        # Missing image2
        result = await visual_diff(image1_path="/path/to/before.png")
        parsed = json.loads(result)
        assert parsed["success"] is False
        assert "Two images are required" in parsed["error"]

    async def test_visual_diff_success(self):
        """Test visual_diff success."""
        mock_result = MagicMock()
        mock_result.description = "Button color changed"
        mock_result.elements = ["button changed from blue to green"]
        mock_result.suggestions = ["Review color change"]
        mock_result.metadata = {"severity": "low"}
        mock_result.confidence = 0.95

        mock_analyzer = MagicMock()
        mock_analyzer.visual_diff = AsyncMock(return_value=mock_result)

        with patch.object(VisionAnalyzerHolder, "get", return_value=mock_analyzer):
            result = await visual_diff(
                image1_path="/path/to/before.png",
                image2_path="/path/to/after.png",
            )

        parsed = json.loads(result)
        assert parsed["success"] is True
        assert parsed["summary"] == "Button color changed"
        assert parsed["severity"] == "low"
        assert parsed["confidence"] == 0.95

    async def test_visual_diff_with_base64(self):
        """Test visual_diff with base64 images."""
        mock_result = MagicMock()
        mock_result.description = "No changes"
        mock_result.elements = []
        mock_result.suggestions = []
        mock_result.metadata = {"severity": "none"}
        mock_result.confidence = 1.0

        mock_analyzer = MagicMock()
        mock_analyzer.visual_diff = AsyncMock(return_value=mock_result)

        with patch.object(VisionAnalyzerHolder, "get", return_value=mock_analyzer):
            result = await visual_diff(
                image1_base64="base64image1",
                image2_base64="base64image2",
            )

        parsed = json.loads(result)
        assert parsed["success"] is True

    async def test_visual_diff_error(self):
        """Test visual_diff handles errors."""
        mock_analyzer = MagicMock()
        mock_analyzer.visual_diff = AsyncMock(
            side_effect=Exception("Diff failed")
        )

        with patch.object(VisionAnalyzerHolder, "get", return_value=mock_analyzer):
            result = await visual_diff(
                image1_path="/path/to/before.png",
                image2_path="/path/to/after.png",
            )

        parsed = json.loads(result)
        assert parsed["success"] is False
        assert "Diff failed" in parsed["error"]


class TestAnalyzeAccessibility:
    """Test analyze_accessibility function."""

    def test_analyze_accessibility_exists(self):
        """Test analyze_accessibility function exists."""
        assert analyze_accessibility is not None
        assert callable(analyze_accessibility)

    async def test_analyze_accessibility_no_input(self):
        """Test analyze_accessibility with no input."""
        result = await analyze_accessibility()

        parsed = json.loads(result)
        assert parsed["success"] is False
        assert "image_path or image_base64" in parsed["error"]

    async def test_analyze_accessibility_success(self):
        """Test analyze_accessibility success."""
        mock_result = MagicMock()
        mock_result.description = "Good contrast"
        mock_result.elements = ["Low contrast text found"]
        mock_result.suggestions = ["Increase text contrast"]
        mock_result.metadata = {"score": 85, "wcag_compliance": "AA"}
        mock_result.confidence = 0.9

        mock_analyzer = MagicMock()
        mock_analyzer.analyze_accessibility = AsyncMock(return_value=mock_result)

        with patch.object(VisionAnalyzerHolder, "get", return_value=mock_analyzer):
            result = await analyze_accessibility(image_path="/path/to/image.png")

        parsed = json.loads(result)
        assert parsed["success"] is True
        assert parsed["score"] == 85
        assert parsed["wcag_compliance"] == "AA"
        assert len(parsed["issues"]) > 0

    async def test_analyze_accessibility_error(self):
        """Test analyze_accessibility handles errors."""
        mock_analyzer = MagicMock()
        mock_analyzer.analyze_accessibility = AsyncMock(
            side_effect=Exception("Accessibility analysis failed")
        )

        with patch.object(VisionAnalyzerHolder, "get", return_value=mock_analyzer):
            result = await analyze_accessibility(image_path="/path/to/image.png")

        parsed = json.loads(result)
        assert parsed["success"] is False
        assert "Accessibility analysis failed" in parsed["error"]


class TestExtractUIElements:
    """Test extract_ui_elements function."""

    def test_extract_ui_elements_exists(self):
        """Test extract_ui_elements function exists."""
        assert extract_ui_elements is not None
        assert callable(extract_ui_elements)

    async def test_extract_ui_elements_no_input(self):
        """Test extract_ui_elements with no input."""
        result = await extract_ui_elements()

        parsed = json.loads(result)
        assert parsed["success"] is False
        assert "image_path or image_base64" in parsed["error"]

    async def test_extract_ui_elements_success(self):
        """Test extract_ui_elements success."""
        mock_result = MagicMock()
        mock_result.description = "Grid layout with cards"
        mock_result.elements = [
            {"type": "button", "text": "Submit"},
            {"type": "input", "placeholder": "Email"},
        ]
        mock_result.metadata = {"component_count": 5}
        mock_result.confidence = 0.85

        mock_analyzer = MagicMock()
        mock_analyzer.extract_ui_elements = AsyncMock(return_value=mock_result)

        with patch.object(VisionAnalyzerHolder, "get", return_value=mock_analyzer):
            result = await extract_ui_elements(image_path="/path/to/image.png")

        parsed = json.loads(result)
        assert parsed["success"] is True
        assert parsed["layout"] == "Grid layout with cards"
        assert parsed["component_count"] == 5
        assert len(parsed["elements"]) == 2

    async def test_extract_ui_elements_error(self):
        """Test extract_ui_elements handles errors."""
        mock_analyzer = MagicMock()
        mock_analyzer.extract_ui_elements = AsyncMock(
            side_effect=Exception("Extraction failed")
        )

        with patch.object(VisionAnalyzerHolder, "get", return_value=mock_analyzer):
            result = await extract_ui_elements(image_path="/path/to/image.png")

        parsed = json.loads(result)
        assert parsed["success"] is False
        assert "Extraction failed" in parsed["error"]


class TestVisionToolsRegistry:
    """Test VISION_TOOLS registry."""

    def test_vision_tools_registry_exists(self):
        """Test VISION_TOOLS registry exists."""
        assert VISION_TOOLS is not None
        assert isinstance(VISION_TOOLS, dict)

    def test_analyze_screenshot_registered(self):
        """Test analyze_screenshot is registered."""
        assert "analyze_screenshot" in VISION_TOOLS
        tool = VISION_TOOLS["analyze_screenshot"]
        assert "function" in tool
        assert "description" in tool
        assert "parameters" in tool

    def test_design_to_code_registered(self):
        """Test design_to_code is registered."""
        assert "design_to_code" in VISION_TOOLS
        tool = VISION_TOOLS["design_to_code"]
        assert tool["function"] is design_to_code
        # Check framework options
        props = tool["parameters"]["properties"]
        assert "framework" in props
        assert "react" in props["framework"]["enum"]
        assert "vue" in props["framework"]["enum"]

    def test_visual_diff_registered(self):
        """Test visual_diff is registered."""
        assert "visual_diff" in VISION_TOOLS
        tool = VISION_TOOLS["visual_diff"]
        assert tool["function"] is visual_diff
        props = tool["parameters"]["properties"]
        assert "image1_path" in props
        assert "image2_path" in props

    def test_analyze_accessibility_registered(self):
        """Test analyze_accessibility is registered."""
        assert "analyze_accessibility" in VISION_TOOLS
        tool = VISION_TOOLS["analyze_accessibility"]
        assert tool["function"] is analyze_accessibility

    def test_extract_ui_elements_registered(self):
        """Test extract_ui_elements is registered."""
        assert "extract_ui_elements" in VISION_TOOLS
        tool = VISION_TOOLS["extract_ui_elements"]
        assert tool["function"] is extract_ui_elements
