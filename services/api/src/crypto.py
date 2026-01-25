"""Cryptographic utilities for sensitive data encryption.

Uses Fernet symmetric encryption for encrypting sensitive data at rest,
such as MFA secrets and API keys.
"""

import base64
import hashlib
import json
from typing import Any

from cryptography.fernet import Fernet, InvalidToken

from src.config import settings


class CryptoError(Exception):
    """Base exception for crypto operations."""


class DecryptionError(CryptoError):
    """Raised when decryption fails."""


class EncryptionKeyError(CryptoError):
    """Raised when encryption key is missing or invalid."""


def _get_encryption_key() -> bytes:
    """Get or derive the encryption key from settings.

    Uses the JWT_SECRET_KEY to derive a Fernet-compatible key.
    This ensures we don't need yet another secret to manage.

    Returns:
        32-byte key suitable for Fernet.

    Raises:
        EncryptionKeyError: If no secret key is available.
    """
    secret = settings.JWT_SECRET_KEY
    if not secret:
        raise EncryptionKeyError("JWT_SECRET_KEY must be set for encryption")

    # Derive a 32-byte key using SHA-256
    # We use a fixed salt to ensure deterministic key derivation
    salt = b"podex-mfa-encryption-v1"
    key_material = hashlib.pbkdf2_hmac(
        "sha256",
        secret.encode("utf-8"),
        salt,
        iterations=100000,
        dklen=32,
    )

    # Fernet requires base64-encoded 32-byte key
    return base64.urlsafe_b64encode(key_material)


def _get_fernet() -> Fernet:
    """Get a Fernet instance for encryption/decryption."""
    return Fernet(_get_encryption_key())


def encrypt_string(plaintext: str) -> str:
    """Encrypt a string value.

    Args:
        plaintext: The string to encrypt.

    Returns:
        Base64-encoded encrypted string.

    Raises:
        EncryptionKeyError: If encryption key is not available.
    """
    if not plaintext:
        return plaintext

    fernet = _get_fernet()
    encrypted = fernet.encrypt(plaintext.encode("utf-8"))
    return encrypted.decode("utf-8")


def decrypt_string(ciphertext: str) -> str:
    """Decrypt an encrypted string value.

    Args:
        ciphertext: The base64-encoded encrypted string.

    Returns:
        Decrypted plaintext string.

    Raises:
        DecryptionError: If decryption fails (wrong key, corrupted data, etc.).
    """
    if not ciphertext:
        return ciphertext

    try:
        fernet = _get_fernet()
        decrypted = fernet.decrypt(ciphertext.encode("utf-8"))
        return decrypted.decode("utf-8")
    except InvalidToken as e:
        raise DecryptionError("Failed to decrypt data - invalid key or corrupted data") from e
    except Exception as e:
        raise DecryptionError(f"Decryption failed: {e}") from e


def is_encrypted(value: str) -> bool:
    """Check if a value appears to be encrypted (Fernet format).

    Args:
        value: The string to check.

    Returns:
        True if the value looks like Fernet-encrypted data.
    """
    if not value:
        return False

    # Fernet tokens are base64-encoded and start with 'gAAAAA'
    # (version byte + timestamp)
    try:
        return value.startswith("gAAAAA") and len(value) > 50
    except Exception:
        return False


def encrypt_if_needed(value: str) -> str:
    """Encrypt a value only if it's not already encrypted.

    Useful for migrating existing plaintext data.

    Args:
        value: The string to encrypt.

    Returns:
        Encrypted string (or already encrypted input).
    """
    if not value or is_encrypted(value):
        return value
    return encrypt_string(value)


def decrypt_if_needed(value: str) -> str:
    """Decrypt a value, or return as-is if not encrypted.

    Useful for handling both legacy plaintext and new encrypted data.

    Args:
        value: The string to decrypt.

    Returns:
        Decrypted string (or plaintext input if not encrypted).
    """
    if not value or not is_encrypted(value):
        return value

    try:
        return decrypt_string(value)
    except DecryptionError:
        # If decryption fails, assume it's plaintext (legacy data)
        return value


def encrypt_dict(data: dict[str, Any] | None) -> str | None:
    """Encrypt a dictionary as a JSON string.

    Used for encrypting env_vars and other sensitive dict fields at rest.

    Args:
        data: Dictionary to encrypt, or None.

    Returns:
        Encrypted JSON string, or None if input is None/empty.
    """
    if not data:
        return None
    json_str = json.dumps(data, sort_keys=True)
    return encrypt_string(json_str)


def decrypt_dict(encrypted: str | None) -> dict[str, Any]:
    """Decrypt an encrypted JSON string to a dictionary.

    Handles both encrypted data and legacy plaintext JSON for backward
    compatibility during migration.

    HIGH FIX: Uses strict type validation to prevent deserialization of
    malicious payloads that could cause unexpected behavior.

    Args:
        encrypted: Encrypted string, plaintext JSON, or None.

    Returns:
        Decrypted dictionary, or empty dict if input is None/empty.
    """
    if not encrypted:
        return {}

    def _validate_dict_values(obj: Any, depth: int = 0) -> bool:
        """Recursively validate dict contains only safe JSON types.

        HIGH FIX: Prevents deserialization of arbitrary Python objects.
        Only allows: str, int, float, bool, None, list, dict
        """
        if depth > 10:  # Prevent stack overflow from deeply nested data
            return False

        if obj is None or isinstance(obj, (str, int, float, bool)):
            return True
        if isinstance(obj, list):
            return all(_validate_dict_values(item, depth + 1) for item in obj)
        if isinstance(obj, dict):
            return all(
                isinstance(k, str) and _validate_dict_values(v, depth + 1) for k, v in obj.items()
            )
        return False  # Reject unknown types

    # Handle legacy plaintext JSON (not yet encrypted)
    if not is_encrypted(encrypted):
        try:
            result = json.loads(encrypted)
            if not isinstance(result, dict):
                return {}
            # HIGH FIX: Validate all values are safe JSON types
            if not _validate_dict_values(result):
                return {}
            return result  # noqa: TRY300
        except (json.JSONDecodeError, TypeError):
            return {}

    # Decrypt and parse JSON
    try:
        decrypted = decrypt_string(encrypted)
        result = json.loads(decrypted)
        if not isinstance(result, dict):
            return {}
        # HIGH FIX: Validate all values are safe JSON types
        if not _validate_dict_values(result):
            return {}
        return result  # noqa: TRY300
    except (DecryptionError, json.JSONDecodeError, TypeError):
        # If decryption or parsing fails, return empty dict
        return {}
