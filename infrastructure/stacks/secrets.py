"""Secret Manager configuration.

GCP Free Tier: 6 active secret versions
"""

from typing import Any

import pulumi_gcp as gcp
import pulumi_random as random


def create_secrets(project_id: str, env: str) -> dict[str, Any]:
    """Create Secret Manager secrets (6 free versions)."""
    secrets: dict[str, Any] = {}

    # 1. JWT Secret (auto-generated)
    jwt_value = random.RandomPassword(
        f"jwt-secret-value-{env}",
        length=64,
        special=False,
    )

    jwt_secret = gcp.secretmanager.Secret(
        f"jwt-secret-{env}",
        secret_id=f"podex-jwt-secret-{env}",
        replication=gcp.secretmanager.SecretReplicationArgs(
            auto=gcp.secretmanager.SecretReplicationAutoArgs(),
        ),
    )

    gcp.secretmanager.SecretVersion(
        f"jwt-secret-version-{env}",
        secret=jwt_secret.id,
        secret_data=jwt_value.result,
    )

    secrets["jwt"] = jwt_secret
    secrets["jwt_value"] = jwt_value.result
    # 2. Database password (auto-generated)
    db_password = random.RandomPassword(
        f"db-password-{env}",
        length=32,
        special=False,
    )

    db_secret = gcp.secretmanager.Secret(
        f"db-password-{env}",
        secret_id=f"podex-db-password-{env}",
        replication=gcp.secretmanager.SecretReplicationArgs(
            auto=gcp.secretmanager.SecretReplicationAutoArgs(),
        ),
    )

    gcp.secretmanager.SecretVersion(
        f"db-password-version-{env}",
        secret=db_secret.id,
        secret_data=db_password.result,
    )

    secrets["db_password"] = db_secret
    secrets["db_password_value"] = db_password.result
    # 3. Redis password (auto-generated)
    redis_password = random.RandomPassword(
        f"redis-password-{env}",
        length=32,
        special=False,
    )

    redis_secret = gcp.secretmanager.Secret(
        f"redis-password-{env}",
        secret_id=f"podex-redis-password-{env}",
        replication=gcp.secretmanager.SecretReplicationArgs(
            auto=gcp.secretmanager.SecretReplicationAutoArgs(),
        ),
    )

    gcp.secretmanager.SecretVersion(
        f"redis-password-version-{env}",
        secret=redis_secret.id,
        secret_data=redis_password.result,
    )

    secrets["redis_password"] = redis_secret
    secrets["redis_password_value"] = redis_password.result
    # 4. Internal API key (for service-to-service auth)
    internal_api_key = random.RandomPassword(
        f"internal-api-key-{env}",
        length=48,
        special=False,
    )

    internal_secret = gcp.secretmanager.Secret(
        f"internal-api-key-{env}",
        secret_id=f"podex-internal-api-key-{env}",
        replication=gcp.secretmanager.SecretReplicationArgs(
            auto=gcp.secretmanager.SecretReplicationAutoArgs(),
        ),
    )

    gcp.secretmanager.SecretVersion(
        f"internal-api-key-version-{env}",
        secret=internal_secret.id,
        secret_data=internal_api_key.result,
    )

    secrets["internal_api_key"] = internal_secret
    secrets["internal_api_key_value"] = internal_api_key.result
    # 5-6. Placeholder secrets (set manually via console or CLI)
    # These are for optional external services
    for name in ["sendgrid-api-key", "stripe-api-key"]:
        secret = gcp.secretmanager.Secret(
            f"{name}-{env}",
            secret_id=f"podex-{name}-{env}",
            replication=gcp.secretmanager.SecretReplicationArgs(
                auto=gcp.secretmanager.SecretReplicationAutoArgs(),
            ),
        )
        # Add placeholder version
        gcp.secretmanager.SecretVersion(
            f"{name}-version-{env}",
            secret=secret.id,
            secret_data="PLACEHOLDER_SET_VIA_CONSOLE",
        )
        secrets[name.replace("-", "_")] = secret

    return secrets
