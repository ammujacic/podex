"""Tests for parse_container_stats method in MultiServerDockerManager."""

import pytest

from src.managers.multi_server_docker import MultiServerDockerManager


class TestParseContainerStats:
    """Tests for parse_container_stats method."""

    def setup_method(self) -> None:
        """Set up test fixtures."""
        self.manager = MultiServerDockerManager()

    def test_parse_empty_stats(self) -> None:
        """Test parsing empty stats returns defaults."""
        result = self.manager.parse_container_stats({})

        assert result["cpu_percent"] == 0.0
        assert result["memory_used_mb"] == 0
        assert result["network_rx_mb"] == 0.0
        assert result["disk_read_mb"] == 0.0

    def test_parse_none_stats(self) -> None:
        """Test parsing None stats returns defaults."""
        result = self.manager.parse_container_stats(None)  # type: ignore[arg-type]

        assert result["cpu_percent"] == 0.0
        assert result["memory_used_mb"] == 0

    def test_parse_cpu_stats(self) -> None:
        """Test CPU percentage calculation."""
        stats = {
            "cpu_stats": {
                "cpu_usage": {"total_usage": 200_000_000},
                "system_cpu_usage": 1_000_000_000,
                "online_cpus": 2,
            },
            "precpu_stats": {
                "cpu_usage": {"total_usage": 100_000_000},
                "system_cpu_usage": 500_000_000,
            },
        }

        result = self.manager.parse_container_stats(stats)

        # cpu_delta = 100M, system_delta = 500M, cpus = 2
        # (100M / 500M) * 2 * 100 = 40%
        assert result["cpu_percent"] == pytest.approx(40.0, rel=0.01)
        assert result["cpu_limit_cores"] == 2

    def test_parse_memory_stats(self) -> None:
        """Test memory parsing."""
        stats = {
            "memory_stats": {
                "usage": 512 * 1024 * 1024,  # 512 MB
                "limit": 2 * 1024 * 1024 * 1024,  # 2 GB
            },
        }

        result = self.manager.parse_container_stats(stats)

        assert result["memory_used_mb"] == 512
        assert result["memory_limit_mb"] == 2048
        assert result["memory_percent"] == pytest.approx(25.0, rel=0.01)

    def test_parse_network_stats(self) -> None:
        """Test network I/O parsing."""
        stats = {
            "networks": {
                "eth0": {"rx_bytes": 100 * 1024 * 1024, "tx_bytes": 50 * 1024 * 1024},
                "eth1": {"rx_bytes": 50 * 1024 * 1024, "tx_bytes": 25 * 1024 * 1024},
            },
        }

        result = self.manager.parse_container_stats(stats)

        assert result["network_rx_mb"] == pytest.approx(150.0, rel=0.01)
        assert result["network_tx_mb"] == pytest.approx(75.0, rel=0.01)

    def test_parse_disk_io_stats(self) -> None:
        """Test disk I/O parsing."""
        stats = {
            "blkio_stats": {
                "io_service_bytes_recursive": [
                    {"op": "read", "value": 100 * 1024 * 1024},
                    {"op": "write", "value": 50 * 1024 * 1024},
                ],
            },
        }

        result = self.manager.parse_container_stats(stats)

        assert result["disk_read_mb"] == pytest.approx(100.0, rel=0.01)
        assert result["disk_write_mb"] == pytest.approx(50.0, rel=0.01)

    def test_parse_full_stats(self) -> None:
        """Test parsing complete Docker stats response."""
        stats = {
            "cpu_stats": {
                "cpu_usage": {"total_usage": 500_000_000},
                "system_cpu_usage": 2_000_000_000,
                "online_cpus": 4,
            },
            "precpu_stats": {
                "cpu_usage": {"total_usage": 400_000_000},
                "system_cpu_usage": 1_800_000_000,
            },
            "memory_stats": {
                "usage": 1024 * 1024 * 1024,  # 1 GB
                "limit": 4 * 1024 * 1024 * 1024,  # 4 GB
            },
            "networks": {
                "eth0": {"rx_bytes": 1024 * 1024 * 1024, "tx_bytes": 512 * 1024 * 1024},
            },
            "blkio_stats": {
                "io_service_bytes_recursive": [
                    {"op": "read", "value": 2 * 1024 * 1024 * 1024},
                    {"op": "write", "value": 1024 * 1024 * 1024},
                ],
            },
        }

        result = self.manager.parse_container_stats(stats)

        # Verify all fields are populated
        assert result["cpu_percent"] > 0
        assert result["cpu_limit_cores"] == 4
        assert result["memory_used_mb"] == 1024
        assert result["memory_limit_mb"] == 4096
        assert result["memory_percent"] == pytest.approx(25.0, rel=0.01)
        assert result["network_rx_mb"] == pytest.approx(1024.0, rel=0.01)
        assert result["network_tx_mb"] == pytest.approx(512.0, rel=0.01)
        assert result["disk_read_mb"] == pytest.approx(2048.0, rel=0.01)
        assert result["disk_write_mb"] == pytest.approx(1024.0, rel=0.01)
        assert result["collected_at"] is not None
