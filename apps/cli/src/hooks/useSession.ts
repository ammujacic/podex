/**
 * Session management hook.
 */

import { useState, useEffect, useCallback } from 'react';
import { getSessionService } from '../services/session-service';
import { getCliAuthProvider } from '../adapters/auth-provider';
import type { Session, AgentInstance, Message } from '@podex/shared';

interface UseSessionOptions {
  sessionId?: string;
  autoCreate?: boolean;
  local?: boolean;
  podId?: string;
}

interface UseSessionReturn {
  session: Session | null;
  agents: AgentInstance[];
  messages: Message[];
  currentAgentId: string | null;
  isLoading: boolean;
  error: string | null;
  createSession: (options?: { local?: boolean; podId?: string }) => Promise<void>;
  loadSession: (sessionId: string) => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  selectAgent: (agentId: string) => void;
  refreshMessages: () => Promise<void>;
}

export function useSession(options: UseSessionOptions = {}): UseSessionReturn {
  const { sessionId: initialSessionId, autoCreate = false, local = false, podId } = options;

  const [session, setSession] = useState<Session | null>(null);
  const [agents, setAgents] = useState<AgentInstance[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentAgentId, setCurrentAgentId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sessionService = getSessionService();
  const authProvider = getCliAuthProvider();

  const loadSession = useCallback(
    async (id: string) => {
      setIsLoading(true);
      setError(null);

      try {
        const loadedSession = await sessionService.getSession(id);
        setSession(loadedSession);

        const loadedAgents = await sessionService.getAgents(id);
        setAgents(loadedAgents);

        // Select first agent by default
        if (loadedAgents.length > 0 && !currentAgentId) {
          setCurrentAgentId(loadedAgents[0].id);
        }

        // Join the session via WebSocket
        sessionService.joinSession(id);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setIsLoading(false);
      }
    },
    [currentAgentId]
  );

  const createSession = useCallback(
    async (opts?: { local?: boolean; podId?: string }) => {
      setIsLoading(true);
      setError(null);

      try {
        const newSession = await sessionService.createSession({
          local: opts?.local ?? local,
          pod_id: opts?.podId ?? podId,
        });
        setSession(newSession);

        // Load agents
        const loadedAgents = await sessionService.getAgents(newSession.id);
        setAgents(loadedAgents);

        if (loadedAgents.length > 0) {
          setCurrentAgentId(loadedAgents[0].id);
        }

        // Join the session via WebSocket
        sessionService.joinSession(newSession.id);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setIsLoading(false);
      }
    },
    [local, podId]
  );

  const sendMessage = useCallback(
    async (content: string) => {
      if (!session || !currentAgentId) {
        setError('No session or agent selected');
        return;
      }

      try {
        // Optimistically add user message
        const userMessage: Message = {
          id: `temp-${Date.now()}`,
          agentId: currentAgentId,
          role: 'user',
          content,
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, userMessage]);

        await sessionService.sendMessage(session.id, currentAgentId, content);
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [session, currentAgentId]
  );

  const selectAgent = useCallback((agentId: string) => {
    setCurrentAgentId(agentId);
    setMessages([]); // Clear messages when switching agents
  }, []);

  const refreshMessages = useCallback(async () => {
    if (!session || !currentAgentId) return;

    try {
      const loadedMessages = await sessionService.getMessages(session.id, currentAgentId);
      setMessages(loadedMessages);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [session, currentAgentId]);

  // Initial load
  useEffect(() => {
    if (initialSessionId) {
      loadSession(initialSessionId);
    } else if (autoCreate && authProvider.isAuthenticated()) {
      createSession();
    }
  }, [initialSessionId, autoCreate]);

  // Load messages when agent changes
  useEffect(() => {
    if (session && currentAgentId) {
      refreshMessages();
    }
  }, [session, currentAgentId, refreshMessages]);

  return {
    session,
    agents,
    messages,
    currentAgentId,
    isLoading,
    error,
    createSession,
    loadSession,
    sendMessage,
    selectAgent,
    refreshMessages,
  };
}
