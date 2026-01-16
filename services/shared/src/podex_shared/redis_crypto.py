"""Redis encryption utilities for transparent data encryption at rest.

Provides optional encryption for Redis values using Fernet symmetric encryption.
When REDIS_ENCRYPTION_KEY is set, all string values are encrypted before storage
and decrypted on retrieval. Backward compatible with existing plaintext data.
"""

import base64
import hashlib
import os
from functools import lru_cache

import structlog
from cryptography.fernet import Fernet, InvalidToken

logger = structlog.get_logger()

# Marker prefix for encrypted values (Fernet tokens start with gAAAAA)
_ENCRYPTED_PREFIX = "gAAAAA"


@lru_cache(maxsize=1)
def _get_encryption_key() -> bytes | None:
    """Derive encryption key from REDIS_ENCRYPTION_KEY environment variable.

    Uses PBKDF2 to derive a 32-byte key from the secret, ensuring consistent
    key derivation across all service instances.

    Returns:
        Base64-encoded 32-byte key for Fernet, or None if not configured.
    """
    secret = os.environ.get("REDIS_ENCRYPTION_KEY")
    if not secret:
        return None

    # Derive key using PBKDF2 (same pattern as main crypto module)
    key_material = hashlib.pbkdf2_hmac(
        "sha256",
        secret.encode("utf-8"),
        b"podex-redis-encryption-v1",
        iterations=100000,
        dklen=32,
    )
    return base64.urlsafe_b64encode(key_material)


@lru_cache(maxsize=1)
def _get_fernet() -> Fernet | None:
    """Get Fernet instance for encryption/decryption.

    Returns:
        Fernet instance if encryption is configured, None otherwise.
    """
    key = _get_encryption_key()
    if key is None:
        return None
    return Fernet(key)


def is_encryption_enabled() -> bool:
    """Check if Redis encryption is enabled."""
    return _get_encryption_key() is not None


def encrypt_value(value: str) -> str:
    """Encrypt a string value for Redis storage.

    If encryption is not configured, returns the value unchanged.

    Args:
        value: The string value to encrypt.

    Returns:
        Encrypted value (Fernet token) or original value if encryption disabled.
    """
    if not value:
        return value

    fernet = _get_fernet()
    if fernet is None:
        return value

    try:
        encrypted = fernet.encrypt(value.encode("utf-8"))
        return encrypted.decode("utf-8")
    except Exception:
        logger.exception("Failed to encrypt Redis value")
        return value


def decrypt_value(value: str) -> str:
    """Decrypt a string value from Redis.

    Handles both encrypted and plaintext values for backward compatibility.
    If the value doesn't look encrypted or decryption fails, returns as-is.

    Args:
        value: The string value to decrypt.

    Returns:
        Decrypted value or original value if not encrypted/decryption fails.
    """
    if not value:
        return value

    # Check if value looks encrypted (Fernet tokens start with gAAAAA)
    if not value.startswith(_ENCRYPTED_PREFIX):
        return value

    fernet = _get_fernet()
    if fernet is None:
        # Encryption key not configured but value looks encrypted
        # This could happen if key was removed - log warning
        logger.warning("Encrypted Redis value found but encryption key not configured")
        return value

    try:
        decrypted = fernet.decrypt(value.encode("utf-8"))
        return decrypted.decode("utf-8")
    except InvalidToken:
        # Value might look encrypted but isn't, or key mismatch
        logger.warning("Failed to decrypt Redis value - returning as-is")
        return value
    except Exception:
        logger.exception("Unexpected error decrypting Redis value")
        return value


def clear_key_cache() -> None:
    """Clear the cached encryption key. Useful for testing."""
    _get_encryption_key.cache_clear()
    _get_fernet.cache_clear()
