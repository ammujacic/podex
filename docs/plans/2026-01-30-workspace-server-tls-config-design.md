# Workspace Server TLS Configuration Design

## Overview

Unify workspace server configuration so that servers added via the admin UI are automatically available to the compute service. Currently, the admin UI saves servers to the database while the compute service reads from the `COMPUTE_WORKSPACE_SERVERS` environment variable - they are disconnected.

## Goals

1. Compute service fetches server configuration from API service (database)
2. Admin UI supports TLS certificate path configuration
3. Remove `COMPUTE_WORKSPACE_SERVERS` environment variable
4. Maintain backward compatibility for local development (no TLS)

## Design Decisions

| Decision          | Choice                       | Rationale                                         |
| ----------------- | ---------------------------- | ------------------------------------------------- |
| Sync mechanism    | Startup + periodic (30s)     | Simple, works with existing auth, catches updates |
| Certificate paths | Explicit paths with defaults | Flexible, UI pre-fills sensible defaults          |
| Local dev support | TLS optional per-server      | Keeps local DinD setup simple                     |

## Database Model Changes

**File:** `services/api/src/database/models/server.py`

Add to `WorkspaceServer`:

```python
# TLS Configuration for Docker API connection
tls_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
tls_cert_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
tls_key_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
tls_ca_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
```

**Validation:**

- When `tls_enabled=True`, all three paths are required
- When `tls_enabled=False`, paths are ignored
- Port convention: 2376 for TLS, 2375 for plain TCP

## API Layer Changes

**File:** `services/api/src/routes/servers.py`

**Update `ServerRegisterRequest`:**

```python
class ServerRegisterRequest(BaseModel):
    # ... existing fields ...
    tls_enabled: bool = False
    tls_cert_path: str | None = None
    tls_key_path: str | None = None
    tls_ca_path: str | None = None

    @model_validator(mode='after')
    def validate_tls_paths(self) -> Self:
        if self.tls_enabled:
            if not all([self.tls_cert_path, self.tls_key_path, self.tls_ca_path]):
                raise ValueError("All TLS paths required when tls_enabled is True")
        return self
```

**Update `ServerResponse`** - add same 4 TLS fields.

**New internal endpoint:**

```python
@router.get("/api/internal/servers", tags=["internal"])
async def list_servers_for_compute(request: Request, db: DbSession):
    """Internal endpoint for compute service to fetch server configs."""
    # Verify internal API key via X-Internal-API-Key header
    # Return all active servers with TLS configuration
```

## Compute Service Changes

**File:** `services/compute/src/config.py`

Remove:

- `workspace_servers_json` field
- `workspace_servers` property
- Related parsing logic

Add:

- `server_sync_interval: int = 30` (seconds between syncs)

**File:** `services/compute/src/deps.py`

```python
async def fetch_servers_from_api() -> list[dict]:
    """Fetch workspace servers from API service."""
    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"{settings.api_base_url}/api/internal/servers",
            headers={"X-Internal-API-Key": settings.internal_api_key},
            timeout=10.0,
        )
        response.raise_for_status()
        return response.json()

async def sync_servers():
    """Sync servers from API to Docker manager."""
    docker_manager = OrchestratorSingleton.get_docker_manager()
    servers = await fetch_servers_from_api()

    for server in servers:
        await docker_manager.add_server(
            server_id=server["id"],
            hostname=server["hostname"],
            ip_address=server["ip_address"],
            docker_port=server["docker_port"],
            architecture=server["architecture"],
            region=server.get("region"),
            tls_enabled=server["tls_enabled"],
            tls_cert_path=server.get("tls_cert_path"),
            tls_key_path=server.get("tls_key_path"),
            tls_ca_path=server.get("tls_ca_path"),
        )
```

**Startup flow:**

1. Fetch servers from API on startup
2. Start background task to re-sync every 30 seconds
3. Gracefully handle API being temporarily unavailable

**File:** `services/compute/src/managers/multi_server_docker.py`

Update `_create_docker_client` to accept individual cert paths instead of directory:

```python
async def _create_docker_client(
    self,
    ip_address: str,
    docker_port: int,
    tls_enabled: bool = False,
    tls_cert_path: str | None = None,
    tls_key_path: str | None = None,
    tls_ca_path: str | None = None,
) -> DockerClient:
    if tls_enabled:
        if not all([tls_cert_path, tls_key_path, tls_ca_path]):
            raise ValueError(f"All TLS paths required for {ip_address}")
        tls_config = TLSConfig(
            client_cert=(tls_cert_path, tls_key_path),
            ca_cert=tls_ca_path,
            verify=True,
            ssl_version=ssl.PROTOCOL_TLS_CLIENT,
        )
        base_url = f"https://{ip_address}:{docker_port}"
        return docker.DockerClient(base_url=base_url, tls=tls_config)
    else:
        base_url = f"tcp://{ip_address}:{docker_port}"
        return docker.DockerClient(base_url=base_url)
```

## Frontend Changes

**File:** `apps/web/src/stores/admin.ts`

```typescript
export interface AdminWorkspaceServer {
  // ... existing fields ...
  tls_enabled: boolean;
  tls_cert_path: string | null;
  tls_key_path: string | null;
  tls_ca_path: string | null;
}

export interface CreateServerRequest {
  // ... existing fields ...
  tls_enabled?: boolean;
  tls_cert_path?: string;
  tls_key_path?: string;
  tls_ca_path?: string;
}
```

**File:** `apps/web/src/app/admin/management/servers/page.tsx`

Add to `AddServerModal`:

- "Enable TLS" checkbox
- When checked, show 3 path inputs with auto-filled defaults:
  - `/etc/docker/workspace-certs/{name}/cert.pem`
  - `/etc/docker/workspace-certs/{name}/key.pem`
  - `/etc/docker/workspace-certs/{name}/ca.pem`
- Paths auto-update when server name changes

## Init Script Changes

**File:** `scripts/hetzner/workspace-server-init.sh`

Rename generated client certificate files:

- `client-cert.pem` → `cert.pem`
- `client-key.pem` → `key.pem`
- `ca.pem` stays as `ca.pem`

Update copy instructions and post-install notes to reflect new names.

## Seed Data Changes

**File:** `services/api/scripts/seed_database.py`

Add TLS fields to local dev servers:

```python
WorkspaceServer(
    id="ws-local-1",
    # ... existing fields ...
    tls_enabled=False,
    tls_cert_path=None,
    tls_key_path=None,
    tls_ca_path=None,
)
```

## Implementation Order

1. Database migration - Add 4 TLS columns
2. `services/api/src/database/models/server.py` - Add TLS fields
3. `services/api/src/routes/servers.py` - Update models, add internal endpoint
4. `services/api/scripts/seed_database.py` - Add TLS fields
5. `services/compute/src/config.py` - Remove env var config
6. `services/compute/src/deps.py` - Add API fetch and sync
7. `services/compute/src/managers/multi_server_docker.py` - Update cert handling
8. `apps/web/src/stores/admin.ts` - Add TLS interfaces
9. `apps/web/src/app/admin/management/servers/page.tsx` - Add TLS form
10. `scripts/hetzner/workspace-server-init.sh` - Rename cert files

## Migration for Existing eu-001 Server

```bash
ssh podex-platform
cd /etc/docker/workspace-certs/eu-001
mv client-cert.pem cert.pem
mv client-key.pem key.pem
```

Then add the server via admin UI with:

- TLS Enabled: Yes
- Cert Path: `/etc/docker/workspace-certs/eu-001/cert.pem`
- Key Path: `/etc/docker/workspace-certs/eu-001/key.pem`
- CA Path: `/etc/docker/workspace-certs/eu-001/ca.pem`

## Breaking Changes

- `COMPUTE_WORKSPACE_SERVERS` environment variable no longer used
- Client cert files renamed from `client-cert.pem`/`client-key.pem` to `cert.pem`/`key.pem`
