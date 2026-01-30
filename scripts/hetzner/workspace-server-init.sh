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
#   WORKSPACE_VOLUME_DEVICE - Block device for workspace storage (e.g., /dev/sdb)
#                             If set, creates XFS filesystem with project quota support
#                             Required for production disk quota enforcement
#
# SSH Access:
#   This script automatically adds the platform server's SSH public key to
#   /root/.ssh/authorized_keys, allowing the compute service to SSH in for
#   XFS quota management operations (create/update/remove quotas).
#   Override with PLATFORM_SSH_PUBLIC_KEY env var for custom deployments.
#   Set to empty string to skip SSH key setup entirely.

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
# Workspace storage with XFS project quotas
WORKSPACE_STORAGE_PATH="/data/workspaces"
# Hetzner volume device (attach a volume and set this, e.g., /dev/sdb)
WORKSPACE_VOLUME_DEVICE="${WORKSPACE_VOLUME_DEVICE:-}"
# Starting project ID for XFS quotas (each workspace gets a unique ID)
XFS_PROJECT_ID_START=1000

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
    openssl \
    xfsprogs \
    iproute2

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

# Detect private network IP (Hetzner private network is typically 10.x.x.x)
PRIVATE_IP=$(ip -4 addr show | grep -oP '10\.\d+\.\d+\.\d+' | head -1 || echo "")
if [ -n "$PRIVATE_IP" ]; then
    log_info "Private network IP detected: ${PRIVATE_IP}"
fi

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

# Create extfile for server certificate - include private IP if available
SAN_LIST="DNS:${SERVER_NAME},DNS:${SERVER_NAME}.podex.dev,DNS:localhost,IP:${SERVER_IP},IP:127.0.0.1"
if [ -n "$PRIVATE_IP" ]; then
    SAN_LIST="${SAN_LIST},IP:${PRIVATE_IP}"
fi

cat > extfile.cnf << EOF
subjectAltName = ${SAN_LIST}
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
# PODEX USER SETUP
# ============================================

log_info "Setting up podex user..."

# Create podex user
if ! id "podex" &>/dev/null; then
    useradd -m -s /bin/bash podex
    usermod -aG docker podex
fi

log_success "Podex user configured"

# ============================================
# PLATFORM SERVER SSH ACCESS
# ============================================

log_info "Configuring SSH access for platform server..."

# Create root .ssh directory if it doesn't exist
mkdir -p /root/.ssh
chmod 700 /root/.ssh

# Platform server public key for XFS quota management
# This allows the compute service to SSH in and manage workspace quotas
# Can be overridden via PLATFORM_SSH_PUBLIC_KEY env var for custom deployments
PLATFORM_SSH_KEY="${PLATFORM_SSH_PUBLIC_KEY:-ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEKyUmK9C0pHHxnM1Q0xnHxkD4WokmeEQU0t8wM/VcJe root@podex-dev}"

# Add to authorized_keys if key is provided
if [ -n "$PLATFORM_SSH_KEY" ]; then
    # Extract key identifier (last field) for duplicate check
    KEY_ID=$(echo "$PLATFORM_SSH_KEY" | awk '{print $NF}')

    if ! grep -q "$KEY_ID" /root/.ssh/authorized_keys 2>/dev/null; then
        echo "$PLATFORM_SSH_KEY" >> /root/.ssh/authorized_keys
        chmod 600 /root/.ssh/authorized_keys
        log_success "Platform server SSH key added ($KEY_ID)"
    else
        log_info "Platform server SSH key already present ($KEY_ID)"
    fi
else
    log_warn "No PLATFORM_SSH_PUBLIC_KEY provided - skipping SSH key setup"
    log_warn "Platform server won't be able to manage XFS quotas via SSH"
fi

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
# XFS VOLUME SETUP (for workspace disk quotas)
# ============================================

log_info "Setting up XFS volume for workspace storage..."

# Create mount point
mkdir -p "${WORKSPACE_STORAGE_PATH}"

# Auto-detect Hetzner volume if not explicitly set
if [ -z "$WORKSPACE_VOLUME_DEVICE" ]; then
    # Check for Hetzner auto-mounted volumes at /mnt/HC_Volume_*
    HETZNER_MOUNT=$(find /mnt -maxdepth 1 -name "HC_Volume_*" -type d 2>/dev/null | head -1)
    if [ -n "$HETZNER_MOUNT" ] && mountpoint -q "$HETZNER_MOUNT"; then
        # Get the device from the mount
        WORKSPACE_VOLUME_DEVICE=$(findmnt -n -o SOURCE "$HETZNER_MOUNT")
        log_info "Auto-detected Hetzner volume: $WORKSPACE_VOLUME_DEVICE mounted at $HETZNER_MOUNT"

        # Unmount from Hetzner's default location
        log_info "Unmounting from $HETZNER_MOUNT..."
        umount "$HETZNER_MOUNT"
        rmdir "$HETZNER_MOUNT" 2>/dev/null || true

        # Remove Hetzner's auto-mount entry from fstab
        sed -i '/HC_Volume_/d' /etc/fstab
    fi
fi

if [ -n "$WORKSPACE_VOLUME_DEVICE" ]; then
    # Check if device exists
    if [ ! -b "$WORKSPACE_VOLUME_DEVICE" ]; then
        log_error "Volume device $WORKSPACE_VOLUME_DEVICE does not exist"
        log_error "Please attach a Hetzner volume and set WORKSPACE_VOLUME_DEVICE"
        exit 1
    fi

    # Check if already formatted as XFS
    FSTYPE=$(blkid -s TYPE -o value "$WORKSPACE_VOLUME_DEVICE" 2>/dev/null || echo "")

    if [ "$FSTYPE" != "xfs" ]; then
        log_info "Formatting $WORKSPACE_VOLUME_DEVICE as XFS..."
        # Format with XFS (crc=1 enables reflink, ftype=1 required for overlay2)
        mkfs.xfs -f -m crc=1,finobt=1 "$WORKSPACE_VOLUME_DEVICE"
    else
        log_info "Device $WORKSPACE_VOLUME_DEVICE is already XFS formatted"
    fi

    # Check if already mounted at workspace path
    if ! mountpoint -q "${WORKSPACE_STORAGE_PATH}"; then
        log_info "Mounting XFS volume with project quota support..."
        mount -o pquota "$WORKSPACE_VOLUME_DEVICE" "${WORKSPACE_STORAGE_PATH}"
    fi

    # Get UUID for fstab
    UUID=$(blkid -s UUID -o value "$WORKSPACE_VOLUME_DEVICE")

    # Update fstab - remove any old entry for this UUID, add new one
    sed -i "/${UUID}/d" /etc/fstab
    echo "UUID=${UUID} ${WORKSPACE_STORAGE_PATH} xfs defaults,pquota 0 2" >> /etc/fstab
    log_info "Updated /etc/fstab with XFS mount"

    # Verify pquota is enabled
    if mount | grep "${WORKSPACE_STORAGE_PATH}" | grep -q "pquota"; then
        log_success "XFS mounted with project quota support"
    else
        log_warn "XFS mounted but pquota not enabled - remounting..."
        umount "${WORKSPACE_STORAGE_PATH}"
        mount -o pquota "$WORKSPACE_VOLUME_DEVICE" "${WORKSPACE_STORAGE_PATH}"
    fi

    # Set up projects and projid files for XFS quota management
    log_info "Setting up XFS project quota configuration..."

    # /etc/projects maps project IDs to directories
    # Format: project_id:directory_path
    touch /etc/projects

    # /etc/projid maps project names to IDs
    # Format: project_name:project_id
    touch /etc/projid

    # Create helper script for managing workspace quotas
    cat > /usr/local/bin/podex-quota << 'QUOTA_SCRIPT'
#!/bin/bash
# Podex workspace quota management helper
# Usage:
#   podex-quota create <workspace_id> <size_gb>  - Create quota for workspace
#   podex-quota update <workspace_id> <size_gb>  - Update quota
#   podex-quota remove <workspace_id>            - Remove quota
#   podex-quota list                             - List all quotas
#   podex-quota usage <workspace_id>             - Show usage for workspace

set -euo pipefail

WORKSPACE_PATH="/data/workspaces"
PROJECT_ID_START=1000

get_project_id() {
    local workspace_id=$1
    # Check if workspace already has a project ID
    local existing_id=$(grep "^${workspace_id}:" /etc/projid 2>/dev/null | cut -d: -f2)
    if [ -n "$existing_id" ]; then
        echo "$existing_id"
        return
    fi
    # Find next available project ID
    local max_id=$(cut -d: -f2 /etc/projid 2>/dev/null | sort -n | tail -1)
    if [ -z "$max_id" ] || [ "$max_id" -lt "$PROJECT_ID_START" ]; then
        echo "$PROJECT_ID_START"
    else
        echo $((max_id + 1))
    fi
}

case "${1:-}" in
    create)
        workspace_id=$2
        size_gb=$3
        workspace_dir="${WORKSPACE_PATH}/${workspace_id}"

        # Create directory structure
        mkdir -p "${workspace_dir}/home"

        # Get or create project ID
        project_id=$(get_project_id "$workspace_id")

        # Add to projects file if not exists
        if ! grep -q "^${project_id}:${workspace_dir}" /etc/projects 2>/dev/null; then
            echo "${project_id}:${workspace_dir}" >> /etc/projects
        fi

        # Add to projid file if not exists
        if ! grep -q "^${workspace_id}:" /etc/projid 2>/dev/null; then
            echo "${workspace_id}:${project_id}" >> /etc/projid
        fi

        # Set up the project on the directory
        xfs_quota -x -c "project -s ${workspace_id}" "${WORKSPACE_PATH}"

        # Set the quota limit
        xfs_quota -x -c "limit -p bhard=${size_gb}g ${workspace_id}" "${WORKSPACE_PATH}"

        # Set ownership for workspace user (UID 1000 in container)
        chown -R 1000:1000 "${workspace_dir}/home"

        echo "Created quota for ${workspace_id}: ${size_gb}GB"
        ;;

    update)
        workspace_id=$2
        size_gb=$3

        # Check workspace exists
        if ! grep -q "^${workspace_id}:" /etc/projid 2>/dev/null; then
            echo "Error: Workspace ${workspace_id} not found"
            exit 1
        fi

        # Update quota limit
        xfs_quota -x -c "limit -p bhard=${size_gb}g ${workspace_id}" "${WORKSPACE_PATH}"

        echo "Updated quota for ${workspace_id}: ${size_gb}GB"
        ;;

    remove)
        workspace_id=$2
        workspace_dir="${WORKSPACE_PATH}/${workspace_id}"

        # Get project ID
        project_id=$(grep "^${workspace_id}:" /etc/projid 2>/dev/null | cut -d: -f2)

        if [ -n "$project_id" ]; then
            # Remove quota
            xfs_quota -x -c "limit -p bhard=0 ${workspace_id}" "${WORKSPACE_PATH}" 2>/dev/null || true

            # Remove from projects file
            sed -i "/^${project_id}:/d" /etc/projects

            # Remove from projid file
            sed -i "/^${workspace_id}:/d" /etc/projid
        fi

        # Remove directory
        if [ -d "$workspace_dir" ]; then
            rm -rf "$workspace_dir"
        fi

        echo "Removed quota and directory for ${workspace_id}"
        ;;

    list)
        echo "Workspace Quotas:"
        echo "================"
        xfs_quota -x -c "report -p -h" "${WORKSPACE_PATH}" 2>/dev/null || echo "No quotas configured"
        ;;

    usage)
        workspace_id=$2
        xfs_quota -x -c "quota -p ${workspace_id}" "${WORKSPACE_PATH}" 2>/dev/null || echo "Workspace not found"
        ;;

    *)
        echo "Usage: podex-quota {create|update|remove|list|usage} [args]"
        echo ""
        echo "Commands:"
        echo "  create <workspace_id> <size_gb>  - Create quota for workspace"
        echo "  update <workspace_id> <size_gb>  - Update quota limit"
        echo "  remove <workspace_id>            - Remove quota and directory"
        echo "  list                             - List all quotas"
        echo "  usage <workspace_id>             - Show usage for workspace"
        exit 1
        ;;
esac
QUOTA_SCRIPT
    chmod +x /usr/local/bin/podex-quota

    log_success "XFS project quota system configured"

else
    log_warn "WORKSPACE_VOLUME_DEVICE not set - using local filesystem without quotas"
    log_warn "For production, attach a Hetzner volume and set WORKSPACE_VOLUME_DEVICE"

    # Still create the directory for local development
    mkdir -p "${WORKSPACE_STORAGE_PATH}"
    chmod 755 "${WORKSPACE_STORAGE_PATH}"
fi

# Set proper permissions
chown -R podex:podex "${WORKSPACE_STORAGE_PATH}" 2>/dev/null || true

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
df -h /var/lib/docker /data/workspaces 2>/dev/null | grep -v "^Filesystem"
echo ""
echo "XFS Quota Status:"
if command -v xfs_quota &>/dev/null && mountpoint -q /data/workspaces; then
    xfs_quota -x -c "report -p -h" /data/workspaces 2>/dev/null || echo "No quotas configured"
else
    echo "XFS quotas not available (local dev mode)"
fi
echo ""
echo "Workspace Storage:"
if [ -d /data/workspaces ] && [ "$(ls -A /data/workspaces 2>/dev/null)" ]; then
    du -sh /data/workspaces/* 2>/dev/null | head -10
else
    echo "No workspaces yet"
fi
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
# Try to detect private network IP (Hetzner private network is typically 10.x.x.x)
PRIVATE_IP=$(ip -4 addr show | grep -oP '10\.\d+\.\d+\.\d+' | head -1 || echo "")
if [ -n "$PRIVATE_IP" ]; then
    DOCKER_HOST_IP="$PRIVATE_IP"
    echo "Private network IP detected: ${PRIVATE_IP}"
else
    DOCKER_HOST_IP="$SERVER_IP"
    echo "No private network detected, using public IP"
fi
echo ""
echo "1. Copy client certificates to platform server (run from your laptop):"
echo "   ssh ${SERVER_NAME}.podex.dev \"cat ${DOCKER_TLS_CERT_PATH}/ca.pem\" | ssh podex-platform \"mkdir -p /etc/docker/workspace-certs/${SERVER_NAME} && cat > /etc/docker/workspace-certs/${SERVER_NAME}/ca.pem\" && \\"
echo "   ssh ${SERVER_NAME}.podex.dev \"cat ${DOCKER_TLS_CERT_PATH}/client-cert.pem\" | ssh podex-platform \"cat > /etc/docker/workspace-certs/${SERVER_NAME}/client-cert.pem\" && \\"
echo "   ssh ${SERVER_NAME}.podex.dev \"cat ${DOCKER_TLS_CERT_PATH}/client-key.pem\" | ssh podex-platform \"cat > /etc/docker/workspace-certs/${SERVER_NAME}/client-key.pem\""
echo ""
echo "2. In your Podex admin panel or compute service config, add:"
echo "   {"
echo "     \"server_id\": \"${SERVER_NAME}\","
echo "     \"host\": \"${DOCKER_HOST_IP}\","
echo "     \"port\": 2376,"
echo "     \"tls_ca\": \"/etc/docker/workspace-certs/${SERVER_NAME}/ca.pem\","
echo "     \"tls_cert\": \"/etc/docker/workspace-certs/${SERVER_NAME}/client-cert.pem\","
echo "     \"tls_key\": \"/etc/docker/workspace-certs/${SERVER_NAME}/client-key.pem\""
echo "   }"
echo ""
echo "3. Test Docker connection from platform:"
echo "   docker --tlsverify \\
     --tlscacert=/etc/docker/workspace-certs/${SERVER_NAME}/ca.pem \\
     --tlscert=/etc/docker/workspace-certs/${SERVER_NAME}/client-cert.pem \\
     --tlskey=/etc/docker/workspace-certs/${SERVER_NAME}/client-key.pem \\
     -H=tcp://${DOCKER_HOST_IP}:2376 info"
echo ""
echo -e "${CYAN}Quick Commands:${NC}"
echo "  podex-workspace-status  - Check server status"
echo "  podex-quota list        - List all workspace quotas"
echo "  podex-quota usage <id>  - Show quota usage for workspace"
echo "  docker stats            - Live container metrics"
echo "  journalctl -u docker    - Docker logs"
echo ""
echo -e "${YELLOW}Security Notes:${NC}"
echo "- Docker API is TLS-secured and requires client certificates"
echo "- gVisor (runsc) is the default runtime for all containers"
echo "- Firewall restricts Docker port to platform server only"
echo ""
if [ -n "$WORKSPACE_VOLUME_DEVICE" ]; then
    echo -e "${CYAN}XFS Quota Configuration:${NC}"
    echo "- Workspace storage: ${WORKSPACE_STORAGE_PATH}"
    echo "- Volume device: ${WORKSPACE_VOLUME_DEVICE}"
    echo "- Project quotas: ENABLED"
    echo "- Quota management: Use 'podex-quota' command"
else
    echo -e "${YELLOW}XFS Quota Warning:${NC}"
    echo "- No volume device configured - running without disk quotas"
    echo "- For production, attach a Hetzner volume and re-run with:"
    echo "  WORKSPACE_VOLUME_DEVICE=/dev/sdX ./workspace-server-init.sh"
fi
echo ""
echo -e "${CYAN}Docker Runtime Info:${NC}"
docker info 2>/dev/null | grep -E "Default Runtime|Runtimes"
echo ""
