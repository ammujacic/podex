"""Default LLM provider seed data.

Stores metadata about LLM providers (Anthropic, OpenAI, Google, Ollama)
including branding, documentation URLs, and capabilities.
These are synced to the database on startup and can be customized by admins.
"""

from typing import TypedDict


class LLMProviderData(TypedDict, total=False):
    """Type definition for LLM provider seed data."""

    slug: str
    name: str
    description: str | None
    icon: str | None
    color: str | None
    logo_url: str | None
    is_local: bool
    default_url: str | None
    docs_url: str | None
    setup_guide_url: str | None
    requires_api_key: bool
    supports_streaming: bool
    supports_tools: bool
    supports_vision: bool
    is_enabled: bool
    sort_order: int


DEFAULT_PROVIDERS: list[LLMProviderData] = [
    {
        "slug": "anthropic",
        "name": "Anthropic",
        "description": "Claude models - Opus 4.5, Sonnet 4.5, Haiku. Advanced reasoning.",
        "icon": "Brain",
        "color": "#D97757",
        "is_local": False,
        "docs_url": "https://console.anthropic.com/",
        "setup_guide_url": "https://docs.anthropic.com/en/docs/quickstart",
        "requires_api_key": True,
        "supports_streaming": True,
        "supports_tools": True,
        "supports_vision": True,
        "is_enabled": True,
        "sort_order": 10,
    },
    {
        "slug": "openai",
        "name": "OpenAI",
        "description": "GPT-4o, GPT-4 Turbo, o1 models. Industry-leading language models.",
        "icon": "Sparkles",
        "color": "#10A37F",
        "is_local": False,
        "docs_url": "https://platform.openai.com/",
        "setup_guide_url": "https://platform.openai.com/docs/quickstart",
        "requires_api_key": True,
        "supports_streaming": True,
        "supports_tools": True,
        "supports_vision": True,
        "is_enabled": True,
        "sort_order": 20,
    },
    {
        "slug": "google",
        "name": "Google",
        "description": "Gemini 2.0 Flash, Gemini 2.5 Pro. Large context window models.",
        "icon": "Zap",
        "color": "#4285F4",
        "is_local": False,
        "docs_url": "https://ai.google.dev/",
        "setup_guide_url": "https://ai.google.dev/gemini-api/docs/quickstart",
        "requires_api_key": True,
        "supports_streaming": True,
        "supports_tools": True,
        "supports_vision": True,
        "is_enabled": True,
        "sort_order": 30,
    },
    {
        "slug": "ollama",
        "name": "Ollama",
        "description": "Run open-source models locally. Llama, Mistral, CodeLlama, and more.",
        "icon": "Server",
        "color": "#FFFFFF",
        "is_local": True,
        "default_url": "http://localhost:11434",
        "docs_url": "https://ollama.ai/",
        "setup_guide_url": "https://github.com/ollama/ollama#readme",
        "requires_api_key": False,
        "supports_streaming": True,
        "supports_tools": True,
        "supports_vision": True,
        "is_enabled": True,
        "sort_order": 40,
    },
    {
        "slug": "lmstudio",
        "name": "LM Studio",
        "description": "Run local models with LM Studio. User-friendly desktop application.",
        "icon": "Monitor",
        "color": "#6366F1",
        "is_local": True,
        "default_url": "http://localhost:1234",
        "docs_url": "https://lmstudio.ai/",
        "setup_guide_url": "https://lmstudio.ai/docs/getting-started",
        "requires_api_key": False,
        "supports_streaming": True,
        "supports_tools": True,
        "supports_vision": False,
        "is_enabled": True,
        "sort_order": 50,
    },
    {
        "slug": "openrouter",
        "name": "OpenRouter",
        "description": "Access multiple AI models through a single API. Pay-per-use pricing.",
        "icon": "Route",
        "color": "#6366F1",
        "is_local": False,
        "docs_url": "https://openrouter.ai/",
        "setup_guide_url": "https://openrouter.ai/docs/quick-start",
        "requires_api_key": True,
        "supports_streaming": True,
        "supports_tools": True,
        "supports_vision": True,
        "is_enabled": True,
        "sort_order": 25,
    },
]
