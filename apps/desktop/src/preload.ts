import { contextBridge, ipcRenderer } from 'electron';

// Note: Sentry for the renderer process is handled by the web app's existing
// Sentry integration (NEXT_PUBLIC_SENTRY_DSN). The desktop main process has
// its own Sentry instance (SENTRY_DSN_DESKTOP) for capturing Electron-specific errors.

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // ============================================
  // Platform Info
  // ============================================
  platform: process.platform,
  isElectron: true,
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  },

  // ============================================
  // Native File Dialogs
  // ============================================
  openDirectory: (): Promise<string | null> => {
    return ipcRenderer.invoke('dialog:openDirectory');
  },

  openFile: (options?: {
    filters?: { name: string; extensions: string[] }[];
  }): Promise<string | null> => {
    return ipcRenderer.invoke('dialog:openFile', options);
  },

  saveFile: (options?: {
    defaultPath?: string;
    filters?: { name: string; extensions: string[] }[];
  }): Promise<string | null> => {
    return ipcRenderer.invoke('dialog:saveFile', options);
  },

  // ============================================
  // Auto Updates
  // ============================================
  checkForUpdates: (): Promise<{
    updateAvailable: boolean;
    version?: string;
    error?: string;
    message?: string;
  }> => {
    return ipcRenderer.invoke('updater:checkForUpdates');
  },

  onUpdateStatus: (callback: (message: string) => void) => {
    const handler = (_: unknown, message: string) => callback(message);
    ipcRenderer.on('updater-status', handler);
    return () => ipcRenderer.removeListener('updater-status', handler);
  },

  // ============================================
  // Deep Linking
  // ============================================
  onDeepLink: (
    callback: (data: { action: string; params: string[]; query: Record<string, string> }) => void
  ) => {
    const handler = (
      _: unknown,
      data: { action: string; params: string[]; query: Record<string, string> }
    ) => callback(data);
    ipcRenderer.on('deep-link', handler);
    return () => ipcRenderer.removeListener('deep-link', handler);
  },

  // ============================================
  // App Info
  // ============================================
  getVersion: (): Promise<string> => {
    return ipcRenderer.invoke('app:getVersion');
  },

  // ============================================
  // Settings
  // ============================================
  getSetting: (key: string): Promise<unknown> => {
    return ipcRenderer.invoke('settings:get', key);
  },

  setSetting: (key: string, value: unknown): Promise<void> => {
    return ipcRenderer.invoke('settings:set', key, value);
  },

  getApiUrl: (): Promise<string> => {
    return ipcRenderer.invoke('settings:get', 'settings.apiUrl');
  },

  // ============================================
  // Badge / Notifications Count
  // ============================================
  setBadge: (count: number): Promise<void> => {
    return ipcRenderer.invoke('badge:set', count);
  },

  // ============================================
  // Logging
  // ============================================
  getLogPath: (): Promise<string> => {
    return ipcRenderer.invoke('log:getPath');
  },

  openLogFile: (): Promise<void> => {
    return ipcRenderer.invoke('log:open');
  },

  // ============================================
  // Network Status
  // ============================================
  reportNetworkStatus: (online: boolean): void => {
    ipcRenderer.send('network:statusChanged', online);
  },

  // ============================================
  // Menu Events (from native menu)
  // ============================================
  onNewSession: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('new-session', handler);
    return () => ipcRenderer.removeListener('new-session', handler);
  },

  onOpenWorkspace: (callback: (path: string) => void) => {
    const handler = (_: unknown, path: string) => callback(path);
    ipcRenderer.on('open-workspace', handler);
    return () => ipcRenderer.removeListener('open-workspace', handler);
  },

  onOpenSettings: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('open-settings', handler);
    return () => ipcRenderer.removeListener('open-settings', handler);
  },

  onOpenSearch: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('open-search', handler);
    return () => ipcRenderer.removeListener('open-search', handler);
  },

  onToggleSidebar: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('toggle-sidebar', handler);
    return () => ipcRenderer.removeListener('toggle-sidebar', handler);
  },

  onToggleTerminal: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('toggle-terminal', handler);
    return () => ipcRenderer.removeListener('toggle-terminal', handler);
  },

  onOpenFilePicker: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('open-file-picker', handler);
    return () => ipcRenderer.removeListener('open-file-picker', handler);
  },

  onOpenCommandPalette: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('open-command-palette', handler);
    return () => ipcRenderer.removeListener('open-command-palette', handler);
  },

  onNavigate: (callback: (path: string) => void) => {
    const handler = (_: unknown, path: string) => callback(path);
    ipcRenderer.on('navigate', handler);
    return () => ipcRenderer.removeListener('navigate', handler);
  },

  // ============================================
  // Recent Workspaces
  // ============================================
  getRecentWorkspaces: (): Promise<Array<{ path: string; name: string; lastOpened: number }>> => {
    return ipcRenderer.invoke('recent:get');
  },

  addRecentWorkspace: (workspacePath: string): Promise<void> => {
    return ipcRenderer.invoke('recent:add', workspacePath);
  },

  clearRecentWorkspaces: (): Promise<void> => {
    return ipcRenderer.invoke('recent:clear');
  },

  // ============================================
  // Zoom
  // ============================================
  getZoomLevel: (): Promise<number> => {
    return ipcRenderer.invoke('zoom:get');
  },

  setZoomLevel: (level: number): Promise<void> => {
    return ipcRenderer.invoke('zoom:set', level);
  },

  // ============================================
  // Progress Bar
  // ============================================
  setProgressBar: (progress: number): Promise<void> => {
    // -1 = indeterminate, 0-1 = percentage, > 1 = hide
    return ipcRenderer.invoke('progress:set', progress);
  },

  // ============================================
  // Power Events
  // ============================================
  isPowerSuspended: (): Promise<boolean> => {
    return ipcRenderer.invoke('power:isSuspended');
  },

  onPowerSuspend: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('power-suspend', handler);
    return () => ipcRenderer.removeListener('power-suspend', handler);
  },

  onPowerResume: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('power-resume', handler);
    return () => ipcRenderer.removeListener('power-resume', handler);
  },

  onReconnectSocket: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('reconnect-socket', handler);
    return () => ipcRenderer.removeListener('reconnect-socket', handler);
  },

  // ============================================
  // Drag & Drop
  // ============================================
  onFilesDropped: (callback: (filePaths: string[]) => void) => {
    const handler = (_: unknown, filePaths: string[]) => callback(filePaths);
    ipcRenderer.on('files-dropped', handler);
    return () => ipcRenderer.removeListener('files-dropped', handler);
  },

  reportFilesDropped: (filePaths: string[]): void => {
    ipcRenderer.send('file:dropped', filePaths);
  },

  // ============================================
  // Local Services
  // ============================================
  localServices: {
    // Status
    getStatus: () => ipcRenderer.invoke('local-services:get-status'),

    // Events
    onStatusUpdate: (callback: (status: unknown) => void) => {
      const handler = (_: unknown, status: unknown) => callback(status);
      ipcRenderer.on('local-services:status-update', handler);
      return () => ipcRenderer.removeListener('local-services:status-update', handler);
    },
    onShowSetup: (callback: () => void) => {
      const handler = () => callback();
      ipcRenderer.on('show-local-services-setup', handler);
      return () => ipcRenderer.removeListener('show-local-services-setup', handler);
    },
    onOffline: (callback: () => void) => {
      const handler = () => callback();
      ipcRenderer.on('local-services:offline', handler);
      return () => ipcRenderer.removeListener('local-services:offline', handler);
    },
    onOnline: (callback: () => void) => {
      const handler = () => callback();
      ipcRenderer.on('local-services:online', handler);
      return () => ipcRenderer.removeListener('local-services:online', handler);
    },

    // Docker
    docker: {
      getInfo: () => ipcRenderer.invoke('local-services:docker:get-info'),
      getInstallGuide: () => ipcRenderer.invoke('local-services:docker:get-install-guide'),
      start: () => ipcRenderer.invoke('local-services:docker:start'),
      pullImage: (imageName: string) =>
        ipcRenderer.invoke('local-services:docker:pull-image', imageName),
      onStatusChange: (callback: (status: unknown) => void) => {
        const handler = (_: unknown, status: unknown) => callback(status);
        ipcRenderer.on('local-services:docker-status', handler);
        return () => ipcRenderer.removeListener('local-services:docker-status', handler);
      },
    },

    // Local Pod
    localPod: {
      getConfig: () => ipcRenderer.invoke('local-services:local-pod:get-config'),
      updateConfig: (updates: unknown) =>
        ipcRenderer.invoke('local-services:local-pod:update-config', updates),
      start: () => ipcRenderer.invoke('local-services:local-pod:start'),
      stop: () => ipcRenderer.invoke('local-services:local-pod:stop'),
      restart: () => ipcRenderer.invoke('local-services:local-pod:restart'),
      getLogs: (limit?: number) => ipcRenderer.invoke('local-services:local-pod:get-logs', limit),
      isAvailable: () => ipcRenderer.invoke('local-services:local-pod:is-available'),
      onStatusChange: (callback: (status: unknown) => void) => {
        const handler = (_: unknown, status: unknown) => callback(status);
        ipcRenderer.on('local-services:local-pod-status', handler);
        return () => ipcRenderer.removeListener('local-services:local-pod-status', handler);
      },
      onLog: (callback: (entry: unknown) => void) => {
        const handler = (_: unknown, entry: unknown) => callback(entry);
        ipcRenderer.on('local-services:local-pod-log', handler);
        return () => ipcRenderer.removeListener('local-services:local-pod-log', handler);
      },
    },

    // Ollama
    ollama: {
      getConfig: () => ipcRenderer.invoke('local-services:ollama:get-config'),
      updateConfig: (updates: unknown) =>
        ipcRenderer.invoke('local-services:ollama:update-config', updates),
      getInfo: () => ipcRenderer.invoke('local-services:ollama:get-info'),
      getInstallGuide: () => ipcRenderer.invoke('local-services:ollama:get-install-guide'),
      getRecommendedModels: () =>
        ipcRenderer.invoke('local-services:ollama:get-recommended-models'),
      start: () => ipcRenderer.invoke('local-services:ollama:start'),
      pullModel: (modelName: string) =>
        ipcRenderer.invoke('local-services:ollama:pull-model', modelName),
      deleteModel: (modelName: string) =>
        ipcRenderer.invoke('local-services:ollama:delete-model', modelName),
      connectBridge: (cloudUrl: string, authToken: string) =>
        ipcRenderer.invoke('local-services:ollama:connect-bridge', cloudUrl, authToken),
      disconnectBridge: () => ipcRenderer.invoke('local-services:ollama:disconnect-bridge'),
      onStatusChange: (callback: (info: unknown) => void) => {
        const handler = (_: unknown, info: unknown) => callback(info);
        ipcRenderer.on('local-services:ollama-status', handler);
        return () => ipcRenderer.removeListener('local-services:ollama-status', handler);
      },
      onBridgeStatusChange: (callback: (status: unknown) => void) => {
        const handler = (_: unknown, status: unknown) => callback(status);
        ipcRenderer.on('local-services:ollama-bridge-status', handler);
        return () => ipcRenderer.removeListener('local-services:ollama-bridge-status', handler);
      },
      onPullProgress: (callback: (progress: unknown) => void) => {
        const handler = (_: unknown, progress: unknown) => callback(progress);
        ipcRenderer.on('local-services:ollama-pull-progress', handler);
        return () => ipcRenderer.removeListener('local-services:ollama-pull-progress', handler);
      },
    },

    // LM Studio
    lmstudio: {
      getConfig: () => ipcRenderer.invoke('local-services:lmstudio:get-config'),
      updateConfig: (updates: unknown) =>
        ipcRenderer.invoke('local-services:lmstudio:update-config', updates),
      getInfo: () => ipcRenderer.invoke('local-services:lmstudio:get-info'),
      getInstallGuide: () => ipcRenderer.invoke('local-services:lmstudio:get-install-guide'),
      start: () => ipcRenderer.invoke('local-services:lmstudio:start'),
      connectBridge: (cloudUrl: string, authToken: string) =>
        ipcRenderer.invoke('local-services:lmstudio:connect-bridge', cloudUrl, authToken),
      disconnectBridge: () => ipcRenderer.invoke('local-services:lmstudio:disconnect-bridge'),
      onStatusChange: (callback: (info: unknown) => void) => {
        const handler = (_: unknown, info: unknown) => callback(info);
        ipcRenderer.on('local-services:lmstudio-status', handler);
        return () => ipcRenderer.removeListener('local-services:lmstudio-status', handler);
      },
      onBridgeStatusChange: (callback: (status: unknown) => void) => {
        const handler = (_: unknown, status: unknown) => callback(status);
        ipcRenderer.on('local-services:lmstudio-bridge-status', handler);
        return () => ipcRenderer.removeListener('local-services:lmstudio-bridge-status', handler);
      },
    },

    // Offline Cache
    cache: {
      getConfig: () => ipcRenderer.invoke('local-services:cache:get-config'),
      updateConfig: (updates: unknown) =>
        ipcRenderer.invoke('local-services:cache:update-config', updates),
      getStats: () => ipcRenderer.invoke('local-services:cache:get-stats'),
      getSessions: () => ipcRenderer.invoke('local-services:cache:get-sessions'),
      getSession: (sessionId: string) =>
        ipcRenderer.invoke('local-services:cache:get-session', sessionId),
      cacheSession: (session: unknown) =>
        ipcRenderer.invoke('local-services:cache:cache-session', session),
      getSessionFiles: (sessionId: string) =>
        ipcRenderer.invoke('local-services:cache:get-session-files', sessionId),
      getFileContent: (sessionId: string, filePath: string) =>
        ipcRenderer.invoke('local-services:cache:get-file-content', sessionId, filePath),
      clear: () => ipcRenderer.invoke('local-services:cache:clear'),
      setOnlineStatus: (online: boolean) =>
        ipcRenderer.invoke('local-services:cache:set-online', online),
    },

    // Guided Setup
    setup: {
      getState: () => ipcRenderer.invoke('local-services:setup:get-state'),
      start: () => ipcRenderer.invoke('local-services:setup:start'),
      next: () => ipcRenderer.invoke('local-services:setup:next'),
      previous: () => ipcRenderer.invoke('local-services:setup:previous'),
      skip: () => ipcRenderer.invoke('local-services:setup:skip'),
      setLLMChoice: (choice: 'ollama' | 'lmstudio' | 'none') =>
        ipcRenderer.invoke('local-services:setup:set-llm-choice', choice),
      checkStep: () => ipcRenderer.invoke('local-services:setup:check-step'),
      reset: () => ipcRenderer.invoke('local-services:setup:reset'),
      onStateChange: (callback: (state: unknown) => void) => {
        const handler = (_: unknown, state: unknown) => callback(state);
        ipcRenderer.on('local-services:setup-state', handler);
        return () => ipcRenderer.removeListener('local-services:setup-state', handler);
      },
      onComplete: (callback: () => void) => {
        const handler = () => callback();
        ipcRenderer.on('local-services:setup-complete', handler);
        return () => ipcRenderer.removeListener('local-services:setup-complete', handler);
      },
    },
  },

  // ============================================
  // Generic IPC (for future use)
  // ============================================
  send: (channel: string, data: unknown) => {
    const validChannels = ['toMain'];
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
    }
  },

  receive: (channel: string, func: (...args: unknown[]) => void) => {
    const validChannels = ['fromMain'];
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (_, ...args) => func(...args));
    }
  },
});

// ============================================
// Setup offline detection in renderer
// ============================================
window.addEventListener('online', () => {
  ipcRenderer.send('network:statusChanged', true);
});

window.addEventListener('offline', () => {
  ipcRenderer.send('network:statusChanged', false);
});

// ============================================
// Type Declarations
// ============================================
declare global {
  interface Window {
    electronAPI: {
      // Platform info
      platform: NodeJS.Platform;
      isElectron: boolean;
      versions: {
        node: string;
        chrome: string;
        electron: string;
      };

      // Native dialogs
      openDirectory: () => Promise<string | null>;
      openFile: (options?: {
        filters?: { name: string; extensions: string[] }[];
      }) => Promise<string | null>;
      saveFile: (options?: {
        defaultPath?: string;
        filters?: { name: string; extensions: string[] }[];
      }) => Promise<string | null>;

      // Auto updates
      checkForUpdates: () => Promise<{
        updateAvailable: boolean;
        version?: string;
        error?: string;
        message?: string;
      }>;
      onUpdateStatus: (callback: (message: string) => void) => () => void;

      // Deep linking
      onDeepLink: (
        callback: (data: {
          action: string;
          params: string[];
          query: Record<string, string>;
        }) => void
      ) => () => void;

      // App info
      getVersion: () => Promise<string>;

      // Settings
      getSetting: (key: string) => Promise<unknown>;
      setSetting: (key: string, value: unknown) => Promise<void>;
      getApiUrl: () => Promise<string>;

      // Badge
      setBadge: (count: number) => Promise<void>;

      // Logging
      getLogPath: () => Promise<string>;
      openLogFile: () => Promise<void>;

      // Network
      reportNetworkStatus: (online: boolean) => void;

      // Menu events
      onNewSession: (callback: () => void) => () => void;
      onOpenWorkspace: (callback: (path: string) => void) => () => void;
      onOpenSettings: (callback: () => void) => () => void;
      onOpenSearch: (callback: () => void) => () => void;
      onToggleSidebar: (callback: () => void) => () => void;
      onToggleTerminal: (callback: () => void) => () => void;
      onOpenFilePicker: (callback: () => void) => () => void;
      onOpenCommandPalette: (callback: () => void) => () => void;
      onNavigate: (callback: (path: string) => void) => () => void;

      // Recent Workspaces
      getRecentWorkspaces: () => Promise<Array<{ path: string; name: string; lastOpened: number }>>;
      addRecentWorkspace: (workspacePath: string) => Promise<void>;
      clearRecentWorkspaces: () => Promise<void>;

      // Zoom
      getZoomLevel: () => Promise<number>;
      setZoomLevel: (level: number) => Promise<void>;

      // Progress Bar
      setProgressBar: (progress: number) => Promise<void>;

      // Power Events
      isPowerSuspended: () => Promise<boolean>;
      onPowerSuspend: (callback: () => void) => () => void;
      onPowerResume: (callback: () => void) => () => void;
      onReconnectSocket: (callback: () => void) => () => void;

      // Drag & Drop
      onFilesDropped: (callback: (filePaths: string[]) => void) => () => void;
      reportFilesDropped: (filePaths: string[]) => void;

      // Local Services
      localServices: {
        getStatus: () => Promise<unknown>;
        onStatusUpdate: (callback: (status: unknown) => void) => () => void;
        onShowSetup: (callback: () => void) => () => void;
        onOffline: (callback: () => void) => () => void;
        onOnline: (callback: () => void) => () => void;

        docker: {
          getInfo: () => Promise<unknown>;
          getInstallGuide: () => Promise<unknown>;
          start: () => Promise<boolean>;
          pullImage: (imageName: string) => Promise<boolean>;
          onStatusChange: (callback: (status: unknown) => void) => () => void;
        };

        localPod: {
          getConfig: () => Promise<unknown>;
          updateConfig: (updates: unknown) => Promise<void>;
          start: () => Promise<{ success: boolean; error?: string }>;
          stop: () => Promise<void>;
          restart: () => Promise<{ success: boolean; error?: string }>;
          getLogs: (limit?: number) => Promise<unknown[]>;
          isAvailable: () => Promise<{ available: boolean; source: string }>;
          onStatusChange: (callback: (status: unknown) => void) => () => void;
          onLog: (callback: (entry: unknown) => void) => () => void;
        };

        ollama: {
          getConfig: () => Promise<unknown>;
          updateConfig: (updates: unknown) => Promise<void>;
          getInfo: () => Promise<unknown>;
          getInstallGuide: () => Promise<unknown>;
          getRecommendedModels: () => Promise<unknown[]>;
          start: () => Promise<boolean>;
          pullModel: (modelName: string) => Promise<boolean>;
          deleteModel: (modelName: string) => Promise<boolean>;
          connectBridge: (cloudUrl: string, authToken: string) => Promise<boolean>;
          disconnectBridge: () => Promise<void>;
          onStatusChange: (callback: (info: unknown) => void) => () => void;
          onBridgeStatusChange: (callback: (status: unknown) => void) => () => void;
          onPullProgress: (callback: (progress: unknown) => void) => () => void;
        };

        lmstudio: {
          getConfig: () => Promise<unknown>;
          updateConfig: (updates: unknown) => Promise<void>;
          getInfo: () => Promise<unknown>;
          getInstallGuide: () => Promise<unknown>;
          start: () => Promise<boolean>;
          connectBridge: (cloudUrl: string, authToken: string) => Promise<boolean>;
          disconnectBridge: () => Promise<void>;
          onStatusChange: (callback: (info: unknown) => void) => () => void;
          onBridgeStatusChange: (callback: (status: unknown) => void) => () => void;
        };

        cache: {
          getConfig: () => Promise<unknown>;
          updateConfig: (updates: unknown) => Promise<void>;
          getStats: () => Promise<unknown>;
          getSessions: () => Promise<unknown[]>;
          getSession: (sessionId: string) => Promise<unknown>;
          cacheSession: (session: unknown) => Promise<void>;
          getSessionFiles: (sessionId: string) => Promise<unknown[]>;
          getFileContent: (sessionId: string, filePath: string) => Promise<string | null>;
          clear: () => Promise<void>;
          setOnlineStatus: (online: boolean) => Promise<void>;
        };

        setup: {
          getState: () => Promise<unknown>;
          start: () => Promise<void>;
          next: () => Promise<void>;
          previous: () => Promise<void>;
          skip: () => Promise<void>;
          setLLMChoice: (choice: 'ollama' | 'lmstudio' | 'none') => Promise<void>;
          checkStep: () => Promise<void>;
          reset: () => Promise<void>;
          onStateChange: (callback: (state: unknown) => void) => () => void;
          onComplete: (callback: () => void) => () => void;
        };
      };

      // Generic IPC
      send: (channel: string, data: unknown) => void;
      receive: (channel: string, func: (...args: unknown[]) => void) => void;
    };
  }
}
