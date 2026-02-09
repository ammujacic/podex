"""Rate limiting middleware using slowapi with Redis backend."""

import json
from collections.abc import Awaitable, Callable
from typing import Any

import redis.asyncio as redis
import structlog
from fastapi import Request, Response
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp

from src.config import settings

logger = structlog.get_logger()


def get_client_identifier(request: Request) -> str:
    """Get unique client identifier for rate limiting.

    Priority:
    1. Authenticated user ID (most accurate)
    2. X-Forwarded-For header (if behind trusted proxy)
    3. Direct client IP

    Only trusts X-Forwarded-For when TRUST_PROXY is enabled
    to prevent IP spoofing attacks.
    """
    # Prefer user ID if authenticated
    if hasattr(request.state, "user_id") and request.state.user_id:
        return f"user:{request.state.user_id}"

    # Only trust X-Forwarded-For if explicitly configured
    if getattr(settings, "TRUST_PROXY", False):
        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded:
            # Take the first (client) IP from the chain
            return f"ip:{forwarded.split(',')[0].strip()}"

    # Use direct client IP via slowapi's default
    return f"ip:{get_remote_address(request)}"


def _create_redis_storage() -> str | None:
    """Create Redis storage URL for slowapi, or None for in-memory fallback."""
    if not settings.REDIS_URL:
        logger.warning("REDIS_URL not configured, using in-memory rate limiting (not distributed)")
        return None
    return settings.REDIS_URL


def _create_limiter() -> Limiter:
    """Create rate limiter with Redis or in-memory fallback."""
    storage_uri = _create_redis_storage()

    try:
        limiter_instance = Limiter(
            key_func=get_client_identifier,
            storage_uri=storage_uri,
            storage_options={"socket_connect_timeout": 5} if storage_uri else {},  # type: ignore[dict-item]
            strategy="fixed-window",
            headers_enabled=True,
        )
        if storage_uri:
            logger.info("Rate limiter initialized with Redis storage")
    except Exception as e:
        logger.warning(
            "Failed to initialize Redis rate limiter, falling back to in-memory",
            error=str(e),
        )
        # Fallback to in-memory if Redis connection fails
        return Limiter(
            key_func=get_client_identifier,
            storage_uri=None,
            strategy="fixed-window",
            headers_enabled=True,
        )
    else:
        return limiter_instance


# Create the limiter with Redis storage or fallback
limiter = _create_limiter()


# ============================================================================
# Rate Limit Categories - Different limits for different endpoint types
# ============================================================================

# Standard API rate limits
RATE_LIMIT_STANDARD = "100/minute"  # General API endpoints
RATE_LIMIT_AUTH = "5/minute"  # Login/register - strict to prevent brute force
RATE_LIMIT_OAUTH = "10/minute"  # OAuth callbacks
RATE_LIMIT_SENSITIVE = "20/minute"  # Password reset, email verification
RATE_LIMIT_AGENT = "30/minute"  # Agent operations (LLM calls)
RATE_LIMIT_UPLOAD = "10/minute"  # File uploads
RATE_LIMIT_SEARCH = "60/minute"  # Search operations
RATE_LIMIT_ADMIN = "200/minute"  # Admin endpoints (higher limit)
RATE_LIMIT_WEBSOCKET = "300/minute"  # WebSocket handshakes
RATE_LIMIT_HEALTH = "1000/minute"  # Health checks (high limit for monitoring)


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Rate limiting middleware using slowapi with Redis backend.

    This middleware applies default rate limits to all requests.
    Individual routes can override with @limiter.limit() decorator.

    Features:
    - Redis-backed storage for distributed rate limiting
    - Per-user or per-IP tracking
    - Automatic cleanup via Redis TTL
    - Rate limit headers in responses
    """

    def __init__(self, app: ASGIApp) -> None:
        super().__init__(app)
        self._redis_connected = False

    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        """Apply rate limiting to requests."""
        # Skip rate limiting for health checks only
        path = request.url.path
        if path == "/health":
            return await call_next(request)

        # SECURITY: Apply rate limiting to WebSocket upgrades to prevent connection flooding
        # WebSocket connections consume server resources and should be rate limited
        if request.headers.get("upgrade") == "websocket":
            # Apply WebSocket-specific rate limit
            client_key = get_client_identifier(request)
            is_allowed = await check_websocket_rate_limit(client_key)
            if not is_allowed:
                logger.warning(
                    "WebSocket rate limit exceeded",
                    client=client_key,
                    path=path,
                )
                return Response(
                    content="WebSocket rate limit exceeded. Too many connection attempts.",
                    status_code=429,
                    headers={
                        "Retry-After": "60",
                        "X-RateLimit-Limit": "60",
                        "X-RateLimit-Remaining": "0",
                    },
                )

        # Apply default rate limit via limiter
        # Note: Routes with @limiter.limit() will use their own limits
        try:
            return await call_next(request)
        except RateLimitExceeded as e:
            return _rate_limit_exceeded_handler(request, e)  # type: ignore[no-any-return]


# ============================================================================
# Redis-backed OAuth State Storage
# ============================================================================


class _RedisClientHolder:
    """Container for Redis client to avoid global statement."""

    client: Any = None


_redis_holder = _RedisClientHolder()


async def get_redis_client() -> Any:
    """Get or create Redis client for OAuth states."""
    if _redis_holder.client is None:
        _redis_holder.client = redis.from_url(
            settings.REDIS_URL,
            decode_responses=True,
            socket_connect_timeout=5,
        )
    return _redis_holder.client


async def close_redis_client() -> None:
    """Close Redis client connection."""
    if _redis_holder.client:
        await _redis_holder.client.close()
        _redis_holder.client = None


# OAuth state storage functions
OAUTH_STATE_PREFIX = "podex:oauth:state:"
OAUTH_LINK_STATE_PREFIX = "podex:oauth:link:"
OAUTH_STATE_TTL = 600  # 10 minutes


async def store_oauth_state(state: str, provider: str) -> None:
    """Store OAuth state in Redis with TTL."""
    client = await get_redis_client()
    key = f"{OAUTH_STATE_PREFIX}{state}"
    await client.setex(key, OAUTH_STATE_TTL, provider)
    logger.debug("OAuth state stored", state=state[:8], provider=provider)


async def store_oauth_link_state(state: str, provider: str, user_id: str) -> None:
    """Store OAuth link state in Redis with user_id for account linking.

    This is used when a logged-in user wants to link their external OAuth
    account (e.g., GitHub) to their existing Podex account.
    """
    client = await get_redis_client()
    key = f"{OAUTH_LINK_STATE_PREFIX}{state}"
    value = json.dumps({"provider": provider, "user_id": user_id})
    await client.setex(key, OAUTH_STATE_TTL, value)
    logger.debug("OAuth link state stored", state=state[:8], provider=provider, user_id=user_id[:8])


async def validate_oauth_link_state(state: str, expected_provider: str) -> str | None:
    """Validate OAuth link state from Redis and return user_id.

    SECURITY: Implements fail-closed behavior - if Redis is unavailable,
    OAuth state validation fails to prevent replay attacks.

    Args:
        state: The state token to validate
        expected_provider: Expected OAuth provider (github, google)

    Returns:
        The user_id if state is valid and matches provider, None otherwise
    """
    try:
        client = await get_redis_client()
        key = f"{OAUTH_LINK_STATE_PREFIX}{state}"

        # Get and delete atomically to prevent reuse
        value = await client.getdel(key)

        if value is None:
            logger.warning("OAuth link state not found or expired", state=state[:8])
            return None

        data = json.loads(value)
        provider = data.get("provider")
        user_id = data.get("user_id")

        if provider != expected_provider:
            logger.warning(
                "OAuth link state provider mismatch",
                state=state[:8],
                expected=expected_provider,
                actual=provider,
            )
            return None

        logger.debug(
            "OAuth link state validated", state=state[:8], provider=provider, user_id=user_id[:8]
        )
        return str(user_id) if user_id else None

    except Exception as e:
        logger.exception(
            "OAuth link state validation failed due to Redis error - rejecting (fail-closed)",
            state=state[:8],
            error=str(e),
        )
        return None


async def validate_oauth_state(state: str, expected_provider: str) -> bool:
    """Validate OAuth state from Redis (one-time use).

    SECURITY: Implements fail-closed behavior - if Redis is unavailable,
    OAuth state validation fails to prevent replay attacks.

    Args:
        state: The state token to validate
        expected_provider: Expected OAuth provider (github, google)

    Returns:
        True if state is valid and matches provider, False otherwise
    """
    try:
        client = await get_redis_client()
        key = f"{OAUTH_STATE_PREFIX}{state}"

        # Get and delete atomically to prevent reuse
        provider = await client.getdel(key)

        if provider is None:
            logger.warning("OAuth state not found or expired", state=state[:8])
            return False

        if provider != expected_provider:
            logger.warning(
                "OAuth state provider mismatch",
                state=state[:8],
                expected=expected_provider,
                actual=provider,
            )
            return False

        logger.debug("OAuth state validated", state=state[:8], provider=provider)

    except Exception as e:
        # SECURITY: Fail-closed - reject OAuth if Redis is unavailable
        # This prevents potential replay attacks when state can't be verified
        logger.exception(
            "OAuth state validation failed due to Redis error - rejecting (fail-closed)",
            state=state[:8],
            error=str(e),
        )
        return False
    else:
        return True


# ============================================================================
# Rate Limit Storage Functions (for auth rate limiting)
# ============================================================================

AUTH_RATE_LIMIT_PREFIX = "podex:ratelimit:auth:"
AUTH_RATE_LIMIT_WINDOW = 300  # 5 minutes

# WebSocket rate limiting
WEBSOCKET_RATE_LIMIT_PREFIX = "podex:ratelimit:ws:"
WEBSOCKET_RATE_LIMIT_WINDOW = 60  # 1 minute
WEBSOCKET_RATE_LIMIT_MAX = 60  # Max 60 WebSocket connections per minute per client


async def check_auth_rate_limit(
    key: str,
    limit: int,
    window: int = AUTH_RATE_LIMIT_WINDOW,
) -> bool:
    """Check if auth rate limit is exceeded using Redis.

    Args:
        key: Unique key for rate limiting (e.g., "login:ip:1.2.3.4")
        limit: Maximum allowed requests in window
        window: Time window in seconds

    Returns:
        True if request is allowed, False if rate limited
    """
    client = await get_redis_client()
    redis_key = f"{AUTH_RATE_LIMIT_PREFIX}{key}"

    # Use Redis pipeline for atomic increment + expire
    pipe = client.pipeline()
    pipe.incr(redis_key)
    pipe.expire(redis_key, window)
    results = await pipe.execute()

    current_count = results[0]

    if current_count > limit:
        logger.warning(
            "Auth rate limit exceeded",
            key=key,
            count=current_count,
            limit=limit,
        )
        return False

    return True


async def check_websocket_rate_limit(client_key: str) -> bool:
    """Check if WebSocket rate limit is exceeded.

    SECURITY: Rate limits WebSocket connection attempts to prevent:
    - Connection flooding (resource exhaustion)
    - DoS attacks via WebSocket handshakes

    Args:
        client_key: Unique client identifier (user:id or ip:address).

    Returns:
        True if connection is allowed, False if rate limited.
    """
    try:
        client = await get_redis_client()
        redis_key = f"{WEBSOCKET_RATE_LIMIT_PREFIX}{client_key}"

        # Use Redis pipeline for atomic increment + expire
        pipe = client.pipeline()
        pipe.incr(redis_key)
        pipe.expire(redis_key, WEBSOCKET_RATE_LIMIT_WINDOW)
        results = await pipe.execute()

        current_count = results[0]

        if current_count > WEBSOCKET_RATE_LIMIT_MAX:
            logger.warning(
                "WebSocket rate limit exceeded",
                key=client_key,
                count=current_count,
                limit=WEBSOCKET_RATE_LIMIT_MAX,
            )
            return False
        return True
    except Exception as e:
        # SECURITY: Fail closed - deny connection when Redis unavailable
        # WebSocket connections are expensive resources and could be used for DoS
        # Legitimate users can retry; attackers shouldn't bypass rate limits
        logger.exception(
            "WebSocket rate limit check failed - rejecting (fail-closed)",
            error=str(e),
        )
        return False
