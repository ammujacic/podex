"""Web browsing and scraping module for agent web interactions."""

from src.web.browser import Browser, BrowserConfig, PageResult
from src.web.scraper import ContentScraper, ScrapedContent

__all__ = [
    "Browser",
    "BrowserConfig",
    "ContentScraper",
    "PageResult",
    "ScrapedContent",
]
