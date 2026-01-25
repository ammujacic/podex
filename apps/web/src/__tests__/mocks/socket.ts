/* eslint-disable @typescript-eslint/no-unsafe-function-type */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { vi } from 'vitest';

export const socketHandlers: Record<string, Function> = {};

export const mockSocket = {
  emit: vi.fn(),
  on: vi.fn((event: string, handler: Function) => {
    socketHandlers[event] = handler;
    return mockSocket;
  }),
  off: vi.fn((event: string) => {
    delete socketHandlers[event];
    return mockSocket;
  }),
  connect: vi.fn(),
  disconnect: vi.fn(),
  connected: false,
  id: 'mock-socket-id',
};

export const triggerSocketEvent = (event: string, data: any) => {
  socketHandlers[event]?.(data);
};

export const clearSocketHandlers = () => {
  Object.keys(socketHandlers).forEach((key) => delete socketHandlers[key]);
};

export const resetMockSocket = () => {
  clearSocketHandlers();
  mockSocket.emit.mockClear();
  mockSocket.on.mockClear();
  mockSocket.off.mockClear();
  mockSocket.connect.mockClear();
  mockSocket.disconnect.mockClear();
  mockSocket.connected = false;
};
