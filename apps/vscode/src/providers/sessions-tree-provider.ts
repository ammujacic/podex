/**
 * Sessions tree data provider for the Podex sidebar.
 */

import * as vscode from 'vscode';
import { sessionApi, type SessionResponse } from '../services/api-client';
import { getAuthProvider } from '../adapters';
import { logDebug, logError } from '../utils/logger';

/**
 * Tree item representing a session.
 */
export class SessionTreeItem extends vscode.TreeItem {
  constructor(
    public readonly session: SessionResponse,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(session.name, collapsibleState);

    this.id = session.id;
    this.description = this.getStatusDescription();
    this.tooltip = this.getTooltip();
    this.contextValue = `session-${session.status}`;
    this.iconPath = this.getIcon();

    // Click to open session
    this.command = {
      command: 'podex.openSession',
      title: 'Open Session',
      arguments: [session.id],
    };
  }

  private getStatusDescription(): string {
    const status = this.session.status;
    const branch = this.session.branch || 'main';
    return `${status} · ${branch}`;
  }

  private getTooltip(): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**${this.session.name}**\n\n`);
    md.appendMarkdown(`- Status: ${this.session.status}\n`);
    md.appendMarkdown(`- Branch: ${this.session.branch || 'main'}\n`);
    md.appendMarkdown(`- Created: ${new Date(this.session.created_at).toLocaleString()}\n`);
    return md;
  }

  private getIcon(): vscode.ThemeIcon {
    switch (this.session.status) {
      case 'active':
        return new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('charts.green'));
      case 'paused':
        return new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('charts.yellow'));
      case 'terminated':
        return new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('charts.red'));
      default:
        return new vscode.ThemeIcon('circle-outline');
    }
  }
}

/**
 * Tree data provider for sessions.
 */
export class SessionsTreeProvider implements vscode.TreeDataProvider<SessionTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<SessionTreeItem | undefined | null>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private sessions: SessionResponse[] = [];
  private isLoading = false;
  private error: string | null = null;

  constructor() {
    // Initial load
    this.refresh();
  }

  /**
   * Refresh the sessions list from the API.
   */
  async refresh(): Promise<void> {
    const authProvider = getAuthProvider();

    if (!authProvider.isAuthenticated()) {
      this.sessions = [];
      this.error = null;
      this._onDidChangeTreeData.fire(undefined);
      return;
    }

    this.isLoading = true;
    this.error = null;
    this._onDidChangeTreeData.fire(undefined);

    try {
      logDebug('Fetching sessions...');
      const response = await sessionApi.listSessions();
      this.sessions = response.sessions;
      logDebug(`Fetched ${this.sessions.length} sessions`);
    } catch (err) {
      logError('Failed to fetch sessions', err);
      this.error = err instanceof Error ? err.message : 'Failed to load sessions';
      this.sessions = [];
    } finally {
      this.isLoading = false;
      this._onDidChangeTreeData.fire(undefined);
    }
  }

  getTreeItem(element: SessionTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: SessionTreeItem): vscode.ProviderResult<SessionTreeItem[]> {
    // No nested elements for now
    if (element) {
      return [];
    }

    // Show loading state
    if (this.isLoading) {
      const loading = new vscode.TreeItem('Loading sessions...');
      loading.iconPath = new vscode.ThemeIcon('loading~spin');
      return [loading as unknown as SessionTreeItem];
    }

    // Show error state
    if (this.error) {
      const errorItem = new vscode.TreeItem(`Error: ${this.error}`);
      errorItem.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('errorForeground'));
      return [errorItem as unknown as SessionTreeItem];
    }

    // Return sessions
    return this.sessions.map(
      (session) => new SessionTreeItem(session, vscode.TreeItemCollapsibleState.None)
    );
  }

  /**
   * Get session by ID.
   */
  getSession(sessionId: string): SessionResponse | undefined {
    return this.sessions.find((s) => s.id === sessionId);
  }
}
