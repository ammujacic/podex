"""Web browsing and search tools for agents."""

import json
from typing import Any

import structlog

from src.web.browser import Browser, BrowserConfig
from src.web.scraper import ContentScraper, SearchEngine

logger = structlog.get_logger()


class WebToolsHolder:
    """Singleton holder for web tools instances."""

    _browser: Browser | None = None
    _scraper: ContentScraper | None = None
    _search_engine: SearchEngine | None = None

    @classmethod
    def get_browser(cls) -> Browser:
        """Get or create browser instance."""
        if cls._browser is None:
            cls._browser = Browser(BrowserConfig(headless=True))
        return cls._browser

    @classmethod
    def get_scraper(cls) -> ContentScraper:
        """Get or create scraper instance."""
        if cls._scraper is None:
            cls._scraper = ContentScraper()
        return cls._scraper

    @classmethod
    def get_search_engine(cls) -> SearchEngine:
        """Get or create search engine instance."""
        if cls._search_engine is None:
            cls._search_engine = SearchEngine()
        return cls._search_engine

    @classmethod
    async def cleanup_browser(cls) -> None:
        """Clean up browser resources."""
        if cls._browser is not None:
            await cls._browser.stop()
            cls._browser = None
            logger.info("Browser cleaned up")


def _get_browser() -> Browser:
    """Get or create browser instance."""
    return WebToolsHolder.get_browser()


def _get_scraper() -> ContentScraper:
    """Get or create scraper instance."""
    return WebToolsHolder.get_scraper()


def _get_search_engine() -> SearchEngine:
    """Get or create search engine instance."""
    return WebToolsHolder.get_search_engine()


async def fetch_url(
    url: str,
    extract_content: bool = True,
    include_html: bool = False,
    wait_for: str = "load",
) -> str:
    """Fetch and extract content from a URL.

    Args:
        url: URL to fetch
        extract_content: Whether to extract structured content
        include_html: Whether to include raw HTML in result
        wait_for: Wait condition (load, domcontentloaded, networkidle)

    Returns:
        JSON string with page content
    """
    logger.info("Fetching URL", url=url)

    browser = _get_browser()

    try:
        result = await browser.navigate(url, wait_for=wait_for)

        if result.error:
            return json.dumps(
                {
                    "success": False,
                    "error": result.error,
                    "url": url,
                },
            )

        response: dict[str, Any] = {
            "success": True,
            "url": result.url,
            "title": result.title,
            "status_code": result.status_code,
            "load_time_ms": result.load_time_ms,
        }

        if extract_content:
            scraper = _get_scraper()
            scraped = scraper.scrape(result.html, result.url, result.title)
            response["content"] = {
                "text": scraped.text[:10000],  # Limit size for context
                "summary": scraped.summary,
                "headings": scraped.headings[:15],
                "links": scraped.links[:30],
                "code_blocks": scraped.code_blocks[:5],
                "word_count": scraped.word_count,
                "metadata": scraped.metadata,
            }
            response["markdown"] = scraped.to_markdown()[:8000]
        else:
            response["content"] = result.content[:10000]

        if include_html:
            response["html"] = result.html[:20000]

        logger.info(
            "URL fetched",
            url=url,
            title=result.title,
            word_count=response.get("content", {}).get("word_count", 0),
        )

        return json.dumps(response)

    except Exception as e:
        logger.error("Fetch failed", url=url, error=str(e))
        return json.dumps(
            {
                "success": False,
                "error": str(e),
                "url": url,
            },
        )


async def screenshot_page(
    url: str,
    full_page: bool = False,
    output_path: str | None = None,
) -> str:
    """Capture a screenshot of a web page.

    Args:
        url: URL to screenshot
        full_page: Capture full scrollable page
        output_path: Optional path to save screenshot file

    Returns:
        JSON string with screenshot data (base64)
    """
    logger.info("Taking screenshot", url=url, full_page=full_page)

    browser = _get_browser()

    try:
        # Navigate first
        nav_result = await browser.navigate(url)
        if nav_result.error:
            return json.dumps(
                {
                    "success": False,
                    "error": nav_result.error,
                    "url": url,
                },
            )

        # Take screenshot
        result = await browser.screenshot(full_page=full_page, output_path=output_path)

        if result.error:
            return json.dumps(
                {
                    "success": False,
                    "error": result.error,
                    "url": url,
                },
            )

        response = {
            "success": True,
            "url": result.url,
            "title": result.title,
            "screenshot_base64": result.screenshot_base64,
        }

        if output_path:
            response["saved_to"] = output_path

        logger.info("Screenshot captured", url=url)
        return json.dumps(response)

    except Exception as e:
        logger.error("Screenshot failed", url=url, error=str(e))
        return json.dumps(
            {
                "success": False,
                "error": str(e),
                "url": url,
            },
        )


async def search_web(
    query: str,
    num_results: int = 10,
    fetch_content: bool = False,
) -> str:
    """Search the web for information.

    Args:
        query: Search query
        num_results: Number of results to return
        fetch_content: Whether to fetch content from top results

    Returns:
        JSON string with search results
    """
    logger.info("Searching web", query=query, num_results=num_results)

    try:
        search_engine = _get_search_engine()
        results = await search_engine.search(query, num_results)

        if not results:
            return json.dumps(
                {
                    "success": True,
                    "query": query,
                    "results": [],
                    "message": "No results found or search provider unavailable",
                },
            )

        response = {
            "success": True,
            "query": query,
            "num_results": len(results),
            "results": results,
        }

        # Optionally fetch content from top results
        if fetch_content and results:
            browser = _get_browser()
            scraper = _get_scraper()

            fetched_content = []
            for result in results[:3]:  # Limit to top 3
                try:
                    page = await browser.navigate(result["url"], wait_for="domcontentloaded")
                    if not page.error:
                        scraped = scraper.scrape(page.html, page.url, page.title)
                        fetched_content.append(
                            {
                                "url": result["url"],
                                "title": page.title,
                                "summary": scraped.summary,
                                "text": scraped.text[:3000],
                            },
                        )
                except Exception as e:
                    logger.warning("Failed to fetch result", url=result["url"], error=str(e))

            response["fetched_content"] = fetched_content

        logger.info("Search completed", query=query, num_results=len(results))
        return json.dumps(response)

    except Exception as e:
        logger.error("Search failed", query=query, error=str(e))
        return json.dumps(
            {
                "success": False,
                "error": str(e),
                "query": query,
            },
        )


async def interact_with_page(
    url: str,
    actions: list[dict[str, Any]],
) -> str:
    """Interact with a web page by performing a series of actions.

    Args:
        url: URL to interact with
        actions: List of actions to perform. Each action is a dict with:
            - type: "click", "fill", "wait", "screenshot"
            - selector: CSS selector (for click, fill, wait)
            - value: Value to fill (for fill action)
            - timeout: Wait timeout in ms (for wait action)

    Returns:
        JSON string with action results
    """
    logger.info("Interacting with page", url=url, num_actions=len(actions))

    browser = _get_browser()

    try:
        # Navigate first
        nav_result = await browser.navigate(url)
        if nav_result.error:
            return json.dumps(
                {
                    "success": False,
                    "error": nav_result.error,
                    "url": url,
                },
            )

        results = []
        for i, action in enumerate(actions):
            action_type = action.get("type", "")
            selector = action.get("selector", "")

            try:
                if action_type == "click":
                    success = await browser.click(selector)
                    results.append(
                        {
                            "action": i,
                            "type": "click",
                            "selector": selector,
                            "success": success,
                        },
                    )

                elif action_type == "fill":
                    value = action.get("value", "")
                    success = await browser.fill(selector, value)
                    results.append(
                        {
                            "action": i,
                            "type": "fill",
                            "selector": selector,
                            "success": success,
                        },
                    )

                elif action_type == "wait":
                    timeout = action.get("timeout", 5000)
                    success = await browser.wait_for_selector(selector, timeout)
                    results.append(
                        {
                            "action": i,
                            "type": "wait",
                            "selector": selector,
                            "success": success,
                        },
                    )

                elif action_type == "screenshot":
                    result = await browser.screenshot()
                    results.append(
                        {
                            "action": i,
                            "type": "screenshot",
                            "success": not result.error,
                            "screenshot_base64": result.screenshot_base64,
                        },
                    )

                else:
                    results.append(
                        {
                            "action": i,
                            "type": action_type,
                            "success": False,
                            "error": f"Unknown action type: {action_type}",
                        },
                    )

            except Exception as e:
                results.append(
                    {
                        "action": i,
                        "type": action_type,
                        "success": False,
                        "error": str(e),
                    },
                )

        return json.dumps(
            {
                "success": True,
                "url": browser.current_url,
                "actions_performed": len(results),
                "results": results,
            },
        )

    except Exception as e:
        logger.error("Page interaction failed", url=url, error=str(e))
        return json.dumps(
            {
                "success": False,
                "error": str(e),
                "url": url,
            },
        )


async def extract_page_data(
    url: str,
    selectors: dict[str, str],
) -> str:
    """Extract specific data from a page using CSS selectors.

    Args:
        url: URL to extract from
        selectors: Dict mapping field names to CSS selectors

    Returns:
        JSON string with extracted data
    """
    logger.info("Extracting page data", url=url, fields=list(selectors.keys()))

    browser = _get_browser()

    try:
        nav_result = await browser.navigate(url)
        if nav_result.error:
            return json.dumps(
                {
                    "success": False,
                    "error": nav_result.error,
                    "url": url,
                },
            )

        extracted = {}
        for field_name, selector in selectors.items():
            try:
                value = await browser.evaluate(f"""
                    () => {{
                        const el = document.querySelector({json.dumps(selector)});
                        return el ? el.innerText : null;
                    }}
                """)
                extracted[field_name] = value
            except Exception as e:
                extracted[field_name] = None
                logger.warning(
                    "Failed to extract field",
                    field=field_name,
                    selector=selector,
                    error=str(e),
                )

        return json.dumps(
            {
                "success": True,
                "url": browser.current_url,
                "data": extracted,
            },
        )

    except Exception as e:
        logger.error("Data extraction failed", url=url, error=str(e))
        return json.dumps(
            {
                "success": False,
                "error": str(e),
                "url": url,
            },
        )


async def cleanup_browser() -> None:
    """Clean up browser resources."""
    await WebToolsHolder.cleanup_browser()


# Tool definitions for registration
WEB_TOOLS = {
    "fetch_url": {
        "function": fetch_url,
        "description": (
            "Fetch and extract content from a URL. Returns structured content "
            "including text, headings, links, and metadata."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "The URL to fetch",
                },
                "extract_content": {
                    "type": "boolean",
                    "description": "Whether to extract structured content (default: true)",
                    "default": True,
                },
                "include_html": {
                    "type": "boolean",
                    "description": "Whether to include raw HTML (default: false)",
                    "default": False,
                },
                "wait_for": {
                    "type": "string",
                    "description": "Wait condition: load, domcontentloaded, networkidle",
                    "default": "load",
                },
            },
            "required": ["url"],
        },
    },
    "screenshot_page": {
        "function": screenshot_page,
        "description": "Capture a screenshot of a web page. Returns base64 encoded PNG image.",
        "parameters": {
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "The URL to screenshot",
                },
                "full_page": {
                    "type": "boolean",
                    "description": "Capture full scrollable page (default: false)",
                    "default": False,
                },
                "output_path": {
                    "type": "string",
                    "description": "Optional path to save screenshot file",
                },
            },
            "required": ["url"],
        },
    },
    "search_web": {
        "function": search_web,
        "description": (
            "Search the web for information. Returns search results with "
            "titles, URLs, and snippets."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The search query",
                },
                "num_results": {
                    "type": "integer",
                    "description": "Number of results to return (default: 10)",
                    "default": 10,
                },
                "fetch_content": {
                    "type": "boolean",
                    "description": "Whether to fetch content from top results (default: false)",
                    "default": False,
                },
            },
            "required": ["query"],
        },
    },
    "interact_with_page": {
        "function": interact_with_page,
        "description": "Interact with a web page by performing actions like click, fill, and wait.",
        "parameters": {
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "The URL to interact with",
                },
                "actions": {
                    "type": "array",
                    "description": "List of actions to perform",
                    "items": {
                        "type": "object",
                        "properties": {
                            "type": {
                                "type": "string",
                                "enum": ["click", "fill", "wait", "screenshot"],
                            },
                            "selector": {"type": "string"},
                            "value": {"type": "string"},
                            "timeout": {"type": "integer"},
                        },
                    },
                },
            },
            "required": ["url", "actions"],
        },
    },
    "extract_page_data": {
        "function": extract_page_data,
        "description": "Extract specific data from a page using CSS selectors.",
        "parameters": {
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "The URL to extract from",
                },
                "selectors": {
                    "type": "object",
                    "description": "Dict mapping field names to CSS selectors",
                    "additionalProperties": {"type": "string"},
                },
            },
            "required": ["url", "selectors"],
        },
    },
}
