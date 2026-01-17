"""Redis on e2-micro VM configuration.

GCP Free Tier includes:
- 1 e2-micro VM (2 vCPU, 1GB RAM) in us-east1, us-central1, or us-west1
- 30GB standard persistent disk
- 1GB egress per month

This is ALWAYS FREE!
"""

from typing import Any

import pulumi
import pulumi_gcp as gcp


def create_redis_vm(
    project_id: str,
    region: str,
    env: str,
    secrets: dict[str, Any],
    vpc: dict[str, Any],
) -> dict[str, Any]:
    """Create free e2-micro VM running Redis."""
    # Use free tier eligible zone
    zone = f"{region}-a"

    # Startup script to install and configure Redis
    startup_script = pulumi.Output.all(secrets["redis_password_value"]).apply(
        lambda args: f"""#!/bin/bash
set -e

echo "Starting Redis installation..."

# Install Redis
apt-get update
apt-get install -y redis-server

# Configure Redis
cat > /etc/redis/redis.conf << 'REDIS_CONF'
# Network
bind 0.0.0.0
port 6379
protected-mode yes

# General
daemonize yes
supervised systemd
pidfile /var/run/redis/redis-server.pid
loglevel notice
logfile /var/log/redis/redis-server.log

# Memory management (e2-micro has 1GB RAM, allocate 512MB to Redis)
maxmemory 512mb
maxmemory-policy allkeys-lru

# Persistence (RDB snapshots)
save 900 1
save 300 10
save 60 10000
stop-writes-on-bgsave-error yes
rdbcompression yes
rdbchecksum yes
dbfilename dump.rdb
dir /var/lib/redis

# Security
requirepass {args[0]}

# Performance
tcp-keepalive 300
tcp-backlog 511

# Append-only file (disabled for performance)
appendonly no
REDIS_CONF

# Set permissions
chown redis:redis /etc/redis/redis.conf
chmod 640 /etc/redis/redis.conf

# Restart Redis with new config
systemctl enable redis-server
systemctl restart redis-server

# Verify Redis is running
sleep 2
redis-cli -a {args[0]} ping

echo "Redis installation complete!"
"""
    )

    # Create the VM
    redis_vm = gcp.compute.Instance(
        f"podex-redis-{env}",
        name=f"podex-redis-{env}",
        machine_type="e2-micro",  # FREE TIER!
        zone=zone,
        boot_disk=gcp.compute.InstanceBootDiskArgs(
            initialize_params=gcp.compute.InstanceBootDiskInitializeParamsArgs(
                image="debian-cloud/debian-12",
                size=30,  # 30GB standard disk is free
                type="pd-standard",
            ),
        ),
        network_interfaces=[
            gcp.compute.InstanceNetworkInterfaceArgs(
                network=vpc["network"].id,
                subnetwork=vpc["subnet"].id,
                # No external IP - access via internal network only
                # (More secure, Cloud Run can still reach it via VPC connector)
            ),
        ],
        metadata_startup_script=startup_script,
        # Tag for firewall rules
        tags=["redis-server"],
        labels={
            "env": env,
            "app": "podex",
            "service": "redis",
        },
        # Not preemptible - we want Redis to stay up
        scheduling=gcp.compute.InstanceSchedulingArgs(
            preemptible=False,
            automatic_restart=True,
            on_host_maintenance="MIGRATE",
        ),
        # Allow stopping for updates
        allow_stopping_for_update=True,
        # Service account with minimal permissions
        service_account=gcp.compute.InstanceServiceAccountArgs(
            scopes=["https://www.googleapis.com/auth/logging.write"],
        ),
    )

    # Firewall rule for Redis (internal only)
    gcp.compute.Firewall(
        f"allow-redis-{env}",
        name=f"podex-allow-redis-{env}",
        network=vpc["network"].id,
        allows=[
            gcp.compute.FirewallAllowArgs(
                protocol="tcp",
                ports=["6379"],
            ),
        ],
        # Only allow from VPC CIDR
        source_ranges=["10.0.0.0/8"],
        target_tags=["redis-server"],
        priority=1000,
    )

    # Create Redis URL secret
    redis_url_secret = gcp.secretmanager.Secret(
        f"redis-url-{env}",
        secret_id=f"podex-redis-url-{env}",
        replication=gcp.secretmanager.SecretReplicationArgs(
            auto=gcp.secretmanager.SecretReplicationAutoArgs(),
        ),
    )

    # Redis URL
    redis_url = pulumi.Output.all(
        redis_vm.network_interfaces[0].network_ip, secrets["redis_password_value"]
    ).apply(lambda args: f"redis://:{args[1]}@{args[0]}:6379/0")

    gcp.secretmanager.SecretVersion(
        f"redis-url-version-{env}",
        secret=redis_url_secret.id,
        secret_data=redis_url,
    )

    return {
        "instance": redis_vm,
        "internal_ip": redis_vm.network_interfaces[0].network_ip,
        "url_secret": redis_url_secret,
        "url": redis_url,
    }
