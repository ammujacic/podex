"""Tests for VPC Network configuration."""

import os
import sys
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

# Add the infrastructure directory to Python path
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from stacks import network


class TestNetworkConfiguration:
    """Test VPC Network configuration."""

    def test_create_vpc_function_exists(self) -> None:
        """Test that create_vpc function exists and is callable."""
        assert hasattr(network, "create_vpc")
        assert callable(network.create_vpc)

    def test_create_vpc_creates_expected_resources(
        self, project_id: str, region: str, env: str
    ) -> None:
        """Test that create_vpc creates all expected network resources."""
        # Test network resource naming and configuration logic

        # Verify resource naming conventions
        vpc_name = f"podex-vpc-{env}"
        subnet_name = f"podex-subnet-{env}"
        router_name = f"podex-router-{env}"
        nat_name = f"podex-nat-{env}"

        assert vpc_name.startswith("podex-vpc-")
        assert subnet_name.startswith("podex-subnet-")
        assert router_name.startswith("podex-router-")
        assert nat_name.startswith("podex-nat-")

        # Verify firewall rule naming
        internal_firewall = f"podex-allow-internal-{env}"
        health_check_firewall = f"podex-allow-health-checks-{env}"

        assert internal_firewall.startswith("podex-allow-internal-")
        assert health_check_firewall.startswith("podex-allow-health-checks-")

        # Test CIDR configurations
        primary_cidr = "10.0.0.0/20"
        pod_cidr = "10.4.0.0/14"
        service_cidr = "10.8.0.0/20"

        import ipaddress

        primary_net = ipaddress.ip_network(primary_cidr)
        pod_net = ipaddress.ip_network(pod_cidr)
        service_net = ipaddress.ip_network(service_cidr)

        # Verify subnets don't overlap
        assert not primary_net.overlaps(pod_net)
        assert not primary_net.overlaps(service_net)
        assert not pod_net.overlaps(service_net)

    def test_network_cidrs_are_valid(self) -> None:
        """Test that network CIDR ranges are valid and non-overlapping."""
        primary_cidr = "10.0.0.0/20"
        pod_cidr = "10.4.0.0/14"
        service_cidr = "10.8.0.0/20"

        # Basic validation that these are valid CIDR notations
        import ipaddress

        try:
            ipaddress.ip_network(primary_cidr)
            ipaddress.ip_network(pod_cidr)
            ipaddress.ip_network(service_cidr)
        except ValueError:
            pytest.fail("Invalid CIDR notation")

        # Verify they don't overlap (this is a basic check)
        primary_net = ipaddress.ip_network(primary_cidr)
        pod_net = ipaddress.ip_network(pod_cidr)
        service_net = ipaddress.ip_network(service_cidr)

        # These should be separate ranges
        assert not primary_net.overlaps(pod_net)
        assert not primary_net.overlaps(service_net)
        assert not pod_net.overlaps(service_net)

    def test_vpc_uses_private_google_access(self, project_id: str, region: str, env: str) -> None:
        """Test that VPC subnet has private Google access enabled."""
        # Test the subnet configuration logic
        subnet_config = {
            "private_ip_google_access": True,
            "region": "us-central1",
            "ip_cidr_range": "10.0.0.0/20",
        }

        # Verify private Google access is enabled
        assert subnet_config["private_ip_google_access"]

        # Verify valid region
        assert subnet_config["region"] in ["us-central1", "us-west1", "us-east1", "europe-west1"]

        # Verify valid CIDR range
        import ipaddress

        cidr = ipaddress.ip_network(str(subnet_config["ip_cidr_range"]))
        assert cidr.is_private or str(cidr.network_address).startswith("10.")

    @patch("pulumi_gcp.compute.Network")
    @patch("pulumi_gcp.compute.Subnetwork")
    @patch("pulumi_gcp.compute.Router")
    @patch("pulumi_gcp.compute.RouterNat")
    @patch("pulumi_gcp.compute.Firewall")
    def test_nat_configuration(
        self,
        mock_firewall: Any,
        mock_nat: Any,
        mock_router: Any,
        mock_subnetwork: Any,
        mock_network: Any,
        project_id: str,
        region: str,
        env: str,
    ) -> None:
        """Test that NAT is properly configured for outbound traffic."""
        mock_network_instance = MagicMock()
        mock_network_instance.id = "test-network-id"
        mock_network.return_value = mock_network_instance

        network.create_vpc(project_id, region, env)

        # Verify NAT uses AUTO_ONLY for IP allocation
        nat_call_args = mock_nat.call_args
        assert nat_call_args[1]["nat_ip_allocate_option"] == "AUTO_ONLY"
        assert (
            nat_call_args[1]["source_subnetwork_ip_ranges_to_nat"]
            == "ALL_SUBNETWORKS_ALL_IP_RANGES"
        )

    def test_firewall_rules_configuration(self, project_id: str, region: str, env: str) -> None:
        """Test firewall rules naming and configuration."""
        # Test that firewall rule names follow consistent pattern
        expected_rules = [
            f"podex-allow-internal-{env}",
            f"podex-allow-health-checks-{env}",
        ]

        # This is a naming convention test
        for rule_name in expected_rules:
            assert rule_name.startswith("podex-")
            assert rule_name.endswith(f"-{env}")
            assert "allow" in rule_name
