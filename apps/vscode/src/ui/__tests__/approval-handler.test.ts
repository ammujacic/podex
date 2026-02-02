/**
 * Approval handler tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock vscode module
const mockShowWarningMessage = vi.fn();
const mockShowInformationMessage = vi.fn();
const mockShowQuickPick = vi.fn();
const mockStatusBarItem = {
  text: '',
  tooltip: '',
  backgroundColor: undefined,
  command: undefined,
  show: vi.fn(),
  hide: vi.fn(),
  dispose: vi.fn(),
};

vi.mock('vscode', () => ({
  window: {
    showWarningMessage: mockShowWarningMessage,
    showInformationMessage: mockShowInformationMessage,
    showQuickPick: mockShowQuickPick,
    createStatusBarItem: vi.fn(() => mockStatusBarItem),
  },
  StatusBarAlignment: {
    Left: 1,
    Right: 2,
  },
  ThemeColor: vi.fn((color: string) => ({ id: color })),
}));

// Mock services
const mockOnSocketEvent = vi.fn(() => vi.fn());
const mockSendApprovalResponse = vi.fn();
const mockSendNativeApprovalResponse = vi.fn();

vi.mock('../../services', () => ({
  onSocketEvent: mockOnSocketEvent,
  sendApprovalResponse: mockSendApprovalResponse,
  sendNativeApprovalResponse: mockSendNativeApprovalResponse,
}));

// Mock logger
vi.mock('../../utils/logger', () => ({
  logInfo: vi.fn(),
  logDebug: vi.fn(),
}));

describe('ApprovalHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStatusBarItem.text = '';
    mockStatusBarItem.tooltip = '';
    mockStatusBarItem.backgroundColor = undefined;
  });

  it('should create instance and subscribe to socket events on start', async () => {
    const { ApprovalHandler } = await import('../approval-handler');

    const handler = new ApprovalHandler();
    handler.start();

    // Should subscribe to approval_request and native_approval_request
    expect(mockOnSocketEvent).toHaveBeenCalledWith('approval_request', expect.any(Function));
    expect(mockOnSocketEvent).toHaveBeenCalledWith('native_approval_request', expect.any(Function));
  });

  it('should hide status bar when no pending approvals', async () => {
    const { ApprovalHandler } = await import('../approval-handler');

    new ApprovalHandler();

    // Status bar should be hidden initially
    expect(mockStatusBarItem.hide).toHaveBeenCalled();
  });

  it('should show information message when no pending approvals in showPendingApprovals', async () => {
    const { ApprovalHandler } = await import('../approval-handler');

    const handler = new ApprovalHandler();
    await handler.showPendingApprovals();

    expect(mockShowInformationMessage).toHaveBeenCalledWith('No pending approval requests');
  });

  it('should clean up on dispose', async () => {
    const { ApprovalHandler } = await import('../approval-handler');

    const handler = new ApprovalHandler();
    handler.start();
    handler.dispose();

    expect(mockStatusBarItem.dispose).toHaveBeenCalled();
  });

  it('should call stop and clear pending approvals', async () => {
    const { ApprovalHandler } = await import('../approval-handler');

    const handler = new ApprovalHandler();
    handler.start();
    const unsub = mockOnSocketEvent.mock.results[0]?.value;
    handler.stop();

    expect(typeof unsub).toBe('function');
    expect(mockStatusBarItem.hide).toHaveBeenCalled();
  });

  it('should handle approval_request with Approve and call sendApprovalResponse', async () => {
    let approvalCallback: (event: unknown) => void;
    mockOnSocketEvent.mockImplementation((_event: string, cb: (e: unknown) => void) => {
      if (_event === 'approval_request') approvalCallback = cb;
      return () => {};
    });
    mockShowWarningMessage.mockResolvedValue('Approve');

    const { ApprovalHandler } = await import('../approval-handler');
    const handler = new ApprovalHandler();
    handler.start();

    approvalCallback!({
      id: 'req-1',
      session_id: 's1',
      agent_id: 'a1',
      agent_name: 'Agent',
      action_type: 'file_write',
      action_details: { file_path: '/tmp/foo' },
      expires_at: new Date(Date.now() + 60000).toISOString(),
    });

    await vi.waitFor(() => {
      expect(mockSendApprovalResponse).toHaveBeenCalled();
    });

    expect(mockShowWarningMessage).toHaveBeenCalled();
    expect(mockSendApprovalResponse).toHaveBeenCalledWith('s1', 'a1', 'req-1', true, false);
  });

  it('should handle approval_request with Always Allow', async () => {
    let approvalCallback: (event: unknown) => void;
    mockOnSocketEvent.mockImplementation((_event: string, cb: (e: unknown) => void) => {
      if (_event === 'approval_request') approvalCallback = cb;
      return () => {};
    });
    mockShowWarningMessage.mockResolvedValue('Always Allow');

    const { ApprovalHandler } = await import('../approval-handler');
    const handler = new ApprovalHandler();
    handler.start();

    approvalCallback!({
      id: 'req-2',
      session_id: 's1',
      agent_id: 'a1',
      agent_name: 'Agent',
      action_type: 'command_execute',
      action_details: { command: 'npm run build' },
      expires_at: new Date(Date.now() + 60000).toISOString(),
    });

    await vi.waitFor(() => {
      expect(mockSendApprovalResponse).toHaveBeenCalledWith('s1', 'a1', 'req-2', true, true);
    });
  });

  it('should handle approval_request with Deny', async () => {
    let approvalCallback: (event: unknown) => void;
    mockOnSocketEvent.mockImplementation((_event: string, cb: (e: unknown) => void) => {
      if (_event === 'approval_request') approvalCallback = cb;
      return () => {};
    });
    mockShowWarningMessage.mockResolvedValue('Deny');

    const { ApprovalHandler } = await import('../approval-handler');
    const handler = new ApprovalHandler();
    handler.start();

    approvalCallback!({
      id: 'req-3',
      session_id: 's1',
      agent_id: 'a1',
      agent_name: 'Agent',
      action_type: 'tool_use',
      action_details: { tool_name: 'run_command' },
      expires_at: new Date(Date.now() + 60000).toISOString(),
    });

    await vi.waitFor(() => {
      expect(mockSendApprovalResponse).toHaveBeenCalledWith('s1', 'a1', 'req-3', false, false);
    });
  });

  it('should handle native_approval_request and call sendNativeApprovalResponse', async () => {
    let nativeCallback: (event: unknown) => void;
    mockOnSocketEvent.mockImplementation((_event: string, cb: (e: unknown) => void) => {
      if (_event === 'native_approval_request') nativeCallback = cb;
      return () => {};
    });
    mockShowWarningMessage.mockResolvedValue('Approve');

    const { ApprovalHandler } = await import('../approval-handler');
    const handler = new ApprovalHandler();
    handler.start();

    nativeCallback!({
      approval_id: 'native-1',
      session_id: 's1',
      agent_id: 'a1',
      agent_name: 'Agent',
      action_type: 'file_write',
      action_details: {},
      expires_at: new Date(Date.now() + 60000).toISOString(),
    });

    await vi.waitFor(() => {
      expect(mockSendNativeApprovalResponse).toHaveBeenCalledWith(
        's1',
        'a1',
        'native-1',
        true,
        false
      );
    });
  });

  it('should show status bar when pending approvals exist', async () => {
    let approvalCallback: (event: unknown) => void;
    mockOnSocketEvent.mockImplementation((_event: string, cb: (e: unknown) => void) => {
      if (_event === 'approval_request') approvalCallback = cb;
      return () => {};
    });
    mockShowWarningMessage.mockResolvedValue(undefined); // user dismisses

    const { ApprovalHandler } = await import('../approval-handler');
    const handler = new ApprovalHandler();
    handler.start();

    approvalCallback!({
      id: 'req-4',
      session_id: 's1',
      agent_id: 'a1',
      agent_name: 'Agent',
      action_type: 'file_write',
      action_details: { file_path: '/path/to/file' },
      expires_at: new Date(Date.now() + 60000).toISOString(),
    });

    await vi.waitFor(() => {
      expect(mockStatusBarItem.show).toHaveBeenCalled();
    });
    expect(mockStatusBarItem.text).toContain('Approval');
  });
});
