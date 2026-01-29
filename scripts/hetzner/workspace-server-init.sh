#!/bin/bash
# Podex Workspace Server Initialization Script for Hetzner Cloud
# This script sets up a workspace server that runs user containers.
#
# Prerequisites:
# - Fresh Ubuntu 24.04 LTS server
# - Root access
# - Platform server already configured
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/your-org/podex/main/scripts/hetzner/workspace-server-init.sh | bash
#   Or: ./workspace-server-init.sh
#
# Environment variables (required):
#   PLATFORM_SERVER_IP - IP address of the platform server
#   SERVER_NAME - Unique name for this workspace server (e.g., ws-1, ws-eu-1)
#
# Environment variables (optional):
#   DOCKER_TLS_CERT_PATH - Path to store TLS certificates (default: /etc/docker/certs)

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log_info() { echo -e "${CYAN}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    log_error "Please run as root"
    exit 1
fi

# Configuration
PLATFORM_SERVER_IP="${PLATFORM_SERVER_IP:-}"
SERVER_NAME="${SERVER_NAME:-ws-$(hostname)}"
DOCKER_TLS_CERT_PATH="${DOCKER_TLS_CERT_PATH:-/etc/docker/certs}"
WORKSPACE_STORAGE_PATH="/var/lib/podex/workspaces"

if [ -z "$PLATFORM_SERVER_IP" ]; then
    log_warn "PLATFORM_SERVER_IP not set. Docker TLS will be configured but not connected to platform."
fi

log_info "Starting Podex Workspace Server initialization..."
log_info "Server name: ${SERVER_NAME}"

# ============================================
# SYSTEM UPDATES
# ============================================

log_info "Updating system packages..."
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get upgrade -y

# ============================================
# INSTALL DEPENDENCIES
# ============================================

log_info "Installing system dependencies..."
DEBIAN_FRONTEND=noninteractive apt-get install -y \
    apt-transport-https \
    ca-certificates \
    curl \
    gnupg \
    lsb-release \
    software-properties-common \
    ufw \
    fail2ban \
    htop \
    vim \
    git \
    jq \
    unzip \
    net-tools \
    openssl

# ============================================
# DOCKER INSTALLATION
# ============================================

log_info "Installing Docker..."

# Add Docker's official GPG key
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

# Add Docker repository
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  tee /etc/apt/sources.list.d/docker.list > /dev/null

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y \
    docker-ce \
    docker-ce-cli \
    containerd.io \
    docker-buildx-plugin \
    docker-compose-plugin

log_success "Docker installed successfully"

# ============================================
# GVISOR (runsc) INSTALLATION
# ============================================

log_info "Installing gVisor (runsc) for enhanced container security..."

# Add gVisor repository
curl -fsSL https://gvisor.dev/archive.key | gpg --dearmor -o /usr/share/keyrings/gvisor-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/gvisor-archive-keyring.gpg] https://storage.googleapis.com/gvisor/releases release main" | \
    tee /etc/apt/sources.list.d/gvisor.list > /dev/null

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y runsc

log_success "gVisor installed"

# ============================================
# DOCKER TLS CONFIGURATION
# ============================================

log_info "Setting up Docker TLS certificates..."

mkdir -p "${DOCKER_TLS_CERT_PATH}"
cd "${DOCKER_TLS_CERT_PATH}"

# Get server's public IP
SERVER_IP=$(curl -s ifconfig.me)

# Generate CA key and certificate
log_info "Generating CA certificate..."
openssl genrsa -out ca-key.pem 4096
openssl req -new -x509 -days 3650 -key ca-key.pem -sha256 -out ca.pem \
    -subj "/CN=Podex Workspace CA"

# Generate server key
log_info "Generating server certificate..."
openssl genrsa -out server-key.pem 4096

# Create server CSR
openssl req -subj "/CN=${SERVER_NAME}" -sha256 -new -key server-key.pem -out server.csr

# Create extfile for server certificate
cat > extfile.cnf << EOF
subjectAltName = DNS:${SERVER_NAME},DNS:localhost,IP:${SERVER_IP},IP:127.0.0.1
extendedKeyUsage = serverAuth
EOF

# Generate server certificate
openssl x509 -req -days 3650 -sha256 \
    -in server.csr \
    -CA ca.pem \
    -CAkey ca-key.pem \
    -CAcreateserial \
    -out server-cert.pem \
    -extfile extfile.cnf

# Generate client key (for platform server)
log_info "Generating client certificate..."
openssl genrsa -out client-key.pem 4096
openssl req -subj '/CN=client' -new -key client-key.pem -out client.csr

cat > extfile-client.cnf << 'EOF'
extendedKeyUsage = clientAuth
EOF

openssl x509 -req -days 3650 -sha256 \
    -in client.csr \
    -CA ca.pem \
    -CAkey ca-key.pem \
    -CAcreateserial \
    -out client-cert.pem \
    -extfile extfile-client.cnf

# Set permissions
chmod 0400 ca-key.pem server-key.pem client-key.pem
chmod 0444 ca.pem server-cert.pem client-cert.pem

# Cleanup CSR files
rm -f server.csr client.csr extfile.cnf extfile-client.cnf

log_success "TLS certificates generated"

# ============================================
# DOCKER DAEMON CONFIGURATION
# ============================================

log_info "Configuring Docker daemon..."

cat > /etc/docker/daemon.json << EOF
{
    "hosts": ["unix:///var/run/docker.sock", "tcp://0.0.0.0:2376"],
    "tls": true,
    "tlscacert": "${DOCKER_TLS_CERT_PATH}/ca.pem",
    "tlscert": "${DOCKER_TLS_CERT_PATH}/server-cert.pem",
    "tlskey": "${DOCKER_TLS_CERT_PATH}/server-key.pem",
    "tlsverify": true,
    "runtimes": {
        "runsc": {
            "path": "/usr/bin/runsc",
            "runtimeArgs": [
                "--platform=systrap"
            ]
        }
    },
    "default-runtime": "runsc",
    "log-driver": "json-file",
    "log-opts": {
        "max-size": "50m",
        "max-file": "3"
    },
    "storage-driver": "overlay2",
    "live-restore": true
}
EOF

# Docker systemd override to remove -H flag (since we specify hosts in daemon.json)
mkdir -p /etc/systemd/system/docker.service.d
cat > /etc/systemd/system/docker.service.d/override.conf << 'EOF'
[Service]
ExecStart=
ExecStart=/usr/bin/dockerd
EOF

systemctl daemon-reload
systemctl restart docker

log_success "Docker daemon configured with TLS and gVisor"

# ============================================
# WORKSPACE STORAGE SETUP
# ============================================

log_info "Setting up workspace storage..."

mkdir -p "${WORKSPACE_STORAGE_PATH}"
chmod 755 "${WORKSPACE_STORAGE_PATH}"

# Create podex user
if ! id "podex" &>/dev/null; then
    useradd -m -s /bin/bash podex
    usermod -aG docker podex
fi

chown -R podex:podex "${WORKSPACE_STORAGE_PATH}"

log_success "Workspace storage configured at ${WORKSPACE_STORAGE_PATH}"

# ============================================
# FIREWALL CONFIGURATION
# ============================================

log_info "Configuring firewall..."

# Reset UFW
ufw --force reset

# Default policies
ufw default deny incoming
ufw default allow outgoing

# Allow SSH
ufw limit 22/tcp comment 'SSH'

# Allow Docker TLS from platform server only
if [ -n "$PLATFORM_SERVER_IP" ]; then
    ufw allow from ${PLATFORM_SERVER_IP} to any port 2376 proto tcp comment 'Docker TLS from platform'
else
    log_warn "PLATFORM_SERVER_IP not set - Docker port 2376 will need manual firewall rule"
    # For initial setup, allow from Hetzner private network range
    ufw allow from 10.0.0.0/8 to any port 2376 proto tcp comment 'Docker TLS from private network'
fi

# Enable firewall
ufw --force enable

log_success "Firewall configured"

# ============================================
# FAIL2BAN CONFIGURATION
# ============================================

log_info "Configuring fail2ban..."

cat > /etc/fail2ban/jail.local << 'EOF'
[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 5

[sshd]
enabled = true
port = ssh
filter = sshd
logpath = /var/log/auth.log
maxretry = 3
bantime = 86400
EOF

systemctl enable fail2ban
systemctl restart fail2ban

log_success "fail2ban configured"

# ============================================
# SWAP CONFIGURATION
# ============================================

log_info "Configuring swap..."

if [ ! -f /swapfile ]; then
    # Create swap based on RAM (same size as RAM, max 8GB)
    RAM_SIZE=$(free -g | awk '/^Mem:/{print $2}')
    SWAP_SIZE=$((RAM_SIZE > 8 ? 8 : RAM_SIZE))

    fallocate -l ${SWAP_SIZE}G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' | tee -a /etc/fstab

    # Optimize swap settings
    sysctl vm.swappiness=10
    sysctl vm.vfs_cache_pressure=50
    echo 'vm.swappiness=10' >> /etc/sysctl.conf
    echo 'vm.vfs_cache_pressure=50' >> /etc/sysctl.conf
fi

log_success "Swap configured"

# ============================================
# KERNEL OPTIMIZATIONS
# ============================================

log_info "Applying kernel optimizations..."

cat >> /etc/sysctl.conf << 'EOF'

# Network optimizations for container workloads
net.core.somaxconn = 65535
net.core.netdev_max_backlog = 65535
net.ipv4.tcp_max_syn_backlog = 65535
net.ipv4.ip_local_port_range = 1024 65535
net.ipv4.tcp_tw_reuse = 1
net.ipv4.tcp_fin_timeout = 15

# Memory optimizations for containers
vm.overcommit_memory = 1
vm.max_map_count = 262144

# File descriptor limits
fs.file-max = 2097152
fs.inotify.max_user_watches = 524288
fs.inotify.max_user_instances = 512
EOF

sysctl -p

log_success "Kernel optimizations applied"

# ============================================
# PULL WORKSPACE IMAGE
# ============================================

log_info "Pulling workspace base image..."

# This will be pulled from your registry after Coolify deploys it
# For now, we'll skip if not available
if docker pull podex/workspace:latest 2>/dev/null; then
    log_success "Workspace image pulled"
else
    log_warn "Could not pull podex/workspace:latest - will be available after deployment"
fi

# ============================================
# MONITORING SCRIPT
# ============================================

log_info "Creating monitoring script..."

cat > /usr/local/bin/podex-workspace-status << 'EOF'
#!/bin/bash
# Quick status check for workspace server

echo "=== Workspace Server Status ==="
echo ""
echo "Docker Info:"
docker info 2>/dev/null | grep -E "Containers|Images|Server Version|Default Runtime" || echo "Docker not running"
echo ""
echo "Running Workspaces:"
docker ps --filter "label=podex.workspace=true" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || echo "None"
echo ""
echo "Resource Usage:"
docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}" 2>/dev/null | head -10 || echo "No containers"
echo ""
echo "Disk Usage:"
df -h /var/lib/docker /var/lib/podex 2>/dev/null | grep -v "^Filesystem"
echo ""
echo "Workspace Storage:"
du -sh /var/lib/podex/workspaces/* 2>/dev/null | head -10 || echo "No workspaces"
EOF

chmod +x /usr/local/bin/podex-workspace-status

log_success "Monitoring script created"

# ============================================
# POST-INSTALLATION NOTES
# ============================================

echo ""
echo "============================================"
echo -e "${GREEN}Podex Workspace Server Setup Complete!${NC}"
echo "============================================"
echo ""
echo "Server Name: ${SERVER_NAME}"
echo "Server IP: ${SERVER_IP}"
echo ""
echo -e "${CYAN}Docker TLS Certificates:${NC}"
echo "Location: ${DOCKER_TLS_CERT_PATH}"
echo ""
echo "Files to copy to platform server:"
echo "  - ca.pem (CA certificate)"
echo "  - client-cert.pem (client certificate)"
echo "  - client-key.pem (client key)"
echo ""
echo -e "${CYAN}To register this server with the platform:${NC}"
echo ""
echo "1. Copy client certificates to platform server:"
echo "   scp ${DOCKER_TLS_CERT_PATH}/ca.pem ${DOCKER_TLS_CERT_PATH}/client-cert.pem ${DOCKER_TLS_CERT_PATH}/client-key.pem user@platform:/path/to/certs/${SERVER_NAME}/"
echo ""
echo "2. In your Podex admin panel or compute service config, add:"
echo "   {"
echo "     \"server_id\": \"${SERVER_NAME}\","
echo "     \"host\": \"${SERVER_IP}\","
echo "     \"port\": 2376,"
echo "     \"tls_ca\": \"/path/to/certs/${SERVER_NAME}/ca.pem\","
echo "     \"tls_cert\": \"/path/to/certs/${SERVER_NAME}/client-cert.pem\","
echo "     \"tls_key\": \"/path/to/certs/${SERVER_NAME}/client-key.pem\""
echo "   }"
echo ""
echo "3. Test Docker connection from platform:"
echo "   docker --tlsverify \\
     --tlscacert=/path/to/certs/${SERVER_NAME}/ca.pem \\
     --tlscert=/path/to/certs/${SERVER_NAME}/client-cert.pem \\
     --tlskey=/path/to/certs/${SERVER_NAME}/client-key.pem \\
     -H=tcp://${SERVER_IP}:2376 info"
echo ""
echo -e "${CYAN}Quick Commands:${NC}"
echo "  podex-workspace-status  - Check server status"
echo "  docker stats            - Live container metrics"
echo "  journalctl -u docker    - Docker logs"
echo ""
echo -e "${YELLOW}Security Notes:${NC}"
echo "- Docker API is TLS-secured and requires client certificates"
echo "- gVisor (runsc) is the default runtime for all containers"
echo "- Firewall restricts Docker port to platform server only"
echo ""
echo -e "${CYAN}Docker Runtime Info:${NC}"
docker info 2>/dev/null | grep -E "Default Runtime|Runtimes"
echo ""
