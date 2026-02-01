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

    # Set up credential helper - use store for persistent credentials
    git config --global credential.helper store

    # If GITHUB_TOKEN is set, configure credentials for github.com
    # This allows git push/pull to work without re-authentication
    if [ -n "$GITHUB_TOKEN" ]; then
        log_info "Configuring GitHub credentials for git operations"
        # Extract username from GIT_CREDENTIALS if available, otherwise use 'x-access-token'
        if [ -n "$GIT_CREDENTIALS" ]; then
            github_user="${GIT_CREDENTIALS%%:*}"
        else
            github_user="x-access-token"
        fi
        # Write credentials to git credential store
        echo "https://${github_user}:${GITHUB_TOKEN}@github.com" >> "$HOME/.git-credentials"
        chmod 600 "$HOME/.git-credentials"
    fi

    # Safe directory config for mounted volumes
    git config --global --add safe.directory '*'
}

# Clone git repositories from GIT_REPOS environment variable
clone_repos() {
    if [ -z "$GIT_REPOS" ]; then
        log_info "No GIT_REPOS specified, skipping clone"
        return 0
    fi

    log_info "Cloning repositories..."

    # Split comma-separated repos
    IFS=',' read -ra REPOS <<< "$GIT_REPOS"

    for repo_url in "${REPOS[@]}"; do
        # Trim whitespace
        repo_url=$(echo "$repo_url" | xargs)

        if [ -z "$repo_url" ]; then
            continue
        fi

        # Extract repo name from URL (handles both HTTPS and SSH URLs)
        # Examples:
        #   https://github.com/user/repo.git -> repo
        #   git@github.com:user/repo.git -> repo
        repo_name=$(basename "$repo_url" .git)

        target_dir="$HOME/projects/$repo_name"

        # Skip if already cloned - don't touch existing repos to preserve user's work
        if [ -d "$target_dir/.git" ]; then
            log_info "Repository already exists: $target_dir (preserving user's work)"
            continue
        fi

        # Build clone URL with credentials if provided (for HTTPS URLs)
        clone_url="$repo_url"
        if [ -n "$GIT_CREDENTIALS" ]; then
            # Only inject credentials for HTTPS URLs
            if [[ "$repo_url" == https://* ]]; then
                # Extract host and path from URL
                # https://github.com/user/repo.git -> github.com/user/repo.git
                url_without_scheme="${repo_url#https://}"
                clone_url="https://$GIT_CREDENTIALS@$url_without_scheme"
                log_info "Cloning (with credentials): $repo_url -> $target_dir"
            else
                log_info "Cloning: $repo_url -> $target_dir"
            fi
        else
            log_info "Cloning: $repo_url -> $target_dir"
        fi

        # Clone the repository
        if git clone "$clone_url" "$target_dir" 2>&1; then
            log_info "Successfully cloned: $repo_name"

            # Checkout specific branch if specified
            if [ -n "$GIT_BRANCH" ]; then
                log_info "Checking out branch: $GIT_BRANCH"
                cd "$target_dir"
                git checkout "$GIT_BRANCH" 2>/dev/null || git checkout -b "$GIT_BRANCH" "origin/$GIT_BRANCH" 2>/dev/null || log_warn "Could not checkout branch $GIT_BRANCH"
                cd - > /dev/null
            fi
        else
            log_error "Failed to clone: $repo_url"
        fi
    done

    log_info "Repository cloning complete"
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
    clone_repos
    start_sshd
    configure_shell
    apply_custom_env

    log_info "Workspace initialization complete"

    # Execute the main command
    exec "$@"
}

main "$@"
