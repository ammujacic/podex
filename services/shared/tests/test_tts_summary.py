"""Comprehensive tests for TTS summary generation."""

import pytest

from podex_shared.tts_summary import (
    MAX_DIRECT_TTS_LENGTH,
    SummaryResult,
    generate_tts_summary,
)


class TestSummaryResult:
    """Tests for SummaryResult dataclass."""

    def test_summary_result(self) -> None:
        """Test SummaryResult creation."""
        result = SummaryResult(
            summary="Test summary",
            was_summarized=True,
            content_type="code",
        )
        assert result.summary == "Test summary"
        assert result.was_summarized is True
        assert result.content_type == "code"


class TestGenerateTTSSummaryEmpty:
    """Tests for empty/minimal input."""

    def test_empty_string(self) -> None:
        """Test empty string input."""
        result = generate_tts_summary("")
        assert result.summary == ""
        assert result.was_summarized is False
        assert result.content_type == "text"

    def test_whitespace_only(self) -> None:
        """Test whitespace-only input."""
        result = generate_tts_summary("   \n\t  ")
        assert result.summary == ""
        assert result.was_summarized is False
        assert result.content_type == "text"


class TestGenerateTTSSummaryShortText:
    """Tests for short text that doesn't need summarization."""

    def test_short_text_not_summarized(self) -> None:
        """Test that short text is not summarized."""
        text = "This is a short message."
        result = generate_tts_summary(text)
        assert result.was_summarized is False
        assert result.content_type == "text"
        assert result.summary == text

    def test_text_at_limit(self) -> None:
        """Test text at the length limit."""
        text = "a" * MAX_DIRECT_TTS_LENGTH
        result = generate_tts_summary(text)
        assert result.was_summarized is False

    def test_short_text_cleaned(self) -> None:
        """Test that short text is cleaned for speech."""
        text = "This is **bold** text."
        result = generate_tts_summary(text)
        assert "**" not in result.summary
        assert "bold" in result.summary


class TestGenerateTTSSummaryCodeBlocks:
    """Tests for content with code blocks."""

    def test_single_code_block(self) -> None:
        """Test content with single code block."""
        text = """Here's the code:

```python
def hello():
    print("Hello, world!")
```

This function prints a greeting."""
        result = generate_tts_summary(text)
        assert result.was_summarized is True
        assert result.content_type == "code"
        assert "code" in result.summary.lower()

    def test_multiple_code_blocks(self) -> None:
        """Test content with multiple code blocks."""
        text = """I've written two files:

```python
# main.py
print("Hello")
```

```javascript
// app.js
console.log("World");
```

Both files are complete."""
        result = generate_tts_summary(text)
        assert result.was_summarized is True
        assert result.content_type == "code"
        assert "code" in result.summary.lower() or "written" in result.summary.lower()

    def test_code_with_action_description(self) -> None:
        """Test code block with clear action description."""
        text = """I've created a new function to handle authentication:

```python
def authenticate(user, password):
    # Authentication logic
    pass
```"""
        result = generate_tts_summary(text)
        assert result.was_summarized is True
        assert "created" in result.summary.lower() or "code" in result.summary.lower()

    def test_code_with_file_paths(self) -> None:
        """Test code that mentions file paths."""
        text = """I've updated src/components/Button.tsx:

```typescript
export const Button = () => <button>Click me</button>;
```"""
        result = generate_tts_summary(text)
        assert result.was_summarized is True
        # Should mention the filename
        assert "Button.tsx" in result.summary or "code" in result.summary.lower()


class TestGenerateTTSSummaryPlans:
    """Tests for content with plans/lists with headers."""

    def test_plan_with_header(self) -> None:
        """Test content that looks like a plan."""
        text = """## Implementation Plan

1. Create the database schema
2. Implement the API endpoints
3. Add authentication
4. Write unit tests
5. Deploy to production"""
        result = generate_tts_summary(text)
        assert result.was_summarized is True
        assert result.content_type == "plan"
        assert "plan" in result.summary.lower()
        assert "5" in result.summary or "steps" in result.summary.lower()

    def test_plan_extracts_title(self) -> None:
        """Test that plan title is extracted."""
        text = """# User Authentication

1. Set up OAuth
2. Create login page
3. Add session management"""
        result = generate_tts_summary(text)
        assert result.was_summarized is True
        assert "plan" in result.summary.lower()


class TestGenerateTTSSummaryLists:
    """Tests for content with lists (without headers)."""

    def test_numbered_list(self) -> None:
        """Test content with numbered list."""
        text = """Here are the steps:

1. Open the file
2. Make the changes
3. Save and close
4. Run the tests"""
        result = generate_tts_summary(text)
        assert result.was_summarized is True
        assert result.content_type == "list"

    def test_bullet_list(self) -> None:
        """Test content with bullet list."""
        text = """Features included:

- Fast performance
- Easy to use
- Well documented
- Highly customizable"""
        result = generate_tts_summary(text)
        assert result.was_summarized is True
        assert result.content_type == "list"

    def test_short_list(self) -> None:
        """Test that very short lists are not summarized."""
        text = """Options:
1. Option A
2. Option B"""
        result = generate_tts_summary(text)
        # Short content is not summarized
        assert result.was_summarized is False
        assert "Options" in result.summary


class TestGenerateTTSSummaryLongText:
    """Tests for long text content."""

    def test_long_text_summarized(self) -> None:
        """Test that long text is summarized."""
        text = "This is a very long message. " * 50
        result = generate_tts_summary(text)
        assert result.was_summarized is True
        assert result.content_type == "text"
        assert len(result.summary) < len(text)

    def test_long_text_uses_first_sentence(self) -> None:
        """Test that long text uses first sentence."""
        text = "First important sentence. " + "Additional detail. " * 30
        result = generate_tts_summary(text)
        assert result.was_summarized is True
        assert "First important sentence" in result.summary

    def test_long_text_truncation(self) -> None:
        """Test that very long text is truncated."""
        # Text with no sentence breaks - must exceed MAX_DIRECT_TTS_LENGTH (500)
        text = "word " * 110  # 550 chars > 500 threshold
        result = generate_tts_summary(text)
        assert result.was_summarized is True
        # Long text summary includes this phrase
        assert "Please read my full response" in result.summary


class TestGenerateTTSSummaryMarkdownCleaning:
    """Tests for markdown cleaning."""

    def test_removes_bold(self) -> None:
        """Test that bold markdown is removed."""
        text = "This is **bold** text"
        result = generate_tts_summary(text)
        assert "**" not in result.summary
        assert "bold" in result.summary

    def test_removes_italic(self) -> None:
        """Test that italic markdown is removed."""
        text = "This is *italic* text"
        result = generate_tts_summary(text)
        assert result.summary.count("*") == 0
        assert "italic" in result.summary

    def test_removes_strikethrough(self) -> None:
        """Test that strikethrough is removed."""
        text = "This is ~~deleted~~ text"
        result = generate_tts_summary(text)
        assert "~~" not in result.summary
        assert "deleted" in result.summary

    def test_removes_headers(self) -> None:
        """Test that header markers are removed."""
        text = "# Main Title"
        # This is short so won't be summarized, but cleaning still applies
        result = generate_tts_summary(text)
        assert not result.summary.startswith("#")

    def test_simplifies_file_paths(self) -> None:
        """Test that file paths are simplified."""
        text = "Check the file at /Users/dev/project/src/components/Button.tsx for details."
        result = generate_tts_summary(text)
        # File path should be simplified to just filename
        assert "Button.tsx" in result.summary or "file" in result.summary.lower()


class TestGenerateTTSSummaryInlineCode:
    """Tests for inline code handling."""

    def test_preserves_inline_code_in_short_text(self) -> None:
        """Test that short text with inline code is preserved as-is."""
        text = "Use the `console.log` function"
        result = generate_tts_summary(text)
        # Short text is not processed, so backticks remain
        assert result.was_summarized is False
        assert "console.log" in result.summary

    def test_long_text_with_inline_code_summarized(self) -> None:
        """Test that long text with inline code is summarized."""
        text = "Use the console.log function for debugging. " * 20
        result = generate_tts_summary(text)
        assert result.was_summarized is True
        assert len(result.summary) < len(text)


class TestGenerateTTSSummaryWhitespace:
    """Tests for whitespace handling."""

    def test_normalizes_newlines(self) -> None:
        """Test that newlines are normalized to spaces."""
        text = "Line one.\nLine two.\nLine three."
        result = generate_tts_summary(text)
        assert "\n" not in result.summary

    def test_normalizes_multiple_spaces(self) -> None:
        """Test that multiple spaces are normalized."""
        text = "Word    with     many      spaces."
        result = generate_tts_summary(text)
        assert "    " not in result.summary


class TestGenerateTTSSummaryContentTypeDetection:
    """Tests for content type detection."""

    def test_detects_code_type(self) -> None:
        """Test detection of code content."""
        text = "```\ncode here\n```"
        result = generate_tts_summary(text)
        assert result.content_type == "code"

    def test_detects_plan_type(self) -> None:
        """Test detection of plan content."""
        text = """# My Plan
1. Step one
2. Step two
3. Step three"""
        result = generate_tts_summary(text)
        assert result.content_type == "plan"

    def test_detects_list_type(self) -> None:
        """Test detection of list content without headers."""
        text = """1. First item
2. Second item
3. Third item
4. Fourth item"""
        result = generate_tts_summary(text)
        assert result.content_type == "list"

    def test_detects_text_type(self) -> None:
        """Test detection of plain text content."""
        long_text = "This is plain text. " * 20
        result = generate_tts_summary(long_text)
        assert result.content_type == "text"


class TestGenerateTTSSummaryEdgeCases:
    """Tests for edge cases."""

    def test_mixed_content(self) -> None:
        """Test content with mixed types (code prioritized)."""
        text = """Here's the implementation:

1. First step
2. Second step

```python
print("hello")
```

And some text."""
        result = generate_tts_summary(text)
        # Code should take priority
        assert result.content_type == "code"

    def test_single_word(self) -> None:
        """Test single word input."""
        result = generate_tts_summary("Hello")
        assert result.summary == "Hello"
        assert result.was_summarized is False

    def test_only_code_block(self) -> None:
        """Test input that is only a code block."""
        text = """```python
def main():
    pass
```"""
        result = generate_tts_summary(text)
        assert result.was_summarized is True
        assert result.content_type == "code"
        assert "code" in result.summary.lower()
