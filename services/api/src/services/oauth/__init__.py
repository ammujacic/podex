"""OAuth provider implementations for LLM personal plan authentication.

Supports OAuth flows for:
- Anthropic (Claude Pro/Max)
- Google (Gemini)
- GitHub (Copilot/Codex)
"""

from .anthropic import AnthropicOAuthProvider
from .base import OAuthCredentials, OAuthProvider
from .github import GitHubOAuthProvider
from .google import GoogleOAuthProvider

# Registry of supported providers
OAUTH_PROVIDERS: dict[str, type[OAuthProvider]] = {
    "anthropic": AnthropicOAuthProvider,
    "google": GoogleOAuthProvider,
    "github": GitHubOAuthProvider,
}


def get_oauth_provider(provider: str) -> OAuthProvider:
    """Get an OAuth provider instance by name.

    Args:
        provider: Provider name ("anthropic", "google", "github")

    Returns:
        OAuth provider instance

    Raises:
        ValueError: If provider is not supported
    """
    if provider not in OAUTH_PROVIDERS:
        msg = f"Unsupported OAuth provider: {provider}"
        raise ValueError(msg)
    return OAUTH_PROVIDERS[provider]()


__all__ = [
    "OAUTH_PROVIDERS",
    "AnthropicOAuthProvider",
    "GitHubOAuthProvider",
    "GoogleOAuthProvider",
    "OAuthCredentials",
    "OAuthProvider",
    "get_oauth_provider",
]
