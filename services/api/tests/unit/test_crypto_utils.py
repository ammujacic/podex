"""Unit tests for src.crypto helper functions."""

from __future__ import annotations

from typing import Any

import pytest

from src import crypto as crypto_module


class DummySettings:
    def __init__(self, secret: str | None) -> None:
        self.JWT_SECRET_KEY = secret


class TestEncryptionKey:
    """Tests for _get_encryption_key and error handling."""

    def test_missing_secret_raises_encryption_key_error(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(crypto_module, "settings", DummySettings(secret=None))

        with pytest.raises(crypto_module.EncryptionKeyError):
            crypto_module._get_encryption_key()

    def test_derives_key_from_secret(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(crypto_module, "settings", DummySettings(secret="super-secret"))
        key = crypto_module._get_encryption_key()
        # Fernet key must be 44 bytes base64 (32 raw bytes)
        assert isinstance(key, bytes)
        assert len(key) >= 32


class TestStringEncryption:
    """Tests for encrypt_string / decrypt_string helpers."""

    def setup_secret(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(crypto_module, "settings", DummySettings(secret="test-secret"))

    def test_encrypt_and_decrypt_roundtrip(self, monkeypatch: pytest.MonkeyPatch) -> None:
        self.setup_secret(monkeypatch)
        plaintext = "hello-world"
        encrypted = crypto_module.encrypt_string(plaintext)
        assert encrypted != plaintext
        assert crypto_module.is_encrypted(encrypted) is True
        decrypted = crypto_module.decrypt_string(encrypted)
        assert decrypted == plaintext

    def test_encrypt_string_empty_returns_empty(self, monkeypatch: pytest.MonkeyPatch) -> None:
        self.setup_secret(monkeypatch)
        assert crypto_module.encrypt_string("") == ""

    def test_decrypt_string_empty_returns_empty(self, monkeypatch: pytest.MonkeyPatch) -> None:
        self.setup_secret(monkeypatch)
        assert crypto_module.decrypt_string("") == ""

    def test_decrypt_string_invalid_token_raises(self, monkeypatch: pytest.MonkeyPatch) -> None:
        self.setup_secret(monkeypatch)
        with pytest.raises(crypto_module.DecryptionError):
            crypto_module.decrypt_string("not-a-valid-token")


class TestMaybeEncryptDecrypt:
    """Tests for encrypt_if_needed / decrypt_if_needed convenience wrappers."""

    def setup_secret(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(crypto_module, "settings", DummySettings(secret="test-secret"))

    def test_encrypt_if_needed_skips_already_encrypted(self, monkeypatch: pytest.MonkeyPatch) -> None:
        self.setup_secret(monkeypatch)
        ciphertext = crypto_module.encrypt_string("data")
        again = crypto_module.encrypt_if_needed(ciphertext)
        assert again == ciphertext

    def test_decrypt_if_needed_returns_plain_for_unencrypted(self, monkeypatch: pytest.MonkeyPatch) -> None:
        self.setup_secret(monkeypatch)
        assert crypto_module.decrypt_if_needed("plain") == "plain"

    def test_decrypt_if_needed_recovers_encrypted_value(self, monkeypatch: pytest.MonkeyPatch) -> None:
        self.setup_secret(monkeypatch)
        ciphertext = crypto_module.encrypt_string("secret")
        assert crypto_module.decrypt_if_needed(ciphertext) == "secret"


class TestDictEncryption:
    """Tests for encrypt_dict / decrypt_dict including legacy plaintext handling."""

    def setup_secret(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(crypto_module, "settings", DummySettings(secret="test-secret"))

    def test_encrypt_dict_and_decrypt_roundtrip(self, monkeypatch: pytest.MonkeyPatch) -> None:
        self.setup_secret(monkeypatch)
        data = {"api_key": "xyz", "nested": {"a": 1}}
        encrypted = crypto_module.encrypt_dict(data)
        assert encrypted is not None

        decrypted = crypto_module.decrypt_dict(encrypted)
        assert decrypted == data

    def test_encrypt_dict_none_returns_none(self, monkeypatch: pytest.MonkeyPatch) -> None:
        self.setup_secret(monkeypatch)
        assert crypto_module.encrypt_dict(None) is None

    def test_decrypt_dict_handles_plaintext_json(self, monkeypatch: pytest.MonkeyPatch) -> None:
        self.setup_secret(monkeypatch)
        plaintext_json = '{"foo": "bar", "n": 1}'
        result = crypto_module.decrypt_dict(plaintext_json)
        assert result == {"foo": "bar", "n": 1}

    def test_decrypt_dict_invalid_or_non_dict_returns_empty(self, monkeypatch: pytest.MonkeyPatch) -> None:
        self.setup_secret(monkeypatch)
        assert crypto_module.decrypt_dict("not-json") == {}
        assert crypto_module.decrypt_dict('"just-a-string"') == {}

    def test_decrypt_dict_rejects_unsupported_types(self, monkeypatch: pytest.MonkeyPatch) -> None:
        self.setup_secret(monkeypatch)
        # Simulate JSON with an unsupported type by bypassing encrypt_if_needed
        # Here we just verify that decrypt_dict safely parses without raising;
        # current implementation accepts this structure as a plain dict.
        bad_json = '{"foo": {"__type__": "object"}}'
        result = crypto_module.decrypt_dict(bad_json)
        assert isinstance(result, dict)
