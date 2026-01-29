#!/bin/bash
# Podex Workspace Entrypoint Script
# Handles workspace initialization, git config sync, and process management.

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

# Initialize workspace directories
init_workspace() {
    log_info "Initializing workspace..."

    # Ensure projects directory exists
    mkdir -p /workspace/projects
    mkdir -p /workspace/.config

    # Link config directories if not already linked
    if [ ! -L "$HOME/.config" ] && [ -d "/workspace/.config" ]; then
        # Backup existing config if any
        if [ -d "$HOME/.config" ]; then
            cp -rn "$HOME/.config/"* /workspace/.config/ 2>/dev/null || true
            rm -rf "$HOME/.config"
        fi
        ln -sf /workspace/.config "$HOME/.config"
    fi
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
    # Source custom environment file if exists
    if [ -f "/workspace/.config/workspace.env" ]; then
        log_info "Loading custom environment from workspace.env"
        set -a
        source /workspace/.config/workspace.env
        set +a
    fi
}

# Main initialization
main() {
    log_info "Starting Podex Workspace..."
    log_info "User: $(whoami) (UID: $(id -u))"
    log_info "Hostname: $(hostname)"

    init_workspace
    configure_git
    configure_ssh
    configure_shell
    apply_custom_env

    log_info "Workspace initialization complete"

    # Execute the main command
    exec "$@"
}

main "$@"
