"""VPC Network configuration for GKE.

Creates a VPC with subnets for GKE nodes and pods.
"""

from typing import Any

import pulumi_gcp as gcp


def create_vpc(project_id: str, region: str, env: str) -> dict[str, Any]:
    """Create VPC for GKE cluster."""
    # VPC Network
    network = gcp.compute.Network(
        f"podex-vpc-{env}",
        name=f"podex-vpc-{env}",
        auto_create_subnetworks=False,
        description=f"Podex VPC ({env})",
    )

    # Subnet with secondary ranges for GKE
    subnet = gcp.compute.Subnetwork(
        f"podex-subnet-{env}",
        name=f"podex-subnet-{env}",
        network=network.id,
        ip_cidr_range="10.0.0.0/20",
        region=region,
        private_ip_google_access=True,
        # Secondary ranges for GKE pods and services
        secondary_ip_ranges=[
            gcp.compute.SubnetworkSecondaryIpRangeArgs(
                range_name="pods",
                ip_cidr_range="10.4.0.0/14",
            ),
            gcp.compute.SubnetworkSecondaryIpRangeArgs(
                range_name="services",
                ip_cidr_range="10.8.0.0/20",
            ),
        ],
    )

    # Cloud Router (for NAT)
    router = gcp.compute.Router(
        f"podex-router-{env}",
        name=f"podex-router-{env}",
        network=network.id,
        region=region,
    )

    # Cloud NAT (for GKE private nodes to access internet)
    nat = gcp.compute.RouterNat(
        f"podex-nat-{env}",
        name=f"podex-nat-{env}",
        router=router.name,
        region=region,
        nat_ip_allocate_option="AUTO_ONLY",
        source_subnetwork_ip_ranges_to_nat="ALL_SUBNETWORKS_ALL_IP_RANGES",
        log_config=gcp.compute.RouterNatLogConfigArgs(
            enable=True,
            filter="ERRORS_ONLY",
        ),
    )

    # Firewall rule to allow internal traffic
    gcp.compute.Firewall(
        f"podex-allow-internal-{env}",
        name=f"podex-allow-internal-{env}",
        network=network.id,
        allows=[
            gcp.compute.FirewallAllowArgs(
                protocol="tcp",
                ports=["0-65535"],
            ),
            gcp.compute.FirewallAllowArgs(
                protocol="udp",
                ports=["0-65535"],
            ),
            gcp.compute.FirewallAllowArgs(
                protocol="icmp",
            ),
        ],
        source_ranges=["10.0.0.0/8"],
        priority=1000,
    )

    # Firewall rule for health checks
    gcp.compute.Firewall(
        f"podex-allow-health-checks-{env}",
        name=f"podex-allow-health-checks-{env}",
        network=network.id,
        allows=[
            gcp.compute.FirewallAllowArgs(
                protocol="tcp",
                ports=["80", "443", "8080"],
            ),
        ],
        # Google health check ranges
        source_ranges=["35.191.0.0/16", "130.211.0.0/22"],
        priority=1000,
    )

    return {
        "network": network,
        "subnet": subnet,
        "router": router,
        "nat": nat,
    }
