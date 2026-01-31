/**
 * Tests for RunMode component.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { RunMode } from '../RunMode';

// Mock ink
vi.mock('ink', async () => {
  const actual = await vi.importActual('ink');
  return {
    ...actual,
    useApp: () => ({ exit: vi.fn() }),
    useInput: vi.fn(),
  };
});

// Mock hooks
vi.mock('../../hooks/useSession', () => ({
  useSession: vi.fn(() => ({
    session: null,
    agents: [],
    messages: [],
    currentAgentId: null,
    isLoading: true,
    error: null,
    sendMessage: vi.fn(),
  })),
}));

vi.mock('../../hooks/useSocket', () => ({
  useSocket: vi.fn(() => ({
    isConnected: false,
    streamingContent: '',
    pendingApproval: null,
    respondToApproval: vi.fn(),
  })),
}));

vi.mock('../../adapters/auth-provider', () => ({
  getCliAuthProvider: () => ({
    getCredentials: vi.fn(() => ({
      userId: 'user-123',
      email: 'test@example.com',
    })),
  }),
}));

// Import hooks after mocking
import { useSession } from '../../hooks/useSession';
import { useSocket } from '../../hooks/useSocket';

describe('RunMode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should show loading when session is loading', () => {
    vi.mocked(useSession).mockReturnValue({
      session: null,
      agents: [],
      messages: [],
      currentAgentId: null,
      isLoading: true,
      error: null,
      sendMessage: vi.fn(),
      createSession: vi.fn(),
      loadSession: vi.fn(),
      selectAgent: vi.fn(),
      refreshMessages: vi.fn(),
    });

    const { lastFrame } = render(<RunMode task="Build the project" />);

    expect(lastFrame()).toContain('Loading session');
  });

  it('should show error when session has error', () => {
    vi.mocked(useSession).mockReturnValue({
      session: null,
      agents: [],
      messages: [],
      currentAgentId: null,
      isLoading: false,
      error: 'Failed to create session',
      sendMessage: vi.fn(),
      createSession: vi.fn(),
      loadSession: vi.fn(),
      selectAgent: vi.fn(),
      refreshMessages: vi.fn(),
    });

    const { lastFrame } = render(<RunMode task="Build the project" />);

    expect(lastFrame()).toContain('Failed to create session');
    expect(lastFrame()).toContain('Ctrl+C');
  });

  it('should show creating session when no session', () => {
    vi.mocked(useSession).mockReturnValue({
      session: null,
      agents: [],
      messages: [],
      currentAgentId: null,
      isLoading: false,
      error: null,
      sendMessage: vi.fn(),
      createSession: vi.fn(),
      loadSession: vi.fn(),
      selectAgent: vi.fn(),
      refreshMessages: vi.fn(),
    });

    const { lastFrame } = render(<RunMode task="Build the project" />);

    expect(lastFrame()).toContain('Creating session');
  });

  it('should show connecting when session exists but not connected', () => {
    vi.mocked(useSession).mockReturnValue({
      session: { id: 'sess-123', name: 'Test Session' } as any,
      agents: [{ id: 'agent-1', name: 'Agent 1', status: 'idle' }] as any,
      messages: [],
      currentAgentId: 'agent-1',
      isLoading: false,
      error: null,
      sendMessage: vi.fn(),
      createSession: vi.fn(),
      loadSession: vi.fn(),
      selectAgent: vi.fn(),
      refreshMessages: vi.fn(),
    });

    vi.mocked(useSocket).mockReturnValue({
      isConnected: false,
      connectionState: null,
      streamingContent: '',
      pendingApproval: null,
      connect: vi.fn(),
      disconnect: vi.fn(),
      respondToApproval: vi.fn(),
    });

    const { lastFrame } = render(<RunMode task="Build the project" />);

    expect(lastFrame()).toContain('Connecting');
  });

  it('should display task header', () => {
    vi.mocked(useSession).mockReturnValue({
      session: { id: 'sess-123', name: 'Test Session' } as any,
      agents: [{ id: 'agent-1', name: 'Agent 1', status: 'idle' }] as any,
      messages: [],
      currentAgentId: 'agent-1',
      isLoading: false,
      error: null,
      sendMessage: vi.fn(),
      createSession: vi.fn(),
      loadSession: vi.fn(),
      selectAgent: vi.fn(),
      refreshMessages: vi.fn(),
    });

    vi.mocked(useSocket).mockReturnValue({
      isConnected: true,
      connectionState: null,
      streamingContent: '',
      pendingApproval: null,
      connect: vi.fn(),
      disconnect: vi.fn(),
      respondToApproval: vi.fn(),
    });

    const { lastFrame } = render(<RunMode task="Build the project" />);

    expect(lastFrame()).toContain('Task:');
    expect(lastFrame()).toContain('Build the project');
  });

  it('should display agent status', () => {
    vi.mocked(useSession).mockReturnValue({
      session: { id: 'sess-123', name: 'Test Session' } as any,
      agents: [{ id: 'agent-1', name: 'Test Agent', status: 'thinking' }] as any,
      messages: [],
      currentAgentId: 'agent-1',
      isLoading: false,
      error: null,
      sendMessage: vi.fn(),
      createSession: vi.fn(),
      loadSession: vi.fn(),
      selectAgent: vi.fn(),
      refreshMessages: vi.fn(),
    });

    vi.mocked(useSocket).mockReturnValue({
      isConnected: true,
      connectionState: null,
      streamingContent: '',
      pendingApproval: null,
      connect: vi.fn(),
      disconnect: vi.fn(),
      respondToApproval: vi.fn(),
    });

    const { lastFrame } = render(<RunMode task="Build the project" />);

    expect(lastFrame()).toContain('Test Agent');
    expect(lastFrame()).toContain('thinking');
  });

  it('should show streaming content', () => {
    vi.mocked(useSession).mockReturnValue({
      session: { id: 'sess-123', name: 'Test Session' } as any,
      agents: [{ id: 'agent-1', name: 'Agent 1', status: 'executing' }] as any,
      messages: [],
      currentAgentId: 'agent-1',
      isLoading: false,
      error: null,
      sendMessage: vi.fn(),
      createSession: vi.fn(),
      loadSession: vi.fn(),
      selectAgent: vi.fn(),
      refreshMessages: vi.fn(),
    });

    vi.mocked(useSocket).mockReturnValue({
      isConnected: true,
      connectionState: null,
      streamingContent: 'Building project files...',
      pendingApproval: null,
      connect: vi.fn(),
      disconnect: vi.fn(),
      respondToApproval: vi.fn(),
    });

    const { lastFrame } = render(<RunMode task="Build the project" />);

    expect(lastFrame()).toContain('Building project files');
  });

  it('should show approval prompt when pending', () => {
    vi.mocked(useSession).mockReturnValue({
      session: { id: 'sess-123', name: 'Test Session' } as any,
      agents: [{ id: 'agent-1', name: 'Agent 1', status: 'idle' }] as any,
      messages: [],
      currentAgentId: 'agent-1',
      isLoading: false,
      error: null,
      sendMessage: vi.fn(),
      createSession: vi.fn(),
      loadSession: vi.fn(),
      selectAgent: vi.fn(),
      refreshMessages: vi.fn(),
    });

    vi.mocked(useSocket).mockReturnValue({
      isConnected: true,
      connectionState: null,
      streamingContent: '',
      pendingApproval: {
        id: 'approval-1',
        tool: 'file',
        description: 'Write to package.json',
      },
      connect: vi.fn(),
      disconnect: vi.fn(),
      respondToApproval: vi.fn(),
    });

    const { lastFrame } = render(<RunMode task="Build the project" />);

    expect(lastFrame()).toContain('file');
    expect(lastFrame()).toContain('Approve');
  });

  it('should pass sessionId to useSession hook', () => {
    render(<RunMode task="test" sessionId="custom-session" />);

    expect(useSession).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'custom-session' })
    );
  });

  it('should pass local option to useSession hook', () => {
    render(<RunMode task="test" local />);

    expect(useSession).toHaveBeenCalledWith(expect.objectContaining({ local: true }));
  });

  it('should accept exitOnComplete prop', () => {
    vi.mocked(useSession).mockReturnValue({
      session: { id: 'sess-123', name: 'Test Session' } as any,
      agents: [{ id: 'agent-1', name: 'Agent 1', status: 'idle' }] as any,
      messages: [{ id: 'msg-1', role: 'assistant', content: 'Done!' }] as any,
      currentAgentId: 'agent-1',
      isLoading: false,
      error: null,
      sendMessage: vi.fn(),
      createSession: vi.fn(),
      loadSession: vi.fn(),
      selectAgent: vi.fn(),
      refreshMessages: vi.fn(),
    });

    vi.mocked(useSocket).mockReturnValue({
      isConnected: true,
      connectionState: null,
      streamingContent: '',
      pendingApproval: null,
      connect: vi.fn(),
      disconnect: vi.fn(),
      respondToApproval: vi.fn(),
    });

    const { lastFrame } = render(<RunMode task="test" exitOnComplete />);

    // Should render without errors
    expect(lastFrame()).toBeDefined();
  });
});
