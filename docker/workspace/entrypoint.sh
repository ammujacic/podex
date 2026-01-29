#!/bin/bash
# Podex Workspace Entrypoint Script
# Handles workspace initialization, storage setup, git config, and process management.

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Set up storage mount and symlinks
setup_storage() {
    # Check if storage is mounted
    if [ -d "/mnt/storage" ]; then
        log_info "Storage mount detected at /mnt/storage"

        # Get workspace ID from environment
        if [ -n "$WORKSPACE_ID" ]; then
            WORKSPACE_DIR="/mnt/storage/workspaces/$WORKSPACE_ID"

            # Ensure workspace directory exists
            mkdir -p "$WORKSPACE_DIR"

            # Remove existing projects directory/symlink and create symlink to storage
            rm -rf "$HOME/projects"
            ln -sf "$WORKSPACE_DIR" "$HOME/projects"
            log_info "Created projects symlink: $HOME/projects -> $WORKSPACE_DIR"
        else
            log_warn "WORKSPACE_ID not set, using local projects directory"
        fi

        # Set up dotfiles directory symlink if it exists in storage
        if [ -d "/mnt/storage/dotfiles" ]; then
            # Merge dotfiles into home directory
            log_info "Dotfiles directory found in storage"
        fi
    else
        log_info "No storage mount, using local projects directory"
        mkdir -p "$HOME/projects"
    fi
}

# Initialize workspace directories
init_workspace() {
    log_info "Initializing workspace..."

    # Set up storage mounts and symlinks
    setup_storage

    # Ensure config directories exist
    mkdir -p "$HOME/.config"
    mkdir -p "$HOME/.local/bin"
    mkdir -p "$HOME/.cache"
}

# Configure Git from environment variables
configure_git() {
    if [ -n "$GIT_USER_NAME" ]; then
        log_info "Setting Git user.name: $GIT_USER_NAME"
        git config --global user.name "$GIT_USER_NAME"
    fi

    if [ -n "$GIT_USER_EMAIL" ]; then
        log_info "Setting Git user.email: $GIT_USER_EMAIL"
        git config --global user.email "$GIT_USER_EMAIL"
    fi

    # Set up credential helper for HTTPS
    git config --global credential.helper 'cache --timeout=3600'

    # Safe directory config for mounted volumes
    git config --global --add safe.directory '*'
}

# Configure SSH if keys are provided
configure_ssh() {
    if [ -n "$SSH_PRIVATE_KEY" ]; then
        log_info "Configuring SSH key..."
        mkdir -p "$HOME/.ssh"
        chmod 700 "$HOME/.ssh"

        echo "$SSH_PRIVATE_KEY" > "$HOME/.ssh/id_rsa"
        chmod 600 "$HOME/.ssh/id_rsa"

        # Add common Git hosts to known_hosts
        ssh-keyscan -t rsa github.com >> "$HOME/.ssh/known_hosts" 2>/dev/null || true
        ssh-keyscan -t rsa gitlab.com >> "$HOME/.ssh/known_hosts" 2>/dev/null || true
        ssh-keyscan -t rsa bitbucket.org >> "$HOME/.ssh/known_hosts" 2>/dev/null || true
    fi
}

# Start SSH server if running in container mode with SSH enabled
# This enables VS Code Remote-SSH access via Cloudflare tunnels
start_sshd() {
    if [ -n "$ENABLE_SSHD" ] && [ "$ENABLE_SSHD" = "true" ]; then
        log_info "Starting SSH server..."

        # Ensure .ssh directory exists with correct permissions
        mkdir -p "$HOME/.ssh"
        chmod 700 "$HOME/.ssh"

        # Write authorized_keys from environment if provided
        if [ -n "$SSH_AUTHORIZED_KEYS" ]; then
            echo "$SSH_AUTHORIZED_KEYS" > "$HOME/.ssh/authorized_keys"
            chmod 600 "$HOME/.ssh/authorized_keys"
            log_info "SSH authorized_keys configured"
        fi

        # Generate host keys if they don't exist (first run)
        if [ ! -f /etc/ssh/ssh_host_rsa_key ]; then
            sudo ssh-keygen -A
        fi

        # Start sshd (requires root, use sudo)
        sudo /usr/sbin/sshd
        log_info "SSH server started on port 22"
    fi
}

# Set shell preference
configure_shell() {
    local shell="${WORKSPACE_SHELL:-zsh}"

    case "$shell" in
        bash)
            export SHELL=/bin/bash
            ;;
        zsh)
            export SHELL=/bin/zsh
            ;;
        *)
            log_warn "Unknown shell: $shell, defaulting to zsh"
            export SHELL=/bin/zsh
            ;;
    esac
}

# Apply custom environment variables
apply_custom_env() {
    # Source custom environment file if exists in storage
    if [ -f "/mnt/storage/dotfiles/workspace.env" ]; then
        log_info "Loading custom environment from workspace.env"
        set -a
        source /mnt/storage/dotfiles/workspace.env
        set +a
    fi
}

# Main initialization
main() {
    log_info "Starting Podex Workspace..."
    log_info "User: $(whoami) (UID: $(id -u))"
    log_info "Hostname: $(hostname)"
    [ -n "$WORKSPACE_ID" ] && log_info "Workspace ID: $WORKSPACE_ID"

    init_workspace
    configure_git
    configure_ssh
    start_sshd
    configure_shell
    apply_custom_env

    log_info "Workspace initialization complete"

    # Execute the main command
    exec "$@"
}

main "$@"
