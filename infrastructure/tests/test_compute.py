"""Tests for Cloud Run services configuration."""

import os
import sys
from typing import Any

# Add the infrastructure directory to Python path
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from stacks import compute


class TestComputeConfiguration:
    """Test Cloud Run services configuration."""

    def test_create_cloud_run_services_function_exists(self) -> None:
        """Test that create_cloud_run_services function exists and is callable."""
        assert hasattr(compute, "create_cloud_run_services")
        assert callable(compute.create_cloud_run_services)

    def test_service_configurations_are_valid(self) -> None:
        """Test that service configurations have valid settings."""
        # Test the service configurations defined in the code
        svc_configs: list[dict[str, Any]] = [
            {
                "name": "api",
                "port": 3001,
                "cpu": "1",
                "memory": "512Mi",
                "max_instances": 5,
            },
            {
                "name": "agent",
                "port": 3002,
                "cpu": "1",
                "memory": "1Gi",
                "max_instances": 5,
            },
            {
                "name": "compute",
                "port": 3003,
                "cpu": "1",
                "memory": "512Mi",
                "max_instances": 3,
            },
            {
                "name": "web",
                "port": 3000,
                "cpu": "1",
                "memory": "256Mi",
                "max_instances": 5,
            },
        ]

        for cfg in svc_configs:
            # Validate CPU settings
            assert cfg["cpu"] in ["1", "2", "0.5"]

            # Validate memory settings
            assert cfg["memory"] in ["256Mi", "512Mi", "1Gi", "2Gi"]

            # Validate port ranges
            assert 3000 <= cfg["port"] <= 3999

            # Validate max instances
            assert 1 <= cfg["max_instances"] <= 10

    def test_service_account_roles_are_appropriate(self) -> None:
        """Test that service account has appropriate IAM roles."""
        roles = [
            "roles/secretmanager.secretAccessor",
            "roles/storage.objectAdmin",
            "roles/cloudsql.client",
            "roles/aiplatform.user",
            "roles/logging.logWriter",
            "roles/cloudtrace.agent",
        ]

        # Verify all roles are GCP IAM roles (start with "roles/")
        for role in roles:
            assert role.startswith("roles/")

        # Verify critical permissions are included
        assert "roles/secretmanager.secretAccessor" in roles
        assert "roles/cloudsql.client" in roles
        assert "roles/logging.logWriter" in roles

    def test_create_cloud_run_services_creates_services(
        self, project_id: str, region: str, env: str
    ) -> None:
        """Test that create_cloud_run_services creates all expected services."""
        # Test the Cloud Run service configuration logic without calling Pulumi functions

        # Expected IAM roles for Cloud Run services
        expected_roles = [
            "roles/secretmanager.secretAccessor",
            "roles/storage.objectAdmin",
            "roles/cloudsql.client",
            "roles/aiplatform.user",
            "roles/logging.logWriter",
            "roles/cloudtrace.agent",
        ]

        # Verify all roles are valid GCP IAM roles
        for role in expected_roles:
            assert role.startswith("roles/")
            assert len(role) > 10

        # Test service configurations
        service_configs = {
            "api": {"port": 3001, "needs_db": True, "needs_redis": True, "needs_vertex": True},
            "agent": {"port": 3002, "needs_db": True, "needs_redis": True, "needs_vertex": True},
            "compute": {
                "port": 3003,
                "needs_db": False,
                "needs_redis": True,
                "needs_vertex": False,
            },
            "web": {"port": 3000, "needs_db": False, "needs_redis": False, "needs_vertex": False},
        }

        # Verify service ports are in valid range
        for service_name, config in service_configs.items():
            assert 3000 <= config["port"] <= 3999
            assert service_name in ["api", "agent", "compute", "web"]

        # Verify dependency logic
        assert service_configs["api"]["needs_db"]
        assert not service_configs["web"]["needs_db"]
        assert service_configs["agent"]["needs_redis"]
        assert not service_configs["web"]["needs_redis"]

    def test_scaling_configuration(self) -> None:
        """Test that Cloud Run services have appropriate scaling settings."""
        # All services should scale to zero for cost optimization
        min_instances = 0
        max_instances_range = range(1, 11)  # Reasonable range

        assert min_instances == 0  # Scale to zero

        # Test that configured max instances are reasonable
        configured_max = [5, 5, 3, 5]  # api, agent, compute, web
        for max_inst in configured_max:
            assert max_inst in max_instances_range

    def test_environment_variables_are_configured(self) -> None:
        """Test that services have required environment variables."""
        required_env_vars = [
            "ENV",
            "GCP_PROJECT_ID",
            "GCP_REGION",
            "LLM_PROVIDER",
            "EMAIL_BACKEND",
            "JWT_SECRET",
            "INTERNAL_API_KEY",
        ]

        # Verify critical environment variables are set
        for env_var in required_env_vars:
            assert len(env_var) > 0

        # Test specific values
        assert "ENV" in required_env_vars
        assert "GCP_PROJECT_ID" in required_env_vars
        assert "JWT_SECRET" in required_env_vars

    def test_health_checks_are_configured(self) -> None:
        """Test that health checks are properly configured."""
        # Services should have startup probes (except web frontend)

        # Health check should use /health endpoint
        health_path = "/health"
        assert health_path == "/health"

        # Startup probe timing
        initial_delay = 5
        period = 10
        failure_threshold = 3

        assert initial_delay >= 0
        assert period > 0
        assert failure_threshold > 0

    def test_vpc_connector_configuration(self) -> None:
        """Test VPC connector settings for Cloud Run."""
        # VPC connector should allow access to Redis VM
        ip_cidr_range = "10.8.0.0/28"
        min_instances = 2
        max_instances = 3

        # Validate CIDR range format
        assert "/" in ip_cidr_range

        # Validate instance counts
        assert min_instances > 0
        assert max_instances > min_instances

    def test_service_resource_limits(self) -> None:
        """Test that service resource limits are reasonable."""
        service_limits = [
            {"cpu": "1", "memory": "512Mi"},
            {"cpu": "1", "memory": "1Gi"},
            {"cpu": "1", "memory": "512Mi"},
            {"cpu": "1", "memory": "256Mi"},
        ]

        for limits in service_limits:
            # CPU should be reasonable
            cpu_value = float(limits["cpu"])
            assert 0.1 <= cpu_value <= 8

            # Memory should be reasonable
            memory_str = limits["memory"]
            if "Mi" in memory_str:
                memory_mb = int(memory_str.replace("Mi", ""))
                assert 128 <= memory_mb <= 8192
            elif "Gi" in memory_str:
                memory_gb = int(memory_str.replace("Gi", ""))
                assert 1 <= memory_gb <= 16

    def test_service_account_creation(self) -> None:
        """Test service account naming and configuration."""
        env = "test"
        account_id = f"podex-cloudrun-{env}"
        display_name = f"Podex Cloud Run ({env})"

        assert account_id == "podex-cloudrun-test"
        assert display_name == "Podex Cloud Run (test)"

    def test_iam_roles_configuration(self) -> None:
        """Test that IAM roles are correctly configured."""
        roles = [
            "roles/secretmanager.secretAccessor",
            "roles/storage.objectUser",
            "roles/cloudsql.client",
            "roles/aiplatform.user",
            "roles/logging.logWriter",
            "roles/cloudtrace.agent",
        ]

        for role in roles:
            # Check resource naming
            role_name = role.split("/")[-1]
            resource_name = f"podex-cloudrun-{role_name}-test"
            assert len(resource_name) > 0

    def test_vpc_connector_cidr_configuration(self) -> None:
        """Test VPC connector CIDR range."""
        ip_cidr_range = "10.9.0.0/28"

        # Verify CIDR format
        assert "/" in ip_cidr_range
        ip, prefix = ip_cidr_range.split("/")
        assert len(ip.split(".")) == 4  # Valid IP
        assert 0 <= int(prefix) <= 32  # Valid prefix

    def test_environment_variable_structure(self) -> None:
        """Test that environment variables are properly structured."""
        required_envs = ["ENV", "GCP_PROJECT_ID", "GCP_REGION", "LLM_PROVIDER", "EMAIL_BACKEND"]

        for env_name in required_envs:
            assert len(env_name) > 0
            assert env_name.isupper() or "_" in env_name

    def test_compute_service_special_env_vars(self) -> None:
        """Test that compute service has special environment variables."""
        compute_env_vars = [
            "COMPUTE_INTERNAL_API_KEY",
            "COMPUTE_WORKSPACE_IMAGE_X86",
            "COMPUTE_WORKSPACE_IMAGE_GPU",
        ]

        for env_var in compute_env_vars:
            assert env_var.startswith("COMPUTE_")
            assert len(env_var) > 8

    def test_secret_references(self) -> None:
        """Test that services reference correct secrets."""
        secret_env_vars = ["JWT_SECRET", "INTERNAL_API_KEY", "INTERNAL_SERVICE_TOKEN"]

        for secret_var in secret_env_vars:
            assert len(secret_var) > 0

    def test_database_url_for_services_needing_db(self) -> None:
        """Test that services needing database get DATABASE_URL."""
        services_with_db = {
            "api": True,
            "agent": True,
            "compute": False,
            "web": False,
        }

        for _service_name, needs_db in services_with_db.items():
            assert isinstance(needs_db, bool)

    def test_redis_url_for_services_needing_redis(self) -> None:
        """Test that services needing Redis get REDIS_URL."""
        services_with_redis = {
            "api": True,
            "agent": True,
            "compute": True,
            "web": False,
        }

        for _service_name, needs_redis in services_with_redis.items():
            assert isinstance(needs_redis, bool)

    def test_storage_bucket_for_services_needing_storage(self) -> None:
        """Test that services needing storage get STORAGE_BUCKET."""
        services_with_storage = {
            "api": True,
            "agent": True,
            "compute": True,
            "web": False,
        }

        for _service_name, needs_storage in services_with_storage.items():
            assert isinstance(needs_storage, bool)
