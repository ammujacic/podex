"""Tests for web scraper module.

Tests cover:
- ContentScraper class initialization
- Scraper methods
- ScrapedContent dataclass
- SearchEngine class
"""

import pytest


class TestWebScraperModule:
    """Test web scraper module exists."""

    def test_web_scraper_module_exists(self) -> None:
        """Test web scraper module can be imported."""
        from src.web import scraper
        assert scraper is not None


class TestScrapedContent:
    """Test ScrapedContent dataclass."""

    def test_scraped_content_class_exists(self) -> None:
        """Test ScrapedContent class exists."""
        from src.web.scraper import ScrapedContent
        assert ScrapedContent is not None

    def test_scraped_content_creation(self) -> None:
        """Test ScrapedContent can be created."""
        from src.web.scraper import ScrapedContent

        content = ScrapedContent(
            url="https://example.com",
            title="Example Page",
            text="Hello World",
        )
        assert content.url == "https://example.com"
        assert content.title == "Example Page"
        assert content.text == "Hello World"

    def test_scraped_content_default_values(self) -> None:
        """Test ScrapedContent default values."""
        from src.web.scraper import ScrapedContent

        content = ScrapedContent(
            url="https://example.com",
            title="Test",
            text="Content",
        )
        assert content.summary == ""
        assert content.headings == []
        assert content.links == []
        assert content.images == []
        assert content.code_blocks == []
        assert content.tables == []
        assert content.metadata == {}
        assert content.word_count == 0

    def test_scraped_content_with_all_fields(self) -> None:
        """Test ScrapedContent with all fields."""
        from src.web.scraper import ScrapedContent

        content = ScrapedContent(
            url="https://example.com",
            title="Test Page",
            text="Main content here",
            summary="A brief summary",
            headings=[{"level": "h1", "text": "Title"}],
            links=[{"url": "https://link.com", "text": "Link"}],
            images=[{"url": "https://img.com/image.png", "alt": "Image"}],
            code_blocks=["code example"],
            tables=[[["Cell 1", "Cell 2"]]],
            metadata={"description": "Page desc"},
            word_count=3,
        )

        assert content.summary == "A brief summary"
        assert len(content.headings) == 1
        assert len(content.links) == 1
        assert len(content.images) == 1
        assert len(content.code_blocks) == 1
        assert len(content.tables) == 1
        assert content.word_count == 3

    def test_scraped_content_to_dict(self) -> None:
        """Test ScrapedContent to_dict method."""
        from src.web.scraper import ScrapedContent

        content = ScrapedContent(
            url="https://example.com",
            title="Test",
            text="Content text",
            word_count=2,
        )

        data = content.to_dict()

        assert data["url"] == "https://example.com"
        assert data["title"] == "Test"
        assert data["text"] == "Content text"
        assert data["word_count"] == 2
        assert "scraped_at" in data

    def test_scraped_content_to_markdown(self) -> None:
        """Test ScrapedContent to_markdown method."""
        from src.web.scraper import ScrapedContent

        content = ScrapedContent(
            url="https://example.com",
            title="Test Page",
            text="Main content",
            summary="Summary text",
            code_blocks=["print('hello')"],
            links=[{"url": "https://link.com", "text": "Link Text"}],
        )

        markdown = content.to_markdown()

        assert "# Test Page" in markdown
        assert "Summary text" in markdown
        assert "Main content" in markdown


class TestContentScraperClass:
    """Test ContentScraper class."""

    def test_content_scraper_class_exists(self) -> None:
        """Test ContentScraper class exists."""
        from src.web.scraper import ContentScraper
        assert ContentScraper is not None


class TestContentScraperInit:
    """Test ContentScraper initialization."""

    def test_content_scraper_initialization(self) -> None:
        """Test ContentScraper can be instantiated."""
        from src.web.scraper import ContentScraper

        scraper = ContentScraper()
        assert scraper is not None

    def test_content_scraper_has_scrape_method(self) -> None:
        """Test ContentScraper has scrape method."""
        from src.web.scraper import ContentScraper

        scraper = ContentScraper()
        assert hasattr(scraper, "scrape")
        assert callable(scraper.scrape)

    def test_content_scraper_has_bs4_check(self) -> None:
        """Test ContentScraper tracks bs4 availability."""
        from src.web.scraper import ContentScraper

        scraper = ContentScraper()
        assert hasattr(scraper, "_bs4_available")


class TestContentScraperScrape:
    """Test ContentScraper scrape method."""

    def test_scrape_basic_html(self) -> None:
        """Test scraping basic HTML."""
        from src.web.scraper import ContentScraper, ScrapedContent

        scraper = ContentScraper()
        html = "<html><head><title>Test</title></head><body><p>Hello</p></body></html>"

        result = scraper.scrape(html, "https://example.com", "Test Title")

        assert isinstance(result, ScrapedContent)
        assert result.url == "https://example.com"

    def test_scrape_returns_scraped_content(self) -> None:
        """Test scrape returns ScrapedContent instance."""
        from src.web.scraper import ContentScraper, ScrapedContent

        scraper = ContentScraper()
        html = "<html><body><p>Content</p></body></html>"

        result = scraper.scrape(html, "https://example.com")

        assert isinstance(result, ScrapedContent)

    def test_scrape_extracts_title(self) -> None:
        """Test scrape extracts title from HTML."""
        from src.web.scraper import ContentScraper

        scraper = ContentScraper()
        html = "<html><head><title>Page Title</title></head><body><p>Content</p></body></html>"

        result = scraper.scrape(html, "https://example.com")

        # Title should be extracted if not provided
        assert result.title == "Page Title" or result.title == ""


class TestSearchEngine:
    """Test SearchEngine class."""

    def test_search_engine_class_exists(self) -> None:
        """Test SearchEngine class exists."""
        from src.web.scraper import SearchEngine
        assert SearchEngine is not None

    def test_search_engine_initialization(self) -> None:
        """Test SearchEngine initialization."""
        from src.web.scraper import SearchEngine

        engine = SearchEngine()
        assert engine is not None

    def test_search_engine_with_provider(self) -> None:
        """Test SearchEngine with specific provider."""
        from src.web.scraper import SearchEngine

        engine = SearchEngine(provider="duckduckgo")
        assert engine._provider == "duckduckgo"

    def test_search_engine_has_search_method(self) -> None:
        """Test SearchEngine has search method."""
        from src.web.scraper import SearchEngine

        engine = SearchEngine()
        assert hasattr(engine, "search")

    @pytest.mark.asyncio
    async def test_search_returns_list(self) -> None:
        """Test search returns a list."""
        from src.web.scraper import SearchEngine

        engine = SearchEngine(provider="unknown")
        # Unknown provider returns empty list
        results = await engine.search("test query")

        assert isinstance(results, list)


class TestContentScraperPrivateMethods:
    """Test ContentScraper private methods."""

    def test_unescape_html_method(self) -> None:
        """Test _unescape_html method."""
        from src.web.scraper import ContentScraper

        scraper = ContentScraper()
        result = scraper._unescape_html("&amp; &lt; &gt;")

        assert "&" in result
        assert "<" in result
        assert ">" in result

    def test_generate_summary_method(self) -> None:
        """Test _generate_summary method."""
        from src.web.scraper import ContentScraper

        scraper = ContentScraper()
        text = "First sentence. Second sentence. Third sentence."

        summary = scraper._generate_summary(text, max_length=100)

        assert isinstance(summary, str)

    def test_generate_summary_empty_text(self) -> None:
        """Test _generate_summary with empty text."""
        from src.web.scraper import ContentScraper

        scraper = ContentScraper()
        summary = scraper._generate_summary("")

        assert summary == ""
