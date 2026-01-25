"""Cloud Storage and Artifact Registry configuration.

GCP Free Tier:
- Cloud Storage: 5GB standard storage in US
- Artifact Registry: 500MB storage
"""

import pulumi_gcp as gcp


def create_bucket(
    project_id: str, env: str, allowed_origins: list[str] | None = None
) -> gcp.storage.Bucket:
    """Create Cloud Storage bucket (5GB free).

    Args:
        project_id: GCP project ID
        env: Environment (dev, staging, prod)
        allowed_origins: List of allowed CORS origins. Defaults to app domains.
    """
    # Default CORS origins based on environment
    if allowed_origins is None:
        if env == "prod":
            allowed_origins = ["https://app.podex.dev", "https://podex.dev"]
        elif env == "staging":
            allowed_origins = ["https://staging.podex.dev", "https://app.staging.podex.dev"]
        else:
            # Dev environment: allow localhost for development
            allowed_origins = [
                "http://localhost:3000",
                "http://localhost:3001",
                "https://dev.podex.dev",
            ]

    bucket = gcp.storage.Bucket(
        f"podex-workspaces-{env}",
        name=f"podex-workspaces-{env}-{project_id}",
        location="us-east1",
        storage_class="STANDARD",
        uniform_bucket_level_access=True,
        # Auto-delete old files to stay under 5GB free limit
        lifecycle_rules=[
            gcp.storage.BucketLifecycleRuleArgs(
                action=gcp.storage.BucketLifecycleRuleActionArgs(type="Delete"),
                condition=gcp.storage.BucketLifecycleRuleConditionArgs(age=30),
            ),
        ],
        # Restrictive CORS - only allow specific origins and read-only methods
        # Uploads should use signed URLs, not direct CORS uploads
        cors=[
            gcp.storage.BucketCorArgs(
                origins=allowed_origins,
                methods=["GET", "HEAD", "OPTIONS"],  # Read-only for CORS
                response_headers=["Content-Length", "Content-Type", "Content-Range"],
                max_age_seconds=3600,
            ),
        ],
        labels={
            "env": env,
            "app": "podex",
        },
    )

    return bucket


def create_artifact_registry(
    project_id: str, region: str, env: str
) -> gcp.artifactregistry.Repository:
    """Create Artifact Registry for container images."""
    repo = gcp.artifactregistry.Repository(
        f"podex-repo-{env}",
        location=region,
        repository_id=f"podex-{env}",
        format="DOCKER",
        description=f"Podex container images ({env})",
        labels={
            "env": env,
            "app": "podex",
        },
        # Cleanup policy to save storage costs
        cleanup_policies=[
            gcp.artifactregistry.RepositoryCleanupPolicyArgs(
                id="delete-old-versions",
                action="DELETE",
                condition=gcp.artifactregistry.RepositoryCleanupPolicyConditionArgs(
                    older_than="604800s",  # 7 days
                    tag_state="UNTAGGED",
                ),
            ),
        ],
    )

    return repo
