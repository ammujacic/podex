"""SSL certificate verification and OS-specific guidance for local pod."""

import platform
import ssl
import sys
from dataclasses import dataclass
from pathlib import Path


@dataclass
class SSLCheckResult:
    """Result of SSL certificate check."""

    ok: bool
    error: str | None = None
    cert_file: str | None = None


@dataclass
class SSLFixInstructions:
    """OS-specific instructions for fixing SSL certificate issues."""

    os_name: str
    summary: str
    steps: list[str]
    alternative: str | None = None


def check_ssl_certificates() -> SSLCheckResult:
    """Check if SSL certificates are properly configured.

    Returns:
        SSLCheckResult with status and any error details.
    """
    try:
        # Get the default SSL context
        context = ssl.create_default_context()

        # Check if we have CA certificates loaded
        # This will raise an error if no certificates are available
        cert_stats = context.cert_store_stats()

        if cert_stats.get("x509_ca", 0) == 0:
            return SSLCheckResult(
                ok=False,
                error="No CA certificates found in the certificate store",
            )

        # Get the certificate file path if available
        paths = ssl.get_default_verify_paths()
        cert_file = paths.cafile or paths.openssl_cafile

        return SSLCheckResult(ok=True, cert_file=cert_file)

    except ssl.SSLError as e:
        return SSLCheckResult(ok=False, error=str(e))
    except Exception as e:
        return SSLCheckResult(ok=False, error=f"Unexpected error: {e}")


def is_ssl_certificate_error(error: BaseException) -> bool:
    """Check if an error is related to SSL certificate verification.

    Args:
        error: The exception to check.

    Returns:
        True if this is an SSL certificate verification error.
    """
    error_str = str(error).lower()

    ssl_indicators = [
        "ssl",
        "certificate",
        "cert",
        "sslcertverificationerror",
        "certificate_verify_failed",
        "unable to get local issuer certificate",
        "self signed certificate",
        "certificate has expired",
    ]

    return any(indicator in error_str for indicator in ssl_indicators)


def get_ssl_fix_instructions() -> SSLFixInstructions:
    """Get OS-specific instructions for fixing SSL certificate issues.

    Returns:
        SSLFixInstructions with steps for the current OS.
    """
    system = platform.system().lower()
    python_version = f"{sys.version_info.major}.{sys.version_info.minor}"

    if system == "darwin":  # macOS
        return SSLFixInstructions(
            os_name="macOS",
            summary="Python on macOS needs certificates installed separately.",
            steps=[
                "Run the certificate installer that comes with Python:",
                f"  /Applications/Python\\ {python_version}/Install\\ Certificates.command",
                "",
                "If that file doesn't exist, try:",
                "  pip install --upgrade certifi",
                '  python -c "import certifi; print(certifi.where())"',
            ],
            alternative=(
                "Or set the SSL_CERT_FILE environment variable:\n"
                "  export SSL_CERT_FILE=/etc/ssl/cert.pem\n"
                "  # Add to ~/.zshrc to make permanent"
            ),
        )

    elif system == "linux":
        # Detect Linux distribution
        distro = _detect_linux_distro()

        if distro in ("ubuntu", "debian"):
            return SSLFixInstructions(
                os_name="Ubuntu/Debian",
                summary="CA certificates package may need to be installed or updated.",
                steps=[
                    "Install or update CA certificates:",
                    "  sudo apt-get update",
                    "  sudo apt-get install --reinstall ca-certificates",
                    "",
                    "If using a virtual environment, also try:",
                    "  pip install --upgrade certifi",
                ],
                alternative=(
                    "If certificates are in a custom location:\n"
                    "  export SSL_CERT_FILE=/path/to/ca-bundle.crt\n"
                    "  export SSL_CERT_DIR=/etc/ssl/certs"
                ),
            )

        elif distro in ("fedora", "rhel", "centos", "rocky", "almalinux"):
            return SSLFixInstructions(
                os_name="Fedora/RHEL",
                summary="CA certificates package may need to be installed or updated.",
                steps=[
                    "Install or update CA certificates:",
                    "  sudo dnf install ca-certificates",
                    "  sudo update-ca-trust",
                    "",
                    "If using a virtual environment, also try:",
                    "  pip install --upgrade certifi",
                ],
            )

        elif distro in ("arch", "manjaro"):
            return SSLFixInstructions(
                os_name="Arch Linux",
                summary="CA certificates package may need to be installed.",
                steps=[
                    "Install CA certificates:",
                    "  sudo pacman -S ca-certificates",
                    "",
                    "If using a virtual environment:",
                    "  pip install --upgrade certifi",
                ],
            )

        else:
            # Generic Linux
            return SSLFixInstructions(
                os_name="Linux",
                summary="CA certificates may need to be installed.",
                steps=[
                    "Install CA certificates using your package manager:",
                    "  # Debian/Ubuntu: sudo apt install ca-certificates",
                    "  # Fedora/RHEL: sudo dnf install ca-certificates",
                    "  # Arch: sudo pacman -S ca-certificates",
                    "",
                    "Or install certifi for Python:",
                    "  pip install --upgrade certifi",
                ],
                alternative=(
                    "Set SSL_CERT_FILE if certificates are in a custom location:\n"
                    "  export SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt"
                ),
            )

    elif system == "windows":
        return SSLFixInstructions(
            os_name="Windows",
            summary="Python may not be finding the Windows certificate store.",
            steps=[
                "Install or upgrade certifi:",
                "  pip install --upgrade certifi",
                "",
                "If using a corporate proxy or firewall, you may need to:",
                "  1. Export your corporate CA certificate",
                "  2. Add it to certifi's certificate bundle, or",
                "  3. Set SSL_CERT_FILE to point to your certificate bundle",
            ],
            alternative=(
                "If behind a corporate proxy:\n"
                "  set SSL_CERT_FILE=C:\\path\\to\\corporate-ca-bundle.crt"
            ),
        )

    else:
        # Unknown OS
        return SSLFixInstructions(
            os_name=system,
            summary="SSL certificates may not be properly configured.",
            steps=[
                "Try installing certifi:",
                "  pip install --upgrade certifi",
                "",
                "Or set the SSL_CERT_FILE environment variable to your CA bundle.",
            ],
        )


def format_ssl_error_message(original_error: str | None = None) -> str:
    """Format a user-friendly SSL error message with fix instructions.

    Args:
        original_error: The original error message, if available.

    Returns:
        Formatted error message with instructions.
    """
    instructions = get_ssl_fix_instructions()

    lines = [
        "",
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        "  SSL Certificate Error",
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        "",
        f"  {instructions.summary}",
        "",
        f"  How to fix on {instructions.os_name}:",
        "",
    ]

    for step in instructions.steps:
        if step:
            lines.append(f"  {step}")
        else:
            lines.append("")

    if instructions.alternative:
        lines.append("")
        lines.append("  Alternative:")
        for alt_line in instructions.alternative.split("\n"):
            lines.append(f"  {alt_line}")

    lines.extend(
        [
            "",
            "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        ]
    )

    if original_error:
        lines.extend(
            [
                "",
                f"  Original error: {original_error}",
                "",
            ]
        )

    return "\n".join(lines)


def _detect_linux_distro() -> str:
    """Detect the Linux distribution.

    Returns:
        Lowercase distribution name, or "unknown".
    """
    # Try /etc/os-release first (modern standard)
    os_release = Path("/etc/os-release")
    if os_release.exists():
        try:
            content = os_release.read_text()
            for line in content.splitlines():
                if line.startswith("ID="):
                    return line.split("=", 1)[1].strip().strip('"').lower()
        except Exception:
            pass

    # Fallback to checking specific files
    distro_files = {
        "/etc/debian_version": "debian",
        "/etc/fedora-release": "fedora",
        "/etc/redhat-release": "rhel",
        "/etc/arch-release": "arch",
    }

    for path, distro in distro_files.items():
        if Path(path).exists():
            return distro

    return "unknown"
