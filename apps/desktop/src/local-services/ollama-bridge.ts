/**
 * Ollama Bridge
 *
 * Detects local Ollama installation and creates a secure tunnel
 * to allow cloud agents to use local LLM inference.
 */

import * as http from 'http';
import * as https from 'https';
import { exec } from 'child_process';
import { promisify } from 'util';
import { EventEmitter } from 'events';
import log from 'electron-log/main';
import Store from 'electron-store';

const execAsync = promisify(exec);

export type OllamaStatus = 'running' | 'stopped' | 'not_installed' | 'checking';
export type BridgeStatus = 'connected' | 'connecting' | 'disconnected' | 'error';

export interface OllamaModel {
  name: string;
  size: number;
  digest: string;
  modified_at: string;
  details?: {
    format: string;
    family: string;
    parameter_size: string;
    quantization_level: string;
  };
}

export interface OllamaConfig {
  enabled: boolean;
  url: string;
  bridgeEnabled: boolean;
  exposedModels: string[];
  autoStart: boolean;
}

export interface OllamaInfo {
  status: OllamaStatus;
  version: string | null;
  models: OllamaModel[];
  bridgeStatus: BridgeStatus;
  bridgeUrl: string | null;
  requestsToday: number;
  tokensToday: number;
}

export interface OllamaInstallGuide {
  platform: NodeJS.Platform;
  name: string;
  downloadUrl: string;
  instructions: string[];
}

export interface LLMRequest {
  requestId: string;
  model: string;
  messages: Array<{ role: string; content: string }>;
  stream?: boolean;
  options?: Record<string, unknown>;
}

export interface LLMResponse {
  requestId: string;
  response?: string;
  error?: string;
  tokens?: { prompt: number; completion: number };
  done: boolean;
}

const DEFAULT_CONFIG: OllamaConfig = {
  enabled: false,
  url: 'http://localhost:11434',
  bridgeEnabled: false,
  exposedModels: [],
  autoStart: false,
};

// Recommended models for coding
export const RECOMMENDED_MODELS = [
  {
    name: 'qwen2.5-coder:14b',
    description: 'Best for code generation and completion',
    size: '14GB',
    recommended: true,
  },
  {
    name: 'qwen2.5-coder:7b',
    description: 'Smaller, faster code model',
    size: '7GB',
    recommended: false,
  },
  {
    name: 'llama3.1:8b',
    description: 'General purpose, good balance',
    size: '8GB',
    recommended: false,
  },
  {
    name: 'codellama:13b',
    description: 'Meta code-focused model',
    size: '13GB',
    recommended: false,
  },
  {
    name: 'deepseek-coder:6.7b',
    description: 'Fast code completion',
    size: '6.7GB',
    recommended: false,
  },
];

export class OllamaBridge extends EventEmitter {
  private store: Store;
  private status: OllamaStatus = 'checking';
  private bridgeStatus: BridgeStatus = 'disconnected';
  private models: OllamaModel[] = [];
  private version: string | null = null;
  private bridgeWebSocket: WebSocket | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private requestsToday = 0;
  private tokensToday = 0;
  private readonly HEALTH_CHECK_INTERVAL = 30000;

  constructor(store: Store) {
    super();
    this.store = store;

    if (!this.store.has('ollama')) {
      this.store.set('ollama', DEFAULT_CONFIG);
    }
  }

  /**
   * Get configuration
   */
  getConfig(): OllamaConfig {
    return (this.store.get('ollama') as OllamaConfig) || DEFAULT_CONFIG;
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<OllamaConfig>): void {
    const current = this.getConfig();
    this.store.set('ollama', { ...current, ...updates });
    log.info('Ollama config updated:', updates);
  }

  /**
   * Get installation guide
   */
  getInstallGuide(): OllamaInstallGuide {
    const platform = process.platform;

    const guides: Record<string, OllamaInstallGuide> = {
      darwin: {
        platform: 'darwin',
        name: 'Ollama for Mac',
        downloadUrl: 'https://ollama.ai/download/mac',
        instructions: [
          '1. Download Ollama from ollama.ai',
          '2. Open the downloaded file and drag to Applications',
          '3. Launch Ollama from Applications',
          '4. Ollama icon will appear in menu bar',
          '5. Pull a model: ollama pull qwen2.5-coder:14b',
        ],
      },
      win32: {
        platform: 'win32',
        name: 'Ollama for Windows',
        downloadUrl: 'https://ollama.ai/download/windows',
        instructions: [
          '1. Download Ollama from ollama.ai',
          '2. Run the installer',
          '3. Ollama will start automatically',
          '4. Open terminal and run: ollama pull qwen2.5-coder:14b',
        ],
      },
      linux: {
        platform: 'linux',
        name: 'Ollama for Linux',
        downloadUrl: 'https://ollama.ai/download/linux',
        instructions: [
          '1. Run: curl -fsSL https://ollama.ai/install.sh | sh',
          '2. Start Ollama: ollama serve',
          '3. Pull a model: ollama pull qwen2.5-coder:14b',
        ],
      },
    };

    return guides[platform] || guides.linux;
  }

  /**
   * Get recommended models
   */
  getRecommendedModels(): typeof RECOMMENDED_MODELS {
    return RECOMMENDED_MODELS;
  }

  /**
   * Check Ollama status
   */
  async checkStatus(): Promise<OllamaInfo> {
    const config = this.getConfig();

    const info: OllamaInfo = {
      status: 'checking',
      version: null,
      models: [],
      bridgeStatus: this.bridgeStatus,
      bridgeUrl: null,
      requestsToday: this.requestsToday,
      tokensToday: this.tokensToday,
    };

    try {
      // Check if Ollama is running
      const tagsResponse = await this.fetchOllama('/api/tags');
      if (tagsResponse) {
        this.status = 'running';
        info.status = 'running';
        this.models = tagsResponse.models || [];
        info.models = this.models;

        // Get version
        try {
          const versionResponse = await this.fetchOllama('/api/version');
          this.version = versionResponse?.version || null;
          info.version = this.version;
        } catch {
          // Version endpoint may not exist in older versions
        }
      } else {
        this.status = 'stopped';
        info.status = 'stopped';
      }
    } catch (error) {
      // Check if installed but not running
      const installed = await this.isInstalled();
      this.status = installed ? 'stopped' : 'not_installed';
      info.status = this.status;
    }

    info.bridgeStatus = this.bridgeStatus;
    this.emit('status-changed', info);
    return info;
  }

  /**
   * Check if Ollama is installed
   */
  async isInstalled(): Promise<boolean> {
    try {
      const cmd = process.platform === 'win32' ? 'where ollama' : 'which ollama';
      await execAsync(cmd);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Start Ollama service
   */
  async startOllama(): Promise<boolean> {
    const platform = process.platform;

    try {
      if (platform === 'darwin') {
        // macOS: Open Ollama app
        await execAsync('open -a Ollama');
      } else if (platform === 'win32') {
        // Windows: Start Ollama
        await execAsync('start ollama serve', { shell: 'cmd.exe' });
      } else {
        // Linux: Start serve in background
        exec('ollama serve &');
      }

      log.info('Ollama start command executed');

      // Wait for it to be ready
      return await this.waitForOllama(30000);
    } catch (error) {
      log.error('Failed to start Ollama:', error);
      return false;
    }
  }

  /**
   * Wait for Ollama to be ready
   */
  async waitForOllama(timeout: number = 30000): Promise<boolean> {
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
   * Pull a model
   */
  async pullModel(
    modelName: string,
    onProgress?: (progress: { status: string; completed?: number; total?: number }) => void
  ): Promise<boolean> {
    const config = this.getConfig();

    return new Promise((resolve) => {
      const url = new URL('/api/pull', config.url);

      const postData = JSON.stringify({ name: modelName, stream: true });

      const req = http.request(
        {
          hostname: url.hostname,
          port: url.port || 11434,
          path: url.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
        },
        (res) => {
          let buffer = '';

          res.on('data', (chunk) => {
            buffer += chunk.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (!line.trim()) continue;
              try {
                const data = JSON.parse(line);
                if (onProgress) {
                  onProgress({
                    status: data.status,
                    completed: data.completed,
                    total: data.total,
                  });
                }
              } catch {
                // Ignore parse errors
              }
            }
          });

          res.on('end', () => {
            log.info(`Model ${modelName} pull completed`);
            this.checkStatus(); // Refresh models list
            resolve(true);
          });

          res.on('error', (error) => {
            log.error(`Failed to pull model ${modelName}:`, error);
            resolve(false);
          });
        }
      );

      req.on('error', (error) => {
        log.error(`Failed to pull model ${modelName}:`, error);
        resolve(false);
      });

      req.write(postData);
      req.end();
    });
  }

  /**
   * Delete a model
   */
  async deleteModel(modelName: string): Promise<boolean> {
    const config = this.getConfig();

    try {
      const url = new URL('/api/delete', config.url);

      await new Promise<void>((resolve, reject) => {
        const req = http.request(
          {
            hostname: url.hostname,
            port: url.port || 11434,
            path: url.pathname,
            method: 'DELETE',
            headers: {
              'Content-Type': 'application/json',
            },
          },
          (res) => {
            if (res.statusCode === 200) {
              resolve();
            } else {
              reject(new Error(`Status ${res.statusCode}`));
            }
          }
        );

        req.on('error', reject);
        req.write(JSON.stringify({ name: modelName }));
        req.end();
      });

      log.info(`Model ${modelName} deleted`);
      await this.checkStatus();
      return true;
    } catch (error) {
      log.error(`Failed to delete model ${modelName}:`, error);
      return false;
    }
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
        const bridgeEndpoint = `${wsUrl}/ws/llm-bridge?token=${authToken}`;

        // Note: In Electron main process, we need to use a Node.js WebSocket library
        // For now, we'll use a simple implementation
        const WebSocket = require('ws');
        this.bridgeWebSocket = new WebSocket(bridgeEndpoint);

        if (this.bridgeWebSocket) {
          this.bridgeWebSocket.onopen = () => {
            log.info('LLM bridge connected to cloud');
            this.bridgeStatus = 'connected';
            this.emit('bridge-status-changed', this.bridgeStatus);

            // Send registration
            const config = this.getConfig();
            this.bridgeWebSocket?.send(
              JSON.stringify({
                type: 'register',
                models:
                  config.exposedModels.length > 0
                    ? config.exposedModels
                    : this.models.map((m) => m.name),
              })
            );

            resolve(true);
          };

          this.bridgeWebSocket.onmessage = async (event: { data: string }) => {
            try {
              const message = JSON.parse(event.data);

              if (message.type === 'llm_request') {
                await this.handleLLMRequest(message as LLMRequest);
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
   * Disconnect bridge from cloud
   */
  disconnectBridge(): void {
    if (this.bridgeWebSocket) {
      this.bridgeWebSocket.close();
      this.bridgeWebSocket = null;
    }
    this.bridgeStatus = 'disconnected';
    this.emit('bridge-status-changed', this.bridgeStatus);
    log.info('Bridge disconnected');
  }

  /**
   * Handle LLM request from cloud
   */
  private async handleLLMRequest(request: LLMRequest): Promise<void> {
    const config = this.getConfig();

    log.info(`Handling LLM request: ${request.requestId} for model ${request.model}`);

    try {
      const response = await this.chat(request.model, request.messages, request.options);

      this.requestsToday++;
      this.tokensToday += (response.tokens?.prompt || 0) + (response.tokens?.completion || 0);

      // Send response back through WebSocket
      this.bridgeWebSocket?.send(
        JSON.stringify({
          type: 'llm_response',
          requestId: request.requestId,
          response: response.response,
          tokens: response.tokens,
          done: true,
        })
      );

      this.emit('request-completed', {
        requestId: request.requestId,
        model: request.model,
        tokens: response.tokens,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(`LLM request failed: ${errorMessage}`);

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
   * Send chat request to Ollama
   */
  async chat(
    model: string,
    messages: Array<{ role: string; content: string }>,
    options?: Record<string, unknown>
  ): Promise<{ response: string; tokens: { prompt: number; completion: number } }> {
    const config = this.getConfig();

    return new Promise((resolve, reject) => {
      const url = new URL('/api/chat', config.url);

      const postData = JSON.stringify({
        model,
        messages,
        stream: false,
        ...options,
      });

      const req = http.request(
        {
          hostname: url.hostname,
          port: url.port || 11434,
          path: url.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          timeout: 300000, // 5 minute timeout for long generations
        },
        (res) => {
          let data = '';

          res.on('data', (chunk) => {
            data += chunk;
          });

          res.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              resolve({
                response: parsed.message?.content || '',
                tokens: {
                  prompt: parsed.prompt_eval_count || 0,
                  completion: parsed.eval_count || 0,
                },
              });
            } catch (error) {
              reject(new Error('Failed to parse Ollama response'));
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
   * Fetch from Ollama API
   */
  private async fetchOllama(path: string): Promise<any> {
    const config = this.getConfig();

    return new Promise((resolve, reject) => {
      const url = new URL(path, config.url);

      const req = http.get(
        {
          hostname: url.hostname,
          port: url.port || 11434,
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
   * Start health check interval
   */
  startHealthCheck(): void {
    if (this.healthCheckInterval) return;

    this.checkStatus();

    this.healthCheckInterval = setInterval(() => {
      this.checkStatus();
    }, this.HEALTH_CHECK_INTERVAL);

    log.info('Ollama health check started');
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
  getInfo(): OllamaInfo {
    return {
      status: this.status,
      version: this.version,
      models: this.models,
      bridgeStatus: this.bridgeStatus,
      bridgeUrl: null,
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
    log.info('Ollama bridge shutdown complete');
  }
}

// Singleton
let ollamaBridge: OllamaBridge | null = null;

export function initializeOllamaBridge(store: Store): OllamaBridge {
  if (!ollamaBridge) {
    ollamaBridge = new OllamaBridge(store);
  }
  return ollamaBridge;
}

export function getOllamaBridge(): OllamaBridge | null {
  return ollamaBridge;
}
