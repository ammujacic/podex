"""Sensitive data logging filter to prevent credential leakage.

SECURITY: This module provides a structlog processor that redacts sensitive
data from log output to prevent accidental credential exposure in logs.
"""

import re
from collections.abc import MutableMapping
from typing import Any

import structlog

# Sensitive field names that should always be redacted
SENSITIVE_FIELDS = frozenset(
    {
        # Authentication
        "password",
        "passwd",
        "pwd",
        "secret",
        "token",
        "access_token",
        "refresh_token",
        "id_token",
        "api_key",
        "apikey",
        "api-key",
        "auth",
        "authorization",
        "bearer",
        "credential",
        "credentials",
        # OAuth
        "client_secret",
        "client-secret",
        "oauth_token",
        "oauth_secret",
        "code",  # OAuth authorization code
        # Session
        "session_id",
        "sessionid",
        "session_token",
        "cookie",
        "cookies",
        "set-cookie",
        # Database
        "database_url",
        "db_password",
        "connection_string",
        # AWS
        "aws_secret_access_key",
        "aws_session_token",
        # Stripe
        "stripe_secret",
        "stripe_api_key",
        # Other
        "private_key",
        "privatekey",
        "ssh_key",
        "encryption_key",
        "signing_key",
        "jwt_secret",
        "mfa_secret",
        "otp_secret",
        "totp_secret",
        "recovery_code",
    }
)

# Patterns that look like sensitive data even if field name is unknown
SENSITIVE_PATTERNS = [
    # JWT tokens
    re.compile(r"eyJ[A-Za-z0-9_-]*\.eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*"),
    # Bearer tokens
    re.compile(r"Bearer\s+[A-Za-z0-9_-]+", re.IGNORECASE),
    # API keys (common formats)
    re.compile(r"sk[-_][A-Za-z0-9]{20,}"),  # Stripe-style
    re.compile(r"pk[-_][A-Za-z0-9]{20,}"),  # Public key style
    re.compile(r"api[-_]?key[-_:]?\s*[A-Za-z0-9]{16,}", re.IGNORECASE),
    # AWS credentials
    re.compile(r"AKIA[0-9A-Z]{16}"),  # AWS access key
    # GitHub tokens
    re.compile(r"gh[ps]_[A-Za-z0-9]{36,}"),
    re.compile(r"github_pat_[A-Za-z0-9_]{22,}"),
    # Generic long hex strings that could be secrets
    re.compile(r"[a-fA-F0-9]{40,}"),
]

REDACTED = "***REDACTED***"


def _is_sensitive_field(key: str) -> bool:
    """Check if a field name indicates sensitive data.

    Args:
        key: The field name to check.

    Returns:
        True if the field should be redacted.
    """
    key_lower = key.lower().replace("-", "_")
    return key_lower in SENSITIVE_FIELDS or any(
        sensitive in key_lower for sensitive in SENSITIVE_FIELDS
    )


def _redact_sensitive_value(value: str) -> str:
    """Redact sensitive patterns from a string value.

    Args:
        value: The string to check and potentially redact.

    Returns:
        The redacted string if it contains sensitive patterns.
    """
    for pattern in SENSITIVE_PATTERNS:
        if pattern.search(value):
            return REDACTED
    return value


def _redact_dict(data: MutableMapping[str, Any]) -> MutableMapping[str, Any]:
    """Recursively redact sensitive data from a dictionary.

    Args:
        data: Dictionary to redact (modified in place).

    Returns:
        The redacted dictionary.
    """
    for key in list(data.keys()):
        value = data[key]

        # Check if key indicates sensitive data
        if _is_sensitive_field(key):
            data[key] = REDACTED
            continue

        # Recursively process nested structures
        if isinstance(value, MutableMapping):
            _redact_dict(value)
        elif isinstance(value, list):
            data[key] = [
                _redact_dict(item)
                if isinstance(item, MutableMapping)
                else _redact_sensitive_value(str(item))
                if isinstance(item, str)
                else item
                for item in value
            ]
        elif isinstance(value, str):
            # Check for sensitive patterns in string values
            data[key] = _redact_sensitive_value(value)

    return data


def redact_sensitive_data(
    logger: structlog.types.WrappedLogger,  # noqa: ARG001
    method_name: str,  # noqa: ARG001
    event_dict: MutableMapping[str, Any],
) -> MutableMapping[str, Any]:
    """Structlog processor that redacts sensitive data from log events.

    SECURITY: This processor runs on all log events and removes or masks
    sensitive information like passwords, tokens, and API keys.

    Usage:
        Add to structlog configuration:
        structlog.configure(
            processors=[
                ...,
                redact_sensitive_data,
                ...,
            ]
        )

    Args:
        logger: The wrapped logger (unused).
        method_name: The logging method name (unused).
        event_dict: The event dictionary to process.

    Returns:
        The processed event dictionary with sensitive data redacted.
    """
    return _redact_dict(event_dict)


def configure_logging_filter() -> None:
    """Configure structlog with sensitive data redaction.

    Call this during application startup to ensure all logs are filtered.
    """
    # Get current processors
    current_processors = structlog.get_config().get("processors", [])

    # Check if our processor is already added
    processor_names = [getattr(p, "__name__", str(p)) for p in current_processors]
    if "redact_sensitive_data" in processor_names:
        return

    # Insert our processor early in the chain (after timestamper but before renderer)
    # Find a good insertion point
    insert_index = 0
    for i, proc in enumerate(current_processors):
        proc_name = getattr(proc, "__name__", str(proc))
        if "timestamp" in proc_name.lower():
            insert_index = i + 1
            break

    new_processors = list(current_processors)
    new_processors.insert(insert_index, redact_sensitive_data)

    # Reconfigure structlog with the new processors
    structlog.configure(processors=new_processors)

    structlog.get_logger().info("Sensitive data logging filter configured")
