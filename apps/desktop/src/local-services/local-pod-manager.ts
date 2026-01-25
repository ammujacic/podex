/**
 * Local Pod Manager
 *
 * Manages the bundled local-pod binary for running workspaces locally.
 */

import { spawn, ChildProcess, exec } from 'child_process';
import { promisify } from 'util';
import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import log from 'electron-log/main';
import { EventEmitter } from 'events';
import Store from 'electron-store';

const execAsync = promisify(exec);

export type LocalPodStatus = 'running' | 'stopped' | 'starting' | 'stopping' | 'error';

export interface LocalPodConfig {
  enabled: boolean;
  podToken: string | null;
  podName: string;
  cloudUrl: string;
  maxWorkspaces: number;
  autoStart: boolean;
}

export interface LocalPodInfo {
  status: LocalPodStatus;
  pid: number | null;
  startedAt: number | null;
  activeWorkspaces: number;
  lastError: string | null;
  connectedToCloud: boolean;
}

export interface LocalPodLogEntry {
  timestamp: number;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
}

const DEFAULT_CONFIG: LocalPodConfig = {
  enabled: false,
  podToken: null,
  podName: '',
  cloudUrl: 'https://api.podex.dev',
  maxWorkspaces: 3,
  autoStart: false,
};

export class LocalPodManager extends EventEmitter {
  private store: Store;
  private process: ChildProcess | null = null;
  private status: LocalPodStatus = 'stopped';
  private info: LocalPodInfo = {
    status: 'stopped',
    pid: null,
    startedAt: null,
    activeWorkspaces: 0,
    lastError: null,
    connectedToCloud: false,
  };
  private logBuffer: LocalPodLogEntry[] = [];
  private readonly MAX_LOG_ENTRIES = 1000;
  private reconnectAttempts = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 5;

  constructor(store: Store) {
    super();
    this.store = store;

    // Ensure default config exists
    if (!this.store.has('localPod')) {
      this.store.set('localPod', DEFAULT_CONFIG);
    }

    // Set default pod name to hostname
    const config = this.getConfig();
    if (!config.podName) {
      const os = require('os');
      this.updateConfig({ podName: os.hostname() });
    }
  }

  /**
   * Get local pod configuration
   */
  getConfig(): LocalPodConfig {
    return (this.store.get('localPod') as LocalPodConfig) || DEFAULT_CONFIG;
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<LocalPodConfig>): void {
    const current = this.getConfig();
    this.store.set('localPod', { ...current, ...updates });
    log.info('Local pod config updated:', updates);
  }

  /**
   * Get current status
   */
  getStatus(): LocalPodStatus {
    return this.status;
  }

  /**
   * Get detailed info
   */
  getInfo(): LocalPodInfo {
    return { ...this.info };
  }

  /**
   * Get recent logs
   */
  getLogs(limit: number = 100): LocalPodLogEntry[] {
    return this.logBuffer.slice(-limit);
  }

  /**
   * Find the bundled local-pod binary path
   */
  getBinaryPath(): string | null {
    const platform = process.platform;
    const arch = process.arch;
    const platformArch = `${platform}-${arch}`;

    // Paths to check (in order of preference)
    const paths = [
      // Bundled in production app
      path.join(process.resourcesPath || '', 'local-pod', platformArch, 'podex-local-pod'),
      path.join(process.resourcesPath || '', 'local-pod', platformArch, 'podex-local-pod.exe'),

      // Development: check relative to app
      path.join(app.getAppPath(), '..', 'resources', 'local-pod', platformArch, 'podex-local-pod'),
      path.join(
        app.getAppPath(),
        '..',
        'resources',
        'local-pod',
        platformArch,
        'podex-local-pod.exe'
      ),

      // Development: check in project structure
      path.join(
        app.getAppPath(),
        '..',
        '..',
        '..',
        'services',
        'local-pod',
        'dist',
        'podex-local-pod'
      ),
    ];

    for (const binaryPath of paths) {
      if (fs.existsSync(binaryPath)) {
        log.info(`Found local-pod binary at: ${binaryPath}`);
        return binaryPath;
      }
    }

    log.warn('Local-pod binary not found in any expected location');
    return null;
  }

  /**
   * Check if local-pod is available (either bundled or installed via pip)
   */
  async isAvailable(): Promise<{ available: boolean; source: 'bundled' | 'pip' | 'none' }> {
    // Check bundled binary
    const bundledPath = this.getBinaryPath();
    if (bundledPath) {
      return { available: true, source: 'bundled' };
    }

    // Check pip installation
    try {
      await execAsync('podex-local-pod --version', { timeout: 5000 });
      return { available: true, source: 'pip' };
    } catch {
      // Not installed
    }

    return { available: false, source: 'none' };
  }

  /**
   * Start the local pod
   */
  async start(): Promise<{ success: boolean; error?: string }> {
    const config = this.getConfig();

    // Validate config
    if (!config.podToken) {
      return {
        success: false,
        error: 'No pod token configured. Please register a local pod first.',
      };
    }

    if (this.process && this.status === 'running') {
      return { success: true }; // Already running
    }

    this.status = 'starting';
    this.info.status = 'starting';
    this.info.lastError = null;
    this.emit('status-changed', this.status);

    // Find binary
    const availability = await this.isAvailable();
    if (!availability.available) {
      const error = 'Local pod binary not found. Please reinstall the application.';
      this.setError(error);
      return { success: false, error };
    }

    const binaryPath =
      availability.source === 'bundled' ? this.getBinaryPath()! : 'podex-local-pod';

    // Build arguments
    const args = [
      'start',
      '--token',
      config.podToken,
      '--url',
      config.cloudUrl,
      '--name',
      config.podName,
      '--max-workspaces',
      String(config.maxWorkspaces),
      '--json-logs', // Structured logging for parsing
    ];

    log.info(`Starting local pod: ${binaryPath} ${args.join(' ')}`);

    return new Promise((resolve) => {
      try {
        this.process = spawn(binaryPath, args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          detached: false,
          env: {
            ...process.env,
            PYTHONUNBUFFERED: '1', // Ensure immediate output
          },
        });

        this.info.pid = this.process.pid || null;
        this.info.startedAt = Date.now();

        // Handle stdout
        this.process.stdout?.on('data', (data) => {
          const lines = data.toString().split('\n').filter(Boolean);
          for (const line of lines) {
            this.handleLogLine(line);
          }
        });

        // Handle stderr
        this.process.stderr?.on('data', (data) => {
          const lines = data.toString().split('\n').filter(Boolean);
          for (const line of lines) {
            this.handleLogLine(line, 'error');
          }
        });

        // Handle process errors
        this.process.on('error', (error) => {
          log.error('Local pod process error:', error);
          this.setError(error.message);
          this.process = null;
          resolve({ success: false, error: error.message });
        });

        // Handle process exit
        this.process.on('exit', (code, signal) => {
          log.info(`Local pod exited with code ${code}, signal ${signal}`);

          const wasRunning = this.status === 'running';
          this.status = 'stopped';
          this.info.status = 'stopped';
          this.info.pid = null;
          this.info.connectedToCloud = false;
          this.process = null;

          this.emit('status-changed', this.status);
          this.emit('stopped', { code, signal });

          // Auto-restart if it crashed unexpectedly
          if (
            wasRunning &&
            code !== 0 &&
            signal !== 'SIGTERM' &&
            this.reconnectAttempts < this.MAX_RECONNECT_ATTEMPTS
          ) {
            this.reconnectAttempts++;
            log.info(
              `Attempting to restart local pod (attempt ${this.reconnectAttempts}/${this.MAX_RECONNECT_ATTEMPTS})`
            );
            setTimeout(() => this.start(), 5000 * this.reconnectAttempts);
          }
        });

        // Wait for connection confirmation or timeout
        const connectionTimeout = setTimeout(() => {
          if (this.status === 'starting') {
            // Assume running if process is alive
            if (this.process && !this.process.killed) {
              this.status = 'running';
              this.info.status = 'running';
              this.emit('status-changed', this.status);
              resolve({ success: true });
            } else {
              const error = 'Local pod failed to start within timeout';
              this.setError(error);
              resolve({ success: false, error });
            }
          }
        }, 10000);

        // Listen for successful connection
        this.once('connected', () => {
          clearTimeout(connectionTimeout);
          this.status = 'running';
          this.info.status = 'running';
          this.info.connectedToCloud = true;
          this.reconnectAttempts = 0;
          this.emit('status-changed', this.status);
          resolve({ success: true });
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.setError(errorMessage);
        resolve({ success: false, error: errorMessage });
      }
    });
  }

  /**
   * Stop the local pod
   */
  async stop(): Promise<void> {
    if (!this.process) {
      return;
    }

    this.status = 'stopping';
    this.info.status = 'stopping';
    this.emit('status-changed', this.status);

    return new Promise((resolve) => {
      if (!this.process) {
        resolve();
        return;
      }

      // Set up timeout for force kill
      const forceKillTimeout = setTimeout(() => {
        if (this.process && !this.process.killed) {
          log.warn('Force killing local pod process');
          this.process.kill('SIGKILL');
        }
      }, 5000);

      // Listen for exit
      this.process.once('exit', () => {
        clearTimeout(forceKillTimeout);
        this.status = 'stopped';
        this.info.status = 'stopped';
        this.info.pid = null;
        this.info.connectedToCloud = false;
        this.emit('status-changed', this.status);
        resolve();
      });

      // Send graceful shutdown signal
      this.process.kill('SIGTERM');
      log.info('Sent SIGTERM to local pod process');
    });
  }

  /**
   * Restart the local pod
   */
  async restart(): Promise<{ success: boolean; error?: string }> {
    await this.stop();
    return this.start();
  }

  /**
   * Handle log line from process
   */
  private handleLogLine(line: string, defaultLevel: 'info' | 'error' = 'info'): void {
    let entry: LocalPodLogEntry;

    try {
      // Try to parse JSON logs
      const parsed = JSON.parse(line);
      entry = {
        timestamp: parsed.timestamp || Date.now(),
        level: parsed.level || defaultLevel,
        message: parsed.message || parsed.msg || line,
      };

      // Check for special events
      if (parsed.event === 'connected' || parsed.message?.includes('Connected to cloud')) {
        this.emit('connected');
      }

      if (parsed.event === 'workspace_created' || parsed.workspaces !== undefined) {
        this.info.activeWorkspaces = parsed.workspaces || this.info.activeWorkspaces;
        this.emit('workspaces-changed', this.info.activeWorkspaces);
      }
    } catch {
      // Plain text log
      entry = {
        timestamp: Date.now(),
        level: defaultLevel,
        message: line,
      };

      // Check for connection message in plain text
      if (line.toLowerCase().includes('connected')) {
        this.emit('connected');
      }
    }

    // Add to buffer
    this.logBuffer.push(entry);
    if (this.logBuffer.length > this.MAX_LOG_ENTRIES) {
      this.logBuffer.shift();
    }

    // Emit log event
    this.emit('log', entry);

    // Also log to electron-log
    const logFn = entry.level === 'error' ? log.error : log.info;
    logFn(`[local-pod] ${entry.message}`);
  }

  /**
   * Set error state
   */
  private setError(error: string): void {
    this.status = 'error';
    this.info.status = 'error';
    this.info.lastError = error;
    this.emit('status-changed', this.status);
    this.emit('error', error);
    log.error(`Local pod error: ${error}`);
  }

  /**
   * Register a new local pod with the cloud
   */
  async registerPod(
    podName: string
  ): Promise<{ success: boolean; token?: string; error?: string }> {
    // This would call the cloud API to register a new pod
    // For now, return a placeholder - the actual implementation
    // will call the API service

    log.info(`Registering local pod: ${podName}`);

    // The token will be fetched from the API
    // This is a placeholder for the integration
    return {
      success: false,
      error: 'Registration requires API integration. Please use the web UI to register a pod.',
    };
  }

  /**
   * Clean up resources
   */
  async shutdown(): Promise<void> {
    await this.stop();
    this.removeAllListeners();
    log.info('Local pod manager shutdown complete');
  }
}

// Singleton instance
let localPodManager: LocalPodManager | null = null;

export function initializeLocalPodManager(store: Store): LocalPodManager {
  if (!localPodManager) {
    localPodManager = new LocalPodManager(store);
  }
  return localPodManager;
}

export function getLocalPodManager(): LocalPodManager | null {
  return localPodManager;
}
