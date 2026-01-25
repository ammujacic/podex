"""Tests for web tools module.

Tests cover:
- Web tool function existence
- fetch_url, search_web, screenshot_page
- interact_with_page, extract_page_data
"""

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


class TestWebToolsModule:
    """Test web tools module exists."""

    def test_web_tools_module_exists(self):
        """Test web tools module can be imported."""
        from src.tools import web_tools
        assert web_tools is not None


class TestFetchUrl:
    """Test fetch_url function."""

    def test_fetch_url_exists(self):
        """Test fetch_url function exists."""
        from src.tools.web_tools import fetch_url
        assert fetch_url is not None
        assert callable(fetch_url)

    @pytest.mark.asyncio
    async def test_fetch_url_signature(self):
        """Test fetch_url parameter signature."""
        from src.tools.web_tools import fetch_url
        import inspect

        sig = inspect.signature(fetch_url)
        params = list(sig.parameters.keys())

        assert "url" in params


class TestSearchWeb:
    """Test search_web function."""

    def test_search_web_exists(self):
        """Test search_web function exists."""
        from src.tools.web_tools import search_web
        assert search_web is not None
        assert callable(search_web)

    @pytest.mark.asyncio
    async def test_search_web_signature(self):
        """Test search_web parameter signature."""
        from src.tools.web_tools import search_web
        import inspect

        sig = inspect.signature(search_web)
        params = list(sig.parameters.keys())

        assert "query" in params


class TestScreenshotPage:
    """Test screenshot_page function."""

    def test_screenshot_page_exists(self):
        """Test screenshot_page function exists."""
        from src.tools.web_tools import screenshot_page
        assert screenshot_page is not None
        assert callable(screenshot_page)


class TestInteractWithPage:
    """Test interact_with_page function."""

    def test_interact_with_page_exists(self):
        """Test interact_with_page function exists."""
        from src.tools.web_tools import interact_with_page
        assert interact_with_page is not None
        assert callable(interact_with_page)


class TestExtractPageData:
    """Test extract_page_data function."""

    def test_extract_page_data_exists(self):
        """Test extract_page_data function exists."""
        from src.tools.web_tools import extract_page_data
        assert extract_page_data is not None
        assert callable(extract_page_data)


class TestWebToolsHolder:
    """Test WebToolsHolder singleton class."""

    def test_holder_class_exists(self):
        """Test WebToolsHolder class exists."""
        from src.tools.web_tools import WebToolsHolder
        assert WebToolsHolder is not None

    def test_get_browser_creates_instance(self):
        """Test get_browser creates browser instance."""
        from src.tools.web_tools import WebToolsHolder

        # Reset holder state
        WebToolsHolder._browser = None

        with patch("src.tools.web_tools.Browser") as MockBrowser:
            mock_browser = MagicMock()
            MockBrowser.return_value = mock_browser

            browser = WebToolsHolder.get_browser()
            assert browser is mock_browser
            MockBrowser.assert_called_once()

        # Clean up
        WebToolsHolder._browser = None

    def test_get_browser_returns_same_instance(self):
        """Test get_browser returns same instance on subsequent calls."""
        from src.tools.web_tools import WebToolsHolder

        WebToolsHolder._browser = None

        with patch("src.tools.web_tools.Browser") as MockBrowser:
            mock_browser = MagicMock()
            MockBrowser.return_value = mock_browser

            browser1 = WebToolsHolder.get_browser()
            browser2 = WebToolsHolder.get_browser()
            assert browser1 is browser2
            MockBrowser.assert_called_once()

        WebToolsHolder._browser = None

    def test_get_scraper_creates_instance(self):
        """Test get_scraper creates scraper instance."""
        from src.tools.web_tools import WebToolsHolder

        WebToolsHolder._scraper = None

        with patch("src.tools.web_tools.ContentScraper") as MockScraper:
            mock_scraper = MagicMock()
            MockScraper.return_value = mock_scraper

            scraper = WebToolsHolder.get_scraper()
            assert scraper is mock_scraper
            MockScraper.assert_called_once()

        WebToolsHolder._scraper = None

    def test_get_search_engine_creates_instance(self):
        """Test get_search_engine creates search engine instance."""
        from src.tools.web_tools import WebToolsHolder

        WebToolsHolder._search_engine = None

        with patch("src.tools.web_tools.SearchEngine") as MockEngine:
            mock_engine = MagicMock()
            MockEngine.return_value = mock_engine

            engine = WebToolsHolder.get_search_engine()
            assert engine is mock_engine
            MockEngine.assert_called_once()

        WebToolsHolder._search_engine = None

    async def test_cleanup_browser(self):
        """Test cleanup_browser stops and clears browser."""
        from src.tools.web_tools import WebToolsHolder

        mock_browser = AsyncMock()
        WebToolsHolder._browser = mock_browser

        await WebToolsHolder.cleanup_browser()

        mock_browser.stop.assert_called_once()
        assert WebToolsHolder._browser is None


class TestFetchUrlFunction:
    """Test fetch_url function implementation."""

    async def test_fetch_url_success(self):
        """Test fetch_url with successful response."""
        import json
        from src.tools.web_tools import fetch_url, WebToolsHolder

        # Set up mock browser
        mock_browser = MagicMock()
        mock_result = MagicMock()
        mock_result.error = None
        mock_result.url = "https://example.com"
        mock_result.title = "Example"
        mock_result.status_code = 200
        mock_result.load_time_ms = 100
        mock_result.html = "<html><body>Test</body></html>"
        mock_result.content = "Test content"
        mock_browser.navigate = AsyncMock(return_value=mock_result)
        WebToolsHolder._browser = mock_browser

        # Set up mock scraper
        mock_scraper = MagicMock()
        mock_scraped = MagicMock()
        mock_scraped.text = "Scraped text"
        mock_scraped.summary = "Summary"
        mock_scraped.headings = ["H1"]
        mock_scraped.links = []
        mock_scraped.code_blocks = []
        mock_scraped.word_count = 10
        mock_scraped.metadata = {}
        mock_scraped.to_markdown.return_value = "# Markdown"
        mock_scraper.scrape.return_value = mock_scraped
        WebToolsHolder._scraper = mock_scraper

        result = await fetch_url("https://example.com")
        parsed = json.loads(result)

        assert parsed["success"] is True
        assert parsed["url"] == "https://example.com"
        assert parsed["title"] == "Example"

        # Clean up
        WebToolsHolder._browser = None
        WebToolsHolder._scraper = None

    async def test_fetch_url_navigation_error(self):
        """Test fetch_url with navigation error."""
        import json
        from src.tools.web_tools import fetch_url, WebToolsHolder

        mock_browser = MagicMock()
        mock_result = MagicMock()
        mock_result.error = "Connection failed"
        mock_browser.navigate = AsyncMock(return_value=mock_result)
        WebToolsHolder._browser = mock_browser

        result = await fetch_url("https://example.com")
        parsed = json.loads(result)

        assert parsed["success"] is False
        assert "Connection failed" in parsed["error"]

        WebToolsHolder._browser = None

    async def test_fetch_url_exception(self):
        """Test fetch_url handles exceptions."""
        import json
        from src.tools.web_tools import fetch_url, WebToolsHolder

        mock_browser = MagicMock()
        mock_browser.navigate = AsyncMock(side_effect=Exception("Network error"))
        WebToolsHolder._browser = mock_browser

        result = await fetch_url("https://example.com")
        parsed = json.loads(result)

        assert parsed["success"] is False
        assert "Network error" in parsed["error"]

        WebToolsHolder._browser = None


class TestSearchWebFunction:
    """Test search_web function implementation."""

    async def test_search_web_success(self):
        """Test search_web with successful results."""
        import json
        from src.tools.web_tools import search_web, WebToolsHolder

        mock_engine = MagicMock()
        mock_engine.search = AsyncMock(return_value=[
            {"url": "https://example.com", "title": "Example", "snippet": "A test"},
        ])
        WebToolsHolder._search_engine = mock_engine

        result = await search_web("test query")
        parsed = json.loads(result)

        assert parsed["success"] is True
        assert parsed["query"] == "test query"
        assert len(parsed["results"]) == 1

        WebToolsHolder._search_engine = None

    async def test_search_web_no_results(self):
        """Test search_web with no results."""
        import json
        from src.tools.web_tools import search_web, WebToolsHolder

        mock_engine = MagicMock()
        mock_engine.search = AsyncMock(return_value=[])
        WebToolsHolder._search_engine = mock_engine

        result = await search_web("obscure query")
        parsed = json.loads(result)

        assert parsed["success"] is True
        assert parsed["results"] == []
        assert "No results" in parsed.get("message", "")

        WebToolsHolder._search_engine = None

    async def test_search_web_exception(self):
        """Test search_web handles exceptions."""
        import json
        from src.tools.web_tools import search_web, WebToolsHolder

        mock_engine = MagicMock()
        mock_engine.search = AsyncMock(side_effect=Exception("Search failed"))
        WebToolsHolder._search_engine = mock_engine

        result = await search_web("query")
        parsed = json.loads(result)

        assert parsed["success"] is False
        assert "Search failed" in parsed["error"]

        WebToolsHolder._search_engine = None


class TestScreenshotPageFunction:
    """Test screenshot_page function implementation."""

    async def test_screenshot_page_success(self):
        """Test screenshot_page with successful capture."""
        import json
        from src.tools.web_tools import screenshot_page, WebToolsHolder

        mock_browser = MagicMock()
        nav_result = MagicMock()
        nav_result.error = None
        mock_browser.navigate = AsyncMock(return_value=nav_result)

        screenshot_result = MagicMock()
        screenshot_result.error = None
        screenshot_result.url = "https://example.com"
        screenshot_result.title = "Example"
        screenshot_result.screenshot_base64 = "base64data=="
        mock_browser.screenshot = AsyncMock(return_value=screenshot_result)
        WebToolsHolder._browser = mock_browser

        result = await screenshot_page("https://example.com")
        parsed = json.loads(result)

        assert parsed["success"] is True
        assert parsed["screenshot_base64"] == "base64data=="

        WebToolsHolder._browser = None

    async def test_screenshot_page_navigation_error(self):
        """Test screenshot_page with navigation error."""
        import json
        from src.tools.web_tools import screenshot_page, WebToolsHolder

        mock_browser = MagicMock()
        nav_result = MagicMock()
        nav_result.error = "Page not found"
        mock_browser.navigate = AsyncMock(return_value=nav_result)
        WebToolsHolder._browser = mock_browser

        result = await screenshot_page("https://example.com")
        parsed = json.loads(result)

        assert parsed["success"] is False
        assert "Page not found" in parsed["error"]

        WebToolsHolder._browser = None


class TestInteractWithPageFunction:
    """Test interact_with_page function implementation."""

    async def test_interact_click_action(self):
        """Test interact_with_page click action."""
        import json
        from src.tools.web_tools import interact_with_page, WebToolsHolder

        mock_browser = MagicMock()
        nav_result = MagicMock()
        nav_result.error = None
        mock_browser.navigate = AsyncMock(return_value=nav_result)
        mock_browser.click = AsyncMock(return_value=True)
        mock_browser.current_url = "https://example.com"
        WebToolsHolder._browser = mock_browser

        result = await interact_with_page(
            "https://example.com",
            [{"type": "click", "selector": "#button"}],
        )
        parsed = json.loads(result)

        assert parsed["success"] is True
        assert len(parsed["results"]) == 1
        assert parsed["results"][0]["type"] == "click"
        assert parsed["results"][0]["success"] is True

        WebToolsHolder._browser = None

    async def test_interact_fill_action(self):
        """Test interact_with_page fill action."""
        import json
        from src.tools.web_tools import interact_with_page, WebToolsHolder

        mock_browser = MagicMock()
        nav_result = MagicMock()
        nav_result.error = None
        mock_browser.navigate = AsyncMock(return_value=nav_result)
        mock_browser.fill = AsyncMock(return_value=True)
        mock_browser.current_url = "https://example.com"
        WebToolsHolder._browser = mock_browser

        result = await interact_with_page(
            "https://example.com",
            [{"type": "fill", "selector": "#input", "value": "test"}],
        )
        parsed = json.loads(result)

        assert parsed["success"] is True
        assert parsed["results"][0]["type"] == "fill"

        WebToolsHolder._browser = None

    async def test_interact_unknown_action(self):
        """Test interact_with_page with unknown action type."""
        import json
        from src.tools.web_tools import interact_with_page, WebToolsHolder

        mock_browser = MagicMock()
        nav_result = MagicMock()
        nav_result.error = None
        mock_browser.navigate = AsyncMock(return_value=nav_result)
        mock_browser.current_url = "https://example.com"
        WebToolsHolder._browser = mock_browser

        result = await interact_with_page(
            "https://example.com",
            [{"type": "unknown_action"}],
        )
        parsed = json.loads(result)

        assert parsed["results"][0]["success"] is False
        assert "Unknown action type" in parsed["results"][0]["error"]

        WebToolsHolder._browser = None


class TestExtractPageDataFunction:
    """Test extract_page_data function implementation."""

    async def test_extract_page_data_success(self):
        """Test extract_page_data with successful extraction."""
        import json
        from src.tools.web_tools import extract_page_data, WebToolsHolder

        mock_browser = MagicMock()
        nav_result = MagicMock()
        nav_result.error = None
        mock_browser.navigate = AsyncMock(return_value=nav_result)
        mock_browser.evaluate = AsyncMock(return_value="Extracted text")
        mock_browser.current_url = "https://example.com"
        WebToolsHolder._browser = mock_browser

        result = await extract_page_data(
            "https://example.com",
            {"title": "h1", "content": ".main"},
        )
        parsed = json.loads(result)

        assert parsed["success"] is True
        assert "data" in parsed

        WebToolsHolder._browser = None

    async def test_extract_page_data_navigation_error(self):
        """Test extract_page_data with navigation error."""
        import json
        from src.tools.web_tools import extract_page_data, WebToolsHolder

        mock_browser = MagicMock()
        nav_result = MagicMock()
        nav_result.error = "404 Not Found"
        mock_browser.navigate = AsyncMock(return_value=nav_result)
        WebToolsHolder._browser = mock_browser

        result = await extract_page_data(
            "https://example.com",
            {"title": "h1"},
        )
        parsed = json.loads(result)

        assert parsed["success"] is False
        assert "404 Not Found" in parsed["error"]

        WebToolsHolder._browser = None


class TestWebToolsDict:
    """Test WEB_TOOLS dictionary."""

    def test_web_tools_dict_exists(self):
        """Test WEB_TOOLS dict is defined."""
        from src.tools.web_tools import WEB_TOOLS

        assert WEB_TOOLS is not None
        assert isinstance(WEB_TOOLS, dict)

    def test_web_tools_contains_fetch_url(self):
        """Test WEB_TOOLS contains fetch_url."""
        from src.tools.web_tools import WEB_TOOLS

        assert "fetch_url" in WEB_TOOLS
        assert "function" in WEB_TOOLS["fetch_url"]
        assert "description" in WEB_TOOLS["fetch_url"]
        assert "parameters" in WEB_TOOLS["fetch_url"]

    def test_web_tools_contains_search_web(self):
        """Test WEB_TOOLS contains search_web."""
        from src.tools.web_tools import WEB_TOOLS

        assert "search_web" in WEB_TOOLS

    def test_web_tools_contains_screenshot_page(self):
        """Test WEB_TOOLS contains screenshot_page."""
        from src.tools.web_tools import WEB_TOOLS

        assert "screenshot_page" in WEB_TOOLS

    def test_web_tools_contains_interact_with_page(self):
        """Test WEB_TOOLS contains interact_with_page."""
        from src.tools.web_tools import WEB_TOOLS

        assert "interact_with_page" in WEB_TOOLS

    def test_web_tools_contains_extract_page_data(self):
        """Test WEB_TOOLS contains extract_page_data."""
        from src.tools.web_tools import WEB_TOOLS

        assert "extract_page_data" in WEB_TOOLS


class TestCleanupBrowserFunction:
    """Test cleanup_browser function."""

    async def test_cleanup_browser_calls_holder(self):
        """Test cleanup_browser calls WebToolsHolder.cleanup_browser."""
        from src.tools.web_tools import cleanup_browser, WebToolsHolder

        mock_browser = AsyncMock()
        WebToolsHolder._browser = mock_browser

        await cleanup_browser()

        mock_browser.stop.assert_called_once()
        assert WebToolsHolder._browser is None
