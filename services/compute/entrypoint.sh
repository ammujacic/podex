#!/bin/bash
set -e

# Fix SSH key permissions if mounted
if [ -d /home/appuser/.ssh-mount ]; then
    mkdir -p /home/appuser/.ssh

    # Copy SSH key if it exists
    if [ -f /home/appuser/.ssh-mount/id_ed25519 ]; then
        cp /home/appuser/.ssh-mount/id_ed25519 /home/appuser/.ssh/id_ed25519
        chmod 600 /home/appuser/.ssh/id_ed25519
    fi

    # Copy public key if it exists
    if [ -f /home/appuser/.ssh-mount/id_ed25519.pub ]; then
        cp /home/appuser/.ssh-mount/id_ed25519.pub /home/appuser/.ssh/id_ed25519.pub
        chmod 644 /home/appuser/.ssh/id_ed25519.pub
    fi

    # Copy known_hosts if it exists
    if [ -f /home/appuser/.ssh-mount/known_hosts ]; then
        cp /home/appuser/.ssh-mount/known_hosts /home/appuser/.ssh/known_hosts
        chmod 644 /home/appuser/.ssh/known_hosts
    fi

    # Set directory permissions and ownership
    chmod 700 /home/appuser/.ssh
    chown -R appuser:appuser /home/appuser/.ssh
fi

# Run the main command as appuser
exec gosu appuser "$@"
