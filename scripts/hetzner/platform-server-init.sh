#!/bin/bash
# Podex Platform Server Initialization Script for Hetzner Cloud
# This script sets up the main platform server with Coolify.
#
# Prerequisites:
# - Fresh Ubuntu 24.04 LTS server
# - Root access
# - Domain pointed to server IP (for SSL)
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/your-org/podex/main/scripts/hetzner/platform-server-init.sh | bash
#   Or: ./platform-server-init.sh
#
# Environment variables (optional):
#   COOLIFY_DOMAIN - Domain for Coolify dashboard (e.g., deploy.podex.dev)
#   PODEX_DOMAIN - Domain for Podex app (e.g., podex.dev)
#   ADMIN_EMAIL - Admin email for SSL certificates

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

log_info "Starting Podex Platform Server initialization..."

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
    net-tools

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

# Enable and start Docker
systemctl enable docker
systemctl start docker

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

# Configure Docker to use runsc
mkdir -p /etc/docker
cat > /etc/docker/daemon.json << 'EOF'
{
    "runtimes": {
        "runsc": {
            "path": "/usr/bin/runsc",
            "runtimeArgs": [
                "--platform=systrap"
            ]
        }
    },
    "log-driver": "json-file",
    "log-opts": {
        "max-size": "100m",
        "max-file": "5"
    },
    "storage-driver": "overlay2"
}
EOF

systemctl restart docker
log_success "gVisor installed and configured"

# ============================================
# FIREWALL CONFIGURATION
# ============================================

log_info "Configuring firewall..."

# Reset UFW to default
ufw --force reset

# Default policies
ufw default deny incoming
ufw default allow outgoing

# Allow SSH (rate limited)
ufw limit 22/tcp comment 'SSH'

# Allow HTTP/HTTPS
ufw allow 80/tcp comment 'HTTP'
ufw allow 443/tcp comment 'HTTPS'

# Allow Docker swarm ports if needed (for multi-node Coolify)
# ufw allow 2377/tcp comment 'Docker Swarm cluster management'
# ufw allow 7946/tcp comment 'Docker Swarm node communication'
# ufw allow 7946/udp comment 'Docker Swarm node communication'
# ufw allow 4789/udp comment 'Docker Swarm overlay network'

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

# Create 4GB swap if not exists
if [ ! -f /swapfile ]; then
    fallocate -l 4G /swapfile
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

# Network optimizations for high-traffic server
net.core.somaxconn = 65535
net.core.netdev_max_backlog = 65535
net.ipv4.tcp_max_syn_backlog = 65535
net.ipv4.ip_local_port_range = 1024 65535
net.ipv4.tcp_tw_reuse = 1
net.ipv4.tcp_fin_timeout = 15
net.ipv4.tcp_keepalive_time = 300
net.ipv4.tcp_keepalive_probes = 5
net.ipv4.tcp_keepalive_intvl = 15

# File descriptor limits
fs.file-max = 2097152
fs.inotify.max_user_watches = 524288
fs.inotify.max_user_instances = 512
EOF

sysctl -p

log_success "Kernel optimizations applied"

# ============================================
# CREATE PODEX USER
# ============================================

log_info "Creating podex user..."

if ! id "podex" &>/dev/null; then
    useradd -m -s /bin/bash podex
    usermod -aG docker podex
    log_success "User 'podex' created and added to docker group"
else
    log_warn "User 'podex' already exists"
fi

# ============================================
# COOLIFY INSTALLATION
# ============================================

log_info "Installing Coolify..."
log_info "This will set up Coolify on this server."
log_info "After installation, access Coolify at: https://YOUR_SERVER_IP:8000"

# Download and run Coolify installer
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash

log_success "Coolify installed!"

# ============================================
# POST-INSTALLATION NOTES
# ============================================

SERVER_IP=$(curl -s ifconfig.me)

echo ""
echo "============================================"
echo -e "${GREEN}Podex Platform Server Setup Complete!${NC}"
echo "============================================"
echo ""
echo "Server IP: ${SERVER_IP}"
echo ""
echo -e "${CYAN}Next Steps:${NC}"
echo ""
echo "1. Access Coolify dashboard:"
echo "   https://${SERVER_IP}:8000"
echo ""
echo "2. Create admin account in Coolify"
echo ""
echo "3. In Coolify, add your GitHub App for deployments:"
echo "   Settings > GitHub > Create New GitHub App"
echo ""
echo "4. Configure your domains in DNS:"
echo "   - Point your Coolify domain to this server"
echo "   - Point api.yourdomain.com to this server"
echo "   - Point yourdomain.com to this server"
echo ""
echo "5. In Coolify, create a new Project and add services:"
echo "   - Database: PostgreSQL 16"
echo "   - Cache: Redis 7"
echo "   - Import your Podex repository"
echo ""
echo "6. Configure environment variables in Coolify for each service"
echo ""
echo "7. For workspace servers, run the workspace-server-init.sh script"
echo "   on separate Hetzner servers"
echo ""
echo -e "${YELLOW}Security Notes:${NC}"
echo "- SSH root login should be disabled in production"
echo "- Consider setting up SSH key authentication only"
echo "- Review firewall rules: ufw status verbose"
echo "- Monitor fail2ban: fail2ban-client status sshd"
echo ""
echo -e "${CYAN}Docker Info:${NC}"
docker info | grep -E "Runtime|Storage Driver"
echo ""
echo "gVisor runtime available: runsc"
echo "Use --runtime=runsc for sandboxed containers"
echo ""
