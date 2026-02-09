"""Password complexity validation utilities."""

import re
from dataclasses import dataclass

from src.config import settings

# Password strength scoring constants
LENGTH_SHORT = 8
LENGTH_MEDIUM = 12
LENGTH_LONG = 16
UNIQUE_CHARS_MEDIUM = 8
UNIQUE_CHARS_HIGH = 12

# Strength rating thresholds
STRENGTH_WEAK = 2
STRENGTH_FAIR = 4
STRENGTH_GOOD = 6
STRENGTH_STRONG = 8


@dataclass
class PasswordValidationResult:
    """Result of password validation."""

    is_valid: bool
    errors: list[str]


def validate_password(password: str) -> PasswordValidationResult:
    """Validate password meets complexity requirements.

    Requirements:
    - Minimum length (configurable, default 8)
    - At least one uppercase letter
    - At least one lowercase letter
    - At least one digit
    - At least one special character
    - Not a commonly breached password

    Args:
        password: The password to validate

    Returns:
        PasswordValidationResult with is_valid flag and list of errors
    """
    errors: list[str] = []

    # Length check
    min_length = settings.PASSWORD_MIN_LENGTH
    if len(password) < min_length:
        errors.append(f"Password must be at least {min_length} characters long")

    max_length = settings.PASSWORD_MAX_LENGTH
    if len(password) > max_length:
        errors.append(f"Password must be no more than {max_length} characters long")

    # Complexity requirements (only in production or if enforced)
    if settings.PASSWORD_REQUIRE_COMPLEXITY:
        # Uppercase letter
        if not re.search(r"[A-Z]", password):
            errors.append("Password must contain at least one uppercase letter")

        # Lowercase letter
        if not re.search(r"[a-z]", password):
            errors.append("Password must contain at least one lowercase letter")

        # Digit
        if not re.search(r"\d", password):
            errors.append("Password must contain at least one number")

        # Special character
        if not re.search(r"[!@#$%^&*()_+\-=\[\]{};':\"\\|,.<>\/?~`]", password):
            errors.append("Password must contain at least one special character")

    # Check against common passwords
    if settings.PASSWORD_CHECK_COMMON and _is_common_password(password):
        errors.append("This password is too common. Please choose a more unique password")

    return PasswordValidationResult(is_valid=len(errors) == 0, errors=errors)


def _is_common_password(password: str) -> bool:
    """Check if password is in the list of commonly breached passwords.

    This is a small subset of the most common passwords.
    In production, consider using a more comprehensive list.
    """
    # Top 100 most common passwords (lowercase for case-insensitive check)
    common_passwords = {
        "123456",
        "password",
        "12345678",
        "qwerty",
        "123456789",
        "12345",
        "1234",
        "111111",
        "1234567",
        "dragon",
        "123123",
        "baseball",
        "abc123",
        "football",
        "monkey",
        "letmein",
        "696969",
        "shadow",
        "master",
        "666666",
        "qwertyuiop",
        "123321",
        "mustang",
        "1234567890",
        "michael",
        "654321",
        "pussy",
        "superman",
        "1qaz2wsx",
        "7777777",
        "fuckyou",
        "121212",
        "000000",
        "qazwsx",
        "123qwe",
        "killer",
        "trustno1",
        "jordan",
        "jennifer",
        "zxcvbnm",
        "asdfgh",
        "hunter",
        "buster",
        "soccer",
        "harley",
        "batman",
        "andrew",
        "tigger",
        "sunshine",
        "iloveyou",
        "fuckme",
        "2000",
        "charlie",
        "robert",
        "thomas",
        "hockey",
        "ranger",
        "daniel",
        "starwars",
        "klaster",
        "112233",
        "george",
        "asshole",
        "computer",
        "michelle",
        "jessica",
        "pepper",
        "1111",
        "zxcvbn",
        "555555",
        "11111111",
        "131313",
        "freedom",
        "777777",
        "pass",
        "fuck",
        "maggie",
        "159753",
        "aaaaaa",
        "ginger",
        "princess",
        "joshua",
        "cheese",
        "amanda",
        "summer",
        "love",
        "ashley",
        "6969",
        "nicole",
        "chelsea",
        "biteme",
        "matthew",
        "access",
        "yankees",
        "987654321",
        "dallas",
        "austin",
        "thunder",
        "taylor",
        "matrix",
        "password1",
        "password123",
        "admin",
        "admin123",
        "root",
        "toor",
        "guest",
        "qwerty123",
        "welcome",
        "welcome1",
        "welcome123",
        "letmein1",
        "passw0rd",
        "p@ssw0rd",
        "p@ssword",
    }

    # Case-insensitive check
    return password.lower() in common_passwords


def get_password_strength(password: str) -> str:
    """Get a qualitative strength rating for a password.

    Args:
        password: The password to rate

    Returns:
        One of: "weak", "fair", "good", "strong", "very_strong"
    """
    score = _calculate_strength_score(password)
    return _score_to_rating(score)


def _calculate_strength_score(password: str) -> int:
    """Calculate password strength score."""
    score = 0

    # Length scoring
    length = len(password)
    score += sum(
        [
            length >= LENGTH_SHORT,
            length >= LENGTH_MEDIUM,
            length >= LENGTH_LONG,
        ]
    )

    # Complexity scoring (has lowercase, uppercase, digit, special)
    patterns = [r"[a-z]", r"[A-Z]", r"\d", r"[!@#$%^&*()_+\-=\[\]{};':\"\\|,.<>\/?~`]"]
    score += sum(1 for p in patterns if re.search(p, password))

    # Variety bonus
    unique_chars = len(set(password))
    score += (unique_chars >= UNIQUE_CHARS_MEDIUM) + (unique_chars >= UNIQUE_CHARS_HIGH)

    # Penalties
    if _is_common_password(password):
        score = max(0, score - 3)

    score -= _count_sequential_patterns(password)
    return max(0, score)


def _count_sequential_patterns(password: str) -> int:
    """Count sequential pattern penalties."""
    penalty = 0
    # Numeric sequences
    if re.search(r"(012|123|234|345|456|567|678|789|890)", password):
        penalty += 1
    # Alphabetic sequences (check on lowercase)
    alpha_seq = (
        r"(abc|bcd|cde|def|efg|fgh|ghi|hij|ijk|jkl|klm|lmn|"
        r"mno|nop|opq|pqr|qrs|rst|stu|tuv|uvw|vwx|wxy|xyz)"
    )
    if re.search(alpha_seq, password.lower()):
        penalty += 1
    return penalty


def _score_to_rating(score: int) -> str:
    """Convert numeric score to strength rating."""
    if score <= STRENGTH_WEAK:
        return "weak"
    if score <= STRENGTH_FAIR:
        return "fair"
    if score <= STRENGTH_GOOD:
        return "good"
    if score <= STRENGTH_STRONG:
        return "strong"
    return "very_strong"
