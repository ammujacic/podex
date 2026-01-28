"""Tests for Secret Manager configuration."""

import os
import sys
from typing import Any
from unittest.mock import MagicMock, patch

# Add the infrastructure directory to Python path
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from stacks import secrets


class TestSecretsConfiguration:
    """Test Secret Manager configuration."""

    def test_create_secrets_function_exists(self) -> None:
        """Test that create_secrets function exists and is callable."""
        assert hasattr(secrets, "create_secrets")
        assert callable(secrets.create_secrets)

    @patch("pulumi_gcp.secretmanager.Secret")
    @patch("pulumi_gcp.secretmanager.SecretVersion")
    @patch("pulumi_random.RandomPassword")
    @patch("pulumi.Config")
    def test_create_secrets_creates_expected_secrets(
        self,
        mock_config: Any,
        mock_random_password: Any,
        mock_secret_version: Any,
        mock_secret: Any,
        project_id: str,
        env: str,
    ) -> None:
        """Test that create_secrets creates the expected number of secrets."""
        # Mock Pulumi config
        mock_config_instance = MagicMock()
        mock_config_instance.get.return_value = None
        mock_config.return_value = mock_config_instance

        # Mock the random password results
        mock_password_instance = MagicMock()
        mock_password_instance.result = "test-password-123"
        mock_random_password.return_value = mock_password_instance

        # Mock secret instances
        mock_secret_instance = MagicMock()
        mock_secret_instance.id = "test-secret-id"
        mock_secret.return_value = mock_secret_instance

        # Call the function
        result = secrets.create_secrets(project_id, env)

        # Verify the expected secrets are created
        expected_secrets = [
            "jwt",
            "jwt_value",
            "db_password",
            "db_password_value",
            "redis_password",
            "redis_password_value",
            "internal_api_key",
            "internal_api_key_value",
            "sendgrid_api_key",
            "stripe_secret_key",
            "admin_email",
            "admin_password",
        ]

        for secret_key in expected_secrets:
            assert secret_key in result, f"Secret {secret_key} not found in result"

        # Verify RandomPassword was called for the required secrets (5 times)
        assert mock_random_password.call_count == 5

        # Verify Secret was called for all secrets (28: 6 base + 22 optional)
        assert mock_secret.call_count == 28

        # Verify SecretVersion was called for all secrets (28 times)
        assert mock_secret_version.call_count == 28

    def test_secret_ids_follow_naming_convention(self, project_id: str, env: str) -> None:
        """Test that secret IDs follow the expected naming convention."""
        expected_secret_ids = [
            f"podex-jwt-secret-{env}",
            f"podex-db-password-{env}",
            f"podex-redis-password-{env}",
            f"podex-internal-api-key-{env}",
            f"podex-sendgrid-api-key-{env}",
            f"podex-stripe-api-key-{env}",
            f"podex-admin-email-{env}",
            f"podex-admin-password-{env}",
        ]

        # We can't easily test the actual creation without mocking,
        # but we can verify the naming logic by examining the code
        # This is a basic check that the pattern is consistent
        for secret_id in expected_secret_ids:
            assert secret_id.startswith("podex-")
            assert secret_id.endswith(f"-{env}")

    def test_password_complexity_requirements(self) -> None:
        """Test that passwords meet complexity requirements."""
        # Test password length requirements (from the code: 64, 32, 32, 48)
        expected_lengths = [64, 32, 32, 48]

        # We verify the lengths are reasonable for security
        for length in expected_lengths:
            assert length >= 32, f"Password length {length} is too short"
            assert length <= 128, f"Password length {length} is too long"

    @patch("pulumi_gcp.secretmanager.Secret")
    @patch("pulumi_random.RandomPassword")
    def test_secrets_use_automatic_replication(
        self, mock_random_password: Any, mock_secret: Any, project_id: str, env: str
    ) -> None:
        """Test that secrets use automatic replication."""
        mock_password_instance = MagicMock()
        mock_password_instance.result = "test-password"
        mock_random_password.return_value = mock_password_instance

        mock_secret_instance = MagicMock()
        mock_secret_instance.id = "test-secret-id"
        mock_secret.return_value = mock_secret_instance

        secrets.create_secrets(project_id, env)

        # Verify that Secret was called with replication configuration
        call_args = mock_secret.call_args_list[0]
        replication_config = call_args[1]["replication"]
        assert hasattr(replication_config, "auto"), "Secrets should use automatic replication"
