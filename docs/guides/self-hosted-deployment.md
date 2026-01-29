# Self-Hosted Deployment Guide

This guide covers deploying Podex on Hetzner Cloud using Coolify for orchestration and Docker + gVisor for container isolation.

## Prerequisites

- Hetzner Cloud account
- Domain with DNS access
- GitHub account (for CI/CD)
- OpenRouter API key (for LLM)

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Cloudflare (DNS/CDN)                    │
│              OR Hetzner Load Balancer + SSL                 │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│              Platform Server (Hetzner CX41+)                │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                     Coolify                          │   │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐   │   │
│  │  │   API   │ │  Agent  │ │   Web   │ │ Compute │   │   │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘   │   │
│  │  ┌─────────┐ ┌─────────┐                           │   │
│  │  │Postgres │ │  Redis  │                           │   │
│  │  └─────────┘ └─────────┘                           │   │
│  └─────────────────────────────────────────────────────┘   │
└────────────────────────────┬────────────────────────────────┘
                             │ Docker TLS (Port 2376)
        ┌────────────────────┼────────────────────┐
        │                    │                    │
┌───────▼───────┐   ┌────────▼──────┐   ┌────────▼──────┐
│  Workspace    │   │   Workspace   │   │   Workspace   │
│  Server 1     │   │   Server 2    │   │   Server N    │
│  (CX41+)      │   │   (CX41+)     │   │   (CX41+)     │
│               │   │               │   │               │
│ ┌───────────┐ │   │ ┌───────────┐ │   │ ┌───────────┐ │
│ │ gVisor    │ │   │ │ gVisor    │ │   │ │ gVisor    │ │
│ │ Containers│ │   │ │ Containers│ │   │ │ Containers│ │
│ └───────────┘ │   │ └───────────┘ │   │ └───────────┘ │
└───────────────┘   └───────────────┘   └───────────────┘
```

## Hetzner Infrastructure Setup

### 1. Create Hetzner Cloud Project

1. Log into [Hetzner Cloud Console](https://console.hetzner.cloud)
2. Create a new project: "Podex Production"
3. Generate an API token: Project > Security > API Tokens > Generate API Token

### 2. Private Network

Create a private network for secure inter-server communication:

**Console:**
1. Go to Networks > Create Network
2. Name: `podex-internal`
3. IP Range: `10.0.0.0/16`
4. Zone: Your preferred region (eu-central, us-east, etc.)

**CLI:**
```bash
hcloud network create --name podex-internal --ip-range 10.0.0.0/16
hcloud network add-subnet podex-internal \
  --network-zone eu-central \
  --type cloud \
  --ip-range 10.0.1.0/24
```

### 3. Firewall Rules

Create firewalls for platform and workspace servers:

**Platform Server Firewall:**
```bash
hcloud firewall create --name podex-platform

# Inbound rules
hcloud firewall add-rule podex-platform --direction in --protocol tcp --port 22 --source-ips 0.0.0.0/0 --description "SSH"
hcloud firewall add-rule podex-platform --direction in --protocol tcp --port 80 --source-ips 0.0.0.0/0 --description "HTTP"
hcloud firewall add-rule podex-platform --direction in --protocol tcp --port 443 --source-ips 0.0.0.0/0 --description "HTTPS"
hcloud firewall add-rule podex-platform --direction in --protocol tcp --port 8000 --source-ips 0.0.0.0/0 --description "Coolify"
```

**Workspace Server Firewall:**
```bash
hcloud firewall create --name podex-workspace

# Allow SSH
hcloud firewall add-rule podex-workspace --direction in --protocol tcp --port 22 --source-ips 0.0.0.0/0 --description "SSH"

# Allow Docker TLS only from private network
hcloud firewall add-rule podex-workspace --direction in --protocol tcp --port 2376 --source-ips 10.0.0.0/16 --description "Docker TLS"
```

### 4. Create Servers

**Platform Server:**
```bash
hcloud server create \
  --name podex-platform \
  --type cx41 \
  --image ubuntu-24.04 \
  --location fsn1 \
  --network podex-internal \
  --firewall podex-platform \
  --ssh-key your-key-name \
  --user-data-from-file scripts/hetzner/platform-server-init.sh
```

**Workspace Servers (create multiple):**
```bash
for i in 1 2 3; do
  hcloud server create \
    --name podex-ws-$i \
    --type cx41 \
    --image ubuntu-24.04 \
    --location fsn1 \
    --network podex-internal \
    --firewall podex-workspace \
    --ssh-key your-key-name
done
```

### 5. Volumes (Persistent Storage)

Create volumes for database and workspace data:

**Database Volume:**
```bash
hcloud volume create \
  --name podex-db \
  --size 50 \
  --location fsn1 \
  --format ext4

# Attach to platform server
hcloud volume attach podex-db --server podex-platform --automount
```

**Workspace Storage Volumes (per workspace server):**
```bash
for i in 1 2 3; do
  hcloud volume create \
    --name podex-ws-$i-data \
    --size 100 \
    --location fsn1 \
    --format ext4

  hcloud volume attach podex-ws-$i-data --server podex-ws-$i --automount
done
```

Mount volumes on servers:
```bash
# On each server after volume is attached
sudo mkdir -p /mnt/data
sudo mount -o discard,defaults /dev/disk/by-id/scsi-0HC_Volume_<volume_id> /mnt/data
echo "/dev/disk/by-id/scsi-0HC_Volume_<volume_id> /mnt/data ext4 discard,nofail,defaults 0 0" | sudo tee -a /etc/fstab
```

### 6. Storage Boxes (Backups)

Hetzner Storage Boxes are great for backups:

1. Order a Storage Box from [Hetzner Robot](https://robot.hetzner.com)
2. Configure SFTP access

**Automated backup script:**
```bash
#!/bin/bash
# /usr/local/bin/podex-backup.sh

STORAGE_BOX="u123456@u123456.your-storagebox.de"
BACKUP_DIR="/mnt/data/backups"
DATE=$(date +%Y%m%d)

# Backup database
pg_dump -h localhost -U podex podex | gzip > "${BACKUP_DIR}/db-${DATE}.sql.gz"

# Sync to storage box
rsync -avz --delete "${BACKUP_DIR}/" "${STORAGE_BOX}:backups/"
```

Add to cron:
```bash
echo "0 2 * * * /usr/local/bin/podex-backup.sh" | sudo crontab -
```

### 7. Load Balancer

For production with multiple frontend servers:

```bash
hcloud load-balancer create \
  --name podex-lb \
  --type lb11 \
  --location fsn1 \
  --network-zone eu-central

# Add targets
hcloud load-balancer add-target podex-lb \
  --server podex-platform \
  --use-private-ip

# Add services
hcloud load-balancer add-service podex-lb \
  --protocol https \
  --listen-port 443 \
  --destination-port 3000 \
  --http-certificates <cert-id>

hcloud load-balancer add-service podex-lb \
  --protocol https \
  --listen-port 443 \
  --destination-port 3001 \
  --http-certificates <cert-id>
```

### 8. Floating IP (Optional)

For stable IP that can be reassigned:

```bash
hcloud floating-ip create --type ipv4 --home-location fsn1 --name podex-ip
hcloud floating-ip assign podex-ip --server podex-platform
```

Configure on server:
```bash
# /etc/netplan/60-floating-ip.yaml
network:
  version: 2
  ethernets:
    eth0:
      addresses:
        - <floating-ip>/32
```

## Coolify Setup

### 1. Install Coolify

SSH into platform server and run:
```bash
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
```

Or use the platform-server-init.sh script which includes Coolify.

### 2. Initial Configuration

1. Access Coolify at `https://<server-ip>:8000`
2. Create admin account
3. Set up your domain in Settings > General

### 3. Add Database (PostgreSQL)

1. Go to Projects > Your Project > New Resource
2. Select "Database" > "PostgreSQL"
3. Configure:
   - Name: `podex-db`
   - Version: 16
   - Port: 5432
   - Volume: Mount to `/mnt/data/postgres`
4. Deploy

### 4. Add Cache (Redis)

1. Go to Projects > Your Project > New Resource
2. Select "Database" > "Redis"
3. Configure:
   - Name: `podex-redis`
   - Version: 7
   - Volume: Mount to `/mnt/data/redis`
4. Deploy

### 5. Add Podex Services

For each service (api, agent, compute, web):

1. Go to Projects > Your Project > New Resource
2. Select "Application" > "Docker Compose"
3. Connect your GitHub repository
4. Select the appropriate docker-compose file or Dockerfile
5. Configure environment variables (see Environment Variables section)
6. Set up domains and SSL

## GitHub CI/CD Integration

### 1. Create GitHub App in Coolify

1. In Coolify, go to Settings > GitHub
2. Click "Create New GitHub App"
3. Fill in:
   - App Name: `podex-coolify`
   - Homepage URL: `https://your-coolify-domain.com`
4. Click "Create on GitHub" and authorize

### 2. Install GitHub App

1. Go to your GitHub organization settings
2. Find the app under "Installed GitHub Apps"
3. Grant access to your Podex repository

### 3. Configure Webhooks

Coolify automatically configures webhooks when you connect a repository. Each push to main triggers deployment.

### 4. GitHub Actions Integration (Optional)

For more control, use GitHub Actions with Coolify API:

**.github/workflows/deploy.yml:**
```yaml
name: Deploy to Coolify

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Deploy to Coolify
        run: |
          curl -X POST \
            -H "Authorization: Bearer ${{ secrets.COOLIFY_API_TOKEN }}" \
            -H "Content-Type: application/json" \
            "${{ secrets.COOLIFY_URL }}/api/v1/deploy" \
            -d '{"uuid": "${{ secrets.COOLIFY_APP_UUID }}"}'
```

**Required Secrets:**
- `COOLIFY_URL`: Your Coolify instance URL
- `COOLIFY_API_TOKEN`: API token from Coolify Settings > API
- `COOLIFY_APP_UUID`: UUID of the application to deploy

### 5. Environment Variables in CI/CD

Store sensitive env vars as GitHub Secrets and reference in Coolify:

1. In GitHub: Settings > Secrets > Actions
2. Add secrets like `DATABASE_URL`, `OPENROUTER_API_KEY`
3. In Coolify: Use `${{ secrets.SECRET_NAME }}` in env vars

## Environment Variables

### API Service

```bash
ENVIRONMENT=production
PORT=3001
DATABASE_URL=postgresql+asyncpg://podex:password@podex-db:5432/podex
REDIS_URL=redis://podex-redis:6379

# LLM Provider
LLM_PROVIDER=openrouter
OPENROUTER_API_KEY=sk-or-v1-xxxxx

# Voice Provider
VOICE_PROVIDER=local  # or: openai, google

# Auth
JWT_SECRET_KEY=<random-64-char-string>
FRONTEND_URL=https://podex.yourdomain.com

# OAuth (optional)
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...

# Internal Services
COMPUTE_SERVICE_URL=http://podex-compute:3003
COMPUTE_INTERNAL_API_KEY=<internal-key>
AGENT_SERVICE_URL=http://podex-agent:3002
INTERNAL_SERVICE_TOKEN=<service-token>

# Stripe (optional)
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

### Compute Service

```bash
COMPUTE_ENVIRONMENT=production
COMPUTE_MODE=docker
COMPUTE_DOCKER_RUNTIME=runsc
COMPUTE_WARM_POOL_SIZE=5
COMPUTE_MAX_WORKSPACES=50
COMPUTE_WORKSPACE_TIMEOUT=7200
COMPUTE_WORKSPACE_IMAGE=podex/workspace:latest
COMPUTE_WORKSPACE_STORAGE=/mnt/data/workspaces

COMPUTE_REDIS_URL=redis://podex-redis:6379
COMPUTE_INTERNAL_API_KEY=<internal-key>
COMPUTE_API_BASE_URL=http://podex-api:3001
COMPUTE_INTERNAL_SERVICE_TOKEN=<service-token>
```

### Web Frontend

```bash
NODE_ENV=production
NEXT_PUBLIC_API_URL=https://api.podex.yourdomain.com
NEXT_PUBLIC_WS_URL=wss://api.podex.yourdomain.com
```

## Adding Workspace Servers

### 1. Initialize Server

SSH into new workspace server and run:
```bash
export PLATFORM_SERVER_IP=10.0.1.1  # Private IP of platform server
export SERVER_NAME=ws-1

curl -fsSL https://raw.githubusercontent.com/your-org/podex/main/scripts/hetzner/workspace-server-init.sh | bash
```

### 2. Copy Certificates to Platform

```bash
# On workspace server
scp /etc/docker/certs/{ca.pem,client-cert.pem,client-key.pem} \
  root@<platform-ip>:/etc/podex/certs/ws-1/
```

### 3. Register in Compute Service

Via API or admin panel:
```bash
curl -X POST https://api.podex.yourdomain.com/api/admin/servers \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "ws-1",
    "hostname": "10.0.1.10",
    "docker_port": 2376,
    "tls_ca_path": "/etc/podex/certs/ws-1/ca.pem",
    "tls_cert_path": "/etc/podex/certs/ws-1/client-cert.pem",
    "tls_key_path": "/etc/podex/certs/ws-1/client-key.pem",
    "total_cpu": 8,
    "total_memory_mb": 32768,
    "total_disk_gb": 100
  }'
```

## Security

### gVisor Container Isolation

All workspace containers run with gVisor's `runsc` runtime:
- Kernel syscall interception
- Reduced attack surface
- Memory and process isolation

Verify gVisor is working:
```bash
docker run --runtime=runsc hello-world
```

### TLS for Docker API

Workspace servers use TLS client certificates:
- CA certificate verifies server identity
- Client certificates authenticate compute service
- All traffic encrypted

### Firewall Configuration

Workspace servers only accept Docker API connections from private network:
```bash
# Only platform server can connect
ufw allow from 10.0.0.0/16 to any port 2376 proto tcp
```

### Fail2ban

Enabled on all servers to block brute-force attempts:
```bash
fail2ban-client status sshd
```

## Monitoring

### Coolify Monitoring

Coolify provides built-in monitoring:
- Container logs
- Resource usage
- Deployment history

### Server Health Checks

```bash
# Platform server
curl https://api.podex.yourdomain.com/health

# Compute service
curl https://api.podex.yourdomain.com/api/compute/health

# Workspace servers
docker --tlsverify \
  --tlscacert=/etc/podex/certs/ws-1/ca.pem \
  --tlscert=/etc/podex/certs/ws-1/client-cert.pem \
  --tlskey=/etc/podex/certs/ws-1/client-key.pem \
  -H=tcp://10.0.1.10:2376 info
```

### Workspace Server Status

```bash
# On workspace server
podex-workspace-status
```

## Backup & Recovery

### Database

```bash
# Backup
pg_dump -h localhost -U podex podex | gzip > backup-$(date +%Y%m%d).sql.gz

# Restore
gunzip -c backup.sql.gz | psql -h localhost -U podex podex
```

### Workspace Data

```bash
# Backup workspace volumes
tar -czf workspaces-backup.tar.gz /mnt/data/workspaces/

# Restore
tar -xzf workspaces-backup.tar.gz -C /
```

### Automated Backups to Storage Box

See Storage Boxes section above for automated backup script.

## Troubleshooting

### Coolify deployment fails

1. Check container logs in Coolify dashboard
2. Verify environment variables
3. Check disk space: `df -h`

### Workspace server not connecting

1. Verify TLS certificates:
   ```bash
   openssl verify -CAfile ca.pem client-cert.pem
   ```
2. Check firewall rules: `ufw status verbose`
3. Test Docker connection manually

### gVisor container issues

```bash
# Check gVisor logs
journalctl -u docker | grep runsc

# Test basic functionality
docker run --runtime=runsc alpine echo "gVisor working"
```

### OpenRouter errors

```bash
# Verify API key
curl https://openrouter.ai/api/v1/models \
  -H "Authorization: Bearer $OPENROUTER_API_KEY"
```

## Cost Optimization

### Recommended Hetzner Configuration

| Component | Type | Monthly Cost |
|-----------|------|--------------|
| Platform Server | CX41 (8 vCPU, 32GB) | ~€40 |
| Workspace Server (x3) | CX41 | ~€120 |
| Load Balancer | LB11 | ~€6 |
| Volumes (250GB total) | SSD | ~€12 |
| Storage Box (100GB) | BX11 | ~€4 |
| **Total** | | **~€182/month** |

### Auto-scaling Tips

1. Use Hetzner Cloud API to spin up/down workspace servers based on demand
2. Configure warm pool size based on typical usage patterns
3. Set aggressive workspace timeouts for cost savings

## Related Documentation

- [Full Migration Plan](../plans/2026-01-29-self-hosted-migration.md)
- [Server Management API](../api/servers.md)
- [Workspace Orchestration](../architecture/workspace-orchestration.md)
