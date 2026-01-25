"""Comprehensive tests for Redis encryption utilities."""

import os
from unittest.mock import patch

import pytest
from cryptography.fernet import Fernet

from podex_shared.redis_crypto import (
    _get_encryption_key,
    _get_fernet,
    clear_key_cache,
    decrypt_value,
    encrypt_value,
    is_encryption_enabled,
)


class TestEncryptionKeyDerivation:
    """Tests for encryption key derivation."""

    def teardown_method(self) -> None:
        """Clean up environment after each test."""
        if "REDIS_ENCRYPTION_KEY" in os.environ:
            del os.environ["REDIS_ENCRYPTION_KEY"]
        clear_key_cache()

    def test_get_encryption_key_not_configured(self) -> None:
        """Test that key is None when REDIS_ENCRYPTION_KEY not set."""
        if "REDIS_ENCRYPTION_KEY" in os.environ:
            del os.environ["REDIS_ENCRYPTION_KEY"]
        clear_key_cache()

        key = _get_encryption_key()
        assert key is None

    def test_get_encryption_key_configured(self) -> None:
        """Test that key is derived when REDIS_ENCRYPTION_KEY is set."""
        os.environ["REDIS_ENCRYPTION_KEY"] = "test-secret-key"
        clear_key_cache()

        key = _get_encryption_key()
        assert key is not None
        assert isinstance(key, bytes)
        assert len(key) == 44  # Base64-encoded 32-byte key

    def test_get_encryption_key_deterministic(self) -> None:
        """Test that the same secret always produces the same key."""
        os.environ["REDIS_ENCRYPTION_KEY"] = "test-secret-key"
        clear_key_cache()

        key1 = _get_encryption_key()
        clear_key_cache()

        key2 = _get_encryption_key()
        assert key1 == key2

    def test_get_encryption_key_cached(self) -> None:
        """Test that encryption key is cached."""
        os.environ["REDIS_ENCRYPTION_KEY"] = "test-secret-key"
        clear_key_cache()

        key1 = _get_encryption_key()
        # Change environment variable (should not affect cached key)
        os.environ["REDIS_ENCRYPTION_KEY"] = "different-secret"

        key2 = _get_encryption_key()
        assert key1 == key2  # Should be same due to caching

    def test_different_secrets_produce_different_keys(self) -> None:
        """Test that different secrets produce different keys."""
        os.environ["REDIS_ENCRYPTION_KEY"] = "secret-one"
        clear_key_cache()
        key1 = _get_encryption_key()

        os.environ["REDIS_ENCRYPTION_KEY"] = "secret-two"
        clear_key_cache()
        key2 = _get_encryption_key()

        assert key1 != key2


class TestFernetInstance:
    """Tests for Fernet instance creation."""

    def teardown_method(self) -> None:
        """Clean up environment after each test."""
        if "REDIS_ENCRYPTION_KEY" in os.environ:
            del os.environ["REDIS_ENCRYPTION_KEY"]
        clear_key_cache()

    def test_get_fernet_not_configured(self) -> None:
        """Test that Fernet is None when encryption not configured."""
        if "REDIS_ENCRYPTION_KEY" in os.environ:
            del os.environ["REDIS_ENCRYPTION_KEY"]
        clear_key_cache()

        fernet = _get_fernet()
        assert fernet is None

    def test_get_fernet_configured(self) -> None:
        """Test that Fernet instance is created when configured."""
        os.environ["REDIS_ENCRYPTION_KEY"] = "test-secret-key"
        clear_key_cache()

        fernet = _get_fernet()
        assert fernet is not None
        assert isinstance(fernet, Fernet)

    def test_get_fernet_cached(self) -> None:
        """Test that Fernet instance is cached."""
        os.environ["REDIS_ENCRYPTION_KEY"] = "test-secret-key"
        clear_key_cache()

        fernet1 = _get_fernet()
        fernet2 = _get_fernet()
        assert fernet1 is fernet2  # Same instance


class TestEncryptionEnabled:
    """Tests for is_encryption_enabled()."""

    def teardown_method(self) -> None:
        """Clean up environment after each test."""
        if "REDIS_ENCRYPTION_KEY" in os.environ:
            del os.environ["REDIS_ENCRYPTION_KEY"]
        clear_key_cache()

    def test_encryption_disabled_by_default(self) -> None:
        """Test that encryption is disabled when env var not set."""
        if "REDIS_ENCRYPTION_KEY" in os.environ:
            del os.environ["REDIS_ENCRYPTION_KEY"]
        clear_key_cache()

        assert is_encryption_enabled() is False

    def test_encryption_enabled_with_key(self) -> None:
        """Test that encryption is enabled when env var is set."""
        os.environ["REDIS_ENCRYPTION_KEY"] = "test-secret-key"
        clear_key_cache()

        assert is_encryption_enabled() is True


class TestEncryptValue:
    """Tests for encrypt_value()."""

    def teardown_method(self) -> None:
        """Clean up environment after each test."""
        if "REDIS_ENCRYPTION_KEY" in os.environ:
            del os.environ["REDIS_ENCRYPTION_KEY"]
        clear_key_cache()

    def test_encrypt_value_disabled(self) -> None:
        """Test that value is unchanged when encryption disabled."""
        if "REDIS_ENCRYPTION_KEY" in os.environ:
            del os.environ["REDIS_ENCRYPTION_KEY"]
        clear_key_cache()

        value = "sensitive-data"
        encrypted = encrypt_value(value)
        assert encrypted == value  # Unchanged

    def test_encrypt_value_enabled(self) -> None:
        """Test that value is encrypted when encryption enabled."""
        os.environ["REDIS_ENCRYPTION_KEY"] = "test-secret-key"
        clear_key_cache()

        value = "sensitive-data"
        encrypted = encrypt_value(value)
        assert encrypted != value  # Changed
        assert encrypted.startswith("gAAAAA")  # Fernet token prefix

    def test_encrypt_empty_string(self) -> None:
        """Test that empty string is handled correctly."""
        os.environ["REDIS_ENCRYPTION_KEY"] = "test-secret-key"
        clear_key_cache()

        encrypted = encrypt_value("")
        assert encrypted == ""  # Empty string unchanged

    def test_encrypt_unicode(self) -> None:
        """Test that unicode characters are encrypted correctly."""
        os.environ["REDIS_ENCRYPTION_KEY"] = "test-secret-key"
        clear_key_cache()

        value = "Hello 世界 🌍"
        encrypted = encrypt_value(value)
        assert encrypted != value
        assert encrypted.startswith("gAAAAA")

    def test_encrypt_long_value(self) -> None:
        """Test that long values are encrypted correctly."""
        os.environ["REDIS_ENCRYPTION_KEY"] = "test-secret-key"
        clear_key_cache()

        value = "x" * 10000
        encrypted = encrypt_value(value)
        assert encrypted != value
        assert encrypted.startswith("gAAAAA")

    def test_encrypt_same_value_produces_different_ciphertext(self) -> None:
        """Test that encrypting the same value twice produces different ciphertext."""
        os.environ["REDIS_ENCRYPTION_KEY"] = "test-secret-key"
        clear_key_cache()

        value = "test-value"
        encrypted1 = encrypt_value(value)
        encrypted2 = encrypt_value(value)

        # Fernet includes a timestamp, so encryptions differ
        assert encrypted1 != encrypted2

    def test_encrypt_with_exception(self) -> None:
        """Test that encryption failures return original value."""
        os.environ["REDIS_ENCRYPTION_KEY"] = "test-secret-key"
        clear_key_cache()

        value = "test-value"

        # Mock Fernet.encrypt to raise exception
        with patch("podex_shared.redis_crypto._get_fernet") as mock_get_fernet:
            mock_fernet = mock_get_fernet.return_value
            mock_fernet.encrypt.side_effect = Exception("Encryption failed")

            encrypted = encrypt_value(value)
            assert encrypted == value  # Returns original on error


class TestDecryptValue:
    """Tests for decrypt_value()."""

    def teardown_method(self) -> None:
        """Clean up environment after each test."""
        if "REDIS_ENCRYPTION_KEY" in os.environ:
            del os.environ["REDIS_ENCRYPTION_KEY"]
        clear_key_cache()

    def test_decrypt_plaintext_value(self) -> None:
        """Test that plaintext values are returned unchanged."""
        value = "plaintext-data"
        decrypted = decrypt_value(value)
        assert decrypted == value

    def test_decrypt_empty_string(self) -> None:
        """Test that empty string is handled correctly."""
        decrypted = decrypt_value("")
        assert decrypted == ""

    def test_decrypt_value_without_key_configured(self) -> None:
        """Test that encrypted value without key returns as-is."""
        # Create an encrypted value first
        os.environ["REDIS_ENCRYPTION_KEY"] = "test-secret-key"
        clear_key_cache()
        encrypted = encrypt_value("test-data")

        # Remove key and try to decrypt
        del os.environ["REDIS_ENCRYPTION_KEY"]
        clear_key_cache()

        decrypted = decrypt_value(encrypted)
        assert decrypted == encrypted  # Returns encrypted value as-is

    def test_decrypt_value_with_wrong_key(self) -> None:
        """Test that decryption with wrong key returns value as-is."""
        # Encrypt with one key
        os.environ["REDIS_ENCRYPTION_KEY"] = "original-key"
        clear_key_cache()
        encrypted = encrypt_value("test-data")

        # Try to decrypt with different key
        os.environ["REDIS_ENCRYPTION_KEY"] = "wrong-key"
        clear_key_cache()

        decrypted = decrypt_value(encrypted)
        # Should return as-is since key mismatch
        assert decrypted == encrypted

    def test_decrypt_corrupted_token(self) -> None:
        """Test that corrupted Fernet token returns as-is."""
        os.environ["REDIS_ENCRYPTION_KEY"] = "test-secret-key"
        clear_key_cache()

        # Create a value that looks like a Fernet token but is corrupted
        corrupted = "gAAAAA_corrupted_token_data"
        decrypted = decrypt_value(corrupted)
        assert decrypted == corrupted

    def test_decrypt_with_exception(self) -> None:
        """Test that decryption failures return original value."""
        os.environ["REDIS_ENCRYPTION_KEY"] = "test-secret-key"
        clear_key_cache()

        # Valid Fernet token prefix
        fake_encrypted = "gAAAABfake"

        # Mock Fernet.decrypt to raise unexpected exception
        with patch("podex_shared.redis_crypto._get_fernet") as mock_get_fernet:
            mock_fernet = mock_get_fernet.return_value
            mock_fernet.decrypt.side_effect = RuntimeError("Unexpected error")

            decrypted = decrypt_value(fake_encrypted)
            assert decrypted == fake_encrypted


class TestRoundTrip:
    """Tests for encrypt/decrypt round trip."""

    def teardown_method(self) -> None:
        """Clean up environment after each test."""
        if "REDIS_ENCRYPTION_KEY" in os.environ:
            del os.environ["REDIS_ENCRYPTION_KEY"]
        clear_key_cache()

    def test_round_trip_simple_value(self) -> None:
        """Test that encrypt then decrypt returns original value."""
        os.environ["REDIS_ENCRYPTION_KEY"] = "test-secret-key"
        clear_key_cache()

        original = "test-data"
        encrypted = encrypt_value(original)
        decrypted = decrypt_value(encrypted)

        assert decrypted == original

    def test_round_trip_unicode(self) -> None:
        """Test round trip with unicode characters."""
        os.environ["REDIS_ENCRYPTION_KEY"] = "test-secret-key"
        clear_key_cache()

        original = "Hello 世界 🌍 Ñoño"
        encrypted = encrypt_value(original)
        decrypted = decrypt_value(encrypted)

        assert decrypted == original

    def test_round_trip_json_data(self) -> None:
        """Test round trip with JSON-like data."""
        os.environ["REDIS_ENCRYPTION_KEY"] = "test-secret-key"
        clear_key_cache()

        original = '{"user":"test","data":{"key":"value"}}'
        encrypted = encrypt_value(original)
        decrypted = decrypt_value(encrypted)

        assert decrypted == original

    def test_round_trip_large_value(self) -> None:
        """Test round trip with large value."""
        os.environ["REDIS_ENCRYPTION_KEY"] = "test-secret-key"
        clear_key_cache()

        original = "x" * 100000
        encrypted = encrypt_value(original)
        decrypted = decrypt_value(encrypted)

        assert decrypted == original


class TestCacheClear:
    """Tests for clear_key_cache()."""

    def teardown_method(self) -> None:
        """Clean up environment after each test."""
        if "REDIS_ENCRYPTION_KEY" in os.environ:
            del os.environ["REDIS_ENCRYPTION_KEY"]
        clear_key_cache()

    def test_clear_cache_allows_key_refresh(self) -> None:
        """Test that clearing cache allows key to be refreshed."""
        os.environ["REDIS_ENCRYPTION_KEY"] = "original-key"
        clear_key_cache()

        key1 = _get_encryption_key()

        # Change key and clear cache
        os.environ["REDIS_ENCRYPTION_KEY"] = "new-key"
        clear_key_cache()

        key2 = _get_encryption_key()

        assert key1 != key2

    def test_clear_cache_clears_both_caches(self) -> None:
        """Test that clear_key_cache clears both key and fernet caches."""
        os.environ["REDIS_ENCRYPTION_KEY"] = "test-key"
        clear_key_cache()

        # Populate caches
        _get_encryption_key()
        fernet1 = _get_fernet()

        # Change environment
        os.environ["REDIS_ENCRYPTION_KEY"] = "new-key"
        clear_key_cache()

        # Get new instances
        fernet2 = _get_fernet()

        # Should be different instances due to different keys
        assert fernet1 is not fernet2


@pytest.mark.integration
class TestRedisEncryptionIntegration:
    """Integration tests for Redis encryption with real Redis."""

    @pytest.mark.asyncio
    async def test_encrypt_decrypt_with_real_redis(
        self,
        redis_with_encryption: "redis.Redis",  # type: ignore[name-defined]
    ) -> None:
        """Test encryption and decryption with real Redis storage."""
        # Import after fixture sets up environment
        from podex_shared.redis_crypto import decrypt_value, encrypt_value

        key = "test:encrypted:key"
        original_value = "sensitive-data-123"

        # Encrypt and store
        encrypted = encrypt_value(original_value)
        await redis_with_encryption.set(key, encrypted)

        # Retrieve and decrypt
        stored = await redis_with_encryption.get(key)
        assert stored is not None
        decrypted = decrypt_value(stored)

        assert decrypted == original_value
        assert encrypted != original_value

    @pytest.mark.asyncio
    async def test_backward_compatibility_plaintext(
        self,
        redis_with_encryption: "redis.Redis",  # type: ignore[name-defined]
    ) -> None:
        """Test that plaintext values stored before encryption still work."""
        from podex_shared.redis_crypto import decrypt_value

        key = "test:plaintext:key"
        plaintext_value = "old-plaintext-value"

        # Store plaintext value (simulating old data)
        await redis_with_encryption.set(key, plaintext_value)

        # Retrieve and decrypt (should return as-is)
        stored = await redis_with_encryption.get(key)
        assert stored is not None
        decrypted = decrypt_value(stored)

        assert decrypted == plaintext_value
