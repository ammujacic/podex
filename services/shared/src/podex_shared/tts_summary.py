"""TTS Summary Generation Utility.

Generates short, spoken-friendly summaries of messages.
Avoids reading code blocks, long plans, and technical details verbatim.
"""

import re
from dataclasses import dataclass


@dataclass
class SummaryResult:
    """Result of TTS summary generation."""

    summary: str
    was_summarized: bool  # True if content was shortened
    content_type: str  # "code", "plan", "list", "text"


# Maximum characters for direct TTS (no summarization needed)
MAX_DIRECT_TTS_LENGTH = 500

# Maximum length for action/topic text in summaries
MAX_ACTION_LENGTH = 200
MAX_TITLE_LENGTH = 150

# Thresholds for list summarization
MIN_LIST_ITEMS_FOR_PLAN_OR_LIST = 3
MAX_LIST_ITEMS_FOR_BRIEF_SUMMARY = 8
MAX_WORDS_BEFORE_TRUNCATION = 100
TRUNCATION_WORD_COUNT = 80

# How many list items to read aloud
MAX_LIST_ITEMS_TO_READ = 5

# Minimum text lengths for summary generation
MIN_TEXT_LENGTH = 10
MIN_MEANINGFUL_TEXT_LENGTH = 20

# Patterns for detecting different content types
CODE_BLOCK_PATTERN = re.compile(r"```[\s\S]*?```", re.MULTILINE)
INLINE_CODE_PATTERN = re.compile(r"`[^`]+`")
NUMBERED_LIST_PATTERN = re.compile(r"^\s*\d+\.\s+", re.MULTILINE)
BULLET_LIST_PATTERN = re.compile(r"^\s*[-*]\s+", re.MULTILINE)
HEADER_PATTERN = re.compile(r"^#+\s+.+$", re.MULTILINE)
FILE_PATH_PATTERN = re.compile(r"[/\\][\w.-]+(?:[/\\][\w.-]+)+")


def _count_code_blocks(content: str) -> int:
    """Count the number of code blocks in content."""
    return len(CODE_BLOCK_PATTERN.findall(content))


def _count_list_items(content: str) -> int:
    """Count list items (numbered or bullet)."""
    numbered = len(NUMBERED_LIST_PATTERN.findall(content))
    bullets = len(BULLET_LIST_PATTERN.findall(content))
    return numbered + bullets


def _count_top_level_items(content: str) -> tuple[int, int]:
    """Count top-level numbered items and total bullet items separately.

    Returns (numbered_count, bullet_count).
    Top-level numbered items are those not indented.
    """
    # Count non-indented numbered items (top-level)
    top_level_numbered = len(re.findall(r"^(?!\s)\d+\.\s+", content, re.MULTILINE))
    # Count all bullet items
    bullets = len(BULLET_LIST_PATTERN.findall(content))
    return top_level_numbered, bullets


def _extract_file_names(content: str) -> list[str]:
    """Extract file names from file paths in content."""
    paths = FILE_PATH_PATTERN.findall(content)
    # Get just the file names
    names = []
    for path in paths:
        parts = path.replace("\\", "/").split("/")
        if parts:
            names.append(parts[-1])
    return list(set(names))[:3]  # Max 3 unique file names


def _detect_content_type(content: str) -> str:
    """Detect the primary content type of the message."""
    code_blocks = _count_code_blocks(content)
    list_items = _count_list_items(content)
    has_headers = bool(HEADER_PATTERN.search(content))

    # If there are many list items, prioritize plan/list over code
    # (e.g., a plan with a small JSON function call at the end)
    if list_items >= MIN_LIST_ITEMS_FOR_PLAN_OR_LIST:
        if has_headers:
            return "plan"
        # Only treat as code if code blocks dominate the content
        if code_blocks >= 1:
            text_without_code = _remove_code_blocks(content)
            # If most content is text/list, treat as list not code
            if len(text_without_code.strip()) > len(content) // 2:
                return "list"
        return "list"
    elif code_blocks >= 1:
        return "code"
    else:
        return "text"


def _remove_code_blocks(content: str) -> str:
    """Remove code blocks from content."""
    content = CODE_BLOCK_PATTERN.sub("", content)
    content = INLINE_CODE_PATTERN.sub("", content)
    return content.strip()


def _clean_for_speech(text: str) -> str:
    """Clean text for natural speech output."""
    # Remove markdown formatting
    text = re.sub(r"\*\*(.+?)\*\*", r"\1", text)  # Bold
    text = re.sub(r"\*(.+?)\*", r"\1", text)  # Italic
    text = re.sub(r"__(.+?)__", r"\1", text)  # Bold
    text = re.sub(r"_(.+?)_", r"\1", text)  # Italic
    text = re.sub(r"~~(.+?)~~", r"\1", text)  # Strikethrough
    text = re.sub(r"^#+\s+", "", text, flags=re.MULTILINE)  # Headers

    # Remove file paths (keep just the filename)
    text = FILE_PATH_PATTERN.sub(lambda m: m.group().split("/")[-1].split("\\")[-1], text)

    # Clean up whitespace
    text = re.sub(r"\n+", " ", text)
    text = re.sub(r"\s+", " ", text)

    return text.strip()


def _summarize_code_message(content: str) -> str:
    """Generate summary for a message containing code."""
    # Try to find what was done from the non-code parts
    text_without_code = _remove_code_blocks(content)
    text_cleaned = _clean_for_speech(text_without_code)

    # If there's meaningful text content, read more of it
    if text_cleaned and len(text_cleaned) > MIN_MEANINGFUL_TEXT_LENGTH:
        # Split into sentences for better reading
        sentences = re.split(r"(?<=[.!?])\s+", text_cleaned)
        summary_parts = []
        total_length = 0

        for sentence in sentences[:4]:  # Up to 4 sentences
            sent = sentence.strip()
            if not sent:
                continue
            if total_length + len(sent) > MAX_DIRECT_TTS_LENGTH:
                break
            summary_parts.append(sent)
            total_length += len(sent) + 1

        if summary_parts:
            summary = " ".join(summary_parts)
            return f"{summary} You can see the code in my response."

        # Fallback: truncate by words
        words = text_cleaned.split()
        if len(words) > TRUNCATION_WORD_COUNT:
            text_cleaned = " ".join(words[:TRUNCATION_WORD_COUNT])
        return f"{text_cleaned}. You can see the code in my response."

    # Fallback: count code blocks and mention file names
    code_blocks = _count_code_blocks(content)
    file_names = _extract_file_names(content)

    if file_names:
        files_str = ", ".join(file_names[:3])
        if code_blocks > 1:
            return f"I've written code for {files_str} and other files. Take a look at my response."
        else:
            return f"I've written code for {files_str}. Take a look at my response."
    elif code_blocks > 1:
        return f"I've written {code_blocks} code blocks. You can review them in my response."
    else:
        return "I've written some code for you. Take a look at my response."


def _extract_list_items(
    content: str,
    max_items: int = MAX_LIST_ITEMS_TO_READ,
    top_level_only: bool = True,
) -> list[str]:
    """Extract the first few list items from content.

    Args:
        content: The text content to extract from
        max_items: Maximum number of items to return
        top_level_only: If True, only extract non-indented (top-level) items
    """
    items = []

    if top_level_only:
        # Match only non-indented numbered items (top-level)
        pattern = re.compile(r"^(\d+)\.\s+(.+?)$", re.MULTILINE)
    else:
        # Match all items
        pattern = re.compile(r"^\s*(?:\d+\.|[-*])\s+(.+?)$", re.MULTILINE)

    for match in pattern.finditer(content):
        item_text = match.group(2).strip() if top_level_only else match.group(1).strip()

        # Clean up the item text - remove trailing colons and clean for speech
        item_text = item_text.rstrip(":")
        item_text = _clean_for_speech(item_text)

        if item_text and not item_text.startswith(("-", "*")):
            items.append(item_text)
            if len(items) >= max_items:
                break

    return items


def _summarize_plan_message(content: str) -> str:  # noqa: PLR0912
    """Generate summary for a message containing a plan."""
    text_without_code = _remove_code_blocks(content)
    text_cleaned = _clean_for_speech(text_without_code)

    # Count top-level vs nested items
    top_level_count, bullet_count = _count_top_level_items(text_without_code)

    # Extract top-level items (main steps)
    list_items = _extract_list_items(text_without_code, top_level_only=True)

    # If no numbered items, try all items
    if not list_items:
        list_items = _extract_list_items(text_without_code, top_level_only=False)
        top_level_count = len(list_items)

    # Build intro
    intro = ""

    # Try to extract plan title from headers
    headers = HEADER_PATTERN.findall(content)
    if headers:
        title = headers[0].lstrip("#").strip()
        if len(title) < MAX_TITLE_LENGTH:
            intro = f"I've created a plan: {title}. "

    # Check for common plan patterns if no header found
    if not intro:
        plan_patterns = [
            r"(?:plan|approach|strategy)\s+(?:to|for)\s+(.+?)(?:\.|$)",
            r"(?:Here's|Here is)\s+(?:the|my|a)\s+plan\s+(?:to|for)\s+(.+?)(?:\.|:|$)",
        ]
        for pattern in plan_patterns:
            match = re.search(pattern, text_cleaned, re.IGNORECASE)
            if match:
                topic = match.group(1).strip()
                if len(topic) < MAX_TITLE_LENGTH:
                    intro = f"I've created a plan for {topic}. "
                    break

    if not intro:
        if top_level_count > 0:
            intro = f"I've outlined a plan with {top_level_count} main steps. "
        else:
            intro = "I've outlined a plan. "

    # Read out the steps
    if list_items:
        steps_text = "The main steps are: " + ". ".join(
            f"{i + 1}, {item}" for i, item in enumerate(list_items)
        )
        if bullet_count > 0:
            steps_text += ". Each step has more details in my response."
        elif len(list_items) < top_level_count:
            steps_text += f". And {top_level_count - len(list_items)} more steps in my response."
        else:
            steps_text += "."
        return intro + steps_text

    return intro + "Please review the details in my response."


def _summarize_list_message(content: str) -> str:
    """Generate summary for a message containing a list."""
    text_without_code = _remove_code_blocks(content)
    text_cleaned = _clean_for_speech(text_without_code)

    # Count top-level vs nested items
    top_level_count, bullet_count = _count_top_level_items(text_without_code)

    # Extract top-level items
    list_items = _extract_list_items(text_without_code, top_level_only=True)

    # If no numbered items found, fall back to all items
    if not list_items:
        list_items = _extract_list_items(text_without_code, top_level_only=False)
        top_level_count = len(list_items)

    # Try to find what the list is about from the first sentence
    intro = ""
    if "." in text_cleaned:
        first_sentence = text_cleaned.split(".")[0].strip()
        if len(first_sentence) < MAX_TITLE_LENGTH and len(first_sentence) > MIN_TEXT_LENGTH:
            intro = first_sentence + ". "

    if not intro:
        if top_level_count > 0 and bullet_count > 0:
            intro = f"I've outlined {top_level_count} main points with sub-items. "
        elif top_level_count > 0:
            intro = f"I've listed {top_level_count} items. "
        else:
            intro = f"I've provided a list with {bullet_count} items. "

    # Read out the items
    if list_items:
        items_text = "The main points are: " + ". ".join(list_items)
        if bullet_count > 0 and top_level_count > 0:
            items_text += ". Each with more details in my response."
        elif len(list_items) < top_level_count:
            items_text += f". Plus {top_level_count - len(list_items)} more in my response."
        else:
            items_text += "."
        return intro + items_text

    return intro + "Please check my response for the details."


def _summarize_long_text(content: str) -> str:
    """Generate summary for long text content."""
    text_cleaned = _clean_for_speech(content)

    # Get multiple sentences for a more complete summary
    sentences = re.split(r"(?<=[.!?])\s+", text_cleaned)
    if sentences:
        # Take up to 3 sentences or until we hit the character limit
        summary_parts = []
        total_length = 0
        for sentence in sentences[:5]:  # Consider up to 5 sentences
            sent = sentence.strip()
            if not sent:
                continue
            if total_length + len(sent) > MAX_DIRECT_TTS_LENGTH:
                break
            summary_parts.append(sent)
            total_length += len(sent) + 1

        if summary_parts:
            summary = " ".join(summary_parts)
            remaining = len(sentences) - len(summary_parts)
            if remaining > 0:
                return f"{summary} There's more detail in my response."
            return summary

    # Fallback: truncate intelligently
    words = text_cleaned.split()
    if len(words) > MAX_WORDS_BEFORE_TRUNCATION:
        summary = " ".join(words[:TRUNCATION_WORD_COUNT])
        return f"{summary}. Please read my full response for more details."

    return text_cleaned[:MAX_DIRECT_TTS_LENGTH]


def generate_tts_summary(content: str) -> SummaryResult:
    """Generate a TTS-friendly summary from message content.

    Args:
        content: The full message content

    Returns:
        SummaryResult with the summary text and metadata
    """
    if not content or not content.strip():
        return SummaryResult(summary="", was_summarized=False, content_type="text")

    # Clean and check length
    content = content.strip()
    content_type = _detect_content_type(content)

    # Short, simple messages can be read directly
    if len(content) <= MAX_DIRECT_TTS_LENGTH and content_type == "text":
        cleaned = _clean_for_speech(content)
        return SummaryResult(summary=cleaned, was_summarized=False, content_type="text")

    # Generate appropriate summary based on content type
    if content_type == "code":
        summary = _summarize_code_message(content)
    elif content_type == "plan":
        summary = _summarize_plan_message(content)
    elif content_type == "list":
        summary = _summarize_list_message(content)
    else:
        summary = _summarize_long_text(content)

    return SummaryResult(summary=summary, was_summarized=True, content_type=content_type)
