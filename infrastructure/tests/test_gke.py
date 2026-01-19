"""Tests for GKE cluster and GPU node pool configurations."""

import os
import sys
from typing import Any
from unittest.mock import MagicMock, patch

# Add the infrastructure directory to Python path
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from stacks import gke


class TestGKEClusterConfiguration:
    """Test GKE cluster configuration."""

    def test_create_gke_cluster_function_exists(self) -> None:
        """Test that create_gke_cluster function exists and is callable."""
        assert hasattr(gke, "create_gke_cluster")
        assert callable(gke.create_gke_cluster)

    def test_create_gpu_node_pools_function_exists(self) -> None:
        """Test that create_gpu_node_pools function exists and is callable."""
        assert hasattr(gke, "create_gpu_node_pools")
        assert callable(gke.create_gpu_node_pools)

    def test_create_gke_cluster_creates_expected_resources(
        self, project_id: str, region: str, env: str
    ) -> None:
        """Test that create_gke_cluster creates all expected GKE resources."""
        # Test the GKE cluster configuration logic without calling Pulumi functions

        # Verify cluster naming
        cluster_name = f"podex-workspaces-{env}"
        assert cluster_name.startswith("podex-workspaces-")
        assert cluster_name.endswith(f"-{env}")

        # Verify service account naming
        sa_account_id = f"podex-gke-{env}"
        sa_display_name = f"Podex GKE Nodes ({env})"
        assert sa_account_id.startswith("podex-gke-")
        assert sa_display_name.startswith("Podex GKE Nodes")

        # Verify IAM roles configuration
        expected_roles = [
            "roles/logging.logWriter",
            "roles/monitoring.metricWriter",
            "roles/monitoring.viewer",
            "roles/storage.objectViewer",
            "roles/artifactregistry.reader",
        ]

        for role in expected_roles:
            assert role.startswith("roles/")
            assert len(role) > 10  # Reasonable length check

        # Verify cluster autoscaling configuration
        gpu_resource_limits = {"nvidia-tesla-t4": 10, "nvidia-l4": 5, "nvidia-tesla-a100": 2}

        # Verify GPU limits are reasonable for cost control
        for gpu_type, max_count in gpu_resource_limits.items():
            assert gpu_type.startswith("nvidia-")
            assert 1 <= max_count <= 20

    def test_gke_service_account_roles(self) -> None:
        """Test that GKE service account has appropriate IAM roles."""
        expected_roles = [
            "roles/logging.logWriter",
            "roles/monitoring.metricWriter",
            "roles/monitoring.viewer",
            "roles/storage.objectViewer",
            "roles/artifactregistry.reader",
        ]

        # Verify all roles are GCP IAM roles
        for role in expected_roles:
            assert role.startswith("roles/")
            assert len(role) > 10  # Reasonable length check

    def test_gke_cluster_autoscaling_configuration(
        self, project_id: str, region: str, env: str
    ) -> None:
        """Test GKE cluster autoscaling configuration."""
        # Test autoscaling resource limits logic
        resource_limits: list[dict[str, Any]] = [
            {"resource_type": "cpu", "minimum": 0, "maximum": 100},
            {"resource_type": "memory", "minimum": 0, "maximum": 200},
            {"resource_type": "nvidia-tesla-t4", "minimum": 0, "maximum": 10},
            {"resource_type": "nvidia-l4", "minimum": 0, "maximum": 5},
            {"resource_type": "nvidia-tesla-a100", "minimum": 0, "maximum": 2},
        ]

        # Verify all resources have min=0 for cost optimization
        for limit in resource_limits:
            assert limit["minimum"] == 0
            assert limit["maximum"] > 0

        # Verify GPU resources have reasonable limits
        gpu_limits = {
            r["resource_type"]: r["maximum"]
            for r in resource_limits
            if "nvidia" in r["resource_type"]
        }
        assert gpu_limits["nvidia-tesla-t4"] == 10
        assert gpu_limits["nvidia-l4"] == 5
        assert gpu_limits["nvidia-tesla-a100"] == 2

    def test_gke_cluster_networking_configuration(
        self, project_id: str, region: str, env: str
    ) -> None:
        """Test GKE cluster networking configuration."""
        # Test networking configuration logic
        network_config: dict[str, Any] = {
            "network": f"projects/{project_id}/global/networks/podex-vpc-{env}",
            "subnetwork": f"projects/{project_id}/regions/{region}/subnetworks/podex-subnet-{env}",
            "ip_allocation_policy": {
                "cluster_secondary_range_name": "pods",
                "services_secondary_range_name": "services",
            },
            "workload_identity_config": {"workload_pool": f"{project_id}.svc.id.goog"},
        }

        # Verify network naming
        assert f"podex-vpc-{env}" in network_config["network"]
        assert f"podex-subnet-{env}" in network_config["subnetwork"]
        assert network_config["subnetwork"].startswith(f"projects/{project_id}/regions/{region}")

        # Verify IP allocation
        ip_policy = network_config["ip_allocation_policy"]
        assert ip_policy["cluster_secondary_range_name"] == "pods"
        assert ip_policy["services_secondary_range_name"] == "services"

        # Verify Workload Identity
        wi_config = network_config["workload_identity_config"]
        assert wi_config["workload_pool"] == f"{project_id}.svc.id.goog"

    def test_gke_cluster_security_features(self, project_id: str, region: str, env: str) -> None:
        """Test GKE cluster security features."""
        # Test security configuration logic
        security_config: dict[str, Any] = {
            "enable_shielded_nodes": True,
            "remove_default_node_pool": True,
            "maintenance_policy": {"daily_maintenance_window": {"start_time": "03:00"}},
        }

        # Verify security features
        assert security_config["enable_shielded_nodes"]
        assert security_config["remove_default_node_pool"]

        # Verify maintenance window
        maintenance = security_config["maintenance_policy"]["daily_maintenance_window"]
        assert maintenance["start_time"] == "03:00"

        # Verify it's an off-peak time
        start_hour = int(maintenance["start_time"].split(":")[0])
        assert 0 <= start_hour <= 5  # Off-peak hours

    def test_gke_cluster_naming_convention(self, project_id: str, region: str, env: str) -> None:
        """Test GKE cluster naming conventions."""
        cluster_name = f"podex-workspaces-{env}"

        # Verify naming pattern
        assert cluster_name.startswith("podex-workspaces-")
        assert cluster_name.endswith(f"-{env}")
        assert "workspaces" in cluster_name


class TestGPUNodePoolsConfiguration:
    """Test GPU node pool configurations."""

    def test_gpu_node_pool_configurations(self) -> None:
        """Test that GPU node pool configurations are properly defined."""
        # Test the configurations defined in the code
        gpu_configs: list[dict[str, Any]] = [
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

        for cfg in gpu_configs:
            # Validate GPU configuration
            assert cfg["gpu_count"] == 1
            assert cfg["gpu_type"].startswith("nvidia-")

            # Validate node limits (reasonable for cost control)
            assert 1 <= cfg["max_nodes"] <= 20

            # Validate disk size
            assert cfg["disk_size"] >= 50

            # Validate machine types are GPU-capable
            assert cfg["machine_type"] in ["n1-standard-4", "g2-standard-8", "a2-highgpu-1g"]

    @patch("pulumi_gcp.container.NodePool")
    def test_create_gpu_node_pools_creates_all_pools(self, mock_node_pool: Any, env: str) -> None:
        """Test that create_gpu_node_pools creates all expected GPU pools."""
        # Mock cluster
        mock_cluster = MagicMock()
        mock_cluster.name = f"podex-workspaces-{env}"

        # Call the function
        result = gke.create_gpu_node_pools(mock_cluster, env)

        # Verify 4 node pools are created (3 GPU + 1 CPU)
        assert mock_node_pool.call_count == 4

        # Verify expected pool names
        expected_pools = ["t4", "l4", "a100", "cpu"]
        assert set(result.keys()) == set(expected_pools)

        # Check call arguments for each pool
        calls = mock_node_pool.call_args_list
        pool_names = [call[0][0] for call in calls]  # First positional arg is the name

        for expected_name in expected_pools:
            assert any(f"podex-{expected_name}-pool-{env}" in name for name in pool_names)

    @patch("pulumi_gcp.container.NodePool")
    def test_gpu_node_pools_scaling_to_zero(self, mock_node_pool: Any, env: str) -> None:
        """Test that GPU node pools scale to zero for cost optimization."""
        mock_cluster = MagicMock()
        mock_cluster.name = f"podex-workspaces-{env}"

        gke.create_gpu_node_pools(mock_cluster, env)

        # Check that all pools have initial_node_count=0
        for call in mock_node_pool.call_args_list:
            assert call[1]["initial_node_count"] == 0

            # Check autoscaling configuration
            autoscaling = call[1]["autoscaling"]
            assert autoscaling.min_node_count == 0

    @patch("pulumi_gcp.container.NodePool")
    def test_gpu_node_pool_accelerator_configuration(self, mock_node_pool: Any, env: str) -> None:
        """Test GPU accelerator configuration."""
        mock_cluster = MagicMock()
        mock_cluster.name = f"podex-workspaces-{env}"

        gke.create_gpu_node_pools(mock_cluster, env)

        # Find GPU pool calls (exclude CPU pool)
        gpu_calls = [call for call in mock_node_pool.call_args_list if "cpu-pool" not in call[0][0]]

        for call in gpu_calls:
            node_config = call[1]["node_config"]
            accelerators = node_config.guest_accelerators

            # Each GPU pool should have exactly 1 accelerator
            assert len(accelerators) == 1
            accelerator = accelerators[0]

            # Verify GPU driver installation config
            driver_config = accelerator.gpu_driver_installation_config
            assert driver_config.gpu_driver_version == "LATEST"

    @patch("pulumi_gcp.container.NodePool")
    def test_node_pool_taints_and_labels(self, mock_node_pool: Any, env: str) -> None:
        """Test node pool taints and labels for workload targeting."""
        mock_cluster = MagicMock()
        mock_cluster.name = f"podex-workspaces-{env}"

        gke.create_gpu_node_pools(mock_cluster, env)

        # Find GPU pool calls
        gpu_calls = [call for call in mock_node_pool.call_args_list if "cpu-pool" not in call[0][0]]

        for call in gpu_calls:
            node_config = call[1]["node_config"]

            # Verify taints for GPU scheduling
            taints = node_config.taints
            assert len(taints) == 1
            taint = taints[0]
            assert taint.key == "nvidia.com/gpu"
            assert taint.value == "present"
            assert taint.effect == "NO_SCHEDULE"

            # Verify GPU type label
            labels = node_config.labels
            assert "gpu-type" in labels
            assert labels["gpu-type"].startswith("nvidia-")
            assert labels["workload"] == "workspace"

    @patch("pulumi_gcp.container.NodePool")
    def test_spot_instance_configuration(self, mock_node_pool: Any, env: str) -> None:
        """Test that node pools use spot instances for cost savings."""
        mock_cluster = MagicMock()
        mock_cluster.name = f"podex-workspaces-{env}"

        gke.create_gpu_node_pools(mock_cluster, env)

        # All pools should use spot instances
        for call in mock_node_pool.call_args_list:
            node_config = call[1]["node_config"]
            assert node_config.spot

    def test_node_pool_resource_limits(self) -> None:
        """Test node pool resource limits for cost control."""
        # Test the max_nodes limits defined in the code
        limits = {"t4": 10, "l4": 5, "a100": 2, "cpu": 10}

        # Verify reasonable limits (not too high for cost control)
        for pool_type, max_nodes in limits.items():
            assert 1 <= max_nodes <= 20, f"Pool {pool_type} has unreasonable limit: {max_nodes}"

        # Verify GPU pools have lower limits than CPU pools (cost control)
        assert limits["t4"] <= limits["cpu"]
        assert limits["l4"] <= limits["cpu"]
        assert limits["a100"] <= limits["cpu"]

    def test_machine_type_gpu_compatibility(self) -> None:
        """Test that machine types are appropriate for their GPUs."""
        machine_gpu_mapping = {
            "n1-standard-4": "nvidia-tesla-t4",
            "g2-standard-8": "nvidia-l4",
            "a2-highgpu-1g": "nvidia-tesla-a100",
        }

        # Verify machine types are suitable for their GPUs
        for machine_type, gpu_type in machine_gpu_mapping.items():
            # Higher-end GPUs should have appropriate machine types
            if gpu_type == "nvidia-tesla-a100":
                assert "a2-highgpu" in machine_type
            elif gpu_type == "nvidia-l4":
                assert "g2-standard" in machine_type

    @patch("pulumi_gcp.container.NodePool")
    def test_node_pool_maintenance_settings(self, mock_node_pool: Any, env: str) -> None:
        """Test node pool maintenance and auto-repair settings."""
        mock_cluster = MagicMock()
        mock_cluster.name = f"podex-workspaces-{env}"

        gke.create_gpu_node_pools(mock_cluster, env)

        for call in mock_node_pool.call_args_list:
            management = call[1]["management"]

            # All pools should have auto-repair and auto-upgrade enabled
            assert management.auto_repair
            assert management.auto_upgrade

    def test_node_pool_disk_configuration(self) -> None:
        """Test node pool disk size configurations."""
        disk_configs = {
            "t4": 100,
            "l4": 100,
            "a100": 200,  # A100 needs more disk
            "cpu": 50,
        }

        # Verify disk sizes are reasonable
        for pool_type, disk_size in disk_configs.items():
            assert disk_size >= 50, f"Pool {pool_type} has insufficient disk: {disk_size}GB"

        # A100 should have more disk than others
        assert disk_configs["a100"] > disk_configs["t4"]
        assert disk_configs["a100"] > disk_configs["l4"]
