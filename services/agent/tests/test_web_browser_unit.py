"""Tests for web browser module.

Tests cover:
- Browser class initialization
- BrowserConfig dataclass
- PageResult dataclass
- Browser methods with mocked playwright
"""

import base64
from datetime import datetime, UTC
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


class TestWebBrowserModule:
    """Test web browser module exists."""

    def test_web_browser_module_exists(self):
        """Test web browser module can be imported."""
        from src.web import browser
        assert browser is not None


class TestBrowserConfigDataclass:
    """Test BrowserConfig dataclass."""

    def test_browser_config_exists(self):
        """Test BrowserConfig exists."""
        from src.web.browser import BrowserConfig
        assert BrowserConfig is not None

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
            proxy="http://proxy:8080",
            ignore_https_errors=True,
            java_script_enabled=False,
        )

        assert config.headless is False
        assert config.timeout == 60000
        assert config.viewport_width == 1920
        assert config.viewport_height == 1080
        assert config.user_agent == "Custom Agent"
        assert config.proxy == "http://proxy:8080"
        assert config.ignore_https_errors is True
        assert config.java_script_enabled is False


class TestPageResultDataclass:
    """Test PageResult dataclass."""

    def test_page_result_exists(self):
        """Test PageResult exists."""
        from src.web.browser import PageResult
        assert PageResult is not None

    def test_page_result_creation(self):
        """Test PageResult creation."""
        from src.web.browser import PageResult

        result = PageResult(
            url="https://example.com",
            title="Example",
            content="Hello World",
            html="<html><body>Hello World</body></html>",
        )

        assert result.url == "https://example.com"
        assert result.title == "Example"
        assert result.content == "Hello World"
        assert result.html == "<html><body>Hello World</body></html>"

    def test_page_result_defaults(self):
        """Test PageResult default values."""
        from src.web.browser import PageResult

        result = PageResult(
            url="https://test.com",
            title="Test",
            content="Content",
            html="<html></html>",
        )

        assert result.status_code is None
        assert result.headers == {}
        assert result.screenshot is None
        assert result.screenshot_base64 is None
        assert result.error is None
        assert result.load_time_ms == 0
        assert isinstance(result.timestamp, datetime)

    def test_page_result_with_all_fields(self):
        """Test PageResult with all fields."""
        from src.web.browser import PageResult

        screenshot_data = b"fake screenshot data"
        result = PageResult(
            url="https://example.com",
            title="Example",
            content="Content",
            html="<html></html>",
            status_code=200,
            headers={"Content-Type": "text/html"},
            screenshot=screenshot_data,
            screenshot_base64=base64.b64encode(screenshot_data).decode("utf-8"),
            error=None,
            load_time_ms=500,
        )

        assert result.status_code == 200
        assert result.headers["Content-Type"] == "text/html"
        assert result.screenshot == screenshot_data
        assert result.load_time_ms == 500

    def test_page_result_to_dict(self):
        """Test PageResult to_dict method."""
        from src.web.browser import PageResult

        result = PageResult(
            url="https://example.com",
            title="Example",
            content="Test content",
            html="<html></html>",
            status_code=200,
            load_time_ms=100,
            screenshot=b"screenshot",
        )

        data = result.to_dict()

        assert data["url"] == "https://example.com"
        assert data["title"] == "Example"
        assert data["content"] == "Test content"
        assert data["status_code"] == 200
        assert data["load_time_ms"] == 100
        assert data["has_screenshot"] is True
        assert data["error"] is None
        assert "timestamp" in data

    def test_page_result_to_dict_truncates_content(self):
        """Test PageResult to_dict truncates long content."""
        from src.web.browser import PageResult

        long_content = "x" * 10000
        result = PageResult(
            url="https://example.com",
            title="Example",
            content=long_content,
            html="<html></html>",
        )

        data = result.to_dict()

        assert len(data["content"]) == 5000

    def test_page_result_to_dict_empty_content(self):
        """Test PageResult to_dict with empty content."""
        from src.web.browser import PageResult

        result = PageResult(
            url="https://example.com",
            title="Example",
            content="",
            html="<html></html>",
        )

        data = result.to_dict()

        assert data["content"] == ""


class TestBrowserClass:
    """Test Browser class."""

    def test_browser_class_exists(self):
        """Test Browser class exists."""
        from src.web.browser import Browser
        assert Browser is not None


class TestBrowserInit:
    """Test Browser initialization."""

    def test_browser_initialization(self):
        """Test Browser can be instantiated."""
        from src.web.browser import Browser

        browser = Browser()
        assert browser is not None
        assert browser._initialized is False

    def test_browser_with_config(self):
        """Test Browser with custom config."""
        from src.web.browser import Browser, BrowserConfig

        config = BrowserConfig(headless=False, timeout=60000)
        browser = Browser(config=config)

        assert browser._config.headless is False
        assert browser._config.timeout == 60000

    def test_browser_default_config(self):
        """Test Browser creates default config."""
        from src.web.browser import Browser

        browser = Browser()

        assert browser._config.headless is True
        assert browser._config.timeout == 30000

    def test_browser_has_start_method(self):
        """Test Browser has start method."""
        from src.web.browser import Browser

        browser = Browser()
        assert hasattr(browser, "start")

    def test_browser_has_stop_method(self):
        """Test Browser has stop method."""
        from src.web.browser import Browser

        browser = Browser()
        assert hasattr(browser, "stop")

    def test_browser_has_navigate_method(self):
        """Test Browser has navigate method."""
        from src.web.browser import Browser

        browser = Browser()
        assert hasattr(browser, "navigate")

    def test_browser_has_screenshot_method(self):
        """Test Browser has screenshot method."""
        from src.web.browser import Browser

        browser = Browser()
        assert hasattr(browser, "screenshot")

    def test_browser_has_click_method(self):
        """Test Browser has click method."""
        from src.web.browser import Browser

        browser = Browser()
        assert hasattr(browser, "click")

    def test_browser_has_fill_method(self):
        """Test Browser has fill method."""
        from src.web.browser import Browser

        browser = Browser()
        assert hasattr(browser, "fill")

    def test_browser_has_evaluate_method(self):
        """Test Browser has evaluate method."""
        from src.web.browser import Browser

        browser = Browser()
        assert hasattr(browser, "evaluate")


class TestBrowserStart:
    """Test Browser start method."""

    async def test_start_playwright_not_available(self):
        """Test start returns False when playwright not available."""
        from src.web.browser import Browser

        with patch("src.web.browser._PLAYWRIGHT_AVAILABLE", False):
            browser = Browser()
            result = await browser.start()

            assert result is False
            assert browser._initialized is False

    async def test_start_success(self):
        """Test start succeeds with mocked playwright."""
        from src.web.browser import Browser

        # Create mock objects
        mock_playwright_instance = MagicMock()
        mock_browser = AsyncMock()
        mock_context = AsyncMock()
        mock_page = MagicMock()

        mock_playwright_instance.chromium.launch = AsyncMock(return_value=mock_browser)
        mock_browser.new_context = AsyncMock(return_value=mock_context)
        mock_context.new_page = AsyncMock(return_value=mock_page)
        mock_page.set_default_timeout = MagicMock()

        # Create async context manager mock
        mock_async_playwright = MagicMock()
        mock_async_playwright.start = AsyncMock(return_value=mock_playwright_instance)

        with patch("src.web.browser._PLAYWRIGHT_AVAILABLE", True):
            with patch.dict("sys.modules", {"playwright.async_api": MagicMock()}):
                import src.web.browser as browser_module
                # Directly mock at module level by setting the function
                original = getattr(browser_module, 'async_playwright', None)
                browser_module.async_playwright = MagicMock(return_value=mock_async_playwright)
                try:
                    browser = Browser()
                    result = await browser.start()

                    assert result is True
                    assert browser._initialized is True
                finally:
                    if original:
                        browser_module.async_playwright = original

    async def test_start_with_proxy_config(self):
        """Test start with proxy in config (simulated)."""
        from src.web.browser import Browser, BrowserConfig

        config = BrowserConfig(proxy="http://proxy:8080")
        browser = Browser(config=config)

        # Verify config is set correctly
        assert browser._config.proxy == "http://proxy:8080"

    async def test_start_with_user_agent_config(self):
        """Test start with user agent in config."""
        from src.web.browser import Browser, BrowserConfig

        config = BrowserConfig(user_agent="Custom Agent/1.0")
        browser = Browser(config=config)

        assert browser._config.user_agent == "Custom Agent/1.0"

    async def test_start_failure_playwright_available(self):
        """Test start handles errors when playwright available."""
        from src.web.browser import Browser

        # Create mock that raises exception
        mock_async_playwright = MagicMock()
        mock_async_playwright.start = AsyncMock(side_effect=Exception("Launch failed"))

        with patch("src.web.browser._PLAYWRIGHT_AVAILABLE", True):
            with patch.dict("sys.modules", {"playwright.async_api": MagicMock()}):
                import src.web.browser as browser_module
                original = getattr(browser_module, 'async_playwright', None)
                browser_module.async_playwright = MagicMock(return_value=mock_async_playwright)
                try:
                    browser = Browser()
                    result = await browser.start()

                    assert result is False
                    assert browser._initialized is False
                finally:
                    if original:
                        browser_module.async_playwright = original


class TestBrowserStop:
    """Test Browser stop method."""

    async def test_stop_not_initialized(self):
        """Test stop when not initialized."""
        from src.web.browser import Browser

        browser = Browser()
        # Should not raise
        await browser.stop()

    async def test_stop_success(self):
        """Test stop closes all resources."""
        from src.web.browser import Browser

        browser = Browser()
        browser._initialized = True
        browser._context = AsyncMock()
        browser._browser = AsyncMock()
        browser._playwright = AsyncMock()

        await browser.stop()

        browser._context.close.assert_called_once()
        browser._browser.close.assert_called_once()
        browser._playwright.stop.assert_called_once()
        assert browser._initialized is False

    async def test_stop_handles_errors(self):
        """Test stop handles errors gracefully."""
        from src.web.browser import Browser

        browser = Browser()
        browser._initialized = True
        browser._context = AsyncMock()
        browser._context.close = AsyncMock(side_effect=Exception("Close failed"))

        # Should not raise
        await browser.stop()


class TestBrowserNavigate:
    """Test Browser navigate method."""

    @pytest.fixture
    def mock_browser(self):
        """Create a browser with mocked internals."""
        from src.web.browser import Browser

        browser = Browser()
        browser._initialized = True
        browser._page = AsyncMock()
        return browser

    async def test_navigate_not_initialized_starts_browser(self):
        """Test navigate starts browser if not initialized."""
        from src.web.browser import Browser

        browser = Browser()
        browser._initialized = False

        # Mock start to fail
        browser.start = AsyncMock(return_value=False)

        result = await browser.navigate("https://example.com")

        assert result.error is not None
        assert "Browser not available" in result.error

    async def test_navigate_success(self, mock_browser):
        """Test navigate succeeds."""
        mock_response = MagicMock()
        mock_response.status = 200
        mock_response.headers = {"Content-Type": "text/html"}

        mock_browser._page.goto = AsyncMock(return_value=mock_response)
        mock_browser._page.title = AsyncMock(return_value="Example Page")
        mock_browser._page.content = AsyncMock(return_value="<html><body>Hello</body></html>")
        mock_browser._page.evaluate = AsyncMock(return_value="Hello")
        mock_browser._page.url = "https://example.com"

        result = await mock_browser.navigate("https://example.com")

        assert result.url == "https://example.com"
        assert result.title == "Example Page"
        assert result.content == "Hello"
        assert result.status_code == 200
        assert result.error is None

    async def test_navigate_with_screenshot(self, mock_browser):
        """Test navigate with screenshot capture."""
        mock_response = MagicMock()
        mock_response.status = 200
        mock_response.headers = {}

        screenshot_data = b"fake screenshot"
        mock_browser._page.goto = AsyncMock(return_value=mock_response)
        mock_browser._page.title = AsyncMock(return_value="Test")
        mock_browser._page.content = AsyncMock(return_value="<html></html>")
        mock_browser._page.evaluate = AsyncMock(return_value="")
        mock_browser._page.screenshot = AsyncMock(return_value=screenshot_data)
        mock_browser._page.url = "https://example.com"

        result = await mock_browser.navigate(
            "https://example.com",
            capture_screenshot=True,
        )

        assert result.screenshot == screenshot_data
        assert result.screenshot_base64 == base64.b64encode(screenshot_data).decode("utf-8")

    async def test_navigate_with_wait_for(self, mock_browser):
        """Test navigate with custom wait condition."""
        mock_response = MagicMock()
        mock_response.status = 200
        mock_response.headers = {}

        mock_browser._page.goto = AsyncMock(return_value=mock_response)
        mock_browser._page.title = AsyncMock(return_value="Test")
        mock_browser._page.content = AsyncMock(return_value="<html></html>")
        mock_browser._page.evaluate = AsyncMock(return_value="")
        mock_browser._page.url = "https://example.com"

        await mock_browser.navigate("https://example.com", wait_for="networkidle")

        mock_browser._page.goto.assert_called_once_with(
            "https://example.com",
            wait_until="networkidle",
        )

    async def test_navigate_error(self, mock_browser):
        """Test navigate handles errors."""
        mock_browser._page.goto = AsyncMock(side_effect=Exception("Navigation failed"))

        result = await mock_browser.navigate("https://example.com")

        assert result.error is not None
        assert "Navigation failed" in result.error


class TestBrowserScreenshot:
    """Test Browser screenshot method."""

    @pytest.fixture
    def mock_browser(self):
        """Create a browser with mocked internals."""
        from src.web.browser import Browser

        browser = Browser()
        browser._initialized = True
        browser._page = AsyncMock()
        browser._page.url = "https://example.com"
        return browser

    async def test_screenshot_not_initialized(self):
        """Test screenshot when not initialized."""
        from src.web.browser import Browser

        browser = Browser()
        browser._initialized = False

        result = await browser.screenshot()

        assert result.error == "Browser not initialized"

    async def test_screenshot_success(self, mock_browser):
        """Test screenshot succeeds."""
        screenshot_data = b"fake screenshot"
        mock_browser._page.screenshot = AsyncMock(return_value=screenshot_data)
        mock_browser._page.title = AsyncMock(return_value="Test Page")

        result = await mock_browser.screenshot()

        assert result.screenshot == screenshot_data
        assert result.screenshot_base64 == base64.b64encode(screenshot_data).decode("utf-8")
        assert result.title == "Test Page"

    async def test_screenshot_with_url(self, mock_browser):
        """Test screenshot navigates to URL first."""
        screenshot_data = b"fake screenshot"

        # Mock navigate
        mock_response = MagicMock()
        mock_response.status = 200
        mock_response.headers = {}
        mock_browser._page.goto = AsyncMock(return_value=mock_response)
        mock_browser._page.title = AsyncMock(return_value="Test")
        mock_browser._page.content = AsyncMock(return_value="<html></html>")
        mock_browser._page.evaluate = AsyncMock(return_value="")
        mock_browser._page.screenshot = AsyncMock(return_value=screenshot_data)

        result = await mock_browser.screenshot(url="https://example.com")

        mock_browser._page.goto.assert_called_once()
        assert result.screenshot == screenshot_data

    async def test_screenshot_full_page(self, mock_browser):
        """Test full page screenshot."""
        screenshot_data = b"fake screenshot"
        mock_browser._page.screenshot = AsyncMock(return_value=screenshot_data)
        mock_browser._page.title = AsyncMock(return_value="Test")

        await mock_browser.screenshot(full_page=True)

        mock_browser._page.screenshot.assert_called_once()
        call_kwargs = mock_browser._page.screenshot.call_args.kwargs
        assert call_kwargs["full_page"] is True

    async def test_screenshot_with_output_path(self, mock_browser, tmp_path):
        """Test screenshot with output path."""
        screenshot_data = b"fake screenshot"
        mock_browser._page.screenshot = AsyncMock(return_value=screenshot_data)
        mock_browser._page.title = AsyncMock(return_value="Test")

        output_path = str(tmp_path / "screenshot.png")
        await mock_browser.screenshot(output_path=output_path)

        mock_browser._page.screenshot.assert_called_once()
        call_kwargs = mock_browser._page.screenshot.call_args.kwargs
        assert call_kwargs["path"] == output_path

    async def test_screenshot_error(self, mock_browser):
        """Test screenshot handles errors."""
        mock_browser._page.screenshot = AsyncMock(side_effect=Exception("Screenshot failed"))

        result = await mock_browser.screenshot()

        assert result.error is not None
        assert "Screenshot failed" in result.error


class TestBrowserClick:
    """Test Browser click method."""

    @pytest.fixture
    def mock_browser(self):
        """Create a browser with mocked internals."""
        from src.web.browser import Browser

        browser = Browser()
        browser._initialized = True
        browser._page = AsyncMock()
        return browser

    async def test_click_not_initialized(self):
        """Test click when not initialized."""
        from src.web.browser import Browser

        browser = Browser()
        browser._initialized = False

        result = await browser.click("button")

        assert result is False

    async def test_click_success(self, mock_browser):
        """Test click succeeds."""
        mock_browser._page.click = AsyncMock()

        result = await mock_browser.click("button.submit")

        assert result is True
        mock_browser._page.click.assert_called_once_with("button.submit")

    async def test_click_error(self, mock_browser):
        """Test click handles errors."""
        mock_browser._page.click = AsyncMock(side_effect=Exception("Element not found"))

        result = await mock_browser.click("button")

        assert result is False


class TestBrowserFill:
    """Test Browser fill method."""

    @pytest.fixture
    def mock_browser(self):
        """Create a browser with mocked internals."""
        from src.web.browser import Browser

        browser = Browser()
        browser._initialized = True
        browser._page = AsyncMock()
        return browser

    async def test_fill_not_initialized(self):
        """Test fill when not initialized."""
        from src.web.browser import Browser

        browser = Browser()
        browser._initialized = False

        result = await browser.fill("input", "value")

        assert result is False

    async def test_fill_success(self, mock_browser):
        """Test fill succeeds."""
        mock_browser._page.fill = AsyncMock()

        result = await mock_browser.fill("input#email", "test@example.com")

        assert result is True
        mock_browser._page.fill.assert_called_once_with("input#email", "test@example.com")

    async def test_fill_error(self, mock_browser):
        """Test fill handles errors."""
        mock_browser._page.fill = AsyncMock(side_effect=Exception("Element not found"))

        result = await mock_browser.fill("input", "value")

        assert result is False


class TestBrowserEvaluate:
    """Test Browser evaluate method."""

    @pytest.fixture
    def mock_browser(self):
        """Create a browser with mocked internals."""
        from src.web.browser import Browser

        browser = Browser()
        browser._initialized = True
        browser._page = AsyncMock()
        return browser

    async def test_evaluate_not_initialized(self):
        """Test evaluate when not initialized."""
        from src.web.browser import Browser

        browser = Browser()
        browser._initialized = False

        result = await browser.evaluate("return 1 + 1")

        assert result is None

    async def test_evaluate_success(self, mock_browser):
        """Test evaluate succeeds."""
        mock_browser._page.evaluate = AsyncMock(return_value=42)

        result = await mock_browser.evaluate("return 21 * 2")

        assert result == 42
        mock_browser._page.evaluate.assert_called_once_with("return 21 * 2")

    async def test_evaluate_returns_object(self, mock_browser):
        """Test evaluate returns complex objects."""
        mock_browser._page.evaluate = AsyncMock(return_value={"key": "value"})

        result = await mock_browser.evaluate("return {key: 'value'}")

        assert result == {"key": "value"}

    async def test_evaluate_error(self, mock_browser):
        """Test evaluate handles errors."""
        mock_browser._page.evaluate = AsyncMock(side_effect=Exception("Script error"))

        result = await mock_browser.evaluate("invalid script")

        assert result is None


class TestBrowserWaitForSelector:
    """Test Browser wait_for_selector method."""

    @pytest.fixture
    def mock_browser(self):
        """Create a browser with mocked internals."""
        from src.web.browser import Browser, BrowserConfig

        config = BrowserConfig(timeout=5000)
        browser = Browser(config=config)
        browser._initialized = True
        browser._page = AsyncMock()
        return browser

    async def test_wait_for_selector_not_initialized(self):
        """Test wait_for_selector when not initialized."""
        from src.web.browser import Browser

        browser = Browser()
        browser._initialized = False

        result = await browser.wait_for_selector("div")

        assert result is False

    async def test_wait_for_selector_success(self, mock_browser):
        """Test wait_for_selector succeeds."""
        mock_browser._page.wait_for_selector = AsyncMock()

        result = await mock_browser.wait_for_selector("div.loaded")

        assert result is True
        mock_browser._page.wait_for_selector.assert_called_once()

    async def test_wait_for_selector_with_timeout(self, mock_browser):
        """Test wait_for_selector with custom timeout."""
        mock_browser._page.wait_for_selector = AsyncMock()

        await mock_browser.wait_for_selector("div", timeout=10000)

        mock_browser._page.wait_for_selector.assert_called_once_with("div", timeout=10000)

    async def test_wait_for_selector_uses_default_timeout(self, mock_browser):
        """Test wait_for_selector uses config timeout."""
        mock_browser._page.wait_for_selector = AsyncMock()

        await mock_browser.wait_for_selector("div")

        mock_browser._page.wait_for_selector.assert_called_once_with("div", timeout=5000)

    async def test_wait_for_selector_timeout(self, mock_browser):
        """Test wait_for_selector handles timeout."""
        mock_browser._page.wait_for_selector = AsyncMock(side_effect=Exception("Timeout"))

        result = await mock_browser.wait_for_selector("div.never-appears")

        assert result is False


class TestBrowserCookies:
    """Test Browser cookie methods."""

    @pytest.fixture
    def mock_browser(self):
        """Create a browser with mocked internals."""
        from src.web.browser import Browser

        browser = Browser()
        browser._initialized = True
        browser._context = AsyncMock()
        return browser

    async def test_get_cookies_no_context(self):
        """Test get_cookies when context not available."""
        from src.web.browser import Browser

        browser = Browser()
        browser._context = None

        result = await browser.get_cookies()

        assert result == []

    async def test_get_cookies_success(self, mock_browser):
        """Test get_cookies succeeds."""
        cookies = [{"name": "session", "value": "abc123"}]
        mock_browser._context.cookies = AsyncMock(return_value=cookies)

        result = await mock_browser.get_cookies()

        assert result == cookies

    async def test_set_cookies_no_context(self):
        """Test set_cookies when context not available."""
        from src.web.browser import Browser

        browser = Browser()
        browser._context = None

        # Should not raise
        await browser.set_cookies([{"name": "test", "value": "value"}])

    async def test_set_cookies_success(self, mock_browser):
        """Test set_cookies succeeds."""
        cookies = [{"name": "session", "value": "abc123", "domain": "example.com"}]
        mock_browser._context.add_cookies = AsyncMock()

        await mock_browser.set_cookies(cookies)

        mock_browser._context.add_cookies.assert_called_once_with(cookies)

    async def test_clear_cookies_no_context(self):
        """Test clear_cookies when context not available."""
        from src.web.browser import Browser

        browser = Browser()
        browser._context = None

        # Should not raise
        await browser.clear_cookies()

    async def test_clear_cookies_success(self, mock_browser):
        """Test clear_cookies succeeds."""
        mock_browser._context.clear_cookies = AsyncMock()

        await mock_browser.clear_cookies()

        mock_browser._context.clear_cookies.assert_called_once()


class TestBrowserCurrentUrl:
    """Test Browser current_url property."""

    def test_current_url_no_page(self):
        """Test current_url when page not available."""
        from src.web.browser import Browser

        browser = Browser()
        browser._page = None

        assert browser.current_url is None

    def test_current_url_success(self):
        """Test current_url returns page URL."""
        from src.web.browser import Browser

        browser = Browser()
        browser._page = MagicMock()
        browser._page.url = "https://example.com/page"

        assert browser.current_url == "https://example.com/page"


class TestBrowserContextManager:
    """Test Browser async context manager."""

    async def test_context_manager_enter(self):
        """Test async context manager enter."""
        from src.web.browser import Browser

        browser = Browser()
        browser.start = AsyncMock(return_value=True)

        result = await browser.__aenter__()

        assert result is browser
        browser.start.assert_called_once()

    async def test_context_manager_exit(self):
        """Test async context manager exit."""
        from src.web.browser import Browser

        browser = Browser()
        browser.stop = AsyncMock()

        await browser.__aexit__(None, None, None)

        browser.stop.assert_called_once()

    async def test_context_manager_exit_with_exception(self):
        """Test async context manager exit with exception."""
        from src.web.browser import Browser

        browser = Browser()
        browser.stop = AsyncMock()

        await browser.__aexit__(ValueError, ValueError("test"), None)

        browser.stop.assert_called_once()
