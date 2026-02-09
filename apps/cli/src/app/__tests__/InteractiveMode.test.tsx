/**
 * Tests for InteractiveMode component.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { InteractiveMode } from '../InteractiveMode';

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
    thinkingContent: '',
    pendingApproval: null,
    agentContextUsage: {},
    agentConfigs: {},
    sessionUsage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
    respondToApproval: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
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

describe('InteractiveMode', () => {
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

    const { lastFrame } = render(<InteractiveMode />);

    expect(lastFrame()).toContain('Loading session');
  });

  it('should show error when session has error', () => {
    vi.mocked(useSession).mockReturnValue({
      session: null,
      agents: [],
      messages: [],
      currentAgentId: null,
      isLoading: false,
      error: 'Connection failed',
      sendMessage: vi.fn(),
      createSession: vi.fn(),
      loadSession: vi.fn(),
      selectAgent: vi.fn(),
      refreshMessages: vi.fn(),
    });

    const { lastFrame } = render(<InteractiveMode />);

    expect(lastFrame()).toContain('Connection failed');
    expect(lastFrame()).toContain('Ctrl+C');
  });

  it('should show creating session when no session and no loading', () => {
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

    const { lastFrame } = render(<InteractiveMode />);

    expect(lastFrame()).toContain('Creating session');
  });

  it('should render chat interface when session exists', () => {
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
      thinkingContent: '',
      pendingApproval: null,
      agentContextUsage: {},
      agentConfigs: {},
      sessionUsage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
      connect: vi.fn(),
      disconnect: vi.fn(),
      respondToApproval: vi.fn(),
    });

    const { lastFrame } = render(<InteractiveMode />);

    expect(lastFrame()).toContain('Type a message');
  });

  it('should show multiple agents when available', () => {
    vi.mocked(useSession).mockReturnValue({
      session: { id: 'sess-123', name: 'Test Session' } as any,
      agents: [
        { id: 'agent-1', name: 'Agent 1', status: 'idle' },
        { id: 'agent-2', name: 'Agent 2', status: 'thinking' },
      ] as any,
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
      thinkingContent: '',
      pendingApproval: null,
      agentContextUsage: {},
      agentConfigs: {},
      sessionUsage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
      connect: vi.fn(),
      disconnect: vi.fn(),
      respondToApproval: vi.fn(),
    });

    const { lastFrame } = render(<InteractiveMode />);

    expect(lastFrame()).toContain('Agent 1');
    expect(lastFrame()).toContain('Agent 2');
  });

  it('should show connecting placeholder when not connected', () => {
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
      thinkingContent: '',
      pendingApproval: null,
      agentContextUsage: {},
      agentConfigs: {},
      sessionUsage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
      connect: vi.fn(),
      disconnect: vi.fn(),
      respondToApproval: vi.fn(),
    });

    const { lastFrame } = render(<InteractiveMode />);

    expect(lastFrame()).toContain('Connecting');
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
      thinkingContent: '',
      pendingApproval: {
        id: 'approval-1',
        tool: 'shell',
        description: 'Run npm install',
        command: 'npm install',
      },
      agentContextUsage: {},
      agentConfigs: {},
      sessionUsage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
      connect: vi.fn(),
      disconnect: vi.fn(),
      respondToApproval: vi.fn(),
    });

    const { lastFrame } = render(<InteractiveMode />);

    expect(lastFrame()).toContain('shell');
    expect(lastFrame()).toContain('Approve');
  });

  it('should pass sessionId to useSession hook', () => {
    render(<InteractiveMode sessionId="custom-session" />);

    expect(useSession).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'custom-session' })
    );
  });

  it('should pass local option to useSession hook', () => {
    render(<InteractiveMode local />);

    expect(useSession).toHaveBeenCalledWith(expect.objectContaining({ local: true }));
  });
});
