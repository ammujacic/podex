"""Secret Manager configuration.

Creates secrets for all services. External service secrets are created as placeholders
and should be set via GCP Console or CLI after deployment.

Secrets are organized into:
  - Auto-generated: JWT, DB password, Redis password, Internal API key
  - Required placeholders: Admin email/password
  - Optional external services: Sentry, Stripe, OAuth, VAPID, LLM APIs
"""

from typing import Any

import pulumi_gcp as gcp
import pulumi_random as random


def create_secrets(project_id: str, env: str) -> dict[str, Any]:
    """Create Secret Manager secrets for all services."""
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
    # =========================================
    # Admin credentials (required for first login)
    # =========================================
    admin_email_secret = gcp.secretmanager.Secret(
        f"admin-email-{env}",
        secret_id=f"podex-admin-email-{env}",
        replication=gcp.secretmanager.SecretReplicationArgs(
            auto=gcp.secretmanager.SecretReplicationAutoArgs(),
        ),
    )
    gcp.secretmanager.SecretVersion(
        f"admin-email-version-{env}",
        secret=admin_email_secret.id,
        secret_data="admin@example.com",  # Change after deployment
    )
    secrets["admin_email"] = admin_email_secret

    admin_password_secret = gcp.secretmanager.Secret(
        f"admin-password-{env}",
        secret_id=f"podex-admin-password-{env}",
        replication=gcp.secretmanager.SecretReplicationArgs(
            auto=gcp.secretmanager.SecretReplicationAutoArgs(),
        ),
    )
    gcp.secretmanager.SecretVersion(
        f"admin-password-version-{env}",
        secret=admin_password_secret.id,
        secret_data="ChangeThisPassword123!",  # Change after deployment
    )
    secrets["admin_password"] = admin_password_secret

    # =========================================
    # Optional external service secrets
    # All use empty string as default (services should handle gracefully)
    # =========================================
    optional_secrets = [
        # Error tracking - per-service DSNs
        "sentry-dsn-api",
        "sentry-dsn-agent",
        "sentry-dsn-compute",
        "sentry-dsn-web",
        # Sentry build-time (for source maps upload)
        "sentry-auth-token",
        "sentry-org",
        "sentry-project",
        # Email
        "sendgrid-api-key",
        # Payments (Stripe)
        "stripe-secret-key",
        "stripe-webhook-secret",
        "stripe-publishable-key",
        # OAuth - GitHub
        "github-client-id",
        "github-client-secret",
        "github-redirect-uri",
        # OAuth - Google
        "google-client-id",
        "google-client-secret",
        "google-redirect-uri",
        # Push notifications (VAPID)
        "vapid-public-key",
        "vapid-private-key",
        "vapid-email",
        # LLM APIs (alternative to Vertex AI)
        "anthropic-api-key",
        "openai-api-key",
    ]

    for name in optional_secrets:
        secret = gcp.secretmanager.Secret(
            f"{name}-{env}",
            secret_id=f"podex-{name}-{env}",
            replication=gcp.secretmanager.SecretReplicationArgs(
                auto=gcp.secretmanager.SecretReplicationAutoArgs(),
            ),
        )
        # Empty string as default - services should check and handle gracefully
        gcp.secretmanager.SecretVersion(
            f"{name}-version-{env}",
            secret=secret.id,
            secret_data="",  # Empty = not configured
        )
        # Convert kebab-case to snake_case for dict key
        secrets[name.replace("-", "_")] = secret

    return secrets
