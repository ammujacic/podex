#!/bin/bash
# Workspace container health check script
# Returns 0 (healthy) if the workspace is responsive

# Check if init process is running
if [ ! -d /proc/1 ]; then
    echo "Init process not running"
    exit 1
fi

# Check if user can access home directory
if [ ! -d "$HOME" ]; then
    echo "Home directory not accessible"
    exit 1
fi

# Check if workspace directory is accessible
if [ ! -d /workspace ]; then
    echo "Workspace directory not accessible"
    exit 1
fi

# All checks passed
exit 0
