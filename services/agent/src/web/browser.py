"""Browser automation using Playwright for web interactions."""

import asyncio
import base64
import importlib.util
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

import structlog

# Check if playwright is available
_PLAYWRIGHT_AVAILABLE = importlib.util.find_spec("playwright") is not None

if _PLAYWRIGHT_AVAILABLE:
    from playwright.async_api import async_playwright

logger = structlog.get_logger()


@dataclass
class BrowserConfig:
    """Configuration for browser instances."""

    headless: bool = True
    timeout: int = 30000  # 30 seconds
    viewport_width: int = 1280
    viewport_height: int = 720
    user_agent: str | None = None
    proxy: str | None = None
    ignore_https_errors: bool = False
    java_script_enabled: bool = True


@dataclass
class PageResult:
    """Result from a page operation."""

    url: str
    title: str
    content: str
    html: str
    status_code: int | None = None
    headers: dict[str, str] = field(default_factory=dict)
    screenshot: bytes | None = None
    screenshot_base64: str | None = None
    error: str | None = None
    load_time_ms: int = 0
    timestamp: datetime = field(default_factory=lambda: datetime.now(UTC))

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary."""
        return {
            "url": self.url,
            "title": self.title,
            "content": self.content[:5000] if self.content else "",  # Truncate for context
            "status_code": self.status_code,
            "error": self.error,
            "load_time_ms": self.load_time_ms,
            "has_screenshot": self.screenshot is not None,
            "timestamp": self.timestamp.isoformat(),
        }


class Browser:
    """Playwright-based browser for web automation.

    Features:
    - Page navigation and content extraction
    - Screenshot capture
    - Form interaction
    - JavaScript execution
    - Cookie and session management
    """

    def __init__(self, config: BrowserConfig | None = None) -> None:
        """Initialize browser.

        Args:
            config: Browser configuration
        """
        self._config = config or BrowserConfig()
        self._playwright: Any = None
        self._browser: Any = None
        self._context: Any = None
        self._page: Any = None
        self._initialized = False

    async def start(self) -> bool:
        """Start the browser instance.

        Returns:
            True if started successfully
        """
        if not _PLAYWRIGHT_AVAILABLE:
            logger.warning("Playwright not installed. Browser features unavailable.")
            return False

        try:
            self._playwright = await async_playwright().start()

            # Launch browser
            launch_options: dict[str, Any] = {
                "headless": self._config.headless,
            }

            if self._config.proxy:
                launch_options["proxy"] = {"server": self._config.proxy}

            self._browser = await self._playwright.chromium.launch(**launch_options)

            # Create context
            context_options: dict[str, Any] = {
                "viewport": {
                    "width": self._config.viewport_width,
                    "height": self._config.viewport_height,
                },
                "ignore_https_errors": self._config.ignore_https_errors,
                "java_script_enabled": self._config.java_script_enabled,
            }

            if self._config.user_agent:
                context_options["user_agent"] = self._config.user_agent

            self._context = await self._browser.new_context(**context_options)
            self._page = await self._context.new_page()
            self._page.set_default_timeout(self._config.timeout)

            self._initialized = True
            logger.info("Browser started", headless=self._config.headless)
            return True

        except Exception as e:
            logger.error("Failed to start browser", error=str(e))
            return False

    async def stop(self) -> None:
        """Stop the browser instance."""
        try:
            if self._context:
                await self._context.close()
            if self._browser:
                await self._browser.close()
            if self._playwright:
                await self._playwright.stop()

            self._initialized = False
            logger.info("Browser stopped")

        except Exception as e:
            logger.error("Error stopping browser", error=str(e))

    async def navigate(
        self,
        url: str,
        wait_for: str = "load",
        capture_screenshot: bool = False,
    ) -> PageResult:
        """Navigate to a URL and extract content.

        Args:
            url: URL to navigate to
            wait_for: Wait condition (load, domcontentloaded, networkidle)
            capture_screenshot: Whether to capture a screenshot

        Returns:
            Page result with content
        """
        if not self._initialized and not await self.start():
            return PageResult(
                url=url,
                title="",
                content="",
                html="",
                error=(
                    "Browser not available. Install playwright: "
                    "pip install playwright && playwright install chromium"
                ),
            )

        start_time = asyncio.get_event_loop().time()

        try:
            # Navigate to page
            response = await self._page.goto(url, wait_until=wait_for)

            # Extract content
            title = await self._page.title()
            html = await self._page.content()

            # Get text content
            content = await self._page.evaluate("""
                () => {
                    // Remove script and style elements
                    const scripts = document.querySelectorAll('script, style, noscript');
                    scripts.forEach(s => s.remove());

                    // Get text content
                    return document.body ? document.body.innerText : '';
                }
            """)

            # Calculate load time
            load_time = int((asyncio.get_event_loop().time() - start_time) * 1000)

            # Capture screenshot if requested
            screenshot = None
            screenshot_base64 = None
            if capture_screenshot:
                screenshot = await self._page.screenshot(type="png")
                screenshot_base64 = base64.b64encode(screenshot).decode("utf-8")

            return PageResult(
                url=self._page.url,
                title=title,
                content=content,
                html=html,
                status_code=response.status if response else None,
                headers=dict(response.headers) if response else {},
                screenshot=screenshot,
                screenshot_base64=screenshot_base64,
                load_time_ms=load_time,
            )

        except Exception as e:
            logger.error("Navigation failed", url=url, error=str(e))
            return PageResult(
                url=url,
                title="",
                content="",
                html="",
                error=str(e),
            )

    async def screenshot(
        self,
        url: str | None = None,
        full_page: bool = False,
        output_path: str | None = None,
    ) -> PageResult:
        """Capture a screenshot of the current or specified page.

        Args:
            url: Optional URL to navigate to first
            full_page: Capture full scrollable page
            output_path: Optional path to save screenshot

        Returns:
            Page result with screenshot
        """
        if url:
            result = await self.navigate(url, capture_screenshot=False)
            if result.error:
                return result

        if not self._initialized:
            return PageResult(
                url=url or "",
                title="",
                content="",
                html="",
                error="Browser not initialized",
            )

        try:
            screenshot_options: dict[str, Any] = {
                "type": "png",
                "full_page": full_page,
            }

            if output_path:
                screenshot_options["path"] = output_path

            screenshot = await self._page.screenshot(**screenshot_options)
            screenshot_base64 = base64.b64encode(screenshot).decode("utf-8")

            title = await self._page.title()

            return PageResult(
                url=self._page.url,
                title=title,
                content="",
                html="",
                screenshot=screenshot,
                screenshot_base64=screenshot_base64,
            )

        except Exception as e:
            logger.error("Screenshot failed", error=str(e))
            return PageResult(
                url=self._page.url if self._page else "",
                title="",
                content="",
                html="",
                error=str(e),
            )

    async def click(self, selector: str) -> bool:
        """Click an element on the page.

        Args:
            selector: CSS selector for the element

        Returns:
            True if clicked successfully
        """
        if not self._initialized:
            return False

        try:
            await self._page.click(selector)
            return True
        except Exception as e:
            logger.error("Click failed", selector=selector, error=str(e))
            return False

    async def fill(self, selector: str, value: str) -> bool:
        """Fill a form field.

        Args:
            selector: CSS selector for the input
            value: Value to fill

        Returns:
            True if filled successfully
        """
        if not self._initialized:
            return False

        try:
            await self._page.fill(selector, value)
            return True
        except Exception as e:
            logger.error("Fill failed", selector=selector, error=str(e))
            return False

    async def evaluate(self, script: str) -> Any:
        """Execute JavaScript on the page.

        Args:
            script: JavaScript code to execute

        Returns:
            Result of the script
        """
        if not self._initialized:
            return None

        try:
            return await self._page.evaluate(script)
        except Exception as e:
            logger.error("Script execution failed", error=str(e))
            return None

    async def wait_for_selector(
        self,
        selector: str,
        timeout: int | None = None,
    ) -> bool:
        """Wait for an element to appear.

        Args:
            selector: CSS selector to wait for
            timeout: Optional timeout in milliseconds

        Returns:
            True if element found
        """
        if not self._initialized:
            return False

        try:
            await self._page.wait_for_selector(
                selector,
                timeout=timeout or self._config.timeout,
            )
            return True
        except Exception as e:
            logger.error("Wait failed", selector=selector, error=str(e))
            return False

    async def get_cookies(self) -> list[dict[str, Any]]:
        """Get all cookies from the context.

        Returns:
            List of cookie dictionaries
        """
        if not self._context:
            return []

        cookies: list[dict[str, Any]] = await self._context.cookies()
        return cookies

    async def set_cookies(self, cookies: list[dict[str, Any]]) -> None:
        """Set cookies in the context.

        Args:
            cookies: List of cookie dictionaries
        """
        if self._context:
            await self._context.add_cookies(cookies)

    async def clear_cookies(self) -> None:
        """Clear all cookies from the context."""
        if self._context:
            await self._context.clear_cookies()

    @property
    def current_url(self) -> str | None:
        """Get the current page URL."""
        return self._page.url if self._page else None

    async def __aenter__(self) -> "Browser":
        """Async context manager entry."""
        await self.start()
        return self

    async def __aexit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        """Async context manager exit."""
        await self.stop()
