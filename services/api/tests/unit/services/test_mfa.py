"""Unit tests for MFA service.

Tests TOTP-based multi-factor authentication with backup codes.
"""

from unittest.mock import MagicMock, patch

import pytest

from src.services.mfa import (
    BACKUP_CODE_COUNT,
    BACKUP_CODE_LENGTH,
    TOTP_CODE_LENGTH,
    MFAService,
    MFASetupResult,
    MFAVerificationResult,
    get_mfa_service,
)


@pytest.fixture
def mfa_service():
    """Create MFA service instance."""
    return MFAService()


@pytest.mark.unit
def test_mfa_service_init(mfa_service):
    """Test MFA service initialization."""
    assert mfa_service._issuer == "Podex"


@pytest.mark.unit
def test_encrypt_secret(mfa_service):
    """Test encrypting a TOTP secret."""
    with patch("src.services.mfa.encrypt_string", return_value="encrypted_value") as mock_encrypt:
        result = mfa_service.encrypt_secret("test_secret")

        assert result == "encrypted_value"
        mock_encrypt.assert_called_once_with("test_secret")


@pytest.mark.unit
def test_decrypt_secret(mfa_service):
    """Test decrypting a TOTP secret."""
    with patch(
        "src.services.mfa.decrypt_if_needed", return_value="decrypted_value"
    ) as mock_decrypt:
        result = mfa_service.decrypt_secret("encrypted_value")

        assert result == "decrypted_value"
        mock_decrypt.assert_called_once_with("encrypted_value")


@pytest.mark.unit
def test_generate_secret(mfa_service):
    """Test generating a new TOTP secret."""
    with patch("src.services.mfa.pyotp.random_base32", return_value="TESTBASE32SECRET"):
        result = mfa_service.generate_secret()

        assert result == "TESTBASE32SECRET"


@pytest.mark.unit
def test_generate_provisioning_uri(mfa_service):
    """Test generating provisioning URI for authenticator apps."""
    mock_totp = MagicMock()
    mock_totp.provisioning_uri.return_value = "otpauth://totp/test"

    with patch("src.services.mfa.pyotp.TOTP", return_value=mock_totp):
        result = mfa_service.generate_provisioning_uri("TEST_SECRET", "user@example.com")

        assert result == "otpauth://totp/test"
        mock_totp.provisioning_uri.assert_called_once_with(
            name="user@example.com", issuer_name="Podex"
        )


@pytest.mark.unit
def test_generate_qr_code(mfa_service):
    """Test generating QR code as base64 PNG."""
    result = mfa_service.generate_qr_code("otpauth://totp/Podex:test@example.com")

    # Should return base64-encoded string
    assert isinstance(result, str)
    assert len(result) > 0
    # Base64 string should only contain valid characters
    import base64

    try:
        decoded = base64.b64decode(result)
        # PNG files start with specific magic bytes
        assert decoded[:8] == b"\x89PNG\r\n\x1a\n"
    except Exception:
        pytest.fail("QR code is not valid base64-encoded PNG")


@pytest.mark.unit
def test_generate_backup_codes(mfa_service):
    """Test generating backup codes."""
    result = mfa_service.generate_backup_codes()

    assert len(result) == BACKUP_CODE_COUNT
    for code in result:
        assert isinstance(code, str)
        assert len(code) == BACKUP_CODE_LENGTH
        # Should be hex uppercase
        assert all(c in "0123456789ABCDEF" for c in code)


@pytest.mark.unit
def test_hash_backup_code(mfa_service):
    """Test hashing a single backup code."""
    code = "TESTCODE"
    result = mfa_service.hash_backup_code(code)

    # SHA256 hash is 64 hex characters
    assert len(result) == 64
    assert all(c in "0123456789abcdef" for c in result)

    # Same code should produce same hash
    result2 = mfa_service.hash_backup_code(code)
    assert result == result2


@pytest.mark.unit
def test_hash_backup_codes(mfa_service):
    """Test hashing multiple backup codes."""
    codes = ["CODE1", "CODE2", "CODE3"]
    result = mfa_service.hash_backup_codes(codes)

    assert len(result) == 3
    for hashed in result:
        assert len(hashed) == 64


@pytest.mark.unit
def test_setup_mfa(mfa_service):
    """Test complete MFA setup flow."""
    with patch.object(mfa_service, "generate_secret", return_value="TEST_SECRET"):
        with patch.object(mfa_service, "encrypt_secret", return_value="ENCRYPTED"):
            with patch.object(
                mfa_service, "generate_provisioning_uri", return_value="otpauth://test"
            ):
                with patch.object(mfa_service, "generate_qr_code", return_value="QR_BASE64"):
                    with patch.object(
                        mfa_service, "generate_backup_codes", return_value=["CODE1", "CODE2"]
                    ):
                        result = mfa_service.setup_mfa("test@example.com")

                        assert isinstance(result, MFASetupResult)
                        assert result.secret == "TEST_SECRET"
                        assert result.encrypted_secret == "ENCRYPTED"
                        assert result.provisioning_uri == "otpauth://test"
                        assert result.qr_code_base64 == "QR_BASE64"
                        assert result.backup_codes == ["CODE1", "CODE2"]


@pytest.mark.unit
def test_verify_totp_valid_code(mfa_service):
    """Test verifying a valid TOTP code."""
    mock_totp = MagicMock()
    mock_totp.verify.return_value = True

    with patch("src.services.mfa.pyotp.TOTP", return_value=mock_totp):
        result = mfa_service.verify_totp("TEST_SECRET", "123456")

        assert result is True
        mock_totp.verify.assert_called_once_with("123456", valid_window=1)


@pytest.mark.unit
def test_verify_totp_invalid_code(mfa_service):
    """Test verifying an invalid TOTP code."""
    mock_totp = MagicMock()
    mock_totp.verify.return_value = False

    with patch("src.services.mfa.pyotp.TOTP", return_value=mock_totp):
        result = mfa_service.verify_totp("TEST_SECRET", "000000")

        assert result is False


@pytest.mark.unit
def test_verify_backup_code_valid(mfa_service):
    """Test verifying a valid backup code."""
    code = "TESTCODE"
    code_hash = mfa_service.hash_backup_code(code)
    hashed_codes = [code_hash, "other_hash"]

    is_valid, remaining = mfa_service.verify_backup_code(code, hashed_codes)

    assert is_valid is True
    assert len(remaining) == 1
    assert code_hash not in remaining


@pytest.mark.unit
def test_verify_backup_code_invalid(mfa_service):
    """Test verifying an invalid backup code."""
    hashed_codes = ["hash1", "hash2"]

    is_valid, remaining = mfa_service.verify_backup_code("WRONGCODE", hashed_codes)

    assert is_valid is False
    assert remaining == hashed_codes


@pytest.mark.unit
def test_verify_backup_code_with_dashes(mfa_service):
    """Test verifying backup code with dashes (formatting)."""
    code = "TEST-CODE"
    code_hash = mfa_service.hash_backup_code("TESTCODE")  # Hash without dashes
    hashed_codes = [code_hash]

    is_valid, remaining = mfa_service.verify_backup_code(code, hashed_codes)

    assert is_valid is True


@pytest.mark.unit
def test_verify_mfa_with_valid_totp(mfa_service):
    """Test verifying MFA with valid TOTP code."""
    with patch.object(mfa_service, "verify_totp", return_value=True):
        result, backup_codes = mfa_service.verify_mfa("123456", "TEST_SECRET", ["hash1", "hash2"])

        assert isinstance(result, MFAVerificationResult)
        assert result.success is True
        assert result.used_backup_code is False
        assert backup_codes == ["hash1", "hash2"]


@pytest.mark.unit
def test_verify_mfa_with_valid_backup_code(mfa_service):
    """Test verifying MFA with valid backup code."""
    code = "TESTCODE12"
    code_hash = mfa_service.hash_backup_code(code)
    hashed_codes = [code_hash, "other_hash"]

    with patch.object(mfa_service, "verify_totp", return_value=False):
        result, remaining_codes = mfa_service.verify_mfa(code, "TEST_SECRET", hashed_codes)

        assert result.success is True
        assert result.used_backup_code is True
        assert len(remaining_codes) == 1
        assert code_hash not in remaining_codes


@pytest.mark.unit
def test_verify_mfa_with_invalid_code(mfa_service):
    """Test verifying MFA with invalid code."""
    with patch.object(mfa_service, "verify_totp", return_value=False):
        result, backup_codes = mfa_service.verify_mfa("000000", "TEST_SECRET", ["hash1"])

        assert result.success is False
        assert result.error == "Invalid verification code"
        assert backup_codes == ["hash1"]


@pytest.mark.unit
def test_verify_mfa_with_spaces_and_dashes(mfa_service):
    """Test verifying MFA code with spaces and dashes removed."""
    with patch.object(mfa_service, "verify_totp", return_value=True):
        result, _ = mfa_service.verify_mfa("123 456", "TEST_SECRET", [])

        assert result.success is True


@pytest.mark.unit
def test_verify_mfa_without_secret(mfa_service):
    """Test verifying MFA without TOTP secret (backup code only)."""
    code = "TESTCODE12"
    code_hash = mfa_service.hash_backup_code(code)

    result, remaining = mfa_service.verify_mfa(
        code,
        None,  # No TOTP secret
        [code_hash],
    )

    assert result.success is True
    assert result.used_backup_code is True


@pytest.mark.unit
def test_verify_mfa_without_backup_codes(mfa_service):
    """Test verifying MFA without backup codes (TOTP only)."""
    with patch.object(mfa_service, "verify_totp", return_value=True):
        result, remaining = mfa_service.verify_mfa(
            "123456",
            "TEST_SECRET",
            None,  # No backup codes
        )

        assert result.success is True
        assert remaining is None


@pytest.mark.unit
def test_verify_mfa_non_totp_format_no_backup(mfa_service):
    """Test verifying non-TOTP format code with no backup codes."""
    result, remaining = mfa_service.verify_mfa("LONGCODE123", "TEST_SECRET", None)

    assert result.success is False
    assert result.error == "Invalid verification code"


@pytest.mark.unit
def test_get_mfa_service_singleton():
    """Test MFA service singleton pattern."""
    service1 = get_mfa_service()
    service2 = get_mfa_service()

    assert service1 is service2
    assert isinstance(service1, MFAService)
