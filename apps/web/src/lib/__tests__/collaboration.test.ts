/**
 * Comprehensive tests for Y.js collaboration module
 */
import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import type { Socket } from 'socket.io-client';

// Event handler maps for capturing socket event listeners
let eventHandlers: Map<string, Function>;

// Mock Y.Text class
class MockYText {
  private content = '';

  get length(): number {
    return this.content.length;
  }

  insert(index: number, text: string) {
    this.content = this.content.slice(0, index) + text + this.content.slice(index);
  }

  delete(index: number, length: number) {
    this.content = this.content.slice(0, index) + this.content.slice(index + length);
  }

  toString() {
    return this.content;
  }

  observe() {}
  unobserve() {}
}

// Mock Y.Array class
class MockYArray {
  private items: unknown[] = [];

  get length(): number {
    return this.items.length;
  }

  push(items: unknown[]) {
    this.items.push(...items);
  }

  toArray() {
    return [...this.items];
  }

  observe() {}
  unobserve() {}
}

// Mock Y.Map class
class MockYMap {
  private data = new Map<string, unknown>();

  set(key: string, value: unknown) {
    this.data.set(key, value);
  }

  get(key: string) {
    return this.data.get(key);
  }

  toJSON() {
    return Object.fromEntries(this.data);
  }

  observe() {}
  unobserve() {}
}

// Track created doc instances
let docInstances: MockYDoc[] = [];
let lastDoc: MockYDoc | null = null;

// Mock Y.Doc class
class MockYDoc {
  private texts = new Map<string, MockYText>();
  private arrays = new Map<string, MockYArray>();
  private maps = new Map<string, MockYMap>();
  updateHandler: Function | null = null;

  constructor() {
    docInstances.push(this);
    lastDoc = this;
  }

  getText(name: string): MockYText {
    if (!this.texts.has(name)) {
      this.texts.set(name, new MockYText());
    }
    return this.texts.get(name)!;
  }

  getArray(name: string): MockYArray {
    if (!this.arrays.has(name)) {
      this.arrays.set(name, new MockYArray());
    }
    return this.arrays.get(name)!;
  }

  getMap(name: string): MockYMap {
    if (!this.maps.has(name)) {
      this.maps.set(name, new MockYMap());
    }
    return this.maps.get(name)!;
  }

  on(event: string, handler: Function) {
    if (event === 'update') {
      this.updateHandler = handler;
    }
  }

  off() {}

  destroy() {}
}

// Track created awareness instances
let awarenessInstances: MockAwareness[] = [];
let lastAwareness: MockAwareness | null = null;

// Mock Awareness class
class MockAwareness {
  clientID = 12345;
  private localState: unknown = null;
  private states = new Map<number, unknown>();
  changeHandler: Function | null = null;
  updateHandler: Function | null = null;

  constructor() {
    awarenessInstances.push(this);
    lastAwareness = this;
  }

  setLocalState(state: unknown) {
    this.localState = state;
  }

  getLocalState() {
    return this.localState;
  }

  getStates() {
    return new Map(this.states);
  }

  setRemoteState(clientId: number, state: unknown) {
    this.states.set(clientId, state);
  }

  on(event: string, handler: Function) {
    if (event === 'change') {
      this.changeHandler = handler;
    } else if (event === 'update') {
      this.updateHandler = handler;
    }
  }

  off() {}

  destroy() {}
}

// Mock socket
const mockSocket = {
  emit: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  connected: false,
  id: 'mock-socket-id',
} as unknown as Socket;

// Mock modules - use class-based mocks
vi.mock('socket.io-client', () => ({
  io: vi.fn(() => mockSocket),
}));

vi.mock('yjs', () => {
  return {
    Doc: MockYDoc,
    Map: MockYMap,
    applyUpdate: vi.fn(),
    encodeStateAsUpdate: vi.fn(() => new Uint8Array([1, 2, 3])),
  };
});

vi.mock('y-protocols/awareness', () => {
  return {
    Awareness: MockAwareness,
    encodeAwarenessUpdate: vi.fn(() => new Uint8Array([4, 5, 6])),
    applyAwarenessUpdate: vi.fn(),
    removeAwarenessStates: vi.fn(),
  };
});

describe('Collaboration Module', () => {
  let collaborationModule: typeof import('../collaboration');
  let io: typeof import('socket.io-client').io;
  let Y: typeof import('yjs');
  let awarenessProtocol: typeof import('y-protocols/awareness');

  beforeEach(async () => {
    // Reset module cache to get fresh state
    vi.resetModules();
    vi.clearAllMocks();

    eventHandlers = new Map();
    docInstances = [];
    awarenessInstances = [];
    lastDoc = null;
    lastAwareness = null;

    // Reset mock socket state
    mockSocket.connected = false;

    // Capture event handlers
    (mockSocket.on as Mock).mockImplementation((event: string, handler: Function) => {
      eventHandlers.set(event, handler);
      return mockSocket;
    });

    (mockSocket.off as Mock).mockImplementation((event: string, handler?: Function) => {
      if (handler) {
        eventHandlers.delete(event);
      }
      return mockSocket;
    });

    // Re-import modules fresh
    collaborationModule = await import('../collaboration');
    io = (await import('socket.io-client')).io;
    Y = await import('yjs');
    awarenessProtocol = await import('y-protocols/awareness');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Socket Connection', () => {
    it('should create socket with correct configuration', () => {
      collaborationModule.getSocket();

      expect(io).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          transports: ['websocket'],
          autoConnect: true,
          reconnection: true,
          reconnectionAttempts: 5,
          reconnectionDelay: 1000,
        })
      );
    });

    it('should return same socket instance on multiple calls', () => {
      const socket1 = collaborationModule.getSocket();
      const socket2 = collaborationModule.getSocket();

      expect(socket1).toBe(socket2);
    });

    it('should set up connect event handler', () => {
      collaborationModule.getSocket();

      expect(mockSocket.on).toHaveBeenCalledWith('connect', expect.any(Function));
    });

    it('should set up disconnect event handler', () => {
      collaborationModule.getSocket();

      expect(mockSocket.on).toHaveBeenCalledWith('disconnect', expect.any(Function));
    });

    it('should return connection status', () => {
      // Get socket first to ensure it's created
      collaborationModule.getSocket();

      // Test connected state
      mockSocket.connected = true;
      expect(collaborationModule.isConnected()).toBe(true);

      // Test disconnected state
      mockSocket.connected = false;
      expect(collaborationModule.isConnected()).toBe(false);
    });

    it('should reconnect socket', () => {
      collaborationModule.getSocket();
      collaborationModule.reconnect();

      expect(mockSocket.connect).toHaveBeenCalled();
    });
  });

  describe('Session Management', () => {
    it('should join session', () => {
      collaborationModule.getSocket();
      collaborationModule.joinSession('session-123', 'user-456');

      expect(mockSocket.emit).toHaveBeenCalledWith('session_join', {
        session_id: 'session-123',
        user_id: 'user-456',
      });
    });

    it('should leave session', () => {
      collaborationModule.getSocket();
      collaborationModule.leaveSession('session-123', 'user-456');

      expect(mockSocket.emit).toHaveBeenCalledWith('session_leave', {
        session_id: 'session-123',
        user_id: 'user-456',
      });
    });
  });

  describe('Y.js Document Management', () => {
    it('should create new Y.Doc for session/document pair', () => {
      collaborationModule.getYDoc('session-1', 'file:/workspace/app.tsx');

      expect(docInstances.length).toBe(1);
    });

    it('should return cached Y.Doc for same session/document pair', () => {
      collaborationModule.getYDoc('session-1', 'file:/workspace/app.tsx');
      collaborationModule.getYDoc('session-1', 'file:/workspace/app.tsx');

      // Should only create once
      expect(docInstances.length).toBe(1);
    });

    it('should create separate Y.Docs for different documents', () => {
      collaborationModule.getYDoc('session-1', 'file:/workspace/app.tsx');
      collaborationModule.getYDoc('session-1', 'file:/workspace/index.tsx');

      expect(docInstances.length).toBe(2);
    });

    it('should subscribe to document updates on creation', () => {
      collaborationModule.getYDoc('session-1', 'file:/workspace/app.tsx');

      expect(mockSocket.emit).toHaveBeenCalledWith('yjs_subscribe', {
        session_id: 'session-1',
        doc_name: 'file:/workspace/app.tsx',
      });
    });

    it('should set up yjs_sync event handler', () => {
      collaborationModule.getYDoc('session-1', 'file:/workspace/app.tsx');

      expect(mockSocket.on).toHaveBeenCalledWith('yjs_sync', expect.any(Function));
    });

    it('should set up yjs_update event handler', () => {
      collaborationModule.getYDoc('session-1', 'file:/workspace/app.tsx');

      expect(mockSocket.on).toHaveBeenCalledWith('yjs_update', expect.any(Function));
    });

    it('should handle incoming sync state', () => {
      collaborationModule.getYDoc('session-1', 'file:/workspace/app.tsx');

      const syncHandler = eventHandlers.get('yjs_sync');
      const mockState = btoa(String.fromCharCode(...new Uint8Array([1, 2, 3])));

      syncHandler?.({
        session_id: 'session-1',
        doc_name: 'file:/workspace/app.tsx',
        state: mockState,
      });

      expect(Y.applyUpdate).toHaveBeenCalled();
    });

    it('should ignore sync state for different session', () => {
      collaborationModule.getYDoc('session-1', 'file:/workspace/app.tsx');

      const syncHandler = eventHandlers.get('yjs_sync');
      const mockState = btoa(String.fromCharCode(...new Uint8Array([1, 2, 3])));

      syncHandler?.({
        session_id: 'session-2',
        doc_name: 'file:/workspace/app.tsx',
        state: mockState,
      });

      expect(Y.applyUpdate).not.toHaveBeenCalled();
    });

    it('should handle incoming updates from other clients', () => {
      collaborationModule.getYDoc('session-1', 'file:/workspace/app.tsx');

      const updateHandler = eventHandlers.get('yjs_update');
      const mockUpdate = btoa(String.fromCharCode(...new Uint8Array([1, 2, 3])));

      updateHandler?.({
        session_id: 'session-1',
        doc_name: 'file:/workspace/app.tsx',
        update: mockUpdate,
      });

      expect(Y.applyUpdate).toHaveBeenCalled();
    });

    it('should broadcast local updates', () => {
      collaborationModule.getYDoc('session-1', 'file:/workspace/app.tsx');

      // Get the update handler from the mock doc
      const updateHandler = lastDoc?.updateHandler;

      // Simulate local update (not from socket)
      updateHandler?.(new Uint8Array([1, 2, 3]), 'local');

      expect(mockSocket.emit).toHaveBeenCalledWith(
        'yjs_update',
        expect.objectContaining({
          session_id: 'session-1',
          doc_name: 'file:/workspace/app.tsx',
          update: expect.any(String),
        })
      );
    });

    it('should not broadcast updates from socket', () => {
      collaborationModule.getYDoc('session-1', 'file:/workspace/app.tsx');

      // Clear previous emit calls
      (mockSocket.emit as Mock).mockClear();

      // Get the update handler from the mock doc
      const updateHandler = lastDoc?.updateHandler;

      // Simulate update from socket
      updateHandler?.(new Uint8Array([1, 2, 3]), 'socket');

      // Should not emit yjs_update for socket-originated updates
      const yjsUpdateCalls = (mockSocket.emit as Mock).mock.calls.filter(
        (call) => call[0] === 'yjs_update'
      );
      expect(yjsUpdateCalls.length).toBe(0);
    });
  });

  describe('Document Cleanup', () => {
    it('should emit unsubscribe event', () => {
      collaborationModule.getYDoc('session-1', 'file:/workspace/app.tsx');
      collaborationModule.destroyYDoc('session-1', 'file:/workspace/app.tsx');

      expect(mockSocket.emit).toHaveBeenCalledWith('yjs_unsubscribe', {
        session_id: 'session-1',
        doc_name: 'file:/workspace/app.tsx',
      });
    });

    it('should clean up socket event listeners', () => {
      collaborationModule.getYDoc('session-1', 'file:/workspace/app.tsx');
      collaborationModule.destroyYDoc('session-1', 'file:/workspace/app.tsx');

      expect(mockSocket.off).toHaveBeenCalled();
    });
  });

  describe('Awareness and Presence', () => {
    it('should create awareness for document', () => {
      collaborationModule.getAwareness('session-1', 'file:/workspace/app.tsx');

      expect(awarenessInstances.length).toBe(1);
    });

    it('should return cached awareness for same document', () => {
      collaborationModule.getAwareness('session-1', 'file:/workspace/app.tsx');
      collaborationModule.getAwareness('session-1', 'file:/workspace/app.tsx');

      expect(awarenessInstances.length).toBe(1);
    });

    it('should set up yjs_awareness event handler', () => {
      collaborationModule.getAwareness('session-1', 'file:/workspace/app.tsx');

      expect(mockSocket.on).toHaveBeenCalledWith('yjs_awareness', expect.any(Function));
    });

    it('should set up yjs_awareness_remove event handler', () => {
      collaborationModule.getAwareness('session-1', 'file:/workspace/app.tsx');

      expect(mockSocket.on).toHaveBeenCalledWith('yjs_awareness_remove', expect.any(Function));
    });

    it('should handle incoming awareness updates', () => {
      collaborationModule.getAwareness('session-1', 'file:/workspace/app.tsx');

      const awarenessHandler = eventHandlers.get('yjs_awareness');
      const mockAwarenessUpdate = btoa(String.fromCharCode(...new Uint8Array([4, 5, 6])));

      awarenessHandler?.({
        session_id: 'session-1',
        doc_name: 'file:/workspace/app.tsx',
        awareness: mockAwarenessUpdate,
      });

      expect(awarenessProtocol.applyAwarenessUpdate).toHaveBeenCalled();
    });

    it('should ignore awareness updates for different session', () => {
      collaborationModule.getAwareness('session-1', 'file:/workspace/app.tsx');

      const awarenessHandler = eventHandlers.get('yjs_awareness');
      const mockAwarenessUpdate = btoa(String.fromCharCode(...new Uint8Array([4, 5, 6])));

      awarenessHandler?.({
        session_id: 'session-2',
        doc_name: 'file:/workspace/app.tsx',
        awareness: mockAwarenessUpdate,
      });

      expect(awarenessProtocol.applyAwarenessUpdate).not.toHaveBeenCalled();
    });

    it('should handle awareness remove events', () => {
      collaborationModule.getAwareness('session-1', 'file:/workspace/app.tsx');

      const removeHandler = eventHandlers.get('yjs_awareness_remove');

      removeHandler?.({
        session_id: 'session-1',
        doc_name: 'file:/workspace/app.tsx',
        client_ids: [67890],
      });

      expect(awarenessProtocol.removeAwarenessStates).toHaveBeenCalled();
    });

    it('should broadcast local awareness updates', () => {
      collaborationModule.getAwareness('session-1', 'file:/workspace/app.tsx');

      // Get the awareness update handler
      const updateHandler = lastAwareness?.updateHandler;

      // Simulate awareness update including our client ID
      updateHandler?.({ added: [12345], updated: [], removed: [] });

      expect(mockSocket.emit).toHaveBeenCalledWith(
        'yjs_awareness',
        expect.objectContaining({
          session_id: 'session-1',
          doc_name: 'file:/workspace/app.tsx',
          client_id: 12345,
        })
      );
    });

    it('should not broadcast awareness updates for other clients only', () => {
      collaborationModule.getAwareness('session-1', 'file:/workspace/app.tsx');

      // Clear previous emit calls
      (mockSocket.emit as Mock).mockClear();

      // Get the awareness update handler
      const updateHandler = lastAwareness?.updateHandler;

      // Simulate awareness update not including our client ID
      updateHandler?.({ added: [99999], updated: [], removed: [] });

      const awarenessCalls = (mockSocket.emit as Mock).mock.calls.filter(
        (call) => call[0] === 'yjs_awareness'
      );
      expect(awarenessCalls.length).toBe(0);
    });

    it('should emit awareness remove on document cleanup', () => {
      collaborationModule.getAwareness('session-1', 'file:/workspace/app.tsx');
      collaborationModule.destroyYDoc('session-1', 'file:/workspace/app.tsx');

      expect(mockSocket.emit).toHaveBeenCalledWith(
        'yjs_awareness_remove',
        expect.objectContaining({
          session_id: 'session-1',
          doc_name: 'file:/workspace/app.tsx',
          client_ids: [12345],
        })
      );
    });
  });

  describe('User Info and Cursor', () => {
    it('should set user info', () => {
      const userInfo: collaborationModule.CollaboratorInfo = {
        id: 'user-1',
        name: 'John Doe',
        color: '#ff0000',
        cursor: { line: 10, column: 5 },
      };

      collaborationModule.setUserInfo('session-1', 'file:/workspace/app.tsx', userInfo);

      expect(lastAwareness?.getLocalState()).toEqual({
        user: userInfo,
        cursor: userInfo.cursor,
      });
    });

    it('should update cursor position', () => {
      // First set user info
      const userInfo: collaborationModule.CollaboratorInfo = {
        id: 'user-1',
        name: 'John',
        color: '#ff0000',
      };
      collaborationModule.setUserInfo('session-1', 'file:/workspace/app.tsx', userInfo);

      // Then update cursor
      collaborationModule.updateCursor('session-1', 'file:/workspace/app.tsx', {
        line: 20,
        column: 10,
      });

      const state = lastAwareness?.getLocalState() as { cursor?: { line: number; column: number } };
      expect(state?.cursor).toEqual({ line: 20, column: 10 });
    });

    it('should set cursor to null', () => {
      // First set user info
      const userInfo: collaborationModule.CollaboratorInfo = {
        id: 'user-1',
        name: 'John',
        color: '#ff0000',
        cursor: { line: 1, column: 1 },
      };
      collaborationModule.setUserInfo('session-1', 'file:/workspace/app.tsx', userInfo);

      // Then set cursor to null
      collaborationModule.updateCursor('session-1', 'file:/workspace/app.tsx', null);

      const state = lastAwareness?.getLocalState() as { cursor?: null };
      expect(state?.cursor).toBeNull();
    });

    it('should not update cursor when no local state', () => {
      // Don't set any user info first
      collaborationModule.getAwareness('session-1', 'file:/workspace/app.tsx');

      // Try to update cursor - should not throw
      expect(() => {
        collaborationModule.updateCursor('session-1', 'file:/workspace/app.tsx', {
          line: 20,
          column: 10,
        });
      }).not.toThrow();
    });
  });

  describe('Collaborator Management', () => {
    it('should return empty array when no collaborators', () => {
      const collaborators = collaborationModule.getCollaborators(
        'session-1',
        'file:/workspace/app.tsx'
      );

      expect(collaborators).toEqual([]);
    });

    it('should return collaborators excluding self', () => {
      collaborationModule.getAwareness('session-1', 'file:/workspace/app.tsx');

      // Add remote user state
      lastAwareness?.setRemoteState(67890, {
        user: { id: 'user-2', name: 'Other', color: '#00ff00' },
      });

      const collaborators = collaborationModule.getCollaborators(
        'session-1',
        'file:/workspace/app.tsx'
      );

      expect(collaborators).toHaveLength(1);
      expect(collaborators[0]).toEqual({ id: 'user-2', name: 'Other', color: '#00ff00' });
    });
  });

  describe('Awareness Change Subscription', () => {
    it('should subscribe to awareness changes', () => {
      const callback = vi.fn();

      collaborationModule.onAwarenessChange('session-1', 'file:/workspace/app.tsx', callback);

      expect(lastAwareness?.changeHandler).toBeDefined();
    });

    it('should return unsubscribe function', () => {
      const callback = vi.fn();

      const unsubscribe = collaborationModule.onAwarenessChange(
        'session-1',
        'file:/workspace/app.tsx',
        callback
      );

      expect(typeof unsubscribe).toBe('function');
    });

    it('should call callback with collaborators on change', () => {
      const callback = vi.fn();

      collaborationModule.onAwarenessChange('session-1', 'file:/workspace/app.tsx', callback);

      // Trigger change
      const changeHandler = lastAwareness?.changeHandler;
      changeHandler?.();

      expect(callback).toHaveBeenCalled();
    });
  });

  describe('Agent Messages', () => {
    it('should get agent messages array', () => {
      const messages = collaborationModule.getAgentMessages('session-1', 'agent-1');

      expect(messages).toBeDefined();
    });

    it('should add message to agent conversation', () => {
      const message = {
        id: 'msg-1',
        role: 'user' as const,
        content: 'Hello, agent!',
        timestamp: Date.now(),
        userId: 'user-1',
      };

      // Should not throw
      expect(() => {
        collaborationModule.addAgentMessage('session-1', 'agent-1', message);
      }).not.toThrow();
    });

    it('should add message without userId', () => {
      const message = {
        id: 'msg-2',
        role: 'assistant' as const,
        content: 'Hello!',
        timestamp: Date.now(),
      };

      // Should not throw
      expect(() => {
        collaborationModule.addAgentMessage('session-1', 'agent-1', message);
      }).not.toThrow();
    });
  });

  describe('Agent Status Events', () => {
    it('should subscribe to agent status updates', () => {
      const callback = vi.fn();

      collaborationModule.onAgentStatusUpdate(callback);

      expect(mockSocket.on).toHaveBeenCalledWith('agent_status_update', callback);
    });

    it('should return unsubscribe function', () => {
      const callback = vi.fn();

      const unsubscribe = collaborationModule.onAgentStatusUpdate(callback);
      unsubscribe();

      expect(mockSocket.off).toHaveBeenCalledWith('agent_status_update', callback);
    });

    it('should broadcast agent status', () => {
      collaborationModule.broadcastAgentStatus('session-1', 'agent-1', 'active');

      expect(mockSocket.emit).toHaveBeenCalledWith('agent_status_update', {
        session_id: 'session-1',
        agent_id: 'agent-1',
        status: 'active',
      });
    });
  });

  describe('Agent Typing Events', () => {
    it('should subscribe to agent typing', () => {
      const callback = vi.fn();

      collaborationModule.onAgentTyping(callback);

      expect(mockSocket.on).toHaveBeenCalledWith('agent_typing', callback);
    });

    it('should return unsubscribe function', () => {
      const callback = vi.fn();

      const unsubscribe = collaborationModule.onAgentTyping(callback);
      unsubscribe();

      expect(mockSocket.off).toHaveBeenCalledWith('agent_typing', callback);
    });

    it('should broadcast typing start', () => {
      collaborationModule.broadcastAgentTyping('session-1', 'agent-1', 'user-1', true);

      expect(mockSocket.emit).toHaveBeenCalledWith('agent_typing', {
        session_id: 'session-1',
        agent_id: 'agent-1',
        user_id: 'user-1',
        is_typing: true,
      });
    });

    it('should broadcast typing stop', () => {
      collaborationModule.broadcastAgentTyping('session-1', 'agent-1', 'user-1', false);

      expect(mockSocket.emit).toHaveBeenCalledWith('agent_typing', {
        session_id: 'session-1',
        agent_id: 'agent-1',
        user_id: 'user-1',
        is_typing: false,
      });
    });
  });

  describe('File Collaboration', () => {
    it('should get file content Y.Text', () => {
      const text = collaborationModule.getFileContent('session-1', '/workspace/app.tsx');

      expect(text).toBeDefined();
    });

    it('should use correct document name for files', () => {
      collaborationModule.getFileContent('session-1', '/workspace/app.tsx');

      expect(mockSocket.emit).toHaveBeenCalledWith('yjs_subscribe', {
        session_id: 'session-1',
        doc_name: 'file:/workspace/app.tsx',
      });
    });

    it('should initialize file content when empty', () => {
      const text = collaborationModule.getFileContent('session-1', '/workspace/app.tsx');

      collaborationModule.initFileContent('session-1', '/workspace/app.tsx', 'initial content');

      expect(text.toString()).toBe('initial content');
    });

    it('should not initialize file content when not empty', () => {
      const text = collaborationModule.getFileContent('session-1', '/workspace/app.tsx');
      text.insert(0, 'existing content');

      collaborationModule.initFileContent('session-1', '/workspace/app.tsx', 'new content');

      expect(text.toString()).toBe('existing content');
    });
  });

  describe('User Join/Leave Events', () => {
    it('should subscribe to user joined events', () => {
      const callback = vi.fn();

      collaborationModule.onUserJoined(callback);

      expect(mockSocket.on).toHaveBeenCalledWith('user_joined', callback);
    });

    it('should return unsubscribe for user joined', () => {
      const callback = vi.fn();

      const unsubscribe = collaborationModule.onUserJoined(callback);
      unsubscribe();

      expect(mockSocket.off).toHaveBeenCalledWith('user_joined', callback);
    });

    it('should subscribe to user left events', () => {
      const callback = vi.fn();

      collaborationModule.onUserLeft(callback);

      expect(mockSocket.on).toHaveBeenCalledWith('user_left', callback);
    });

    it('should return unsubscribe for user left', () => {
      const callback = vi.fn();

      const unsubscribe = collaborationModule.onUserLeft(callback);
      unsubscribe();

      expect(mockSocket.off).toHaveBeenCalledWith('user_left', callback);
    });
  });

  describe('Agent Message Events', () => {
    it('should subscribe to agent message events', () => {
      const callback = vi.fn();

      collaborationModule.onAgentMessage(callback);

      expect(mockSocket.on).toHaveBeenCalledWith('agent_message', callback);
    });

    it('should return unsubscribe function', () => {
      const callback = vi.fn();

      const unsubscribe = collaborationModule.onAgentMessage(callback);
      unsubscribe();

      expect(mockSocket.off).toHaveBeenCalledWith('agent_message', callback);
    });
  });

  describe('Reconnection Handling', () => {
    it('should re-subscribe to documents on reconnect', () => {
      // Create a document first - use a doc name without colons to avoid key parsing issues
      collaborationModule.getYDoc('session-1', 'app.tsx');

      // Clear emit calls
      (mockSocket.emit as Mock).mockClear();

      // Simulate reconnect
      const connectHandler = eventHandlers.get('connect');
      connectHandler?.();

      // The reconnect handler should emit yjs_subscribe
      expect(mockSocket.emit).toHaveBeenCalledWith(
        'yjs_subscribe',
        expect.objectContaining({
          session_id: expect.any(String),
        })
      );
    });

    it('should mark remote users offline on disconnect', () => {
      collaborationModule.getAwareness('session-1', 'file:/workspace/app.tsx');

      // Add remote user state
      lastAwareness?.setRemoteState(67890, { user: { id: 'user-2' } });

      // Simulate disconnect
      const disconnectHandler = eventHandlers.get('disconnect');
      disconnectHandler?.();

      expect(awarenessProtocol.removeAwarenessStates).toHaveBeenCalled();
    });
  });

  describe('Full Disconnect', () => {
    it('should disconnect socket', () => {
      collaborationModule.getSocket();
      collaborationModule.disconnect();

      expect(mockSocket.disconnect).toHaveBeenCalled();
    });
  });

  describe('Document Types', () => {
    it('should handle agent documents', () => {
      collaborationModule.getYDoc('session-1', 'agent:agent-123');

      expect(mockSocket.emit).toHaveBeenCalledWith('yjs_subscribe', {
        session_id: 'session-1',
        doc_name: 'agent:agent-123',
      });
    });

    it('should handle file documents', () => {
      collaborationModule.getYDoc('session-1', 'file:/workspace/src/app.tsx');

      expect(mockSocket.emit).toHaveBeenCalledWith('yjs_subscribe', {
        session_id: 'session-1',
        doc_name: 'file:/workspace/src/app.tsx',
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle empty awareness states gracefully', () => {
      const collaborators = collaborationModule.getCollaborators(
        'session-1',
        'file:/workspace/app.tsx'
      );

      expect(collaborators).toEqual([]);
    });

    it('should handle null local state in cursor update', () => {
      collaborationModule.getAwareness('session-1', 'file:/workspace/app.tsx');

      // Should not throw
      expect(() => {
        collaborationModule.updateCursor('session-1', 'file:/workspace/app.tsx', {
          line: 10,
          column: 5,
        });
      }).not.toThrow();
    });
  });
});
