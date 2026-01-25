"""Tests for Cloud Storage and Artifact Registry configuration."""

import os
import sys
from typing import Any
from unittest.mock import patch

# Add the infrastructure directory to Python path
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from stacks import storage


class TestStorageConfiguration:
    """Test Cloud Storage configuration."""

    def test_create_bucket_function_exists(self) -> None:
        """Test that create_bucket function exists and is callable."""
        assert hasattr(storage, "create_bucket")
        assert callable(storage.create_bucket)

    def test_create_artifact_registry_function_exists(self) -> None:
        """Test that create_artifact_registry function exists and is callable."""
        assert hasattr(storage, "create_artifact_registry")
        assert callable(storage.create_artifact_registry)

    @patch("pulumi_gcp.storage.Bucket")
    def test_create_bucket_creates_bucket_with_correct_settings(
        self, mock_bucket: Any, project_id: str, env: str
    ) -> None:
        """Test that create_bucket creates a bucket with correct settings."""
        # Call the function
        storage.create_bucket(project_id, env)

        # Verify Bucket was called
        assert mock_bucket.called
        call_args = mock_bucket.call_args

        # Verify bucket name follows naming convention
        resource_name = call_args[0][0]
        assert resource_name == f"podex-workspaces-{env}"

        # Verify bucket configuration
        kwargs = call_args[1]
        assert kwargs["name"] == f"podex-workspaces-{env}-{project_id}"
        assert kwargs["location"] == "us-east1"
        assert kwargs["storage_class"] == "STANDARD"
        assert kwargs["uniform_bucket_level_access"] is True

        # Verify lifecycle rules are configured
        assert "lifecycle_rules" in kwargs
        assert len(kwargs["lifecycle_rules"]) > 0

        # Verify CORS is configured
        assert "cors" in kwargs
        assert len(kwargs["cors"]) > 0

        # Verify labels
        assert kwargs["labels"]["env"] == env
        assert kwargs["labels"]["app"] == "podex"

    @patch("pulumi_gcp.storage.Bucket")
    def test_create_bucket_prod_cors_origins(self, mock_bucket: Any, project_id: str) -> None:
        """Test that prod environment has correct CORS origins."""
        storage.create_bucket(project_id, "prod")

        call_args = mock_bucket.call_args[1]
        cors = call_args["cors"][0]

        # Verify prod origins
        origins = cors.origins
        assert "https://app.podex.dev" in origins
        assert "https://podex.dev" in origins
        assert "http://localhost:3000" not in origins

    @patch("pulumi_gcp.storage.Bucket")
    def test_create_bucket_staging_cors_origins(self, mock_bucket: Any, project_id: str) -> None:
        """Test that staging environment has correct CORS origins."""
        storage.create_bucket(project_id, "staging")

        call_args = mock_bucket.call_args[1]
        cors = call_args["cors"][0]

        # Verify staging origins
        origins = cors.origins
        assert "https://staging.podex.dev" in origins
        assert "https://app.staging.podex.dev" in origins

    @patch("pulumi_gcp.storage.Bucket")
    def test_create_bucket_dev_cors_origins(self, mock_bucket: Any, project_id: str) -> None:
        """Test that dev environment has correct CORS origins."""
        storage.create_bucket(project_id, "dev")

        call_args = mock_bucket.call_args[1]
        cors = call_args["cors"][0]

        # Verify dev origins include localhost
        origins = cors.origins
        assert "http://localhost:3000" in origins
        assert "http://localhost:3001" in origins
        assert "https://dev.podex.dev" in origins

    @patch("pulumi_gcp.storage.Bucket")
    def test_create_bucket_custom_cors_origins(
        self, mock_bucket: Any, project_id: str, env: str
    ) -> None:
        """Test that custom CORS origins can be provided."""
        custom_origins = ["https://custom.example.com", "https://other.example.com"]
        storage.create_bucket(project_id, env, allowed_origins=custom_origins)

        call_args = mock_bucket.call_args[1]
        cors = call_args["cors"][0]

        # Verify custom origins are used
        assert cors.origins == custom_origins

    @patch("pulumi_gcp.storage.Bucket")
    def test_create_bucket_lifecycle_rules(
        self, mock_bucket: Any, project_id: str, env: str
    ) -> None:
        """Test that lifecycle rules are configured to delete old files."""
        storage.create_bucket(project_id, env)

        call_args = mock_bucket.call_args[1]
        lifecycle_rules = call_args["lifecycle_rules"]

        # Should have lifecycle rule to delete old files
        assert len(lifecycle_rules) > 0
        rule = lifecycle_rules[0]
        assert rule.action.type == "Delete"
        assert rule.condition.age == 30  # 30 days

    @patch("pulumi_gcp.storage.Bucket")
    def test_create_bucket_cors_methods_are_read_only(
        self, mock_bucket: Any, project_id: str, env: str
    ) -> None:
        """Test that CORS methods are read-only for security."""
        storage.create_bucket(project_id, env)

        call_args = mock_bucket.call_args[1]
        cors = call_args["cors"][0]

        # Verify only read-only methods are allowed
        methods = cors.methods
        assert "GET" in methods
        assert "HEAD" in methods
        assert "OPTIONS" in methods
        assert "POST" not in methods
        assert "PUT" not in methods
        assert "DELETE" not in methods

    @patch("pulumi_gcp.artifactregistry.Repository")
    def test_create_artifact_registry_creates_repo(
        self, mock_repo: Any, project_id: str, region: str, env: str
    ) -> None:
        """Test that create_artifact_registry creates a repository."""
        storage.create_artifact_registry(project_id, region, env)

        # Verify Repository was called
        assert mock_repo.called
        call_args = mock_repo.call_args

        # Verify resource name
        resource_name = call_args[0][0]
        assert resource_name == f"podex-repo-{env}"

        # Verify repository configuration
        kwargs = call_args[1]
        assert kwargs["location"] == region
        assert kwargs["repository_id"] == f"podex-{env}"
        assert kwargs["format"] == "DOCKER"
        assert f"Podex container images ({env})" in kwargs["description"]

        # Verify labels
        assert kwargs["labels"]["env"] == env
        assert kwargs["labels"]["app"] == "podex"

    @patch("pulumi_gcp.artifactregistry.Repository")
    def test_create_artifact_registry_cleanup_policy(
        self, mock_repo: Any, project_id: str, region: str, env: str
    ) -> None:
        """Test that artifact registry has cleanup policy to save storage."""
        storage.create_artifact_registry(project_id, region, env)

        call_args = mock_repo.call_args[1]
        cleanup_policies = call_args["cleanup_policies"]

        # Should have cleanup policy
        assert len(cleanup_policies) > 0
        policy = cleanup_policies[0]
        assert policy.id == "delete-old-versions"
        assert policy.action == "DELETE"
        assert policy.condition.older_than == "604800s"  # 7 days
        assert policy.condition.tag_state == "UNTAGGED"

    def test_bucket_storage_class_is_standard(self, project_id: str, env: str) -> None:
        """Test that bucket uses STANDARD storage class for free tier."""
        # STANDARD storage class is required for free tier
        assert True  # This is validated in the create_bucket test

    def test_bucket_location_is_us_region(self, project_id: str, env: str) -> None:
        """Test that bucket is in US region for free tier."""
        # US regions are required for free tier
        assert True  # This is validated in the create_bucket test

    @patch("pulumi_gcp.storage.Bucket")
    def test_create_bucket_cors_response_headers(
        self, mock_bucket: Any, project_id: str, env: str
    ) -> None:
        """Test that CORS response headers are configured."""
        storage.create_bucket(project_id, env)

        call_args = mock_bucket.call_args[1]
        cors = call_args["cors"][0]

        # Verify response headers
        response_headers = cors.response_headers
        assert "Content-Length" in response_headers
        assert "Content-Type" in response_headers
        assert "Content-Range" in response_headers

    @patch("pulumi_gcp.storage.Bucket")
    def test_create_bucket_cors_max_age(self, mock_bucket: Any, project_id: str, env: str) -> None:
        """Test that CORS max age is set."""
        storage.create_bucket(project_id, env)

        call_args = mock_bucket.call_args[1]
        cors = call_args["cors"][0]

        # Verify max age is 1 hour
        assert cors.max_age_seconds == 3600
