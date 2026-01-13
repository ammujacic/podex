/**
 * Keyboard Shortcuts Manager
 *
 * A centralized system for managing keyboard shortcuts across the application.
 * Supports VS Code-like keybindings with modifier keys and chord sequences.
 */

export interface Keybinding {
  id: string;
  key: string; // e.g., "ctrl+p", "cmd+shift+f", "ctrl+k ctrl+c" (chord)
  command: string;
  when?: string; // Context condition (e.g., "editorFocus", "terminalFocus")
  description?: string;
  category?: string;
}

export interface KeybindingContext {
  editorFocus: boolean;
  terminalFocus: boolean;
  sidebarFocus: boolean;
  inputFocus: boolean;
  modalOpen: boolean;
  quickOpenOpen: boolean;
  commandPaletteOpen: boolean;
}

type CommandHandler = () => void | Promise<void>;

// Normalize key strings for cross-platform compatibility
function normalizeKey(key: string): string {
  return key
    .toLowerCase()
    .replace(/meta|cmd|command/g, 'mod') // Normalize to 'mod' for Cmd/Ctrl
    .replace(/control/g, 'ctrl')
    .replace(/option/g, 'alt')
    .replace(/\s+/g, '') // Remove whitespace
    .split('+')
    .sort((a, b) => {
      // Sort modifiers before regular keys
      const modOrder = ['mod', 'ctrl', 'alt', 'shift'];
      const aIdx = modOrder.indexOf(a);
      const bIdx = modOrder.indexOf(b);
      if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
      if (aIdx !== -1) return -1;
      if (bIdx !== -1) return 1;
      return a.localeCompare(b);
    })
    .join('+');
}

// Convert keyboard event to key string
function eventToKeyString(event: KeyboardEvent): string {
  const parts: string[] = [];

  // Use 'mod' for Cmd on Mac, Ctrl on Windows/Linux
  const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

  if (isMac) {
    if (event.metaKey) parts.push('mod');
    if (event.ctrlKey) parts.push('ctrl');
  } else {
    if (event.ctrlKey) parts.push('mod');
    if (event.metaKey) parts.push('meta');
  }

  if (event.altKey) parts.push('alt');
  if (event.shiftKey) parts.push('shift');

  // Get the key, normalizing special keys
  let key = event.key.toLowerCase();

  // Normalize special keys
  const keyMap: Record<string, string> = {
    ' ': 'space',
    arrowup: 'up',
    arrowdown: 'down',
    arrowleft: 'left',
    arrowright: 'right',
    escape: 'esc',
    backspace: 'backspace',
    delete: 'delete',
    enter: 'enter',
    tab: 'tab',
    '`': 'backtick',
  };

  key = keyMap[key] || key;

  // Don't add modifier keys as the main key
  if (!['control', 'alt', 'shift', 'meta'].includes(key)) {
    parts.push(key);
  }

  return parts
    .sort((a, b) => {
      const modOrder = ['mod', 'ctrl', 'alt', 'shift'];
      const aIdx = modOrder.indexOf(a);
      const bIdx = modOrder.indexOf(b);
      if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
      if (aIdx !== -1) return -1;
      if (bIdx !== -1) return 1;
      return a.localeCompare(b);
    })
    .join('+');
}

// Check if context condition is met
function evaluateCondition(condition: string, context: KeybindingContext): boolean {
  if (!condition) return true;

  // Simple condition parser
  const tokens = condition.split(/\s+(&&|\|\|)\s+/);
  let result = true;
  let operator = '&&';

  for (const token of tokens) {
    if (token === '&&' || token === '||') {
      operator = token;
      continue;
    }

    let value = false;
    const negated = token.startsWith('!');
    const key = negated ? token.slice(1) : token;

    if (key in context) {
      value = context[key as keyof KeybindingContext];
    }

    if (negated) value = !value;

    if (operator === '&&') {
      result = result && value;
    } else {
      result = result || value;
    }
  }

  return result;
}

class KeybindingManager {
  private bindings: Map<string, Keybinding[]> = new Map();
  private commands: Map<string, CommandHandler> = new Map();
  private context: KeybindingContext = {
    editorFocus: false,
    terminalFocus: false,
    sidebarFocus: false,
    inputFocus: false,
    modalOpen: false,
    quickOpenOpen: false,
    commandPaletteOpen: false,
  };
  private chordState: string | null = null;
  private chordTimeout: ReturnType<typeof setTimeout> | null = null;
  private pendingCommand: (() => void) | null = null;
  private listeners: Set<() => void> = new Set();

  constructor() {
    if (typeof window !== 'undefined') {
      this.setupEventListeners();
    }
  }

  private setupEventListeners() {
    // Global keyboard handler
    window.addEventListener('keydown', this.handleKeyDown.bind(this), true);

    // Track focus for context
    document.addEventListener('focusin', this.handleFocusIn.bind(this));
    document.addEventListener('focusout', this.handleFocusOut.bind(this));
  }

  private handleFocusIn(event: FocusEvent) {
    const target = event.target as HTMLElement;
    if (!target) return;

    // Check for input focus
    const isInput =
      target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

    // Check for specific focus areas
    const isEditor = target.closest('.monaco-editor') !== null;
    const isTerminal = target.closest('.xterm') !== null;
    const isSidebar = target.closest('[data-sidebar]') !== null;

    this.setContext({
      inputFocus: isInput && !isEditor,
      editorFocus: isEditor,
      terminalFocus: isTerminal,
      sidebarFocus: isSidebar,
    });
  }

  private handleFocusOut(_event: FocusEvent) {
    // Slight delay to allow new focus to be set
    setTimeout(() => {
      if (!document.activeElement || document.activeElement === document.body) {
        this.setContext({
          inputFocus: false,
          editorFocus: false,
          terminalFocus: false,
          sidebarFocus: false,
        });
      }
    }, 10);
  }

  private handleKeyDown(event: KeyboardEvent) {
    // Skip if in an input field (unless it's a global shortcut)
    const target = event.target as HTMLElement;
    const isInput =
      target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

    const keyString = eventToKeyString(event);
    if (!keyString || keyString === 'mod' || keyString === 'shift') return;

    // Handle chord sequences
    let fullKey = keyString;
    if (this.chordState) {
      fullKey = `${this.chordState} ${keyString}`;
      this.clearChord();
    }

    // Find matching keybindings
    const normalizedKey = normalizeKey(fullKey);
    const bindings = this.bindings.get(normalizedKey) || [];

    // Check for chord starters
    const isChordStarter = this.isChordStarter(normalizedKey);

    for (const binding of bindings) {
      // Check context condition
      if (binding.when && !evaluateCondition(binding.when, this.context)) {
        continue;
      }

      // Skip if in input and not a global command
      if (isInput && !binding.when?.includes('!inputFocus')) {
        // Allow some commands even in input
        const globalCommands = [
          'quickOpen.toggle',
          'commandPalette.toggle',
          'terminal.toggle',
          'sidebar.toggle',
        ];
        if (!globalCommands.includes(binding.command)) {
          continue;
        }
      }

      // Execute command
      const handler = this.commands.get(binding.command);
      if (handler) {
        event.preventDefault();
        event.stopPropagation();

        // If this key is also a chord starter, delay execution to allow chord sequences
        if (isChordStarter && !this.chordState) {
          this.startChordWithPendingCommand(normalizedKey, handler);
        } else {
          handler();
        }
        return;
      }
    }

    // Start chord if this is a chord starter
    if (isChordStarter && !this.chordState) {
      event.preventDefault();
      this.startChord(normalizedKey);
    }
  }

  private isChordStarter(key: string): boolean {
    for (const [bindingKey] of this.bindings) {
      if (bindingKey.startsWith(key + ' ')) {
        return true;
      }
    }
    return false;
  }

  private startChord(key: string) {
    this.chordState = key;
    // Clear chord after 2 seconds
    this.chordTimeout = setTimeout(() => {
      this.clearChord();
    }, 2000);
  }

  private startChordWithPendingCommand(key: string, command: CommandHandler) {
    this.chordState = key;
    this.pendingCommand = command;
    // Wait 500ms for second keypress, otherwise execute the pending command
    this.chordTimeout = setTimeout(() => {
      if (this.pendingCommand) {
        this.pendingCommand();
      }
      this.clearChord();
    }, 500);
  }

  private clearChord() {
    this.chordState = null;
    this.pendingCommand = null;
    if (this.chordTimeout) {
      clearTimeout(this.chordTimeout);
      this.chordTimeout = null;
    }
  }

  // Public API

  /**
   * Register a keybinding
   */
  registerKeybinding(binding: Keybinding) {
    const normalizedKey = normalizeKey(binding.key);
    const existing = this.bindings.get(normalizedKey) || [];
    // Remove any existing binding with same command
    const filtered = existing.filter((b) => b.command !== binding.command);
    filtered.push({ ...binding, key: normalizedKey });
    this.bindings.set(normalizedKey, filtered);
    this.notifyListeners();
  }

  /**
   * Register multiple keybindings
   */
  registerKeybindings(bindings: Keybinding[]) {
    for (const binding of bindings) {
      this.registerKeybinding(binding);
    }
  }

  /**
   * Unregister a keybinding by ID
   */
  unregisterKeybinding(id: string) {
    for (const [key, bindings] of this.bindings) {
      const filtered = bindings.filter((b) => b.id !== id);
      if (filtered.length === 0) {
        this.bindings.delete(key);
      } else {
        this.bindings.set(key, filtered);
      }
    }
    this.notifyListeners();
  }

  /**
   * Clear all keybindings
   */
  clearAllKeybindings() {
    this.bindings.clear();
    this.notifyListeners();
  }

  /**
   * Register a command handler
   */
  registerCommand(command: string, handler: CommandHandler) {
    this.commands.set(command, handler);
  }

  /**
   * Unregister a command handler
   */
  unregisterCommand(command: string) {
    this.commands.delete(command);
  }

  /**
   * Execute a command programmatically
   */
  executeCommand(command: string) {
    const handler = this.commands.get(command);
    if (handler) {
      handler();
    }
  }

  /**
   * Set context values
   */
  setContext(updates: Partial<KeybindingContext>) {
    this.context = { ...this.context, ...updates };
  }

  /**
   * Get all registered keybindings
   */
  getAllKeybindings(): Keybinding[] {
    const all: Keybinding[] = [];
    for (const bindings of this.bindings.values()) {
      all.push(...bindings);
    }
    return all;
  }

  /**
   * Get keybinding for a command
   */
  getKeybindingForCommand(command: string): Keybinding | undefined {
    for (const bindings of this.bindings.values()) {
      const found = bindings.find((b) => b.command === command);
      if (found) return found;
    }
    return undefined;
  }

  /**
   * Format key string for display
   */
  formatKeyForDisplay(key: string): string {
    const isMac =
      typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

    return key
      .split(' ')
      .map((part) =>
        part
          .split('+')
          .map((k) => {
            if (k === 'mod') return isMac ? '⌘' : 'Ctrl';
            if (k === 'ctrl') return isMac ? '⌃' : 'Ctrl';
            if (k === 'alt') return isMac ? '⌥' : 'Alt';
            if (k === 'shift') return isMac ? '⇧' : 'Shift';
            if (k === 'enter') return '↵';
            if (k === 'backspace') return '⌫';
            if (k === 'delete') return '⌦';
            if (k === 'esc') return 'Esc';
            if (k === 'tab') return '⇥';
            if (k === 'space') return 'Space';
            if (k === 'up') return '↑';
            if (k === 'down') return '↓';
            if (k === 'left') return '←';
            if (k === 'right') return '→';
            if (k === 'backtick') return '`';
            return k.toUpperCase();
          })
          .join(isMac ? '' : '+')
      )
      .join(' ');
  }

  /**
   * Subscribe to keybinding changes
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners() {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

// Singleton instance
export const keybindingManager = new KeybindingManager();
