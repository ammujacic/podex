"""Unit tests for EncryptedString and EncryptedJSON type decorators."""

from __future__ import annotations

from typing import Any

import pytest

from src.database import encrypted_types as enc


def test_encrypted_string_encrypts_and_decrypts(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_encrypt(value: str) -> str:
        return f"enc:{value}"

    def fake_decrypt(value: str) -> str:
        assert value.startswith("enc:")
        return value[4:]

    monkeypatch.setattr(enc, "encrypt_string", fake_encrypt)
    monkeypatch.setattr(enc, "decrypt_if_needed", fake_decrypt)

    t = enc.EncryptedString()
    assert t.process_bind_param("secret", None) == "enc:secret"
    assert t.process_bind_param(None, None) is None

    assert t.process_result_value("enc:secret", None) == "secret"
    assert t.process_result_value(None, None) is None


def test_encrypted_json_bind_param_handles_none_and_empty(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_encrypt(value: str) -> str:
        return f"enc:{value}"

    monkeypatch.setattr(enc, "encrypt_string", fake_encrypt)

    t = enc.EncryptedJSON()
    assert t.process_bind_param(None, None) is None
    assert t.process_bind_param({}, None) is None

    bound = t.process_bind_param({"a": 1}, None)
    assert isinstance(bound, str)
    assert bound.startswith("enc:")


def test_encrypted_json_result_value_plaintext_and_encrypted(monkeypatch: pytest.MonkeyPatch) -> None:
    t = enc.EncryptedJSON()

    # None -> empty dict
    assert t.process_result_value(None, None) == {}

    # Plaintext JSON (not encrypted)
    monkeypatch.setattr(enc, "is_encrypted", lambda v: False)
    assert t.process_result_value('{"a": 1}', None) == {"a": 1}
    # Non-dict JSON should yield {}
    assert t.process_result_value('["x"]', None) == {}

    # Encrypted path
    def fake_is_encrypted(value: str) -> bool:  # noqa: ARG001
        return True

    def fake_decrypt_if_needed(value: str) -> str:
        # Pretend we decrypted to JSON string
        return '{"b": 2}'

    monkeypatch.setattr(enc, "is_encrypted", fake_is_encrypted)
    monkeypatch.setattr(enc, "decrypt_if_needed", fake_decrypt_if_needed)

    assert t.process_result_value("ciphertext", None) == {"b": 2}
