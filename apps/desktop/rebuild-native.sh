#!/bin/bash
# Rebuild native modules for Electron

set -e

echo "Rebuilding better-sqlite3 for Electron..."

cd "$(dirname "$0")"

# Get Electron version
ELECTRON_VERSION=$(node -p "require('electron/package.json').version")
echo "Electron version: $ELECTRON_VERSION"

# Rebuild better-sqlite3 for Electron
npx electron-rebuild -f -w better-sqlite3

echo "Rebuild complete!"
