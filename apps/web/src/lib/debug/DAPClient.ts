/**
 * Debug Adapter Protocol (DAP) Client
 * Implements the DAP specification for debugging support
 */

import { create } from 'zustand';

// ============================================================================
// DAP Types (subset of the full specification)
// ============================================================================

export interface DAPMessage {
  seq: number;
  type: 'request' | 'response' | 'event';
}

export interface DAPRequest extends DAPMessage {
  type: 'request';
  command: string;
  arguments?: Record<string, unknown>;
}

export interface DAPResponse extends DAPMessage {
  type: 'response';
  request_seq: number;
  success: boolean;
  command: string;
  message?: string;
  body?: Record<string, unknown>;
}

export interface DAPEvent extends DAPMessage {
  type: 'event';
  event: string;
  body?: Record<string, unknown>;
}

export interface Source {
  name?: string;
  path?: string;
  sourceReference?: number;
}

export interface Breakpoint {
  id?: number;
  verified: boolean;
  message?: string;
  source?: Source;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
}

export interface StackFrame {
  id: number;
  name: string;
  source?: Source;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  canRestart?: boolean;
  moduleId?: number | string;
}

export interface Scope {
  name: string;
  variablesReference: number;
  namedVariables?: number;
  indexedVariables?: number;
  expensive: boolean;
  source?: Source;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
}

export interface Variable {
  name: string;
  value: string;
  type?: string;
  variablesReference: number;
  namedVariables?: number;
  indexedVariables?: number;
  evaluateName?: string;
}

export interface Thread {
  id: number;
  name: string;
}

export type StoppedReason =
  | 'step'
  | 'breakpoint'
  | 'exception'
  | 'pause'
  | 'entry'
  | 'goto'
  | 'function breakpoint'
  | 'data breakpoint';

// ============================================================================
// Debug State Store
// ============================================================================

export type DebugState = 'disconnected' | 'initializing' | 'running' | 'stopped' | 'terminated';

export interface BreakpointConfig {
  id: string;
  filePath: string;
  line: number;
  column?: number;
  condition?: string;
  hitCondition?: string;
  logMessage?: string;
  enabled: boolean;
  verified: boolean;
}

export interface DebugSession {
  id: string;
  name: string;
  type: string; // 'node', 'python', 'go', etc.
  state: DebugState;
  threads: Thread[];
  currentThreadId: number | null;
  stackFrames: StackFrame[];
  currentFrameId: number | null;
  scopes: Scope[];
  variables: Map<number, Variable[]>;
  breakpoints: BreakpointConfig[];
  stoppedReason?: StoppedReason;
  exceptionInfo?: { description: string; details?: string };
}

interface DebugStore {
  sessions: Map<string, DebugSession>;
  activeSessionId: string | null;
  consoleOutput: { type: 'stdout' | 'stderr' | 'console'; text: string; timestamp: Date }[];

  // Session management
  createSession: (id: string, name: string, type: string) => void;
  removeSession: (id: string) => void;
  setActiveSession: (id: string | null) => void;
  getActiveSession: () => DebugSession | null;

  // State updates
  updateSessionState: (id: string, state: DebugState) => void;
  setThreads: (id: string, threads: Thread[]) => void;
  setCurrentThread: (id: string, threadId: number) => void;
  setStackFrames: (id: string, frames: StackFrame[]) => void;
  setCurrentFrame: (id: string, frameId: number) => void;
  setScopes: (id: string, scopes: Scope[]) => void;
  setVariables: (id: string, reference: number, variables: Variable[]) => void;
  setStopped: (id: string, reason: StoppedReason, threadId: number) => void;

  // Breakpoints
  addBreakpoint: (breakpoint: Omit<BreakpointConfig, 'id' | 'verified'>) => BreakpointConfig;
  removeBreakpoint: (id: string) => void;
  updateBreakpoint: (id: string, updates: Partial<BreakpointConfig>) => void;
  toggleBreakpoint: (id: string) => void;
  getBreakpointsForFile: (filePath: string) => BreakpointConfig[];

  // Console
  addConsoleOutput: (type: 'stdout' | 'stderr' | 'console', text: string) => void;
  clearConsole: () => void;
}

export const useDebugStore = create<DebugStore>((set, get) => ({
  sessions: new Map(),
  activeSessionId: null,
  consoleOutput: [],

  createSession: (id, name, type) => {
    set((state) => {
      const sessions = new Map(state.sessions);
      sessions.set(id, {
        id,
        name,
        type,
        state: 'disconnected',
        threads: [],
        currentThreadId: null,
        stackFrames: [],
        currentFrameId: null,
        scopes: [],
        variables: new Map(),
        breakpoints: [],
      });
      return { sessions, activeSessionId: id };
    });
  },

  removeSession: (id) => {
    set((state) => {
      const sessions = new Map(state.sessions);
      sessions.delete(id);
      return {
        sessions,
        activeSessionId: state.activeSessionId === id ? null : state.activeSessionId,
      };
    });
  },

  setActiveSession: (id) => set({ activeSessionId: id }),

  getActiveSession: () => {
    const { sessions, activeSessionId } = get();
    return activeSessionId ? sessions.get(activeSessionId) || null : null;
  },

  updateSessionState: (id, state) => {
    set((s) => {
      const sessions = new Map(s.sessions);
      const session = sessions.get(id);
      if (session) {
        sessions.set(id, { ...session, state });
      }
      return { sessions };
    });
  },

  setThreads: (id, threads) => {
    set((s) => {
      const sessions = new Map(s.sessions);
      const session = sessions.get(id);
      if (session) {
        sessions.set(id, { ...session, threads });
      }
      return { sessions };
    });
  },

  setCurrentThread: (id, threadId) => {
    set((s) => {
      const sessions = new Map(s.sessions);
      const session = sessions.get(id);
      if (session) {
        sessions.set(id, { ...session, currentThreadId: threadId });
      }
      return { sessions };
    });
  },

  setStackFrames: (id, frames) => {
    set((s) => {
      const sessions = new Map(s.sessions);
      const session = sessions.get(id);
      if (session) {
        sessions.set(id, {
          ...session,
          stackFrames: frames,
          currentFrameId: frames[0]?.id ?? null,
        });
      }
      return { sessions };
    });
  },

  setCurrentFrame: (id, frameId) => {
    set((s) => {
      const sessions = new Map(s.sessions);
      const session = sessions.get(id);
      if (session) {
        sessions.set(id, { ...session, currentFrameId: frameId });
      }
      return { sessions };
    });
  },

  setScopes: (id, scopes) => {
    set((s) => {
      const sessions = new Map(s.sessions);
      const session = sessions.get(id);
      if (session) {
        sessions.set(id, { ...session, scopes });
      }
      return { sessions };
    });
  },

  setVariables: (id, reference, variables) => {
    set((s) => {
      const sessions = new Map(s.sessions);
      const session = sessions.get(id);
      if (session) {
        const vars = new Map(session.variables);
        vars.set(reference, variables);
        sessions.set(id, { ...session, variables: vars });
      }
      return { sessions };
    });
  },

  setStopped: (id, reason, threadId) => {
    set((s) => {
      const sessions = new Map(s.sessions);
      const session = sessions.get(id);
      if (session) {
        sessions.set(id, {
          ...session,
          state: 'stopped',
          stoppedReason: reason,
          currentThreadId: threadId,
        });
      }
      return { sessions };
    });
  },

  addBreakpoint: (bp) => {
    const breakpoint: BreakpointConfig = {
      ...bp,
      id: `bp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      verified: false,
    };
    set((state) => {
      const sessions = new Map(state.sessions);
      const activeSession = state.activeSessionId ? sessions.get(state.activeSessionId) : null;
      if (activeSession) {
        sessions.set(state.activeSessionId!, {
          ...activeSession,
          breakpoints: [...activeSession.breakpoints, breakpoint],
        });
      }
      return { sessions };
    });
    return breakpoint;
  },

  removeBreakpoint: (id) => {
    set((state) => {
      const sessions = new Map(state.sessions);
      const activeSession = state.activeSessionId ? sessions.get(state.activeSessionId) : null;
      if (activeSession) {
        sessions.set(state.activeSessionId!, {
          ...activeSession,
          breakpoints: activeSession.breakpoints.filter((bp) => bp.id !== id),
        });
      }
      return { sessions };
    });
  },

  updateBreakpoint: (id, updates) => {
    set((state) => {
      const sessions = new Map(state.sessions);
      const activeSession = state.activeSessionId ? sessions.get(state.activeSessionId) : null;
      if (activeSession) {
        sessions.set(state.activeSessionId!, {
          ...activeSession,
          breakpoints: activeSession.breakpoints.map((bp) =>
            bp.id === id ? { ...bp, ...updates } : bp
          ),
        });
      }
      return { sessions };
    });
  },

  toggleBreakpoint: (id) => {
    const { updateBreakpoint, getActiveSession } = get();
    const session = getActiveSession();
    const bp = session?.breakpoints.find((b) => b.id === id);
    if (bp) {
      updateBreakpoint(id, { enabled: !bp.enabled });
    }
  },

  getBreakpointsForFile: (filePath) => {
    const session = get().getActiveSession();
    return session?.breakpoints.filter((bp) => bp.filePath === filePath) || [];
  },

  addConsoleOutput: (type, text) => {
    set((state) => ({
      consoleOutput: [...state.consoleOutput, { type, text, timestamp: new Date() }],
    }));
  },

  clearConsole: () => set({ consoleOutput: [] }),
}));

// ============================================================================
// DAP Client Class
// ============================================================================

type MessageHandler = (message: DAPResponse | DAPEvent) => void;

export class DAPClient {
  private ws: WebSocket | null = null;
  private seq = 1;
  private pendingRequests = new Map<
    number,
    {
      resolve: (response: DAPResponse) => void;
      reject: (error: Error) => void;
    }
  >();
  private messageHandlers: MessageHandler[] = [];
  private sessionId: string;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  async connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        useDebugStore.getState().updateSessionState(this.sessionId, 'initializing');
        resolve();
      };

      this.ws.onerror = (_error) => {
        reject(new Error('WebSocket connection failed'));
      };

      this.ws.onclose = () => {
        useDebugStore.getState().updateSessionState(this.sessionId, 'disconnected');
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as DAPResponse | DAPEvent;
          this.handleMessage(message);
        } catch (error) {
          console.error('Failed to parse DAP message:', error);
        }
      };
    });
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
    this.pendingRequests.clear();
  }

  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.push(handler);
    return () => {
      this.messageHandlers = this.messageHandlers.filter((h) => h !== handler);
    };
  }

  private handleMessage(message: DAPResponse | DAPEvent): void {
    if (message.type === 'response') {
      const pending = this.pendingRequests.get(message.request_seq);
      if (pending) {
        this.pendingRequests.delete(message.request_seq);
        if (message.success) {
          pending.resolve(message);
        } else {
          pending.reject(new Error(message.message || 'Request failed'));
        }
      }
    }

    // Handle events
    if (message.type === 'event') {
      this.handleEvent(message);
    }

    // Notify handlers
    this.messageHandlers.forEach((handler) => handler(message));
  }

  private handleEvent(event: DAPEvent): void {
    const store = useDebugStore.getState();

    switch (event.event) {
      case 'initialized':
        store.updateSessionState(this.sessionId, 'running');
        break;

      case 'stopped': {
        const body = event.body as { reason: StoppedReason; threadId: number } | undefined;
        if (body) {
          store.setStopped(this.sessionId, body.reason, body.threadId);
        }
        break;
      }

      case 'continued':
        store.updateSessionState(this.sessionId, 'running');
        break;

      case 'terminated':
        store.updateSessionState(this.sessionId, 'terminated');
        break;

      case 'output': {
        const output = event.body as { category?: string; output: string } | undefined;
        if (output) {
          const category =
            output.category === 'stderr'
              ? 'stderr'
              : output.category === 'console'
                ? 'console'
                : 'stdout';
          store.addConsoleOutput(category, output.output);
        }
        break;
      }

      case 'thread':
        // Thread started/exited - refresh threads
        this.threads();
        break;

      case 'breakpoint': {
        const bpBody = event.body as { reason: string; breakpoint: Breakpoint } | undefined;
        if (bpBody?.breakpoint?.id) {
          // Update breakpoint verification status
          const session = store.sessions.get(this.sessionId);
          const bp = session?.breakpoints.find((b) => b.line === bpBody.breakpoint.line);
          if (bp) {
            store.updateBreakpoint(bp.id, { verified: bpBody.breakpoint.verified });
          }
        }
        break;
      }
    }
  }

  private async sendRequest(command: string, args?: Record<string, unknown>): Promise<DAPResponse> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket not connected'));
        return;
      }

      const seq = this.seq++;
      const request: DAPRequest = {
        seq,
        type: 'request',
        command,
        arguments: args,
      };

      this.pendingRequests.set(seq, { resolve, reject });
      this.ws.send(JSON.stringify(request));

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(seq)) {
          this.pendingRequests.delete(seq);
          reject(new Error('Request timed out'));
        }
      }, 30000);
    });
  }

  // ============================================================================
  // DAP Commands
  // ============================================================================

  async initialize(): Promise<DAPResponse> {
    return this.sendRequest('initialize', {
      clientID: 'podex',
      clientName: 'Podex IDE',
      adapterID: 'debug',
      pathFormat: 'path',
      linesStartAt1: true,
      columnsStartAt1: true,
      supportsVariableType: true,
      supportsVariablePaging: true,
      supportsRunInTerminalRequest: true,
    });
  }

  async launch(config: Record<string, unknown>): Promise<DAPResponse> {
    return this.sendRequest('launch', config);
  }

  async attach(config: Record<string, unknown>): Promise<DAPResponse> {
    return this.sendRequest('attach', config);
  }

  async disconnect(restart = false): Promise<DAPResponse> {
    return this.sendRequest('disconnect', { restart });
  }

  async setBreakpoints(
    source: Source,
    breakpoints: { line: number; condition?: string; hitCondition?: string; logMessage?: string }[]
  ): Promise<DAPResponse> {
    return this.sendRequest('setBreakpoints', { source, breakpoints });
  }

  async configurationDone(): Promise<DAPResponse> {
    return this.sendRequest('configurationDone');
  }

  async continue(threadId: number): Promise<DAPResponse> {
    useDebugStore.getState().updateSessionState(this.sessionId, 'running');
    return this.sendRequest('continue', { threadId });
  }

  async next(threadId: number): Promise<DAPResponse> {
    return this.sendRequest('next', { threadId });
  }

  async stepIn(threadId: number): Promise<DAPResponse> {
    return this.sendRequest('stepIn', { threadId });
  }

  async stepOut(threadId: number): Promise<DAPResponse> {
    return this.sendRequest('stepOut', { threadId });
  }

  async pause(threadId: number): Promise<DAPResponse> {
    return this.sendRequest('pause', { threadId });
  }

  async threads(): Promise<Thread[]> {
    const response = await this.sendRequest('threads');
    const threads = (response.body?.threads as Thread[]) || [];
    useDebugStore.getState().setThreads(this.sessionId, threads);
    return threads;
  }

  async stackTrace(threadId: number, startFrame = 0, levels = 20): Promise<StackFrame[]> {
    const response = await this.sendRequest('stackTrace', {
      threadId,
      startFrame,
      levels,
    });
    const frames = (response.body?.stackFrames as StackFrame[]) || [];
    useDebugStore.getState().setStackFrames(this.sessionId, frames);
    return frames;
  }

  async scopes(frameId: number): Promise<Scope[]> {
    const response = await this.sendRequest('scopes', { frameId });
    const scopes = (response.body?.scopes as Scope[]) || [];
    useDebugStore.getState().setScopes(this.sessionId, scopes);
    return scopes;
  }

  async variables(
    variablesReference: number,
    filter?: 'indexed' | 'named',
    start?: number,
    count?: number
  ): Promise<Variable[]> {
    const response = await this.sendRequest('variables', {
      variablesReference,
      filter,
      start,
      count,
    });
    const variables = (response.body?.variables as Variable[]) || [];
    useDebugStore.getState().setVariables(this.sessionId, variablesReference, variables);
    return variables;
  }

  async evaluate(
    expression: string,
    frameId?: number,
    context?: 'watch' | 'repl' | 'hover'
  ): Promise<{ result: string; type?: string; variablesReference: number }> {
    const response = await this.sendRequest('evaluate', {
      expression,
      frameId,
      context,
    });
    return response.body as { result: string; type?: string; variablesReference: number };
  }

  async setVariable(variablesReference: number, name: string, value: string): Promise<void> {
    await this.sendRequest('setVariable', { variablesReference, name, value });
  }

  async restart(): Promise<DAPResponse> {
    return this.sendRequest('restart');
  }

  async terminate(): Promise<DAPResponse> {
    return this.sendRequest('terminate');
  }
}
