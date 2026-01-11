import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  ExtensionManifest,
  ExtensionInfo,
  ExtensionMessage,
  ApiCallMessage,
  ApiResponseMessage,
  ActivationEvent,
} from './types';

// ============================================================================
// Extension Sandbox (Iframe-based isolation)
// ============================================================================

class ExtensionSandbox {
  private iframe: HTMLIFrameElement | null = null;
  private messagePort: MessagePort | null = null;
  private pendingRequests: Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  > = new Map();
  private eventListeners: Map<string, Set<(data: unknown) => void>> = new Map();
  private readyPromise: Promise<void>;
  private readyResolve!: () => void;

  constructor(
    private extensionId: string,
    private extensionCode: string,
    private permissions: string[],
    private onApiCall: (namespace: string, method: string, args: unknown[]) => Promise<unknown>
  ) {
    this.readyPromise = new Promise((resolve) => {
      this.readyResolve = resolve;
    });
    // Store permissions for future permission checks
    void this.permissions;
  }

  async initialize(): Promise<void> {
    // Create a blob URL with the sandboxed extension code
    const sandboxHtml = this.createSandboxHtml();
    const blob = new Blob([sandboxHtml], { type: 'text/html' });
    const blobUrl = URL.createObjectURL(blob);

    // Create iframe with strict sandbox
    this.iframe = document.createElement('iframe');
    this.iframe.style.display = 'none';
    this.iframe.sandbox.add('allow-scripts');
    // Note: NOT adding allow-same-origin for true isolation
    this.iframe.src = blobUrl;

    // Set up message channel
    const channel = new MessageChannel();
    this.messagePort = channel.port1;

    this.messagePort.onmessage = (event) => {
      this.handleMessage(event.data);
    };

    // Wait for iframe to load
    await new Promise<void>((resolve, reject) => {
      if (!this.iframe) return reject(new Error('Iframe not created'));

      this.iframe.onload = () => {
        // Transfer the message port to the iframe
        this.iframe!.contentWindow!.postMessage({ type: 'init', port: channel.port2 }, '*', [
          channel.port2,
        ]);
        resolve();
      };

      this.iframe.onerror = () => {
        reject(new Error('Failed to load extension sandbox'));
      };

      document.body.appendChild(this.iframe);
    });

    // Wait for ready signal
    await this.readyPromise;

    // Clean up blob URL
    URL.revokeObjectURL(blobUrl);
  }

  private createSandboxHtml(): string {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline';">
</head>
<body>
<script>
(function() {
  'use strict';

  let port = null;
  let requestId = 0;
  const pendingCalls = new Map();
  const disposables = [];

  // Receive the message port
  window.addEventListener('message', function(event) {
    if (event.data && event.data.type === 'init' && event.data.port) {
      port = event.data.port;
      port.onmessage = handleMessage;
      port.postMessage({ type: 'ready', extensionId: '${this.extensionId}' });
    }
  });

  function handleMessage(event) {
    const msg = event.data;

    if (msg.type === 'activate') {
      activateExtension();
    } else if (msg.type === 'deactivate') {
      deactivateExtension();
    } else if (msg.type === 'api-response') {
      const pending = pendingCalls.get(msg.requestId);
      if (pending) {
        pendingCalls.delete(msg.requestId);
        if (msg.error) {
          pending.reject(new Error(msg.error));
        } else {
          pending.resolve(msg.payload);
        }
      }
    } else if (msg.type === 'event') {
      // Handle events from host
      const handlers = eventHandlers.get(msg.payload.eventName);
      if (handlers) {
        handlers.forEach(h => h(msg.payload.data));
      }
    }
  }

  function callApi(namespace, method, args) {
    return new Promise((resolve, reject) => {
      const id = 'req_' + (++requestId);
      pendingCalls.set(id, { resolve, reject });
      port.postMessage({
        type: 'api-call',
        extensionId: '${this.extensionId}',
        requestId: id,
        payload: { namespace, method, args }
      });
    });
  }

  const eventHandlers = new Map();

  function createEvent(eventName) {
    return function(listener, thisArg, disposableArray) {
      if (!eventHandlers.has(eventName)) {
        eventHandlers.set(eventName, new Set());
      }
      const boundListener = thisArg ? listener.bind(thisArg) : listener;
      eventHandlers.get(eventName).add(boundListener);

      const disposable = {
        dispose: function() {
          eventHandlers.get(eventName)?.delete(boundListener);
        }
      };

      if (disposableArray) {
        disposableArray.push(disposable);
      }

      return disposable;
    };
  }

  // Create the podex API object
  const podex = {
    version: '1.0.0',

    window: {
      showInformationMessage: (...args) => callApi('window', 'showInformationMessage', args),
      showWarningMessage: (...args) => callApi('window', 'showWarningMessage', args),
      showErrorMessage: (...args) => callApi('window', 'showErrorMessage', args),
      showQuickPick: (...args) => callApi('window', 'showQuickPick', args),
      showInputBox: (...args) => callApi('window', 'showInputBox', args),
      createStatusBarItem: (...args) => callApi('window', 'createStatusBarItem', args),
      createOutputChannel: (...args) => callApi('window', 'createOutputChannel', args),
      get activeTextEditor() { return null; }, // Async via callApi
      onDidChangeActiveTextEditor: createEvent('window.onDidChangeActiveTextEditor'),
    },

    workspace: {
      openTextDocument: (...args) => callApi('workspace', 'openTextDocument', args),
      getConfiguration: (...args) => callApi('workspace', 'getConfiguration', args),
      findFiles: (...args) => callApi('workspace', 'findFiles', args),
      onDidOpenTextDocument: createEvent('workspace.onDidOpenTextDocument'),
      onDidCloseTextDocument: createEvent('workspace.onDidCloseTextDocument'),
      onDidSaveTextDocument: createEvent('workspace.onDidSaveTextDocument'),
      onDidChangeConfiguration: createEvent('workspace.onDidChangeConfiguration'),
      fs: {
        readFile: (...args) => callApi('workspace.fs', 'readFile', args),
        writeFile: (...args) => callApi('workspace.fs', 'writeFile', args),
        stat: (...args) => callApi('workspace.fs', 'stat', args),
        readDirectory: (...args) => callApi('workspace.fs', 'readDirectory', args),
        delete: (...args) => callApi('workspace.fs', 'delete', args),
        rename: (...args) => callApi('workspace.fs', 'rename', args),
        createDirectory: (...args) => callApi('workspace.fs', 'createDirectory', args),
      }
    },

    languages: {
      createDiagnosticCollection: (...args) => callApi('languages', 'createDiagnosticCollection', args),
      registerCompletionItemProvider: (...args) => callApi('languages', 'registerCompletionItemProvider', args),
      registerHoverProvider: (...args) => callApi('languages', 'registerHoverProvider', args),
      registerDefinitionProvider: (...args) => callApi('languages', 'registerDefinitionProvider', args),
    },

    commands: {
      registerCommand: (...args) => callApi('commands', 'registerCommand', args),
      executeCommand: (...args) => callApi('commands', 'executeCommand', args),
      getCommands: (...args) => callApi('commands', 'getCommands', args),
    },

    env: {
      appName: 'Podex',
      language: navigator.language,
      clipboard: {
        readText: () => callApi('env.clipboard', 'readText', []),
        writeText: (text) => callApi('env.clipboard', 'writeText', [text]),
      }
    }
  };

  // Extension context
  const context = {
    extensionId: '${this.extensionId}',
    subscriptions: disposables,
    globalState: {
      get: (key) => callApi('context.globalState', 'get', [key]),
      update: (key, value) => callApi('context.globalState', 'update', [key, value]),
      keys: () => callApi('context.globalState', 'keys', []),
    },
    workspaceState: {
      get: (key) => callApi('context.workspaceState', 'get', [key]),
      update: (key, value) => callApi('context.workspaceState', 'update', [key, value]),
      keys: () => callApi('context.workspaceState', 'keys', []),
    },
    log: (...args) => console.log('[${this.extensionId}]', ...args),
    warn: (...args) => console.warn('[${this.extensionId}]', ...args),
    error: (...args) => console.error('[${this.extensionId}]', ...args),
  };

  // The extension's activate function
  let extensionExports = null;

  function activateExtension() {
    try {
      // Extension code is injected here
      const extensionModule = (function(podex, context) {
        ${this.extensionCode}
      })(podex, context);

      if (extensionModule && typeof extensionModule.activate === 'function') {
        const result = extensionModule.activate(context);
        if (result && result.then) {
          result.then(exports => {
            extensionExports = exports;
            port.postMessage({ type: 'activated', extensionId: '${this.extensionId}' });
          }).catch(err => {
            port.postMessage({ type: 'error', extensionId: '${this.extensionId}', error: err.message });
          });
        } else {
          extensionExports = result;
          port.postMessage({ type: 'activated', extensionId: '${this.extensionId}' });
        }
      } else {
        port.postMessage({ type: 'activated', extensionId: '${this.extensionId}' });
      }
    } catch (err) {
      port.postMessage({ type: 'error', extensionId: '${this.extensionId}', error: err.message });
    }
  }

  function deactivateExtension() {
    try {
      // Dispose all subscriptions
      disposables.forEach(d => {
        if (d && typeof d.dispose === 'function') {
          d.dispose();
        }
      });
      disposables.length = 0;

      // Call deactivate if exists
      if (extensionExports && typeof extensionExports.deactivate === 'function') {
        extensionExports.deactivate();
      }

      port.postMessage({ type: 'deactivated', extensionId: '${this.extensionId}' });
    } catch (err) {
      port.postMessage({ type: 'error', extensionId: '${this.extensionId}', error: err.message });
    }
  }
})();
</script>
</body>
</html>`;
  }

  private handleMessage(message: ExtensionMessage): void {
    switch (message.type) {
      case 'ready':
        this.readyResolve();
        break;

      case 'api-call':
        this.handleApiCall(message as ApiCallMessage);
        break;

      case 'activate':
      case 'deactivate':
      case 'error': {
        // Emit events for these
        const listeners = this.eventListeners.get(message.type);
        if (listeners) {
          listeners.forEach((fn) => fn(message));
        }
        break;
      }
    }
  }

  private async handleApiCall(message: ApiCallMessage): Promise<void> {
    const { requestId, payload } = message;
    const { namespace, method, args } = payload;

    try {
      const result = await this.onApiCall(namespace, method, args);

      this.messagePort?.postMessage({
        type: 'api-response',
        extensionId: this.extensionId,
        requestId,
        payload: result,
      } as ApiResponseMessage);
    } catch (error) {
      this.messagePort?.postMessage({
        type: 'api-response',
        extensionId: this.extensionId,
        requestId,
        error: error instanceof Error ? error.message : 'Unknown error',
      } as ApiResponseMessage);
    }
  }

  async activate(): Promise<void> {
    this.messagePort?.postMessage({
      type: 'activate',
      extensionId: this.extensionId,
    });
  }

  async deactivate(): Promise<void> {
    this.messagePort?.postMessage({
      type: 'deactivate',
      extensionId: this.extensionId,
    });
  }

  sendEvent(eventName: string, data: unknown): void {
    this.messagePort?.postMessage({
      type: 'event',
      extensionId: this.extensionId,
      payload: { eventName, data },
    });
  }

  on(event: string, callback: (data: unknown) => void): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(callback);
  }

  dispose(): void {
    this.messagePort?.close();
    this.iframe?.remove();
    this.eventListeners.clear();
    this.pendingRequests.clear();
  }
}

// ============================================================================
// Extension Host Store
// ============================================================================

interface ExtensionHostState {
  extensions: Record<string, ExtensionInfo>;
  registeredCommands: Map<string, (...args: unknown[]) => unknown>;
  activationEvents: Map<string, string[]>; // event -> extension ids

  // Actions
  installExtension: (manifest: ExtensionManifest, code: string) => Promise<void>;
  uninstallExtension: (extensionId: string) => Promise<void>;
  enableExtension: (extensionId: string) => Promise<void>;
  disableExtension: (extensionId: string) => Promise<void>;
  activateExtension: (extensionId: string) => Promise<void>;
  deactivateExtension: (extensionId: string) => Promise<void>;
  getExtension: (extensionId: string) => ExtensionInfo | undefined;
  getAllExtensions: () => ExtensionInfo[];
  triggerActivationEvent: (event: ActivationEvent) => Promise<void>;
}

export const useExtensionHostStore = create<ExtensionHostState>()(
  persist(
    (set, get) => ({
      extensions: {},
      registeredCommands: new Map(),
      activationEvents: new Map(),

      installExtension: async (manifest, code) => {
        const info: ExtensionInfo = {
          manifest,
          state: 'installed',
          installPath: `/extensions/${manifest.id}`,
        };

        // Store extension code (in real app, this would be in IndexedDB or server)
        localStorage.setItem(`ext:${manifest.id}:code`, code);

        // Register activation events
        const events = get().activationEvents;
        manifest.activationEvents.forEach((event) => {
          const ids = events.get(event) || [];
          if (!ids.includes(manifest.id)) {
            ids.push(manifest.id);
            events.set(event, ids);
          }
        });

        set((state) => ({
          extensions: { ...state.extensions, [manifest.id]: info },
          activationEvents: new Map(events),
        }));

        // Auto-enable
        await get().enableExtension(manifest.id);
      },

      uninstallExtension: async (extensionId) => {
        // Deactivate first
        await get().deactivateExtension(extensionId);

        // Remove stored code
        localStorage.removeItem(`ext:${extensionId}:code`);

        // Remove from activation events
        const events = get().activationEvents;
        events.forEach((ids, event) => {
          const filtered = ids.filter((id) => id !== extensionId);
          if (filtered.length === 0) {
            events.delete(event);
          } else {
            events.set(event, filtered);
          }
        });

        set((state) => {
          const { [extensionId]: _, ...rest } = state.extensions;
          return {
            extensions: rest,
            activationEvents: new Map(events),
          };
        });
      },

      enableExtension: async (extensionId) => {
        const ext = get().extensions[extensionId];
        if (!ext || ext.state === 'enabled' || ext.state === 'active') return;

        set((state) => ({
          extensions: {
            ...state.extensions,
            [extensionId]: { ...ext, state: 'enabled' },
          },
        }));

        // Check if should activate immediately
        const manifest = ext.manifest;
        if (manifest.activationEvents.includes('*')) {
          await get().activateExtension(extensionId);
        }
      },

      disableExtension: async (extensionId) => {
        await get().deactivateExtension(extensionId);

        const ext = get().extensions[extensionId];
        if (!ext) return;

        set((state) => ({
          extensions: {
            ...state.extensions,
            [extensionId]: { ...ext, state: 'disabled' },
          },
        }));
      },

      activateExtension: async (extensionId) => {
        const ext = get().extensions[extensionId];
        if (!ext || ext.state === 'active' || ext.state === 'activating') return;

        set((state) => ({
          extensions: {
            ...state.extensions,
            [extensionId]: { ...ext, state: 'activating' },
          },
        }));

        try {
          // Get extension code
          const code = localStorage.getItem(`ext:${extensionId}:code`);
          if (!code) {
            throw new Error('Extension code not found');
          }

          // Create sandbox
          const sandbox = new ExtensionSandbox(
            extensionId,
            code,
            ext.manifest.permissions,
            handleApiCall
          );

          await sandbox.initialize();
          await sandbox.activate();

          // Store sandbox reference
          activeSandboxes.set(extensionId, sandbox);

          set((state) => ({
            extensions: {
              ...state.extensions,
              [extensionId]: {
                ...state.extensions[extensionId],
                state: 'active' as const,
                activatedAt: new Date(),
              } as ExtensionInfo,
            },
          }));
        } catch (error) {
          set((state) => ({
            extensions: {
              ...state.extensions,
              [extensionId]: {
                ...state.extensions[extensionId],
                state: 'error' as const,
                error: error instanceof Error ? error.message : 'Unknown error',
              } as ExtensionInfo,
            },
          }));
        }
      },

      deactivateExtension: async (extensionId) => {
        const sandbox = activeSandboxes.get(extensionId);
        if (sandbox) {
          await sandbox.deactivate();
          sandbox.dispose();
          activeSandboxes.delete(extensionId);
        }

        const ext = get().extensions[extensionId];
        if (!ext) return;

        set((state) => ({
          extensions: {
            ...state.extensions,
            [extensionId]: {
              ...ext,
              state: 'enabled',
              activatedAt: undefined,
            },
          },
        }));
      },

      getExtension: (extensionId) => get().extensions[extensionId],

      getAllExtensions: () => Object.values(get().extensions),

      triggerActivationEvent: async (event) => {
        const extensionIds = get().activationEvents.get(event) || [];

        for (const id of extensionIds) {
          const ext = get().extensions[id];
          if (ext && (ext.state === 'enabled' || ext.state === 'installed')) {
            await get().activateExtension(id);
          }
        }
      },
    }),
    {
      name: 'podex-extensions',
      partialize: (state) => ({
        extensions: state.extensions,
      }),
    }
  )
);

// ============================================================================
// Active Sandboxes
// ============================================================================

const activeSandboxes = new Map<string, ExtensionSandbox>();

// ============================================================================
// API Call Handler
// ============================================================================

async function handleApiCall(namespace: string, method: string, args: unknown[]): Promise<unknown> {
  // Route API calls to the appropriate handler
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handlers: Record<string, Record<string, (...args: any[]) => any>> = {
    window: {
      showInformationMessage: async (message: string, ...items: string[]) => {
        // In real implementation, show a notification
        // Info messages are logged as warnings since console.log is not allowed by linting
        console.warn('[Extension Info]', message);
        return items[0];
      },
      showWarningMessage: async (message: string, ...items: string[]) => {
        console.warn('[Extension]', message);
        return items[0];
      },
      showErrorMessage: async (message: string, ...items: string[]) => {
        console.error('[Extension]', message);
        return items[0];
      },
      showQuickPick: async (items: unknown[]) => {
        // Would show a quick pick UI
        return items[0];
      },
      showInputBox: async () => {
        // Would show an input box
        return '';
      },
    },
    commands: {
      registerCommand: (command: string, callback: (...args: unknown[]) => unknown) => {
        const store = useExtensionHostStore.getState();
        store.registeredCommands.set(command, callback);
        return { dispose: () => store.registeredCommands.delete(command) };
      },
      executeCommand: async (command: string, ...commandArgs: unknown[]) => {
        const store = useExtensionHostStore.getState();
        const handler = store.registeredCommands.get(command);
        if (handler) {
          return handler(...commandArgs);
        }
        throw new Error(`Command not found: ${command}`);
      },
      getCommands: async () => {
        const store = useExtensionHostStore.getState();
        return Array.from(store.registeredCommands.keys());
      },
    },
    'context.globalState': {
      get: (key: string) => {
        return JSON.parse(localStorage.getItem(`ext:globalState:${key}`) || 'null');
      },
      update: (key: string, value: unknown) => {
        localStorage.setItem(`ext:globalState:${key}`, JSON.stringify(value));
      },
      keys: () => {
        const keys: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key?.startsWith('ext:globalState:')) {
            keys.push(key.replace('ext:globalState:', ''));
          }
        }
        return keys;
      },
    },
  };

  const nsHandler = handlers[namespace];
  if (nsHandler && nsHandler[method]) {
    return nsHandler[method](...(args as Parameters<(typeof nsHandler)[typeof method]>));
  }

  throw new Error(`API not implemented: ${namespace}.${method}`);
}

// ============================================================================
// Extension Host Hook
// ============================================================================

export function useExtensionHost() {
  const store = useExtensionHostStore();

  return {
    extensions: store.getAllExtensions(),
    installExtension: store.installExtension,
    uninstallExtension: store.uninstallExtension,
    enableExtension: store.enableExtension,
    disableExtension: store.disableExtension,
    activateExtension: store.activateExtension,
    deactivateExtension: store.deactivateExtension,
    getExtension: store.getExtension,
    triggerActivationEvent: store.triggerActivationEvent,
  };
}
