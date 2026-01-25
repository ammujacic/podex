"""Tests for web modules.

Tests cover:
- Browser automation (dataclasses and basic functionality)
- Web scraper
"""

import pytest
from datetime import datetime, UTC
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch


class TestBrowserConfigDataclass:
    """Test BrowserConfig dataclass."""

    def test_browser_config_defaults(self):
        """Test BrowserConfig default values."""
        from src.web.browser import BrowserConfig

        config = BrowserConfig()

        assert config.headless is True
        assert config.timeout == 30000
        assert config.viewport_width == 1280
        assert config.viewport_height == 720
        assert config.user_agent is None
        assert config.proxy is None
        assert config.ignore_https_errors is False
        assert config.java_script_enabled is True

    def test_browser_config_custom_values(self):
        """Test BrowserConfig with custom values."""
        from src.web.browser import BrowserConfig

        config = BrowserConfig(
            headless=False,
            timeout=60000,
            viewport_width=1920,
            viewport_height=1080,
            user_agent="Custom Agent",
            proxy="http://proxy.example.com",
            ignore_https_errors=True,
            java_script_enabled=False,
        )

        assert config.headless is False
        assert config.timeout == 60000
        assert config.viewport_width == 1920
        assert config.viewport_height == 1080
        assert config.user_agent == "Custom Agent"
        assert config.proxy == "http://proxy.example.com"
        assert config.ignore_https_errors is True
        assert config.java_script_enabled is False


class TestPageResultDataclass:
    """Test PageResult dataclass."""

    def test_page_result_basic(self):
        """Test PageResult with basic fields."""
        from src.web.browser import PageResult

        result = PageResult(
            url="https://example.com",
            title="Example Page",
            content="Hello world",
            html="<html><body>Hello world</body></html>",
        )

        assert result.url == "https://example.com"
        assert result.title == "Example Page"
        assert result.content == "Hello world"
        assert result.html == "<html><body>Hello world</body></html>"
        assert result.status_code is None
        assert result.headers == {}
        assert result.screenshot is None
        assert result.error is None
        assert result.load_time_ms == 0
        assert result.timestamp is not None

    def test_page_result_with_all_fields(self):
        """Test PageResult with all fields set."""
        from src.web.browser import PageResult

        screenshot_data = b"PNG screenshot data"
        result = PageResult(
            url="https://example.com",
            title="Example Page",
            content="Content",
            html="<html></html>",
            status_code=200,
            headers={"content-type": "text/html"},
            screenshot=screenshot_data,
            screenshot_base64="UE5HIHNjcmVlbnNob3Q=",
            error=None,
            load_time_ms=1500,
        )

        assert result.status_code == 200
        assert result.headers == {"content-type": "text/html"}
        assert result.screenshot == screenshot_data
        assert result.screenshot_base64 == "UE5HIHNjcmVlbnNob3Q="
        assert result.load_time_ms == 1500

    def test_page_result_to_dict(self):
        """Test PageResult to_dict method."""
        from src.web.browser import PageResult

        result = PageResult(
            url="https://example.com",
            title="Test",
            content="Short content",
            html="<html></html>",
            status_code=200,
            load_time_ms=500,
            screenshot=b"data",
        )

        result_dict = result.to_dict()

        assert result_dict["url"] == "https://example.com"
        assert result_dict["title"] == "Test"
        assert result_dict["content"] == "Short content"
        assert result_dict["status_code"] == 200
        assert result_dict["load_time_ms"] == 500
        assert result_dict["has_screenshot"] is True
        assert "timestamp" in result_dict

    def test_page_result_to_dict_truncates_long_content(self):
        """Test PageResult to_dict truncates long content."""
        from src.web.browser import PageResult

        long_content = "x" * 10000  # 10K characters
        result = PageResult(
            url="https://example.com",
            title="Test",
            content=long_content,
            html="<html></html>",
        )

        result_dict = result.to_dict()

        assert len(result_dict["content"]) == 5000  # Truncated to 5000

    def test_page_result_to_dict_no_screenshot(self):
        """Test PageResult to_dict with no screenshot."""
        from src.web.browser import PageResult

        result = PageResult(
            url="https://example.com",
            title="Test",
            content="Content",
            html="<html></html>",
        )

        result_dict = result.to_dict()
        assert result_dict["has_screenshot"] is False


class TestBrowserClass:
    """Test Browser class."""

    def test_browser_module_exists(self):
        """Test browser module can be imported."""
        from src.web import browser
        assert browser is not None

    def test_browser_class_exists(self):
        """Test Browser class exists."""
        from src.web.browser import Browser
        assert Browser is not None

    def test_browser_initialization_no_config(self):
        """Test Browser initialization without config."""
        from src.web.browser import Browser

        browser = Browser()
        assert browser is not None

    def test_browser_initialization_with_config(self):
        """Test Browser initialization with config."""
        from src.web.browser import Browser, BrowserConfig

        config = BrowserConfig(headless=False, timeout=60000)
        browser = Browser(config=config)

        assert browser is not None


class TestWebScraperModule:
    """Test web scraper module."""

    def test_scraper_module_exists(self):
        """Test scraper module can be imported."""
        from src.web import scraper
        assert scraper is not None

    def test_content_scraper_class_exists(self):
        """Test ContentScraper class exists."""
        from src.web.scraper import ContentScraper
        assert ContentScraper is not None

    def test_scraped_content_dataclass_exists(self):
        """Test ScrapedContent dataclass exists."""
        from src.web.scraper import ScrapedContent
        assert ScrapedContent is not None

    def test_search_engine_class_exists(self):
        """Test SearchEngine class exists."""
        from src.web.scraper import SearchEngine
        assert SearchEngine is not None


class TestPlaywrightAvailability:
    """Test Playwright availability check."""

    def test_playwright_available_constant(self):
        """Test _PLAYWRIGHT_AVAILABLE constant exists."""
        from src.web.browser import _PLAYWRIGHT_AVAILABLE
        # Just test it exists and is a boolean
        assert isinstance(_PLAYWRIGHT_AVAILABLE, bool)


class TestWebModule:
    """Test web module __init__."""

    def test_web_module_exists(self):
        """Test web module can be imported."""
        from src import web
        assert web is not None
