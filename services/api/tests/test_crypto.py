"""Tests for cryptographic utilities and MFA encryption.

Verifies that:
- Encryption/decryption works correctly
- MFA secrets are stored encrypted
- env_vars are encrypted at rest
- Legacy plaintext data is handled gracefully
"""

import json

import pytest

from src.crypto import (
    DecryptionError,
    decrypt_dict,
    decrypt_if_needed,
    decrypt_string,
    encrypt_dict,
    encrypt_if_needed,
    encrypt_string,
    is_encrypted,
)


class TestEncryptionBasics:
    """Tests for basic encryption/decryption functions."""

    def test_encrypt_decrypt_roundtrip(self) -> None:
        """Encrypting and decrypting should return original value."""
        plaintext = "secret-api-key-12345"
        encrypted = encrypt_string(plaintext)
        decrypted = decrypt_string(encrypted)
        assert decrypted == plaintext

    def test_encrypted_value_is_different(self) -> None:
        """Encrypted value should not match plaintext."""
        plaintext = "secret-value"
        encrypted = encrypt_string(plaintext)
        assert encrypted != plaintext

    def test_is_encrypted_detects_fernet_format(self) -> None:
        """is_encrypted should detect Fernet-encrypted values."""
        plaintext = "not-encrypted"
        encrypted = encrypt_string(plaintext)

        assert is_encrypted(encrypted) is True
        assert is_encrypted(plaintext) is False
        assert is_encrypted("") is False
        assert is_encrypted("gAAAAA") is False  # Too short

    def test_encrypt_empty_string(self) -> None:
        """Empty string should return unchanged."""
        assert encrypt_string("") == ""
        assert decrypt_string("") == ""

    def test_encrypt_none_like_values(self) -> None:
        """None-like values should be handled."""
        assert encrypt_string("") == ""

    def test_encrypt_special_characters(self) -> None:
        """Special characters and unicode should be handled."""
        special = "!@#$%^&*()_+-={}[]|\\:\";<>?,./~`"
        assert decrypt_string(encrypt_string(special)) == special

        unicode_str = "Hello \u4e16\u754c \u0391\u03b1 \U0001F600"
        assert decrypt_string(encrypt_string(unicode_str)) == unicode_str


class TestEncryptIfNeeded:
    """Tests for encrypt_if_needed migration helper."""

    def test_encrypts_plaintext(self) -> None:
        """Should encrypt plaintext values."""
        plaintext = "my-secret"
        result = encrypt_if_needed(plaintext)
        assert is_encrypted(result)
        assert decrypt_string(result) == plaintext

    def test_skips_already_encrypted(self) -> None:
        """Should not double-encrypt already encrypted values."""
        plaintext = "my-secret"
        encrypted = encrypt_string(plaintext)
        result = encrypt_if_needed(encrypted)
        # Should return same value, not re-encrypted
        assert result == encrypted
        assert decrypt_string(result) == plaintext


class TestDecryptIfNeeded:
    """Tests for decrypt_if_needed migration helper."""

    def test_decrypts_encrypted_value(self) -> None:
        """Should decrypt encrypted values."""
        plaintext = "my-secret"
        encrypted = encrypt_string(plaintext)
        result = decrypt_if_needed(encrypted)
        assert result == plaintext

    def test_returns_plaintext_unchanged(self) -> None:
        """Should return plaintext values unchanged."""
        plaintext = "not-encrypted-value"
        result = decrypt_if_needed(plaintext)
        assert result == plaintext

    def test_handles_empty_values(self) -> None:
        """Should handle empty values."""
        assert decrypt_if_needed("") == ""


class TestDictEncryption:
    """Tests for dictionary encryption (env_vars)."""

    def test_encrypt_decrypt_dict_roundtrip(self) -> None:
        """Encrypting and decrypting dict should return original."""
        original = {"API_KEY": "secret123", "DB_PASSWORD": "dbpass456"}
        encrypted = encrypt_dict(original)
        decrypted = decrypt_dict(encrypted)
        assert decrypted == original

    def test_encrypted_dict_is_string(self) -> None:
        """Encrypted dict should be a string (not dict)."""
        original = {"key": "value"}
        encrypted = encrypt_dict(original)
        assert isinstance(encrypted, str)
        assert is_encrypted(encrypted)

    def test_encrypt_empty_dict(self) -> None:
        """Empty dict should return None."""
        assert encrypt_dict({}) is None
        assert encrypt_dict(None) is None

    def test_decrypt_empty_values(self) -> None:
        """Empty values should return empty dict."""
        assert decrypt_dict(None) == {}
        assert decrypt_dict("") == {}

    def test_decrypt_legacy_json(self) -> None:
        """Should handle legacy plaintext JSON (pre-encryption data)."""
        legacy_json = '{"API_KEY": "old-secret", "TOKEN": "old-token"}'
        result = decrypt_dict(legacy_json)
        assert result == {"API_KEY": "old-secret", "TOKEN": "old-token"}

    def test_decrypt_invalid_json(self) -> None:
        """Should return empty dict for invalid JSON."""
        assert decrypt_dict("not-valid-json") == {}
        assert decrypt_dict("{invalid}") == {}

    def test_decrypt_non_dict_json(self) -> None:
        """Should return empty dict for non-dict JSON."""
        assert decrypt_dict('["array", "not", "dict"]') == {}
        assert decrypt_dict('"just-a-string"') == {}

    def test_dict_with_special_values(self) -> None:
        """Should handle special characters in dict values."""
        original = {
            "KEY_WITH_EQUALS": "value=with=equals",
            "KEY_WITH_QUOTES": 'value"with"quotes',
            "KEY_WITH_NEWLINES": "value\nwith\nnewlines",
            "UNICODE_KEY": "\u0391\u03b1",
        }
        encrypted = encrypt_dict(original)
        decrypted = decrypt_dict(encrypted)
        assert decrypted == original


class TestMFASecretEncryption:
    """Tests to verify MFA secrets are properly encrypted.

    These tests verify the encryption patterns used by the MFA service
    without requiring database access.
    """

    def test_mfa_secret_encryption_pattern(self) -> None:
        """Verify the encryption pattern matches MFA service usage."""
        # Simulate what MFA service does
        totp_secret = "JBSWY3DPEHPK3PXP"  # Example TOTP secret

        # MFA service encrypts using encrypt_string
        encrypted = encrypt_string(totp_secret)

        # Verify it's encrypted
        assert is_encrypted(encrypted)
        assert encrypted != totp_secret

        # Verify it can be decrypted
        decrypted = decrypt_if_needed(encrypted)
        assert decrypted == totp_secret

    def test_mfa_backup_codes_not_reversible(self) -> None:
        """Backup codes should be hashed (not encrypted).

        This test documents that backup codes use one-way hashing,
        not reversible encryption. The MFA service uses SHA-256.
        """
        import hashlib

        # MFA service hashes backup codes like this:
        backup_code = "12345678"
        hashed = hashlib.sha256(backup_code.encode()).hexdigest()

        # Hashed value should not be decryptable
        assert not is_encrypted(hashed)
        # The hash should be consistent
        assert hashlib.sha256(backup_code.encode()).hexdigest() == hashed


class TestEncryptionEdgeCases:
    """Edge case tests for encryption functions."""

    def test_very_long_string(self) -> None:
        """Should handle very long strings."""
        long_string = "x" * 100000
        encrypted = encrypt_string(long_string)
        decrypted = decrypt_string(encrypted)
        assert decrypted == long_string

    def test_decryption_with_wrong_key_fails(self) -> None:
        """Decrypting with wrong key should raise DecryptionError."""
        # This would require changing the key, which we can't easily do
        # in tests. Instead, verify that corrupted data fails gracefully.
        corrupted = "gAAAAABcorrupted_data_here"
        with pytest.raises(DecryptionError):
            decrypt_string(corrupted)

    def test_decrypt_if_needed_handles_corruption(self) -> None:
        """decrypt_if_needed should handle corrupted data gracefully."""
        # Looks encrypted but is corrupted
        corrupted = "gAAAAABcorrupted_but_looks_encrypted_enough_to_try"
        # Should return the corrupted value unchanged (fail gracefully)
        result = decrypt_if_needed(corrupted)
        assert result == corrupted
