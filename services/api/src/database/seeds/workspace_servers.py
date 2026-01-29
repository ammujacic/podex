"""Local development workspace servers seed data.

These servers are only seeded in development mode to support
the Docker-in-Docker (DinD) workspace infrastructure.
"""

# Local development workspace servers matching docker-compose.yml
DEV_WORKSPACE_SERVERS = [
    {
        "name": "Local Dev Server 1",
        "hostname": "ws-local-1",
        "ip_address": "ws-local-1",  # Docker DNS resolves container names
        "docker_port": 2375,
        "total_cpu": 4,
        "total_memory_mb": 8192,
        "total_disk_gb": 50,
        "total_bandwidth_mbps": 1000,
        "max_workspaces": 10,
        "architecture": "amd64",
        "region": "local",
        "labels": {"zone": "local-1", "environment": "development"},
    },
    {
        "name": "Local Dev Server 2",
        "hostname": "ws-local-2",
        "ip_address": "ws-local-2",
        "docker_port": 2375,
        "total_cpu": 4,
        "total_memory_mb": 8192,
        "total_disk_gb": 50,
        "total_bandwidth_mbps": 1000,
        "max_workspaces": 10,
        "architecture": "amd64",
        "region": "local",
        "labels": {"zone": "local-2", "environment": "development"},
    },
]
