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
});
