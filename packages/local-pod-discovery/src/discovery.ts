/**
 * Local pod discovery utilities.
 * Finds and manages running local-pod processes on the user's machine.
 *
 * Used by VSCode extension and CLI to discover running local pods
 * without having to spawn a new process.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as net from 'net';

// ============================================================================
// Types
// ============================================================================

/**
 * Information about a running local pod instance.
 */
export interface LocalPodInfo {
  /** Process ID of the running local-pod */
  pid: number;
  /** Port the local pod is listening on */
  port: number;
  /** Workspace path the pod is serving */
  workspacePath: string;
  /** When the pod was started */
  startedAt: Date;
  /** Optional display name */
  name?: string;
}

/**
 * Options for discovering local pods.
 */
export interface DiscoveryOptions {
  /** Custom path to PID file (defaults to ~/.podex/local-pod.pid) */
  pidFilePath?: string;
  /** Timeout for port reachability check in ms (default: 1000) */
  timeout?: number;
}

// ============================================================================
// Constants
// ============================================================================

/** Default path to the local-pod PID file */
export const DEFAULT_PID_FILE = path.join(os.homedir(), '.podex', 'local-pod.pid');

/** Default directory for Podex configuration */
export const PODEX_CONFIG_DIR = path.join(os.homedir(), '.podex');

// ============================================================================
// Discovery Functions
// ============================================================================

/**
 * Discover a running local pod instance.
 * Checks the PID file, verifies the process is running, and tests port connectivity.
 *
 * @param options Discovery options
 * @returns LocalPodInfo if found, null otherwise
 */
export async function discoverLocalPod(
  options: DiscoveryOptions = {}
): Promise<LocalPodInfo | null> {
  const pidFilePath = options.pidFilePath ?? DEFAULT_PID_FILE;
  const timeout = options.timeout ?? 1000;

  // Check if PID file exists
  if (!fs.existsSync(pidFilePath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(pidFilePath, 'utf-8');
    const info = JSON.parse(content) as {
      pid: number;
      port: number;
      workspacePath: string;
      startedAt: string;
      name?: string;
    };

    // Verify process is still running
    if (!isProcessRunning(info.pid)) {
      // Clean up stale PID file
      try {
        fs.unlinkSync(pidFilePath);
      } catch {
        // Ignore cleanup errors
      }
      return null;
    }

    // Verify port is reachable
    const reachable = await isPortReachable(info.port, timeout);
    if (!reachable) {
      return null;
    }

    return {
      pid: info.pid,
      port: info.port,
      workspacePath: info.workspacePath,
      startedAt: new Date(info.startedAt),
      name: info.name,
    };
  } catch {
    return null;
  }
}

/**
 * Discover all running local pods.
 * Scans the Podex config directory for multiple pod instances.
 *
 * @param options Discovery options
 * @returns Array of discovered local pods
 */
export async function discoverAllLocalPods(
  options: DiscoveryOptions = {}
): Promise<LocalPodInfo[]> {
  const configDir = options.pidFilePath ? path.dirname(options.pidFilePath) : PODEX_CONFIG_DIR;
  const pods: LocalPodInfo[] = [];

  // Check main PID file
  const mainPod = await discoverLocalPod(options);
  if (mainPod) {
    pods.push(mainPod);
  }

  // Check for additional pod PID files (local-pod-*.pid pattern)
  try {
    const files = fs.readdirSync(configDir);
    for (const file of files) {
      if (file.startsWith('local-pod-') && file.endsWith('.pid') && file !== 'local-pod.pid') {
        const podInfo = await discoverLocalPod({
          ...options,
          pidFilePath: path.join(configDir, file),
        });
        if (podInfo) {
          pods.push(podInfo);
        }
      }
    }
  } catch {
    // Config directory doesn't exist or isn't readable
  }

  return pods;
}

/**
 * Wait for a local pod to become available.
 * Polls until the pod is discovered or timeout is reached.
 *
 * @param options Discovery options
 * @param maxWaitMs Maximum time to wait in milliseconds (default: 30000)
 * @param pollIntervalMs Interval between polls in milliseconds (default: 500)
 * @returns LocalPodInfo if found within timeout, null otherwise
 */
export async function waitForLocalPod(
  options: DiscoveryOptions = {},
  maxWaitMs: number = 30000,
  pollIntervalMs: number = 500
): Promise<LocalPodInfo | null> {
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    const pod = await discoverLocalPod(options);
    if (pod) {
      return pod;
    }
    await sleep(pollIntervalMs);
  }

  return null;
}

// ============================================================================
// PID File Management
// ============================================================================

/**
 * Write local pod info to the PID file.
 * Used by the local-pod process itself to register its presence.
 *
 * @param info Pod information to write
 * @param pidFilePath Path to PID file (defaults to DEFAULT_PID_FILE)
 */
export function writePodInfo(info: Omit<LocalPodInfo, 'startedAt'>, pidFilePath?: string): void {
  const filePath = pidFilePath ?? DEFAULT_PID_FILE;
  const dir = path.dirname(filePath);

  // Ensure directory exists
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const content = JSON.stringify({
    pid: info.pid,
    port: info.port,
    workspacePath: info.workspacePath,
    name: info.name,
    startedAt: new Date().toISOString(),
  });

  fs.writeFileSync(filePath, content, 'utf-8');
}

/**
 * Remove the PID file.
 * Called when the local-pod process exits cleanly.
 *
 * @param pidFilePath Path to PID file (defaults to DEFAULT_PID_FILE)
 */
export function removePodInfo(pidFilePath?: string): void {
  const filePath = pidFilePath ?? DEFAULT_PID_FILE;
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // Ignore removal errors
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if a process is running by PID.
 * Uses the Unix "kill -0" trick which doesn't actually send a signal.
 */
export function isProcessRunning(pid: number): boolean {
  try {
    // kill(0) checks if process exists without sending a signal
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a port is reachable on localhost.
 */
export function isPortReachable(port: number, timeout: number = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();

    socket.setTimeout(timeout);

    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });

    socket.on('error', () => {
      socket.destroy();
      resolve(false);
    });

    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });

    socket.connect(port, '127.0.0.1');
  });
}

/**
 * Get the local pod API URL if a pod is running.
 */
export async function getLocalPodUrl(options: DiscoveryOptions = {}): Promise<string | null> {
  const pod = await discoverLocalPod(options);
  if (!pod) return null;
  return `http://127.0.0.1:${pod.port}`;
}

/**
 * Sleep for a specified number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
