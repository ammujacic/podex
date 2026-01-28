# External Tunnel Gateway for Pods

**Date:** 2026-01-28
**Status:** Approved for Implementation
**Use Cases:** User-hosted bots/services with webhooks, shareable dev previews

---

## Overview

Enable users to expose services running on their pods (local or cloud) to the internet via Cloudflare Tunnel. This allows:

- **Bot hosting**: Discord bots, ClawdBot, Slack bots that need webhook endpoints
- **Dev preview sharing**: Share running dev servers with teammates/clients

## Architecture

### High-Level Flow

```
External Request → Cloudflare Edge → Cloudflare Tunnel → Workspace
                   (*.tunnel.podex.dev)                    (local/cloud)
```

### Components

#### 1. Cloudflare Infrastructure (Podex-owned)

- **Zone**: `tunnel.podex.dev`
- **Tunnel creation**: One tunnel per workspace with exposed ports
- **DNS**: `{workspace-id}.tunnel.podex.dev` (CNAME to tunnel)
- **Management**: Via Cloudflare API

#### 2. API Service (Orchestrator)

New endpoints:

- `POST /workspaces/{workspace_id}/tunnels` - Expose port(s)
- `DELETE /workspaces/{workspace_id}/tunnels/{port}` - Unexpose port
- `GET /workspaces/{workspace_id}/tunnels` - List active tunnels
- `GET /workspaces/{workspace_id}/tunnel-status` - Daemon health

Routes tunnel operations to:

- Local pods via WebSocket RPC
- Cloud compute via HTTP API

#### 3. Tunnel Daemon (`cloudflared`)

Runs in three environments:

| Environment   | Location                             | Management     |
| ------------- | ------------------------------------ | -------------- |
| **Local Pod** | Bundled in `podex-local-pod` process | RPC from API   |
| **Cloud Run** | Sidecar in Compute service           | HTTP from API  |
| **GKE**       | Sidecar container in pod             | Kubernetes API |

#### 4. Database Schema

New model: `WorkspaceTunnel`

```python
class WorkspaceTunnel:
    id: UUID
    workspace_id: UUID (FK)
    port: int  # Internal port being exposed
    tunnel_id: str  # Cloudflare tunnel ID
    tunnel_token: str  # Encrypted tunnel credentials
    public_url: str  # https://{workspace-id}.tunnel.podex.dev
    status: str  # "starting", "running", "stopped", "error"
    created_at: datetime
    updated_at: datetime
```

#### 5. Frontend Widget

Sidebar component showing:

- Public URL with copy button
- Port exposure management (add/remove)
- Tunnel status indicator
- "Enable Public Access" button

---

## Implementation Details

### Cloudflare Tunnel Setup

1. **Account Configuration**
   - Create Podex Cloudflare account
   - Add `tunnel.podex.dev` zone
   - Generate API token with tunnel permissions

2. **Tunnel Creation Flow**

   ```
   User clicks "Expose Port 8080"
        ↓
   API creates tunnel via Cloudflare API
        ↓
   API generates tunnel credentials
        ↓
   API creates DNS CNAME: {workspace-id}.tunnel.podex.dev
        ↓
   API sends tunnel config to daemon (RPC or HTTP)
        ↓
   Daemon starts cloudflared with config
   ```

3. **Tunnel Configuration**
   ```yaml
   tunnel: <tunnel-id>
   credentials-file: /tmp/tunnel-<workspace-id>.json
   ingress:
     - hostname: <workspace-id>.tunnel.podex.dev
       service: http://localhost:8080
     - service: http_status:404
   ```

### Local Pod Integration

**New RPC Methods:**

```python
# services/local-pod/src/podex_local_pod/rpc_handler.py

async def handle_tunnel_start(params):
    """Start cloudflared for workspace"""
    workspace_id = params["workspace_id"]
    tunnel_config = params["config"]  # {tunnel_id, token, port, hostname}

    # Write credentials file
    # Start cloudflared subprocess
    # Monitor process health

    return {"status": "running", "pid": <pid>}

async def handle_tunnel_stop(params):
    """Stop cloudflared for workspace"""
    workspace_id = params["workspace_id"]

    # Kill cloudflared process
    # Cleanup credentials

    return {"status": "stopped"}

async def handle_tunnel_status(params):
    """Check tunnel health"""
    return {"status": "running", "connected": True}
```

**Subprocess Management:**

```python
# Track cloudflared processes
_tunnel_processes: dict[str, subprocess.Popen] = {}

def start_cloudflared(workspace_id, config):
    cmd = [
        "cloudflared", "tunnel", "run",
        "--token", config["token"],
        "--url", f"http://localhost:{config['port']}"
    ]

    process = subprocess.Popen(cmd, stdout=PIPE, stderr=PIPE)
    _tunnel_processes[workspace_id] = process

    # Monitor process in background task
    asyncio.create_task(monitor_tunnel(workspace_id, process))
```

### Cloud Compute Integration

**New Endpoints in Compute Service:**

```python
# services/compute/src/routes/tunnels.py

@router.post("/workspaces/{workspace_id}/tunnels")
async def start_tunnel(workspace_id: str, config: TunnelConfig):
    """Start cloudflared sidecar for workspace"""
    # Similar to local pod but manages process directly
    pass

@router.delete("/workspaces/{workspace_id}/tunnels")
async def stop_tunnel(workspace_id: str):
    """Stop cloudflared sidecar"""
    pass
```

### GKE Integration

**Sidecar Container:**

```yaml
# Added to workspace pod spec
- name: cloudflared
  image: cloudflare/cloudflared:latest
  args:
    - tunnel
    - run
    - --token
    - $(TUNNEL_TOKEN)
    - --url
    - http://localhost:$(WORKSPACE_PORT)
  env:
    - name: TUNNEL_TOKEN
      valueFrom:
        secretKeyRef:
          name: tunnel-$(WORKSPACE_ID)
          key: token
```

### API Service Implementation

**Tunnel Manager Service:**

```python
# services/api/src/services/tunnel_manager.py

class TunnelManager:
    def __init__(self, cloudflare_api_key: str):
        self.cf_client = CloudflareClient(api_key)

    async def create_tunnel(self, workspace: Workspace, port: int):
        """
        1. Create tunnel via Cloudflare API
        2. Generate credentials
        3. Create DNS record
        4. Store in database
        5. Start daemon on workspace's pod/compute
        """

    async def delete_tunnel(self, workspace_id: str, port: int):
        """
        1. Stop daemon
        2. Delete DNS record
        3. Delete tunnel from Cloudflare
        4. Remove from database
        """

    async def get_tunnel_status(self, workspace_id: str):
        """Query daemon health via RPC/HTTP"""
```

**Routes:**

```python
# services/api/src/routes/tunnels.py

@router.post("/workspaces/{workspace_id}/tunnels")
async def expose_port(
    workspace_id: str,
    port: int,
    session: Session,
    user: User
):
    workspace = await get_workspace(workspace_id, user)

    # Create tunnel
    tunnel = await tunnel_manager.create_tunnel(workspace, port)

    return {
        "tunnel_id": tunnel.id,
        "public_url": tunnel.public_url,
        "port": tunnel.port,
        "status": tunnel.status
    }
```

### Frontend Implementation

**New Component: `TunnelWidget.tsx`**

```tsx
// apps/web/src/components/workspace/TunnelWidget.tsx

export function TunnelWidget({ workspaceId }: { workspaceId: string }) {
  const { tunnels, loading } = useTunnels(workspaceId);
  const [exposingPort, setExposingPort] = useState('');

  const exposePort = async () => {
    await api.post(`/workspaces/${workspaceId}/tunnels`, {
      port: parseInt(exposingPort),
    });
  };

  return (
    <div className="tunnel-widget">
      {tunnels.length > 0 ? (
        <div>
          <h4>Public URLs</h4>
          {tunnels.map((t) => (
            <div key={t.port}>
              <span>Port {t.port}:</span>
              <a href={t.public_url} target="_blank">
                {t.public_url}
              </a>
              <CopyButton text={t.public_url} />
              <DeleteButton onClick={() => deleteTunnel(t.port)} />
            </div>
          ))}
        </div>
      ) : (
        <div>No ports exposed</div>
      )}

      <div>
        <input
          type="number"
          placeholder="Port (e.g., 8080)"
          value={exposingPort}
          onChange={(e) => setExposingPort(e.target.value)}
        />
        <Button onClick={exposePort}>Expose Port</Button>
      </div>
    </div>
  );
}
```

**Add to WorkspaceSidebar:**

```tsx
// apps/web/src/components/workspace/WorkspaceSidebar.tsx

import { TunnelWidget } from './TunnelWidget';

// Add in sidebar sections:
<TunnelWidget workspaceId={workspace.id} />;
```

---

## Security Considerations

1. **Fully Public URLs** (Phase 1)
   - No authentication on tunnel endpoints
   - Users responsible for implementing auth in their service
   - Future: optional basic auth, API keys, Cloudflare Access

2. **Explicit Port Registration**
   - Only explicitly registered ports are exposed
   - Prevents accidental exposure of databases, admin panels

3. **Credential Storage**
   - Tunnel tokens encrypted in database
   - Never exposed to frontend
   - Rotated on tunnel recreation

4. **Rate Limiting**
   - API endpoints rate-limited per user
   - Cloudflare provides DDoS protection

---

## Deployment Steps

1. **Infrastructure**
   - Create Cloudflare account + `tunnel.podex.dev` zone
   - Generate API token
   - Add to environment variables

2. **Database Migration**
   - Add `workspace_tunnels` table
   - Add indexes on workspace_id

3. **Backend Services**
   - Deploy API with tunnel routes
   - Deploy Compute with tunnel support
   - Update local-pod with RPC handlers

4. **Frontend**
   - Add TunnelWidget component
   - Update workspace sidebar

5. **Documentation**
   - User guide: "Exposing Your Service to the Internet"
   - Example: ClawdBot deployment tutorial

---

## Future Enhancements

1. **Custom Domains** (Premium Feature)
   - Users connect their own domain
   - Automatic SSL via Cloudflare

2. **Authentication Options**
   - Basic auth
   - API key headers
   - Cloudflare Access (SSO)

3. **Multiple Ports**
   - Path-based routing: `{ws-id}.tunnel.podex.dev/api` → port 8080
   - Subdomain routing: `api-{ws-id}.tunnel.podex.dev` → port 8080

4. **Analytics**
   - Request counts, bandwidth usage
   - Uptime monitoring

5. **Collaboration**
   - Share tunnel access with team members
   - Temporary access tokens

---

## Success Metrics

- Number of active tunnels
- Uptime/reliability of tunnel connections
- User adoption rate (% of workspaces with tunnels)
- Use case breakdown (bots vs dev previews)
