"""Comprehensive tests for preview models."""

import pytest

from podex_shared.models.preview import PortInfo, PreviewInfo


class TestPortInfo:
    """Tests for PortInfo model."""

    def test_port_info_required(self) -> None:
        """Test PortInfo with required fields."""
        port = PortInfo(port=3000, process_name="node")
        assert port.port == 3000
        assert port.process_name == "node"
        assert port.state == "LISTEN"
        assert port.protocol == "http"
        assert port.label == "node"  # Auto-generated from process_name

    def test_port_info_auto_label_with_process_name(self) -> None:
        """Test that label is auto-generated from process_name."""
        port = PortInfo(port=8080, process_name="python")
        assert port.label == "python"

    def test_port_info_auto_label_fallback(self) -> None:
        """Test that label falls back to port number."""
        port = PortInfo(port=9000, process_name="")
        assert port.label == "Port 9000"

    def test_port_info_explicit_label(self) -> None:
        """Test PortInfo with explicit label."""
        port = PortInfo(
            port=5432,
            process_name="postgres",
            label="Database",
        )
        # Explicit label should be preserved
        assert port.label == "Database"

    def test_port_info_custom_state(self) -> None:
        """Test PortInfo with custom state."""
        port = PortInfo(
            port=3000,
            process_name="node",
            state="ESTABLISHED",
        )
        assert port.state == "ESTABLISHED"

    def test_port_info_custom_protocol(self) -> None:
        """Test PortInfo with custom protocol."""
        port = PortInfo(
            port=443,
            process_name="nginx",
            protocol="https",
        )
        assert port.protocol == "https"


class TestPreviewInfo:
    """Tests for PreviewInfo model."""

    def test_preview_info_minimal(self) -> None:
        """Test PreviewInfo with minimal fields."""
        preview = PreviewInfo(
            workspace_id="ws-123",
            status="running",
            active_ports=[],
            preview_base_url="https://preview.podex.dev/ws-123",
        )
        assert preview.workspace_id == "ws-123"
        assert preview.status == "running"
        assert preview.active_ports == []
        assert preview.container_id is None

    def test_preview_info_with_ports(self) -> None:
        """Test PreviewInfo with active ports."""
        ports = [
            PortInfo(port=3000, process_name="node"),
            PortInfo(port=5000, process_name="flask"),
        ]
        preview = PreviewInfo(
            workspace_id="ws-456",
            status="running",
            active_ports=ports,
            preview_base_url="https://preview.podex.dev/ws-456",
        )
        assert len(preview.active_ports) == 2
        assert preview.active_ports[0].port == 3000
        assert preview.active_ports[1].port == 5000

    def test_preview_info_with_container_id(self) -> None:
        """Test PreviewInfo with container ID."""
        preview = PreviewInfo(
            workspace_id="ws-789",
            status="running",
            active_ports=[],
            preview_base_url="https://preview.podex.dev/ws-789",
            container_id="abc123def456",
        )
        assert preview.container_id == "abc123def456"

    def test_preview_info_different_statuses(self) -> None:
        """Test PreviewInfo with different status values."""
        statuses = ["running", "stopped", "starting", "error"]
        for status in statuses:
            preview = PreviewInfo(
                workspace_id="ws-test",
                status=status,
                active_ports=[],
                preview_base_url="https://preview.podex.dev/ws-test",
            )
            assert preview.status == status
