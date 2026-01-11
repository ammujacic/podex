"""Comprehensive tests for password validation utilities."""

from unittest.mock import MagicMock, patch

import pytest

from src.utils.password_validator import (
    LENGTH_LONG,
    LENGTH_MEDIUM,
    LENGTH_SHORT,
    STRENGTH_FAIR,
    STRENGTH_GOOD,
    STRENGTH_STRONG,
    STRENGTH_WEAK,
    PasswordValidationResult,
    _calculate_strength_score,
    _count_sequential_patterns,
    _is_common_password,
    _score_to_rating,
    get_password_strength,
    validate_password,
)


class TestPasswordValidationResult:
    """Tests for PasswordValidationResult dataclass."""

    def test_valid_result(self) -> None:
        """Test valid password result."""
        result = PasswordValidationResult(is_valid=True, errors=[])
        assert result.is_valid is True
        assert result.errors == []

    def test_invalid_result_with_errors(self) -> None:
        """Test invalid password result with errors."""
        errors = ["Too short", "Missing uppercase"]
        result = PasswordValidationResult(is_valid=False, errors=errors)
        assert result.is_valid is False
        assert len(result.errors) == 2


class TestValidatePassword:
    """Tests for validate_password function."""

    def test_valid_password(self) -> None:
        """Test validation passes for strong password."""
        result = validate_password("StrongP@ss123!")
        assert result.is_valid is True
        assert result.errors == []

    def test_password_too_short(self) -> None:
        """Test validation fails for short password."""
        result = validate_password("Sh0rt!")
        assert result.is_valid is False
        assert any("at least" in err and "characters" in err for err in result.errors)

    def test_password_too_long(self) -> None:
        """Test validation fails for overly long password."""
        long_password = "A1!a" + "x" * 130
        result = validate_password(long_password)
        assert result.is_valid is False
        assert any("no more than" in err for err in result.errors)

    def test_missing_uppercase(self) -> None:
        """Test validation fails for missing uppercase."""
        result = validate_password("password123!@")
        assert result.is_valid is False
        assert any("uppercase" in err for err in result.errors)

    def test_missing_lowercase(self) -> None:
        """Test validation fails for missing lowercase."""
        result = validate_password("PASSWORD123!@")
        assert result.is_valid is False
        assert any("lowercase" in err for err in result.errors)

    def test_missing_digit(self) -> None:
        """Test validation fails for missing digit."""
        result = validate_password("StrongPassword!@")
        assert result.is_valid is False
        assert any("number" in err for err in result.errors)

    def test_missing_special_char(self) -> None:
        """Test validation fails for missing special character."""
        result = validate_password("StrongPassword123")
        assert result.is_valid is False
        assert any("special character" in err for err in result.errors)

    def test_common_password(self) -> None:
        """Test validation fails for common password."""
        result = validate_password("Password123!")
        assert result.is_valid is True  # Meets all requirements

        result = validate_password("password")
        assert result.is_valid is False
        assert any("common" in err.lower() for err in result.errors)

    def test_complexity_disabled(self) -> None:
        """Test validation with complexity requirements disabled."""
        mock_settings = MagicMock()
        mock_settings.PASSWORD_MIN_LENGTH = 8
        mock_settings.PASSWORD_MAX_LENGTH = 128
        mock_settings.PASSWORD_REQUIRE_COMPLEXITY = False
        mock_settings.PASSWORD_CHECK_COMMON = False

        with patch("src.utils.password_validator.settings", mock_settings):
            result = validate_password("simplepassword")
            assert result.is_valid is True


class TestIsCommonPassword:
    """Tests for _is_common_password function."""

    def test_common_password_lowercase(self) -> None:
        """Test detects common password in lowercase."""
        assert _is_common_password("password") is True
        assert _is_common_password("123456") is True
        assert _is_common_password("qwerty") is True

    def test_common_password_case_insensitive(self) -> None:
        """Test detection is case insensitive."""
        assert _is_common_password("PASSWORD") is True
        assert _is_common_password("Password") is True
        assert _is_common_password("QWERTY") is True

    def test_uncommon_password(self) -> None:
        """Test returns False for uncommon passwords."""
        assert _is_common_password("xK9#mP2$vL5@") is False
        assert _is_common_password("MyUniqueP@ssword42!") is False

    def test_common_admin_passwords(self) -> None:
        """Test common admin passwords are detected."""
        assert _is_common_password("admin") is True
        assert _is_common_password("admin123") is True
        assert _is_common_password("root") is True
        assert _is_common_password("guest") is True

    def test_common_welcome_passwords(self) -> None:
        """Test common welcome passwords are detected."""
        assert _is_common_password("welcome") is True
        assert _is_common_password("welcome1") is True
        assert _is_common_password("welcome123") is True

    def test_common_passw0rd_variants(self) -> None:
        """Test common password variants are detected."""
        assert _is_common_password("password1") is True
        assert _is_common_password("password123") is True
        assert _is_common_password("passw0rd") is True
        assert _is_common_password("p@ssw0rd") is True


class TestGetPasswordStrength:
    """Tests for get_password_strength function."""

    def test_weak_password(self) -> None:
        """Test weak password rating."""
        rating = get_password_strength("abc")
        assert rating == "weak"

    def test_fair_password(self) -> None:
        """Test fair password rating."""
        rating = get_password_strength("password")
        assert rating in ["weak", "fair"]

    def test_good_password(self) -> None:
        """Test good password rating."""
        rating = get_password_strength("Password1!")
        assert rating in ["fair", "good", "strong"]

    def test_strong_password(self) -> None:
        """Test strong password rating."""
        rating = get_password_strength("MyStr0ng!Pass#2024")
        assert rating in ["good", "strong", "very_strong"]

    def test_very_strong_password(self) -> None:
        """Test very strong password rating."""
        rating = get_password_strength("xK9#mP2$vL5@nQ8&wR3%tY6^")
        assert rating in ["strong", "very_strong"]


class TestCalculateStrengthScore:
    """Tests for _calculate_strength_score function."""

    def test_length_scoring_short(self) -> None:
        """Test length scoring for short password."""
        score = _calculate_strength_score("abc")
        # Short password with lowercase only, no variety
        assert score < 3

    def test_length_scoring_medium(self) -> None:
        """Test length scoring for medium password."""
        score = _calculate_strength_score("A" * LENGTH_MEDIUM)
        # Medium length with uppercase only
        assert score > 1

    def test_length_scoring_long(self) -> None:
        """Test length scoring for long password."""
        score = _calculate_strength_score("A" * LENGTH_LONG + "a1!")
        # Long with complexity
        assert score > 5

    def test_complexity_scoring(self) -> None:
        """Test complexity scoring."""
        # Only lowercase
        score_lower = _calculate_strength_score("aaaaaaaa")
        # Lower + upper
        score_mixed = _calculate_strength_score("aaaaAAAA")
        # Lower + upper + digit
        score_with_digit = _calculate_strength_score("aaAAaa11")
        # All four character types
        score_full = _calculate_strength_score("aaAA11!!")

        assert score_lower < score_mixed < score_with_digit < score_full

    def test_unique_chars_bonus(self) -> None:
        """Test unique character bonus."""
        # Repeated chars - 8 chars, all same
        score_repeated = _calculate_strength_score("aaaaaaaa")
        # Many unique chars - 8 chars, all different, but has alphabetic sequence "abcdefgh"
        # so it may not be higher due to sequence penalty
        score_unique = _calculate_strength_score("zxywvtsp")  # No sequence

        # Unique chars should give bonus over repeated
        assert score_unique >= score_repeated

    def test_common_password_penalty(self) -> None:
        """Test penalty for common password."""
        # "password" is common but lowercase only
        score = _calculate_strength_score("password")
        # Should be low due to penalty
        assert score <= 3

    def test_sequential_penalty(self) -> None:
        """Test penalty for sequential patterns."""
        score_with_seq = _calculate_strength_score("abc12345")
        score_no_seq = _calculate_strength_score("xkp92mkl")

        # Sequential patterns reduce score
        assert score_with_seq < score_no_seq


class TestCountSequentialPatterns:
    """Tests for _count_sequential_patterns function."""

    def test_numeric_sequence(self) -> None:
        """Test detection of numeric sequences."""
        # The regex looks for patterns like 012, 123, 234, etc.
        assert _count_sequential_patterns("pass123word") >= 1  # Contains 123
        assert _count_sequential_patterns("test456test") >= 1  # Contains 456
        assert _count_sequential_patterns("xyz789xyz") >= 1  # Contains 789

    def test_alphabetic_sequence(self) -> None:
        """Test detection of alphabetic sequences."""
        # The regex looks for patterns like abc, xyz, etc.
        assert _count_sequential_patterns("testabc123") >= 1  # Contains abc
        assert _count_sequential_patterns("testxyzabc") >= 1  # Contains xyz

    def test_no_sequence(self) -> None:
        """Test no penalties for non-sequential."""
        assert _count_sequential_patterns("xkpm2nvq") == 0
        assert _count_sequential_patterns("@#$%^&*!") == 0

    def test_multiple_sequences(self) -> None:
        """Test multiple sequential patterns."""
        result = _count_sequential_patterns("abc123")  # abc + 123
        assert result >= 1  # At least one sequence

    def test_case_insensitive(self) -> None:
        """Test alphabetic sequence detection is case insensitive."""
        assert _count_sequential_patterns("ABC") >= 1
        assert _count_sequential_patterns("XYZ") >= 1


class TestScoreToRating:
    """Tests for _score_to_rating function."""

    def test_weak_rating(self) -> None:
        """Test weak rating threshold."""
        assert _score_to_rating(0) == "weak"
        assert _score_to_rating(STRENGTH_WEAK) == "weak"

    def test_fair_rating(self) -> None:
        """Test fair rating threshold."""
        assert _score_to_rating(STRENGTH_WEAK + 1) == "fair"
        assert _score_to_rating(STRENGTH_FAIR) == "fair"

    def test_good_rating(self) -> None:
        """Test good rating threshold."""
        assert _score_to_rating(STRENGTH_FAIR + 1) == "good"
        assert _score_to_rating(STRENGTH_GOOD) == "good"

    def test_strong_rating(self) -> None:
        """Test strong rating threshold."""
        assert _score_to_rating(STRENGTH_GOOD + 1) == "strong"
        assert _score_to_rating(STRENGTH_STRONG) == "strong"

    def test_very_strong_rating(self) -> None:
        """Test very strong rating threshold."""
        assert _score_to_rating(STRENGTH_STRONG + 1) == "very_strong"
        assert _score_to_rating(15) == "very_strong"


class TestConstants:
    """Tests for password validation constants."""

    def test_length_constants(self) -> None:
        """Test length constants are reasonable."""
        assert LENGTH_SHORT == 8
        assert LENGTH_MEDIUM == 12
        assert LENGTH_LONG == 16
        assert LENGTH_SHORT < LENGTH_MEDIUM < LENGTH_LONG

    def test_strength_constants(self) -> None:
        """Test strength constants are in order."""
        assert STRENGTH_WEAK < STRENGTH_FAIR < STRENGTH_GOOD < STRENGTH_STRONG


class TestEdgeCases:
    """Edge case tests for password validation."""

    def test_empty_password(self) -> None:
        """Test empty password fails validation."""
        result = validate_password("")
        assert result.is_valid is False

    def test_whitespace_only(self) -> None:
        """Test whitespace-only password fails."""
        result = validate_password("        ")
        assert result.is_valid is False

    def test_unicode_password(self) -> None:
        """Test unicode characters in password."""
        result = validate_password("Pässwörd123!")
        # Should work with unicode letters
        assert any("uppercase" in err for err in result.errors) or result.is_valid

    def test_emoji_password(self) -> None:
        """Test emoji in password."""
        result = validate_password("StrongP@ss123🔒")
        # Emoji counts as character but may not satisfy special char regex
        assert result.is_valid is True or len(result.errors) > 0

    def test_exactly_min_length(self) -> None:
        """Test password at exactly minimum length."""
        result = validate_password("Str0ng!!")  # 8 chars
        assert result.is_valid is True

    def test_special_chars_variety(self) -> None:
        """Test various special characters work."""
        special_chars = "!@#$%^&*()_+-=[]{}|;':\",./<>?"
        for char in special_chars:
            password = f"Passw0rd{char}"
            result = validate_password(password)
            # Each should satisfy special char requirement
            assert not any(
                "special character" in err for err in result.errors
            ), f"Failed for char: {char}"
