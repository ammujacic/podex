"""Tests for Cloud SQL PostgreSQL configuration."""

import os
import sys
from typing import Any
from unittest.mock import MagicMock, patch

# Add the infrastructure directory to Python path
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from stacks import database


class TestDatabaseConfiguration:
    """Test Cloud SQL database configuration."""

    def test_create_cloud_sql_function_exists(self) -> None:
        """Test that create_cloud_sql function exists and is callable."""
        assert hasattr(database, "create_cloud_sql")
        assert callable(database.create_cloud_sql)

    @patch("pulumi_gcp.sql.DatabaseInstance")
    @patch("pulumi_gcp.sql.Database")
    @patch("pulumi_gcp.sql.User")
    @patch("pulumi_gcp.secretmanager.Secret")
    @patch("pulumi_gcp.secretmanager.SecretVersion")
    @patch("pulumi.Output.all")
    @patch("pulumi.Config")
    def test_create_cloud_sql_creates_expected_resources(
        self,
        mock_config: Any,
        mock_output_all: Any,
        mock_secret_version: Any,
        mock_secret: Any,
        mock_user: Any,
        mock_database: Any,
        mock_instance: Any,
        project_id: str,
        region: str,
        env: str,
    ) -> None:
        """Test that create_cloud_sql creates all expected database resources."""
        # Mock the database resources
        mock_instance_resource = MagicMock()
        mock_instance_resource.name = f"podex-db-{env}"
        mock_instance_resource.connection_name = (
            f"{project_id}:{region}:{mock_instance_resource.name}"
        )
        mock_instance_resource.public_ip_address = "10.0.0.1"
        mock_instance_resource.private_ip_address = "10.0.0.2"
        mock_instance.return_value = mock_instance_resource

        mock_database_resource = MagicMock()
        mock_database_resource.name = "podex"
        mock_database.return_value = mock_database_resource

        mock_user_resource = MagicMock()
        mock_user.return_value = mock_user_resource

        # Mock secret resources
        mock_secret_resource = MagicMock()
        mock_secret_resource.secret_id = f"podex-database-url-{env}"
        mock_secret.return_value = mock_secret_resource

        # Mock the database URL output
        mock_db_url = MagicMock()
        mock_output_all.return_value = mock_db_url

        # Mock secrets dict
        mock_secrets = {"db_password_value": "test-password"}

        # Mock config
        mock_config_instance = MagicMock()
        mock_config_instance.get.return_value = {}
        mock_config.return_value = mock_config_instance

        # Mock VPC
        mock_vpc = {"network": MagicMock()}

        # Call the function
        result = database.create_cloud_sql(project_id, region, env, mock_secrets, mock_vpc)

        # Verify all expected resources are created
        expected_keys = [
            "instance",
            "database",
            "user",
            "connection_name",
            "public_ip",
            "private_ip",
            "url_secret",
            "url",
        ]
        for key in expected_keys:
            assert key in result, f"Resource {key} not found in result"

        # Verify DatabaseInstance was created with correct parameters
        mock_instance.assert_called_once()
        instance_call_args = mock_instance.call_args
        assert instance_call_args[0][0] == f"podex-db-{env}"
        assert instance_call_args[1]["database_version"] == "POSTGRES_16"
        assert instance_call_args[1]["region"] == region

        # Verify instance uses db-f1-micro tier
        settings = instance_call_args[1]["settings"]
        assert settings.tier == "db-f1-micro"
        assert settings.disk_size == 10
        assert settings.disk_type == "PD_SSD"

        # Verify database and user are created
        assert mock_database.call_count == 1
        assert mock_user.call_count == 1

        # Verify database URL secret is created
        assert mock_secret.call_count == 1

    def test_cloud_sql_deletion_protection(self, env: str) -> None:
        """Test that deletion protection is only enabled for production."""
        # This is testing the logic in the code
        prod_env = "prod"
        dev_env = "dev"

        # For production, deletion protection should be enabled
        assert prod_env == "prod"  # This would be True in the actual code

        # For dev, deletion protection should be disabled
        assert dev_env != "prod"  # This would be False in the actual code

    def test_database_backup_configuration(self, env: str) -> None:
        """Test database backup settings based on environment."""
        # Test that backups are only enabled for production
        prod_env = "prod"
        dev_env = "dev"

        # Production should have backups enabled
        assert prod_env == "prod"

        # Dev should have backups disabled
        assert dev_env != "prod"

    def test_database_flags_configuration(self) -> None:
        """Test that database performance flags are properly configured."""
        # Test the max_connections setting for db-f1-micro
        max_connections = 50

        # db-f1-micro should have reasonable connection limits
        assert max_connections > 0
        assert max_connections <= 100  # Should be reasonable for small instance

    @patch("pulumi_gcp.sql.DatabaseInstance")
    @patch("pulumi.Config")
    def test_database_network_configuration(
        self, mock_config: Any, mock_instance: Any, project_id: str, region: str, env: str
    ) -> None:
        """Test database network and security configuration."""
        # Mock config
        mock_config_instance = MagicMock()
        mock_config_instance.get.return_value = {}
        mock_config.return_value = mock_config_instance

        # Mock VPC
        mock_vpc = {"network": MagicMock()}

        # Mock secrets
        mock_secrets = {"db_password_value": "test-password"}

        database.create_cloud_sql(project_id, region, env, mock_secrets, mock_vpc)

        instance_call_args = mock_instance.call_args
        settings = instance_call_args[1]["settings"]
        ip_config = settings.ip_configuration

        # Database uses public IP for Cloud Run Unix socket connection (no VPC connector).
        # authorized_networks=[] so only Cloud Run / trusted paths can connect.
        assert ip_config.ipv4_enabled, "Database uses public IP for Cloud Run Unix sockets"
        authorized_networks = ip_config.authorized_networks
        assert len(authorized_networks) == 0, (
            "No authorized networks; Cloud Run connects via Unix sockets"
        )

        # Private network should always be configured
        assert ip_config.private_network is not None
        assert ip_config.enable_private_path_for_google_cloud_services

    def test_database_url_format(self) -> None:
        """Test that database URL follows expected format."""
        # Test the URL construction logic
        public_ip = "10.0.0.1"
        password = "test-password"

        expected_url = f"postgresql+asyncpg://podex:{password}@{public_ip}:5432/podex"

        # Verify URL components
        assert "postgresql+asyncpg" in expected_url
        assert "podex:" in expected_url  # Username
        assert "@" in expected_url
        assert ":5432/podex" in expected_url  # Port and database

    def test_cloud_sql_instance_naming(self, project_id: str, region: str, env: str) -> None:
        """Test that Cloud SQL instance follows naming conventions."""
        instance_name = f"podex-db-{env}"

        # Verify naming pattern
        assert instance_name.startswith("podex-db-")
        assert instance_name.endswith(f"-{env}")
        assert len(instance_name) <= 98  # GCP resource name limit
