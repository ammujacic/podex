# Podex Monitoring Stack

Complete observability stack for Podex self-hosted deployment.

## Components

| Service           | Purpose                    | Host Port | Public URL                                |
| ----------------- | -------------------------- | --------- | ----------------------------------------- |
| **Grafana**       | Dashboards & visualization | 9000      | `grafana.yourdomain.com`                  |
| **Uptime Kuma**   | Status page & uptime       | 9001      | `status.yourdomain.com`                   |
| **Prometheus**    | Metrics collection         | 9090      | Internal (or `prometheus.yourdomain.com`) |
| **Loki**          | Log aggregation            | 3100      | Internal only                             |
| **Promtail**      | Log collector              | 9080      | Internal only                             |
| **Node Exporter** | Server metrics             | 9100      | Internal only                             |
| **cAdvisor**      | Container metrics          | 8080      | Internal only                             |

## Deployment via Coolify

### 1. Connect Repository

1. In Coolify, go to **Projects** → Your project
2. Click **+ New** → **Docker Compose**
3. Select **GitHub** and connect your Podex repository
4. Set **Docker Compose Location**: `docker/monitoring/docker-compose.yml`

### 2. Configure Environment Variables

In Coolify, add these environment variables:

```
GRAFANA_ADMIN_PASSWORD=<secure-password>
GRAFANA_URL=https://grafana.yourdomain.com

# Optional: Email alerts
SMTP_ENABLED=true
SMTP_HOST=smtp.example.com:587
SMTP_USER=your-email@example.com
SMTP_PASSWORD=your-smtp-password
SMTP_FROM=alerts@yourdomain.com
```

### 3. Configure Domains

After deployment, configure domains for each service in Coolify:

**Grafana:**

- Service: `grafana`
- Domain: `grafana.yourdomain.com`
- Port: `9000`
- HTTPS: ✓ (auto Let's Encrypt)

**Uptime Kuma:**

- Service: `uptime-kuma`
- Domain: `status.yourdomain.com`
- Port: `9001`
- HTTPS: ✓

**Prometheus (optional, for external access):**

- Service: `prometheus`
- Domain: `prometheus.yourdomain.com`
- Port: `9090`
- HTTPS: ✓
- Note: Add basic auth or IP restriction for security

### 4. DNS Records

Add these A records pointing to your platform server IP:

| Type | Name       | Value                      |
| ---- | ---------- | -------------------------- |
| A    | grafana    | `<platform-ip>`            |
| A    | status     | `<platform-ip>`            |
| A    | prometheus | `<platform-ip>` (optional) |

### 5. Deploy

Click **Deploy** in Coolify. The stack will start automatically.

## Post-Deployment Setup

### Grafana First Login

1. Go to `https://grafana.yourdomain.com`
2. Login: `admin` / `<GRAFANA_ADMIN_PASSWORD>`
3. Change password when prompted

### Import Dashboards

Go to **Dashboards** → **Import** and enter these IDs:

| ID    | Dashboard          | Description                |
| ----- | ------------------ | -------------------------- |
| 1860  | Node Exporter Full | Complete server metrics    |
| 893   | Docker Monitoring  | Container overview         |
| 13639 | Loki Dashboard     | Log exploration            |
| 14055 | cAdvisor           | Detailed container metrics |

### Uptime Kuma Setup

1. Go to `https://status.yourdomain.com`
2. Create admin account
3. Add monitors:
   - **HTTP**: `https://api.yourdomain.com/health`
   - **HTTP**: `https://yourdomain.com`
   - **TCP**: Database on port 5432
   - **TCP**: Redis on port 6379

## Adding Workspace Servers

Each workspace server needs node_exporter for metrics:

```bash
# On workspace server
docker run -d \
  --name node-exporter \
  --restart=unless-stopped \
  --net="host" \
  --pid="host" \
  -v "/:/host:ro,rslave" \
  quay.io/prometheus/node_exporter:latest \
  --path.rootfs=/host
```

Then update `prometheus/prometheus.yml` to add the targets:

```yaml
- job_name: 'node-workspace'
  static_configs:
    - targets: ['10.0.1.10:9100']
      labels:
        server: 'ws-1'
        role: 'workspace'
```

Redeploy in Coolify to apply changes.

## Log Queries in Grafana

### View all container logs

```logql
{job="docker"}
```

### View specific service logs

```logql
{service="podex-api"}
```

### View error logs only

```logql
{job="docker"} |= "error" or |= "ERROR"
```

### View auth failures

```logql
{job="authlog"} |= "Failed password"
```

## Alert Configuration

Alerts are defined in `prometheus/alerts.yml`. To receive notifications:

1. In Grafana → **Alerting** → **Contact points**
2. Add your notification channel (Email, Slack, Discord, PagerDuty, etc.)
3. Create notification policies to route alerts

## Troubleshooting

### Grafana can't connect to Prometheus

Check that both containers are on the same Docker network:

```bash
docker network inspect coolify
```

### Logs not appearing in Loki

1. Check Promtail is running: `docker logs promtail`
2. Verify Docker socket access: `docker exec promtail ls /var/run/docker.sock`

### High disk usage from logs

Adjust retention in `loki/loki-config.yml`:

```yaml
limits_config:
  retention_period: 168h # Reduce to 7 days
```

## Resource Usage

Approximate memory usage:

- Prometheus: ~200MB
- Grafana: ~150MB
- Loki: ~300MB
- Promtail: ~50MB
- Node Exporter: ~20MB
- cAdvisor: ~50MB
- Uptime Kuma: ~100MB

**Total: ~900MB**

For smaller servers, you can disable cAdvisor (container metrics still available via Docker stats).
