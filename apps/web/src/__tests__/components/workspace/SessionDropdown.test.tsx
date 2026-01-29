import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SessionDropdown } from '@/components/workspace/SessionDropdown';
import { useSessionStore, type ConversationSession, type Session } from '@/stores/session';

describe('SessionDropdown', () => {
  const baseConversation = (overrides: Partial<ConversationSession>): ConversationSession =>
    ({
      id: 'conv-id',
      name: 'Base',
      messages: [],
      attachedAgentIds: [],
      messageCount: 0,
      lastMessageAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...overrides,
    }) as unknown as ConversationSession;

  const withMessages = (c: ConversationSession, n = 1): ConversationSession =>
    ({ ...c, messageCount: n, lastMessageAt: new Date().toISOString() }) as ConversationSession;

  beforeEach(() => {
    const session: Session = {
      id: 'session-1',
      name: 'Workspace',
      agents: [
        {
          id: 'agent-1',
          name: 'Agent One',
          role: 'architect',
          model: 'test-model',
          status: 'idle',
          color: 'agent-1',
          messages: [],
          mode: 'auto',
        },
        {
          id: 'agent-2',
          name: 'Agent Two',
          role: 'architect',
          model: 'test-model',
          status: 'idle',
          color: 'agent-2',
          messages: [],
          mode: 'auto',
        },
      ],
      conversationSessions: [
        baseConversation({
          id: 'conv-current',
          name: 'Current Session',
          attachedAgentIds: ['agent-1'],
        }),
        withMessages(
          baseConversation({
            id: 'conv-attached-other',
            name: 'Attached Elsewhere',
            attachedAgentIds: ['agent-2'],
          })
        ),
        withMessages(baseConversation({ id: 'conv-free', name: 'Free Session' })),
        baseConversation({ id: 'conv-empty', name: 'Empty Session' }),
      ],
      viewMode: 'grid',
      workspaceStatus: 'ready',
      workspaceStatusChecking: false,
      workspaceError: null,
      filePreviews: [],
    } as unknown as Session;

    useSessionStore.setState({
      sessions: { [session.id]: session },
      currentSessionId: session.id,
      recentFiles: [],
    });
  });

  it('shows all non-current sessions in a single list and allows attaching any of them', async () => {
    const user = userEvent.setup();
    const onAttach = vi.fn();

    render(
      <SessionDropdown
        sessionId="session-1"
        agentId="agent-1"
        currentConversation={
          useSessionStore.getState().sessions['session-1'].conversationSessions[0]!
        }
        onAttach={onAttach}
        onDetach={vi.fn()}
        onCreateNew={vi.fn()}
      />
    );

    // Open the dropdown
    await user.click(screen.getByRole('button', { name: /current session/i }));

    // The old section labels should not exist anymore
    expect(screen.queryByText('Attached Sessions')).not.toBeInTheDocument();
    expect(screen.queryByText('Available Sessions')).not.toBeInTheDocument();

    // Both attached-to-other and free sessions (with messages) should be visible under "Sessions"
    expect(await screen.findByText('Sessions')).toBeInTheDocument();
    expect(screen.getByText('Attached Elsewhere')).toBeInTheDocument();
    expect(screen.getByText('Free Session')).toBeInTheDocument();
    // Empty sessions (0 messages) should not appear in the dropdown
    expect(screen.queryByText('Empty Session')).not.toBeInTheDocument();

    // Clicking a session attached to another agent should trigger onAttach
    await user.click(screen.getByText('Attached Elsewhere'));
    expect(onAttach).toHaveBeenCalledWith('conv-attached-other');

    // Re-open dropdown (it closes on select), then click a free session
    await user.click(screen.getByRole('button', { name: /current session/i }));
    expect(await screen.findByText('Free Session')).toBeInTheDocument();
    await user.click(screen.getByText('Free Session'));
    expect(onAttach).toHaveBeenCalledWith('conv-free');
  });
});
