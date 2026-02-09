/**
 * Local pods tree data provider for the Podex sidebar.
 * Uses @podex/local-pod-discovery to find running local pods.
 */

import * as vscode from 'vscode';
import { logDebug, logError } from '../utils/logger';

/**
 * Local pod information.
 */
export interface LocalPodInfo {
  pid: number;
  port: number;
  workspacePath: string;
  startedAt: Date;
  name?: string;
}

/**
 * Tree item representing a local pod.
 */
export class LocalPodTreeItem extends vscode.TreeItem {
  constructor(
    public readonly pod: LocalPodInfo,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(pod.name || `Pod (port ${pod.port})`, collapsibleState);

    this.id = `local-pod-${pod.pid}`;
    this.description = `Port ${pod.port}`;
    this.tooltip = this.getTooltip();
    this.contextValue = 'local-pod';
    this.iconPath = new vscode.ThemeIcon('server', new vscode.ThemeColor('charts.green'));

    // Click to connect
    this.command = {
      command: 'podex.connectLocalPod',
      title: 'Connect to Local Pod',
      arguments: [pod],
    };
  }

  private getTooltip(): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**Local Pod**\n\n`);
    md.appendMarkdown(`- PID: ${this.pod.pid}\n`);
    md.appendMarkdown(`- Port: ${this.pod.port}\n`);
    md.appendMarkdown(`- Workspace: ${this.pod.workspacePath}\n`);
    md.appendMarkdown(`- Started: ${this.pod.startedAt.toLocaleString()}\n`);
    return md;
  }
}

/**
 * Tree data provider for local pods.
 */
export class LocalPodsTreeProvider implements vscode.TreeDataProvider<LocalPodTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<LocalPodTreeItem | undefined | null>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private pods: LocalPodInfo[] = [];
  private isLoading = false;
  private error: string | null = null;
  private discoveryInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Start periodic discovery
    this.startDiscovery();
  }

  /**
   * Start periodic pod discovery.
   */
  private startDiscovery(): void {
    // Initial discovery
    this.refresh();

    // Poll every 5 seconds
    this.discoveryInterval = setInterval(() => {
      this.discoverPods();
    }, 5000);
  }

  /**
   * Stop periodic discovery.
   */
  private stopDiscovery(): void {
    if (this.discoveryInterval) {
      clearInterval(this.discoveryInterval);
      this.discoveryInterval = null;
    }
  }

  /**
   * Discover running local pods.
   */
  private async discoverPods(): Promise<void> {
    try {
      // Try to import local-pod-discovery dynamically
      // This may not be available in all environments
      const discovery = await import('@podex/local-pod-discovery');
      const pods = await discovery.discoverAllLocalPods();

      // Only update if changed
      const podsChanged =
        pods.length !== this.pods.length ||
        pods.some((p, i) => p.pid !== this.pods[i]?.pid || p.port !== this.pods[i]?.port);

      if (podsChanged) {
        this.pods = pods.map((p) => ({
          pid: p.pid,
          port: p.port,
          workspacePath: p.workspacePath,
          startedAt: new Date(p.startedAt),
          name: p.name,
        }));
        this._onDidChangeTreeData.fire(undefined);
      }
    } catch {
      // Discovery not available or failed silently
      logDebug('Local pod discovery not available or failed');
    }
  }

  /**
   * Refresh the pods list.
   */
  async refresh(): Promise<void> {
    this.isLoading = true;
    this.error = null;
    this._onDidChangeTreeData.fire(undefined);

    try {
      await this.discoverPods();
    } catch (err) {
      logError('Failed to discover local pods', err);
      this.error = err instanceof Error ? err.message : 'Discovery failed';
    } finally {
      this.isLoading = false;
      this._onDidChangeTreeData.fire(undefined);
    }
  }

  getTreeItem(element: LocalPodTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: LocalPodTreeItem): vscode.ProviderResult<LocalPodTreeItem[]> {
    // No nested elements
    if (element) {
      return [];
    }

    // Show loading state
    if (this.isLoading && this.pods.length === 0) {
      const loading = new vscode.TreeItem('Discovering pods...');
      loading.iconPath = new vscode.ThemeIcon('loading~spin');
      return [loading as unknown as LocalPodTreeItem];
    }

    // Show error state
    if (this.error) {
      const errorItem = new vscode.TreeItem(`Error: ${this.error}`);
      errorItem.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('errorForeground'));
      return [errorItem as unknown as LocalPodTreeItem];
    }

    // Return pods
    return this.pods.map((pod) => new LocalPodTreeItem(pod, vscode.TreeItemCollapsibleState.None));
  }

  /**
   * Get pod by PID.
   */
  getPod(pid: number): LocalPodInfo | undefined {
    return this.pods.find((p) => p.pid === pid);
  }

  /**
   * Dispose resources.
   */
  dispose(): void {
    this.stopDiscovery();
  }
}
