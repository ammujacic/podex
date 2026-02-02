import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture registered commands so we can invoke them
const registeredCommands: Record<string, (...args: any[]) => any> = {};

const mockExecuteCommand = vi.fn();
const mockShowWarningMessage = vi.fn();
const mockShowInformationMessage = vi.fn(async () => undefined);
const mockShowErrorMessage = vi.fn();

const mockStatusBarItem = {
  command: '',
  text: '',
  tooltip: '',
  backgroundColor: undefined as unknown,
  show: vi.fn(),
};

// Basic event emitter for connection state
type ConnectionListener = (state: { connected: boolean }) => void;
let connectionListeners: ConnectionListener[] = [];

vi.mock('vscode', () => ({
  Uri: {
    parse: (value: string) => ({ toString: () => value }),
  },
  window: {
    showWarningMessage: mockShowWarningMessage,
    showInformationMessage: mockShowInformationMessage,
    showErrorMessage: mockShowErrorMessage,
    createStatusBarItem: vi.fn(() => mockStatusBarItem),
    registerTreeDataProvider: vi.fn(),
    registerWebviewPanelSerializer: vi.fn(),
  },
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: vi.fn((_k: string, defaultValue: string) => defaultValue),
      update: vi.fn(),
    })),
    onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
  },
  ThemeColor: vi.fn(),
  StatusBarAlignment: {
    Left: 1,
  },
  commands: {
    registerCommand: vi.fn((id: string, handler: (...args: any[]) => any) => {
      registeredCommands[id] = handler;
      return { dispose: vi.fn() };
    }),
    executeCommand: mockExecuteCommand,
  },
}));

// Mock adapters and auth provider
const mockIsAuthenticated = vi.fn();
const mockGetCredentials = vi.fn();

vi.mock('../adapters', () => ({
  initializeAuthProvider: vi.fn(() => ({
    isAuthenticated: mockIsAuthenticated,
    onCredentialsChange: (cb: (creds: any) => void) => {
      // For tests we can call this callback manually if needed
      (mockGetCredentials as any)._listener = cb;
      return { dispose: vi.fn() };
    },
  })),
  getAuthProvider: vi.fn(() => ({
    isAuthenticated: mockIsAuthenticated,
    getCredentials: mockGetCredentials,
  })),
}));

// Mock services
const mockInitializeApiClient = vi.fn();
const mockInitializeSocketClient = vi.fn();
const mockConnectSocket = vi.fn();
const mockDisconnectSocket = vi.fn();
const mockJoinSession = vi.fn();
const mockLeaveSession = vi.fn();
const mockUpdateApiClientUrl = vi.fn();
const mockStartLocalPod = vi.fn(async () => {});
const mockStopLocalPod = vi.fn(async () => {});
const mockGetConnectionState = vi.fn(() => ({ connected: false }));

vi.mock('../services', () => ({
  initializeApiClient: mockInitializeApiClient,
  initializeSocketClient: mockInitializeSocketClient,
  connectSocket: mockConnectSocket,
  disconnectSocket: mockDisconnectSocket,
  joinSession: mockJoinSession,
  leaveSession: mockLeaveSession,
  updateApiClientUrl: mockUpdateApiClientUrl,
  startLocalPod: mockStartLocalPod,
  stopLocalPod: mockStopLocalPod,
  getConnectionState: mockGetConnectionState,
  onConnectionStateChange: (listener: ConnectionListener) => {
    connectionListeners.push(listener);
    return { dispose: vi.fn() };
  },
}));

// Mock UI layer
const mockCreateOrShow = vi.fn(() => ({
  setSession: vi.fn(),
}));
const mockRevive = vi.fn();
const mockApprovalStart = vi.fn();
const mockApprovalDispose = vi.fn();

vi.mock('../ui', () => ({
  WorkspacePanelManager: {
    createOrShow: mockCreateOrShow,
    revive: mockRevive,
  },
  ApprovalHandler: vi.fn(() => ({
    start: mockApprovalStart,
    dispose: mockApprovalDispose,
    showPendingApprovals: vi.fn(),
  })),
}));

// Mock providers
const mockSessionsRefresh = vi.fn();
const mockAgentsRefresh = vi.fn();
const mockLocalPodsRefresh = vi.fn();
const mockSetActiveSession = vi.fn();

vi.mock('../providers', () => ({
  SessionsTreeProvider: vi.fn(() => ({ refresh: mockSessionsRefresh })),
  AgentsTreeProvider: vi.fn(() => ({
    refresh: mockAgentsRefresh,
    setActiveSession: mockSetActiveSession,
  })),
  LocalPodsTreeProvider: vi.fn(() => ({ refresh: mockLocalPodsRefresh })),
}));

// Mock logger
const mockLogInfo = vi.fn();
const mockLogError = vi.fn();
const mockDisposeLogger = vi.fn();

vi.mock('../utils/logger', () => ({
  logInfo: mockLogInfo,
  logError: mockLogError,
  disposeLogger: mockDisposeLogger,
}));

describe('extension activate/deactivate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    connectionListeners = [];
    Object.keys(registeredCommands).forEach((k) => delete registeredCommands[k]);
    mockIsAuthenticated.mockReturnValue(false);
    mockGetCredentials.mockReturnValue(null);
    (mockShowInformationMessage as any).mockResolvedValue(undefined);
  });

  it('activates extension and registers core commands', async () => {
    const vscode = await import('vscode');
    const { activate } = await import('../extension');

    const context = {
      subscriptions: [],
      extensionUri: vscode.Uri.parse('file:///fake'),
      globalState: {
        get: vi.fn().mockReturnValue(true),
        update: vi.fn(),
      },
    } as unknown as vscode.ExtensionContext;

    await activate(context);

    expect(mockInitializeApiClient).toHaveBeenCalled();
    expect(mockInitializeSocketClient).toHaveBeenCalled();

    // Status bar created and initial context set
    expect(vscode.window.createStatusBarItem).toHaveBeenCalled();
    expect(mockExecuteCommand).toHaveBeenCalledWith(
      'setContext',
      expect.any(String),
      expect.any(Boolean)
    );

    // Core commands should be registered
    expect(registeredCommands['podex.openWorkspace']).toBeTypeOf('function');
    expect(registeredCommands['podex.openSession']).toBeTypeOf('function');
    expect(registeredCommands['podex.status']).toBeTypeOf('function');
  });

  it('openWorkspace warns when not authenticated and opens panel when authenticated', async () => {
    const vscode = await import('vscode');
    const { activate } = await import('../extension');

    const context = {
      subscriptions: [],
      extensionUri: vscode.Uri.parse('file:///fake'),
      globalState: {
        get: vi.fn().mockReturnValue(true),
        update: vi.fn(),
      },
    } as unknown as vscode.ExtensionContext;

    mockIsAuthenticated.mockReturnValue(false);
    await activate(context);

    const handler = registeredCommands['podex.openWorkspace'];
    expect(handler).toBeDefined();

    await handler();
    expect(mockShowWarningMessage).toHaveBeenCalledWith('Please log in first');

    mockIsAuthenticated.mockReturnValue(true);
    await handler();
    expect(mockCreateOrShow).toHaveBeenCalled();
  });

  it('status command shows auth and connection state', async () => {
    const vscode = await import('vscode');
    const { activate } = await import('../extension');

    const context = {
      subscriptions: [],
      extensionUri: vscode.Uri.parse('file:///fake'),
      globalState: {
        get: vi.fn().mockReturnValue(true),
        update: vi.fn(),
      },
    } as unknown as vscode.ExtensionContext;

    mockGetCredentials.mockReturnValue({
      email: 'user@example.com',
      userId: 'user-1',
    });
    mockGetConnectionState.mockReturnValue({ connected: true });

    await activate(context);

    const handler = registeredCommands['podex.status'];
    await handler();

    expect(mockShowInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('Auth: Logged in as user@example.com')
    );
  });

  it('deactivate disposes logger', async () => {
    const { deactivate } = await import('../extension');
    deactivate();
    expect(mockLogInfo).toHaveBeenCalledWith(expect.stringContaining('extension deactivating'));
    expect(mockDisposeLogger).toHaveBeenCalled();
  });

  it('openSession with no sessionId shows warning', async () => {
    const vscode = await import('vscode');
    const { activate } = await import('../extension');
    const context = {
      subscriptions: [] as any[],
      extensionUri: vscode.Uri.parse('file:///fake'),
      globalState: { get: vi.fn().mockReturnValue(true), update: vi.fn() },
    } as unknown as vscode.ExtensionContext;
    await activate(context);
    const handler = registeredCommands['podex.openSession'];
    await handler('');
    expect(mockShowWarningMessage).toHaveBeenCalledWith('No session selected');
  });

  it('openSession with sessionId connects and opens panel', async () => {
    const vscode = await import('vscode');
    const { activate } = await import('../extension');
    mockIsAuthenticated.mockReturnValue(true);
    mockGetCredentials.mockReturnValue({ userId: 'u1' });
    const context = {
      subscriptions: [] as any[],
      extensionUri: vscode.Uri.parse('file:///fake'),
      globalState: { get: vi.fn().mockReturnValue(true), update: vi.fn() },
    } as unknown as vscode.ExtensionContext;
    await activate(context);
    const handler = registeredCommands['podex.openSession'];
    await handler('session-1');
    expect(mockConnectSocket).toHaveBeenCalled();
    expect(mockJoinSession).toHaveBeenCalledWith('session-1', 'u1');
    expect(mockCreateOrShow).toHaveBeenCalled();
  });

  it('refresh commands call provider refresh', async () => {
    const vscode = await import('vscode');
    const { activate } = await import('../extension');
    const context = {
      subscriptions: [] as any[],
      extensionUri: vscode.Uri.parse('file:///fake'),
      globalState: { get: vi.fn().mockReturnValue(true), update: vi.fn() },
    } as unknown as vscode.ExtensionContext;
    await activate(context);
    registeredCommands['podex.refreshSessions']();
    registeredCommands['podex.refreshAgents']();
    registeredCommands['podex.refreshLocalPods']();
    expect(mockSessionsRefresh).toHaveBeenCalled();
    expect(mockAgentsRefresh).toHaveBeenCalled();
    expect(mockLocalPodsRefresh).toHaveBeenCalled();
  });

  it('startLocalPod and stopLocalPod refresh local pods', async () => {
    const vscode = await import('vscode');
    const { activate } = await import('../extension');
    const context = {
      subscriptions: [] as any[],
      extensionUri: vscode.Uri.parse('file:///fake'),
      globalState: { get: vi.fn().mockReturnValue(true), update: vi.fn() },
    } as unknown as vscode.ExtensionContext;
    await activate(context);
    await registeredCommands['podex.startLocalPod']();
    await registeredCommands['podex.stopLocalPod']();
    expect(mockStartLocalPod).toHaveBeenCalled();
    expect(mockStopLocalPod).toHaveBeenCalled();
    expect(mockLocalPodsRefresh).toHaveBeenCalledTimes(2);
  });

  it('connectLocalPod with no pod shows warning', async () => {
    const vscode = await import('vscode');
    const { activate } = await import('../extension');
    const context = {
      subscriptions: [] as any[],
      extensionUri: vscode.Uri.parse('file:///fake'),
      globalState: { get: vi.fn().mockReturnValue(true), update: vi.fn() },
    } as unknown as vscode.ExtensionContext;
    await activate(context);
    registeredCommands['podex.connectLocalPod'](undefined);
    expect(mockShowWarningMessage).toHaveBeenCalledWith('No pod selected');
  });

  it('connectLocalPod with pod updates config and shows message', async () => {
    const vscode = await import('vscode');
    const mockUpdate = vi.fn();
    const mockGetConfiguration = vi.fn(() => ({
      get: vi.fn((_k: string, defaultValue: string) => defaultValue),
      update: mockUpdate,
    }));
    vi.mocked(vscode.workspace.getConfiguration).mockImplementation(mockGetConfiguration as any);
    const { activate } = await import('../extension');
    const context = {
      subscriptions: [] as any[],
      extensionUri: vscode.Uri.parse('file:///fake'),
      globalState: { get: vi.fn().mockReturnValue(true), update: vi.fn() },
    } as unknown as vscode.ExtensionContext;
    await activate(context);
    registeredCommands['podex.connectLocalPod']({ pid: 123, port: 9999 } as any);
    expect(mockUpdate).toHaveBeenCalledWith('apiUrl', 'http://127.0.0.1:9999', true);
    expect(mockShowInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('Connected to local pod on port 9999')
    );
  });

  it('createSession shows coming soon when authenticated', async () => {
    const vscode = await import('vscode');
    const { activate } = await import('../extension');
    mockIsAuthenticated.mockReturnValue(true);
    const context = {
      subscriptions: [] as any[],
      extensionUri: vscode.Uri.parse('file:///fake'),
      globalState: { get: vi.fn().mockReturnValue(true), update: vi.fn() },
    } as unknown as vscode.ExtensionContext;
    await activate(context);
    await registeredCommands['podex.createSession']();
    expect(mockShowInformationMessage).toHaveBeenCalledWith('Session creation UI coming soon');
  });

  it('createSession warns when not authenticated', async () => {
    const vscode = await import('vscode');
    const { activate } = await import('../extension');
    mockIsAuthenticated.mockReturnValue(false);
    const context = {
      subscriptions: [] as any[],
      extensionUri: vscode.Uri.parse('file:///fake'),
      globalState: { get: vi.fn().mockReturnValue(true), update: vi.fn() },
    } as unknown as vscode.ExtensionContext;
    await activate(context);
    await registeredCommands['podex.createSession']();
    expect(mockShowWarningMessage).toHaveBeenCalledWith('Please log in first');
  });
});
