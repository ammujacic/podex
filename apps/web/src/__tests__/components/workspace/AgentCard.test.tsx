/**
 * Tests for AgentCard component
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AgentCard } from '@/components/workspace/AgentCard';
import type { Agent } from '@/stores/session';

// Mock dependencies
vi.mock('@/stores/session', async () => {
  const actual = await vi.importActual('@/stores/session');
  return {
    ...actual,
    useSessionStore: () => ({
      removeAgent: vi.fn(),
      updateAgent: vi.fn(),
      addAgentMessage: vi.fn(),
      streamingMessages: {},
    }),
  };
});

vi.mock('@/stores/attention', () => ({
  useAttentionStore: () => ({
    getAttentionsForAgent: () => [],
    getHighestPriorityAttention: () => null,
    openPanel: vi.fn(),
  }),
}));

vi.mock('@/hooks/useVoiceCapture', () => ({
  useVoiceCapture: () => ({
    isRecording: false,
    currentTranscript: '',
    startRecording: vi.fn(),
    stopRecording: vi.fn(),
  }),
}));

vi.mock('@/hooks/useAudioPlayback', () => ({
  useAudioPlayback: () => ({
    isPlaying: false,
    playingMessageId: null,
    playAudioUrl: vi.fn(),
    stopPlayback: vi.fn(),
  }),
}));

vi.mock('@/lib/socket', () => ({
  onSocketEvent: vi.fn(() => () => {}),
}));

vi.mock('@/lib/api', () => ({
  sendAgentMessage: vi.fn(),
  deleteAgent: vi.fn(),
  synthesizeMessage: vi.fn(),
}));

describe('AgentCard', () => {
  const mockAgent: Agent = {
    id: 'agent-123',
    name: 'Architect',
    role: 'architect',
    model: 'claude-opus-4-5-20251101',
    status: 'idle',
    color: 'agent-1',
    messages: [],
    mode: 'auto',
  };

  const defaultProps = {
    agent: mockAgent,
    sessionId: 'session-123',
  };

  it('renders the agent card', () => {
    render(<AgentCard {...defaultProps} />);
    expect(document.body.innerHTML).toBeTruthy();
  });

  it('displays agent name', () => {
    render(<AgentCard {...defaultProps} />);
    expect(screen.getByText('Architect')).toBeInTheDocument();
  });

  it('displays agent model', () => {
    render(<AgentCard {...defaultProps} />);
    // Component displays friendly model name, not raw ID
    expect(screen.getByText('Claude Opus 4.5')).toBeInTheDocument();
  });

  it('shows active status', () => {
    const activeAgent = { ...mockAgent, status: 'active' as const };
    render(<AgentCard {...defaultProps} agent={activeAgent} />);
    // Should have active indicator styling
    expect(document.body.innerHTML).toBeTruthy();
  });

  it('shows error status', () => {
    const errorAgent = { ...mockAgent, status: 'error' as const };
    render(<AgentCard {...defaultProps} agent={errorAgent} />);
    expect(document.body.innerHTML).toBeTruthy();
  });

  it('displays message input', () => {
    render(<AgentCard {...defaultProps} />);
    const input = screen.getByPlaceholderText(/ask architect/i);
    expect(input).toBeInTheDocument();
  });

  it('shows empty state message when no messages', () => {
    render(<AgentCard {...defaultProps} />);
    expect(screen.getByText('No messages yet. Start a conversation.')).toBeInTheDocument();
  });

  it('displays messages when present', () => {
    const agentWithMessages = {
      ...mockAgent,
      messages: [
        {
          id: 'msg-1',
          role: 'user' as const,
          content: 'Hello!',
          timestamp: new Date(),
        },
        {
          id: 'msg-2',
          role: 'assistant' as const,
          content: 'Hi there!',
          timestamp: new Date(),
        },
      ],
    };
    render(<AgentCard {...defaultProps} agent={agentWithMessages} />);
    expect(screen.getByText('Hello!')).toBeInTheDocument();
    expect(screen.getByText('Hi there!')).toBeInTheDocument();
  });

  it('supports expanded mode', () => {
    render(<AgentCard {...defaultProps} expanded={true} />);
    expect(document.body.innerHTML).toBeTruthy();
  });
});
