/**
 * Comprehensive tests for Socket.IO client module
 */
import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import type { Socket } from 'socket.io-client';

// Event handler maps for capturing socket event listeners
let eventHandlers: Map<string, Function>;
let managerEventHandlers: Map<string, Function>;

// Mock socket.io-client before importing the module
const mockManagerOn = vi.fn();
const mockSocket = {
  emit: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  once: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  connected: false,
  id: 'mock-socket-id',
  io: {
    on: mockManagerOn,
  },
} as unknown as Socket;

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => mockSocket),
}));

describe('Socket Module', () => {
  // We need to dynamically import the module after mocking to capture handlers
  let socketModule: typeof import('../socket');
  let io: typeof import('socket.io-client').io;

  beforeEach(async () => {
    // Reset module cache to get fresh socket instance
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();

    eventHandlers = new Map();
    managerEventHandlers = new Map();

    // Reset mock socket state
    mockSocket.connected = false;

    // Capture event handlers
    (mockSocket.on as Mock).mockImplementation((event: string, handler: Function) => {
      eventHandlers.set(event, handler);
      return mockSocket;
    });

    (mockSocket.once as Mock).mockImplementation((event: string, handler: Function) => {
      eventHandlers.set(`once:${event}`, handler);
      return mockSocket;
    });

    (mockSocket.off as Mock).mockImplementation((event: string) => {
      eventHandlers.delete(event);
      return mockSocket;
    });

    mockManagerOn.mockImplementation((event: string, handler: Function) => {
      managerEventHandlers.set(event, handler);
      return mockSocket.io;
    });

    // Re-import the module fresh
    socketModule = await import('../socket');
    io = (await import('socket.io-client')).io;
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  describe('Socket Initialization', () => {
    it('should create socket with correct configuration', () => {
      socketModule.getSocket();

      expect(io).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          autoConnect: false,
          transports: ['websocket', 'polling'],
          reconnection: true,
          reconnectionDelay: 1000,
          reconnectionDelayMax: 30000,
          reconnectionAttempts: 10,
          randomizationFactor: 0.5,
          timeout: 20000,
        })
      );
    });

    it('should return same socket instance on multiple calls', () => {
      const socket1 = socketModule.getSocket();
      const socket2 = socketModule.getSocket();

      expect(socket1).toBe(socket2);
    });

    it('should set up connect event handler', () => {
      socketModule.getSocket();

      expect(mockSocket.on).toHaveBeenCalledWith('connect', expect.any(Function));
    });

    it('should set up disconnect event handler', () => {
      socketModule.getSocket();

      expect(mockSocket.on).toHaveBeenCalledWith('disconnect', expect.any(Function));
    });

    it('should set up connect_error event handler', () => {
      socketModule.getSocket();

      expect(mockSocket.on).toHaveBeenCalledWith('connect_error', expect.any(Function));
    });

    it('should set up manager reconnect events', () => {
      socketModule.getSocket();

      expect(mockManagerOn).toHaveBeenCalledWith('reconnect_attempt', expect.any(Function));
      expect(mockManagerOn).toHaveBeenCalledWith('reconnect', expect.any(Function));
      expect(mockManagerOn).toHaveBeenCalledWith('reconnect_failed', expect.any(Function));
    });
  });

  describe('Connection State Management', () => {
    it('should return initial connection state', () => {
      const state = socketModule.getConnectionState();

      expect(state).toEqual({
        connected: false,
        reconnecting: false,
        reconnectAttempt: 0,
        error: null,
      });
    });

    it('should update state on connect', () => {
      socketModule.getSocket();

      // Trigger connect event
      const connectHandler = eventHandlers.get('connect');
      connectHandler?.();

      const state = socketModule.getConnectionState();
      expect(state.connected).toBe(true);
      expect(state.error).toBeNull();
      expect(state.reconnecting).toBe(false);
    });

    it('should update state on disconnect', () => {
      socketModule.getSocket();

      // First connect
      const connectHandler = eventHandlers.get('connect');
      connectHandler?.();

      // Then disconnect
      const disconnectHandler = eventHandlers.get('disconnect');
      disconnectHandler?.('io server disconnect');

      const state = socketModule.getConnectionState();
      expect(state.connected).toBe(false);
      expect(state.disconnectReason).toBe('io server disconnect');
    });

    it('should update state on connect_error', () => {
      socketModule.getSocket();

      const errorHandler = eventHandlers.get('connect_error');
      errorHandler?.(new Error('Connection refused'));

      const state = socketModule.getConnectionState();
      expect(state.connected).toBe(false);
      expect(state.error).toBe('Connection refused');
    });

    it('should update state on reconnect_attempt', () => {
      socketModule.getSocket();

      const reconnectAttemptHandler = managerEventHandlers.get('reconnect_attempt');
      reconnectAttemptHandler?.(3);

      const state = socketModule.getConnectionState();
      expect(state.reconnecting).toBe(true);
      expect(state.reconnectAttempt).toBe(3);
    });

    it('should update state on successful reconnect', () => {
      socketModule.getSocket();

      // Set reconnecting state first
      const reconnectAttemptHandler = managerEventHandlers.get('reconnect_attempt');
      reconnectAttemptHandler?.(2);

      // Then reconnect succeeds
      const reconnectHandler = managerEventHandlers.get('reconnect');
      reconnectHandler?.();

      const state = socketModule.getConnectionState();
      expect(state.reconnecting).toBe(false);
      expect(state.reconnectAttempt).toBe(0);
      expect(state.error).toBeNull();
    });

    it('should update state on reconnect_failed', () => {
      socketModule.getSocket();

      const reconnectFailedHandler = managerEventHandlers.get('reconnect_failed');
      reconnectFailedHandler?.();

      const state = socketModule.getConnectionState();
      expect(state.reconnecting).toBe(false);
      expect(state.error).toBe(
        'Reconnection failed after maximum attempts. Please refresh the page.'
      );
    });
  });

  describe('Connection State Listeners', () => {
    it('should notify listeners on state change', () => {
      const listener = vi.fn();
      socketModule.onConnectionStateChange(listener);

      // Listener should be called immediately with current state
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          connected: false,
        })
      );

      // Initialize socket and trigger connect
      socketModule.getSocket();
      const connectHandler = eventHandlers.get('connect');
      connectHandler?.();

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          connected: true,
        })
      );
    });

    it('should allow unsubscribing from state changes', () => {
      const listener = vi.fn();
      const unsubscribe = socketModule.onConnectionStateChange(listener);

      listener.mockClear();
      unsubscribe();

      // Trigger a state change
      socketModule.getSocket();
      const connectHandler = eventHandlers.get('connect');
      connectHandler?.();

      // Listener should not be called after unsubscribe
      expect(listener).not.toHaveBeenCalled();
    });

    it('should support multiple listeners', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      socketModule.onConnectionStateChange(listener1);
      socketModule.onConnectionStateChange(listener2);

      socketModule.getSocket();
      const connectHandler = eventHandlers.get('connect');
      connectHandler?.();

      expect(listener1).toHaveBeenCalled();
      expect(listener2).toHaveBeenCalled();
    });

    it('should return a copy of state to prevent mutation', () => {
      const state1 = socketModule.getConnectionState();
      const state2 = socketModule.getConnectionState();

      expect(state1).not.toBe(state2);
      expect(state1).toEqual(state2);
    });
  });

  describe('Connect/Disconnect Operations', () => {
    it('should connect socket when not connected', () => {
      mockSocket.connected = false;

      socketModule.connectSocket();

      expect(mockSocket.connect).toHaveBeenCalled();
    });

    it('should not connect if already connected', () => {
      mockSocket.connected = true;

      socketModule.connectSocket();

      expect(mockSocket.connect).not.toHaveBeenCalled();
    });

    it('should disconnect socket when connected', () => {
      // First get a socket instance so disconnectSocket has something to disconnect
      socketModule.getSocket();
      // Simulate that the socket is connected
      mockSocket.connected = true;

      socketModule.disconnectSocket();

      expect(mockSocket.disconnect).toHaveBeenCalled();
    });

    it('should not disconnect if not connected', () => {
      mockSocket.connected = false;

      socketModule.disconnectSocket();

      expect(mockSocket.disconnect).not.toHaveBeenCalled();
    });
  });

  describe('Manual Reconnection', () => {
    it('should reset state and reconnect', () => {
      socketModule.getSocket();

      socketModule.reconnectSocket();

      expect(mockSocket.disconnect).toHaveBeenCalled();
      expect(mockSocket.connect).toHaveBeenCalled();

      const state = socketModule.getConnectionState();
      expect(state.error).toBeNull();
      expect(state.reconnecting).toBe(true);
      expect(state.reconnectAttempt).toBe(1);
    });
  });

  describe('Session Management', () => {
    it('should join session when socket is connected', () => {
      mockSocket.connected = true;
      socketModule.getSocket();

      socketModule.joinSession('session-123', 'user-456');

      expect(mockSocket.emit).toHaveBeenCalledWith('session_join', {
        session_id: 'session-123',
        user_id: 'user-456',
      });
    });

    it('should join session with auth token when provided', () => {
      mockSocket.connected = true;
      socketModule.getSocket();

      socketModule.joinSession('session-123', 'user-456', 'auth-token-789');

      expect(mockSocket.emit).toHaveBeenCalledWith('session_join', {
        session_id: 'session-123',
        user_id: 'user-456',
        auth_token: 'auth-token-789',
      });
    });

    it('should wait for connection before joining session', () => {
      mockSocket.connected = false;
      socketModule.getSocket();

      socketModule.joinSession('session-123', 'user-456');

      // Should register once handler, not emit immediately
      expect(mockSocket.once).toHaveBeenCalledWith('connect', expect.any(Function));
      expect(mockSocket.emit).not.toHaveBeenCalledWith('session_join', expect.any(Object));
    });

    it('should emit join after connection established', () => {
      mockSocket.connected = false;
      socketModule.getSocket();

      socketModule.joinSession('session-123', 'user-456');

      // Trigger the once connect handler
      const onceConnectHandler = eventHandlers.get('once:connect');
      onceConnectHandler?.();

      expect(mockSocket.emit).toHaveBeenCalledWith('session_join', {
        session_id: 'session-123',
        user_id: 'user-456',
      });
    });

    it('should leave session and clear active session', () => {
      mockSocket.connected = true;
      socketModule.getSocket();

      // First join
      socketModule.joinSession('session-123', 'user-456');

      // Then leave
      socketModule.leaveSession('session-123', 'user-456');

      expect(mockSocket.emit).toHaveBeenCalledWith('session_leave', {
        session_id: 'session-123',
        user_id: 'user-456',
      });
    });

    it('should auto-rejoin session after reconnection', () => {
      mockSocket.connected = true;
      socketModule.getSocket();

      // Join session
      socketModule.joinSession('session-123', 'user-456', 'token-abc');

      // Clear previous emit calls
      (mockSocket.emit as Mock).mockClear();

      // Simulate reconnection
      const reconnectHandler = managerEventHandlers.get('reconnect');
      reconnectHandler?.();

      expect(mockSocket.emit).toHaveBeenCalledWith('session_join', {
        session_id: 'session-123',
        user_id: 'user-456',
        auth_token: 'token-abc',
      });
    });

    it('should not auto-rejoin after leaving session', () => {
      mockSocket.connected = true;
      socketModule.getSocket();

      // Join then leave
      socketModule.joinSession('session-123', 'user-456');
      socketModule.leaveSession('session-123', 'user-456');

      // Clear previous emit calls
      (mockSocket.emit as Mock).mockClear();

      // Simulate reconnection
      const reconnectHandler = managerEventHandlers.get('reconnect');
      reconnectHandler?.();

      expect(mockSocket.emit).not.toHaveBeenCalledWith('session_join', expect.any(Object));
    });
  });

  describe('Event Subscription', () => {
    it('should subscribe to socket events', () => {
      socketModule.getSocket();

      const handler = vi.fn();
      socketModule.onSocketEvent('agent_message', handler);

      expect(mockSocket.on).toHaveBeenCalledWith('agent_message', handler);
    });

    it('should return unsubscribe function', () => {
      socketModule.getSocket();

      const handler = vi.fn();
      const unsubscribe = socketModule.onSocketEvent('agent_status', handler);

      unsubscribe();

      expect(mockSocket.off).toHaveBeenCalledWith('agent_status', handler);
    });

    it('should handle agent_message events', () => {
      socketModule.getSocket();

      const handler = vi.fn();
      socketModule.onSocketEvent('agent_message', handler);

      const event: socketModule.AgentMessageEvent = {
        id: 'msg-1',
        agent_id: 'agent-1',
        agent_name: 'Test Agent',
        role: 'assistant',
        content: 'Hello, world!',
        session_id: 'session-1',
        created_at: new Date().toISOString(),
      };

      // Simulate event
      const registeredHandler = eventHandlers.get('agent_message');
      registeredHandler?.(event);

      expect(handler).toHaveBeenCalledWith(event);
    });

    it('should handle agent_status events', () => {
      socketModule.getSocket();

      const handler = vi.fn();
      socketModule.onSocketEvent('agent_status', handler);

      const event: socketModule.AgentStatusEvent = {
        agent_id: 'agent-1',
        status: 'active',
        session_id: 'session-1',
      };

      const registeredHandler = eventHandlers.get('agent_status');
      registeredHandler?.(event);

      expect(handler).toHaveBeenCalledWith(event);
    });

    it('should handle file_change events', () => {
      socketModule.getSocket();

      const handler = vi.fn();
      socketModule.onSocketEvent('file_change', handler);

      const event: socketModule.FileChangeEvent = {
        session_id: 'session-1',
        file_path: '/src/app.tsx',
        change_type: 'modified',
        changed_by: 'user-1',
      };

      const registeredHandler = eventHandlers.get('file_change');
      registeredHandler?.(event);

      expect(handler).toHaveBeenCalledWith(event);
    });

    it('should handle terminal_data events', () => {
      socketModule.getSocket();

      const handler = vi.fn();
      socketModule.onSocketEvent('terminal_data', handler);

      const event = {
        workspace_id: 'workspace-1',
        data: 'npm install',
      };

      const registeredHandler = eventHandlers.get('terminal_data');
      registeredHandler?.(event);

      expect(handler).toHaveBeenCalledWith(event);
    });

    it('should handle voice_transcription events', () => {
      socketModule.getSocket();

      const handler = vi.fn();
      socketModule.onSocketEvent('voice_transcription', handler);

      const event = {
        session_id: 'session-1',
        agent_id: 'agent-1',
        text: 'Hello',
        confidence: 0.95,
        is_final: true,
      };

      const registeredHandler = eventHandlers.get('voice_transcription');
      registeredHandler?.(event);

      expect(handler).toHaveBeenCalledWith(event);
    });

    it('should handle agent_attention events', () => {
      socketModule.getSocket();

      const handler = vi.fn();
      socketModule.onSocketEvent('agent_attention', handler);

      const event: socketModule.AgentAttentionEvent = {
        id: 'att-1',
        session_id: 'session-1',
        agent_id: 'agent-1',
        agent_name: 'Test Agent',
        type: 'needs_approval',
        title: 'Approval Required',
        message: 'Please approve',
        priority: 'high',
        metadata: {},
        read: false,
        dismissed: false,
        created_at: new Date().toISOString(),
      };

      const registeredHandler = eventHandlers.get('agent_attention');
      registeredHandler?.(event);

      expect(handler).toHaveBeenCalledWith(event);
    });

    it('should handle streaming events', () => {
      socketModule.getSocket();

      const startHandler = vi.fn();
      const tokenHandler = vi.fn();
      const endHandler = vi.fn();

      socketModule.onSocketEvent('agent_stream_start', startHandler);
      socketModule.onSocketEvent('agent_token', tokenHandler);
      socketModule.onSocketEvent('agent_stream_end', endHandler);

      expect(mockSocket.on).toHaveBeenCalledWith('agent_stream_start', startHandler);
      expect(mockSocket.on).toHaveBeenCalledWith('agent_token', tokenHandler);
      expect(mockSocket.on).toHaveBeenCalledWith('agent_stream_end', endHandler);
    });

    it('should handle checkpoint events', () => {
      socketModule.getSocket();

      const handler = vi.fn();
      socketModule.onSocketEvent('checkpoint_created', handler);

      const event = {
        session_id: 'session-1',
        checkpoint: {
          id: 'cp-1',
          checkpoint_number: 1,
          description: 'Initial checkpoint',
          action_type: 'manual',
          agent_id: 'agent-1',
          status: 'completed',
          created_at: new Date().toISOString(),
          files: [],
          file_count: 0,
          total_lines_added: 0,
          total_lines_removed: 0,
        },
      };

      const registeredHandler = eventHandlers.get('checkpoint_created');
      registeredHandler?.(event);

      expect(handler).toHaveBeenCalledWith(event);
    });
  });

  describe('Cursor and File Change Emission', () => {
    it('should emit cursor update', () => {
      socketModule.getSocket();

      socketModule.emitCursorUpdate({
        session_id: 'session-1',
        user_id: 'user-1',
        file_path: '/src/app.tsx',
        position: { line: 10, column: 5 },
      });

      expect(mockSocket.emit).toHaveBeenCalledWith('cursor_update', {
        session_id: 'session-1',
        user_id: 'user-1',
        file_path: '/src/app.tsx',
        position: { line: 10, column: 5 },
      });
    });

    it('should emit file change', () => {
      socketModule.getSocket();

      socketModule.emitFileChange({
        session_id: 'session-1',
        file_path: '/src/app.tsx',
        change_type: 'modified',
        changed_by: 'user-1',
      });

      expect(mockSocket.emit).toHaveBeenCalledWith('file_change', {
        session_id: 'session-1',
        file_path: '/src/app.tsx',
        change_type: 'modified',
        changed_by: 'user-1',
      });
    });
  });

  describe('Terminal Operations', () => {
    it('should attach terminal', () => {
      socketModule.getSocket();

      socketModule.attachTerminal('workspace-1');

      expect(mockSocket.emit).toHaveBeenCalledWith('terminal_attach', {
        workspace_id: 'workspace-1',
      });
    });

    it('should detach terminal', () => {
      socketModule.getSocket();

      socketModule.detachTerminal('workspace-1');

      expect(mockSocket.emit).toHaveBeenCalledWith('terminal_detach', {
        workspace_id: 'workspace-1',
      });
    });

    it('should send terminal input', () => {
      socketModule.getSocket();

      socketModule.sendTerminalInput('workspace-1', 'ls -la\n');

      expect(mockSocket.emit).toHaveBeenCalledWith('terminal_input', {
        workspace_id: 'workspace-1',
        data: 'ls -la\n',
      });
    });

    it('should resize terminal', () => {
      socketModule.getSocket();

      socketModule.resizeTerminal('workspace-1', 24, 80);

      expect(mockSocket.emit).toHaveBeenCalledWith('terminal_resize', {
        workspace_id: 'workspace-1',
        rows: 24,
        cols: 80,
      });
    });
  });

  describe('Layout Change Emission with Debouncing', () => {
    it('should emit layout change after debounce period', () => {
      socketModule.getSocket();

      socketModule.emitLayoutChange({
        session_id: 'session-1',
        user_id: 'user-1',
        device_id: 'device-1',
        type: 'view_mode',
        payload: { mode: 'split' },
      });

      // Should not emit immediately
      expect(mockSocket.emit).not.toHaveBeenCalledWith('layout:change', expect.any(Object));

      // Fast forward past debounce period
      vi.advanceTimersByTime(150);

      expect(mockSocket.emit).toHaveBeenCalledWith(
        'layout:change',
        expect.objectContaining({
          session_id: 'session-1',
          sender_id: 'user-1',
          sender_device: 'device-1',
          type: 'view_mode',
          payload: { mode: 'split' },
          timestamp: expect.any(String),
        })
      );
    });

    it('should debounce rapid layout changes', () => {
      socketModule.getSocket();

      // Emit multiple changes rapidly
      socketModule.emitLayoutChange({
        session_id: 'session-1',
        user_id: 'user-1',
        device_id: 'device-1',
        type: 'view_mode',
        payload: { mode: 'split' },
      });

      vi.advanceTimersByTime(50);

      socketModule.emitLayoutChange({
        session_id: 'session-1',
        user_id: 'user-1',
        device_id: 'device-1',
        type: 'view_mode',
        payload: { mode: 'full' },
      });

      vi.advanceTimersByTime(50);

      socketModule.emitLayoutChange({
        session_id: 'session-1',
        user_id: 'user-1',
        device_id: 'device-1',
        type: 'view_mode',
        payload: { mode: 'compact' },
      });

      // Fast forward past debounce
      vi.advanceTimersByTime(150);

      // Should only emit once with the last value
      const layoutCalls = (mockSocket.emit as Mock).mock.calls.filter(
        (call) => call[0] === 'layout:change'
      );
      expect(layoutCalls.length).toBe(1);
      expect(layoutCalls[0][1].payload).toEqual({ mode: 'compact' });
    });
  });

  describe('Attention Operations', () => {
    it('should emit attention read', () => {
      socketModule.getSocket();

      socketModule.emitAttentionRead('session-1', 'attention-1');

      expect(mockSocket.emit).toHaveBeenCalledWith('agent_attention_read', {
        session_id: 'session-1',
        attention_id: 'attention-1',
      });
    });

    it('should emit attention dismiss without agent', () => {
      socketModule.getSocket();

      socketModule.emitAttentionDismiss('session-1', 'attention-1');

      expect(mockSocket.emit).toHaveBeenCalledWith('agent_attention_dismiss', {
        session_id: 'session-1',
        attention_id: 'attention-1',
        agent_id: null,
      });
    });

    it('should emit attention dismiss with agent', () => {
      socketModule.getSocket();

      socketModule.emitAttentionDismiss('session-1', 'attention-1', 'agent-1');

      expect(mockSocket.emit).toHaveBeenCalledWith('agent_attention_dismiss', {
        session_id: 'session-1',
        attention_id: 'attention-1',
        agent_id: 'agent-1',
      });
    });
  });

  describe('Approval Operations', () => {
    it('should emit approval response', () => {
      socketModule.getSocket();

      socketModule.emitApprovalResponse('session-1', 'agent-1', 'approval-1', true, false);

      expect(mockSocket.emit).toHaveBeenCalledWith('approval_response', {
        session_id: 'session-1',
        agent_id: 'agent-1',
        approval_id: 'approval-1',
        approved: true,
        added_to_allowlist: false,
      });
    });

    it('should emit approval response with allowlist', () => {
      socketModule.getSocket();

      socketModule.emitApprovalResponse('session-1', 'agent-1', 'approval-1', true, true);

      expect(mockSocket.emit).toHaveBeenCalledWith('approval_response', {
        session_id: 'session-1',
        agent_id: 'agent-1',
        approval_id: 'approval-1',
        approved: true,
        added_to_allowlist: true,
      });
    });

    it('should emit native approval response', () => {
      socketModule.getSocket();

      socketModule.emitNativeApprovalResponse('session-1', 'agent-1', 'approval-1', false, false);

      expect(mockSocket.emit).toHaveBeenCalledWith('native_approval_response', {
        session_id: 'session-1',
        agent_id: 'agent-1',
        approval_id: 'approval-1',
        approved: false,
        add_to_allowlist: false,
      });
    });

    it('should emit permission response', () => {
      socketModule.getSocket();

      socketModule.emitPermissionResponse(
        'session-1',
        'agent-1',
        'request-1',
        true,
        'npm install',
        'Bash',
        true
      );

      expect(mockSocket.emit).toHaveBeenCalledWith('permission_response', {
        session_id: 'session-1',
        agent_id: 'agent-1',
        request_id: 'request-1',
        approved: true,
        command: 'npm install',
        tool_name: 'Bash',
        add_to_allowlist: true,
      });
    });
  });

  describe('Extension Operations', () => {
    it('should subscribe to extensions', () => {
      socketModule.getSocket();

      socketModule.subscribeToExtensions('auth-token-123');

      expect(mockSocket.emit).toHaveBeenCalledWith('extension_subscribe', {
        auth_token: 'auth-token-123',
      });
    });

    it('should unsubscribe from extensions', () => {
      socketModule.getSocket();

      socketModule.unsubscribeFromExtensions();

      expect(mockSocket.emit).toHaveBeenCalledWith('extension_unsubscribe', {});
    });
  });

  describe('Error Handling', () => {
    it('should handle connection errors gracefully', () => {
      socketModule.getSocket();

      const errorHandler = eventHandlers.get('connect_error');
      errorHandler?.(new Error('ECONNREFUSED'));

      const state = socketModule.getConnectionState();
      expect(state.error).toBe('ECONNREFUSED');
      expect(state.connected).toBe(false);
    });

    it('should handle disconnect reasons', () => {
      socketModule.getSocket();

      // First connect
      const connectHandler = eventHandlers.get('connect');
      connectHandler?.();

      // Then disconnect with reason
      const disconnectHandler = eventHandlers.get('disconnect');
      disconnectHandler?.('transport close');

      const state = socketModule.getConnectionState();
      expect(state.disconnectReason).toBe('transport close');
    });

    it('should handle reconnection failure', () => {
      socketModule.getSocket();

      const reconnectFailedHandler = managerEventHandlers.get('reconnect_failed');
      reconnectFailedHandler?.();

      const state = socketModule.getConnectionState();
      expect(state.error).toContain('Reconnection failed');
      expect(state.reconnecting).toBe(false);
    });
  });

  describe('Event Types', () => {
    it('should handle workspace_status events', () => {
      socketModule.getSocket();

      const handler = vi.fn();
      socketModule.onSocketEvent('workspace_status', handler);

      const event = {
        workspace_id: 'workspace-1',
        status: 'running' as const,
      };

      const registeredHandler = eventHandlers.get('workspace_status');
      registeredHandler?.(event);

      expect(handler).toHaveBeenCalledWith(event);
    });

    it('should handle skill events', () => {
      socketModule.getSocket();

      const startHandler = vi.fn();
      const stepHandler = vi.fn();
      const completeHandler = vi.fn();

      socketModule.onSocketEvent('skill_start', startHandler);
      socketModule.onSocketEvent('skill_step', stepHandler);
      socketModule.onSocketEvent('skill_complete', completeHandler);

      expect(mockSocket.on).toHaveBeenCalledWith('skill_start', startHandler);
      expect(mockSocket.on).toHaveBeenCalledWith('skill_step', stepHandler);
      expect(mockSocket.on).toHaveBeenCalledWith('skill_complete', completeHandler);
    });

    it('should handle pending change events', () => {
      socketModule.getSocket();

      const proposedHandler = vi.fn();
      const resolvedHandler = vi.fn();

      socketModule.onSocketEvent('pending_change_proposed', proposedHandler);
      socketModule.onSocketEvent('pending_change_resolved', resolvedHandler);

      expect(mockSocket.on).toHaveBeenCalledWith('pending_change_proposed', proposedHandler);
      expect(mockSocket.on).toHaveBeenCalledWith('pending_change_resolved', resolvedHandler);
    });

    it('should handle tool call events', () => {
      socketModule.getSocket();

      const startHandler = vi.fn();
      const endHandler = vi.fn();

      socketModule.onSocketEvent('tool_call_start', startHandler);
      socketModule.onSocketEvent('tool_call_end', endHandler);

      const startEvent = {
        session_id: 'session-1',
        agent_id: 'agent-1',
        tool_call_id: 'tc-1',
        tool_name: 'Bash',
        status: 'running' as const,
        timestamp: new Date().toISOString(),
      };

      const registeredStartHandler = eventHandlers.get('tool_call_start');
      registeredStartHandler?.(startEvent);

      expect(startHandler).toHaveBeenCalledWith(startEvent);
    });

    it('should handle context window events', () => {
      socketModule.getSocket();

      const usageHandler = vi.fn();
      const compactionStartHandler = vi.fn();
      const compactionCompleteHandler = vi.fn();

      socketModule.onSocketEvent('context_usage_update', usageHandler);
      socketModule.onSocketEvent('compaction_started', compactionStartHandler);
      socketModule.onSocketEvent('compaction_completed', compactionCompleteHandler);

      expect(mockSocket.on).toHaveBeenCalledWith('context_usage_update', usageHandler);
      expect(mockSocket.on).toHaveBeenCalledWith('compaction_started', compactionStartHandler);
      expect(mockSocket.on).toHaveBeenCalledWith('compaction_completed', compactionCompleteHandler);
    });

    it('should handle worktree events', () => {
      socketModule.getSocket();

      const createdHandler = vi.fn();
      const statusHandler = vi.fn();
      const conflictHandler = vi.fn();
      const mergedHandler = vi.fn();
      const deletedHandler = vi.fn();

      socketModule.onSocketEvent('worktree_created', createdHandler);
      socketModule.onSocketEvent('worktree_status_changed', statusHandler);
      socketModule.onSocketEvent('worktree_conflict_detected', conflictHandler);
      socketModule.onSocketEvent('worktree_merged', mergedHandler);
      socketModule.onSocketEvent('worktree_deleted', deletedHandler);

      expect(mockSocket.on).toHaveBeenCalledWith('worktree_created', createdHandler);
      expect(mockSocket.on).toHaveBeenCalledWith('worktree_status_changed', statusHandler);
      expect(mockSocket.on).toHaveBeenCalledWith('worktree_conflict_detected', conflictHandler);
      expect(mockSocket.on).toHaveBeenCalledWith('worktree_merged', mergedHandler);
      expect(mockSocket.on).toHaveBeenCalledWith('worktree_deleted', deletedHandler);
    });

    it('should handle extension sync events', () => {
      socketModule.getSocket();

      const installedHandler = vi.fn();
      const uninstalledHandler = vi.fn();
      const toggledHandler = vi.fn();
      const settingsHandler = vi.fn();

      socketModule.onSocketEvent('extension_installed', installedHandler);
      socketModule.onSocketEvent('extension_uninstalled', uninstalledHandler);
      socketModule.onSocketEvent('extension_toggled', toggledHandler);
      socketModule.onSocketEvent('extension_settings_changed', settingsHandler);

      expect(mockSocket.on).toHaveBeenCalledWith('extension_installed', installedHandler);
      expect(mockSocket.on).toHaveBeenCalledWith('extension_uninstalled', uninstalledHandler);
      expect(mockSocket.on).toHaveBeenCalledWith('extension_toggled', toggledHandler);
      expect(mockSocket.on).toHaveBeenCalledWith('extension_settings_changed', settingsHandler);
    });
  });
});
