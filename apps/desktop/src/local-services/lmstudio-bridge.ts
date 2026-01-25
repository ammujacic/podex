/**
 * LM Studio Bridge
 *
 * Detects local LM Studio installation and creates a secure tunnel
 * to allow cloud agents to use local LLM inference.
 *
 * LM Studio exposes an OpenAI-compatible API on port 1234.
 */

import * as http from 'http';
import { exec } from 'child_process';
import { promisify } from 'util';
import { EventEmitter } from 'events';
import log from 'electron-log/main';
import Store from 'electron-store';

const execAsync = promisify(exec);

export type LMStudioStatus = 'running' | 'stopped' | 'not_installed' | 'checking';
export type BridgeStatus = 'connected' | 'connecting' | 'disconnected' | 'error';

export interface LMStudioModel {
  id: string;
  object: string;
  created: number;
  owned_by: string;
}

export interface LMStudioConfig {
  enabled: boolean;
  url: string;
  bridgeEnabled: boolean;
  exposedModels: string[];
  autoStart: boolean;
}

export interface LMStudioInfo {
  status: LMStudioStatus;
  models: LMStudioModel[];
  bridgeStatus: BridgeStatus;
  requestsToday: number;
  tokensToday: number;
}

export interface LMStudioInstallGuide {
  platform: NodeJS.Platform;
  name: string;
  downloadUrl: string;
  instructions: string[];
}

const DEFAULT_CONFIG: LMStudioConfig = {
  enabled: false,
  url: 'http://localhost:1234',
  bridgeEnabled: false,
  exposedModels: [],
  autoStart: false,
};

export class LMStudioBridge extends EventEmitter {
  private store: Store;
  private status: LMStudioStatus = 'checking';
  private bridgeStatus: BridgeStatus = 'disconnected';
  private models: LMStudioModel[] = [];
  private bridgeWebSocket: WebSocket | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private requestsToday = 0;
  private tokensToday = 0;
  private readonly HEALTH_CHECK_INTERVAL = 30000;

  constructor(store: Store) {
    super();
    this.store = store;

    if (!this.store.has('lmstudio')) {
      this.store.set('lmstudio', DEFAULT_CONFIG);
    }
  }

  /**
   * Get configuration
   */
  getConfig(): LMStudioConfig {
    return (this.store.get('lmstudio') as LMStudioConfig) || DEFAULT_CONFIG;
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<LMStudioConfig>): void {
    const current = this.getConfig();
    this.store.set('lmstudio', { ...current, ...updates });
    log.info('LM Studio config updated:', updates);
  }

  /**
   * Get installation guide
   */
  getInstallGuide(): LMStudioInstallGuide {
    const platform = process.platform;

    const guides: Record<string, LMStudioInstallGuide> = {
      darwin: {
        platform: 'darwin',
        name: 'LM Studio for Mac',
        downloadUrl: 'https://lmstudio.ai/',
        instructions: [
          '1. Download LM Studio from lmstudio.ai',
          '2. Open the downloaded file and drag to Applications',
          '3. Launch LM Studio',
          '4. Download a model from the Discover tab',
          '5. Go to Local Server tab and click "Start Server"',
          '6. Server will run on http://localhost:1234',
        ],
      },
      win32: {
        platform: 'win32',
        name: 'LM Studio for Windows',
        downloadUrl: 'https://lmstudio.ai/',
        instructions: [
          '1. Download LM Studio from lmstudio.ai',
          '2. Run the installer',
          '3. Launch LM Studio',
          '4. Download a model from the Discover tab',
          '5. Go to Local Server tab and click "Start Server"',
          '6. Server will run on http://localhost:1234',
        ],
      },
      linux: {
        platform: 'linux',
        name: 'LM Studio for Linux',
        downloadUrl: 'https://lmstudio.ai/',
        instructions: [
          '1. Download LM Studio AppImage from lmstudio.ai',
          '2. Make it executable: chmod +x LM-Studio*.AppImage',
          '3. Run the AppImage',
          '4. Download a model from the Discover tab',
          '5. Go to Local Server tab and click "Start Server"',
        ],
      },
    };

    return guides[platform] || guides.linux;
  }

  /**
   * Check LM Studio status
   */
  async checkStatus(): Promise<LMStudioInfo> {
    const config = this.getConfig();

    const info: LMStudioInfo = {
      status: 'checking',
      models: [],
      bridgeStatus: this.bridgeStatus,
      requestsToday: this.requestsToday,
      tokensToday: this.tokensToday,
    };

    try {
      // Check if server is running by listing models
      const modelsResponse = await this.fetchLMStudio('/v1/models');
      if (modelsResponse && modelsResponse.data) {
        this.status = 'running';
        info.status = 'running';
        this.models = modelsResponse.data || [];
        info.models = this.models;
      } else {
        this.status = 'stopped';
        info.status = 'stopped';
      }
    } catch (error) {
      // Server not running
      this.status = 'stopped';
      info.status = 'stopped';
    }

    info.bridgeStatus = this.bridgeStatus;
    this.emit('status-changed', info);
    return info;
  }

  /**
   * Check if LM Studio is installed
   */
  async isInstalled(): Promise<boolean> {
    const platform = process.platform;

    try {
      if (platform === 'darwin') {
        await execAsync('ls /Applications/LM\\ Studio.app');
        return true;
      } else if (platform === 'win32') {
        await execAsync('where lms', { shell: 'cmd.exe' });
        return true;
      } else {
        // Linux: Check for AppImage or installed binary
        await execAsync('which lms || ls ~/LM-Studio*.AppImage 2>/dev/null');
        return true;
      }
    } catch {
      return false;
    }
  }

  /**
   * Start LM Studio app
   */
  async startLMStudio(): Promise<boolean> {
    const platform = process.platform;

    try {
      if (platform === 'darwin') {
        await execAsync('open -a "LM Studio"');
      } else if (platform === 'win32') {
        await execAsync('start "" "LM Studio"', { shell: 'cmd.exe' });
      } else {
        // Linux: Try to find and run AppImage
        await execAsync('$(ls ~/LM-Studio*.AppImage | head -1) &');
      }

      log.info('LM Studio start command executed');

      // Note: User still needs to manually start the server in LM Studio
      // We can only check if the server becomes available
      return true;
    } catch (error) {
      log.error('Failed to start LM Studio:', error);
      return false;
    }
  }

  /**
   * Wait for LM Studio server to be ready
   */
  async waitForServer(timeout: number = 30000): Promise<boolean> {
    const startTime = Date.now();
    const checkInterval = 2000;

    while (Date.now() - startTime < timeout) {
      const info = await this.checkStatus();
      if (info.status === 'running') {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, checkInterval));
    }

    return false;
  }

  /**
   * Connect bridge to cloud
   */
  async connectBridge(cloudUrl: string, authToken: string): Promise<boolean> {
    if (this.bridgeWebSocket) {
      this.disconnectBridge();
    }

    this.bridgeStatus = 'connecting';
    this.emit('bridge-status-changed', this.bridgeStatus);

    return new Promise((resolve) => {
      try {
        const wsUrl = cloudUrl.replace('https://', 'wss://').replace('http://', 'ws://');
        const bridgeEndpoint = `${wsUrl}/ws/llm-bridge?token=${authToken}&provider=lmstudio`;

        const WebSocket = require('ws');
        this.bridgeWebSocket = new WebSocket(bridgeEndpoint);

        if (this.bridgeWebSocket) {
          this.bridgeWebSocket.onopen = () => {
            log.info('LM Studio bridge connected to cloud');
            this.bridgeStatus = 'connected';
            this.emit('bridge-status-changed', this.bridgeStatus);

            // Send registration
            const config = this.getConfig();
            this.bridgeWebSocket?.send(
              JSON.stringify({
                type: 'register',
                provider: 'lmstudio',
                models:
                  config.exposedModels.length > 0
                    ? config.exposedModels
                    : this.models.map((m) => m.id),
              })
            );

            resolve(true);
          };

          this.bridgeWebSocket.onmessage = async (event: { data: string }) => {
            try {
              const message = JSON.parse(event.data);

              if (message.type === 'llm_request') {
                await this.handleLLMRequest(message);
              }
            } catch (error) {
              log.error('Error handling bridge message:', error);
            }
          };

          this.bridgeWebSocket.onerror = (event: Event) => {
            log.error('Bridge WebSocket error:', event);
            this.bridgeStatus = 'error';
            this.emit('bridge-status-changed', this.bridgeStatus);
            resolve(false);
          };

          this.bridgeWebSocket.onclose = () => {
            log.info('Bridge WebSocket closed');
            this.bridgeStatus = 'disconnected';
            this.bridgeWebSocket = null;
            this.emit('bridge-status-changed', this.bridgeStatus);
          };
        }

        // Timeout
        setTimeout(() => {
          if (this.bridgeStatus === 'connecting') {
            this.bridgeWebSocket?.close();
            this.bridgeStatus = 'error';
            this.emit('bridge-status-changed', this.bridgeStatus);
            resolve(false);
          }
        }, 10000);
      } catch (error) {
        log.error('Failed to connect bridge:', error);
        this.bridgeStatus = 'error';
        this.emit('bridge-status-changed', this.bridgeStatus);
        resolve(false);
      }
    });
  }

  /**
   * Disconnect bridge
   */
  disconnectBridge(): void {
    if (this.bridgeWebSocket) {
      this.bridgeWebSocket.close();
      this.bridgeWebSocket = null;
    }
    this.bridgeStatus = 'disconnected';
    this.emit('bridge-status-changed', this.bridgeStatus);
    log.info('LM Studio bridge disconnected');
  }

  /**
   * Handle LLM request from cloud
   */
  private async handleLLMRequest(request: {
    requestId: string;
    model: string;
    messages: Array<{ role: string; content: string }>;
    options?: Record<string, unknown>;
  }): Promise<void> {
    log.info(`Handling LM Studio request: ${request.requestId} for model ${request.model}`);

    try {
      const response = await this.chatCompletion(request.model, request.messages, request.options);

      this.requestsToday++;
      this.tokensToday +=
        (response.usage?.prompt_tokens || 0) + (response.usage?.completion_tokens || 0);

      this.bridgeWebSocket?.send(
        JSON.stringify({
          type: 'llm_response',
          requestId: request.requestId,
          response: response.choices?.[0]?.message?.content || '',
          tokens: {
            prompt: response.usage?.prompt_tokens || 0,
            completion: response.usage?.completion_tokens || 0,
          },
          done: true,
        })
      );

      this.emit('request-completed', {
        requestId: request.requestId,
        model: request.model,
        tokens: response.usage,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(`LM Studio request failed: ${errorMessage}`);

      this.bridgeWebSocket?.send(
        JSON.stringify({
          type: 'llm_response',
          requestId: request.requestId,
          error: errorMessage,
          done: true,
        })
      );
    }
  }

  /**
   * Send chat completion request (OpenAI-compatible API)
   */
  async chatCompletion(
    model: string,
    messages: Array<{ role: string; content: string }>,
    options?: Record<string, unknown>
  ): Promise<{
    choices: Array<{ message: { role: string; content: string } }>;
    usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  }> {
    const config = this.getConfig();

    return new Promise((resolve, reject) => {
      const url = new URL('/v1/chat/completions', config.url);

      const postData = JSON.stringify({
        model,
        messages,
        stream: false,
        ...options,
      });

      const req = http.request(
        {
          hostname: url.hostname,
          port: url.port || 1234,
          path: url.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          timeout: 300000,
        },
        (res) => {
          let data = '';

          res.on('data', (chunk) => {
            data += chunk;
          });

          res.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              resolve(parsed);
            } catch (error) {
              reject(new Error('Failed to parse LM Studio response'));
            }
          });
        }
      );

      req.on('error', reject);
      req.on('timeout', () => reject(new Error('Request timeout')));
      req.write(postData);
      req.end();
    });
  }

  /**
   * Get embeddings (OpenAI-compatible API)
   */
  async getEmbeddings(
    model: string,
    input: string | string[]
  ): Promise<{ data: Array<{ embedding: number[]; index: number }> }> {
    const config = this.getConfig();

    return new Promise((resolve, reject) => {
      const url = new URL('/v1/embeddings', config.url);

      const postData = JSON.stringify({
        model,
        input,
      });

      const req = http.request(
        {
          hostname: url.hostname,
          port: url.port || 1234,
          path: url.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          timeout: 60000,
        },
        (res) => {
          let data = '';

          res.on('data', (chunk) => {
            data += chunk;
          });

          res.on('end', () => {
            try {
              resolve(JSON.parse(data));
            } catch (error) {
              reject(new Error('Failed to parse embeddings response'));
            }
          });
        }
      );

      req.on('error', reject);
      req.on('timeout', () => reject(new Error('Request timeout')));
      req.write(postData);
      req.end();
    });
  }

  /**
   * Fetch from LM Studio API
   */
  private async fetchLMStudio(path: string): Promise<any> {
    const config = this.getConfig();

    return new Promise((resolve, reject) => {
      const url = new URL(path, config.url);

      const req = http.get(
        {
          hostname: url.hostname,
          port: url.port || 1234,
          path: url.pathname,
          timeout: 5000,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            try {
              resolve(JSON.parse(data));
            } catch {
              resolve(null);
            }
          });
        }
      );

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Timeout'));
      });
    });
  }

  /**
   * Start health check
   */
  startHealthCheck(): void {
    if (this.healthCheckInterval) return;

    this.checkStatus();

    this.healthCheckInterval = setInterval(() => {
      this.checkStatus();
    }, this.HEALTH_CHECK_INTERVAL);

    log.info('LM Studio health check started');
  }

  /**
   * Stop health check
   */
  stopHealthCheck(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  /**
   * Get current info
   */
  getInfo(): LMStudioInfo {
    return {
      status: this.status,
      models: this.models,
      bridgeStatus: this.bridgeStatus,
      requestsToday: this.requestsToday,
      tokensToday: this.tokensToday,
    };
  }

  /**
   * Shutdown
   */
  async shutdown(): Promise<void> {
    this.stopHealthCheck();
    this.disconnectBridge();
    this.removeAllListeners();
    log.info('LM Studio bridge shutdown complete');
  }
}

// Singleton
let lmStudioBridge: LMStudioBridge | null = null;

export function initializeLMStudioBridge(store: Store): LMStudioBridge {
  if (!lmStudioBridge) {
    lmStudioBridge = new LMStudioBridge(store);
  }
  return lmStudioBridge;
}

export function getLMStudioBridge(): LMStudioBridge | null {
  return lmStudioBridge;
}
