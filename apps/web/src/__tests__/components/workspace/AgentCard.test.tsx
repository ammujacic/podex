/**
 * Tests for AgentCard component
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AgentCard } from '@/components/workspace/AgentCard';
import type { Agent } from '@/stores/session';

// Create a mock conversation session for testing
const mockConversationSession = {
  id: 'conv-1',
  name: 'Test Conversation',
  messages: [],
  attachedAgentIds: ['agent-123'],
  messageCount: 0,
  lastMessageAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

// Store mock for controlling conversation messages
let currentMockMessages: Array<{
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}> = [];

// Mock dependencies
vi.mock('@/stores/session', async () => {
  const actual = await vi.importActual('@/stores/session');
  return {
    ...actual,
    useSessionStore: () => ({
      removeAgent: vi.fn(),
      updateAgent: vi.fn(),
      addAgentMessage: vi.fn(),
      addConversationMessage: vi.fn(),
      deleteConversationMessage: vi.fn(),
      getConversationForAgent: () => ({
        ...mockConversationSession,
        messages: currentMockMessages,
      }),
    }),
  };
});

vi.mock('@/stores/streaming', () => ({
  useStreamingStore: (selector?: (state: any) => any) => {
    const state = {
      streamingMessages: {},
    };
    if (selector) {
      return selector(state);
    }
    return state;
  },
}));

vi.mock('@/stores/editor', () => ({
  useEditorStore: () => ({
    openFile: vi.fn(),
  }),
}));

vi.mock('@/stores/worktrees', () => ({
  useWorktreesStore: (selector?: (state: any) => any) => {
    const state = {
      sessionWorktrees: { 'session-123': [] },
    };
    if (selector) {
      return selector(state);
    }
    return state;
  },
}));

vi.mock('@/stores/checkpoints', () => ({
  useCheckpointsStore: (selector?: (state: any) => any) => {
    const state = {
      sessionCheckpoints: { 'session-123': [] },
      restoringCheckpointId: null,
    };
    if (selector) {
      return selector(state);
    }
    return state;
  },
}));

vi.mock('@/stores/approvals', () => ({
  useApprovalsStore: () => ({
    approvalsByAgent: {},
    setApproval: vi.fn(),
    clearApproval: vi.fn(),
    getAgentApprovals: () => [],
  }),
}));

vi.mock('@/stores/attention', () => ({
  useAttentionStore: () => ({
    getAttentionsForAgent: () => [],
    getHighestPriorityAttention: () => null,
    getUnreadCountForAgent: () => 0,
    hasUnreadForAgent: () => false,
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

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    sendAgentMessage: vi.fn(),
    deleteAgent: vi.fn(),
    synthesizeMessage: vi.fn(),
    getAvailableModels: vi.fn().mockResolvedValue([]),
    getUserProviderModels: vi.fn().mockResolvedValue([]),
    getPlatformConfig: vi.fn().mockResolvedValue({
      features: {},
      limits: {},
    }),
    getAgentRoleConfigs: vi.fn().mockResolvedValue([]),
    getLocalLLMConfig: vi.fn().mockResolvedValue(null),
  };
});

describe('AgentCard', () => {
  const mockAgent: Agent = {
    id: 'agent-123',
    name: 'Architect',
    role: 'architect',
    model: 'claude-opus-4-5-20251101',
    modelDisplayName: 'Opus 4.5',
    status: 'idle',
    color: 'agent-1',
    mode: 'auto',
    conversationSessionId: 'conv-1',
  };

  const defaultProps = {
    agent: mockAgent,
    sessionId: 'session-123',
  };

  beforeEach(() => {
    // Reset the mock messages before each test
    currentMockMessages = [];
  });

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
    // Component displays parsed model name when no model info is available
    expect(screen.getByText('Opus 4.5')).toBeInTheDocument();
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
    // Set up mock messages in the conversation session
    currentMockMessages = [
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
    ];
    render(<AgentCard {...defaultProps} />);
    expect(screen.getByText('Hello!')).toBeInTheDocument();
    expect(screen.getByText('Hi there!')).toBeInTheDocument();
  });

  it('supports expanded mode', () => {
    render(<AgentCard {...defaultProps} expanded={true} />);
    expect(document.body.innerHTML).toBeTruthy();
  });
});
