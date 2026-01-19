"""Token blacklist service for JWT revocation.

This service provides a Redis-backed token blacklist to support immediate
token revocation for security events like:
- Password changes
- Explicit logout (revoke all sessions)
- Account compromise detection
- Admin-initiated session termination

Tokens are stored with TTL matching their expiration time to automatically
clean up expired entries.
"""

from typing import Any

import structlog

from src.config import settings

logger = structlog.get_logger()

# Redis key prefix for blacklisted tokens
TOKEN_BLACKLIST_PREFIX = "podex:token:blacklist:"

# Redis key prefix for user's all tokens (for revoking all sessions)
USER_TOKENS_PREFIX = "podex:user:tokens:"


async def _get_redis_client() -> Any:
    """Get Redis client for token operations."""
    from src.middleware.rate_limit import get_redis_client

    return await get_redis_client()


async def revoke_token(jti: str, expires_in_seconds: int) -> bool:
    """Add a token to the blacklist.

    Args:
        jti: The JWT ID (jti claim) of the token to revoke.
        expires_in_seconds: Seconds until the token expires naturally.
            The blacklist entry will be automatically removed after this time.

    Returns:
        True if the token was successfully blacklisted, False otherwise.
    """
    if not jti:
        logger.warning("Attempted to revoke token with empty jti")
        return False

    try:
        client = await _get_redis_client()
        key = f"{TOKEN_BLACKLIST_PREFIX}{jti}"

        # Store with TTL - no need to keep after token would have expired anyway
        # Add a small buffer (60 seconds) to account for clock skew
        ttl = max(expires_in_seconds + 60, 60)
        await client.setex(key, ttl, "revoked")
    except Exception:
        logger.exception("Failed to revoke token")
        return False
    else:
        logger.info("Token revoked", jti=jti[:8] + "...")
        return True


async def is_token_revoked(jti: str) -> bool:
    """Check if a token has been revoked.

    Args:
        jti: The JWT ID (jti claim) to check.

    Returns:
        True if the token is in the blacklist, False otherwise.
    """
    if not jti:
        return False

    try:
        client = await _get_redis_client()
        key = f"{TOKEN_BLACKLIST_PREFIX}{jti}"
        result = await client.exists(key)
        return bool(result)

    except Exception:
        # SECURITY: Fail closed - reject tokens when we can't verify revocation status
        # This is critical for security: if Redis is down, we must assume tokens
        # could be revoked (e.g., after logout or password change)
        logger.exception("Failed to check token blacklist, failing closed - rejecting token")
        return True


async def revoke_all_user_tokens(user_id: str) -> int:
    """Revoke all tokens for a user.

    This is useful for:
    - Password changes (force re-authentication)
    - Account compromise (terminate all sessions)
    - User-initiated "log out everywhere"

    Args:
        user_id: The user ID whose tokens should be revoked.

    Returns:
        Number of tokens revoked.
    """
    try:
        client = await _get_redis_client()
        user_tokens_key = f"{USER_TOKENS_PREFIX}{user_id}"

        # Get all token JTIs for this user
        token_jtis = await client.smembers(user_tokens_key)

        if not token_jtis:
            return 0

        # Revoke each token with a reasonable TTL
        # Use max token lifetime as fallback
        default_ttl = settings.REFRESH_TOKEN_EXPIRE_DAYS * 86400

        pipe = client.pipeline()
        for jti in token_jtis:
            key = f"{TOKEN_BLACKLIST_PREFIX}{jti}"
            pipe.setex(key, default_ttl, "revoked")

        # Clear the user's token set
        pipe.delete(user_tokens_key)
        await pipe.execute()

        count = len(token_jtis)
    except Exception:
        logger.exception("Failed to revoke all user tokens", user_id=user_id)
        return 0
    else:
        logger.info("Revoked all tokens for user", user_id=user_id, count=count)
        return count


async def register_user_token(user_id: str, jti: str, expires_in_seconds: int) -> bool:
    """Register a token for a user (for bulk revocation support).

    Args:
        user_id: The user ID.
        jti: The JWT ID of the token.
        expires_in_seconds: Seconds until the token expires.

    Returns:
        True if registration succeeded, False otherwise.
    """
    if not user_id or not jti:
        return False

    try:
        client = await _get_redis_client()
        user_tokens_key = f"{USER_TOKENS_PREFIX}{user_id}"

        # Add to user's token set
        await client.sadd(user_tokens_key, jti)

        # Set expiry on the set (will be extended with each new token)
        ttl = max(expires_in_seconds + 60, 60)
        await client.expire(user_tokens_key, ttl)
    except Exception:
        logger.warning("Failed to register user token", exc_info=True)
        return False
    else:
        return True
