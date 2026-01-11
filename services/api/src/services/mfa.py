"""Multi-Factor Authentication (MFA/2FA) service using TOTP."""

import base64
import hashlib
import io
import secrets
from dataclasses import dataclass
from typing import Any

import pyotp
import qrcode
import structlog

logger = structlog.get_logger()

# Number of backup codes to generate
BACKUP_CODE_COUNT = 10
BACKUP_CODE_LENGTH = 8
TOTP_CODE_LENGTH = 6


@dataclass
class MFASetupResult:
    """Result of MFA setup initialization."""

    secret: str
    qr_code_base64: str
    provisioning_uri: str
    backup_codes: list[str]


@dataclass
class MFAVerificationResult:
    """Result of MFA verification."""

    success: bool
    used_backup_code: bool = False
    error: str | None = None


class MFAService:
    """Service for managing TOTP-based multi-factor authentication."""

    # Application name used in authenticator apps
    _ISSUER = "Podex"

    def __init__(self) -> None:
        """Initialize the MFA service."""
        self._issuer = self._ISSUER

    def generate_secret(self) -> str:
        """Generate a new TOTP secret.

        Returns:
            Base32-encoded secret key.
        """
        return pyotp.random_base32()

    def generate_provisioning_uri(self, secret: str, email: str) -> str:
        """Generate a provisioning URI for authenticator apps.

        Args:
            secret: The TOTP secret.
            email: User's email address.

        Returns:
            otpauth:// URI for QR code generation.
        """
        totp = pyotp.TOTP(secret)
        return totp.provisioning_uri(name=email, issuer_name=self._issuer)

    def generate_qr_code(self, provisioning_uri: str) -> str:
        """Generate a QR code as base64-encoded PNG.

        Args:
            provisioning_uri: The otpauth:// URI.

        Returns:
            Base64-encoded PNG image.
        """
        qr = qrcode.QRCode(version=1, box_size=10, border=5)
        qr.add_data(provisioning_uri)
        qr.make(fit=True)
        img: Any = qr.make_image(fill_color="black", back_color="white")

        buffer = io.BytesIO()
        img.save(buffer, format="PNG")
        buffer.seek(0)

        return base64.b64encode(buffer.getvalue()).decode("utf-8")

    def generate_backup_codes(self) -> list[str]:
        """Generate a list of backup codes.

        Returns:
            List of plaintext backup codes.
        """
        return [
            secrets.token_hex(BACKUP_CODE_LENGTH // 2).upper() for _ in range(BACKUP_CODE_COUNT)
        ]

    def hash_backup_code(self, code: str) -> str:
        """Hash a backup code for storage.

        Args:
            code: Plaintext backup code.

        Returns:
            Hashed backup code.
        """
        return hashlib.sha256(code.encode()).hexdigest()

    def hash_backup_codes(self, codes: list[str]) -> list[str]:
        """Hash a list of backup codes for storage.

        Args:
            codes: List of plaintext backup codes.

        Returns:
            List of hashed backup codes.
        """
        return [self.hash_backup_code(code) for code in codes]

    def setup_mfa(self, email: str) -> MFASetupResult:
        """Initialize MFA setup for a user.

        Args:
            email: User's email address.

        Returns:
            MFASetupResult with secret, QR code, and backup codes.
        """
        secret = self.generate_secret()
        provisioning_uri = self.generate_provisioning_uri(secret, email)
        qr_code = self.generate_qr_code(provisioning_uri)
        backup_codes = self.generate_backup_codes()

        return MFASetupResult(
            secret=secret,
            qr_code_base64=qr_code,
            provisioning_uri=provisioning_uri,
            backup_codes=backup_codes,
        )

    def verify_totp(self, secret: str, code: str) -> bool:
        """Verify a TOTP code.

        Args:
            secret: The user's TOTP secret.
            code: The TOTP code to verify.

        Returns:
            True if the code is valid.
        """
        totp = pyotp.TOTP(secret)
        # Allow 1 time step tolerance for clock drift
        return totp.verify(code, valid_window=1)

    def verify_backup_code(self, code: str, hashed_codes: list[str]) -> tuple[bool, list[str]]:
        """Verify a backup code and return remaining codes.

        Args:
            code: The backup code to verify.
            hashed_codes: List of hashed backup codes.

        Returns:
            Tuple of (is_valid, remaining_hashed_codes).
        """
        code_hash = self.hash_backup_code(code.upper().replace("-", ""))

        if code_hash in hashed_codes:
            remaining = [h for h in hashed_codes if h != code_hash]
            return True, remaining

        return False, hashed_codes

    def verify_mfa(
        self,
        code: str,
        secret: str | None,
        hashed_backup_codes: list[str] | None,
    ) -> tuple[MFAVerificationResult, list[str] | None]:
        """Verify an MFA code (TOTP or backup code).

        Args:
            code: The code to verify (TOTP or backup).
            secret: The user's TOTP secret.
            hashed_backup_codes: List of hashed backup codes.

        Returns:
            Tuple of (MFAVerificationResult, updated_backup_codes).
        """
        # Normalize the code (remove spaces/dashes, uppercase for backup codes)
        normalized_code = code.replace(" ", "").replace("-", "")

        # Check if this looks like a TOTP code (6 digits)
        is_totp_format = len(normalized_code) == TOTP_CODE_LENGTH and normalized_code.isdigit()

        # Try TOTP first
        if secret and is_totp_format and self.verify_totp(secret, normalized_code):
            return MFAVerificationResult(success=True), hashed_backup_codes

        # Try backup code
        if hashed_backup_codes:
            is_valid, remaining_codes = self.verify_backup_code(
                normalized_code, hashed_backup_codes
            )
            if is_valid:
                return (
                    MFAVerificationResult(success=True, used_backup_code=True),
                    remaining_codes,
                )

        return (
            MFAVerificationResult(success=False, error="Invalid verification code"),
            hashed_backup_codes,
        )


# Singleton instance
_mfa_service: MFAService | None = None


def get_mfa_service() -> MFAService:
    """Get the MFA service singleton."""
    global _mfa_service  # noqa: PLW0603
    if _mfa_service is None:
        _mfa_service = MFAService()
    return _mfa_service
