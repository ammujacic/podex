/**
 * Agents tree data provider for the Podex sidebar.
 */

import * as vscode from 'vscode';
import { sessionApi, type AgentResponse } from '../services/api-client';
import { onSocketEvent, isSocketConnected } from '../services/socket-service';
import { logDebug, logError } from '../utils/logger';

/**
 * Tree item representing an agent.
 */
export class AgentTreeItem extends vscode.TreeItem {
  constructor(
    public readonly agent: AgentResponse,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(agent.name, collapsibleState);

    this.id = agent.id;
    this.description = this.getStatusDescription();
    this.tooltip = this.getTooltip();
    this.contextValue = `agent-${agent.status}`;
    this.iconPath = this.getIcon();
  }

  private getStatusDescription(): string {
    const status = this.agent.status;
    const model = this.agent.model.split('/').pop() || this.agent.model;
    return `${status} · ${model}`;
  }

  private getTooltip(): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**${this.agent.name}**\n\n`);
    md.appendMarkdown(`- Role: ${this.agent.role}\n`);
    md.appendMarkdown(`- Model: ${this.agent.model}\n`);
    md.appendMarkdown(`- Status: ${this.agent.status}\n`);
    return md;
  }

  private getIcon(): vscode.ThemeIcon {
    // Status-based icon
    switch (this.agent.status) {
      case 'thinking':
        return new vscode.ThemeIcon('loading~spin', this.getColorFromAgent());
      case 'executing':
        return new vscode.ThemeIcon('play', this.getColorFromAgent());
      case 'waiting':
        return new vscode.ThemeIcon('bell', new vscode.ThemeColor('charts.yellow'));
      case 'error':
        return new vscode.ThemeIcon('error', new vscode.ThemeColor('errorForeground'));
      case 'idle':
      default:
        return new vscode.ThemeIcon('hubot', this.getColorFromAgent());
    }
  }

  private getColorFromAgent(): vscode.ThemeColor {
    // Map agent color to VSCode theme color
    switch (this.agent.color) {
      case 'cyan':
        return new vscode.ThemeColor('charts.blue');
      case 'purple':
        return new vscode.ThemeColor('charts.purple');
      case 'green':
        return new vscode.ThemeColor('charts.green');
      case 'orange':
        return new vscode.ThemeColor('charts.orange');
      case 'pink':
        return new vscode.ThemeColor('charts.red');
      case 'yellow':
        return new vscode.ThemeColor('charts.yellow');
      default:
        return new vscode.ThemeColor('foreground');
    }
  }
}

/**
 * Tree data provider for agents.
 */
export class AgentsTreeProvider implements vscode.TreeDataProvider<AgentTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<AgentTreeItem | undefined | null>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private agents: AgentResponse[] = [];
  private activeSessionId: string | null = null;
  private isLoading = false;
  private error: string | null = null;
  private socketUnsubscribers: (() => void)[] = [];

  constructor() {
    // Subscribe to agent status updates when socket is connected
    this.setupSocketListeners();
  }

  /**
   * Set up socket event listeners for real-time agent updates.
   */
  private setupSocketListeners(): void {
    // Clean up existing subscriptions
    this.socketUnsubscribers.forEach((unsub) => unsub());
    this.socketUnsubscribers = [];

    if (!isSocketConnected()) {
      return;
    }

    // Listen for agent status changes
    const unsubStatus = onSocketEvent('agent_status', (event) => {
      const agent = this.agents.find((a) => a.id === event.agent_id);
      if (agent) {
        // Map socket status to agent status
        const statusMap: Record<string, AgentResponse['status']> = {
          idle: 'idle',
          thinking: 'thinking',
          executing: 'executing',
          waiting: 'waiting',
          error: 'error',
          active: 'executing', // Map 'active' to 'executing'
        };
        agent.status = statusMap[event.status] ?? 'idle';
        this._onDidChangeTreeData.fire(undefined);
      }
    });
    this.socketUnsubscribers.push(unsubStatus);
  }

  /**
   * Set the active session and load its agents.
   */
  async setActiveSession(sessionId: string | null): Promise<void> {
    this.activeSessionId = sessionId;

    if (!sessionId) {
      this.agents = [];
      this._onDidChangeTreeData.fire(undefined);
      return;
    }

    await this.refresh();
  }

  /**
   * Refresh the agents list from the API.
   */
  async refresh(): Promise<void> {
    if (!this.activeSessionId) {
      this.agents = [];
      this._onDidChangeTreeData.fire(undefined);
      return;
    }

    this.isLoading = true;
    this.error = null;
    this._onDidChangeTreeData.fire(undefined);

    try {
      logDebug(`Fetching agents for session ${this.activeSessionId}...`);
      this.agents = await sessionApi.getAgents(this.activeSessionId);
      logDebug(`Fetched ${this.agents.length} agents`);

      // Re-setup socket listeners
      this.setupSocketListeners();
    } catch (err) {
      logError('Failed to fetch agents', err);
      this.error = err instanceof Error ? err.message : 'Failed to load agents';
      this.agents = [];
    } finally {
      this.isLoading = false;
      this._onDidChangeTreeData.fire(undefined);
    }
  }

  getTreeItem(element: AgentTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: AgentTreeItem): vscode.ProviderResult<AgentTreeItem[]> {
    // No nested elements for now
    if (element) {
      return [];
    }

    // No active session
    if (!this.activeSessionId) {
      const noSession = new vscode.TreeItem('No active session');
      noSession.iconPath = new vscode.ThemeIcon('info');
      return [noSession as unknown as AgentTreeItem];
    }

    // Show loading state
    if (this.isLoading) {
      const loading = new vscode.TreeItem('Loading agents...');
      loading.iconPath = new vscode.ThemeIcon('loading~spin');
      return [loading as unknown as AgentTreeItem];
    }

    // Show error state
    if (this.error) {
      const errorItem = new vscode.TreeItem(`Error: ${this.error}`);
      errorItem.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('errorForeground'));
      return [errorItem as unknown as AgentTreeItem];
    }

    // No agents
    if (this.agents.length === 0) {
      const noAgents = new vscode.TreeItem('No agents in session');
      noAgents.iconPath = new vscode.ThemeIcon('hubot');
      return [noAgents as unknown as AgentTreeItem];
    }

    // Return agents
    return this.agents.map(
      (agent) => new AgentTreeItem(agent, vscode.TreeItemCollapsibleState.None)
    );
  }

  /**
   * Get agent by ID.
   */
  getAgent(agentId: string): AgentResponse | undefined {
    return this.agents.find((a) => a.id === agentId);
  }

  /**
   * Dispose resources.
   */
  dispose(): void {
    this.socketUnsubscribers.forEach((unsub) => unsub());
    this.socketUnsubscribers = [];
  }
}
