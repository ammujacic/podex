"""Content scraper for extracting structured data from web pages."""

import html as html_module
import importlib.util
import re
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urljoin, urlparse

import structlog

# Check if optional dependencies are available
_BS4_AVAILABLE = importlib.util.find_spec("bs4") is not None
_DDGS_AVAILABLE = importlib.util.find_spec("duckduckgo_search") is not None

if _BS4_AVAILABLE:
    from bs4 import BeautifulSoup

if _DDGS_AVAILABLE:
    from duckduckgo_search import DDGS

logger = structlog.get_logger()

# Content length limits for markdown output
MAX_TEXT_LENGTH_MARKDOWN = 8000

# Code block size thresholds
MIN_PRE_CODE_LENGTH = 10
MIN_CODE_BLOCK_LENGTH = 50


@dataclass
class ScrapedContent:
    """Structured content extracted from a web page."""

    url: str
    title: str
    text: str
    summary: str = ""
    headings: list[dict[str, str]] = field(default_factory=list)
    links: list[dict[str, str]] = field(default_factory=list)
    images: list[dict[str, str]] = field(default_factory=list)
    code_blocks: list[str] = field(default_factory=list)
    tables: list[list[list[str]]] = field(default_factory=list)
    metadata: dict[str, str] = field(default_factory=dict)
    word_count: int = 0
    scraped_at: datetime = field(default_factory=lambda: datetime.now(UTC))

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary."""
        return {
            "url": self.url,
            "title": self.title,
            "text": self.text[:10000] if self.text else "",  # Truncate
            "summary": self.summary,
            "headings": self.headings[:20],
            "links": self.links[:50],
            "code_blocks": self.code_blocks[:10],
            "word_count": self.word_count,
            "metadata": self.metadata,
            "scraped_at": self.scraped_at.isoformat(),
        }

    def to_markdown(self) -> str:
        """Convert to markdown format for LLM context."""
        parts = [f"# {self.title}", ""]

        if self.summary:
            parts.extend([self.summary, ""])

        if self.text:
            # Truncate long text
            text = self.text[:MAX_TEXT_LENGTH_MARKDOWN]
            if len(self.text) > MAX_TEXT_LENGTH_MARKDOWN:
                text += "\n\n[Content truncated...]"
            parts.extend([text, ""])

        if self.code_blocks:
            parts.append("## Code Examples")
            for code in self.code_blocks[:5]:
                parts.extend(["```", code[:2000], "```", ""])

        if self.links:
            parts.append("## Links")
            for link in self.links[:20]:
                parts.append(f"- [{link.get('text', link['url'])}]({link['url']})")

        return "\n".join(parts)


class ContentScraper:
    """Scraper for extracting structured content from HTML.

    Features:
    - Text extraction with cleanup
    - Heading hierarchy extraction
    - Link and image extraction
    - Code block extraction
    - Table parsing
    - Metadata extraction
    """

    def __init__(self) -> None:
        """Initialize scraper."""
        self._bs4_available = _BS4_AVAILABLE
        if not self._bs4_available:
            logger.warning("BeautifulSoup not available. Using basic scraping.")

    def scrape(self, html: str, url: str, title: str = "") -> ScrapedContent:
        """Scrape content from HTML.

        Args:
            html: HTML content
            url: Source URL
            title: Page title

        Returns:
            Scraped content
        """
        if self._bs4_available:
            return self._scrape_with_bs4(html, url, title)
        else:
            return self._scrape_basic(html, url, title)

    def _scrape_with_bs4(
        self,
        html: str,
        url: str,
        title: str,
    ) -> ScrapedContent:
        """Scrape using BeautifulSoup."""
        soup = BeautifulSoup(html, "html.parser")

        # Remove unwanted elements
        for tag in soup.find_all(["script", "style", "noscript", "nav", "footer"]):
            tag.decompose()

        # Extract title
        if not title:
            title_tag = soup.find("title")
            title = title_tag.get_text(strip=True) if title_tag else ""

        # Extract metadata
        metadata = self._extract_metadata(soup)

        # Extract text content
        text = self._extract_text(soup)
        word_count = len(text.split())

        # Extract headings
        headings = self._extract_headings(soup)

        # Extract links
        links = self._extract_links(soup, url)

        # Extract images
        images = self._extract_images(soup, url)

        # Extract code blocks
        code_blocks = self._extract_code_blocks(soup)

        # Extract tables
        tables = self._extract_tables(soup)

        # Generate summary
        summary = self._generate_summary(text)

        return ScrapedContent(
            url=url,
            title=title,
            text=text,
            summary=summary,
            headings=headings,
            links=links,
            images=images,
            code_blocks=code_blocks,
            tables=tables,
            metadata=metadata,
            word_count=word_count,
        )

    def _scrape_basic(
        self,
        html: str,
        url: str,
        title: str,
    ) -> ScrapedContent:
        """Basic scraping without BeautifulSoup."""
        # Remove script and style tags
        text = re.sub(r"<script[^>]*>.*?</script>", "", html, flags=re.DOTALL | re.IGNORECASE)
        text = re.sub(r"<style[^>]*>.*?</style>", "", text, flags=re.DOTALL | re.IGNORECASE)

        # Remove all tags
        text = re.sub(r"<[^>]+>", " ", text)

        # Clean up whitespace
        text = re.sub(r"\s+", " ", text).strip()

        # Unescape HTML entities
        text = self._unescape_html(text)

        return ScrapedContent(
            url=url,
            title=title,
            text=text,
            word_count=len(text.split()),
        )

    def _extract_metadata(self, soup: Any) -> dict[str, str]:
        """Extract metadata from the page."""
        metadata = {}

        # Meta tags
        for meta in soup.find_all("meta"):
            name = meta.get("name") or meta.get("property", "")
            content = meta.get("content", "")
            if name and content:
                metadata[name] = content

        # Open Graph
        for og in ["og:title", "og:description", "og:image", "og:type"]:
            tag = soup.find("meta", property=og)
            if tag:
                metadata[og] = tag.get("content", "")

        # Canonical URL
        canonical = soup.find("link", rel="canonical")
        if canonical:
            metadata["canonical"] = canonical.get("href", "")

        return metadata

    def _extract_text(self, soup: Any) -> str:
        """Extract main text content."""
        # Try to find main content area
        main = (
            soup.find("main")
            or soup.find("article")
            or soup.find("div", class_=re.compile(r"content|main|body", re.I))
            or soup.find("body")
        )

        if not main:
            return ""

        # Get text with some structure
        text_parts = []
        for element in main.find_all(["p", "h1", "h2", "h3", "h4", "h5", "h6", "li"]):
            text = element.get_text(strip=True)
            if text:
                text_parts.append(text)

        return "\n\n".join(text_parts)

    def _extract_headings(self, soup: Any) -> list[dict[str, str]]:
        """Extract heading hierarchy."""
        headings = []
        for tag in soup.find_all(["h1", "h2", "h3", "h4", "h5", "h6"]):
            text = tag.get_text(strip=True)
            if text:
                headings.append(
                    {
                        "level": tag.name,
                        "text": text,
                    },
                )
        return headings

    def _extract_links(self, soup: Any, base_url: str) -> list[dict[str, str]]:
        """Extract links from the page."""
        links = []
        seen_urls = set()

        for a in soup.find_all("a", href=True):
            href = a.get("href", "")
            if not href or href.startswith("#") or href.startswith("javascript:"):
                continue

            # Resolve relative URLs
            full_url = urljoin(base_url, href)

            if full_url in seen_urls:
                continue
            seen_urls.add(full_url)

            text = a.get_text(strip=True) or href

            links.append(
                {
                    "url": full_url,
                    "text": text[:100],
                    "is_external": urlparse(full_url).netloc != urlparse(base_url).netloc,
                },
            )

        return links

    def _extract_images(self, soup: Any, base_url: str) -> list[dict[str, str]]:
        """Extract images from the page."""
        images = []

        for img in soup.find_all("img", src=True):
            src = img.get("src", "")
            if not src or src.startswith("data:"):
                continue

            full_url = urljoin(base_url, src)
            alt = img.get("alt", "")

            images.append(
                {
                    "url": full_url,
                    "alt": alt,
                },
            )

        return images

    def _extract_code_blocks(self, soup: Any) -> list[str]:
        """Extract code blocks from the page."""
        code_blocks = []

        # <pre> tags
        for pre in soup.find_all("pre"):
            code = pre.get_text(strip=True)
            if code and len(code) > MIN_PRE_CODE_LENGTH:
                code_blocks.append(code)

        # <code> blocks (not inline)
        for code in soup.find_all("code"):
            parent = code.parent
            if parent and parent.name != "pre":
                # Check if it's a block-level code
                text = code.get_text(strip=True)
                if text and len(text) > MIN_CODE_BLOCK_LENGTH and "\n" in text:
                    code_blocks.append(text)

        return code_blocks

    def _extract_tables(self, soup: Any) -> list[list[list[str]]]:
        """Extract tables from the page."""
        tables = []

        for table in soup.find_all("table"):
            rows = []
            for tr in table.find_all("tr"):
                cells = []
                for cell in tr.find_all(["th", "td"]):
                    cells.append(cell.get_text(strip=True))
                if cells:
                    rows.append(cells)
            if rows:
                tables.append(rows)

        return tables

    def _generate_summary(self, text: str, max_length: int = 500) -> str:
        """Generate a summary from the text."""
        if not text:
            return ""

        # Get first few sentences
        sentences = re.split(r"[.!?]+", text)
        summary_parts = []
        current_length = 0

        for raw_sentence in sentences:
            cleaned_sentence = raw_sentence.strip()
            if not cleaned_sentence:
                continue
            if current_length + len(cleaned_sentence) > max_length:
                break
            summary_parts.append(cleaned_sentence)
            current_length += len(cleaned_sentence)

        return ". ".join(summary_parts) + "." if summary_parts else ""

    def _unescape_html(self, text: str) -> str:
        """Unescape HTML entities."""
        return html_module.unescape(text)


class SearchEngine:
    """Web search capabilities using various providers."""

    def __init__(self, provider: str = "duckduckgo") -> None:
        """Initialize search engine.

        Args:
            provider: Search provider (duckduckgo, google)
        """
        self._provider = provider

    async def search(
        self,
        query: str,
        num_results: int = 10,
    ) -> list[dict[str, str]]:
        """Perform a web search.

        Args:
            query: Search query
            num_results: Number of results to return

        Returns:
            List of search results
        """
        if self._provider == "duckduckgo":
            return await self._search_duckduckgo(query, num_results)
        else:
            logger.warning(f"Unknown search provider: {self._provider}")
            return []

    async def _search_duckduckgo(
        self,
        query: str,
        num_results: int,
    ) -> list[dict[str, str]]:
        """Search using DuckDuckGo."""
        if not _DDGS_AVAILABLE:
            logger.warning("duckduckgo-search not installed")
            return []

        try:
            results = []
            with DDGS() as ddgs:
                for r in ddgs.text(query, max_results=num_results):
                    results.append(
                        {
                            "title": r.get("title", ""),
                            "url": r.get("href", ""),
                            "snippet": r.get("body", ""),
                        },
                    )

            return results

        except Exception as e:
            logger.error("Search failed", error=str(e))
            return []
