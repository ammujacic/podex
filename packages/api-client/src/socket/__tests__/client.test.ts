import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SocketClient } from '../client';
import type { Socket } from 'socket.io-client';

vi.mock('socket.io-client', () => {
  const on = vi.fn();
  const off = vi.fn();
  const emit = vi.fn();
  const once = vi.fn();
  const connect = vi.fn();
  const disconnect = vi.fn();
  const io = {
    on: vi.fn(),
    off: vi.fn(),
  };

  const socket: Partial<Socket> & {
    io: typeof io;
  } = {
    connected: false,
    on,
    off,
    emit,
    once,
    connect,
    disconnect,
    io,
  };

  return {
    io: vi.fn(() => socket),
  };
});

describe('SocketClient', () => {
  let client: SocketClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new SocketClient({
      url: 'https://socket.example.com',
      autoConnect: false,
    });
  });

  it('creates socket lazily and reuses instance', () => {
    const first = client.getSocket();
    const second = client.getSocket();
    expect(first).toBe(second);
  });

  it('tracks connection state changes and notifies listeners', () => {
    const listener = vi.fn();
    const unsubscribe = client.onConnectionStateChange(listener);

    // Initial state notification
    expect(listener).toHaveBeenCalledTimes(1);

    // Simulate connect event
    const socket = client.getSocket() as any;
    const connectHandler = (socket.on as vi.Mock).mock.calls.find(
      (args) => args[0] === 'connect'
    )?.[1] as () => void;

    expect(connectHandler).toBeTypeOf('function');
    connectHandler();

    expect(listener).toHaveBeenCalledTimes(2);
    expect(client.isConnected()).toBe(true);

    unsubscribe();
  });

  it('joins and leaves sessions', () => {
    const socket = client.getSocket() as any;
    // Simulate an already-connected socket so joinSession emits immediately
    socket.connected = true;

    client.joinSession('session-1', 'user-1', 'token');
    expect(socket.emit).toHaveBeenCalledWith(
      'session_join',
      expect.objectContaining({
        session_id: 'session-1',
        user_id: 'user-1',
        auth_token: 'token',
      })
    );

    client.leaveSession('session-1', 'user-1');
    expect(socket.emit).toHaveBeenCalledWith('session_leave', {
      session_id: 'session-1',
      user_id: 'user-1',
    });
  });

  it('subscribes and unsubscribes to events via on/off helpers', () => {
    const socket = client.getSocket() as any;
    const handler = vi.fn();

    const unsubscribe = client.on('session_updated', handler as any);
    expect(socket.on).toHaveBeenCalledWith('session_updated', handler);

    unsubscribe();
    expect(socket.off).toHaveBeenCalledWith('session_updated', handler);
  });
});
