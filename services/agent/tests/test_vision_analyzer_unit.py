"""Tests for vision analyzer module.

Tests cover:
- VisionAnalyzer class initialization
- Analyzer methods
- AnalysisType enum
- AnalysisResult dataclass
- DesignToCodeConfig dataclass
- VisualDiffConfig dataclass
"""

from datetime import datetime, UTC
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


class TestVisionAnalyzerModule:
    """Test vision analyzer module exists."""

    def test_vision_analyzer_module_exists(self):
        """Test vision analyzer module can be imported."""
        from src.vision import analyzer
        assert analyzer is not None


class TestAnalysisTypeEnum:
    """Test AnalysisType enum."""

    def test_analysis_type_exists(self):
        """Test AnalysisType enum exists."""
        from src.vision.analyzer import AnalysisType
        assert AnalysisType is not None

    def test_analysis_type_screenshot(self):
        """Test SCREENSHOT value."""
        from src.vision.analyzer import AnalysisType
        assert AnalysisType.SCREENSHOT.value == "screenshot"

    def test_analysis_type_design(self):
        """Test DESIGN value."""
        from src.vision.analyzer import AnalysisType
        assert AnalysisType.DESIGN.value == "design"

    def test_analysis_type_diff(self):
        """Test DIFF value."""
        from src.vision.analyzer import AnalysisType
        assert AnalysisType.DIFF.value == "diff"

    def test_analysis_type_ui_elements(self):
        """Test UI_ELEMENTS value."""
        from src.vision.analyzer import AnalysisType
        assert AnalysisType.UI_ELEMENTS.value == "ui_elements"

    def test_analysis_type_accessibility(self):
        """Test ACCESSIBILITY value."""
        from src.vision.analyzer import AnalysisType
        assert AnalysisType.ACCESSIBILITY.value == "accessibility"

    def test_analysis_type_code_generation(self):
        """Test CODE_GENERATION value."""
        from src.vision.analyzer import AnalysisType
        assert AnalysisType.CODE_GENERATION.value == "code_generation"


class TestAnalysisResult:
    """Test AnalysisResult dataclass."""

    def test_analysis_result_exists(self):
        """Test AnalysisResult exists."""
        from src.vision.analyzer import AnalysisResult
        assert AnalysisResult is not None

    def test_analysis_result_creation(self):
        """Test creating AnalysisResult."""
        from src.vision.analyzer import AnalysisResult, AnalysisType

        result = AnalysisResult(
            analysis_type=AnalysisType.SCREENSHOT,
            description="A test description",
        )

        assert result.analysis_type == AnalysisType.SCREENSHOT
        assert result.description == "A test description"

    def test_analysis_result_defaults(self):
        """Test AnalysisResult default values."""
        from src.vision.analyzer import AnalysisResult, AnalysisType

        result = AnalysisResult(
            analysis_type=AnalysisType.DESIGN,
            description="Test",
        )

        assert result.elements == []
        assert result.suggestions == []
        assert result.code is None
        assert result.confidence == 0.0
        assert result.metadata == {}

    def test_analysis_result_with_all_fields(self):
        """Test AnalysisResult with all fields."""
        from src.vision.analyzer import AnalysisResult, AnalysisType

        result = AnalysisResult(
            analysis_type=AnalysisType.UI_ELEMENTS,
            description="Found UI elements",
            elements=[{"type": "button", "text": "Click"}],
            suggestions=["Add aria-label"],
            code="<button>Click</button>",
            confidence=0.95,
            metadata={"source": "test"},
        )

        assert len(result.elements) == 1
        assert len(result.suggestions) == 1
        assert result.code == "<button>Click</button>"
        assert result.confidence == 0.95

    def test_analysis_result_to_dict(self):
        """Test AnalysisResult to_dict method."""
        from src.vision.analyzer import AnalysisResult, AnalysisType

        result = AnalysisResult(
            analysis_type=AnalysisType.SCREENSHOT,
            description="Test description",
            confidence=0.8,
        )

        data = result.to_dict()

        assert data["analysis_type"] == "screenshot"
        assert data["description"] == "Test description"
        assert data["confidence"] == 0.8
        assert "timestamp" in data


class TestDesignToCodeConfig:
    """Test DesignToCodeConfig dataclass."""

    def test_design_to_code_config_exists(self):
        """Test DesignToCodeConfig exists."""
        from src.vision.analyzer import DesignToCodeConfig
        assert DesignToCodeConfig is not None

    def test_design_to_code_config_creation(self):
        """Test creating DesignToCodeConfig."""
        from src.vision.analyzer import DesignToCodeConfig

        config = DesignToCodeConfig()

        assert config.image_path is None
        assert config.image_bytes is None
        assert config.image_base64 is None

    def test_design_to_code_config_defaults(self):
        """Test DesignToCodeConfig default values."""
        from src.vision.analyzer import DesignToCodeConfig

        config = DesignToCodeConfig()

        assert config.framework == "react"
        assert config.styling == "tailwind"
        assert config.include_responsive is True

    def test_design_to_code_config_with_image_path(self):
        """Test DesignToCodeConfig with image path."""
        from src.vision.analyzer import DesignToCodeConfig

        config = DesignToCodeConfig(
            image_path="/path/to/image.png",
            framework="vue",
            styling="css",
        )

        assert config.image_path == "/path/to/image.png"
        assert config.framework == "vue"
        assert config.styling == "css"


class TestVisualDiffConfig:
    """Test VisualDiffConfig dataclass."""

    def test_visual_diff_config_exists(self):
        """Test VisualDiffConfig exists."""
        from src.vision.analyzer import VisualDiffConfig
        assert VisualDiffConfig is not None

    def test_visual_diff_config_creation(self):
        """Test creating VisualDiffConfig."""
        from src.vision.analyzer import VisualDiffConfig

        config = VisualDiffConfig()

        assert config.image1_path is None
        assert config.image2_path is None
        assert config.image1_bytes is None
        assert config.image2_bytes is None
        assert config.image1_base64 is None
        assert config.image2_base64 is None

    def test_visual_diff_config_with_paths(self):
        """Test VisualDiffConfig with image paths."""
        from src.vision.analyzer import VisualDiffConfig

        config = VisualDiffConfig(
            image1_path="/path/to/image1.png",
            image2_path="/path/to/image2.png",
        )

        assert config.image1_path == "/path/to/image1.png"
        assert config.image2_path == "/path/to/image2.png"


class TestVisionAnalyzerClass:
    """Test VisionAnalyzer class."""

    def test_vision_analyzer_class_exists(self):
        """Test VisionAnalyzer class exists."""
        from src.vision.analyzer import VisionAnalyzer
        assert VisionAnalyzer is not None


class TestVisionAnalyzerInit:
    """Test VisionAnalyzer initialization."""

    def test_vision_analyzer_initialization(self):
        """Test VisionAnalyzer can be instantiated."""
        from src.vision.analyzer import VisionAnalyzer

        analyzer = VisionAnalyzer()
        assert analyzer is not None

    def test_vision_analyzer_with_model(self):
        """Test VisionAnalyzer with custom model."""
        from src.vision.analyzer import VisionAnalyzer

        analyzer = VisionAnalyzer(model="claude-3-opus-20240229")
        assert analyzer._model == "claude-3-opus-20240229"

    def test_vision_analyzer_with_api_key(self):
        """Test VisionAnalyzer with API key."""
        from src.vision.analyzer import VisionAnalyzer

        analyzer = VisionAnalyzer(api_key="test-key")
        assert analyzer._api_key == "test-key"

    def test_vision_analyzer_has_analyze_screenshot_method(self):
        """Test VisionAnalyzer has analyze_screenshot method."""
        from src.vision.analyzer import VisionAnalyzer

        analyzer = VisionAnalyzer()
        assert hasattr(analyzer, "analyze_screenshot")

    def test_vision_analyzer_has_design_to_code_method(self):
        """Test VisionAnalyzer has design_to_code method."""
        from src.vision.analyzer import VisionAnalyzer

        analyzer = VisionAnalyzer()
        assert hasattr(analyzer, "design_to_code")

    def test_vision_analyzer_has_visual_diff_method(self):
        """Test VisionAnalyzer has visual_diff method."""
        from src.vision.analyzer import VisionAnalyzer

        analyzer = VisionAnalyzer()
        assert hasattr(analyzer, "visual_diff")

    def test_vision_analyzer_has_analyze_accessibility_method(self):
        """Test VisionAnalyzer has analyze_accessibility method."""
        from src.vision.analyzer import VisionAnalyzer

        analyzer = VisionAnalyzer()
        assert hasattr(analyzer, "analyze_accessibility")

    def test_vision_analyzer_has_extract_ui_elements_method(self):
        """Test VisionAnalyzer has extract_ui_elements method."""
        from src.vision.analyzer import VisionAnalyzer

        analyzer = VisionAnalyzer()
        assert hasattr(analyzer, "extract_ui_elements")


class TestVisionAnalyzerPrivateMethods:
    """Test VisionAnalyzer private methods."""

    def test_encode_image_bytes_method(self):
        """Test _encode_image_bytes method exists."""
        from src.vision.analyzer import VisionAnalyzer

        analyzer = VisionAnalyzer()
        assert hasattr(analyzer, "_encode_image_bytes")

    def test_encode_image_method(self):
        """Test _encode_image method exists."""
        from src.vision.analyzer import VisionAnalyzer

        analyzer = VisionAnalyzer()
        assert hasattr(analyzer, "_encode_image")

    def test_get_client_method(self):
        """Test _get_client method exists."""
        from src.vision.analyzer import VisionAnalyzer

        analyzer = VisionAnalyzer()
        assert hasattr(analyzer, "_get_client")


class TestEncodeImageBytes:
    """Test _encode_image_bytes method."""

    def test_encode_image_bytes_simple(self):
        """Test encoding simple bytes."""
        from src.vision.analyzer import VisionAnalyzer
        import base64

        analyzer = VisionAnalyzer()
        test_bytes = b"test image data"
        result = analyzer._encode_image_bytes(test_bytes)

        expected = base64.b64encode(test_bytes).decode("utf-8")
        assert result == expected

    def test_encode_image_bytes_binary_data(self):
        """Test encoding binary data."""
        from src.vision.analyzer import VisionAnalyzer
        import base64

        analyzer = VisionAnalyzer()
        # Simulate PNG header bytes
        test_bytes = b"\x89PNG\r\n\x1a\n\x00\x00\x00"
        result = analyzer._encode_image_bytes(test_bytes)

        expected = base64.b64encode(test_bytes).decode("utf-8")
        assert result == expected

    def test_encode_image_bytes_with_media_type(self):
        """Test encoding with media type parameter."""
        from src.vision.analyzer import VisionAnalyzer

        analyzer = VisionAnalyzer()
        test_bytes = b"test data"
        # Media type is not used in result, but should not error
        result = analyzer._encode_image_bytes(test_bytes, "image/jpeg")
        assert isinstance(result, str)


class TestEncodeImage:
    """Test _encode_image method."""

    def test_encode_image_png(self, tmp_path):
        """Test encoding PNG image."""
        from src.vision.analyzer import VisionAnalyzer
        import base64

        analyzer = VisionAnalyzer()

        # Create a test PNG file
        test_file = tmp_path / "test.png"
        test_content = b"fake png content"
        test_file.write_bytes(test_content)

        data, media_type = analyzer._encode_image(test_file)

        assert media_type == "image/png"
        assert data == base64.b64encode(test_content).decode("utf-8")

    def test_encode_image_jpg(self, tmp_path):
        """Test encoding JPG image."""
        from src.vision.analyzer import VisionAnalyzer

        analyzer = VisionAnalyzer()

        test_file = tmp_path / "test.jpg"
        test_file.write_bytes(b"fake jpg content")

        data, media_type = analyzer._encode_image(test_file)

        assert media_type == "image/jpeg"

    def test_encode_image_jpeg(self, tmp_path):
        """Test encoding JPEG image."""
        from src.vision.analyzer import VisionAnalyzer

        analyzer = VisionAnalyzer()

        test_file = tmp_path / "test.jpeg"
        test_file.write_bytes(b"fake jpeg content")

        data, media_type = analyzer._encode_image(test_file)

        assert media_type == "image/jpeg"

    def test_encode_image_gif(self, tmp_path):
        """Test encoding GIF image."""
        from src.vision.analyzer import VisionAnalyzer

        analyzer = VisionAnalyzer()

        test_file = tmp_path / "test.gif"
        test_file.write_bytes(b"fake gif content")

        data, media_type = analyzer._encode_image(test_file)

        assert media_type == "image/gif"

    def test_encode_image_webp(self, tmp_path):
        """Test encoding WebP image."""
        from src.vision.analyzer import VisionAnalyzer

        analyzer = VisionAnalyzer()

        test_file = tmp_path / "test.webp"
        test_file.write_bytes(b"fake webp content")

        data, media_type = analyzer._encode_image(test_file)

        assert media_type == "image/webp"

    def test_encode_image_unknown_type(self, tmp_path):
        """Test encoding unknown type defaults to PNG."""
        from src.vision.analyzer import VisionAnalyzer

        analyzer = VisionAnalyzer()

        test_file = tmp_path / "test.bmp"
        test_file.write_bytes(b"fake bmp content")

        data, media_type = analyzer._encode_image(test_file)

        assert media_type == "image/png"  # Default

    def test_encode_image_string_path(self, tmp_path):
        """Test encoding with string path."""
        from src.vision.analyzer import VisionAnalyzer

        analyzer = VisionAnalyzer()

        test_file = tmp_path / "test.png"
        test_file.write_bytes(b"content")

        data, media_type = analyzer._encode_image(str(test_file))

        assert media_type == "image/png"
        assert isinstance(data, str)


class TestGetClient:
    """Test _get_client method."""

    async def test_get_client_creates_client(self):
        """Test _get_client creates Anthropic client."""
        from src.vision.analyzer import VisionAnalyzer

        with patch("src.vision.analyzer.anthropic.AsyncAnthropic") as mock_anthropic:
            mock_client = MagicMock()
            mock_anthropic.return_value = mock_client

            analyzer = VisionAnalyzer(api_key="test-key")
            client = await analyzer._get_client()

            mock_anthropic.assert_called_once_with(api_key="test-key")
            assert client == mock_client

    async def test_get_client_reuses_client(self):
        """Test _get_client reuses existing client."""
        from src.vision.analyzer import VisionAnalyzer

        with patch("src.vision.analyzer.anthropic.AsyncAnthropic") as mock_anthropic:
            mock_client = MagicMock()
            mock_anthropic.return_value = mock_client

            analyzer = VisionAnalyzer(api_key="test-key")

            # Call twice
            client1 = await analyzer._get_client()
            client2 = await analyzer._get_client()

            # Should only create once
            mock_anthropic.assert_called_once()
            assert client1 is client2

    async def test_get_client_uses_env_var(self):
        """Test _get_client uses environment variable."""
        from src.vision.analyzer import VisionAnalyzer
        import os

        with patch("src.vision.analyzer.anthropic.AsyncAnthropic") as mock_anthropic:
            with patch.dict(os.environ, {"ANTHROPIC_API_KEY": "env-key"}):
                mock_client = MagicMock()
                mock_anthropic.return_value = mock_client

                analyzer = VisionAnalyzer()  # No api_key provided
                await analyzer._get_client()

                mock_anthropic.assert_called_once_with(api_key="env-key")


class TestAnalyzeScreenshot:
    """Test analyze_screenshot method."""

    @pytest.fixture
    def analyzer(self):
        """Create analyzer instance."""
        from src.vision.analyzer import VisionAnalyzer
        return VisionAnalyzer(api_key="test-key")

    @pytest.fixture
    def mock_response(self):
        """Create mock API response."""
        mock = MagicMock()
        mock.content = [
            MagicMock(
                text='{"description": "A login page", "elements": [{"type": "button", "label": "Login"}], "purpose": "User authentication", "suggestions": ["Add forgot password link"]}'
            )
        ]
        return mock

    async def test_analyze_screenshot_no_image(self, analyzer):
        """Test analyze_screenshot with no image."""
        from src.vision.analyzer import AnalysisType

        result = await analyzer.analyze_screenshot()

        assert result.analysis_type == AnalysisType.SCREENSHOT
        assert result.description == "No image provided"
        assert result.confidence == 0.0

    async def test_analyze_screenshot_with_path(self, analyzer, mock_response, tmp_path):
        """Test analyze_screenshot with image path."""
        from src.vision.analyzer import AnalysisType

        # Create test image
        test_file = tmp_path / "screenshot.png"
        test_file.write_bytes(b"fake png data")

        with patch.object(analyzer, "_get_client") as mock_get_client:
            mock_client = AsyncMock()
            mock_client.messages.create = AsyncMock(return_value=mock_response)
            mock_get_client.return_value = mock_client

            result = await analyzer.analyze_screenshot(image_path=test_file)

            assert result.analysis_type == AnalysisType.SCREENSHOT
            assert result.description == "A login page"
            assert len(result.elements) == 1
            assert result.elements[0]["type"] == "button"
            assert result.confidence == 0.9

    async def test_analyze_screenshot_with_bytes(self, analyzer, mock_response):
        """Test analyze_screenshot with image bytes."""
        from src.vision.analyzer import AnalysisType

        with patch.object(analyzer, "_get_client") as mock_get_client:
            mock_client = AsyncMock()
            mock_client.messages.create = AsyncMock(return_value=mock_response)
            mock_get_client.return_value = mock_client

            result = await analyzer.analyze_screenshot(image_bytes=b"fake image bytes")

            assert result.analysis_type == AnalysisType.SCREENSHOT
            assert result.description == "A login page"
            assert result.confidence == 0.9

    async def test_analyze_screenshot_with_base64(self, analyzer, mock_response):
        """Test analyze_screenshot with base64 image."""
        from src.vision.analyzer import AnalysisType
        import base64

        image_b64 = base64.b64encode(b"fake image").decode("utf-8")

        with patch.object(analyzer, "_get_client") as mock_get_client:
            mock_client = AsyncMock()
            mock_client.messages.create = AsyncMock(return_value=mock_response)
            mock_get_client.return_value = mock_client

            result = await analyzer.analyze_screenshot(image_base64=image_b64)

            assert result.analysis_type == AnalysisType.SCREENSHOT
            assert result.confidence == 0.9

    async def test_analyze_screenshot_with_context(self, analyzer, mock_response, tmp_path):
        """Test analyze_screenshot with context."""
        test_file = tmp_path / "screenshot.png"
        test_file.write_bytes(b"fake png data")

        with patch.object(analyzer, "_get_client") as mock_get_client:
            mock_client = AsyncMock()
            mock_client.messages.create = AsyncMock(return_value=mock_response)
            mock_get_client.return_value = mock_client

            result = await analyzer.analyze_screenshot(
                image_path=test_file,
                context="This is the login page for our app"
            )

            # Verify context was included in the prompt
            call_args = mock_client.messages.create.call_args
            messages = call_args.kwargs["messages"]
            text_content = messages[0]["content"][1]["text"]
            assert "This is the login page for our app" in text_content

    async def test_analyze_screenshot_api_error(self, analyzer, tmp_path):
        """Test analyze_screenshot handles API errors."""
        from src.vision.analyzer import AnalysisType

        test_file = tmp_path / "screenshot.png"
        test_file.write_bytes(b"fake png data")

        with patch.object(analyzer, "_get_client") as mock_get_client:
            mock_client = AsyncMock()
            mock_client.messages.create = AsyncMock(side_effect=Exception("API Error"))
            mock_get_client.return_value = mock_client

            result = await analyzer.analyze_screenshot(image_path=test_file)

            assert result.analysis_type == AnalysisType.SCREENSHOT
            assert "Analysis failed" in result.description
            assert result.confidence == 0.0

    async def test_analyze_screenshot_invalid_json_response(self, analyzer, tmp_path):
        """Test analyze_screenshot handles invalid JSON response."""
        test_file = tmp_path / "screenshot.png"
        test_file.write_bytes(b"fake png data")

        mock_response = MagicMock()
        mock_response.content = [MagicMock(text="This is not valid JSON")]

        with patch.object(analyzer, "_get_client") as mock_get_client:
            mock_client = AsyncMock()
            mock_client.messages.create = AsyncMock(return_value=mock_response)
            mock_get_client.return_value = mock_client

            result = await analyzer.analyze_screenshot(image_path=test_file)

            # Should fall back to using raw text as description
            assert result.description == "This is not valid JSON"
            assert result.confidence == 0.9


class TestDesignToCode:
    """Test design_to_code method."""

    @pytest.fixture
    def analyzer(self):
        """Create analyzer instance."""
        from src.vision.analyzer import VisionAnalyzer
        return VisionAnalyzer(api_key="test-key")

    @pytest.fixture
    def mock_response(self):
        """Create mock API response."""
        mock = MagicMock()
        mock.content = [
            MagicMock(
                text='```tsx\nexport function LoginPage() {\n  return <div>Login</div>;\n}\n```'
            )
        ]
        return mock

    async def test_design_to_code_no_image(self, analyzer):
        """Test design_to_code with no image."""
        from src.vision.analyzer import DesignToCodeConfig, AnalysisType

        config = DesignToCodeConfig()
        result = await analyzer.design_to_code(config)

        assert result.analysis_type == AnalysisType.CODE_GENERATION
        assert result.description == "No image provided"
        assert result.confidence == 0.0

    async def test_design_to_code_with_path(self, analyzer, mock_response, tmp_path):
        """Test design_to_code with image path."""
        from src.vision.analyzer import DesignToCodeConfig, AnalysisType

        test_file = tmp_path / "design.png"
        test_file.write_bytes(b"fake design image")

        config = DesignToCodeConfig(image_path=test_file)

        with patch.object(analyzer, "_get_client") as mock_get_client:
            mock_client = AsyncMock()
            mock_client.messages.create = AsyncMock(return_value=mock_response)
            mock_get_client.return_value = mock_client

            result = await analyzer.design_to_code(config)

            assert result.analysis_type == AnalysisType.CODE_GENERATION
            assert "react" in result.description.lower()
            assert result.code is not None
            assert "LoginPage" in result.code
            assert result.confidence == 0.85

    async def test_design_to_code_with_bytes(self, analyzer, mock_response):
        """Test design_to_code with image bytes."""
        from src.vision.analyzer import DesignToCodeConfig, AnalysisType

        config = DesignToCodeConfig(image_bytes=b"fake image bytes")

        with patch.object(analyzer, "_get_client") as mock_get_client:
            mock_client = AsyncMock()
            mock_client.messages.create = AsyncMock(return_value=mock_response)
            mock_get_client.return_value = mock_client

            result = await analyzer.design_to_code(config)

            assert result.analysis_type == AnalysisType.CODE_GENERATION
            assert result.confidence == 0.85

    async def test_design_to_code_with_base64(self, analyzer, mock_response):
        """Test design_to_code with base64 image."""
        from src.vision.analyzer import DesignToCodeConfig
        import base64

        config = DesignToCodeConfig(
            image_base64=base64.b64encode(b"fake image").decode("utf-8")
        )

        with patch.object(analyzer, "_get_client") as mock_get_client:
            mock_client = AsyncMock()
            mock_client.messages.create = AsyncMock(return_value=mock_response)
            mock_get_client.return_value = mock_client

            result = await analyzer.design_to_code(config)

            assert result.confidence == 0.85

    async def test_design_to_code_custom_framework(self, analyzer, tmp_path):
        """Test design_to_code with custom framework."""
        from src.vision.analyzer import DesignToCodeConfig

        test_file = tmp_path / "design.png"
        test_file.write_bytes(b"fake design")

        config = DesignToCodeConfig(
            image_path=test_file,
            framework="vue",
            styling="css",
            include_responsive=False,
        )

        mock_response = MagicMock()
        mock_response.content = [MagicMock(text="<template><div>Vue</div></template>")]

        with patch.object(analyzer, "_get_client") as mock_get_client:
            mock_client = AsyncMock()
            mock_client.messages.create = AsyncMock(return_value=mock_response)
            mock_get_client.return_value = mock_client

            result = await analyzer.design_to_code(config)

            assert result.metadata["framework"] == "vue"
            assert result.metadata["styling"] == "css"
            assert result.metadata["responsive"] is False

    async def test_design_to_code_extracts_code_block(self, analyzer, tmp_path):
        """Test design_to_code extracts code from markdown."""
        from src.vision.analyzer import DesignToCodeConfig

        test_file = tmp_path / "design.png"
        test_file.write_bytes(b"fake design")

        config = DesignToCodeConfig(image_path=test_file)

        mock_response = MagicMock()
        mock_response.content = [
            MagicMock(
                text='Here is the code:\n```tsx\nfunction Component() { return <div />; }\n```\nEnjoy!'
            )
        ]

        with patch.object(analyzer, "_get_client") as mock_get_client:
            mock_client = AsyncMock()
            mock_client.messages.create = AsyncMock(return_value=mock_response)
            mock_get_client.return_value = mock_client

            result = await analyzer.design_to_code(config)

            # Should extract just the code, not the surrounding text
            assert "function Component()" in result.code
            assert "Here is the code" not in result.code

    async def test_design_to_code_api_error(self, analyzer, tmp_path):
        """Test design_to_code handles API errors."""
        from src.vision.analyzer import DesignToCodeConfig, AnalysisType

        test_file = tmp_path / "design.png"
        test_file.write_bytes(b"fake design")

        config = DesignToCodeConfig(image_path=test_file)

        with patch.object(analyzer, "_get_client") as mock_get_client:
            mock_client = AsyncMock()
            mock_client.messages.create = AsyncMock(side_effect=Exception("Rate limit"))
            mock_get_client.return_value = mock_client

            result = await analyzer.design_to_code(config)

            assert result.analysis_type == AnalysisType.CODE_GENERATION
            assert "Code generation failed" in result.description
            assert result.confidence == 0.0


class TestVisualDiff:
    """Test visual_diff method."""

    @pytest.fixture
    def analyzer(self):
        """Create analyzer instance."""
        from src.vision.analyzer import VisionAnalyzer
        return VisionAnalyzer(api_key="test-key")

    @pytest.fixture
    def mock_response(self):
        """Create mock API response."""
        mock = MagicMock()
        mock.content = [
            MagicMock(
                text='{"summary": "Button color changed", "differences": [{"type": "modified", "element": "button", "description": "Color changed from blue to green"}], "severity": "minor", "recommendations": ["Review the color change"]}'
            )
        ]
        return mock

    async def test_visual_diff_no_images(self, analyzer):
        """Test visual_diff with no images."""
        from src.vision.analyzer import VisualDiffConfig, AnalysisType

        config = VisualDiffConfig()
        result = await analyzer.visual_diff(config)

        assert result.analysis_type == AnalysisType.DIFF
        assert "Two images required" in result.description
        assert result.confidence == 0.0

    async def test_visual_diff_only_one_image(self, analyzer, tmp_path):
        """Test visual_diff with only one image."""
        from src.vision.analyzer import VisualDiffConfig, AnalysisType

        test_file = tmp_path / "image1.png"
        test_file.write_bytes(b"fake image 1")

        config = VisualDiffConfig(image1_path=test_file)
        result = await analyzer.visual_diff(config)

        assert result.analysis_type == AnalysisType.DIFF
        assert "Two images required" in result.description

    async def test_visual_diff_with_paths(self, analyzer, mock_response, tmp_path):
        """Test visual_diff with image paths."""
        from src.vision.analyzer import VisualDiffConfig, AnalysisType

        image1 = tmp_path / "before.png"
        image2 = tmp_path / "after.png"
        image1.write_bytes(b"fake image 1")
        image2.write_bytes(b"fake image 2")

        config = VisualDiffConfig(image1_path=image1, image2_path=image2)

        with patch.object(analyzer, "_get_client") as mock_get_client:
            mock_client = AsyncMock()
            mock_client.messages.create = AsyncMock(return_value=mock_response)
            mock_get_client.return_value = mock_client

            result = await analyzer.visual_diff(config)

            assert result.analysis_type == AnalysisType.DIFF
            assert result.description == "Button color changed"
            assert len(result.elements) == 1
            assert result.elements[0]["type"] == "modified"
            assert result.metadata["severity"] == "minor"
            assert result.confidence == 0.85

    async def test_visual_diff_with_bytes(self, analyzer, mock_response):
        """Test visual_diff with image bytes."""
        from src.vision.analyzer import VisualDiffConfig, AnalysisType

        config = VisualDiffConfig(
            image1_bytes=b"fake image 1",
            image2_bytes=b"fake image 2",
        )

        with patch.object(analyzer, "_get_client") as mock_get_client:
            mock_client = AsyncMock()
            mock_client.messages.create = AsyncMock(return_value=mock_response)
            mock_get_client.return_value = mock_client

            result = await analyzer.visual_diff(config)

            assert result.analysis_type == AnalysisType.DIFF
            assert result.confidence == 0.85

    async def test_visual_diff_with_base64(self, analyzer, mock_response):
        """Test visual_diff with base64 images."""
        from src.vision.analyzer import VisualDiffConfig
        import base64

        config = VisualDiffConfig(
            image1_base64=base64.b64encode(b"image1").decode("utf-8"),
            image2_base64=base64.b64encode(b"image2").decode("utf-8"),
        )

        with patch.object(analyzer, "_get_client") as mock_get_client:
            mock_client = AsyncMock()
            mock_client.messages.create = AsyncMock(return_value=mock_response)
            mock_get_client.return_value = mock_client

            result = await analyzer.visual_diff(config)

            assert result.confidence == 0.85

    async def test_visual_diff_mixed_sources(self, analyzer, mock_response, tmp_path):
        """Test visual_diff with mixed image sources."""
        from src.vision.analyzer import VisualDiffConfig

        image1 = tmp_path / "before.png"
        image1.write_bytes(b"fake image 1")

        config = VisualDiffConfig(
            image1_path=image1,
            image2_bytes=b"fake image 2",
        )

        with patch.object(analyzer, "_get_client") as mock_get_client:
            mock_client = AsyncMock()
            mock_client.messages.create = AsyncMock(return_value=mock_response)
            mock_get_client.return_value = mock_client

            result = await analyzer.visual_diff(config)

            assert result.confidence == 0.85

    async def test_visual_diff_api_error(self, analyzer, tmp_path):
        """Test visual_diff handles API errors."""
        from src.vision.analyzer import VisualDiffConfig, AnalysisType

        image1 = tmp_path / "before.png"
        image2 = tmp_path / "after.png"
        image1.write_bytes(b"fake image 1")
        image2.write_bytes(b"fake image 2")

        config = VisualDiffConfig(image1_path=image1, image2_path=image2)

        with patch.object(analyzer, "_get_client") as mock_get_client:
            mock_client = AsyncMock()
            mock_client.messages.create = AsyncMock(side_effect=Exception("API Error"))
            mock_get_client.return_value = mock_client

            result = await analyzer.visual_diff(config)

            assert result.analysis_type == AnalysisType.DIFF
            assert "Diff failed" in result.description
            assert result.confidence == 0.0

    async def test_visual_diff_invalid_json(self, analyzer, tmp_path):
        """Test visual_diff handles invalid JSON response."""
        from src.vision.analyzer import VisualDiffConfig

        image1 = tmp_path / "before.png"
        image2 = tmp_path / "after.png"
        image1.write_bytes(b"fake image 1")
        image2.write_bytes(b"fake image 2")

        config = VisualDiffConfig(image1_path=image1, image2_path=image2)

        mock_response = MagicMock()
        mock_response.content = [MagicMock(text="No significant differences found")]

        with patch.object(analyzer, "_get_client") as mock_get_client:
            mock_client = AsyncMock()
            mock_client.messages.create = AsyncMock(return_value=mock_response)
            mock_get_client.return_value = mock_client

            result = await analyzer.visual_diff(config)

            assert result.description == "No significant differences found"


class TestAnalyzeAccessibility:
    """Test analyze_accessibility method."""

    @pytest.fixture
    def analyzer(self):
        """Create analyzer instance."""
        from src.vision.analyzer import VisionAnalyzer
        return VisionAnalyzer(api_key="test-key")

    @pytest.fixture
    def mock_response(self):
        """Create mock API response."""
        mock = MagicMock()
        mock.content = [
            MagicMock(
                text='{"summary": "Good accessibility with minor issues", "issues": [{"severity": "minor", "category": "contrast", "description": "Low contrast text", "recommendation": "Increase contrast ratio"}], "score": 85, "wcag_compliance": "AA"}'
            )
        ]
        return mock

    async def test_analyze_accessibility_no_image(self, analyzer):
        """Test analyze_accessibility with no image."""
        from src.vision.analyzer import AnalysisType

        result = await analyzer.analyze_accessibility()

        assert result.analysis_type == AnalysisType.ACCESSIBILITY
        assert result.description == "No image provided"
        assert result.confidence == 0.0

    async def test_analyze_accessibility_with_path(self, analyzer, mock_response, tmp_path):
        """Test analyze_accessibility with image path."""
        from src.vision.analyzer import AnalysisType

        test_file = tmp_path / "ui.png"
        test_file.write_bytes(b"fake ui image")

        with patch.object(analyzer, "_get_client") as mock_get_client:
            mock_client = AsyncMock()
            mock_client.messages.create = AsyncMock(return_value=mock_response)
            mock_get_client.return_value = mock_client

            result = await analyzer.analyze_accessibility(image_path=test_file)

            assert result.analysis_type == AnalysisType.ACCESSIBILITY
            assert result.description == "Good accessibility with minor issues"
            assert len(result.elements) == 1
            assert result.elements[0]["severity"] == "minor"
            assert result.metadata["score"] == 85
            assert result.metadata["wcag_compliance"] == "AA"
            assert result.confidence == 0.8

    async def test_analyze_accessibility_with_bytes(self, analyzer, mock_response):
        """Test analyze_accessibility with image bytes."""
        from src.vision.analyzer import AnalysisType

        with patch.object(analyzer, "_get_client") as mock_get_client:
            mock_client = AsyncMock()
            mock_client.messages.create = AsyncMock(return_value=mock_response)
            mock_get_client.return_value = mock_client

            result = await analyzer.analyze_accessibility(image_bytes=b"fake image")

            assert result.analysis_type == AnalysisType.ACCESSIBILITY
            assert result.confidence == 0.8

    async def test_analyze_accessibility_with_base64(self, analyzer, mock_response):
        """Test analyze_accessibility with base64 image."""
        import base64

        with patch.object(analyzer, "_get_client") as mock_get_client:
            mock_client = AsyncMock()
            mock_client.messages.create = AsyncMock(return_value=mock_response)
            mock_get_client.return_value = mock_client

            result = await analyzer.analyze_accessibility(
                image_base64=base64.b64encode(b"fake").decode("utf-8")
            )

            assert result.confidence == 0.8

    async def test_analyze_accessibility_suggestions_format(self, analyzer, tmp_path):
        """Test analyze_accessibility formats suggestions correctly."""
        test_file = tmp_path / "ui.png"
        test_file.write_bytes(b"fake ui image")

        mock_response = MagicMock()
        mock_response.content = [
            MagicMock(
                text='{"summary": "Issues found", "issues": [{"severity": "critical", "category": "color", "description": "Red-green colorblind issue", "recommendation": "Use patterns"}], "score": 60, "wcag_compliance": "none"}'
            )
        ]

        with patch.object(analyzer, "_get_client") as mock_get_client:
            mock_client = AsyncMock()
            mock_client.messages.create = AsyncMock(return_value=mock_response)
            mock_get_client.return_value = mock_client

            result = await analyzer.analyze_accessibility(image_path=test_file)

            assert len(result.suggestions) == 1
            assert "[CRITICAL]" in result.suggestions[0]
            assert "color" in result.suggestions[0]
            assert "Use patterns" in result.suggestions[0]

    async def test_analyze_accessibility_api_error(self, analyzer, tmp_path):
        """Test analyze_accessibility handles API errors."""
        from src.vision.analyzer import AnalysisType

        test_file = tmp_path / "ui.png"
        test_file.write_bytes(b"fake ui image")

        with patch.object(analyzer, "_get_client") as mock_get_client:
            mock_client = AsyncMock()
            mock_client.messages.create = AsyncMock(side_effect=Exception("Timeout"))
            mock_get_client.return_value = mock_client

            result = await analyzer.analyze_accessibility(image_path=test_file)

            assert result.analysis_type == AnalysisType.ACCESSIBILITY
            assert "Analysis failed" in result.description
            assert result.confidence == 0.0

    async def test_analyze_accessibility_invalid_json(self, analyzer, tmp_path):
        """Test analyze_accessibility handles invalid JSON."""
        test_file = tmp_path / "ui.png"
        test_file.write_bytes(b"fake ui image")

        mock_response = MagicMock()
        mock_response.content = [MagicMock(text="The UI looks good overall")]

        with patch.object(analyzer, "_get_client") as mock_get_client:
            mock_client = AsyncMock()
            mock_client.messages.create = AsyncMock(return_value=mock_response)
            mock_get_client.return_value = mock_client

            result = await analyzer.analyze_accessibility(image_path=test_file)

            assert result.description == "The UI looks good overall"


class TestExtractUiElements:
    """Test extract_ui_elements method."""

    @pytest.fixture
    def analyzer(self):
        """Create analyzer instance."""
        from src.vision.analyzer import VisionAnalyzer
        return VisionAnalyzer(api_key="test-key")

    @pytest.fixture
    def mock_response(self):
        """Create mock API response."""
        mock = MagicMock()
        mock.content = [
            MagicMock(
                text='{"elements": [{"type": "button", "label": "Submit", "position": "bottom-right", "state": "normal", "interactive": true}, {"type": "input", "label": "Email", "position": "center", "state": "normal", "interactive": true}], "layout": "Form with input fields and submit button", "component_count": 2}'
            )
        ]
        return mock

    async def test_extract_ui_elements_no_image(self, analyzer):
        """Test extract_ui_elements with no image."""
        from src.vision.analyzer import AnalysisType

        result = await analyzer.extract_ui_elements()

        assert result.analysis_type == AnalysisType.UI_ELEMENTS
        assert result.description == "No image provided"
        assert result.confidence == 0.0

    async def test_extract_ui_elements_with_path(self, analyzer, mock_response, tmp_path):
        """Test extract_ui_elements with image path."""
        from src.vision.analyzer import AnalysisType

        test_file = tmp_path / "ui.png"
        test_file.write_bytes(b"fake ui image")

        with patch.object(analyzer, "_get_client") as mock_get_client:
            mock_client = AsyncMock()
            mock_client.messages.create = AsyncMock(return_value=mock_response)
            mock_get_client.return_value = mock_client

            result = await analyzer.extract_ui_elements(image_path=test_file)

            assert result.analysis_type == AnalysisType.UI_ELEMENTS
            assert result.description == "Form with input fields and submit button"
            assert len(result.elements) == 2
            assert result.elements[0]["type"] == "button"
            assert result.elements[1]["type"] == "input"
            assert result.metadata["component_count"] == 2
            assert result.confidence == 0.85

    async def test_extract_ui_elements_with_bytes(self, analyzer, mock_response):
        """Test extract_ui_elements with image bytes."""
        from src.vision.analyzer import AnalysisType

        with patch.object(analyzer, "_get_client") as mock_get_client:
            mock_client = AsyncMock()
            mock_client.messages.create = AsyncMock(return_value=mock_response)
            mock_get_client.return_value = mock_client

            result = await analyzer.extract_ui_elements(image_bytes=b"fake image")

            assert result.analysis_type == AnalysisType.UI_ELEMENTS
            assert result.confidence == 0.85

    async def test_extract_ui_elements_with_base64(self, analyzer, mock_response):
        """Test extract_ui_elements with base64 image."""
        import base64

        with patch.object(analyzer, "_get_client") as mock_get_client:
            mock_client = AsyncMock()
            mock_client.messages.create = AsyncMock(return_value=mock_response)
            mock_get_client.return_value = mock_client

            result = await analyzer.extract_ui_elements(
                image_base64=base64.b64encode(b"fake").decode("utf-8")
            )

            assert result.confidence == 0.85

    async def test_extract_ui_elements_counts_from_elements(self, analyzer, tmp_path):
        """Test extract_ui_elements computes count from elements."""
        test_file = tmp_path / "ui.png"
        test_file.write_bytes(b"fake ui image")

        mock_response = MagicMock()
        mock_response.content = [
            MagicMock(
                text='{"elements": [{"type": "button"}, {"type": "input"}, {"type": "link"}], "layout": "Navigation bar"}'
            )
        ]

        with patch.object(analyzer, "_get_client") as mock_get_client:
            mock_client = AsyncMock()
            mock_client.messages.create = AsyncMock(return_value=mock_response)
            mock_get_client.return_value = mock_client

            result = await analyzer.extract_ui_elements(image_path=test_file)

            # Should count elements when component_count not provided
            assert result.metadata["component_count"] == 3

    async def test_extract_ui_elements_api_error(self, analyzer, tmp_path):
        """Test extract_ui_elements handles API errors."""
        from src.vision.analyzer import AnalysisType

        test_file = tmp_path / "ui.png"
        test_file.write_bytes(b"fake ui image")

        with patch.object(analyzer, "_get_client") as mock_get_client:
            mock_client = AsyncMock()
            mock_client.messages.create = AsyncMock(side_effect=Exception("Connection error"))
            mock_get_client.return_value = mock_client

            result = await analyzer.extract_ui_elements(image_path=test_file)

            assert result.analysis_type == AnalysisType.UI_ELEMENTS
            assert "Extraction failed" in result.description
            assert result.confidence == 0.0

    async def test_extract_ui_elements_invalid_json(self, analyzer, tmp_path):
        """Test extract_ui_elements handles invalid JSON."""
        test_file = tmp_path / "ui.png"
        test_file.write_bytes(b"fake ui image")

        mock_response = MagicMock()
        mock_response.content = [MagicMock(text="Complex dashboard with many elements")]

        with patch.object(analyzer, "_get_client") as mock_get_client:
            mock_client = AsyncMock()
            mock_client.messages.create = AsyncMock(return_value=mock_response)
            mock_get_client.return_value = mock_client

            result = await analyzer.extract_ui_elements(image_path=test_file)

            assert result.description == "Complex dashboard with many elements"
            assert result.elements == []
