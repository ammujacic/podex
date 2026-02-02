import { describe, it, expect, beforeEach } from 'vitest';
import { createSessionSlice, type SessionState } from '../session';
import type {
  AgentCore,
  ConversationSession,
  AgentMessage,
  WorkspaceStatus,
} from '../../types/session';

function createStore(initial?: Partial<SessionState>) {
  let state = {} as SessionState;

  const set = (partial: SessionState | ((prev: SessionState) => SessionState)) => {
    const next =
      typeof partial === 'function'
        ? (partial as (s: SessionState) => SessionState)(state)
        : partial;
    state = { ...state, ...next };
  };

  const get = () => state;

  state = createSessionSlice(set, get, {} as never) as SessionState;

  if (initial) {
    state = { ...state, ...initial };
  }

  return () => state;
}

describe('createSessionSlice', () => {
  let getState: () => SessionState;

  beforeEach(() => {
    getState = createStore();
  });

  it('sets and retrieves current session and agent ids', () => {
    const store = getState();

    store.setCurrentSession('s1');
    store.setCurrentAgent('a1');

    expect(getState().currentSessionId).toBe('s1');
    expect(getState().currentAgentId).toBe('a1');
  });

  it('adds, updates and removes sessions', () => {
    const store = getState();
    const session: SessionCore = {
      id: 's1',
      name: 'Session 1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'active',
    };

    store.addSession(session);
    expect(getState().sessions['s1']).toEqual(session);

    store.updateSession('s1', { name: 'Updated' });
    expect(getState().sessions['s1']?.name).toBe('Updated');

    store.removeSession('s1');
    expect(getState().sessions['s1']).toBeUndefined();
    expect(getState().currentSessionId).toBeNull();
  });

  it('sets agents and updates agent status and fields', () => {
    const store = getState();
    const agents: AgentCore[] = [
      {
        id: 'a1',
        name: 'Agent 1',
        status: 'idle',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    store.setAgents('s1', agents);
    expect(getState().agents['s1']).toHaveLength(1);

    store.updateAgentStatus('s1', 'a1', 'running');
    expect(getState().agents['s1']?.[0].status).toBe('running');

    store.updateAgent('s1', 'a1', { name: 'Updated Agent' });
    expect(getState().agents['s1']?.[0].name).toBe('Updated Agent');
  });

  it('manages conversations for a session', () => {
    const store = getState();
    const conv: ConversationSession = {
      id: 'c1',
      title: 'Conv 1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      agentId: 'a1',
      sessionId: 's1',
    };

    store.setConversations('s1', [conv]);
    expect(getState().conversations['s1']).toHaveLength(1);

    store.updateConversation('s1', 'c1', { title: 'Updated' });
    expect(getState().conversations['s1']?.[0].title).toBe('Updated');

    store.removeConversation('s1', 'c1');
    expect(getState().conversations['s1']).toHaveLength(0);
  });

  it('manages messages for a conversation', () => {
    const store = getState();
    const msg: AgentMessage = {
      id: 'm1',
      content: 'hello',
      role: 'user',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      agentId: 'a1',
      conversationId: 'c1',
    };

    store.setMessages('c1', [msg]);
    expect(getState().messages['c1']).toHaveLength(1);

    store.updateMessage('c1', 'm1', { content: 'updated' });
    expect(getState().messages['c1']?.[0].content).toBe('updated');

    store.addMessage('c1', { ...msg, id: 'm2' });
    expect(getState().messages['c1']).toHaveLength(2);
  });

  it('manages streaming state', () => {
    const store = getState();

    store.startStreaming('m1', 'a1', 's1');
    expect(getState().streamingMessages['m1']).toMatchObject({
      agentId: 'a1',
      sessionId: 's1',
      isStreaming: true,
    });

    store.appendStreamToken('m1', 'hello ');
    store.appendStreamToken('m1', 'world');
    expect(getState().streamingMessages['m1'].content).toBe('hello world');

    store.appendThinkingToken('m1', 'thinking ');
    store.appendThinkingToken('m1', 'more');
    expect(getState().streamingMessages['m1'].thinkingContent).toBe('thinking more');

    store.endStreaming('m1', 'final');
    expect(getState().streamingMessages['m1']).toBeUndefined();
  });

  it('updates workspace status and error', () => {
    const store = getState();
    const status: WorkspaceStatus = 'connected';

    // workspace helpers require an existing session
    store.addSession({
      id: 's1',
      name: 'Session 1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'active',
    });

    store.setWorkspaceStatus('s1', status);
    expect(getState().sessions['s1']?.workspaceStatus).toBe(status);

    store.setWorkspaceError('s1', 'boom');
    expect(getState().sessions['s1']?.workspaceError).toBe('boom');
  });

  it('updates connection flag', () => {
    const store = getState();

    store.setConnected(true);
    expect(getState().isConnected).toBe(true);
    store.setConnected(false);
    expect(getState().isConnected).toBe(false);
  });

  it('provides selector helpers', () => {
    const store = getState();
    const session: SessionCore = {
      id: 's1',
      name: 'Session 1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'active',
    };
    const agent: AgentCore = {
      id: 'a1',
      name: 'Agent 1',
      status: 'idle',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const conv: ConversationSession = {
      id: 'c1',
      title: 'Conv 1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      agentId: 'a1',
      sessionId: 's1',
    };

    store.addSession(session);
    store.setAgents('s1', [agent]);
    store.setConversations('s1', [conv]);
    store.setMessages('c1', [
      {
        id: 'm1',
        content: 'hello',
        role: 'user',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        agentId: 'a1',
        conversationId: 'c1',
      },
    ]);

    expect(store.getSession('s1')).toEqual(session);
    expect(store.getAgents('s1')).toEqual([agent]);
    expect(store.getConversations('s1')).toEqual([conv]);
    expect(store.getMessages('c1')).toHaveLength(1);
    expect(store.getStreamingMessage('m1')).toBeUndefined();
    expect(store.getCurrentAgent()).toBeUndefined();
  });
});
