/**
 * File-based storage adapter for CLI persistence.
 * Stores data in ~/.podex/ directory.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { StorageAdapter } from '@podex/api-client/adapters';

/** Default directory for Podex CLI configuration */
export const PODEX_CONFIG_DIR = path.join(os.homedir(), '.podex');

/**
 * Ensure the config directory exists with proper permissions.
 */
function ensureConfigDir(): void {
  if (!fs.existsSync(PODEX_CONFIG_DIR)) {
    fs.mkdirSync(PODEX_CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
}

/**
 * Get the full path for a config file.
 */
function getConfigPath(filename: string): string {
  return path.join(PODEX_CONFIG_DIR, filename);
}

/**
 * Create a file-based storage adapter.
 * Each key maps to a separate JSON file in ~/.podex/
 */
export function createFileStorageAdapter(): StorageAdapter {
  return {
    getItem(key: string): string | null {
      const filepath = getConfigPath(`${key}.json`);
      try {
        if (!fs.existsSync(filepath)) {
          return null;
        }
        return fs.readFileSync(filepath, 'utf-8');
      } catch {
        return null;
      }
    },

    setItem(key: string, value: string): void {
      ensureConfigDir();
      const filepath = getConfigPath(`${key}.json`);
      fs.writeFileSync(filepath, value, {
        encoding: 'utf-8',
        mode: 0o600, // Owner read/write only for security
      });
    },

    removeItem(key: string): void {
      const filepath = getConfigPath(`${key}.json`);
      try {
        if (fs.existsSync(filepath)) {
          fs.unlinkSync(filepath);
        }
      } catch {
        // Ignore removal errors
      }
    },
  };
}

/**
 * Read a JSON file from the config directory.
 */
export function readConfigFile<T>(filename: string): T | null {
  const filepath = getConfigPath(filename);
  try {
    if (!fs.existsSync(filepath)) {
      return null;
    }
    const content = fs.readFileSync(filepath, 'utf-8');
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

/**
 * Write a JSON file to the config directory.
 */
export function writeConfigFile<T>(filename: string, data: T): void {
  ensureConfigDir();
  const filepath = getConfigPath(filename);
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2), {
    encoding: 'utf-8',
    mode: 0o600,
  });
}

/**
 * Delete a file from the config directory.
 */
export function deleteConfigFile(filename: string): boolean {
  const filepath = getConfigPath(filename);
  try {
    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Check if a config file exists.
 */
export function configFileExists(filename: string): boolean {
  return fs.existsSync(getConfigPath(filename));
}
