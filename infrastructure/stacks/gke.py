"""GKE Cluster with GPU Node Pools configuration.

All node pools are scaled to 0 by default = NO COST when idle.
Nodes are created on-demand when workspaces are launched.
"""

from typing import Any, TypedDict

import pulumi_gcp as gcp


class GpuConfig(TypedDict):
    """Configuration for a GPU node pool."""

    name: str
    machine_type: str
    gpu_type: str
    gpu_count: int
    max_nodes: int
    disk_size: int


def create_gke_cluster(
    project_id: str, region: str, env: str, vpc: dict[str, Any]
) -> dict[str, Any]:
    """Create GKE cluster for GPU workspaces (scaled to 0 = FREE when idle)."""
    # Service account for GKE nodes
    gke_sa = gcp.serviceaccount.Account(
        f"podex-gke-{env}",
        account_id=f"podex-gke-{env}",
        display_name=f"Podex GKE Nodes ({env})",
    )

    # Grant permissions to service account
    # Note: storage.objectUser provides read/write access without admin/delete capabilities
    # For GCS FUSE read-write, objectUser (read + create + update) is sufficient
    roles = [
        "roles/logging.logWriter",
        "roles/monitoring.metricWriter",
        "roles/storage.objectUser",  # Read + create + update (no delete, no admin)
        "roles/artifactregistry.reader",
    ]

    for role in roles:
        gcp.projects.IAMMember(
            f"podex-gke-{role.split('/')[-1]}-{env}",
            project=project_id,
            role=role,
            member=gke_sa.email.apply(lambda e: f"serviceAccount:{e}"),
        )

    # GKE Cluster
    cluster = gcp.container.Cluster(
        f"podex-workspaces-{env}",
        name=f"podex-workspaces-{env}",
        location=region,  # Regional cluster
        # Remove default node pool (we'll create GPU pools)
        remove_default_node_pool=True,
        initial_node_count=1,
        # Networking
        network=vpc["network"].name,
        subnetwork=vpc["subnet"].name,
        # IP allocation for pods and services
        ip_allocation_policy=gcp.container.ClusterIpAllocationPolicyArgs(
            cluster_secondary_range_name="pods",
            services_secondary_range_name="services",
        ),
        # Workload Identity for secure GCP access
        workload_identity_config=gcp.container.ClusterWorkloadIdentityConfigArgs(
            workload_pool=f"{project_id}.svc.id.goog",
        ),
        # Enable features
        enable_shielded_nodes=True,
        # Cluster autoscaling with Node Auto-Provisioning
        cluster_autoscaling=gcp.container.ClusterClusterAutoscalingArgs(
            enabled=True,
            resource_limits=[
                gcp.container.ClusterClusterAutoscalingResourceLimitArgs(
                    resource_type="cpu",
                    minimum=0,
                    maximum=100,
                ),
                gcp.container.ClusterClusterAutoscalingResourceLimitArgs(
                    resource_type="memory",
                    minimum=0,
                    maximum=200,
                ),
                # GPU limits
                gcp.container.ClusterClusterAutoscalingResourceLimitArgs(
                    resource_type="nvidia-tesla-t4",
                    minimum=0,
                    maximum=10,
                ),
                gcp.container.ClusterClusterAutoscalingResourceLimitArgs(
                    resource_type="nvidia-l4",
                    minimum=0,
                    maximum=5,
                ),
                gcp.container.ClusterClusterAutoscalingResourceLimitArgs(
                    resource_type="nvidia-tesla-a100",
                    minimum=0,
                    maximum=2,
                ),
            ],
            auto_provisioning_defaults=gcp.container.ClusterClusterAutoscalingAutoProvisioningDefaultsArgs(
                service_account=gke_sa.email,
                # Minimal scopes for GKE nodes - use Workload Identity for pod-level access
                oauth_scopes=[
                    "https://www.googleapis.com/auth/logging.write",
                    "https://www.googleapis.com/auth/monitoring",
                    "https://www.googleapis.com/auth/devstorage.read_write",  # GCS FUSE
                ],
                # Use Spot VMs by default for cost savings
                management=gcp.container.ClusterClusterAutoscalingAutoProvisioningDefaultsManagementArgs(
                    auto_upgrade=True,
                    auto_repair=True,
                ),
            ),
        ),
        # Release channel
        release_channel=gcp.container.ClusterReleaseChannelArgs(
            channel="REGULAR",
        ),
        # Maintenance window (off-peak hours)
        maintenance_policy=gcp.container.ClusterMaintenancePolicyArgs(
            daily_maintenance_window=gcp.container.ClusterMaintenancePolicyDailyMaintenanceWindowArgs(
                start_time="03:00",
            ),
        ),
        # Resource labels
        resource_labels={
            "env": env,
            "app": "podex",
        },
    )

    return {
        "cluster": cluster,
        "service_account": gke_sa,
    }


def create_gpu_node_pools(cluster: gcp.container.Cluster, env: str) -> dict[str, Any]:
    """Create GPU node pools, all scaled to 0 (no cost when idle)."""
    gpu_configs: list[GpuConfig] = [
        {
            "name": "t4",
            "machine_type": "n1-standard-4",
            "gpu_type": "nvidia-tesla-t4",
            "gpu_count": 1,
            "max_nodes": 10,
            "disk_size": 100,
        },
        {
            "name": "l4",
            "machine_type": "g2-standard-8",
            "gpu_type": "nvidia-l4",
            "gpu_count": 1,
            "max_nodes": 5,
            "disk_size": 100,
        },
        {
            "name": "a100",
            "machine_type": "a2-highgpu-1g",
            "gpu_type": "nvidia-tesla-a100",
            "gpu_count": 1,
            "max_nodes": 2,
            "disk_size": 200,
        },
    ]

    pools: dict[str, Any] = {}

    for cfg in gpu_configs:
        pool = gcp.container.NodePool(
            f"podex-{cfg['name']}-pool-{env}",
            name=f"podex-{cfg['name']}-pool",
            cluster=cluster.name,
            location=cluster.location,
            # SCALED TO 0 = NO COST WHEN IDLE
            initial_node_count=0,
            autoscaling=gcp.container.NodePoolAutoscalingArgs(
                min_node_count=0,  # Scale to zero!
                max_node_count=cfg["max_nodes"],
            ),
            node_config=gcp.container.NodePoolNodeConfigArgs(
                machine_type=cfg["machine_type"],
                disk_size_gb=cfg["disk_size"],
                disk_type="pd-ssd",
                # GPU configuration
                guest_accelerators=[
                    gcp.container.NodePoolNodeConfigGuestAcceleratorArgs(
                        type=cfg["gpu_type"],
                        count=cfg["gpu_count"],
                        gpu_driver_installation_config=gcp.container.NodePoolNodeConfigGuestAcceleratorGpuDriverInstallationConfigArgs(
                            gpu_driver_version="LATEST",
                        ),
                    ),
                ],
                # Use Spot VMs for massive cost savings (60-91% off)
                spot=True,
                # Taints to ensure only GPU workloads land here
                taints=[
                    gcp.container.NodePoolNodeConfigTaintArgs(
                        key="nvidia.com/gpu",
                        value="present",
                        effect="NO_SCHEDULE",
                    ),
                ],
                # Labels for node selection
                labels={
                    "gpu-type": cfg["gpu_type"],
                    "workload": "workspace",
                    "env": env,
                },
                # Minimal OAuth scopes - use Workload Identity for pod-level access
                oauth_scopes=[
                    "https://www.googleapis.com/auth/logging.write",
                    "https://www.googleapis.com/auth/monitoring",
                    "https://www.googleapis.com/auth/devstorage.read_write",  # GCS FUSE
                ],
                # Metadata
                metadata={
                    "disable-legacy-endpoints": "true",
                },
            ),
            # Auto-repair and upgrade with graceful node shutdown for Spot VMs
            management=gcp.container.NodePoolManagementArgs(
                auto_repair=True,
                auto_upgrade=True,
            ),
            # Graceful shutdown configuration for Spot VM preemption
            # Allows workloads time to save state before termination
            # upgrade_settings not supported in this pulumi version
            # max_surge=1, max_unavailable=0 would be ideal for gradual upgrades
        )

        pools[str(cfg["name"])] = pool

    # Also create a CPU-only pool for non-GPU workspaces
    cpu_pool = gcp.container.NodePool(
        f"podex-cpu-pool-{env}",
        name="podex-cpu-pool",
        cluster=cluster.name,
        location=cluster.location,
        initial_node_count=0,
        autoscaling=gcp.container.NodePoolAutoscalingArgs(
            min_node_count=0,
            max_node_count=10,
        ),
        node_config=gcp.container.NodePoolNodeConfigArgs(
            machine_type="e2-standard-4",
            disk_size_gb=50,
            disk_type="pd-standard",
            spot=True,
            labels={
                "workload": "workspace",
                "gpu": "false",
                "env": env,
            },
            # Minimal OAuth scopes - use Workload Identity for pod-level access
            oauth_scopes=[
                "https://www.googleapis.com/auth/logging.write",
                "https://www.googleapis.com/auth/monitoring",
                "https://www.googleapis.com/auth/devstorage.read_write",  # GCS FUSE
            ],
            metadata={
                "disable-legacy-endpoints": "true",
            },
        ),
        management=gcp.container.NodePoolManagementArgs(
            auto_repair=True,
            auto_upgrade=True,
        ),
        # Graceful shutdown configuration for Spot VM preemption
        # upgrade_settings not supported in this pulumi version
        # max_surge=1, max_unavailable=0 would be ideal for gradual upgrades
    )

    pools["cpu"] = cpu_pool

    return pools
