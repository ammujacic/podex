/**
 * Approval handler for native VSCode approval dialogs.
 * Shows QuickPick and notification dialogs when agents request approval.
 */

import * as vscode from 'vscode';
import { onSocketEvent, sendApprovalResponse, sendNativeApprovalResponse } from '../services';
import { logInfo, logDebug } from '../utils/logger';

interface ApprovalRequest {
  id: string;
  sessionId: string;
  agentId: string;
  agentName: string;
  actionType: string;
  toolName?: string;
  description: string;
  isNative: boolean;
  expiresAt: Date;
}

/**
 * Manages approval requests using native VSCode UI.
 */
export class ApprovalHandler {
  private pendingApprovals: Map<string, ApprovalRequest> = new Map();
  private socketUnsubscribers: (() => void)[] = [];
  private statusBarItem: vscode.StatusBarItem;

  constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 50);
    this.statusBarItem.command = 'podex.showPendingApprovals';
    this.updateStatusBar();
  }

  /**
   * Start listening for approval requests.
   */
  public start(): void {
    // Listen for regular approval requests
    const unsubApproval = onSocketEvent('approval_request', (event) => {
      const request: ApprovalRequest = {
        id: event.id,
        sessionId: event.session_id,
        agentId: event.agent_id,
        agentName: event.agent_name,
        actionType: event.action_type,
        toolName: event.action_details.tool_name,
        description: this.formatDescription(event.action_type, event.action_details),
        isNative: false,
        expiresAt: new Date(event.expires_at),
      };
      this.handleApprovalRequest(request);
    });
    this.socketUnsubscribers.push(unsubApproval);

    // Listen for native approval requests
    const unsubNativeApproval = onSocketEvent('native_approval_request', (event) => {
      const request: ApprovalRequest = {
        id: event.approval_id,
        sessionId: event.session_id,
        agentId: event.agent_id,
        agentName: event.agent_name,
        actionType: event.action_type,
        toolName: event.action_details.tool_name,
        description: this.formatDescription(event.action_type, event.action_details),
        isNative: true,
        expiresAt: new Date(event.expires_at),
      };
      this.handleApprovalRequest(request);
    });
    this.socketUnsubscribers.push(unsubNativeApproval);

    logInfo('ApprovalHandler started');
  }

  /**
   * Format a human-readable description for the approval request.
   */
  private formatDescription(
    actionType: string,
    details: { tool_name?: string; file_path?: string; command?: string }
  ): string {
    switch (actionType) {
      case 'file_write':
        return details.file_path ? `Write to file: ${details.file_path}` : 'Write to a file';
      case 'command_execute':
        return details.command ? `Execute command: ${details.command}` : 'Execute a shell command';
      default:
        return details.tool_name
          ? `Use tool: ${details.tool_name}`
          : `Perform action: ${actionType}`;
    }
  }

  /**
   * Handle an incoming approval request.
   */
  private async handleApprovalRequest(request: ApprovalRequest): Promise<void> {
    logDebug(`Received approval request: ${request.id} from ${request.agentName}`);

    // Store the pending approval
    this.pendingApprovals.set(request.id, request);
    this.updateStatusBar();

    // Show notification with quick actions
    const result = await vscode.window.showWarningMessage(
      `${request.agentName}: ${request.description}`,
      { modal: false },
      'Approve',
      'Always Allow',
      'Deny'
    );

    // Check if approval is still pending (might have expired or been handled elsewhere)
    if (!this.pendingApprovals.has(request.id)) {
      return;
    }

    // Handle the response
    switch (result) {
      case 'Approve':
        this.respondToApproval(request, true, false);
        break;
      case 'Always Allow':
        this.respondToApproval(request, true, true);
        break;
      case 'Deny':
        this.respondToApproval(request, false, false);
        break;
      default:
        // User dismissed the notification - treat as denied
        this.respondToApproval(request, false, false);
        break;
    }
  }

  /**
   * Send approval response and clean up.
   */
  private respondToApproval(
    request: ApprovalRequest,
    approved: boolean,
    addToAllowlist: boolean
  ): void {
    logInfo(
      `Approval ${request.id}: ${approved ? 'approved' : 'denied'}${
        addToAllowlist ? ' (added to allowlist)' : ''
      }`
    );

    if (request.isNative) {
      sendNativeApprovalResponse(
        request.sessionId,
        request.agentId,
        request.id,
        approved,
        addToAllowlist
      );
    } else {
      sendApprovalResponse(
        request.sessionId,
        request.agentId,
        request.id,
        approved,
        addToAllowlist
      );
    }

    this.pendingApprovals.delete(request.id);
    this.updateStatusBar();
  }

  /**
   * Show all pending approvals in a QuickPick.
   */
  public async showPendingApprovals(): Promise<void> {
    if (this.pendingApprovals.size === 0) {
      vscode.window.showInformationMessage('No pending approval requests');
      return;
    }

    const items = Array.from(this.pendingApprovals.values()).map((request) => ({
      label: `$(warning) ${request.agentName}`,
      description: request.description,
      detail: `Expires: ${request.expiresAt.toLocaleTimeString()}`,
      request,
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select an approval request to respond',
      title: 'Pending Approvals',
    });

    if (selected) {
      await this.showApprovalDialog(selected.request);
    }
  }

  /**
   * Show detailed approval dialog for a specific request.
   */
  private async showApprovalDialog(request: ApprovalRequest): Promise<void> {
    const actions = [
      { label: '$(check) Approve', action: 'approve' },
      { label: '$(check-all) Always Allow', action: 'always' },
      { label: '$(x) Deny', action: 'deny' },
    ];

    const selected = await vscode.window.showQuickPick(actions, {
      placeHolder: request.description,
      title: `Approval Request from ${request.agentName}`,
    });

    if (!selected) {
      return;
    }

    switch (selected.action) {
      case 'approve':
        this.respondToApproval(request, true, false);
        break;
      case 'always':
        this.respondToApproval(request, true, true);
        break;
      case 'deny':
        this.respondToApproval(request, false, false);
        break;
    }
  }

  /**
   * Update the status bar item.
   */
  private updateStatusBar(): void {
    const count = this.pendingApprovals.size;

    if (count > 0) {
      this.statusBarItem.text = `$(bell) ${count} Approval${count > 1 ? 's' : ''}`;
      this.statusBarItem.tooltip = 'Click to view pending approvals';
      this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
      this.statusBarItem.show();
    } else {
      this.statusBarItem.hide();
    }
  }

  /**
   * Stop listening and clean up.
   */
  public stop(): void {
    this.socketUnsubscribers.forEach((unsub) => unsub());
    this.socketUnsubscribers = [];
    this.pendingApprovals.clear();
    this.updateStatusBar();
    logInfo('ApprovalHandler stopped');
  }

  /**
   * Dispose resources.
   */
  public dispose(): void {
    this.stop();
    this.statusBarItem.dispose();
  }
}
