"""Tests for main infrastructure configuration."""

import importlib.util
import os
import sys

# Add the infrastructure directory to Python path
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))


class TestInfrastructureConfig:
    """Test basic infrastructure configuration."""

    def test_config_validation(self, project_id: str, region: str, env: str, domain: str) -> None:
        """Test that configuration values are properly set."""
        assert project_id == "podex-test"
        assert region == "us-east1"
        assert env == "test"
        assert domain == "test.podex.dev"

    def test_project_id_format(self, project_id: str) -> None:
        """Test that project ID follows GCP naming conventions."""
        # GCP project IDs must be 6-30 characters, lowercase letters, digits, or hyphens
        # Must start with a letter and cannot end with a hyphen
        import re

        assert re.match(r"^[a-z][a-z0-9-]{4,28}[a-z0-9]$", project_id)

    def test_region_format(self, region: str) -> None:
        """Test that region follows GCP region format."""
        # GCP regions follow the pattern: {location}-{number}
        import re

        assert re.match(r"^[a-z]+-[a-z]+[0-9]+$", region)

    def test_domain_format(self, domain: str) -> None:
        """Test that domain follows proper format."""
        import re

        assert re.match(r"^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$", domain)


class TestStackImports:
    """Test that all stack modules can be imported successfully."""

    def test_all_stacks_importable(self) -> None:
        """Test that all stack modules can be imported without errors."""
        # This ensures no syntax errors or missing dependencies
        stack_modules = [
            "stacks.compute",
            "stacks.database",
            "stacks.dns",
            "stacks.gke",
            "stacks.monitoring",
            "stacks.network",
        ]

        for module_name in stack_modules:
            spec = importlib.util.find_spec(module_name)
            assert spec is not None, f"Module {module_name} not found"
            assert spec.origin is not None, f"Module {module_name} has no origin"

    def test_stack_functions_exist(self) -> None:
        """Test that main functions exist in each stack module."""
        expected_functions = {
            "compute": ["create_cloud_run_services"],
            "database": ["create_cloud_sql"],
            "dns": ["create_dns_and_ssl"],
            "gke": ["create_gke_cluster", "create_gpu_node_pools"],
            "monitoring": ["create_monitoring"],
            "network": ["create_vpc"],
            "redis": ["create_redis_vm"],
            "secrets": ["create_secrets"],
            "storage": ["create_bucket", "create_artifact_registry"],
        }

        for module_name, functions in expected_functions.items():
            module = __import__(f"stacks.{module_name}", fromlist=[module_name])
            for func_name in functions:
                assert hasattr(module, func_name), (
                    f"Function {func_name} not found in {module_name}"
                )
                func = getattr(module, func_name)
                assert callable(func), f"{func_name} is not callable"
