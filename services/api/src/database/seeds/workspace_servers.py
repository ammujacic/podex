"""Local development workspace servers seed data.

These servers are only seeded in development mode to support
the Docker-in-Docker (DinD) workspace infrastructure.
"""

# Local development workspace servers matching docker-compose.yml
DEV_WORKSPACE_SERVERS = [
    {
        "name": "Local Dev Server 1",
        "hostname": "ws-local-1",  # Docker DNS resolves container names
        "ip_address": "10.0.0.1",  # Placeholder IP; hostname used for actual connections
        "docker_port": 2375,
        "total_cpu": 4,
        "total_memory_mb": 8192,
        "total_disk_gb": 50,
        "total_bandwidth_mbps": 1000,
        "max_workspaces": 10,
        "architecture": "arm64",
        "region": "eu",
        "labels": {"zone": "eu-west-1a", "environment": "development"},
    },
    {
        "name": "Local Dev Server 2",
        "hostname": "ws-local-2",  # Docker DNS resolves container names
        "ip_address": "10.0.0.2",  # Placeholder IP; hostname used for actual connections
        "docker_port": 2375,
        "total_cpu": 4,
        "total_memory_mb": 8192,
        "total_disk_gb": 50,
        "total_bandwidth_mbps": 1000,
        "max_workspaces": 10,
        "architecture": "arm64",
        "region": "eu",
        "labels": {"zone": "eu-west-1b", "environment": "development"},
    },
]
