# Unified Multi-Server Workspace Architecture

**Date:** 2026-01-29
**Status:** Approved
**Author:** Design session with Claude

## Overview

This design consolidates our workspace management into a single multi-server architecture that works identically in local development and production. The key change is removing the local Docker socket approach and always connecting to workspace servers over the network (HTTP locally, TLS in production).

## Goals

1. **Single code path** - No more dual modes (local socket vs multi-server)
2. **Test production locally** - Same architecture, same code, different config
3. **Dynamic server management** - Add/remove servers via admin panel
4. **Full visibility** - Monitor server health and capacity in real-time

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Compute Service                             │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              WorkspaceOrchestrator                       │   │
│  │              (Single entry point)                        │   │
│  │                                                          │   │
│  │  ┌───────────┐ ┌───────────┐ ┌─────────┐ ┌───────────┐  │   │
│  │  │ Placement │ │ GitSetup  │ │ Billing │ │  Scaling  │  │   │
│  │  │ Service   │ │ Service   │ │ Tracker │ │  Service  │  │   │
│  │  └───────────┘ └───────────┘ └─────────┘ └───────────┘  │   │
│  └──────────────────────────┬──────────────────────────────┘   │
│                             │                                   │
│                             ▼                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                   DockerServerPool                        │  │
│  │            (Manages connections to all servers)           │  │
│  └──────────────────────────┬───────────────────────────────┘  │
└─────────────────────────────┼───────────────────────────────────┘
                              │
              HTTP (local) or HTTPS+mTLS (production)
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
   ┌────────────┐      ┌────────────┐      ┌────────────┐
   │ ws-local-1 │      │ ws-local-2 │      │  ws-eu-1   │
   │   (DinD)   │      │   (DinD)   │      │ (Hetzner)  │
   │  HTTP:2375 │      │  HTTP:2375 │      │  TLS:2376  │
   └────────────┘      └────────────┘      └────────────┘
```

## Configuration Model

### Server Configuration (Database)

```python
class WorkspaceServer(Base):
    __tablename__ = "workspace_servers"

    id: str                    # UUID
    name: str                  # e.g., "ws-eu-1"
    host: str                  # IP or hostname
    docker_port: int           # 2375 (HTTP) or 2376 (TLS)
    tls_enabled: bool          # False for local, True for production
    cert_path: str | None      # Path to TLS certs

    # Capacity (configured by admin)
    total_cpu: float           # Total CPU cores
    total_memory_mb: int       # Total RAM
    total_disk_gb: int         # Total disk
    max_workspaces: int        # Soft limit

    # Labels for placement
    labels: dict               # {"region": "eu", "gpu": true}

    # Status (updated by health monitor)
    status: str                # healthy, unhealthy, offline
    last_health_check: datetime
    last_error: str | None

    # Current usage
    current_cpu_used: float
    current_memory_used_mb: int
    current_disk_used_gb: int
    current_workspaces: int
```

### Local Development (docker-compose.yml)

```yaml
services:
  ws-local-1:
    image: docker:27-dind
    container_name: ws-local-1
    privileged: true
    environment:
      DOCKER_TLS_CERTDIR: ""  # HTTP for local
    expose:
      - "2375"
    volumes:
      - ws-local-1-data:/var/lib/docker
    healthcheck:
      test: ["CMD", "docker", "info"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 15s

  ws-local-2:
    image: docker:27-dind
    container_name: ws-local-2
    privileged: true
    environment:
      DOCKER_TLS_CERTDIR: ""
    expose:
      - "2375"
    volumes:
      - ws-local-2-data:/var/lib/docker
    healthcheck:
      test: ["CMD", "docker", "info"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 15s

  compute:
    # ... existing config ...
    environment:
      COMPUTE_WORKSPACE_SERVERS: >-
        [
          {"server_id": "ws-local-1", "host": "ws-local-1", "docker_port": 2375, "tls_enabled": false},
          {"server_id": "ws-local-2", "host": "ws-local-2", "docker_port": 2375, "tls_enabled": false}
        ]
    depends_on:
      ws-local-1:
        condition: service_healthy
      ws-local-2:
        condition: service_healthy
    # REMOVED: /var/run/docker.sock mount
```

## DockerServerPool

Manages connections to all workspace servers:

```python
class DockerServerPool:
    def __init__(self, servers: list[ServerConfig]):
        self._clients: dict[str, DockerClient] = {}
        for server in servers:
            self._clients[server.server_id] = self._create_client(server)

    def _create_client(self, server: ServerConfig) -> DockerClient:
        if server.tls_enabled:
            tls_config = TLSConfig(
                client_cert=(f"{server.cert_path}/cert.pem", f"{server.cert_path}/key.pem"),
                ca_cert=f"{server.cert_path}/ca.pem",
                verify=True,
            )
            return DockerClient(base_url=f"https://{server.host}:{server.docker_port}", tls=tls_config)
        else:
            return DockerClient(base_url=f"tcp://{server.host}:{server.docker_port}")

    async def create_container(self, server_id: str, ...) -> str: ...
    async def start_container(self, server_id: str, container_id: str) -> None: ...
    async def stop_container(self, server_id: str, container_id: str) -> None: ...
    async def exec_command(self, server_id: str, container_id: str, command: str) -> tuple[int, str]: ...
    async def check_workspace_health(self, server_id: str, container_id: str) -> WorkspaceHealth: ...
```

## Placement Service

Selects the best server for new workspaces:

```python
class PlacementStrategy(str, Enum):
    SPREAD = "spread"       # Minimize average utilization
    BEST_FIT = "best_fit"   # Maximize resource usage
    AFFINITY = "affinity"   # Prefer specific server
    ROUND_ROBIN = "round_robin"

class PlacementService:
    async def find_placement(
        self,
        requirements: ResourceRequirements,
        strategy: PlacementStrategy = PlacementStrategy.SPREAD,
        preferred_server: str | None = None,
    ) -> PlacementResult:
        # 1. Get healthy servers only
        # 2. Filter to servers with capacity
        # 3. Apply strategy to select best
        ...
```

## Health Monitoring

Two-level health checks:

### Server Health
```python
class ServerHealth:
    server_id: str
    healthy: bool
    total_cpu: float
    total_memory_mb: int
    containers_running: int
    error: str | None
    last_check: datetime
```

### Workspace Health
```python
class WorkspaceHealth:
    container_id: str
    server_id: str
    running: bool
    healthy: bool          # running + app responding
    cpu_percent: float
    memory_usage_mb: int
    started_at: str
    error: str | None
    last_check: datetime
```

## Admin Panel

Server management UI showing:

- All registered servers with health status
- Real-time capacity (CPU, memory, disk usage)
- Cluster totals
- Add/remove servers dynamically
- Per-server workspace list

### Admin API Endpoints

```
GET    /admin/servers           - List all servers
POST   /admin/servers           - Add new server
GET    /admin/servers/{id}      - Get server details
GET    /admin/servers/{id}/stats - Get live stats
DELETE /admin/servers/{id}      - Remove server
```

## Error Handling

| Scenario | Handling |
|----------|----------|
| Server unreachable | Mark unhealthy, exclude from placement |
| Container died | Update workspace status to ERROR |
| No capacity | Return InsufficientCapacityError |
| All servers down | Return NoHealthyServersError |

## Local vs Production

| Aspect | Local (docker-compose) | Production (Hetzner) |
|--------|------------------------|----------------------|
| Config source | Environment variable | Database |
| Servers | ws-local-1, ws-local-2 (DinD) | ws-eu-1, ws-eu-2 (physical) |
| Protocol | HTTP (tls_enabled: false) | TLS (tls_enabled: true) |
| Hostnames | Docker service names | IP addresses |
| Certs | None | Generated by workspace-server-init.sh |

## Migration Phases

### Phase 1: Foundation
- Database models (WorkspaceServer)
- Admin API endpoints
- DockerServerPool (HTTP + TLS)
- Server health monitoring

### Phase 2: Core Services
- PlacementService
- GitSetupService (extracted)
- BillingTracker (extracted)
- ScalingService (extracted)

### Phase 3: Orchestrator
- Enhance WorkspaceOrchestrator
- Wire up status integration
- Update deps.py
- Update routes

### Phase 4: Local Infrastructure
- Add DinD to docker-compose.yml
- Update Makefile
- Database seed for local servers
- Remove Docker socket mount

### Phase 5: Cleanup
- Delete DockerComputeManager
- Remove old config options
- Update documentation
- Add admin UI

## Files Changed

| Action | File |
|--------|------|
| Create | `services/api/src/database/models/server.py` |
| Create | `services/api/src/routes/admin/servers.py` |
| Create | `services/compute/src/managers/docker_server_pool.py` |
| Create | `services/compute/src/managers/server_health.py` |
| Create | `services/compute/src/services/git_setup.py` |
| Create | `services/compute/src/services/billing_tracker.py` |
| Create | `services/compute/src/services/scaling.py` |
| Modify | `services/compute/src/managers/placement.py` |
| Modify | `services/compute/src/managers/workspace_orchestrator.py` |
| Modify | `services/compute/src/deps.py` |
| Modify | `docker-compose.yml` |
| Modify | `Makefile` |
| Delete | `services/compute/src/managers/docker_manager.py` |

## Testing Strategy

### Unit Tests (mocked Docker)
- DockerServerPool operations
- Placement algorithms
- Health check logic

### Integration Tests (DinD)
- Real Docker API calls
- Multi-server placement
- Container lifecycle

### E2E Tests (full stack)
- Complete workspace lifecycle
- Admin server management
- Failover scenarios

## Success Criteria

1. `make run` starts DinD workspace servers
2. Workspaces created on DinD servers, not local socket
3. Admin panel shows server status and capacity
4. Same code works with TLS in production
5. All existing tests pass
6. No user-facing API changes
