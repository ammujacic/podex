/**
 * Local pod service for managing local pod processes.
 * Wraps @podex/local-pod-discovery and adds spawn capabilities.
 */

import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import { logInfo, logDebug, logError } from '../utils/logger';

/**
 * Local pod process information.
 */
export interface LocalPodProcess {
  pid: number;
  port: number;
  workspacePath: string;
  process?: cp.ChildProcess;
}

/**
 * Options for starting a local pod.
 */
export interface StartPodOptions {
  /** Port to use (defaults to auto-assign) */
  port?: number;
  /** Workspace path (defaults to current workspace) */
  workspacePath?: string;
  /** Display name for the pod */
  name?: string;
}

// Singleton instance
let localPodProcess: LocalPodProcess | null = null;

/**
 * Start a local pod process.
 *
 * @param options Start options
 * @returns The started pod info, or null if failed
 */
export async function startLocalPod(
  options: StartPodOptions = {}
): Promise<LocalPodProcess | null> {
  // Check if already running
  if (localPodProcess) {
    vscode.window.showWarningMessage('Local pod is already running');
    return localPodProcess;
  }

  const workspacePath = options.workspacePath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  if (!workspacePath) {
    vscode.window.showErrorMessage('No workspace folder open');
    return null;
  }

  try {
    logInfo(`Starting local pod for workspace: ${workspacePath}`);

    // Find the local-pod binary
    // First try npx, then global install, then local node_modules
    const podBinary = await findLocalPodBinary();

    if (!podBinary) {
      const action = await vscode.window.showErrorMessage(
        'Local pod binary not found. Would you like to install it?',
        'Install',
        'Cancel'
      );

      if (action === 'Install') {
        await installLocalPod();
        return startLocalPod(options);
      }
      return null;
    }

    // Build command arguments
    const args = ['start'];
    if (options.port) {
      args.push('--port', String(options.port));
    }
    if (options.name) {
      args.push('--name', options.name);
    }

    // Spawn the process
    const child = cp.spawn(podBinary, args, {
      cwd: workspacePath,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
      env: {
        ...process.env,
        PODEX_WORKSPACE: workspacePath,
      },
    });

    // Handle process output
    let port: number | undefined;

    child.stdout?.on('data', (data) => {
      const output = data.toString();
      logDebug(`Local pod stdout: ${output}`);

      // Parse port from output
      const portMatch = output.match(/listening on port (\d+)/i);
      if (portMatch) {
        port = parseInt(portMatch[1], 10);
      }
    });

    child.stderr?.on('data', (data) => {
      logError(`Local pod stderr: ${data.toString()}`);
    });

    child.on('error', (err) => {
      logError('Failed to start local pod', err);
      vscode.window.showErrorMessage(`Failed to start local pod: ${err.message}`);
      localPodProcess = null;
    });

    child.on('exit', (code) => {
      logInfo(`Local pod exited with code: ${code}`);
      localPodProcess = null;
    });

    // Wait a bit for the process to start and report its port
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Try to discover the pod if we didn't get the port from output
    if (!port) {
      try {
        const discovery = await import('@podex/local-pod-discovery');
        const discovered = await discovery.discoverLocalPod();
        if (discovered) {
          port = discovered.port;
        }
      } catch {
        // Discovery not available
      }
    }

    if (!port) {
      port = options.port || 3001; // Default port
    }

    localPodProcess = {
      pid: child.pid!,
      port,
      workspacePath,
      process: child,
    };

    // Unref so the parent can exit independently
    child.unref();

    logInfo(`Local pod started on port ${port} (PID: ${child.pid})`);
    vscode.window.showInformationMessage(`Local pod started on port ${port}`);

    return localPodProcess;
  } catch (error) {
    logError('Failed to start local pod', error);
    vscode.window.showErrorMessage(
      `Failed to start local pod: ${error instanceof Error ? error.message : String(error)}`
    );
    return null;
  }
}

/**
 * Stop the running local pod.
 */
export async function stopLocalPod(): Promise<void> {
  if (!localPodProcess) {
    // Try to find a running pod via discovery
    try {
      const discovery = await import('@podex/local-pod-discovery');
      const pod = await discovery.discoverLocalPod();

      if (pod) {
        logInfo(`Stopping discovered local pod (PID: ${pod.pid})`);
        process.kill(pod.pid, 'SIGTERM');
        vscode.window.showInformationMessage('Local pod stopped');
        return;
      }
    } catch {
      // Discovery not available
    }

    vscode.window.showInformationMessage('No local pod is running');
    return;
  }

  try {
    logInfo(`Stopping local pod (PID: ${localPodProcess.pid})`);

    if (localPodProcess.process) {
      localPodProcess.process.kill('SIGTERM');
    } else {
      process.kill(localPodProcess.pid, 'SIGTERM');
    }

    localPodProcess = null;
    vscode.window.showInformationMessage('Local pod stopped');
  } catch (error) {
    logError('Failed to stop local pod', error);
    vscode.window.showErrorMessage(
      `Failed to stop local pod: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Get the running local pod process.
 */
export function getLocalPodProcess(): LocalPodProcess | null {
  return localPodProcess;
}

/**
 * Check if a local pod is running.
 */
export async function isLocalPodRunning(): Promise<boolean> {
  if (localPodProcess) {
    return true;
  }

  try {
    const discovery = await import('@podex/local-pod-discovery');
    const pod = await discovery.discoverLocalPod();
    return pod !== null;
  } catch {
    return false;
  }
}

/**
 * Find the local-pod binary.
 */
async function findLocalPodBinary(): Promise<string | null> {
  // Check for npx availability
  try {
    await execPromise('npx --version');
    return 'npx @podex/local-pod';
  } catch {
    // npx not available
  }

  // Check global install
  try {
    await execPromise('podex-local-pod --version');
    return 'podex-local-pod';
  } catch {
    // Not installed globally
  }

  // Check local node_modules
  const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (workspacePath) {
    const localBinary = path.join(workspacePath, 'node_modules', '.bin', 'podex-local-pod');
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(localBinary));
      return localBinary;
    } catch {
      // Not found locally
    }
  }

  return null;
}

/**
 * Install local pod package.
 */
async function installLocalPod(): Promise<void> {
  const terminal = vscode.window.createTerminal('Podex Install');
  terminal.show();
  terminal.sendText('npm install -g @podex/local-pod');
}

/**
 * Execute a command and return a promise.
 */
function execPromise(command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    cp.exec(command, (error, stdout) => {
      if (error) {
        reject(error);
      } else {
        resolve(stdout);
      }
    });
  });
}
