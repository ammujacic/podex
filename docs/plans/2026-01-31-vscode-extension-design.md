# Podex VSCode Extension Design

**Date:** 2026-01-31
**Status:** Draft
**Author:** Brainstorming session

## Overview

This document outlines the design for a VSCode extension that brings Podex's AI-powered development workspace experience to the desktop. The extension supports two primary modes:

1. **Cloud Pod Mode** - Connect VSCode to remote Podex-managed workspaces
2. **Local Pod Mode** - Run Podex agents on local repositories using local compute

### Goals

- Seamless IDE integration without context-switching to browser
- Full agent interaction (chat, approvals, streaming responses)
- Native file editing with VSCode's ecosystem (extensions, intellisense, git)
- Grid-style workspace UI within VSCode panels
- Support both cloud and local pod workflows
- Maximum code reuse with `apps/web`

### Non-Goals (for MVP)

- Offline mode / air-gapped deployment
- Full VSCode fork
- Mobile support

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  VSCode + Podex Extension                                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐  ┌──────────────────────────────────────────┐ │
│  │ Activity Bar │  │           Editor Area                     │ │
│  │              │  │  ┌────────────────────────────────────┐  │ │
│  │  [Podex]     │  │  │  Podex Workspace (webview)         │  │ │
│  │   Sessions   │  │  │  ┌──────────┬──────────┬─────────┐ │  │ │
│  │   Agents     │  │  │  │ Agent 1  │ Agent 2  │Terminal │ │  │ │
│  │   Local Pod  │  │  │  │ (chat)   │ (chat)   │         │ │  │ │
│  │              │  │  │  ├──────────┴──────────┤         │ │  │ │
│  │              │  │  │  │ File Preview / Diff │         │ │  │ │
│  │              │  │  │  └────────────────────┴─────────┘ │  │ │
│  │              │  │  └────────────────────────────────────┘  │ │
│  └──────────────┘  └──────────────────────────────────────────┘ │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Status Bar: Pod: Connected (cloud) │ Credits: 150 │ Idle │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ REST API + Socket.IO
                              ▼
                    ┌─────────────────────┐
                    │   Podex Cloud API   │
                    │   (services/api)    │
                    └──────────┬──────────┘
                               │
              ┌────────────────┴────────────────┐
              ▼                                  ▼
     ┌─────────────────┐                ┌─────────────────┐
     │   Cloud Pod     │                │   Local Pod     │
     │  (container in  │                │  (user machine) │
     │   cloud)        │                │                 │
     └─────────────────┘                └─────────────────┘
```

---

## Monorepo Structure

### Current State

```
podex/
├── apps/
│   └── web/                    # Next.js frontend
├── services/
│   ├── api/                    # FastAPI gateway
│   ├── compute/                # Docker orchestrator
│   ├── agent/                  # AI execution engine
│   └── local-pod/              # Self-hosted compute agent
└── packages/                   # (currently minimal)
```

### Proposed State

```
podex/
├── apps/
│   ├── web/                    # Next.js frontend
│   └── vscode/                 # NEW: VSCode extension
│
├── packages/                   # NEW: Shared packages
│   ├── api-client/             # REST + Socket.IO client
│   ├── stores/                 # Zustand state stores
│   └── ui/                     # Shared React components
│
├── services/
│   ├── api/
│   ├── compute/
│   ├── agent/
│   └── local-pod/
│
└── turbo.json                  # Updated pipeline
```

---

## Shared Packages

### @podex/api-client

Extracted from `apps/web/src/lib/`:

```typescript
// packages/api-client/src/index.ts
export { PodexClient } from './rest';
export { createSocketClient, SocketEvents } from './socket';
export type { Session, Agent, Workspace, User } from './types';
```

**Contents:**

- REST API client with typed endpoints
- Socket.IO client with event types
- Shared TypeScript types for API responses
- Authentication helpers (token refresh, storage interface)

### @podex/stores

Extracted from `apps/web/src/stores/`:

```typescript
// packages/stores/src/index.ts
export { useSessionStore } from './session';
export { useUIStore } from './ui';
export { useAgentStore } from './agents';
export { useBillingStore } from './billing';
```

**Adaptations needed:**

- Abstract storage interface (localStorage for web, VSCode SecretStorage for extension)
- Environment-agnostic initialization

### @podex/ui

Extracted from `apps/web/src/components/workspace/`:

```typescript
// packages/ui/src/index.ts
export { AgentGrid } from './AgentGrid';
export { AgentChat } from './AgentChat';
export { TerminalPanel } from './TerminalPanel';
export { FilePreview } from './FilePreview';
export { ApprovalModal } from './ApprovalModal';
```

**Adaptations needed:**

- Remove Next.js specific imports (next/link, next/image)
- Abstract routing (callback props instead of router)
- Configurable theming to match VSCode themes

---

## Extension Structure

```
apps/vscode/
├── src/
│   ├── extension.ts                # Entry point: activate() / deactivate()
│   │
│   ├── auth/
│   │   ├── authProvider.ts         # VSCode AuthenticationProvider implementation
│   │   ├── tokenStorage.ts         # SecretStorage wrapper for tokens
│   │   └── oauth.ts                # OAuth flow handling (opens browser)
│   │
│   ├── providers/
│   │   ├── fileSystemProvider.ts   # podex:// FileSystemProvider for cloud files
│   │   ├── terminalProvider.ts     # Terminal profile for cloud workspace
│   │   └── treeDataProvider.ts     # Sidebar tree views (sessions, agents)
│   │
│   ├── commands/
│   │   ├── session.ts              # createSession, joinSession, leaveSession
│   │   ├── agent.ts                # startAgent, stopAgent, sendMessage
│   │   ├── workspace.ts            # openWorkspacePanel, connectCloudPod
│   │   └── localPod.ts             # startLocalPod, stopLocalPod, configureLocalPod
│   │
│   ├── panels/
│   │   ├── workspacePanel.ts       # Main webview panel management
│   │   ├── messageHandler.ts       # Extension <-> Webview message protocol
│   │   └── panelSerializer.ts      # Restore panels on reload
│   │
│   ├── localPod/
│   │   ├── manager.ts              # Spawn/monitor local-pod child process
│   │   ├── discovery.ts            # Find existing running local-pod
│   │   └── config.ts               # Local pod configuration
│   │
│   ├── statusBar/
│   │   └── statusBarManager.ts     # Pod status, credits, agent state
│   │
│   └── utils/
│       ├── logger.ts               # Extension output channel logging
│       └── configuration.ts        # VSCode settings access
│
├── webview/                        # React app for webview panels
│   ├── src/
│   │   ├── index.tsx               # Webview entry point
│   │   ├── App.tsx                 # Main app component
│   │   ├── vscode-api.ts           # acquireVsCodeApi() wrapper
│   │   ├── hooks/
│   │   │   └── useVSCodeMessage.ts # Extension communication hook
│   │   └── pages/
│   │       └── Workspace.tsx       # Main workspace view (uses @podex/ui)
│   ├── tsconfig.json
│   └── vite.config.ts              # Vite for webview bundling
│
├── resources/
│   ├── icons/
│   │   ├── podex.svg               # Activity bar icon
│   │   ├── agent.svg
│   │   └── pod.svg
│   └── walkthroughs/               # Getting started walkthrough
│
├── package.json                    # Extension manifest
├── tsconfig.json                   # Extension TypeScript config
├── webpack.config.js               # Extension bundling (not webview)
├── .vscodeignore                   # Exclude from .vsix package
└── CHANGELOG.md
```

---

## Extension Manifest (package.json)

```json
{
  "name": "podex",
  "displayName": "Podex",
  "description": "AI-powered development workspaces with local and cloud compute",
  "version": "0.1.0",
  "publisher": "podex",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/podex/podex"
  },
  "engines": {
    "vscode": "^1.85.0"
  },
  "categories": ["Machine Learning", "Other"],
  "keywords": ["ai", "agents", "development", "workspace", "podex"],
  "activationEvents": ["onStartupFinished"],
  "main": "./dist/extension.js",
  "contributes": {
    "commands": [
      {
        "command": "podex.openWorkspace",
        "title": "Open Podex Workspace",
        "category": "Podex"
      },
      {
        "command": "podex.createSession",
        "title": "Create New Session",
        "category": "Podex",
        "icon": "$(add)"
      },
      {
        "command": "podex.connectCloudPod",
        "title": "Connect to Cloud Pod",
        "category": "Podex"
      },
      {
        "command": "podex.startLocalPod",
        "title": "Start Local Pod",
        "category": "Podex"
      },
      {
        "command": "podex.stopLocalPod",
        "title": "Stop Local Pod",
        "category": "Podex"
      },
      {
        "command": "podex.signIn",
        "title": "Sign In",
        "category": "Podex"
      },
      {
        "command": "podex.signOut",
        "title": "Sign Out",
        "category": "Podex"
      }
    ],
    "viewsContainers": {
      "activitybar": [
        {
          "id": "podex",
          "title": "Podex",
          "icon": "resources/icons/podex.svg"
        }
      ]
    },
    "views": {
      "podex": [
        {
          "id": "podex.sessions",
          "name": "Sessions",
          "icon": "$(folder)",
          "contextualTitle": "Podex Sessions"
        },
        {
          "id": "podex.agents",
          "name": "Agents",
          "icon": "$(hubot)",
          "contextualTitle": "Podex Agents"
        },
        {
          "id": "podex.localPod",
          "name": "Local Pod",
          "icon": "$(server)",
          "contextualTitle": "Local Pod Status"
        }
      ]
    },
    "viewsWelcome": [
      {
        "view": "podex.sessions",
        "contents": "No sessions yet.\n[Create Session](command:podex.createSession)\n[Sign In](command:podex.signIn)"
      },
      {
        "view": "podex.localPod",
        "contents": "Local pod is not running.\n[Start Local Pod](command:podex.startLocalPod)"
      }
    ],
    "menus": {
      "view/title": [
        {
          "command": "podex.createSession",
          "when": "view == podex.sessions",
          "group": "navigation"
        }
      ],
      "commandPalette": [
        {
          "command": "podex.signIn",
          "when": "!podex.isSignedIn"
        },
        {
          "command": "podex.signOut",
          "when": "podex.isSignedIn"
        }
      ]
    },
    "authentication": [
      {
        "id": "podex",
        "label": "Podex"
      }
    ],
    "configuration": {
      "title": "Podex",
      "properties": {
        "podex.apiUrl": {
          "type": "string",
          "default": "https://api.podex.dev",
          "description": "Podex API server URL"
        },
        "podex.localPod.autoStart": {
          "type": "boolean",
          "default": false,
          "description": "Automatically start local pod when opening a workspace"
        },
        "podex.localPod.dockerHost": {
          "type": "string",
          "default": "",
          "description": "Docker host for local pod (leave empty for default)"
        },
        "podex.workspace.defaultLayout": {
          "type": "string",
          "enum": ["grid", "split", "single"],
          "default": "grid",
          "description": "Default workspace panel layout"
        }
      }
    },
    "walkthroughs": [
      {
        "id": "podex.gettingStarted",
        "title": "Getting Started with Podex",
        "description": "Learn how to use Podex for AI-powered development",
        "steps": [
          {
            "id": "signIn",
            "title": "Sign In",
            "description": "Sign in to your Podex account",
            "media": { "image": "resources/walkthroughs/sign-in.png", "altText": "Sign in" },
            "completionEvents": ["onContext:podex.isSignedIn"]
          },
          {
            "id": "createSession",
            "title": "Create Your First Session",
            "description": "Create a new development session",
            "media": {
              "image": "resources/walkthroughs/create-session.png",
              "altText": "Create session"
            },
            "completionEvents": ["onCommand:podex.createSession"]
          }
        ]
      }
    ]
  }
}
```

---

## Cloud Pod Integration

### FileSystemProvider

Expose cloud workspace files as `podex://workspace-{id}/path/to/file`:

```typescript
// src/providers/fileSystemProvider.ts
import * as vscode from 'vscode';
import { PodexClient } from '@podex/api-client';

export class PodexFileSystemProvider implements vscode.FileSystemProvider {
  private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this._emitter.event;

  constructor(private client: PodexClient) {}

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const { workspaceId, path } = this.parseUri(uri);
    const content = await this.client.files.read(workspaceId, path);
    return new TextEncoder().encode(content);
  }

  async writeFile(uri: vscode.Uri, content: Uint8Array): Promise<void> {
    const { workspaceId, path } = this.parseUri(uri);
    await this.client.files.write(workspaceId, path, new TextDecoder().decode(content));
    this._emitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
  }

  async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    const { workspaceId, path } = this.parseUri(uri);
    const entries = await this.client.files.list(workspaceId, path);
    return entries.map((e) => [
      e.name,
      e.isDirectory ? vscode.FileType.Directory : vscode.FileType.File,
    ]);
  }

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const { workspaceId, path } = this.parseUri(uri);
    const stat = await this.client.files.stat(workspaceId, path);
    return {
      type: stat.isDirectory ? vscode.FileType.Directory : vscode.FileType.File,
      ctime: stat.createdAt,
      mtime: stat.modifiedAt,
      size: stat.size,
    };
  }

  private parseUri(uri: vscode.Uri): { workspaceId: string; path: string } {
    // podex://workspace-abc123/src/main.ts
    const workspaceId = uri.authority;
    const path = uri.path;
    return { workspaceId, path };
  }

  // Required interface methods
  watch(): vscode.Disposable {
    return new vscode.Disposable(() => {});
  }
  async createDirectory(uri: vscode.Uri): Promise<void> {
    /* ... */
  }
  async delete(uri: vscode.Uri): Promise<void> {
    /* ... */
  }
  async rename(oldUri: vscode.Uri, newUri: vscode.Uri): Promise<void> {
    /* ... */
  }
}
```

### Terminal Integration

```typescript
// src/providers/terminalProvider.ts
import * as vscode from 'vscode';
import { SocketClient } from '@podex/api-client';

export class PodexTerminalProvider {
  constructor(private socket: SocketClient) {}

  createCloudTerminal(workspaceId: string, name: string): vscode.Terminal {
    const writeEmitter = new vscode.EventEmitter<string>();
    const closeEmitter = new vscode.EventEmitter<void>();

    const pty: vscode.Pseudoterminal = {
      onDidWrite: writeEmitter.event,
      onDidClose: closeEmitter.event,

      open: (dims) => {
        this.socket.emit('terminal_attach', {
          workspace_id: workspaceId,
          rows: dims?.rows ?? 24,
          cols: dims?.columns ?? 80,
        });

        this.socket.on('terminal_data', (data: string) => {
          writeEmitter.fire(data);
        });

        this.socket.on('terminal_exit', () => {
          closeEmitter.fire();
        });
      },

      close: () => {
        this.socket.emit('terminal_detach', { workspace_id: workspaceId });
      },

      handleInput: (data: string) => {
        this.socket.emit('terminal_input', { workspace_id: workspaceId, data });
      },

      setDimensions: (dims: vscode.TerminalDimensions) => {
        this.socket.emit('terminal_resize', {
          workspace_id: workspaceId,
          rows: dims.rows,
          cols: dims.columns,
        });
      },
    };

    return vscode.window.createTerminal({ name: `Podex: ${name}`, pty });
  }
}
```

---

## Local Pod Integration

### Pod Manager

```typescript
// src/localPod/manager.ts
import * as vscode from 'vscode';
import { spawn, ChildProcess } from 'child_process';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as os from 'os';

const execFileAsync = promisify(execFile);

export class LocalPodManager {
  private process: ChildProcess | null = null;
  private outputChannel: vscode.OutputChannel;
  private statusBarItem: vscode.StatusBarItem;

  constructor(private context: vscode.ExtensionContext) {
    this.outputChannel = vscode.window.createOutputChannel('Podex Local Pod');
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  }

  async start(workspacePath: string): Promise<void> {
    if (this.process) {
      vscode.window.showWarningMessage('Local pod is already running');
      return;
    }

    const config = vscode.workspace.getConfiguration('podex');
    const apiUrl = config.get<string>('apiUrl');

    // Get auth token from secure storage
    const authToken = await this.context.secrets.get('podex.authToken');
    if (!authToken) {
      vscode.window.showErrorMessage('Please sign in to Podex first');
      return;
    }

    const podexPath = await this.findPodexExecutable();
    if (!podexPath) {
      const install = await vscode.window.showErrorMessage(
        'Local pod not found. Install it?',
        'Install via pip'
      );
      if (install) {
        this.outputChannel.show();
        // Guide installation
      }
      return;
    }

    this.outputChannel.appendLine(`Starting local pod at ${workspacePath}`);
    this.outputChannel.show();

    // Use spawn with explicit arguments array (safe from injection)
    this.process = spawn(podexPath, ['local-pod', 'start', '--workspace', workspacePath], {
      env: {
        ...process.env,
        PODEX_API_URL: apiUrl,
        PODEX_AUTH_TOKEN: authToken,
      },
      cwd: workspacePath,
    });

    this.process.stdout?.on('data', (data) => {
      this.outputChannel.appendLine(data.toString().trim());
    });

    this.process.stderr?.on('data', (data) => {
      this.outputChannel.appendLine(`[stderr] ${data.toString().trim()}`);
    });

    this.process.on('exit', (code) => {
      this.outputChannel.appendLine(`Local pod exited with code ${code}`);
      this.process = null;
      this.updateStatus(false);
    });

    this.updateStatus(true);
    vscode.commands.executeCommand('setContext', 'podex.localPodRunning', true);
  }

  async stop(): Promise<void> {
    if (!this.process) {
      return;
    }

    this.outputChannel.appendLine('Stopping local pod...');
    this.process.kill('SIGTERM');

    // Force kill after 5 seconds
    setTimeout(() => {
      if (this.process) {
        this.process.kill('SIGKILL');
      }
    }, 5000);

    this.process = null;
    this.updateStatus(false);
    vscode.commands.executeCommand('setContext', 'podex.localPodRunning', false);
  }

  isRunning(): boolean {
    return this.process !== null;
  }

  private async findPodexExecutable(): Promise<string | null> {
    // Check common locations using execFile (safe)
    const candidates = [
      'podex-local-pod', // In PATH
      path.join(os.homedir(), '.local', 'bin', 'podex-local-pod'),
      path.join(os.homedir(), '.podex', 'bin', 'podex-local-pod'),
    ];

    for (const candidate of candidates) {
      try {
        // Use execFile with 'which' command (safe - no shell interpolation)
        await execFileAsync('which', [candidate]);
        return candidate;
      } catch {
        continue;
      }
    }

    return null;
  }

  private updateStatus(running: boolean): void {
    if (running) {
      this.statusBarItem.text = '$(server) Podex: Local Pod Running';
      this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
      this.statusBarItem.command = 'podex.stopLocalPod';
    } else {
      this.statusBarItem.text = '$(server) Podex: Local Pod';
      this.statusBarItem.backgroundColor = undefined;
      this.statusBarItem.command = 'podex.startLocalPod';
    }
    this.statusBarItem.show();
  }

  dispose(): void {
    this.stop();
    this.outputChannel.dispose();
    this.statusBarItem.dispose();
  }
}
```

### Discovery

```typescript
// src/localPod/discovery.ts
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as net from 'net';

interface LocalPodInfo {
  pid: number;
  port: number;
  workspacePath: string;
  startedAt: Date;
}

export async function discoverRunningPod(): Promise<LocalPodInfo | null> {
  const pidFile = path.join(os.homedir(), '.podex', 'local-pod.pid');

  if (!fs.existsSync(pidFile)) {
    return null;
  }

  try {
    const content = JSON.parse(fs.readFileSync(pidFile, 'utf-8'));

    // Verify process is still running
    if (!isProcessRunning(content.pid)) {
      fs.unlinkSync(pidFile);
      return null;
    }

    // Verify socket is reachable
    const reachable = await isPortReachable(content.port);
    if (!reachable) {
      return null;
    }

    return {
      pid: content.pid,
      port: content.port,
      workspacePath: content.workspacePath,
      startedAt: new Date(content.startedAt),
    };
  } catch {
    return null;
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isPortReachable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(1000);

    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });

    socket.on('error', () => resolve(false));
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });

    socket.connect(port, '127.0.0.1');
  });
}
```

---

## Webview Architecture

### Communication Protocol

```typescript
// Types shared between extension and webview
// src/panels/messageTypes.ts

// Extension -> Webview
export type ExtensionMessage =
  | { type: 'session:update'; payload: Session }
  | { type: 'session:agents'; payload: Agent[] }
  | { type: 'agent:message'; payload: AgentMessage }
  | { type: 'agent:stream:start'; payload: { agentId: string } }
  | { type: 'agent:stream:token'; payload: { agentId: string; token: string } }
  | { type: 'agent:stream:end'; payload: { agentId: string; message: AgentMessage } }
  | { type: 'approval:request'; payload: ApprovalRequest }
  | { type: 'workspace:status'; payload: WorkspaceStatus }
  | { type: 'theme:changed'; payload: { kind: 'light' | 'dark'; colors: ThemeColors } }
  | { type: 'config:update'; payload: ExtensionConfig };

// Webview -> Extension
export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'agent:send'; payload: { agentId: string; message: string } }
  | { type: 'agent:stop'; payload: { agentId: string } }
  | { type: 'approval:respond'; payload: { id: string; approved: boolean; allowlist?: boolean } }
  | { type: 'file:open'; payload: { path: string; workspaceId?: string } }
  | { type: 'terminal:input'; payload: { data: string } }
  | { type: 'terminal:resize'; payload: { rows: number; cols: number } }
  | { type: 'layout:save'; payload: GridLayout };
```

### Panel Manager

```typescript
// src/panels/workspacePanel.ts
import * as vscode from 'vscode';
import { ExtensionMessage, WebviewMessage } from './messageTypes';

export class WorkspacePanelManager {
  private panel: vscode.WebviewPanel | undefined;
  private disposables: vscode.Disposable[] = [];

  constructor(
    private context: vscode.ExtensionContext,
    private onMessage: (message: WebviewMessage) => void
  ) {}

  show(sessionId: string): void {
    if (this.panel) {
      this.panel.reveal();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'podexWorkspace',
      'Podex Workspace',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview')],
      }
    );

    this.panel.webview.html = this.getHtml(this.panel.webview);

    this.panel.webview.onDidReceiveMessage(
      (message: WebviewMessage) => this.onMessage(message),
      null,
      this.disposables
    );

    this.panel.onDidDispose(() => {
      this.panel = undefined;
      this.disposables.forEach((d) => d.dispose());
      this.disposables = [];
    });

    // Send theme info on load
    this.sendThemeInfo();

    // Listen for theme changes
    this.disposables.push(vscode.window.onDidChangeActiveColorTheme(() => this.sendThemeInfo()));
  }

  postMessage(message: ExtensionMessage): void {
    this.panel?.webview.postMessage(message);
  }

  private sendThemeInfo(): void {
    const theme = vscode.window.activeColorTheme;
    this.postMessage({
      type: 'theme:changed',
      payload: {
        kind: theme.kind === vscode.ColorThemeKind.Dark ? 'dark' : 'light',
        colors: this.extractThemeColors(),
      },
    });
  }

  private extractThemeColors(): ThemeColors {
    // Extract VSCode theme CSS variables for webview styling
    return {
      background: 'var(--vscode-editor-background)',
      foreground: 'var(--vscode-editor-foreground)',
      primary: 'var(--vscode-button-background)',
      border: 'var(--vscode-panel-border)',
    };
  }

  private getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview', 'webview.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview', 'webview.css')
    );

    const nonce = this.getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src wss: https:; img-src ${webview.cspSource} https: data:;">
  <link href="${styleUri}" rel="stylesheet">
  <title>Podex Workspace</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private getNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let nonce = '';
    for (let i = 0; i < 32; i++) {
      nonce += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return nonce;
  }
}
```

### Webview React App

```typescript
// webview/src/App.tsx
import React, { useEffect } from 'react';
import { useVSCodeState } from './hooks/useVSCodeState';
import { useVSCodeMessage } from './hooks/useVSCodeMessage';
import { useSessionStore } from '@podex/stores';
import { AgentGrid } from '@podex/ui';
import './styles/vscode-theme.css';

export function App() {
  const { postMessage, subscribe } = useVSCodeMessage();
  const { session, agents, updateSession, updateAgents, addMessage } = useSessionStore();

  useEffect(() => {
    // Tell extension we're ready
    postMessage({ type: 'ready' });

    // Subscribe to extension messages
    const unsubscribe = subscribe((message) => {
      switch (message.type) {
        case 'session:update':
          updateSession(message.payload);
          break;
        case 'session:agents':
          updateAgents(message.payload);
          break;
        case 'agent:message':
          addMessage(message.payload);
          break;
        case 'agent:stream:token':
          // Handle streaming token
          break;
        case 'theme:changed':
          document.body.dataset.theme = message.payload.kind;
          break;
      }
    });

    return unsubscribe;
  }, []);

  const handleSendMessage = (agentId: string, message: string) => {
    postMessage({ type: 'agent:send', payload: { agentId, message } });
  };

  const handleApproval = (id: string, approved: boolean, allowlist?: boolean) => {
    postMessage({ type: 'approval:respond', payload: { id, approved, allowlist } });
  };

  const handleFileOpen = (path: string) => {
    postMessage({ type: 'file:open', payload: { path } });
  };

  if (!session) {
    return <div className="loading">Loading session...</div>;
  }

  return (
    <div className="podex-workspace">
      <AgentGrid
        session={session}
        agents={agents}
        onSendMessage={handleSendMessage}
        onApproval={handleApproval}
        onFileOpen={handleFileOpen}
      />
    </div>
  );
}
```

### VSCode Message Hook

```typescript
// webview/src/hooks/useVSCodeMessage.ts
import { useCallback, useEffect, useRef } from 'react';
import type { ExtensionMessage, WebviewMessage } from '../../../src/panels/messageTypes';

// Declare the VSCode API
declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

type MessageHandler = (message: ExtensionMessage) => void;

export function useVSCodeMessage() {
  const handlersRef = useRef<Set<MessageHandler>>(new Set());

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const message = event.data as ExtensionMessage;
      handlersRef.current.forEach((h) => h(message));
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const postMessage = useCallback((message: WebviewMessage) => {
    vscode.postMessage(message);
  }, []);

  const subscribe = useCallback((handler: MessageHandler) => {
    handlersRef.current.add(handler);
    return () => handlersRef.current.delete(handler);
  }, []);

  return { postMessage, subscribe };
}
```

---

## Authentication Flow

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  VSCode Ext     │     │  System Browser │     │  Podex API      │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                        │
         │  1. User clicks       │                        │
         │     "Sign In"         │                        │
         │                       │                        │
         │  2. Open browser ────>│                        │
         │     with OAuth URL    │                        │
         │                       │  3. OAuth flow ───────>│
         │                       │<─────── Redirect ──────│
         │                       │                        │
         │  4. URI handler <─────│                        │
         │     vscode://podex... │                        │
         │                       │                        │
         │  5. Exchange code ───────────────────────────>│
         │<──────────────────────────── Access token ────│
         │                       │                        │
         │  6. Store in          │                        │
         │     SecretStorage     │                        │
         │                       │                        │
```

### Implementation

```typescript
// src/auth/authProvider.ts
import * as vscode from 'vscode';
import { PodexClient } from '@podex/api-client';

export class PodexAuthProvider implements vscode.AuthenticationProvider {
  private _onDidChangeSessions =
    new vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>();
  readonly onDidChangeSessions = this._onDidChangeSessions.event;

  private _sessions: vscode.AuthenticationSession[] = [];
  private _pendingAuth: Map<
    string,
    { resolve: (code: string) => void; reject: (err: Error) => void }
  > = new Map();

  constructor(
    private context: vscode.ExtensionContext,
    private client: PodexClient
  ) {
    // Register URI handler for OAuth callback
    context.subscriptions.push(
      vscode.window.registerUriHandler({
        handleUri: (uri) => this.handleCallback(uri),
      })
    );
  }

  async getSessions(): Promise<readonly vscode.AuthenticationSession[]> {
    // Check for stored session
    const storedToken = await this.context.secrets.get('podex.accessToken');
    if (storedToken) {
      try {
        const user = await this.client.auth.me(storedToken);
        this._sessions = [
          {
            id: user.id,
            accessToken: storedToken,
            account: { id: user.id, label: user.email },
            scopes: [],
          },
        ];
      } catch {
        // Token expired, clear it
        await this.context.secrets.delete('podex.accessToken');
        this._sessions = [];
      }
    }
    return this._sessions;
  }

  async createSession(): Promise<vscode.AuthenticationSession> {
    const state = this.generateState();
    const apiUrl = vscode.workspace.getConfiguration('podex').get<string>('apiUrl');

    // Construct OAuth URL
    const authUrl = new URL(`${apiUrl}/oauth/authorize`);
    authUrl.searchParams.set('client_id', 'vscode-extension');
    authUrl.searchParams.set('redirect_uri', 'vscode://podex.auth/callback');
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('response_type', 'code');

    // Open browser
    await vscode.env.openExternal(vscode.Uri.parse(authUrl.toString()));

    // Wait for callback
    const code = await this.waitForCallback(state);

    // Exchange code for tokens
    const tokens = await this.client.auth.exchangeCode(code, 'vscode://podex.auth/callback');

    // Store tokens securely
    await this.context.secrets.store('podex.accessToken', tokens.access_token);
    await this.context.secrets.store('podex.refreshToken', tokens.refresh_token);

    const session: vscode.AuthenticationSession = {
      id: tokens.user.id,
      accessToken: tokens.access_token,
      account: { id: tokens.user.id, label: tokens.user.email },
      scopes: [],
    };

    this._sessions = [session];
    this._onDidChangeSessions.fire({ added: [session], removed: [], changed: [] });

    vscode.commands.executeCommand('setContext', 'podex.isSignedIn', true);

    return session;
  }

  async removeSession(sessionId: string): Promise<void> {
    await this.context.secrets.delete('podex.accessToken');
    await this.context.secrets.delete('podex.refreshToken');

    const removed = this._sessions.filter((s) => s.id === sessionId);
    this._sessions = this._sessions.filter((s) => s.id !== sessionId);

    this._onDidChangeSessions.fire({ added: [], removed, changed: [] });
    vscode.commands.executeCommand('setContext', 'podex.isSignedIn', false);
  }

  private handleCallback(uri: vscode.Uri): void {
    const params = new URLSearchParams(uri.query);
    const code = params.get('code');
    const state = params.get('state');
    const error = params.get('error');

    const pending = this._pendingAuth.get(state ?? '');
    if (!pending) {
      vscode.window.showErrorMessage('Invalid OAuth state');
      return;
    }

    this._pendingAuth.delete(state!);

    if (error) {
      pending.reject(new Error(error));
    } else if (code) {
      pending.resolve(code);
    } else {
      pending.reject(new Error('No code received'));
    }
  }

  private waitForCallback(state: string): Promise<string> {
    return new Promise((resolve, reject) => {
      this._pendingAuth.set(state, { resolve, reject });

      // Timeout after 5 minutes
      setTimeout(
        () => {
          if (this._pendingAuth.has(state)) {
            this._pendingAuth.delete(state);
            reject(new Error('Authentication timed out'));
          }
        },
        5 * 60 * 1000
      );
    });
  }

  private generateState(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('');
  }
}
```

---

## Build Configuration

### Webpack (Extension Host)

```javascript
// webpack.config.js
const path = require('path');

module.exports = {
  target: 'node',
  mode: 'production',
  entry: './src/extension.ts',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'extension.js',
    libraryTarget: 'commonjs2',
  },
  externals: {
    vscode: 'commonjs vscode',
  },
  resolve: {
    extensions: ['.ts', '.js'],
    alias: {
      '@podex/api-client': path.resolve(__dirname, '../../packages/api-client/dist'),
      '@podex/stores': path.resolve(__dirname, '../../packages/stores/dist'),
    },
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
    ],
  },
  optimization: {
    minimize: true,
  },
};
```

### Vite (Webview)

```typescript
// webview/vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@podex/ui': path.resolve(__dirname, '../../../packages/ui/src'),
      '@podex/stores': path.resolve(__dirname, '../../../packages/stores/src'),
    },
  },
  build: {
    outDir: '../dist/webview',
    emptyOutDir: true,
    rollupOptions: {
      input: 'src/index.tsx',
      output: {
        entryFileNames: 'webview.js',
        assetFileNames: 'webview.[ext]',
        format: 'iife',
      },
    },
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
});
```

### Turbo Pipeline

```json
{
  "$schema": "https://turbo.build/schema.json",
  "pipeline": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**"]
    },

    "packages/api-client#build": {
      "outputs": ["dist/**"]
    },

    "packages/stores#build": {
      "dependsOn": ["packages/api-client#build"],
      "outputs": ["dist/**"]
    },

    "packages/ui#build": {
      "dependsOn": ["packages/stores#build"],
      "outputs": ["dist/**"]
    },

    "apps/vscode#build": {
      "dependsOn": ["packages/api-client#build", "packages/stores#build", "packages/ui#build"],
      "outputs": ["dist/**"]
    },

    "apps/vscode#build:webview": {
      "dependsOn": ["packages/ui#build", "packages/stores#build"],
      "outputs": ["dist/webview/**"]
    },

    "apps/vscode#package": {
      "dependsOn": ["apps/vscode#build", "apps/vscode#build:webview"],
      "outputs": ["*.vsix"]
    },

    "dev": {
      "cache": false,
      "persistent": true
    }
  }
}
```

---

## Development Workflow

```bash
# Initial setup
pnpm install

# Build all shared packages first
pnpm --filter "@podex/*" build

# Development - extension with watch mode
cd apps/vscode
pnpm dev          # Watches extension + webview

# Or run specific parts:
pnpm dev:extension  # Watch extension only
pnpm dev:webview    # Watch webview only

# Build for production
pnpm build

# Package as .vsix
pnpm package        # Creates podex-0.1.0.vsix

# Testing in VSCode:
# 1. Open apps/vscode folder in VSCode
# 2. Press F5 to launch Extension Development Host
# 3. New VSCode window opens with extension loaded

# Install local .vsix for testing
code --install-extension podex-0.1.0.vsix
```

---

## Implementation Phases

### Phase 1: Foundation (Week 1-2)

- [ ] Create `apps/vscode` scaffold with package.json manifest
- [ ] Extract `@podex/api-client` from `apps/web/src/lib`
- [ ] Basic extension activation with output channel logging
- [ ] OAuth authentication flow with SecretStorage
- [ ] Simple webview panel (loads React, shows "Hello Podex")
- [ ] Status bar item showing connection status

### Phase 2: Core Features (Week 3-4)

- [ ] Extract `@podex/stores` with platform-agnostic storage
- [ ] Sessions tree view in sidebar (list sessions from API)
- [ ] Create session command with quick pick
- [ ] Socket.IO integration in extension host
- [ ] Forward Socket events to webview
- [ ] Agent chat UI in webview (send/receive messages)
- [ ] Basic message streaming

### Phase 3: Cloud Pod (Week 5-6)

- [ ] FileSystemProvider for `podex://` scheme
- [ ] Open cloud files in native VSCode editor
- [ ] File change watchers via Socket.IO
- [ ] Terminal provider with pseudoterminal
- [ ] Cloud terminal in native VSCode terminal panel
- [ ] Approval modals (quick pick or webview modal)

### Phase 4: Local Pod (Week 7-8)

- [ ] Extract `@podex/ui` workspace components
- [ ] Local pod manager (spawn/kill process)
- [ ] Local pod discovery (find running pod)
- [ ] Local pod status in sidebar tree view
- [ ] Grid layout in webview (react-grid-layout)
- [ ] File watching for local workspace changes

### Phase 5: Polish (Week 9-10)

- [ ] Getting started walkthrough
- [ ] Settings UI for configuration
- [ ] Error handling with user-friendly messages
- [ ] Reconnection logic with exponential backoff
- [ ] Performance optimization (lazy loading, virtualization)
- [ ] Extension icon and branding
- [ ] Marketplace listing preparation
- [ ] README and documentation

---

## Open Questions

1. **OAuth redirect URI**: VSCode supports `vscode://` URI handlers, but some enterprise environments block custom protocols. Should we implement a fallback localhost callback server?

2. **Local pod distribution**: Should we bundle the Python `local-pod` package with the extension, require separate pip installation, or provide an installer command?

3. **Diff previews**: Use VSCode's native diff editor (better integration) or render diffs in webview (consistent with web app)?

4. **Multi-root workspaces**: Support multiple cloud workspaces in a single VSCode window via multi-root workspace feature?

5. **Extension size**: React + components may make the extension large (>5MB). Consider code splitting or lazy loading webview bundles?

6. **Cursor/Windsurf compatibility**: Test with VSCode forks. Any API differences to handle?

---

## Success Metrics

| Metric                          | Target                   |
| ------------------------------- | ------------------------ |
| Time to first agent interaction | < 2 minutes from install |
| Extension package size          | < 10 MB                  |
| Memory overhead                 | < 100 MB                 |
| Marketplace rating              | 4.5+ stars               |
| Monthly active users (6 months) | 1,000+                   |

---

## References

- [VSCode Extension API](https://code.visualstudio.com/api)
- [Webview API Guide](https://code.visualstudio.com/api/extension-guides/webview)
- [FileSystemProvider API](https://code.visualstudio.com/api/references/vscode-api#FileSystemProvider)
- [Authentication Provider API](https://code.visualstudio.com/api/references/vscode-api#AuthenticationProvider)
- [Pseudoterminal API](https://code.visualstudio.com/api/references/vscode-api#Pseudoterminal)
