"""Tests for NativeManager proxy behavior."""

from __future__ import annotations

from typing import Any

import pytest

from podex_local_pod.config import LocalPodConfig
from podex_local_pod.native_manager import NativeManager


class DummyResponse:
    def __init__(self, status_code: int, content: bytes, headers: dict[str, str]) -> None:
        self.status_code = status_code
        self.content = content
        self.headers = headers


class TestNativeManagerProxy:
    """Tests for NativeManager.proxy_request."""

    @pytest.fixture
    def manager(self) -> NativeManager:
        return NativeManager(config=LocalPodConfig())

    @pytest.mark.asyncio
    async def test_proxy_request_success(self, manager: NativeManager, monkeypatch: pytest.MonkeyPatch) -> None:
        """Successful proxy request returns status/body/headers."""
        import httpx  # type: ignore[import-not-found]

        requested: dict[str, Any] = {}

        class FakeClient:
            def __init__(self, *_, **__) -> None:
                pass

            async def __aenter__(self) -> "FakeClient":
                return self

            async def __aexit__(self, *_) -> None:
                return None

            async def request(self, *, method: str, url: str, headers: dict[str, str], content: bytes | None) -> DummyResponse:  # type: ignore[override]
                requested["method"] = method
                requested["url"] = url
                requested["headers"] = headers
                requested["content"] = content
                return DummyResponse(200, b"ok", {"X-Test": "1"})

        monkeypatch.setattr(httpx, "AsyncClient", FakeClient)

        result = await manager.proxy_request(
            workspace_id="ws1",
            port=8080,
            method="GET",
            path="/health",
            headers={"X-Foo": "bar"},
            body=None,
            query_string="q=1",
        )

        assert requested["url"] == "http://localhost:8080/health?q=1"
        assert result["status"] == 200
        assert bytes.fromhex(result["body"]) == b"ok"
        assert result["headers"]["X-Test"] == "1"

    @pytest.mark.asyncio
    async def test_proxy_request_error_returns_502(self, manager: NativeManager, monkeypatch: pytest.MonkeyPatch) -> None:
        """Exceptions while proxying are converted into 502 responses."""
        import httpx  # type: ignore[import-not-found]

        class FailingClient:
            def __init__(self, *_, **__) -> None:
                pass

            async def __aenter__(self) -> "FailingClient":
                return self

            async def __aexit__(self, *_) -> None:
                return None

            async def request(self, *_, **__) -> DummyResponse:  # type: ignore[override]
                raise RuntimeError("boom")

        monkeypatch.setattr(httpx, "AsyncClient", FailingClient)

        result = await manager.proxy_request(
            workspace_id="ws1",
            port=1234,
            method="GET",
            path="/",
            headers={},
            body=None,
            query_string=None,
        )

        assert result["status"] == 502
        assert "boom" in bytes.fromhex(result["body"]).decode("utf-8")
        assert result["headers"] == {}
