"""Tests for SSL certificate utilities in podex_local_pod.ssl_check."""

from __future__ import annotations

from typing import Any
from unittest import mock

import platform
import ssl

import pytest

from podex_local_pod import ssl_check


class TestCheckSSLCertificates:
    """Tests for check_ssl_certificates."""

    def test_check_ssl_certificates_ok(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Returns ok=True when cert store has CA certificates."""

        class FakeContext:
            def cert_store_stats(self) -> dict[str, int]:
                return {"x509_ca": 1}

        class FakePaths:
            cafile = "/etc/ssl/cert.pem"
            openssl_cafile = None

        monkeypatch.setattr(ssl, "create_default_context", lambda: FakeContext())
        monkeypatch.setattr(ssl, "get_default_verify_paths", lambda: FakePaths())

        result = ssl_check.check_ssl_certificates()
        assert result.ok is True
        assert result.error is None
        assert result.cert_file == "/etc/ssl/cert.pem"

    def test_check_ssl_certificates_no_certs(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Returns ok=False when no CA certificates are present."""

        class FakeContext:
            def cert_store_stats(self) -> dict[str, int]:
                return {"x509_ca": 0}

        monkeypatch.setattr(ssl, "create_default_context", lambda: FakeContext())

        result = ssl_check.check_ssl_certificates()
        assert result.ok is False
        assert "No CA certificates" in (result.error or "")

    def test_check_ssl_certificates_ssl_error(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Wraps ssl.SSLError into SSLCheckResult."""

        def raise_error() -> Any:
            raise ssl.SSLError("boom")

        monkeypatch.setattr(ssl, "create_default_context", raise_error)

        result = ssl_check.check_ssl_certificates()
        assert result.ok is False
        assert "boom" in (result.error or "")


class TestIsSSLCertificateError:
    """Tests for is_ssl_certificate_error."""

    def test_detects_common_ssl_messages(self) -> None:
        assert ssl_check.is_ssl_certificate_error(
            RuntimeError("certificate verify failed: unable to get local issuer certificate")
        )
        assert ssl_check.is_ssl_certificate_error(
            RuntimeError("SSL: self signed certificate in certificate chain")
        )

    def test_ignores_non_ssl_errors(self) -> None:
        assert not ssl_check.is_ssl_certificate_error(RuntimeError("network unreachable"))
        assert not ssl_check.is_ssl_certificate_error(RuntimeError("some random error"))


class TestGetSSLFixInstructions:
    """Tests for get_ssl_fix_instructions."""

    def test_mac_instructions(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(platform, "system", lambda: "Darwin")

        instructions = ssl_check.get_ssl_fix_instructions()
        assert instructions.os_name == "macOS"
        assert "Python on macOS" in instructions.summary

    def test_linux_distributions(self, monkeypatch: pytest.MonkeyPatch) -> None:
        # Ubuntu/Debian
        monkeypatch.setattr(platform, "system", lambda: "Linux")
        monkeypatch.setattr(ssl_check, "_detect_linux_distro", lambda: "ubuntu")
        deb = ssl_check.get_ssl_fix_instructions()
        assert deb.os_name == "Ubuntu/Debian"

        # Fedora/RHEL
        monkeypatch.setattr(ssl_check, "_detect_linux_distro", lambda: "fedora")
        fed = ssl_check.get_ssl_fix_instructions()
        assert fed.os_name == "Fedora/RHEL"

        # Arch
        monkeypatch.setattr(ssl_check, "_detect_linux_distro", lambda: "arch")
        arch = ssl_check.get_ssl_fix_instructions()
        assert arch.os_name == "Arch Linux"

        # Unknown
        monkeypatch.setattr(ssl_check, "_detect_linux_distro", lambda: "unknown")
        generic = ssl_check.get_ssl_fix_instructions()
        assert generic.os_name == "Linux"

    def test_windows_instructions(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(platform, "system", lambda: "Windows")
        instructions = ssl_check.get_ssl_fix_instructions()
        assert instructions.os_name == "Windows"
        assert "Windows certificate store" in instructions.summary

    def test_unknown_os_instructions(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(platform, "system", lambda: "FreeBSD")
        instructions = ssl_check.get_ssl_fix_instructions()
        assert instructions.os_name.lower().startswith("freebsd")


class TestFormatSSLErrorMessage:
    """Tests for format_ssl_error_message."""

    def test_includes_original_error_when_provided(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(platform, "system", lambda: "Linux")
        monkeypatch.setattr(ssl_check, "_detect_linux_distro", lambda: "ubuntu")

        message = ssl_check.format_ssl_error_message("certificate verify failed")

        assert "SSL Certificate Error" in message
        assert "Ubuntu/Debian" in message
        assert "Original error: certificate verify failed" in message
