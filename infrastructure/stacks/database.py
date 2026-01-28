"""Cloud SQL PostgreSQL configuration.

Uses db-f1-micro instance (~$9/month) - the cheapest option.
"""

from typing import Any

import pulumi
import pulumi_gcp as gcp


def create_cloud_sql(
    project_id: str,
    region: str,
    env: str,
    secrets: dict[str, Any],
    vpc: dict[str, Any],
) -> dict[str, Any]:
    """Create Cloud SQL PostgreSQL instance (db-f1-micro ~$9/mo)."""
    # Configuration
    config = pulumi.Config()

    # Get authorized networks for dev environment (customizable)
    _dev_authorized_networks: dict[str, str] = config.get_object("dev_db_authorized_networks") or {}

    # Cloud SQL Instance
    # Deletion protection is always enabled to prevent accidental data loss
    # Use `pulumi config set delete_protection false` to disable for cleanup
    delete_protection_config = config.get_bool("delete_protection")
    deletion_protection_enabled = (
        delete_protection_config if delete_protection_config is not None else True
    )

    instance = gcp.sql.DatabaseInstance(
        f"podex-db-{env}",
        name=f"podex-db-{env}",
        database_version="POSTGRES_16",
        region=region,
        deletion_protection=deletion_protection_enabled,
        settings=gcp.sql.DatabaseInstanceSettingsArgs(
            # db-f1-micro: 0.25 vCPU, 0.6GB RAM, ~$9/mo
            tier="db-f1-micro",
            disk_size=10,
            disk_type="PD_SSD",
            disk_autoresize=False,  # Keep costs predictable
            availability_type="ZONAL",  # No HA for dev
            # Backups (disabled for dev to save costs)
            backup_configuration=gcp.sql.DatabaseInstanceSettingsBackupConfigurationArgs(
                enabled=env == "prod",
                start_time="03:00" if env == "prod" else None,
                point_in_time_recovery_enabled=env == "prod",
                backup_retention_settings=gcp.sql.DatabaseInstanceSettingsBackupConfigurationBackupRetentionSettingsArgs(
                    retained_backups=7,
                )
                if env == "prod"
                else None,
            ),
            # IP Configuration - Enable public IP for Cloud Run Unix socket connection
            # Cloud Run can connect via Unix domain sockets without VPC connector
            # Format: postgresql://user:pass@localhost/db?host=/cloudsql/project:region:instance
            ip_configuration=gcp.sql.DatabaseInstanceSettingsIpConfigurationArgs(
                ipv4_enabled=True,  # Enable public IP for Unix socket access
                # Keep private IP for future VPC access if needed
                private_network=vpc["network"].id if vpc else None,
                enable_private_path_for_google_cloud_services=True,
                # Require SSL for all connections
                ssl_mode="ENCRYPTED_ONLY",
                # Restrict authorized networks (empty = only Cloud Run can connect via Unix sockets)
                authorized_networks=[],
            ),
            # Flags for performance
            database_flags=[
                gcp.sql.DatabaseInstanceSettingsDatabaseFlagArgs(
                    name="max_connections",
                    value="50",  # Small instance, limit connections
                ),
            ],
            # Labels
            user_labels={
                "env": env,
                "app": "podex",
            },
        ),
    )

    # Database
    database = gcp.sql.Database(
        f"podex-database-{env}",
        name="podex",
        instance=instance.name,
    )

    # Database User
    user = gcp.sql.User(
        f"podex-user-{env}",
        name="podex",
        instance=instance.name,
        password=secrets["db_password_value"],
    )

    # Create database URL secret
    db_url_secret = gcp.secretmanager.Secret(
        f"database-url-{env}",
        secret_id=f"podex-database-url-{env}",
        replication=gcp.secretmanager.SecretReplicationArgs(
            auto=gcp.secretmanager.SecretReplicationAutoArgs(),
        ),
    )

    # Database URL for asyncpg
    # Use Unix domain socket connection (Cloud Run built-in, no VPC connector needed)
    # Format: postgresql+asyncpg://user:pass@/db?host=/cloudsql/project:region:instance
    # Note: Empty hostname means use Unix socket, host parameter specifies socket path
    connection_name = instance.connection_name
    db_url = pulumi.Output.all(
        connection_name,
        secrets["db_password_value"],
    ).apply(lambda args: f"postgresql+asyncpg://podex:{args[1]}@/podex?host=/cloudsql/{args[0]}")

    gcp.secretmanager.SecretVersion(
        f"database-url-version-{env}",
        secret=db_url_secret.id,
        secret_data=db_url,
    )

    return {
        "instance": instance,
        "database": database,
        "user": user,
        "connection_name": instance.connection_name,
        "public_ip": instance.public_ip_address,
        "private_ip": instance.private_ip_address,
        "url_secret": db_url_secret,
        "url": db_url,
    }
