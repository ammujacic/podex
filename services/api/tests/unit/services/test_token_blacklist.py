"""Unit tests for token blacklist service.

Tests JWT token revocation with mocked Redis backend.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.services.token_blacklist import (
    is_token_revoked,
    register_user_token,
    revoke_all_user_tokens,
    revoke_token,
)


@pytest.mark.unit
@pytest.mark.asyncio
async def test_revoke_token_success():
    """Test successfully revoking a token."""
    mock_redis = AsyncMock()
    mock_redis.setex = AsyncMock()

    with patch("src.services.token_blacklist._get_redis_client", return_value=mock_redis):
        result = await revoke_token("test-jti-123", expires_in_seconds=3600)

        assert result is True
        mock_redis.setex.assert_called_once()
        call_args = mock_redis.setex.call_args[0]
        assert call_args[0] == "podex:token:blacklist:test-jti-123"
        assert call_args[1] == 3660  # 3600 + 60 buffer
        assert call_args[2] == "revoked"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_revoke_token_empty_jti():
    """Test revoking token with empty jti."""
    result = await revoke_token("", expires_in_seconds=3600)
    assert result is False


@pytest.mark.unit
@pytest.mark.asyncio
async def test_revoke_token_redis_error():
    """Test revoke token when Redis fails."""
    mock_redis = AsyncMock()
    mock_redis.setex = AsyncMock(side_effect=Exception("Redis error"))

    with patch("src.services.token_blacklist._get_redis_client", return_value=mock_redis):
        result = await revoke_token("test-jti-123", expires_in_seconds=3600)

        assert result is False


@pytest.mark.unit
@pytest.mark.asyncio
async def test_revoke_token_minimum_ttl():
    """Test revoke token with very short expiry uses minimum TTL."""
    mock_redis = AsyncMock()
    mock_redis.setex = AsyncMock()

    with patch("src.services.token_blacklist._get_redis_client", return_value=mock_redis):
        result = await revoke_token("test-jti-123", expires_in_seconds=10)

        assert result is True
        call_args = mock_redis.setex.call_args[0]
        # Should use minimum of 60 seconds
        assert call_args[1] == 70  # max(10 + 60, 60) = 70


@pytest.mark.unit
@pytest.mark.asyncio
async def test_is_token_revoked_true():
    """Test checking if a token is revoked (it is)."""
    mock_redis = AsyncMock()
    mock_redis.exists = AsyncMock(return_value=1)

    with patch("src.services.token_blacklist._get_redis_client", return_value=mock_redis):
        result = await is_token_revoked("test-jti-123")

        assert result is True
        mock_redis.exists.assert_called_once_with("podex:token:blacklist:test-jti-123")


@pytest.mark.unit
@pytest.mark.asyncio
async def test_is_token_revoked_false():
    """Test checking if a token is revoked (it is not)."""
    mock_redis = AsyncMock()
    mock_redis.exists = AsyncMock(return_value=0)

    with patch("src.services.token_blacklist._get_redis_client", return_value=mock_redis):
        result = await is_token_revoked("test-jti-123")

        assert result is False


@pytest.mark.unit
@pytest.mark.asyncio
async def test_is_token_revoked_empty_jti():
    """Test checking revocation with empty jti."""
    result = await is_token_revoked("")
    assert result is False


@pytest.mark.unit
@pytest.mark.asyncio
async def test_is_token_revoked_redis_error_fails_closed():
    """Test that Redis error causes fail-closed (reject token)."""
    mock_redis = AsyncMock()
    mock_redis.exists = AsyncMock(side_effect=Exception("Redis error"))

    with patch("src.services.token_blacklist._get_redis_client", return_value=mock_redis):
        result = await is_token_revoked("test-jti-123")

        # SECURITY: Should fail closed - reject the token
        assert result is True


@pytest.mark.unit
@pytest.mark.asyncio
async def test_revoke_all_user_tokens_success():
    """Test revoking all tokens for a user."""
    mock_redis = AsyncMock()
    mock_redis.smembers = AsyncMock(return_value={"jti1", "jti2", "jti3"})
    mock_pipeline = AsyncMock()
    mock_pipeline.setex = MagicMock()
    mock_pipeline.delete = MagicMock()
    mock_pipeline.execute = AsyncMock()
    mock_redis.pipeline = MagicMock(return_value=mock_pipeline)

    with patch("src.services.token_blacklist._get_redis_client", return_value=mock_redis):
        with patch("src.services.token_blacklist.settings") as mock_settings:
            mock_settings.REFRESH_TOKEN_EXPIRE_DAYS = 7
            mock_settings.BROWSER_REFRESH_TOKEN_EXPIRE_DAYS = 30

            count = await revoke_all_user_tokens("user123")

            assert count == 3
            mock_redis.smembers.assert_called_once_with("podex:user:tokens:user123")
            # Should have called setex 3 times (one per token)
            assert mock_pipeline.setex.call_count == 3
            # Should delete the user tokens set
            mock_pipeline.delete.assert_called_once_with("podex:user:tokens:user123")


@pytest.mark.unit
@pytest.mark.asyncio
async def test_revoke_all_user_tokens_no_tokens():
    """Test revoking all tokens when user has no tokens."""
    mock_redis = AsyncMock()
    mock_redis.smembers = AsyncMock(return_value=set())

    with patch("src.services.token_blacklist._get_redis_client", return_value=mock_redis):
        count = await revoke_all_user_tokens("user123")

        assert count == 0


@pytest.mark.unit
@pytest.mark.asyncio
async def test_revoke_all_user_tokens_redis_error():
    """Test revoking all tokens when Redis fails."""
    mock_redis = AsyncMock()
    mock_redis.smembers = AsyncMock(side_effect=Exception("Redis error"))

    with patch("src.services.token_blacklist._get_redis_client", return_value=mock_redis):
        count = await revoke_all_user_tokens("user123")

        assert count == 0


@pytest.mark.unit
@pytest.mark.asyncio
async def test_register_user_token_success():
    """Test registering a user token."""
    mock_redis = AsyncMock()
    mock_redis.sadd = AsyncMock()
    mock_redis.expire = AsyncMock()

    with patch("src.services.token_blacklist._get_redis_client", return_value=mock_redis):
        result = await register_user_token("user123", "jti123", expires_in_seconds=3600)

        assert result is True
        mock_redis.sadd.assert_called_once_with("podex:user:tokens:user123", "jti123")
        mock_redis.expire.assert_called_once_with("podex:user:tokens:user123", 3660)


@pytest.mark.unit
@pytest.mark.asyncio
async def test_register_user_token_empty_user_id():
    """Test registering token with empty user_id."""
    result = await register_user_token("", "jti123", expires_in_seconds=3600)
    assert result is False


@pytest.mark.unit
@pytest.mark.asyncio
async def test_register_user_token_empty_jti():
    """Test registering token with empty jti."""
    result = await register_user_token("user123", "", expires_in_seconds=3600)
    assert result is False


@pytest.mark.unit
@pytest.mark.asyncio
async def test_register_user_token_redis_error():
    """Test registering token when Redis fails."""
    mock_redis = AsyncMock()
    mock_redis.sadd = AsyncMock(side_effect=Exception("Redis error"))

    with patch("src.services.token_blacklist._get_redis_client", return_value=mock_redis):
        result = await register_user_token("user123", "jti123", expires_in_seconds=3600)

        assert result is False


@pytest.mark.unit
@pytest.mark.asyncio
async def test_register_user_token_minimum_ttl():
    """Test registering token with very short expiry uses minimum TTL."""
    mock_redis = AsyncMock()
    mock_redis.sadd = AsyncMock()
    mock_redis.expire = AsyncMock()

    with patch("src.services.token_blacklist._get_redis_client", return_value=mock_redis):
        result = await register_user_token("user123", "jti123", expires_in_seconds=10)

        assert result is True
        mock_redis.expire.assert_called_once_with("podex:user:tokens:user123", 70)
