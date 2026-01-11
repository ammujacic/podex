// ============================================================================
// Extension Manifest Types
// ============================================================================

export interface ExtensionManifest {
  id: string;
  name: string;
  displayName: string;
  version: string;
  description: string;
  author: string;
  publisher: string;
  license: string;
  repository?: string;
  icon?: string;
  main: string; // Entry point file
  categories: ExtensionCategory[];
  keywords: string[];
  engines: {
    podex: string; // Semver range e.g. "^1.0.0"
  };
  activationEvents: ActivationEvent[];
  contributes: ExtensionContributions;
  permissions: ExtensionPermission[];
  dependencies?: Record<string, string>;
}

export type ExtensionCategory =
  | 'themes'
  | 'languages'
  | 'snippets'
  | 'linters'
  | 'formatters'
  | 'debuggers'
  | 'testing'
  | 'productivity'
  | 'other';

export type ActivationEvent =
  | '*' // Always active
  | `onLanguage:${string}` // When a file of this language is opened
  | `onCommand:${string}` // When a command is executed
  | `onView:${string}` // When a view is opened
  | `onStartupFinished` // After startup
  | `workspaceContains:${string}`; // Workspace contains file pattern

export type ExtensionPermission =
  | 'filesystem.read' // Read files
  | 'filesystem.write' // Write files
  | 'terminal.execute' // Run terminal commands
  | 'network' // Make network requests
  | 'clipboard' // Access clipboard
  | 'notifications' // Show notifications
  | 'statusBar' // Modify status bar
  | 'editor.decorations' // Add editor decorations
  | 'webview'; // Create webview panels

// ============================================================================
// Extension Contributions
// ============================================================================

export interface ExtensionContributions {
  commands?: CommandContribution[];
  keybindings?: KeybindingContribution[];
  themes?: ThemeContribution[];
  languages?: LanguageContribution[];
  grammars?: GrammarContribution[];
  snippets?: SnippetContribution[];
  configuration?: ConfigurationContribution;
  views?: ViewContribution[];
  viewsContainers?: ViewContainerContribution[];
  menus?: MenuContribution;
}

export interface CommandContribution {
  command: string;
  title: string;
  category?: string;
  icon?: string;
  enablement?: string; // When expression
}

export interface KeybindingContribution {
  command: string;
  key: string;
  mac?: string;
  when?: string;
}

export interface ThemeContribution {
  id: string;
  label: string;
  uiTheme: 'vs-dark' | 'vs' | 'hc-black';
  path: string;
}

export interface LanguageContribution {
  id: string;
  aliases?: string[];
  extensions?: string[];
  filenames?: string[];
  configuration?: string;
  firstLine?: string;
  icon?: {
    light: string;
    dark: string;
  };
}

export interface GrammarContribution {
  language: string;
  scopeName: string;
  path: string;
  embeddedLanguages?: Record<string, string>;
  tokenTypes?: Record<string, string>;
}

export interface SnippetContribution {
  language: string;
  path: string;
}

export interface ConfigurationContribution {
  title: string;
  properties: Record<string, ConfigurationProperty>;
}

export interface ConfigurationProperty {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  default?: unknown;
  description: string;
  enum?: (string | number)[];
  enumDescriptions?: string[];
  minimum?: number;
  maximum?: number;
  items?: { type: string };
}

export interface ViewContribution {
  id: string;
  name: string;
  when?: string;
  icon?: string;
  contextualTitle?: string;
}

export interface ViewContainerContribution {
  id: string;
  title: string;
  icon: string;
}

export interface MenuContribution {
  commandPalette?: MenuItemContribution[];
  'editor/context'?: MenuItemContribution[];
  'editor/title'?: MenuItemContribution[];
  'explorer/context'?: MenuItemContribution[];
  'view/title'?: MenuItemContribution[];
}

export interface MenuItemContribution {
  command: string;
  when?: string;
  group?: string;
}

// ============================================================================
// Extension State
// ============================================================================

export type ExtensionState =
  | 'installed'
  | 'enabled'
  | 'disabled'
  | 'activating'
  | 'active'
  | 'error';

export interface ExtensionInfo {
  manifest: ExtensionManifest;
  state: ExtensionState;
  installPath: string;
  activatedAt?: Date;
  error?: string;
  exports?: unknown;
}

export interface ExtensionActivationError {
  extensionId: string;
  message: string;
  stack?: string;
}

// ============================================================================
// Extension API Types (Exposed to extensions)
// ============================================================================

export interface ExtensionContext {
  // Extension info
  extensionId: string;
  extensionPath: string;
  subscriptions: Disposable[];
  globalState: Memento;
  workspaceState: Memento;

  // Logging
  log: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

export interface Disposable {
  dispose(): void;
}

export interface Memento {
  get<T>(key: string): T | undefined;
  get<T>(key: string, defaultValue: T): T;
  update(key: string, value: unknown): Promise<void>;
  keys(): readonly string[];
}

export interface Event<T> {
  (listener: (e: T) => void, thisArgs?: unknown, disposables?: Disposable[]): Disposable;
}

export interface CancellationToken {
  isCancellationRequested: boolean;
  onCancellationRequested: Event<void>;
}

// ============================================================================
// Extension Message Protocol (Host <-> Sandbox)
// ============================================================================

export type ExtensionMessageType =
  | 'activate'
  | 'deactivate'
  | 'api-call'
  | 'api-response'
  | 'event'
  | 'error'
  | 'ready';

export interface ExtensionMessage {
  type: ExtensionMessageType;
  extensionId: string;
  requestId?: string;
  payload?: unknown;
  error?: string;
}

export interface ApiCallMessage extends ExtensionMessage {
  type: 'api-call';
  requestId: string;
  payload: {
    namespace: string;
    method: string;
    args: unknown[];
  };
}

export interface ApiResponseMessage extends ExtensionMessage {
  type: 'api-response';
  requestId: string;
  payload?: unknown;
  error?: string;
}

export interface EventMessage extends ExtensionMessage {
  type: 'event';
  payload: {
    eventName: string;
    data: unknown;
  };
}
