/**
 * Workspace panel manager for the Podex webview.
 * Handles webview creation, messaging, and lifecycle.
 */

import * as vscode from 'vscode';
import { onSocketEvent, sendApprovalResponse, sendNativeApprovalResponse } from '../services';
import { logDebug, logError } from '../utils/logger';

/**
 * Message types from webview to extension.
 */
interface WebviewMessage {
  type: string;
  payload?: unknown;
}

/**
 * Manages the Podex workspace webview panel.
 */
export class WorkspacePanelManager {
  public static currentPanel: WorkspacePanelManager | undefined;
  private static readonly viewType = 'podex.workspacePanel';

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private disposables: vscode.Disposable[] = [];
  private socketUnsubscribers: (() => void)[] = [];
  private sessionId: string | null = null;

  /**
   * Create or show the workspace panel.
   */
  public static createOrShow(extensionUri: vscode.Uri, sessionId?: string): WorkspacePanelManager {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    // If we already have a panel, show it
    if (WorkspacePanelManager.currentPanel) {
      WorkspacePanelManager.currentPanel.panel.reveal(column);
      if (sessionId) {
        WorkspacePanelManager.currentPanel.setSession(sessionId);
      }
      return WorkspacePanelManager.currentPanel;
    }

    // Create a new panel
    const panel = vscode.window.createWebviewPanel(
      WorkspacePanelManager.viewType,
      'Podex Workspace',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist', 'webview')],
      }
    );

    WorkspacePanelManager.currentPanel = new WorkspacePanelManager(panel, extensionUri);

    if (sessionId) {
      WorkspacePanelManager.currentPanel.setSession(sessionId);
    }

    return WorkspacePanelManager.currentPanel;
  }

  /**
   * Revive a persisted panel.
   */
  public static revive(panel: vscode.WebviewPanel, extensionUri: vscode.Uri): void {
    WorkspacePanelManager.currentPanel = new WorkspacePanelManager(panel, extensionUri);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel;
    this.extensionUri = extensionUri;

    // Set the webview's HTML content
    this.updateContent();

    // Handle panel disposal
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    // Handle messages from the webview
    this.panel.webview.onDidReceiveMessage(
      (message: WebviewMessage) => this.handleWebviewMessage(message),
      null,
      this.disposables
    );

    // Handle panel visibility changes
    this.panel.onDidChangeViewState(
      () => {
        if (this.panel.visible) {
          logDebug('Workspace panel became visible');
        }
      },
      null,
      this.disposables
    );
  }

  /**
   * Set the active session and connect to socket events.
   */
  public setSession(sessionId: string): void {
    this.sessionId = sessionId;

    // Clean up existing socket subscriptions
    this.socketUnsubscribers.forEach((unsub) => unsub());
    this.socketUnsubscribers = [];

    // Subscribe to session events
    this.setupSocketListeners();

    // Notify webview of session change
    this.postMessage('session:connected', { sessionId });
  }

  /**
   * Set up socket event listeners and forward to webview.
   */
  private setupSocketListeners(): void {
    // Forward chat messages
    const unsubMessage = onSocketEvent('agent_message', (event) => {
      this.postMessage('chat:message', {
        id: event.id,
        session_id: event.session_id,
        agent_id: event.agent_id,
        agent_name: event.agent_name,
        role: event.role,
        content: event.content,
        timestamp: event.created_at,
      });
    });
    this.socketUnsubscribers.push(unsubMessage);

    // Forward token streaming
    const unsubToken = onSocketEvent('agent_token', (event) => {
      this.postMessage('chat:token', {
        session_id: event.session_id,
        agent_id: event.agent_id,
        message_id: event.message_id,
        token: event.token,
        done: false,
      });
    });
    this.socketUnsubscribers.push(unsubToken);

    // Forward stream end
    const unsubStreamEnd = onSocketEvent('agent_stream_end', (event) => {
      this.postMessage('chat:token', {
        session_id: event.session_id,
        agent_id: event.agent_id,
        message_id: event.message_id,
        token: '',
        done: true,
      });
    });
    this.socketUnsubscribers.push(unsubStreamEnd);

    // Forward agent status changes
    const unsubAgentStatus = onSocketEvent('agent_status', (event) => {
      this.postMessage('agent:status', {
        agent_id: event.agent_id,
        status: event.status,
      });
    });
    this.socketUnsubscribers.push(unsubAgentStatus);

    // Forward approval requests
    const unsubApproval = onSocketEvent('approval_request', (event) => {
      this.postMessage('approval:request', {
        id: event.id,
        session_id: event.session_id,
        agent_id: event.agent_id,
        agent_name: event.agent_name,
        tool_name: event.action_details.tool_name || event.action_type,
        tool_input: event.action_details.arguments || {},
        description: `${event.agent_name} wants to ${event.action_type}`,
        is_native: false,
      });
    });
    this.socketUnsubscribers.push(unsubApproval);

    // Forward native approval requests
    const unsubNativeApproval = onSocketEvent('native_approval_request', (event) => {
      this.postMessage('approval:request', {
        id: event.approval_id,
        session_id: event.session_id,
        agent_id: event.agent_id,
        agent_name: event.agent_name,
        tool_name: event.action_details.tool_name || event.action_type,
        tool_input: event.action_details.arguments || {},
        description: `${event.agent_name} wants to ${event.action_type}`,
        is_native: true,
      });
    });
    this.socketUnsubscribers.push(unsubNativeApproval);

    // Forward tool execution events
    const unsubToolStart = onSocketEvent('tool_call_start', (event) => {
      this.postMessage('tool:start', {
        session_id: event.session_id,
        agent_id: event.agent_id,
        tool_name: event.tool_name,
        tool_input: event.tool_args,
      });
    });
    this.socketUnsubscribers.push(unsubToolStart);

    const unsubToolEnd = onSocketEvent('tool_call_end', (event) => {
      this.postMessage('tool:end', {
        session_id: event.session_id,
        agent_id: event.agent_id,
        tool_name: event.tool_name,
        tool_output: event.result ? String(event.result) : undefined,
        error: event.error,
      });
    });
    this.socketUnsubscribers.push(unsubToolEnd);
  }

  /**
   * Handle messages from the webview.
   */
  private handleWebviewMessage(message: WebviewMessage): void {
    logDebug(`Received webview message: ${message.type}`);

    switch (message.type) {
      case 'ready':
        // Webview is ready, send initial state
        if (this.sessionId) {
          this.postMessage('session:connected', { sessionId: this.sessionId });
        }
        break;

      case 'chat:send':
        // User sent a chat message
        this.handleChatSend(message.payload as { content: string; agentId?: string });
        break;

      case 'approval:respond':
        // User responded to an approval request
        this.handleApprovalResponse(
          message.payload as {
            agentId: string;
            approvalId: string;
            approved: boolean;
            addToAllowlist?: boolean;
            isNative?: boolean;
          }
        );
        break;

      default:
        logDebug(`Unknown webview message type: ${message.type}`);
    }
  }

  /**
   * Handle chat send from webview.
   */
  private handleChatSend(payload: { content: string; agentId?: string }): void {
    if (!this.sessionId) {
      logError('Cannot send chat message: no active session');
      return;
    }

    // TODO: Emit chat message via socket
    logDebug(`Chat message: ${payload.content} (agent: ${payload.agentId || 'default'})`);

    // For now, echo back as a placeholder
    this.postMessage('chat:message', {
      id: Date.now().toString(),
      session_id: this.sessionId,
      agent_id: payload.agentId,
      role: 'user',
      content: payload.content,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Handle approval response from webview.
   */
  private handleApprovalResponse(payload: {
    agentId: string;
    approvalId: string;
    approved: boolean;
    addToAllowlist?: boolean;
    isNative?: boolean;
  }): void {
    if (!this.sessionId) {
      logError('Cannot send approval response: no active session');
      return;
    }

    if (payload.isNative) {
      sendNativeApprovalResponse(
        this.sessionId,
        payload.agentId,
        payload.approvalId,
        payload.approved,
        payload.addToAllowlist ?? false
      );
    } else {
      sendApprovalResponse(
        this.sessionId,
        payload.agentId,
        payload.approvalId,
        payload.approved,
        payload.addToAllowlist ?? false
      );
    }
  }

  /**
   * Post a message to the webview.
   */
  public postMessage(type: string, payload?: unknown): void {
    this.panel.webview.postMessage({ type, payload });
  }

  /**
   * Update the webview HTML content.
   */
  private updateContent(): void {
    this.panel.webview.html = this.getHtmlContent();
  }

  /**
   * Get the HTML content for the webview.
   */
  private getHtmlContent(): string {
    const webview = this.panel.webview;
    const webviewUri = vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview');

    // Get the bundled JS and CSS paths
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewUri, 'index.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewUri, 'index.css'));

    // CSP nonce for security
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${styleUri}">
  <title>Podex Workspace</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  /**
   * Dispose resources.
   */
  public dispose(): void {
    WorkspacePanelManager.currentPanel = undefined;

    // Clean up socket subscriptions
    this.socketUnsubscribers.forEach((unsub) => unsub());
    this.socketUnsubscribers = [];

    // Dispose panel
    this.panel.dispose();

    // Dispose all disposables
    while (this.disposables.length) {
      const disposable = this.disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }
}

/**
 * Generate a random nonce for CSP.
 */
function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
