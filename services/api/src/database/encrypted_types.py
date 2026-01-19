"""SQLAlchemy TypeDecorators for transparent field-level encryption.

These types handle encryption/decryption automatically when reading from
and writing to the database, providing a clean interface for storing
sensitive data at rest.
"""

import json
from typing import Any

from sqlalchemy import Text, TypeDecorator

from src.crypto import decrypt_if_needed, encrypt_string, is_encrypted


class EncryptedString(TypeDecorator[str]):
    """SQLAlchemy type for transparently encrypted string fields.

    Encrypts the value before storing in the database and decrypts
    when loading. Handles legacy plaintext values gracefully.

    Example:
        class User(Base):
            api_key: Mapped[str | None] = mapped_column(EncryptedString)
    """

    impl = Text
    cache_ok = True

    def process_bind_param(self, value: str | None, _dialect: Any) -> str | None:
        """Encrypt value before storing in database."""
        if value is None:
            return None
        return encrypt_string(value)

    def process_result_value(self, value: str | None, _dialect: Any) -> str | None:
        """Decrypt value after loading from database."""
        if value is None:
            return None
        return decrypt_if_needed(value)


class EncryptedJSON(TypeDecorator[dict[str, Any]]):
    """SQLAlchemy type for transparently encrypted JSON/dict fields.

    Serializes the dict to JSON, encrypts it, and stores as text.
    On load, decrypts and deserializes back to a dict.

    Handles legacy plaintext JSON values for backward compatibility
    during migration from unencrypted JSONB columns.

    Example:
        class MCPServer(Base):
            env_vars: Mapped[dict[str, str] | None] = mapped_column(EncryptedJSON)
    """

    impl = Text
    cache_ok = True

    def process_bind_param(self, value: dict[str, Any] | None, _dialect: Any) -> str | None:
        """Serialize and encrypt dict before storing."""
        if value is None:
            return None
        if not value:  # Empty dict
            return None
        json_str = json.dumps(value, sort_keys=True)
        return encrypt_string(json_str)

    def process_result_value(self, value: str | None, _dialect: Any) -> dict[str, Any]:
        """Decrypt and deserialize to dict after loading."""
        if value is None:
            return {}

        # Handle legacy plaintext JSON (pre-encryption data)
        if not is_encrypted(value):
            try:
                # Try parsing as JSON (legacy JSONB data or plaintext JSON string)
                result = json.loads(value)
                return result if isinstance(result, dict) else {}
            except (json.JSONDecodeError, TypeError):
                return {}

        # Decrypt and parse
        try:
            decrypted = decrypt_if_needed(value)
            result = json.loads(decrypted)
            return result if isinstance(result, dict) else {}
        except (json.JSONDecodeError, TypeError):
            return {}
