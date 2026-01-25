/**
 * Local Services
 *
 * Main entry point for all local development services.
 * Coordinates Docker, Local Pod, Ollama, LM Studio, and Offline Cache.
 */

import { BrowserWindow, ipcMain } from 'electron';
import log from 'electron-log/main';
import Store from 'electron-store';
import { EventEmitter } from 'events';

// Import all modules
import { DockerManager, getDockerManager } from './docker-manager';
import {
  LocalPodManager,
  initializeLocalPodManager,
  getLocalPodManager,
  LocalPodConfig,
} from './local-pod-manager';
import {
  OllamaBridge,
  initializeOllamaBridge,
  getOllamaBridge,
  OllamaConfig,
} from './ollama-bridge';
import {
  LMStudioBridge,
  initializeLMStudioBridge,
  getLMStudioBridge,
  LMStudioConfig,
} from './lmstudio-bridge';
import {
  OfflineCache,
  initializeOfflineCache,
  getOfflineCache,
  OfflineCacheConfig,
} from './offline-cache';
import { GuidedSetup, initializeGuidedSetup, getGuidedSetup, SetupConfig } from './guided-setup';

// Re-export types
export * from './docker-manager';
export * from './local-pod-manager';
export * from './offline-cache';
export * from './guided-setup';

// Explicitly export from ollama-bridge and lmstudio-bridge to avoid BridgeStatus conflict
export {
  OllamaBridge,
  initializeOllamaBridge,
  getOllamaBridge,
  type OllamaConfig,
  type OllamaInfo,
  type OllamaStatus,
  type BridgeStatus as OllamaBridgeStatus,
  type OllamaModel,
  type OllamaInstallGuide,
  type LLMRequest,
  type LLMResponse,
  RECOMMENDED_MODELS,
} from './ollama-bridge';

export {
  LMStudioBridge,
  initializeLMStudioBridge,
  getLMStudioBridge,
  type LMStudioConfig,
  type LMStudioInfo,
  type LMStudioStatus,
  type BridgeStatus as LMStudioBridgeStatus,
  type LMStudioModel,
  type LMStudioInstallGuide,
} from './lmstudio-bridge';

// Combined config interface
export interface LocalServicesConfig {
  enabled: boolean;
  localPod: LocalPodConfig;
  ollama: OllamaConfig;
  lmstudio: LMStudioConfig;
  offlineCache: OfflineCacheConfig;
  guidedSetup: SetupConfig;
}

// Combined status interface
export interface LocalServicesStatus {
  docker: {
    status: string;
    version: string | null;
    running: boolean;
  };
  localPod: {
    status: string;
    running: boolean;
    activeWorkspaces: number;
  };
  ollama: {
    status: string;
    running: boolean;
    modelsCount: number;
    bridgeConnected: boolean;
  };
  lmstudio: {
    status: string;
    running: boolean;
    modelsCount: number;
    bridgeConnected: boolean;
  };
  offlineCache: {
    enabled: boolean;
    sessionsCount: number;
    isOnline: boolean;
  };
  guidedSetup: {
    completed: boolean;
    currentStep: string;
  };
}

/**
 * Local Services Manager
 *
 * Orchestrates all local services and provides a unified interface.
 */
export class LocalServicesManager extends EventEmitter {
  private store: Store;
  private mainWindow: BrowserWindow | null = null;
  private dockerManager: DockerManager | null = null;
  private localPodManager: LocalPodManager | null = null;
  private ollamaBridge: OllamaBridge | null = null;
  private lmStudioBridge: LMStudioBridge | null = null;
  private offlineCache: OfflineCache | null = null;
  private guidedSetup: GuidedSetup | null = null;
  private initialized = false;

  constructor(store: Store) {
    super();
    this.store = store;

    // Ensure main config exists
    if (!this.store.has('localServices')) {
      this.store.set('localServices', { enabled: true });
    }
  }

  /**
   * Set main window for IPC communication
   */
  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
  }

  /**
   * Initialize all services
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    log.info('Initializing local services...');

    try {
      // Initialize Docker manager (singleton)
      this.dockerManager = getDockerManager();

      // Initialize other services with store
      this.localPodManager = initializeLocalPodManager(this.store);
      this.ollamaBridge = initializeOllamaBridge(this.store);
      this.lmStudioBridge = initializeLMStudioBridge(this.store);
      this.offlineCache = initializeOfflineCache(this.store);
      this.guidedSetup = initializeGuidedSetup(this.store);

      // Set up event forwarding
      this.setupEventForwarding();

      // Initialize offline cache database
      await this.offlineCache.initialize();

      // Start health checks
      this.dockerManager.startHealthCheck();
      this.ollamaBridge.startHealthCheck();
      this.lmStudioBridge.startHealthCheck();

      // Set up IPC handlers
      this.setupIpcHandlers();

      this.initialized = true;
      log.info('Local services initialized successfully');

      // Check if guided setup should be shown
      const setupConfig = this.guidedSetup.getConfig();
      if (!setupConfig.hasCompletedSetup) {
        this.emit('show-guided-setup');
      }

      // Auto-start services if configured
      await this.autoStartServices();

      this.emit('initialized');
    } catch (error) {
      log.error('Failed to initialize local services:', error);
      this.emit('error', error);
    }
  }

  /**
   * Set up event forwarding to renderer
   */
  private setupEventForwarding(): void {
    // Docker events
    this.dockerManager?.on('status-changed', (status) => {
      this.mainWindow?.webContents.send('local-services:docker-status', status);
      this.emitStatusUpdate();
    });

    // Local Pod events
    this.localPodManager?.on('status-changed', (status) => {
      this.mainWindow?.webContents.send('local-services:local-pod-status', status);
      this.emitStatusUpdate();
    });
    this.localPodManager?.on('log', (entry) => {
      this.mainWindow?.webContents.send('local-services:local-pod-log', entry);
    });

    // Ollama events
    this.ollamaBridge?.on('status-changed', (info) => {
      this.mainWindow?.webContents.send('local-services:ollama-status', info);
      this.emitStatusUpdate();
    });
    this.ollamaBridge?.on('bridge-status-changed', (status) => {
      this.mainWindow?.webContents.send('local-services:ollama-bridge-status', status);
    });
    this.ollamaBridge?.on('request-completed', (data) => {
      this.mainWindow?.webContents.send('local-services:ollama-request', data);
    });

    // LM Studio events
    this.lmStudioBridge?.on('status-changed', (info) => {
      this.mainWindow?.webContents.send('local-services:lmstudio-status', info);
      this.emitStatusUpdate();
    });
    this.lmStudioBridge?.on('bridge-status-changed', (status) => {
      this.mainWindow?.webContents.send('local-services:lmstudio-bridge-status', status);
    });

    // Offline cache events
    this.offlineCache?.on('went-offline', () => {
      this.mainWindow?.webContents.send('local-services:offline');
    });
    this.offlineCache?.on('back-online', () => {
      this.mainWindow?.webContents.send('local-services:online');
    });

    // Guided setup events
    this.guidedSetup?.on('state-changed', (state) => {
      this.mainWindow?.webContents.send('local-services:setup-state', state);
    });
    this.guidedSetup?.on('setup-complete', () => {
      this.mainWindow?.webContents.send('local-services:setup-complete');
    });
  }

  /**
   * Set up IPC handlers
   */
  private setupIpcHandlers(): void {
    // ===== Status =====
    ipcMain.handle('local-services:get-status', () => this.getStatus());

    // ===== Docker =====
    ipcMain.handle('local-services:docker:get-info', () => this.dockerManager?.getInfo());
    ipcMain.handle('local-services:docker:get-install-guide', () =>
      this.dockerManager?.getInstallGuide()
    );
    ipcMain.handle('local-services:docker:start', () => this.dockerManager?.startDocker());
    ipcMain.handle('local-services:docker:pull-image', (_, imageName) =>
      this.dockerManager?.pullImage(imageName)
    );

    // ===== Local Pod =====
    ipcMain.handle('local-services:local-pod:get-config', () => this.localPodManager?.getConfig());
    ipcMain.handle('local-services:local-pod:update-config', (_, updates) =>
      this.localPodManager?.updateConfig(updates)
    );
    ipcMain.handle('local-services:local-pod:start', () => this.localPodManager?.start());
    ipcMain.handle('local-services:local-pod:stop', () => this.localPodManager?.stop());
    ipcMain.handle('local-services:local-pod:restart', () => this.localPodManager?.restart());
    ipcMain.handle('local-services:local-pod:get-logs', (_, limit) =>
      this.localPodManager?.getLogs(limit)
    );
    ipcMain.handle('local-services:local-pod:is-available', () =>
      this.localPodManager?.isAvailable()
    );

    // ===== Ollama =====
    ipcMain.handle('local-services:ollama:get-config', () => this.ollamaBridge?.getConfig());
    ipcMain.handle('local-services:ollama:update-config', (_, updates) =>
      this.ollamaBridge?.updateConfig(updates)
    );
    ipcMain.handle('local-services:ollama:get-info', () => this.ollamaBridge?.getInfo());
    ipcMain.handle('local-services:ollama:get-install-guide', () =>
      this.ollamaBridge?.getInstallGuide()
    );
    ipcMain.handle('local-services:ollama:get-recommended-models', () =>
      this.ollamaBridge?.getRecommendedModels()
    );
    ipcMain.handle('local-services:ollama:start', () => this.ollamaBridge?.startOllama());
    ipcMain.handle('local-services:ollama:pull-model', (_, modelName) =>
      this.ollamaBridge?.pullModel(modelName, (progress) => {
        this.mainWindow?.webContents.send('local-services:ollama-pull-progress', progress);
      })
    );
    ipcMain.handle('local-services:ollama:delete-model', (_, modelName) =>
      this.ollamaBridge?.deleteModel(modelName)
    );
    ipcMain.handle('local-services:ollama:connect-bridge', (_, cloudUrl, authToken) =>
      this.ollamaBridge?.connectBridge(cloudUrl, authToken)
    );
    ipcMain.handle('local-services:ollama:disconnect-bridge', () =>
      this.ollamaBridge?.disconnectBridge()
    );

    // ===== LM Studio =====
    ipcMain.handle('local-services:lmstudio:get-config', () => this.lmStudioBridge?.getConfig());
    ipcMain.handle('local-services:lmstudio:update-config', (_, updates) =>
      this.lmStudioBridge?.updateConfig(updates)
    );
    ipcMain.handle('local-services:lmstudio:get-info', () => this.lmStudioBridge?.getInfo());
    ipcMain.handle('local-services:lmstudio:get-install-guide', () =>
      this.lmStudioBridge?.getInstallGuide()
    );
    ipcMain.handle('local-services:lmstudio:start', () => this.lmStudioBridge?.startLMStudio());
    ipcMain.handle('local-services:lmstudio:connect-bridge', (_, cloudUrl, authToken) =>
      this.lmStudioBridge?.connectBridge(cloudUrl, authToken)
    );
    ipcMain.handle('local-services:lmstudio:disconnect-bridge', () =>
      this.lmStudioBridge?.disconnectBridge()
    );

    // ===== Offline Cache =====
    ipcMain.handle('local-services:cache:get-config', () => this.offlineCache?.getConfig());
    ipcMain.handle('local-services:cache:update-config', (_, updates) =>
      this.offlineCache?.updateConfig(updates)
    );
    ipcMain.handle('local-services:cache:get-stats', () => this.offlineCache?.getStats());
    ipcMain.handle('local-services:cache:get-sessions', () => this.offlineCache?.getAllSessions());
    ipcMain.handle('local-services:cache:get-session', (_, sessionId) =>
      this.offlineCache?.getSession(sessionId)
    );
    ipcMain.handle('local-services:cache:cache-session', (_, session) =>
      this.offlineCache?.cacheSession(session)
    );
    ipcMain.handle('local-services:cache:get-session-files', (_, sessionId) =>
      this.offlineCache?.getSessionFiles(sessionId)
    );
    ipcMain.handle('local-services:cache:get-file-content', (_, sessionId, filePath) =>
      this.offlineCache?.getFileContent(sessionId, filePath)
    );
    ipcMain.handle('local-services:cache:clear', () => this.offlineCache?.clearCache());
    ipcMain.handle('local-services:cache:set-online', (_, online) =>
      this.offlineCache?.setOnlineStatus(online)
    );

    // ===== Guided Setup =====
    ipcMain.handle('local-services:setup:get-state', () => this.guidedSetup?.getState());
    ipcMain.handle('local-services:setup:start', () => this.guidedSetup?.startSetup());
    ipcMain.handle('local-services:setup:next', () => this.guidedSetup?.nextStep());
    ipcMain.handle('local-services:setup:previous', () => this.guidedSetup?.previousStep());
    ipcMain.handle('local-services:setup:skip', () => this.guidedSetup?.skipStep());
    ipcMain.handle('local-services:setup:set-llm-choice', (_, choice) =>
      this.guidedSetup?.setLLMChoice(choice)
    );
    ipcMain.handle('local-services:setup:check-step', () => this.guidedSetup?.checkCurrentStep());
    ipcMain.handle('local-services:setup:reset', () => this.guidedSetup?.resetSetup());

    log.info('Local services IPC handlers registered');
  }

  /**
   * Auto-start configured services
   */
  private async autoStartServices(): Promise<void> {
    // Auto-start local pod if configured
    const localPodConfig = this.localPodManager?.getConfig();
    if (localPodConfig?.enabled && localPodConfig?.autoStart && localPodConfig?.podToken) {
      log.info('Auto-starting local pod');
      await this.localPodManager?.start();
    }

    // Auto-start Ollama bridge if configured
    const ollamaConfig = this.ollamaBridge?.getConfig();
    if (ollamaConfig?.enabled && ollamaConfig?.autoStart) {
      const ollamaInfo = await this.ollamaBridge?.checkStatus();
      if (ollamaInfo?.status !== 'running') {
        log.info('Auto-starting Ollama');
        await this.ollamaBridge?.startOllama();
      }
    }
  }

  /**
   * Get combined status
   */
  getStatus(): LocalServicesStatus {
    const dockerInfo = this.dockerManager?.getCachedInfo();
    const localPodInfo = this.localPodManager?.getInfo();
    const ollamaInfo = this.ollamaBridge?.getInfo();
    const lmStudioInfo = this.lmStudioBridge?.getInfo();
    const cacheStats = this.offlineCache?.getStats();
    const setupState = this.guidedSetup?.getState();

    return {
      docker: {
        status: dockerInfo?.status || 'checking',
        version: dockerInfo?.version || null,
        running: dockerInfo?.status === 'running',
      },
      localPod: {
        status: localPodInfo?.status || 'stopped',
        running: localPodInfo?.status === 'running',
        activeWorkspaces: localPodInfo?.activeWorkspaces || 0,
      },
      ollama: {
        status: ollamaInfo?.status || 'checking',
        running: ollamaInfo?.status === 'running',
        modelsCount: ollamaInfo?.models.length || 0,
        bridgeConnected: ollamaInfo?.bridgeStatus === 'connected',
      },
      lmstudio: {
        status: lmStudioInfo?.status || 'checking',
        running: lmStudioInfo?.status === 'running',
        modelsCount: lmStudioInfo?.models.length || 0,
        bridgeConnected: lmStudioInfo?.bridgeStatus === 'connected',
      },
      offlineCache: {
        enabled: this.offlineCache?.getConfig().enabled || false,
        sessionsCount: cacheStats?.sessionsCount || 0,
        isOnline: cacheStats?.isOnline ?? true,
      },
      guidedSetup: {
        completed: setupState?.hasCompletedSetup || false,
        currentStep: setupState?.currentStep || 'welcome',
      },
    };
  }

  /**
   * Emit status update to renderer
   */
  private emitStatusUpdate(): void {
    this.mainWindow?.webContents.send('local-services:status-update', this.getStatus());
  }

  /**
   * Shutdown all services
   */
  async shutdown(): Promise<void> {
    log.info('Shutting down local services...');

    // Stop all services
    this.dockerManager?.shutdown();
    await this.localPodManager?.shutdown();
    await this.ollamaBridge?.shutdown();
    await this.lmStudioBridge?.shutdown();
    await this.offlineCache?.shutdown();
    this.guidedSetup?.shutdown();

    this.removeAllListeners();
    this.initialized = false;

    log.info('Local services shutdown complete');
  }
}

// Singleton instance
let localServicesManager: LocalServicesManager | null = null;

export function initializeLocalServices(store: Store<any>): LocalServicesManager {
  if (!localServicesManager) {
    localServicesManager = new LocalServicesManager(store);
  }
  return localServicesManager;
}

export function getLocalServicesManager(): LocalServicesManager | null {
  return localServicesManager;
}
