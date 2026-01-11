"""Tests for base compute manager."""

from dataclasses import asdict

import pytest

from src.managers.base import ProxyRequest


class TestProxyRequest:
    """Tests for ProxyRequest dataclass."""

    def test_proxy_request_required_fields(self) -> None:
        """Test ProxyRequest with required fields."""
        request = ProxyRequest(
            workspace_id="ws_123",
            port=3000,
            method="GET",
            path="/api/data",
            headers={"Accept": "application/json"},
        )
        assert request.workspace_id == "ws_123"
        assert request.port == 3000
        assert request.method == "GET"
        assert request.path == "/api/data"
        assert request.headers == {"Accept": "application/json"}
        assert request.body is None
        assert request.query_string is None

    def test_proxy_request_with_body(self) -> None:
        """Test ProxyRequest with body."""
        request = ProxyRequest(
            workspace_id="ws_123",
            port=3000,
            method="POST",
            path="/api/data",
            headers={"Content-Type": "application/json"},
            body=b'{"key": "value"}',
        )
        assert request.body == b'{"key": "value"}'

    def test_proxy_request_with_query_string(self) -> None:
        """Test ProxyRequest with query string."""
        request = ProxyRequest(
            workspace_id="ws_123",
            port=3000,
            method="GET",
            path="/api/search",
            headers={},
            query_string="q=test&page=1",
        )
        assert request.query_string == "q=test&page=1"

    def test_proxy_request_asdict(self) -> None:
        """Test ProxyRequest can be converted to dict."""
        request = ProxyRequest(
            workspace_id="ws_123",
            port=3000,
            method="GET",
            path="/api/data",
            headers={},
        )
        data = asdict(request)
        assert data["workspace_id"] == "ws_123"
        assert data["port"] == 3000

    def test_proxy_request_put_method(self) -> None:
        """Test ProxyRequest with PUT method."""
        request = ProxyRequest(
            workspace_id="ws_123",
            port=8080,
            method="PUT",
            path="/api/resource/123",
            headers={"Content-Type": "text/plain"},
            body=b"updated content",
        )
        assert request.method == "PUT"
        assert request.body == b"updated content"

    def test_proxy_request_delete_method(self) -> None:
        """Test ProxyRequest with DELETE method."""
        request = ProxyRequest(
            workspace_id="ws_123",
            port=8080,
            method="DELETE",
            path="/api/resource/123",
            headers={"Authorization": "Bearer token"},
        )
        assert request.method == "DELETE"

    def test_proxy_request_empty_headers(self) -> None:
        """Test ProxyRequest with empty headers."""
        request = ProxyRequest(
            workspace_id="ws_123",
            port=3000,
            method="GET",
            path="/",
            headers={},
        )
        assert request.headers == {}

    def test_proxy_request_complex_headers(self) -> None:
        """Test ProxyRequest with multiple headers."""
        request = ProxyRequest(
            workspace_id="ws_123",
            port=3000,
            method="POST",
            path="/api/data",
            headers={
                "Content-Type": "application/json",
                "Authorization": "Bearer token123",
                "X-Custom-Header": "custom-value",
                "Accept": "application/json",
            },
            body=b"{}",
        )
        assert len(request.headers) == 4
        assert "Authorization" in request.headers
