/**
 * Local Services Manager
 *
 * Manages local development services:
 * - Docker detection and health
 * - Local-pod subprocess management
 * - Ollama detection and bridge
 * - Offline mode orchestration
 */

import { spawn, ChildProcess, exec } from 'child_process';
import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as net from 'net';
import log from 'electron-log/main';
import Store from 'electron-store';

// ============================================
// Types
// ============================================

export interface LocalServicesConfig {
  enabled: boolean;
  podToken: string | null;
  cloudUrl: string;
  maxWorkspaces: number;
  ollamaUrl: string;
  ollamaModel: string;
  ollamaBridgeEnabled: boolean;
  offlineMode: boolean;
  autoStartPod: boolean;
  autoStartOllama: boolean;
}

export interface ServiceStatus {
  docker: 'running' | 'stopped' | 'not_installed' | 'checking';
  localPod: 'running' | 'stopped' | 'error' | 'checking';
  ollama: 'running' | 'stopped' | 'not_installed' | 'checking';
  ollamaBridge: 'running' | 'stopped' | 'error';
  offlineMode: boolean;
}

export interface OllamaModel {
  name: string;
  size: number;
  modified_at: string;
  digest: string;
}

export interface SystemCapabilities {
  os: string;
  arch: string;
  cpuCount: number;
  totalMemoryGB: number;
  dockerVersion: string | null;
  gpuAvailable: boolean;
  gpuInfo: string | null;
}

// ============================================
// Store Schema Extension
// ============================================

interface LocalServicesStoreSchema {
  localServices: LocalServicesConfig;
}

const defaultConfig: LocalServicesConfig = {
  enabled: false,
  podToken: null,
  cloudUrl: 'https://api.podex.dev',
  maxWorkspaces: 3,
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: 'qwen2.5-coder:14b',
  ollamaBridgeEnabled: false,
  offlineMode: false,
  autoStartPod: false,
  autoStartOllama: false,
};

// ============================================
// Local Services Manager Class
// ============================================

export class LocalServicesManager {
  private store: Store<LocalServicesStoreSchema>;
  private mainWindow: BrowserWindow | null = null;
  private localPodProcess: ChildProcess | null = null;
  private ollamaBridgeServer: http.Server | null = null;
  private status: ServiceStatus = {
    docker: 'checking',
    localPod: 'stopped',
    ollama: 'checking',
    ollamaBridge: 'stopped',
    offlineMode: false,
  };
  private statusCheckInterval: NodeJS.Timeout | null = null;

  constructor(store: Store<LocalServicesStoreSchema>) {
    this.store = store;

    // Ensure defaults exist
    if (!this.store.has('localServices')) {
      this.store.set('localServices', defaultConfig);
    }
  }

  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
  }

  // ============================================
  // Configuration
  // ============================================

  getConfig(): LocalServicesConfig {
    return this.store.get('localServices') as LocalServicesConfig;
  }

  setConfig(config: Partial<LocalServicesConfig>): void {
    const current = this.getConfig();
    this.store.set('localServices', { ...current, ...config });
    log.info('Local services config updated', config);
  }

  getStatus(): ServiceStatus {
    return { ...this.status };
  }

  // ============================================
  // Docker Detection
  // ============================================

  async checkDocker(): Promise<{ installed: boolean; running: boolean; version: string | null }> {
    return new Promise((resolve) => {
      exec('docker version --format "{{.Server.Version}}"', (error, stdout) => {
        if (error) {
          // Check if Docker is installed but not running
          exec('which docker || where docker', (whichError) => {
            if (whichError) {
              this.status.docker = 'not_installed';
              resolve({ installed: false, running: false, version: null });
            } else {
              this.status.docker = 'stopped';
              resolve({ installed: true, running: false, version: null });
            }
          });
        } else {
          const version = stdout.trim();
          this.status.docker = 'running';
          resolve({ installed: true, running: true, version });
        }
      });
    });
  }

  // ============================================
  // Ollama Detection & Management
  // ============================================

  async checkOllama(): Promise<{ running: boolean; models: OllamaModel[] }> {
    const config = this.getConfig();

    return new Promise((resolve) => {
      const url = new URL('/api/tags', config.ollamaUrl);

      const request = http.get(url, { timeout: 3000 }, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            this.status.ollama = 'running';
            resolve({ running: true, models: parsed.models || [] });
          } catch {
            this.status.ollama = 'stopped';
            resolve({ running: false, models: [] });
          }
        });
      });

      request.on('error', () => {
        this.status.ollama = 'stopped';
        resolve({ running: false, models: [] });
      });

      request.on('timeout', () => {
        request.destroy();
        this.status.ollama = 'stopped';
        resolve({ running: false, models: [] });
      });
    });
  }

  async startOllama(): Promise<boolean> {
    // Try to start Ollama service
    return new Promise((resolve) => {
      const platform = process.platform;
      let command: string;

      if (platform === 'darwin') {
        // macOS: Try to start via brew services or direct binary
        command = 'open -a Ollama || ollama serve &';
      } else if (platform === 'win32') {
        // Windows: Start Ollama in background
        command = 'start /B ollama serve';
      } else {
        // Linux: Use systemd or direct
        command = 'systemctl --user start ollama || ollama serve &';
      }

      exec(command, (error) => {
        if (error) {
          log.error('Failed to start Ollama', error);
          resolve(false);
        } else {
          log.info('Ollama start command executed');
          // Wait a bit for it to start
          setTimeout(async () => {
            const status = await this.checkOllama();
            resolve(status.running);
          }, 3000);
        }
      });
    });
  }

  async pullOllamaModel(modelName: string): Promise<boolean> {
    const config = this.getConfig();

    return new Promise((resolve) => {
      const url = new URL('/api/pull', config.ollamaUrl);

      const postData = JSON.stringify({ name: modelName, stream: false });

      const options = {
        hostname: url.hostname,
        port: url.port || 11434,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
        },
        timeout: 600000, // 10 minutes for large models
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          resolve(res.statusCode === 200);
        });
      });

      req.on('error', (error) => {
        log.error('Failed to pull Ollama model', error);
        resolve(false);
      });

      req.write(postData);
      req.end();

      // Notify renderer of download progress
      this.mainWindow?.webContents.send('ollama-pull-progress', {
        model: modelName,
        status: 'downloading',
      });
    });
  }

  // ============================================
  // Ollama Bridge (Expose local Ollama to cloud)
  // ============================================

  async startOllamaBridge(
    cloudUrl?: string
  ): Promise<{ success: boolean; bridgeUrl?: string; error?: string }> {
    const config = this.getConfig();

    if (this.ollamaBridgeServer) {
      return { success: true, bridgeUrl: 'Already running' };
    }

    // Create a local proxy server that the cloud can connect to
    // This works by having the Electron app maintain a WebSocket connection to the cloud
    // and proxy Ollama requests through it

    try {
      // For now, create a simple HTTP proxy that can be used locally
      // The full cloud bridge would require WebSocket tunneling

      const proxyPort = await this.findAvailablePort(11435);

      this.ollamaBridgeServer = http.createServer((req, res) => {
        const ollamaUrl = new URL(req.url || '/', config.ollamaUrl);

        const proxyReq = http.request(
          {
            hostname: new URL(config.ollamaUrl).hostname,
            port: new URL(config.ollamaUrl).port || 11434,
            path: ollamaUrl.pathname + ollamaUrl.search,
            method: req.method,
            headers: {
              ...req.headers,
              host: new URL(config.ollamaUrl).host,
            },
          },
          (proxyRes) => {
            res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
            proxyRes.pipe(res);
          }
        );

        proxyReq.on('error', (error) => {
          log.error('Ollama bridge proxy error', error);
          res.writeHead(502);
          res.end('Bad Gateway');
        });

        req.pipe(proxyReq);
      });

      this.ollamaBridgeServer.listen(proxyPort, '0.0.0.0', () => {
        this.status.ollamaBridge = 'running';
        log.info(`Ollama bridge started on port ${proxyPort}`);
      });

      // Register with cloud if URL provided
      if (cloudUrl) {
        await this.registerOllamaBridgeWithCloud(cloudUrl, proxyPort);
      }

      return { success: true, bridgeUrl: `http://localhost:${proxyPort}` };
    } catch (error) {
      log.error('Failed to start Ollama bridge', error);
      return { success: false, error: String(error) };
    }
  }

  async stopOllamaBridge(): Promise<void> {
    if (this.ollamaBridgeServer) {
      this.ollamaBridgeServer.close();
      this.ollamaBridgeServer = null;
      this.status.ollamaBridge = 'stopped';
      log.info('Ollama bridge stopped');
    }
  }

  private async registerOllamaBridgeWithCloud(cloudUrl: string, port: number): Promise<void> {
    // This would register the bridge with the cloud API
    // The cloud would then route Ollama requests through this bridge
    // Implementation depends on the cloud API
    log.info(`Would register Ollama bridge with ${cloudUrl} on port ${port}`);
  }

  // ============================================
  // Local Pod Management
  // ============================================

  async startLocalPod(): Promise<{ success: boolean; error?: string }> {
    const config = this.getConfig();

    if (!config.podToken) {
      return {
        success: false,
        error: 'No pod token configured. Please register a local pod first.',
      };
    }

    if (this.localPodProcess) {
      return { success: true }; // Already running
    }

    // Check Docker first
    const docker = await this.checkDocker();
    if (!docker.running) {
      return { success: false, error: 'Docker is not running. Please start Docker first.' };
    }

    return new Promise((resolve) => {
      // Try to find the local-pod binary or Python module
      const localPodPath = this.findLocalPodExecutable();

      if (!localPodPath) {
        resolve({
          success: false,
          error: 'Local pod executable not found. Please install podex-local-pod.',
        });
        return;
      }

      const args = [
        'start',
        '--token',
        config.podToken,
        '--url',
        config.cloudUrl,
        '--max-workspaces',
        String(config.maxWorkspaces),
      ].filter((arg): arg is string => arg !== null);

      log.info(`Starting local pod: ${localPodPath} ${args.join(' ')}`);

      this.localPodProcess = spawn(localPodPath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: false,
      });

      if (this.localPodProcess) {
        this.localPodProcess.stdout?.on('data', (data) => {
          const message = data.toString();
          log.info(`[local-pod] ${message}`);
          this.mainWindow?.webContents.send('local-pod-log', { level: 'info', message });
        });

        this.localPodProcess.stderr?.on('data', (data) => {
          const message = data.toString();
          log.error(`[local-pod] ${message}`);
          this.mainWindow?.webContents.send('local-pod-log', { level: 'error', message });
        });

        this.localPodProcess.on('error', (error) => {
          log.error('Local pod process error', error);
          this.status.localPod = 'error';
          this.localPodProcess = null;
          this.mainWindow?.webContents.send('local-pod-status', this.status);
        });

        this.localPodProcess.on('exit', (code) => {
          log.info(`Local pod exited with code ${code}`);
          this.status.localPod = 'stopped';
          this.localPodProcess = null;
          this.mainWindow?.webContents.send('local-pod-status', this.status);
        });
      }

      // Wait a bit to see if it starts successfully
      setTimeout(() => {
        if (this.localPodProcess && !this.localPodProcess.killed) {
          this.status.localPod = 'running';
          this.mainWindow?.webContents.send('local-pod-status', this.status);
          resolve({ success: true });
        } else {
          resolve({ success: false, error: 'Local pod failed to start' });
        }
      }, 2000);
    });
  }

  async stopLocalPod(): Promise<void> {
    if (this.localPodProcess) {
      this.localPodProcess.kill('SIGTERM');

      // Force kill after 5 seconds
      setTimeout(() => {
        if (this.localPodProcess && !this.localPodProcess.killed) {
          this.localPodProcess.kill('SIGKILL');
        }
      }, 5000);

      this.localPodProcess = null;
      this.status.localPod = 'stopped';
      log.info('Local pod stopped');
    }
  }

  private findLocalPodExecutable(): string | null {
    // Check common locations
    const possiblePaths = [
      // Installed via pip
      'podex-local-pod',
      // Python module
      'python -m podex_local_pod',
      // Development path
      path.join(
        app.getAppPath(),
        '..',
        '..',
        'services',
        'local-pod',
        'src',
        'podex_local_pod',
        'main.py'
      ),
      // Bundled with app
      path.join(app.getAppPath(), 'local-pod', 'podex-local-pod'),
    ];

    for (const possiblePath of possiblePaths) {
      if (possiblePath.includes(' ')) {
        // It's a command, not a path
        return possiblePath.split(' ')[0]; // Return just the command
      }

      if (fs.existsSync(possiblePath)) {
        return possiblePath;
      }
    }

    // Try which/where
    try {
      const result = require('child_process').execSync(
        'which podex-local-pod 2>/dev/null || where podex-local-pod 2>nul',
        { encoding: 'utf-8' }
      );
      if (result.trim()) {
        return result.trim();
      }
    } catch {
      // Not found
    }

    return null;
  }

  // ============================================
  // Offline Mode
  // ============================================

  async enableOfflineMode(): Promise<{ success: boolean; error?: string }> {
    const config = this.getConfig();

    // Check Ollama is available
    const ollama = await this.checkOllama();
    if (!ollama.running) {
      // Try to start it
      const started = await this.startOllama();
      if (!started) {
        return {
          success: false,
          error: 'Ollama is required for offline mode. Please install and start Ollama.',
        };
      }
    }

    // Check Docker is available
    const docker = await this.checkDocker();
    if (!docker.running) {
      return { success: false, error: 'Docker is required for offline mode. Please start Docker.' };
    }

    // Update config
    this.setConfig({ offlineMode: true });
    this.status.offlineMode = true;

    // Notify renderer
    this.mainWindow?.webContents.send('offline-mode-changed', true);

    log.info('Offline mode enabled');
    return { success: true };
  }

  async disableOfflineMode(): Promise<void> {
    this.setConfig({ offlineMode: false });
    this.status.offlineMode = false;
    this.mainWindow?.webContents.send('offline-mode-changed', false);
    log.info('Offline mode disabled');
  }

  // ============================================
  // System Capabilities Detection
  // ============================================

  async getSystemCapabilities(): Promise<SystemCapabilities> {
    const os = require('os');

    const capabilities: SystemCapabilities = {
      os: process.platform,
      arch: process.arch,
      cpuCount: os.cpus().length,
      totalMemoryGB: Math.round(os.totalmem() / (1024 * 1024 * 1024)),
      dockerVersion: null,
      gpuAvailable: false,
      gpuInfo: null,
    };

    // Check Docker version
    const docker = await this.checkDocker();
    capabilities.dockerVersion = docker.version;

    // Check GPU
    capabilities.gpuAvailable = await this.checkGPU();
    if (capabilities.gpuAvailable) {
      capabilities.gpuInfo = await this.getGPUInfo();
    }

    return capabilities;
  }

  private async checkGPU(): Promise<boolean> {
    return new Promise((resolve) => {
      // Try nvidia-smi for NVIDIA GPUs
      exec('nvidia-smi --query-gpu=name --format=csv,noheader', (error) => {
        if (!error) {
          resolve(true);
          return;
        }

        // Try system_profiler for macOS
        if (process.platform === 'darwin') {
          exec('system_profiler SPDisplaysDataType | grep "Chipset Model"', (macError) => {
            resolve(!macError);
          });
        } else {
          resolve(false);
        }
      });
    });
  }

  private async getGPUInfo(): Promise<string | null> {
    return new Promise((resolve) => {
      if (process.platform === 'darwin') {
        exec('system_profiler SPDisplaysDataType | grep "Chipset Model"', (error, stdout) => {
          resolve(error ? null : stdout.trim());
        });
      } else {
        exec('nvidia-smi --query-gpu=name,memory.total --format=csv,noheader', (error, stdout) => {
          resolve(error ? null : stdout.trim());
        });
      }
    });
  }

  // ============================================
  // Utility Functions
  // ============================================

  private async findAvailablePort(startPort: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = net.createServer();

      server.listen(startPort, () => {
        const { port } = server.address() as net.AddressInfo;
        server.close(() => resolve(port));
      });

      server.on('error', () => {
        // Port in use, try next
        this.findAvailablePort(startPort + 1)
          .then(resolve)
          .catch(reject);
      });
    });
  }

  // ============================================
  // Lifecycle
  // ============================================

  async initialize(): Promise<void> {
    log.info('Initializing local services manager');

    // Start status check interval
    this.statusCheckInterval = setInterval(async () => {
      await this.checkDocker();
      await this.checkOllama();
      this.mainWindow?.webContents.send('local-services-status', this.status);
    }, 30000); // Check every 30 seconds

    // Initial check
    await this.checkDocker();
    await this.checkOllama();

    // Auto-start services if configured
    const config = this.getConfig();

    if (config.enabled && config.autoStartPod && config.podToken) {
      log.info('Auto-starting local pod');
      await this.startLocalPod();
    }

    if (config.enabled && config.autoStartOllama) {
      const ollama = await this.checkOllama();
      if (!ollama.running) {
        log.info('Auto-starting Ollama');
        await this.startOllama();
      }
    }

    if (config.enabled && config.ollamaBridgeEnabled) {
      log.info('Auto-starting Ollama bridge');
      await this.startOllamaBridge(config.cloudUrl);
    }

    log.info('Local services manager initialized', this.status);
  }

  async shutdown(): Promise<void> {
    log.info('Shutting down local services manager');

    if (this.statusCheckInterval) {
      clearInterval(this.statusCheckInterval);
    }

    await this.stopLocalPod();
    await this.stopOllamaBridge();

    log.info('Local services manager shutdown complete');
  }
}

// ============================================
// Singleton Export
// ============================================

let localServicesManager: LocalServicesManager | null = null;

export function initializeLocalServices(
  store: Store<LocalServicesStoreSchema>
): LocalServicesManager {
  if (!localServicesManager) {
    localServicesManager = new LocalServicesManager(store);
  }
  return localServicesManager;
}

export function getLocalServicesManager(): LocalServicesManager | null {
  return localServicesManager;
}
