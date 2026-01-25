/**
 * Docker Manager
 *
 * Handles Docker detection, health monitoring, and guidance for installation.
 */

import { exec, spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
import log from 'electron-log/main';
import { EventEmitter } from 'events';

const execAsync = promisify(exec);

export type DockerStatus = 'running' | 'stopped' | 'not_installed' | 'checking' | 'error';

export interface DockerInfo {
  status: DockerStatus;
  version: string | null;
  apiVersion: string | null;
  platform: string | null;
  containers: {
    running: number;
    paused: number;
    stopped: number;
  };
  images: number;
  memoryLimit: number | null;
  cpuLimit: number | null;
}

export interface DockerInstallGuide {
  platform: NodeJS.Platform;
  name: string;
  downloadUrl: string;
  instructions: string[];
}

export class DockerManager extends EventEmitter {
  private status: DockerStatus = 'checking';
  private info: DockerInfo | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private readonly HEALTH_CHECK_INTERVAL = 30000; // 30 seconds

  constructor() {
    super();
  }

  /**
   * Get installation guide for current platform
   */
  getInstallGuide(): DockerInstallGuide {
    const platform = process.platform;

    const guides: Record<string, DockerInstallGuide> = {
      darwin: {
        platform: 'darwin',
        name: 'Docker Desktop for Mac',
        downloadUrl: 'https://www.docker.com/products/docker-desktop/',
        instructions: [
          '1. Download Docker Desktop from the link above',
          '2. Open the .dmg file and drag Docker to Applications',
          '3. Launch Docker from Applications',
          '4. Complete the setup wizard',
          '5. Docker icon will appear in menu bar when ready',
        ],
      },
      win32: {
        platform: 'win32',
        name: 'Docker Desktop for Windows',
        downloadUrl: 'https://www.docker.com/products/docker-desktop/',
        instructions: [
          '1. Download Docker Desktop from the link above',
          '2. Run the installer (requires admin privileges)',
          '3. Enable WSL 2 if prompted',
          '4. Restart your computer if required',
          '5. Launch Docker Desktop from Start Menu',
          '6. Docker icon will appear in system tray when ready',
        ],
      },
      linux: {
        platform: 'linux',
        name: 'Docker Engine',
        downloadUrl: 'https://docs.docker.com/engine/install/',
        instructions: [
          '1. Visit the Docker installation docs for your distro',
          '2. For Ubuntu/Debian:',
          '   curl -fsSL https://get.docker.com | sh',
          '3. Add your user to docker group:',
          '   sudo usermod -aG docker $USER',
          '4. Log out and back in',
          '5. Verify with: docker run hello-world',
        ],
      },
    };

    return guides[platform] || guides.linux;
  }

  /**
   * Check if Docker is installed
   */
  async isInstalled(): Promise<boolean> {
    try {
      const cmd = process.platform === 'win32' ? 'where docker' : 'which docker';
      await execAsync(cmd);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if Docker daemon is running
   */
  async isRunning(): Promise<boolean> {
    try {
      await execAsync('docker info', { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get Docker version
   */
  async getVersion(): Promise<string | null> {
    try {
      const { stdout } = await execAsync('docker version --format "{{.Server.Version}}"', {
        timeout: 5000,
      });
      return stdout.trim();
    } catch {
      return null;
    }
  }

  /**
   * Get detailed Docker info
   */
  async getInfo(): Promise<DockerInfo> {
    const info: DockerInfo = {
      status: 'checking',
      version: null,
      apiVersion: null,
      platform: null,
      containers: { running: 0, paused: 0, stopped: 0 },
      images: 0,
      memoryLimit: null,
      cpuLimit: null,
    };

    // Check if installed
    const installed = await this.isInstalled();
    if (!installed) {
      info.status = 'not_installed';
      this.status = 'not_installed';
      this.info = info;
      return info;
    }

    // Check if running
    const running = await this.isRunning();
    if (!running) {
      info.status = 'stopped';
      this.status = 'stopped';
      this.info = info;
      return info;
    }

    try {
      // Get detailed info
      const { stdout } = await execAsync('docker info --format "{{json .}}"', { timeout: 10000 });
      const dockerInfo = JSON.parse(stdout);

      info.status = 'running';
      info.version = dockerInfo.ServerVersion || null;
      info.apiVersion = dockerInfo.APIVersion || null;
      info.platform = dockerInfo.OSType || null;
      info.containers = {
        running: dockerInfo.ContainersRunning || 0,
        paused: dockerInfo.ContainersPaused || 0,
        stopped: dockerInfo.ContainersStopped || 0,
      };
      info.images = dockerInfo.Images || 0;
      info.memoryLimit = dockerInfo.MemTotal || null;
      info.cpuLimit = dockerInfo.NCPU || null;

      this.status = 'running';
      this.info = info;
    } catch (error) {
      log.error('Failed to get Docker info:', error);
      info.status = 'error';
      this.status = 'error';
      this.info = info;
    }

    return info;
  }

  /**
   * Get current status
   */
  getStatus(): DockerStatus {
    return this.status;
  }

  /**
   * Get cached info
   */
  getCachedInfo(): DockerInfo | null {
    return this.info;
  }

  /**
   * Start Docker Desktop (macOS/Windows only)
   */
  async startDocker(): Promise<boolean> {
    const platform = process.platform;

    try {
      if (platform === 'darwin') {
        await execAsync('open -a Docker');
        log.info('Started Docker Desktop on macOS');
      } else if (platform === 'win32') {
        await execAsync('start "" "C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe"');
        log.info('Started Docker Desktop on Windows');
      } else {
        // Linux: try systemd
        await execAsync('systemctl --user start docker || sudo systemctl start docker');
        log.info('Started Docker on Linux');
      }

      // Wait for Docker to be ready
      return await this.waitForDocker(60000); // 60 second timeout
    } catch (error) {
      log.error('Failed to start Docker:', error);
      return false;
    }
  }

  /**
   * Wait for Docker to be ready
   */
  async waitForDocker(timeout: number = 30000): Promise<boolean> {
    const startTime = Date.now();
    const checkInterval = 2000;

    while (Date.now() - startTime < timeout) {
      const running = await this.isRunning();
      if (running) {
        await this.getInfo();
        this.emit('status-changed', this.status);
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, checkInterval));
    }

    return false;
  }

  /**
   * Pull a Docker image
   */
  async pullImage(imageName: string, onProgress?: (progress: string) => void): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn('docker', ['pull', imageName]);

      proc.stdout.on('data', (data) => {
        const line = data.toString().trim();
        if (line && onProgress) {
          onProgress(line);
        }
      });

      proc.stderr.on('data', (data) => {
        const line = data.toString().trim();
        if (line && onProgress) {
          onProgress(line);
        }
      });

      proc.on('close', (code) => {
        resolve(code === 0);
      });

      proc.on('error', (error) => {
        log.error(`Failed to pull image ${imageName}:`, error);
        resolve(false);
      });
    });
  }

  /**
   * Check if an image exists locally
   */
  async hasImage(imageName: string): Promise<boolean> {
    try {
      await execAsync(`docker image inspect ${imageName}`, { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List running containers
   */
  async listContainers(
    filterLabel?: string
  ): Promise<Array<{ id: string; name: string; image: string; status: string }>> {
    try {
      const filter = filterLabel ? `--filter "label=${filterLabel}"` : '';
      const { stdout } = await execAsync(`docker ps ${filter} --format "{{json .}}"`, {
        timeout: 10000,
      });

      const lines = stdout.trim().split('\n').filter(Boolean);
      return lines.map((line) => {
        const container = JSON.parse(line);
        return {
          id: container.ID,
          name: container.Names,
          image: container.Image,
          status: container.Status,
        };
      });
    } catch (error) {
      log.error('Failed to list containers:', error);
      return [];
    }
  }

  /**
   * Start health check interval
   */
  startHealthCheck(): void {
    if (this.healthCheckInterval) {
      return;
    }

    // Initial check
    this.getInfo().then(() => {
      this.emit('status-changed', this.status);
    });

    // Periodic checks
    this.healthCheckInterval = setInterval(async () => {
      const previousStatus = this.status;
      await this.getInfo();

      if (this.status !== previousStatus) {
        log.info(`Docker status changed: ${previousStatus} -> ${this.status}`);
        this.emit('status-changed', this.status);
      }
    }, this.HEALTH_CHECK_INTERVAL);

    log.info('Docker health check started');
  }

  /**
   * Stop health check interval
   */
  stopHealthCheck(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
      log.info('Docker health check stopped');
    }
  }

  /**
   * Clean up resources
   */
  shutdown(): void {
    this.stopHealthCheck();
    this.removeAllListeners();
  }
}

// Singleton instance
let dockerManager: DockerManager | null = null;

export function getDockerManager(): DockerManager {
  if (!dockerManager) {
    dockerManager = new DockerManager();
  }
  return dockerManager;
}
