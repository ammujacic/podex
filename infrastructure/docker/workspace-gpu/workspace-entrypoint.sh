#!/bin/bash
# Workspace container entrypoint script
#
# This script initializes the workspace environment by:
# 1. Mounting workspace files directly to /home/dev/projects
# 2. Setting up dotfile symlinks (respecting user preferences)
# 3. Configuring git from environment variables
#
# Environment variables expected:
#   WORKSPACE_ID - Current workspace ID
#   USER_ID - User ID for this workspace
#   GIT_AUTHOR_NAME - Git user name (optional)
#   GIT_AUTHOR_EMAIL - Git email (optional)
#   SYNC_DOTFILES - "true" or "false" (default: true)
#   DOTFILES_PATHS - Comma-separated list of dotfile paths (optional, uses defaults if empty)

set -e

MOUNT_PATH="/mnt/gcs"
HOME_DIR="/home/dev"
DOTFILES_SRC="${MOUNT_PATH}/dotfiles"
WORKSPACE_SRC="${MOUNT_PATH}/workspaces/${WORKSPACE_ID}"

# Default dotfiles if DOTFILES_PATHS not specified
DEFAULT_DOTFILES=(
    ".bashrc"
    ".zshrc"
    ".profile"
    ".gitconfig"
    ".npmrc"
    ".vimrc"
    ".config"
    ".ssh"
    ".claude"
    ".claude.json"
    ".codex"
    ".gemini"
    ".opencode"
)

log() {
    echo "[workspace-init] $1"
}

setup_dotfiles() {
    # Check if dotfiles sync is disabled
    if [[ "${SYNC_DOTFILES}" == "false" ]]; then
        log "Dotfiles sync disabled by user preference"
        return
    fi

    # Determine which dotfiles to sync
    local dotfiles=()
    if [[ -n "${DOTFILES_PATHS}" ]]; then
        # Use user-specified dotfiles (comma-separated)
        IFS=',' read -ra dotfiles <<< "${DOTFILES_PATHS}"
        log "Using user-specified dotfiles: ${DOTFILES_PATHS}"
    else
        # Use defaults
        dotfiles=("${DEFAULT_DOTFILES[@]}")
        log "Using default dotfiles list"
    fi

    # Create dotfiles source directory if needed
    mkdir -p "${DOTFILES_SRC}" 2>/dev/null || true

    # Set up symlinks for each dotfile
    for dotfile in "${dotfiles[@]}"; do
        # Trim whitespace and trailing slashes
        dotfile=$(echo "${dotfile}" | xargs)
        dotfile="${dotfile%/}"
        [[ -z "${dotfile}" ]] && continue

        src="${DOTFILES_SRC}/${dotfile}"
        dest="${HOME_DIR}/${dotfile}"

        # Case 1: Source exists in persistent storage, destination doesn't exist
        # -> Create symlink
        if [[ -e "${src}" && ! -e "${dest}" ]]; then
            ln -s "${src}" "${dest}"
            log "Linked ${dotfile} from persistent storage"
        fi

        # Case 2: Destination exists but is not a symlink, source doesn't exist
        # -> Migrate to persistent storage and create symlink
        if [[ -e "${dest}" && ! -L "${dest}" && ! -e "${src}" ]]; then
            # Create parent directory if needed
            mkdir -p "$(dirname "${src}")" 2>/dev/null || true
            # Move existing file/directory to persistent storage
            mv "${dest}" "${src}"
            ln -s "${src}" "${dest}"
            log "Migrated ${dotfile} to persistent storage"
        fi

        # Case 3: Both exist and dest is not symlink - backup and link
        if [[ -e "${dest}" && ! -L "${dest}" && -e "${src}" ]]; then
            # Backup the container's version, use persistent version
            mv "${dest}" "${dest}.container-backup"
            ln -s "${src}" "${dest}"
            log "Linked ${dotfile} (container version backed up)"
        fi

        # Case 4: Neither exists - nothing to do
    done
}

setup_workspace() {
    if [[ -z "${WORKSPACE_ID}" ]]; then
        log "No WORKSPACE_ID set, skipping workspace mount"
        mkdir -p "${HOME_DIR}/projects"
        return
    fi

    # Create workspace source directory if needed
    mkdir -p "${WORKSPACE_SRC}" 2>/dev/null || true

    # Remove existing projects directory if it's not a symlink
    if [[ -d "${HOME_DIR}/projects" && ! -L "${HOME_DIR}/projects" ]]; then
        # If projects has content, move it to workspace storage
        if [[ "$(ls -A ${HOME_DIR}/projects 2>/dev/null)" ]]; then
            log "Migrating existing projects content to workspace storage"
            cp -r "${HOME_DIR}/projects/"* "${WORKSPACE_SRC}/" 2>/dev/null || true
        fi
        rm -rf "${HOME_DIR}/projects"
    fi

    # Create symlink: /home/dev/projects -> /mnt/gcs/workspaces/{workspace_id}
    ln -sfn "${WORKSPACE_SRC}" "${HOME_DIR}/projects"
    log "Mounted workspace ${WORKSPACE_ID} to ~/projects"
}

# Main initialization
if [[ -d "${MOUNT_PATH}" ]]; then
    log "Persistent storage detected at ${MOUNT_PATH}"

    # Set up dotfiles (respects SYNC_DOTFILES and DOTFILES_PATHS)
    setup_dotfiles

    # Set up workspace mount
    setup_workspace
else
    log "No persistent storage detected, running in standalone mode"
    mkdir -p "${HOME_DIR}/projects"
fi

# Configure git from environment variables if provided
if [[ -n "${GIT_AUTHOR_NAME}" ]]; then
    git config --global user.name "${GIT_AUTHOR_NAME}" 2>/dev/null || true
    log "Set git user.name"
fi

if [[ -n "${GIT_AUTHOR_EMAIL}" ]]; then
    git config --global user.email "${GIT_AUTHOR_EMAIL}" 2>/dev/null || true
    log "Set git user.email"
fi

# Also check for GIT_COMMITTER_* variants
if [[ -n "${GIT_COMMITTER_NAME}" && -z "${GIT_AUTHOR_NAME}" ]]; then
    git config --global user.name "${GIT_COMMITTER_NAME}" 2>/dev/null || true
fi

if [[ -n "${GIT_COMMITTER_EMAIL}" && -z "${GIT_AUTHOR_EMAIL}" ]]; then
    git config --global user.email "${GIT_COMMITTER_EMAIL}" 2>/dev/null || true
fi

# Set proper ownership for home directory contents
# (in case any files were created as root during mount setup)
if [[ "$(id -u)" == "0" ]]; then
    chown -R dev:dev "${HOME_DIR}" 2>/dev/null || true
fi

log "Workspace initialization complete"

# Execute the original command or default to interactive shell
if [[ $# -gt 0 ]]; then
    exec "$@"
else
    exec /bin/zsh
fi
