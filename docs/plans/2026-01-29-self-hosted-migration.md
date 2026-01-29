# Self-Hosted Infrastructure Migration Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate Podex from GCP to self-hosted infrastructure using Docker + gVisor on dedicated servers managed via Coolify, with multi-server workspace orchestration.

**Architecture:** Coolify manages platform services (API, Agent, Web) on a primary server. Workspace servers run Docker + gVisor for isolated user containers. PostgreSQL and Redis self-hosted. Traefik handles routing. Cloudflared tunnels preserved for workspace access.

**Tech Stack:** Docker, gVisor, Coolify, Traefik, PostgreSQL, Redis, Prometheus, Grafana, Loki, GitHub Actions, Hetzner (recommended provider)

---

## Table of Contents

1. [Phase 1: GCP Cleanup](#phase-1-gcp-cleanup)
2. [Phase 2: Database Schema Updates](#phase-2-database-schema-updates)
3. [Phase 3: Compute Service Rework](#phase-3-compute-service-rework)
4. [Phase 4: Server Setup with Coolify](#phase-4-server-setup-with-coolify)
5. [Phase 5: Security Hardening](#phase-5-security-hardening)
6. [Phase 6: Monitoring Stack](#phase-6-monitoring-stack)
7. [Phase 7: CI/CD with GitHub Actions](#phase-7-cicd-with-github-actions)
8. [Phase 8: DNS and Domain Setup](#phase-8-dns-and-domain-setup)
9. [Phase 9: Admin Panel for Host Management](#phase-9-admin-panel-for-host-management)
10. [Phase 10: LLM Provider Migration](#phase-10-llm-provider-migration)
11. [Phase 11: Testing and Cutover](#phase-11-testing-and-cutover)

---

## Infrastructure Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Cloudflare DNS                                     │
│  podex.dev → Platform Server    ws-*.podex.dev → Workspace Proxy            │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │
                    ┌─────────────┴─────────────┐
                    ▼                           ▼
┌───────────────────────────────┐   ┌───────────────────────────────┐
│   Platform Server (Coolify)   │   │   Workspace Proxy (Traefik)   │
│   Hetzner CAX31 (~$16/mo)     │   │   On Platform Server          │
│                               │   │                               │
│  ┌─────────────────────────┐  │   │   Routes ws-{id}.podex.dev   │
│  │ Coolify (management)    │  │   │   to correct workspace server │
│  │ web (Next.js)           │  │   │                               │
│  │ api (FastAPI)           │  │   └───────────────┬───────────────┘
│  │ agent (Python)          │  │                   │
│  │ PostgreSQL 16           │  │   ┌───────────────┼───────────────┐
│  │ Redis 7                 │  │   │               │               │
│  │ Prometheus + Grafana    │  │   ▼               ▼               ▼
│  └─────────────────────────┘  │ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│                               │ │ Workspace   │ │ Workspace   │ │ Workspace   │
│  compute service manages →    │ │ Server 1    │ │ Server 2    │ │ Server N    │
│  workspace containers         │ │             │ │             │ │             │
└───────────────────────────────┘ │ Docker+gVisor│ │ Docker+gVisor│ │ Docker+gVisor│
                                  │ User pods   │ │ User pods   │ │ User pods   │
                                  └─────────────┘ └─────────────┘ └─────────────┘
```

---

## Cost Estimate (Hetzner)

| Component           | Server                    | Monthly Cost  |
| ------------------- | ------------------------- | ------------- |
| Platform Server     | CAX31 (8 ARM vCPU, 16GB)  | €14.99 (~$16) |
| Workspace Server 1  | CAX41 (16 ARM vCPU, 32GB) | €29.99 (~$32) |
| Storage Box         | 1TB BX11                  | €3.81 (~$4)   |
| Floating IPs        | 2x                        | €8 (~$9)      |
| **Total (minimal)** |                           | **~$61/mo**   |

Scale by adding more CAX41 workspace servers as needed (~$32 each).

---

## Phase 1: GCP Cleanup

### Task 1.1: Remove Pulumi Infrastructure

**Files:**

- Delete: `infrastructure/` (entire directory)

**Step 1: Remove infrastructure directory**

```bash
rm -rf infrastructure/
```

**Step 2: Update .gitignore - remove Pulumi entries**

**Step 3: Commit**

```bash
git add -A
git commit -m "chore: remove Pulumi GCP infrastructure"
```

---

### Task 1.2: Remove GCP-Specific Code from Services

**Files to modify:**

- `services/compute/src/config.py` - Remove GCP settings
- `services/api/src/config.py` - Remove GCS/Vertex settings
- `services/agent/` - Remove Vertex AI provider

**Key changes:**

1. Remove `GCP_PROJECT_ID`, `GCP_REGION`, `GCS_BUCKET` config
2. Remove `compute_mode: "gcp"` option (keep only "docker")
3. Remove Vertex AI LLM provider
4. Remove any `google-cloud-*` imports

---

### Task 1.3: Update CI/CD Workflows

**Files:**

- Delete: `.github/workflows/infrastructure-tests.yml`
- Modify: `.github/workflows/ci.yml` - Remove Pulumi jobs

---

### Task 1.4: Remove Dotfiles Sync

Search and remove any dotfiles synchronization code. Workspaces will use simple persistent Docker volumes.

---

## Phase 2: Database Schema Updates

### Task 2.1: Add Workspace Servers Table

**Migration SQL:**

```sql
CREATE TABLE workspace_servers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    hostname VARCHAR(255) NOT NULL UNIQUE,
    ip_address INET NOT NULL,
    ssh_port INT DEFAULT 22,
    docker_port INT DEFAULT 2376,

    -- Capacity
    total_cpu INT NOT NULL,
    total_memory_mb INT NOT NULL,
    total_disk_gb INT NOT NULL,

    -- Usage (updated by heartbeat)
    used_cpu FLOAT DEFAULT 0,
    used_memory_mb INT DEFAULT 0,
    used_disk_gb INT DEFAULT 0,
    active_workspaces INT DEFAULT 0,

    -- Status
    status VARCHAR(20) DEFAULT 'active',
    last_heartbeat TIMESTAMP WITH TIME ZONE,
    last_error TEXT,

    -- Features
    has_gpu BOOLEAN DEFAULT FALSE,
    gpu_type VARCHAR(50),
    gpu_count INT DEFAULT 0,
    docker_runtime VARCHAR(20) DEFAULT 'runsc',
    architecture VARCHAR(20) DEFAULT 'arm64',

    -- Metadata
    labels JSONB DEFAULT '{}',
    region VARCHAR(50),
    provider VARCHAR(50),

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add server reference to workspaces
ALTER TABLE workspaces ADD COLUMN server_id UUID REFERENCES workspace_servers(id);
ALTER TABLE workspaces ADD COLUMN container_name VARCHAR(255);
ALTER TABLE workspaces ADD COLUMN volume_name VARCHAR(255);
ALTER TABLE workspaces ADD COLUMN assigned_cpu FLOAT;
ALTER TABLE workspaces ADD COLUMN assigned_memory_mb INT;
ALTER TABLE workspaces ADD COLUMN assigned_disk_gb INT;
ALTER TABLE workspaces ADD COLUMN internal_ip VARCHAR(45);
ALTER TABLE workspaces ADD COLUMN ssh_port INT;
ALTER TABLE workspaces ADD COLUMN http_port INT;

CREATE INDEX idx_workspace_servers_status ON workspace_servers(status);
CREATE INDEX idx_workspaces_server_id ON workspaces(server_id);
```

---

## Phase 3: Compute Service Rework

### Task 3.1: Create Multi-Server Docker Manager

New file: `services/compute/src/docker_manager.py`

Manages Docker connections to multiple workspace servers via TLS-secured Docker API.

### Task 3.2: Create Placement Service

New file: `services/compute/src/placement.py`

Algorithms for selecting which server hosts a workspace:

- **SPREAD**: Distribute evenly (default, good for reliability)
- **BEST_FIT**: Pack tightly (cost efficient)
- **AFFINITY**: Same server as user's other workspaces

### Task 3.3: Create Workspace Orchestrator

New file: `services/compute/src/workspace_orchestrator.py`

Handles:

- Creating workspaces on selected servers
- Starting/stopping containers with gVisor runtime
- Managing persistent volumes
- Resource limit enforcement
- Server usage tracking

### Task 3.4: Create Server Heartbeat Service

New file: `services/compute/src/heartbeat.py`

Runs on each workspace server to report:

- System resource usage
- Docker container stats
- Running workspace status

### Task 3.5: API Routes for Server Management

New file: `services/api/src/routes/servers.py`

Admin endpoints:

- `GET /servers` - List all servers
- `POST /servers` - Add new server
- `PATCH /servers/{id}` - Update server
- `DELETE /servers/{id}` - Remove server
- `GET /servers/available` - User-facing: servers they can choose

---

## Phase 4: Server Setup with Coolify

### Task 4.1: Provision Hetzner Servers

1. **Platform Server**: CAX31 (8 vCPU, 16GB, €14.99/mo)
   - Runs Coolify, all platform services, databases
   - Cloud-init: Install Docker

2. **Workspace Server(s)**: CAX41 (16 vCPU, 32GB, €29.99/mo)
   - Runs user workspace containers
   - Cloud-init: Install Docker + gVisor

3. **Private Network**: 10.0.0.0/16 between servers

### Task 4.2: Install Coolify

```bash
ssh root@<platform-ip>
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
```

Access at `http://<platform-ip>:8000`

### Task 4.3: Add Workspace Servers to Coolify

1. Generate SSH key in Coolify
2. Add public key to workspace servers
3. Add servers in Coolify UI (use private IPs)

### Task 4.4: Deploy Platform Services

In Coolify, create resources:

1. **PostgreSQL 16** - Database for all services
2. **Redis 7** - Caching and pub/sub
3. **API Service** - From GitHub, `services/api/Dockerfile`
4. **Agent Service** - From GitHub, `services/agent/Dockerfile`
5. **Web Frontend** - From GitHub, `apps/web/Dockerfile`
6. **Compute Service** - From GitHub, `services/compute/Dockerfile`

### Task 4.5: Configure Docker TLS

Generate certificates for secure remote Docker API access between platform and workspace servers.

---

## Phase 5: Security Hardening

### Security Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Security Layers                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Layer 1: Network                                                            │
│  ├── Cloudflare DDoS protection + WAF                                       │
│  ├── Private network between servers (10.0.0.0/16)                          │
│  └── UFW firewall on each server                                            │
│                                                                              │
│  Layer 2: Access Control                                                     │
│  ├── SSH key-only authentication (no passwords)                             │
│  ├── Fail2ban for brute force protection                                    │
│  ├── Docker TLS for remote API access                                       │
│  └── Internal API keys for service-to-service                               │
│                                                                              │
│  Layer 3: Container Isolation                                                │
│  ├── gVisor (runsc) runtime - syscall interception                          │
│  ├── Dropped capabilities (no CAP_SYS_ADMIN, etc.)                          │
│  ├── Read-only root filesystem where possible                               │
│  ├── Resource limits (CPU, memory, PIDs)                                    │
│  └── Separate Docker networks per workspace                                  │
│                                                                              │
│  Layer 4: Data Protection                                                    │
│  ├── Encrypted secrets (environment variables)                              │
│  ├── TLS everywhere (internal and external)                                 │
│  ├── Encrypted backups                                                       │
│  └── Database encryption at rest                                             │
│                                                                              │
│  Layer 5: Monitoring & Response                                              │
│  ├── Centralized logging (Loki)                                             │
│  ├── Security event alerting                                                │
│  ├── Automated security updates (unattended-upgrades)                       │
│  └── Regular vulnerability scanning                                          │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Task 5.1: SSH Hardening

**On ALL servers:**

```bash
# /etc/ssh/sshd_config - Security hardening

# Disable password authentication
PasswordAuthentication no
PubkeyAuthentication yes
PermitRootLogin prohibit-password  # Or 'no' if you have sudo user

# Disable unused authentication methods
ChallengeResponseAuthentication no
KerberosAuthentication no
GSSAPIAuthentication no

# Limit to specific users (optional)
# AllowUsers deploy admin

# Session settings
ClientAliveInterval 300
ClientAliveCountMax 2
MaxAuthTries 3
MaxSessions 10

# Disable forwarding (unless needed)
X11Forwarding no
AllowTcpForwarding no
AllowAgentForwarding no

# Use strong algorithms only
KexAlgorithms curve25519-sha256@libssh.org,diffie-hellman-group-exchange-sha256
Ciphers chacha20-poly1305@openssh.com,aes256-gcm@openssh.com,aes128-gcm@openssh.com
MACs hmac-sha2-512-etm@openssh.com,hmac-sha2-256-etm@openssh.com

# Restart SSH
systemctl restart sshd
```

### Task 5.2: Install Fail2ban

```bash
# Install fail2ban
apt install -y fail2ban

# Configure fail2ban
cat > /etc/fail2ban/jail.local << 'EOF'
[DEFAULT]
bantime = 1h
findtime = 10m
maxretry = 5
banaction = ufw

[sshd]
enabled = true
port = ssh
filter = sshd
logpath = /var/log/auth.log
maxretry = 3
bantime = 24h

[docker-auth]
enabled = true
port = 2376
filter = docker-auth
logpath = /var/log/docker.log
maxretry = 3
bantime = 1h
EOF

# Start fail2ban
systemctl enable fail2ban
systemctl start fail2ban
```

### Task 5.3: Firewall Configuration (UFW)

**Platform Server:**

```bash
# Reset and configure UFW
ufw --force reset

# Default policies
ufw default deny incoming
ufw default allow outgoing

# SSH (consider changing port)
ufw allow 22/tcp

# HTTP/HTTPS
ufw allow 80/tcp
ufw allow 443/tcp

# Coolify UI (consider IP restriction)
ufw allow from YOUR_IP to any port 8000

# Allow private network
ufw allow from 10.0.0.0/16

# Enable
ufw --force enable
ufw status verbose
```

**Workspace Servers:**

```bash
# Reset and configure UFW
ufw --force reset

# Default policies
ufw default deny incoming
ufw default allow outgoing

# SSH from platform only
ufw allow from 10.0.0.2 to any port 22

# Docker API from platform only (TLS protected)
ufw allow from 10.0.0.2 to any port 2376

# Allow all traffic from private network
ufw allow from 10.0.0.0/16

# Enable
ufw --force enable
```

### Task 5.4: Docker Security Configuration

**Workspace servers - hardened daemon.json:**

```json
{
  "runtimes": {
    "runsc": {
      "path": "/usr/bin/runsc",
      "runtimeArgs": ["--platform=systrap", "--network=sandbox", "--overlay=false"]
    }
  },
  "default-runtime": "runsc",
  "hosts": ["unix:///var/run/docker.sock", "tcp://0.0.0.0:2376"],
  "tls": true,
  "tlscacert": "/etc/docker/ca.pem",
  "tlscert": "/etc/docker/server-cert.pem",
  "tlskey": "/etc/docker/server-key.pem",
  "tlsverify": true,
  "icc": false,
  "userns-remap": "default",
  "no-new-privileges": true,
  "seccomp-profile": "/etc/docker/seccomp-default.json",
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  },
  "storage-driver": "overlay2",
  "live-restore": true
}
```

**Key security options explained:**

| Option                       | Purpose                               |
| ---------------------------- | ------------------------------------- |
| `"default-runtime": "runsc"` | gVisor for syscall isolation          |
| `"icc": false`               | Disable inter-container communication |
| `"userns-remap": "default"`  | Run containers as unprivileged users  |
| `"no-new-privileges": true`  | Prevent privilege escalation          |

### Task 5.5: Container Security (Applied to Workspaces)

```python
# In workspace_orchestrator.py - security settings per container

CONTAINER_SECURITY_OPTS = {
    # gVisor runtime
    "runtime": "runsc",

    # Drop ALL capabilities, add only what's needed
    "cap_drop": ["ALL"],
    "cap_add": [
        "CHOWN",        # Change file ownership
        "SETUID",       # Set UID
        "SETGID",       # Set GID
        "DAC_OVERRIDE", # Bypass file permission checks
        "FOWNER",       # Bypass ownership checks
        "KILL",         # Send signals
        "NET_BIND_SERVICE",  # Bind to ports < 1024
    ],

    # Security options
    "security_opt": [
        "no-new-privileges:true",
        "seccomp=default",
    ],

    # Resource limits (prevent DoS)
    "pids_limit": 500,        # Max processes
    "cpu_count": tier_cpu,     # CPU cores
    "mem_limit": tier_memory,  # Memory limit
    "memswap_limit": tier_memory,  # No swap
    "storage_opt": {"size": f"{tier_disk}G"},  # Disk limit

    # Network isolation
    "network_mode": f"workspace-{workspace_id}",  # Dedicated network

    # Read-only where possible
    "read_only": False,  # Workspace needs write access
    "tmpfs": {
        "/tmp": "size=1G,mode=1777",
        "/run": "size=100M,mode=755",
    },
}
```

### Task 5.6: Network Isolation Between Workspaces

```python
# Create isolated network per workspace
async def create_workspace_network(client: docker.DockerClient, workspace_id: str):
    """Create isolated Docker network for workspace."""

    network_name = f"ws-net-{workspace_id[:8]}"

    # Create network with no inter-container communication
    network = client.networks.create(
        name=network_name,
        driver="bridge",
        internal=False,  # Allow internet access
        attachable=True,
        options={
            "com.docker.network.bridge.enable_icc": "false",
            "com.docker.network.bridge.enable_ip_masquerade": "true",
        },
        labels={
            "podex.workspace_id": workspace_id,
            "podex.managed": "true",
        }
    )

    return network
```

### Task 5.7: Secrets Management

**Coolify handles secrets, but also:**

```bash
# Use SOPS for local secrets encryption
# Install SOPS
curl -LO https://github.com/getsops/sops/releases/download/v3.8.1/sops-v3.8.1.linux.arm64
chmod +x sops-v3.8.1.linux.arm64
sudo mv sops-v3.8.1.linux.arm64 /usr/local/bin/sops

# Encrypt secrets file
sops --encrypt --age $(cat ~/.sops/age/keys.txt | grep "public key" | cut -d: -f2) \
  secrets.yaml > secrets.enc.yaml
```

**Database password rotation:**

```sql
-- Rotate database password periodically
ALTER USER podex WITH PASSWORD 'new_secure_password';

-- Use scram-sha-256 authentication
-- In pg_hba.conf:
-- host all all 10.0.0.0/16 scram-sha-256
```

### Task 5.8: Automatic Security Updates

```bash
# Install unattended-upgrades
apt install -y unattended-upgrades

# Configure
cat > /etc/apt/apt.conf.d/50unattended-upgrades << 'EOF'
Unattended-Upgrade::Allowed-Origins {
    "${distro_id}:${distro_codename}";
    "${distro_id}:${distro_codename}-security";
    "${distro_id}ESMApps:${distro_codename}-apps-security";
    "${distro_id}ESM:${distro_codename}-infra-security";
};

Unattended-Upgrade::AutoFixInterruptedDpkg "true";
Unattended-Upgrade::MinimalSteps "true";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
Unattended-Upgrade::Automatic-Reboot "false";
Unattended-Upgrade::Automatic-Reboot-Time "04:00";

// Email notification
Unattended-Upgrade::Mail "admin@podex.dev";
Unattended-Upgrade::MailReport "only-on-error";
EOF

# Enable
cat > /etc/apt/apt.conf.d/20auto-upgrades << 'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF

systemctl enable unattended-upgrades
```

### Task 5.9: Cloudflare Security Settings

In Cloudflare Dashboard:

1. **SSL/TLS → Full (Strict)** - End-to-end encryption
2. **Security → WAF** - Enable managed rules
3. **Security → DDoS** - Enable L7 DDoS protection
4. **Security → Bot Fight Mode** - Enable
5. **Security → Settings**:
   - Security Level: Medium
   - Challenge Passage: 30 minutes
   - Browser Integrity Check: On

**Rate limiting rules:**

```
Rule: API Rate Limit
If: URI Path contains "/api/"
Then: Rate limit 100 requests per minute per IP
Action: Block for 1 hour
```

### Task 5.10: Backup Encryption

```bash
# Install restic for encrypted backups
apt install -y restic

# Initialize encrypted backup repository
export RESTIC_PASSWORD="your-secure-backup-password"
export B2_ACCOUNT_ID="your-backblaze-id"
export B2_ACCOUNT_KEY="your-backblaze-key"

restic -r b2:podex-backups init

# Backup script
cat > /opt/scripts/backup.sh << 'EOF'
#!/bin/bash
set -e

export RESTIC_PASSWORD_FILE=/etc/podex/backup-password

# Backup PostgreSQL
pg_dump -h localhost -U podex podex | restic -r b2:podex-backups backup --stdin --stdin-filename postgres.sql

# Backup workspace volumes
restic -r b2:podex-backups backup /var/lib/podex/workspaces

# Prune old backups (keep 7 daily, 4 weekly, 6 monthly)
restic -r b2:podex-backups forget --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune
EOF

chmod +x /opt/scripts/backup.sh

# Cron job for daily backups
echo "0 3 * * * root /opt/scripts/backup.sh >> /var/log/backup.log 2>&1" > /etc/cron.d/podex-backup
```

### Task 5.11: Security Monitoring Alerts

**Grafana alert rules:**

```yaml
# Alert on failed SSH attempts
- alert: HighFailedSSHAttempts
  expr: increase(fail2ban_banned_total{jail="sshd"}[1h]) > 10
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: 'High number of failed SSH attempts'

# Alert on unusual container activity
- alert: UnexpectedContainerCreation
  expr: increase(docker_container_created_total[5m]) > 10
  for: 1m
  labels:
    severity: warning
  annotations:
    summary: 'Unusual spike in container creation'

# Alert on high CPU (possible crypto mining)
- alert: SuspiciousHighCPU
  expr: container_cpu_usage_seconds_total > 95
  for: 10m
  labels:
    severity: critical
  annotations:
    summary: 'Container using excessive CPU for extended period'
```

### Security Checklist

- [ ] SSH key-only authentication enabled
- [ ] Fail2ban installed and configured
- [ ] UFW firewall rules applied
- [ ] Docker TLS configured for remote access
- [ ] gVisor runtime set as default
- [ ] Container capabilities dropped
- [ ] Network isolation between workspaces
- [ ] Automatic security updates enabled
- [ ] Cloudflare WAF and DDoS protection active
- [ ] Encrypted backups configured
- [ ] Security monitoring alerts set up
- [ ] Database uses scram-sha-256 authentication
- [ ] All internal communication over TLS

---

## Phase 6: Monitoring Stack

### Task 5.1: Deploy Prometheus

In Coolify, deploy Prometheus with config to scrape:

- Platform services
- Workspace servers (node_exporter)
- Docker daemon metrics

### Task 5.2: Deploy Grafana

Deploy Grafana with dashboards for:

- Server resource usage
- Workspace container metrics
- API request rates/latencies
- Database performance

### Task 5.3: Deploy Loki for Logs

Centralized logging from all services and workspace containers.

### Task 5.4: Deploy Uptime Kuma

Simple uptime monitoring and alerting.

### Recommended Monitoring Stack:

| Tool              | Purpose            | Resource   |
| ----------------- | ------------------ | ---------- |
| **Prometheus**    | Metrics collection | ~200MB RAM |
| **Grafana**       | Dashboards         | ~150MB RAM |
| **Loki**          | Log aggregation    | ~300MB RAM |
| **Uptime Kuma**   | Uptime checks      | ~100MB RAM |
| **node_exporter** | Server metrics     | ~20MB RAM  |
| **cAdvisor**      | Container metrics  | ~50MB RAM  |

---

## Phase 7: CI/CD with GitHub Actions

### Task 6.1: Create Deployment Workflow

`.github/workflows/deploy.yml`:

```yaml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Deploy to Coolify
        run: |
          curl -X POST "${{ secrets.COOLIFY_WEBHOOK_API }}" \
            -H "Authorization: Bearer ${{ secrets.COOLIFY_TOKEN }}"

          curl -X POST "${{ secrets.COOLIFY_WEBHOOK_WEB }}" \
            -H "Authorization: Bearer ${{ secrets.COOLIFY_TOKEN }}"
```

### Task 6.2: Configure Coolify Webhooks

1. In Coolify, each application has a webhook URL
2. Enable "Auto Deploy" on push
3. Copy webhook URLs to GitHub secrets

### Task 6.3: Docker Image Registry

Options:

1. **GitHub Container Registry (GHCR)** - Free, integrated
2. **Coolify's built-in registry** - Simple
3. **Self-hosted registry** - Full control

Recommended: GHCR for simplicity.

---

## Phase 8: DNS and Domain Setup

### Task 7.1: Cloudflare DNS Configuration

| Record    | Type  | Value                    | Proxy          |
| --------- | ----- | ------------------------ | -------------- |
| `@`       | A     | `<platform-floating-ip>` | Yes            |
| `www`     | CNAME | `podex.dev`              | Yes            |
| `app`     | A     | `<platform-floating-ip>` | Yes            |
| `api`     | A     | `<platform-floating-ip>` | Yes            |
| `ws-*`    | A     | `<platform-floating-ip>` | Yes (wildcard) |
| `coolify` | A     | `<platform-floating-ip>` | No             |

### Task 7.2: SSL Certificates

Coolify handles SSL automatically via Let's Encrypt.

For wildcard (`ws-*.podex.dev`), use Cloudflare DNS challenge:

1. In Coolify: Settings → SSL → Cloudflare
2. Add Cloudflare API token

### Task 7.3: Cloudflared Tunnel Integration

Workspaces use cloudflared for secure tunnels. This continues to work - tunnels are created per-workspace and route through Cloudflare.

No changes needed to existing tunnel logic.

---

## Phase 9: Admin Panel for Host Management

### Task 8.1: Admin API Endpoints

Already covered in Phase 3 (Task 3.5).

### Task 8.2: Admin UI Components

New components in `apps/web/src/app/admin/servers/`:

```
servers/
├── page.tsx           # List all servers
├── [id]/page.tsx      # Server details
├── add/page.tsx       # Add new server form
└── components/
    ├── ServerCard.tsx
    ├── ServerForm.tsx
    ├── ServerMetrics.tsx
    └── WorkspaceList.tsx
```

### Task 8.3: Server Management Features

1. **Add Server**: Form to register new workspace server
2. **View Server**: Status, metrics, running workspaces
3. **Edit Server**: Update capacity, labels, status
4. **Drain Server**: Stop new workspaces, migrate existing
5. **Remove Server**: Delete after all workspaces moved

### Task 8.4: User Server Selection

In workspace creation flow, let users see and optionally choose server:

```tsx
// Workspace creation - server selection
const availableServers = await api.get('/servers/available?tier=pro');

// Show options:
// - "Auto (recommended)" - uses placement algorithm
// - Specific servers with availability info
```

---

## Phase 10: LLM Provider Migration

### Task 9.1: Remove Vertex AI

Delete Vertex AI provider code. Keep existing providers:

- Anthropic (for users with their own API keys)
- OpenAI (for users with their own API keys)
- Ollama (for self-hosted users)

### Task 9.2: Add OpenRouter as Default Provider

**OpenRouter** will be the **default provider for Podex-hosted models** that users purchase through our platform.

**Why OpenRouter:**

- Single API for 200+ models (Claude, GPT-4, Llama, Mistral, etc.)
- Pay-per-token with markup opportunity
- No per-model API key management
- Automatic fallbacks between providers
- Usage tracking and analytics built-in

| Use Case                    | Provider                | Who Pays               |
| --------------------------- | ----------------------- | ---------------------- |
| **Podex Credits** (default) | OpenRouter              | Podex (billed to user) |
| **Bring Your Own Key**      | Anthropic/OpenAI direct | User directly          |
| **Self-Hosted**             | Ollama/vLLM             | User (compute)         |

### Task 9.3: LLM Provider Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    User Request                              │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  Agent Service                               │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              LLM Provider Router                     │    │
│  │                                                      │    │
│  │  if user.has_own_api_key("anthropic"):              │    │
│  │      → Use Anthropic direct                          │    │
│  │  elif user.has_own_api_key("openai"):               │    │
│  │      → Use OpenAI direct                             │    │
│  │  elif user.has_ollama_endpoint:                      │    │
│  │      → Use user's Ollama                             │    │
│  │  else:                                               │    │
│  │      → Use OpenRouter (Podex account, bill user)    │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

### Task 9.4: OpenRouter Integration

**Step 1: Add OpenRouter provider**

```python
# services/agent/src/providers/openrouter.py
import httpx
from typing import AsyncIterator

class OpenRouterProvider:
    """OpenRouter LLM provider for Podex-hosted models."""

    BASE_URL = "https://openrouter.ai/api/v1"

    def __init__(self, api_key: str, app_name: str = "Podex"):
        self.api_key = api_key
        self.app_name = app_name
        self.client = httpx.AsyncClient(
            base_url=self.BASE_URL,
            headers={
                "Authorization": f"Bearer {api_key}",
                "HTTP-Referer": "https://podex.dev",
                "X-Title": app_name,
            }
        )

    async def chat_completion(
        self,
        messages: list[dict],
        model: str = "anthropic/claude-3.5-sonnet",
        stream: bool = True,
        **kwargs
    ) -> AsyncIterator[str]:
        """Stream chat completion from OpenRouter."""

        response = await self.client.post(
            "/chat/completions",
            json={
                "model": model,
                "messages": messages,
                "stream": stream,
                **kwargs
            }
        )

        if stream:
            async for line in response.aiter_lines():
                if line.startswith("data: "):
                    # Parse SSE and yield content
                    yield line[6:]
        else:
            data = response.json()
            yield data["choices"][0]["message"]["content"]

    async def get_available_models(self) -> list[dict]:
        """Get list of available models."""
        response = await self.client.get("/models")
        return response.json()["data"]
```

**Step 2: Model mapping for users**

```python
# Available models through OpenRouter (examples)
OPENROUTER_MODELS = {
    # Claude models
    "claude-3.5-sonnet": "anthropic/claude-3.5-sonnet",
    "claude-3-opus": "anthropic/claude-3-opus",
    "claude-3-haiku": "anthropic/claude-3-haiku",

    # OpenAI models
    "gpt-4o": "openai/gpt-4o",
    "gpt-4o-mini": "openai/gpt-4o-mini",
    "o1-preview": "openai/o1-preview",

    # Open source models
    "llama-3.1-70b": "meta-llama/llama-3.1-70b-instruct",
    "mixtral-8x7b": "mistralai/mixtral-8x7b-instruct",
    "deepseek-coder": "deepseek/deepseek-coder-33b-instruct",
}
```

### Task 9.5: Pricing and Billing

OpenRouter charges per token. Add markup for Podex credits:

```python
# Pricing configuration
OPENROUTER_MARKUP = 1.2  # 20% markup on OpenRouter prices

# Track usage per user
async def track_llm_usage(user_id: str, model: str, tokens: int, cost_usd: float):
    """Track LLM usage for billing."""
    await db.execute("""
        INSERT INTO llm_usage (user_id, model, tokens, cost_usd, created_at)
        VALUES ($1, $2, $3, $4, NOW())
    """, user_id, model, tokens, cost_usd * OPENROUTER_MARKUP)
```

### Task 9.6: Environment Variables

```bash
# OpenRouter (Podex account - for users without own keys)
OPENROUTER_API_KEY=sk-or-v1-...

# Keep existing for BYOK users
# These are stored per-user in the database, not as env vars
# ANTHROPIC_API_KEY - user provides
# OPENAI_API_KEY - user provides

# Self-hosted option (user provides URL)
# OLLAMA_BASE_URL - user provides
```

---

## Phase 11: Testing and Cutover

### Task 10.1: Pre-Migration Checklist

- [ ] All GCP code removed
- [ ] Database migrations ready
- [ ] Compute service tested locally
- [ ] Coolify deployed and configured
- [ ] Monitoring stack operational
- [ ] DNS configured (test subdomain first)
- [ ] CI/CD webhooks working
- [ ] Backup strategy in place

### Task 10.2: Migration Steps

1. **Deploy to staging** (separate servers)
2. **Test all flows**:
   - User registration/login
   - Workspace creation on multiple servers
   - Workspace start/stop/restart
   - File persistence across restarts
   - Tunnel access
   - Multi-server placement
3. **DNS cutover** (update records)
4. **Monitor closely** for 48 hours

### Task 10.3: Rollback Plan

Keep GCP infrastructure available for 2 weeks post-migration:

1. DNS can be switched back in minutes
2. Database can be restored from backup
3. Users notified of maintenance window

### Task 10.4: Post-Migration

- [ ] Decommission GCP resources
- [ ] Update documentation
- [ ] Remove GCP credentials from CI
- [ ] Celebrate 🎉

---

## Quick Reference: Server Setup Commands

### Platform Server Setup

```bash
# Install Coolify
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash

# Firewall
ufw allow 22,80,443,8000/tcp
ufw enable
```

### Workspace Server Setup

```bash
# Install Docker + gVisor
curl -fsSL https://get.docker.com | sh

# Install gVisor (ARM64)
curl -fsSL https://gvisor.dev/archive.key | gpg --dearmor -o /usr/share/keyrings/gvisor-archive-keyring.gpg
echo "deb [arch=arm64 signed-by=/usr/share/keyrings/gvisor-archive-keyring.gpg] https://storage.googleapis.com/gvisor/releases release main" > /etc/apt/sources.list.d/gvisor.list
apt update && apt install -y runsc

# Configure Docker
cat > /etc/docker/daemon.json << 'EOF'
{
  "runtimes": {
    "runsc": {
      "path": "/usr/bin/runsc",
      "runtimeArgs": ["--platform=systrap"]
    }
  },
  "default-runtime": "runsc"
}
EOF

systemctl restart docker
```

---

## Environment Variables Reference

### API Service

```bash
ENVIRONMENT=production
DATABASE_URL=postgresql://podex:password@db:5432/podex
REDIS_URL=redis://:password@redis:6379
JWT_SECRET_KEY=<secure-random>
INTERNAL_API_KEY=<secure-random>
ANTHROPIC_API_KEY=<your-key>
CORS_ORIGINS=https://app.podex.dev
```

### Compute Service

```bash
COMPUTE_MODE=docker
COMPUTE_INTERNAL_API_KEY=<same-as-api>
COMPUTE_API_BASE_URL=http://api:3001
COMPUTE_REDIS_URL=redis://:password@redis:6379
COMPUTE_WORKSPACE_VOLUME_BASE=/var/lib/podex/workspaces
```

### Web Frontend

```bash
NEXT_PUBLIC_API_URL=https://api.podex.dev
NEXT_PUBLIC_WS_URL=wss://api.podex.dev
```

---

## File Changes Summary

### Files to Delete

- `infrastructure/` (entire directory)
- `.github/workflows/infrastructure-tests.yml`

### Files to Create

- `services/compute/src/docker_manager.py`
- `services/compute/src/placement.py`
- `services/compute/src/workspace_orchestrator.py`
- `services/compute/src/heartbeat.py`
- `services/api/src/routes/servers.py`
- `services/api/src/database/migrations/add_workspace_servers.py`
- `apps/web/src/app/admin/servers/` (new admin pages)
- `.github/workflows/deploy.yml`

### Files to Modify

- `services/compute/src/config.py` - Remove GCP, add multi-server
- `services/api/src/config.py` - Remove GCS/Vertex
- `services/api/src/database/models/` - Add WorkspaceServer
- `.github/workflows/ci.yml` - Remove Pulumi jobs

---

## Execution

Plan complete and saved to `docs/plans/2026-01-29-self-hosted-migration.md`.

**Two execution options:**

1. **Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

2. **Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

**Which approach?**
