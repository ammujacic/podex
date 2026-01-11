/**
 * LSP Client
 *
 * WebSocket-based Language Server Protocol client that communicates
 * with language servers running in workspace containers.
 */

// ============================================================================
// Types (LSP Protocol)
// ============================================================================

export interface Position {
  line: number;
  character: number;
}

export interface Range {
  start: Position;
  end: Position;
}

export interface Location {
  uri: string;
  range: Range;
}

export interface TextDocumentIdentifier {
  uri: string;
}

export interface TextDocumentPositionParams {
  textDocument: TextDocumentIdentifier;
  position: Position;
}

export interface CompletionItem {
  label: string;
  kind?: number;
  detail?: string;
  documentation?: string | { kind: string; value: string };
  insertText?: string;
  insertTextFormat?: number;
  textEdit?: {
    range: Range;
    newText: string;
  };
}

export interface CompletionList {
  isIncomplete: boolean;
  items: CompletionItem[];
}

export interface Hover {
  contents:
    | string
    | { kind: string; value: string }
    | Array<string | { kind: string; value: string }>;
  range?: Range;
}

export interface Diagnostic {
  range: Range;
  severity?: number;
  code?: string | number;
  source?: string;
  message: string;
  relatedInformation?: Array<{
    location: Location;
    message: string;
  }>;
}

export interface PublishDiagnosticsParams {
  uri: string;
  diagnostics: Diagnostic[];
}

export interface SignatureHelp {
  signatures: Array<{
    label: string;
    documentation?: string;
    parameters?: Array<{
      label: string | [number, number];
      documentation?: string;
    }>;
  }>;
  activeSignature?: number;
  activeParameter?: number;
}

// ============================================================================
// LSP Client Configuration
// ============================================================================

export interface LspClientConfig {
  wsUrl: string;
  workspaceId: string;
  language: string;
  rootUri: string;
  onDiagnostics?: (params: PublishDiagnosticsParams) => void;
  onError?: (error: Error) => void;
  onConnectionChange?: (connected: boolean) => void;
}

// ============================================================================
// JSON-RPC Types
// ============================================================================

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: unknown;
}

interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

// ============================================================================
// LSP Client Class
// ============================================================================

export class LspClient {
  private config: LspClientConfig;
  private socket: WebSocket | null = null;
  private requestId = 0;
  private pendingRequests = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();
  private _initialized = false;
  private documentVersions = new Map<string, number>();

  /** Get initialization state */
  get isInitialized(): boolean {
    return this._initialized;
  }
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;

  constructor(config: LspClientConfig) {
    this.config = config;
  }

  /**
   * Connect to the LSP server
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const wsUrl = `${this.config.wsUrl}/lsp/${this.config.workspaceId}/${this.config.language}`;

      this.socket = new WebSocket(wsUrl);

      this.socket.onopen = async () => {
        this.reconnectAttempts = 0;
        this.config.onConnectionChange?.(true);

        try {
          await this.initialize();
          resolve();
        } catch (error) {
          reject(error);
        }
      };

      this.socket.onmessage = (event) => {
        this.handleMessage(event.data);
      };

      this.socket.onerror = (event) => {
        console.error('LSP WebSocket error:', event);
        this.config.onError?.(new Error('WebSocket error'));
      };

      this.socket.onclose = () => {
        this.config.onConnectionChange?.(false);
        this.handleDisconnect();
      };

      // Timeout for initial connection
      setTimeout(() => {
        if (this.socket?.readyState !== WebSocket.OPEN) {
          reject(new Error('Connection timeout'));
        }
      }, 10000);
    });
  }

  /**
   * Disconnect from the LSP server
   */
  disconnect(): void {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this._initialized = false;
    this.pendingRequests.forEach(({ reject, timeout }) => {
      clearTimeout(timeout);
      reject(new Error('Client disconnected'));
    });
    this.pendingRequests.clear();
  }

  /**
   * Handle WebSocket disconnection
   */
  private handleDisconnect(): void {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      setTimeout(() => {
        this.connect().catch(console.error);
      }, this.reconnectDelay * this.reconnectAttempts);
    }
  }

  /**
   * Handle incoming message
   */
  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data);

      if ('id' in message && message.id !== undefined) {
        // Response to a request
        const pending = this.pendingRequests.get(message.id);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pendingRequests.delete(message.id);

          if (message.error) {
            pending.reject(new Error(message.error.message));
          } else {
            pending.resolve(message.result);
          }
        }
      } else if ('method' in message) {
        // Server notification
        this.handleNotification(message as JsonRpcNotification);
      }
    } catch (error) {
      console.error('Failed to parse LSP message:', error);
    }
  }

  /**
   * Handle server notification
   */
  private handleNotification(notification: JsonRpcNotification): void {
    switch (notification.method) {
      case 'textDocument/publishDiagnostics':
        this.config.onDiagnostics?.(notification.params as PublishDiagnosticsParams);
        break;
      case 'window/logMessage':
        // LSP log message received
        break;
      default:
        // Ignore unknown notifications
        break;
    }
  }

  /**
   * Send a request and wait for response
   */
  private async sendRequest<T>(method: string, params?: unknown): Promise<T> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected to LSP server');
    }

    const id = ++this.requestId;
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, 30000);

      this.pendingRequests.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout,
      });

      this.socket!.send(JSON.stringify(request));
    });
  }

  /**
   * Send a notification (no response expected)
   */
  private sendNotification(method: string, params?: unknown): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    const notification: JsonRpcNotification = {
      jsonrpc: '2.0',
      method,
      params,
    };

    this.socket.send(JSON.stringify(notification));
  }

  // ==========================================================================
  // LSP Protocol Methods
  // ==========================================================================

  /**
   * Initialize the LSP session
   */
  private async initialize(): Promise<void> {
    const result = await this.sendRequest('initialize', {
      processId: null,
      rootUri: this.config.rootUri,
      capabilities: {
        textDocument: {
          synchronization: {
            dynamicRegistration: true,
            willSave: true,
            didSave: true,
            willSaveWaitUntil: true,
          },
          completion: {
            dynamicRegistration: true,
            completionItem: {
              snippetSupport: true,
              documentationFormat: ['markdown', 'plaintext'],
              resolveSupport: { properties: ['documentation', 'detail'] },
            },
          },
          hover: {
            dynamicRegistration: true,
            contentFormat: ['markdown', 'plaintext'],
          },
          signatureHelp: {
            dynamicRegistration: true,
            signatureInformation: {
              documentationFormat: ['markdown', 'plaintext'],
            },
          },
          definition: { dynamicRegistration: true },
          references: { dynamicRegistration: true },
          documentHighlight: { dynamicRegistration: true },
          documentSymbol: { dynamicRegistration: true },
          formatting: { dynamicRegistration: true },
          rangeFormatting: { dynamicRegistration: true },
          rename: { dynamicRegistration: true, prepareSupport: true },
          publishDiagnostics: { relatedInformation: true },
        },
        workspace: {
          workspaceFolders: true,
          didChangeConfiguration: { dynamicRegistration: true },
        },
      },
      workspaceFolders: [{ uri: this.config.rootUri, name: 'workspace' }],
    });

    // Send initialized notification
    this.sendNotification('initialized', {});
    this._initialized = true;

    return result as void;
  }

  /**
   * Notify that a document was opened
   */
  didOpen(uri: string, languageId: string, text: string): void {
    this.documentVersions.set(uri, 1);
    this.sendNotification('textDocument/didOpen', {
      textDocument: {
        uri,
        languageId,
        version: 1,
        text,
      },
    });
  }

  /**
   * Notify that a document was changed
   */
  didChange(uri: string, text: string): void {
    const version = (this.documentVersions.get(uri) || 0) + 1;
    this.documentVersions.set(uri, version);

    this.sendNotification('textDocument/didChange', {
      textDocument: { uri, version },
      contentChanges: [{ text }],
    });
  }

  /**
   * Notify that a document was saved
   */
  didSave(uri: string, text?: string): void {
    this.sendNotification('textDocument/didSave', {
      textDocument: { uri },
      text,
    });
  }

  /**
   * Notify that a document was closed
   */
  didClose(uri: string): void {
    this.documentVersions.delete(uri);
    this.sendNotification('textDocument/didClose', {
      textDocument: { uri },
    });
  }

  /**
   * Get completions at position
   */
  async getCompletions(
    uri: string,
    position: Position
  ): Promise<CompletionList | CompletionItem[]> {
    return this.sendRequest('textDocument/completion', {
      textDocument: { uri },
      position,
    });
  }

  /**
   * Resolve completion item details
   */
  async resolveCompletion(item: CompletionItem): Promise<CompletionItem> {
    return this.sendRequest('completionItem/resolve', item);
  }

  /**
   * Get hover information
   */
  async getHover(uri: string, position: Position): Promise<Hover | null> {
    return this.sendRequest('textDocument/hover', {
      textDocument: { uri },
      position,
    });
  }

  /**
   * Get signature help
   */
  async getSignatureHelp(uri: string, position: Position): Promise<SignatureHelp | null> {
    return this.sendRequest('textDocument/signatureHelp', {
      textDocument: { uri },
      position,
    });
  }

  /**
   * Go to definition
   */
  async getDefinition(uri: string, position: Position): Promise<Location | Location[] | null> {
    return this.sendRequest('textDocument/definition', {
      textDocument: { uri },
      position,
    });
  }

  /**
   * Find references
   */
  async getReferences(
    uri: string,
    position: Position,
    includeDeclaration = true
  ): Promise<Location[]> {
    return this.sendRequest('textDocument/references', {
      textDocument: { uri },
      position,
      context: { includeDeclaration },
    });
  }

  /**
   * Get document symbols
   */
  async getDocumentSymbols(uri: string): Promise<unknown[]> {
    return this.sendRequest('textDocument/documentSymbol', {
      textDocument: { uri },
    });
  }

  /**
   * Rename symbol
   */
  async rename(uri: string, position: Position, newName: string): Promise<unknown> {
    return this.sendRequest('textDocument/rename', {
      textDocument: { uri },
      position,
      newName,
    });
  }

  /**
   * Format document
   */
  async formatDocument(uri: string): Promise<unknown[]> {
    return this.sendRequest('textDocument/formatting', {
      textDocument: { uri },
      options: {
        tabSize: 2,
        insertSpaces: true,
      },
    });
  }
}

// ============================================================================
// LSP Client Manager
// ============================================================================

const clients = new Map<string, LspClient>();

export function getLspClient(workspaceId: string, language: string): LspClient | undefined {
  return clients.get(`${workspaceId}:${language}`);
}

export function createLspClient(config: LspClientConfig): LspClient {
  const key = `${config.workspaceId}:${config.language}`;

  // Disconnect existing client if any
  const existing = clients.get(key);
  if (existing) {
    existing.disconnect();
  }

  const client = new LspClient(config);
  clients.set(key, client);
  return client;
}

export function disconnectLspClient(workspaceId: string, language: string): void {
  const key = `${workspaceId}:${language}`;
  const client = clients.get(key);
  if (client) {
    client.disconnect();
    clients.delete(key);
  }
}

export function disconnectAllLspClients(): void {
  for (const client of clients.values()) {
    client.disconnect();
  }
  clients.clear();
}
