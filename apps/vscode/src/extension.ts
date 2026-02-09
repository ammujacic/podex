/**
 * Podex VSCode Extension entry point.
 *
 * This extension provides AI-powered development workspaces with:
 * - Cloud pod connection for remote workspaces
 * - Local pod support for on-device compute
 * - Shared authentication with CLI (~/.podex/credentials.json)
 */

import * as vscode from 'vscode';
import { initializeAuthProvider, getAuthProvider } from './adapters';
import { registerAuthCommands } from './commands';
import {
  SessionsTreeProvider,
  AgentsTreeProvider,
  LocalPodsTreeProvider,
  type LocalPodInfo,
} from './providers';
import {
  initializeApiClient,
  initializeSocketClient,
  connectSocket,
  disconnectSocket,
  onConnectionStateChange,
  joinSession,
  leaveSession,
  updateApiClientUrl,
  startLocalPod,
  stopLocalPod,
  getConnectionState,
} from './services';
import { WorkspacePanelManager, ApprovalHandler } from './ui';
import { CONTEXT_KEYS, EXTENSION_NAME } from './utils/constants';
import { logInfo, logError, disposeLogger } from './utils/logger';

/**
 * Extension activation.
 * Called when the extension is activated (e.g., on startup).
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  logInfo(`${EXTENSION_NAME} extension activating...`);

  try {
    // Initialize auth provider (shared with CLI via ~/.podex/credentials.json)
    const authProvider = initializeAuthProvider(context);

    // Set initial authentication context
    const isAuthenticated = authProvider.isAuthenticated();
    await vscode.commands.executeCommand(
      'setContext',
      CONTEXT_KEYS.isAuthenticated,
      isAuthenticated
    );

    logInfo(`Initial auth state: ${isAuthenticated ? 'authenticated' : 'not authenticated'}`);

    // Listen for credential changes (e.g., from CLI login)
    context.subscriptions.push(
      authProvider.onCredentialsChange(async (credentials) => {
        const newAuthState = credentials !== null && Date.now() < (credentials?.expiresAt ?? 0);
        await vscode.commands.executeCommand(
          'setContext',
          CONTEXT_KEYS.isAuthenticated,
          newAuthState
        );

        if (newAuthState && credentials) {
          logInfo(`Credentials updated: ${credentials.email || credentials.userId || 'user'}`);
          // Refresh views when credentials change
          vscode.commands.executeCommand('podex.refreshSessions');
        } else {
          logInfo('Credentials cleared');
        }
      })
    );

    // Initialize API client
    initializeApiClient();

    // Initialize socket client
    initializeSocketClient(context);

    // Register commands
    registerAuthCommands(context);

    // Create tree data providers
    const sessionsProvider = new SessionsTreeProvider();
    const agentsProvider = new AgentsTreeProvider();
    const localPodsProvider = new LocalPodsTreeProvider();

    // Track active session for agents provider
    let activeSessionId: string | null = null;

    // Register view commands
    context.subscriptions.push(
      vscode.commands.registerCommand('podex.openWorkspace', () => {
        if (!getAuthProvider().isAuthenticated()) {
          vscode.window.showWarningMessage('Please log in first');
          return;
        }
        WorkspacePanelManager.createOrShow(context.extensionUri);
      }),
      vscode.commands.registerCommand('podex.createSession', async () => {
        if (!getAuthProvider().isAuthenticated()) {
          vscode.window.showWarningMessage('Please log in first');
          return;
        }
        // TODO: Show session creation dialog
        vscode.window.showInformationMessage('Session creation UI coming soon');
      }),
      vscode.commands.registerCommand('podex.openSession', async (sessionId: string) => {
        if (!sessionId) {
          vscode.window.showWarningMessage('No session selected');
          return;
        }

        logInfo(`Opening session: ${sessionId}`);

        // Update active session
        activeSessionId = sessionId;
        await agentsProvider.setActiveSession(sessionId);

        // Connect socket and join session
        const credentials = getAuthProvider().getCredentials();
        if (credentials && credentials.userId) {
          connectSocket();
          joinSession(sessionId, credentials.userId);
        }

        // Open workspace panel with the session
        const panel = WorkspacePanelManager.createOrShow(context.extensionUri, sessionId);
        panel.setSession(sessionId);
      }),
      vscode.commands.registerCommand('podex.refreshSessions', () => {
        logInfo('Refreshing sessions...');
        sessionsProvider.refresh();
      }),
      vscode.commands.registerCommand('podex.refreshAgents', () => {
        logInfo('Refreshing agents...');
        agentsProvider.refresh();
      }),
      vscode.commands.registerCommand('podex.refreshLocalPods', () => {
        logInfo('Refreshing local pods...');
        localPodsProvider.refresh();
      }),
      vscode.commands.registerCommand('podex.startLocalPod', async () => {
        await startLocalPod();
        localPodsProvider.refresh();
      }),
      vscode.commands.registerCommand('podex.stopLocalPod', async () => {
        await stopLocalPod();
        localPodsProvider.refresh();
      }),
      vscode.commands.registerCommand('podex.connectLocalPod', (pod: LocalPodInfo) => {
        if (!pod) {
          vscode.window.showWarningMessage('No pod selected');
          return;
        }
        logInfo(`Connecting to local pod: ${pod.pid} on port ${pod.port}`);
        // Update API URL to point to local pod
        const localUrl = `http://127.0.0.1:${pod.port}`;
        vscode.workspace.getConfiguration('podex').update('apiUrl', localUrl, true);
        vscode.window.showInformationMessage(`Connected to local pod on port ${pod.port}`);
      }),
      vscode.commands.registerCommand('podex.showPendingApprovals', () => {
        approvalHandler.showPendingApprovals();
      }),
      vscode.commands.registerCommand('podex.status', () => {
        const credentials = getAuthProvider().getCredentials();
        const connState = getConnectionState();

        const items: string[] = [];
        items.push(
          `Auth: ${credentials ? `Logged in as ${credentials.email || credentials.userId}` : 'Not logged in'}`
        );
        items.push(`Connection: ${connState.connected ? 'Connected' : 'Disconnected'}`);
        if (activeSessionId) {
          items.push(`Session: ${activeSessionId.slice(0, 8)}...`);
        }

        vscode.window.showInformationMessage(items.join(' | '));
      })
    );

    // Register tree data providers
    context.subscriptions.push(
      vscode.window.registerTreeDataProvider('podex.sessions', sessionsProvider),
      vscode.window.registerTreeDataProvider('podex.agents', agentsProvider),
      vscode.window.registerTreeDataProvider('podex.localPods', localPodsProvider)
    );

    // Clean up providers on deactivation
    context.subscriptions.push(
      { dispose: () => agentsProvider.dispose() },
      { dispose: () => localPodsProvider.dispose() }
    );

    // Register webview panel serializer for panel restoration
    if (vscode.window.registerWebviewPanelSerializer) {
      context.subscriptions.push(
        vscode.window.registerWebviewPanelSerializer('podex.workspacePanel', {
          async deserializeWebviewPanel(panel: vscode.WebviewPanel) {
            WorkspacePanelManager.revive(panel, context.extensionUri);
          },
        })
      );
    }

    // Initialize approval handler for native VSCode approval dialogs
    const approvalHandler = new ApprovalHandler();
    approvalHandler.start();
    context.subscriptions.push({ dispose: () => approvalHandler.dispose() });

    // Listen for settings changes
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('podex.apiUrl')) {
          logInfo('API URL setting changed, updating clients...');
          updateApiClientUrl();
        }
      })
    );

    // Create status bar item
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBarItem.command = 'podex.status';
    updateStatusBar(statusBarItem, isAuthenticated, false);
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    // Update status bar when auth changes
    context.subscriptions.push(
      authProvider.onCredentialsChange((credentials) => {
        const newAuthState = credentials !== null && Date.now() < (credentials?.expiresAt ?? 0);
        updateStatusBar(statusBarItem, newAuthState, false);

        // Refresh sessions when authenticated
        if (newAuthState) {
          sessionsProvider.refresh();
        }
      })
    );

    // Update status bar when socket connection state changes
    context.subscriptions.push(
      onConnectionStateChange((state) => {
        updateStatusBar(statusBarItem, authProvider.isAuthenticated(), state.connected);
      })
    );

    // Handle session cleanup on disconnect
    context.subscriptions.push({
      dispose: () => {
        if (activeSessionId) {
          const credentials = getAuthProvider().getCredentials();
          if (credentials && credentials.userId) {
            leaveSession(activeSessionId, credentials.userId);
          }
          disconnectSocket();
        }
      },
    });

    logInfo(`${EXTENSION_NAME} extension activated successfully`);

    // Show welcome message on first activation
    const hasShownWelcome = context.globalState.get<boolean>('podex.hasShownWelcome');
    if (!hasShownWelcome) {
      const action = await vscode.window.showInformationMessage(
        'Welcome to Podex! AI-powered development workspaces.',
        'Get Started',
        'Later'
      );

      if (action === 'Get Started') {
        vscode.commands.executeCommand(
          'workbench.action.openWalkthrough',
          'podex.podex-vscode#podex.gettingStarted'
        );
      }

      await context.globalState.update('podex.hasShownWelcome', true);
    }
  } catch (error) {
    logError('Failed to activate extension', error);
    vscode.window.showErrorMessage(
      `Failed to activate Podex extension: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Extension deactivation.
 * Called when the extension is deactivated.
 */
export function deactivate(): void {
  logInfo(`${EXTENSION_NAME} extension deactivating...`);
  disposeLogger();
}

/**
 * Update status bar item based on authentication and connection state.
 */
function updateStatusBar(
  item: vscode.StatusBarItem,
  isAuthenticated: boolean,
  isConnected: boolean
): void {
  if (!isAuthenticated) {
    item.text = '$(circle-slash) Podex';
    item.tooltip = 'Podex: Not logged in';
    item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  } else if (isConnected) {
    item.text = '$(check) Podex';
    item.tooltip = 'Podex: Connected';
    item.backgroundColor = undefined;
  } else {
    item.text = '$(plug) Podex';
    item.tooltip = 'Podex: Logged in (not connected to session)';
    item.backgroundColor = undefined;
  }
}
