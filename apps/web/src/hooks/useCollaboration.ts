/**
 * React hooks for real-time collaboration features.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import * as Y from 'yjs';
import {
  joinSession,
  leaveSession,
  destroyYDoc,
  setUserInfo,
  getCollaborators,
  getFileContent,
  initFileContent,
  getAgentMessages,
  addAgentMessage,
  onUserJoined,
  onUserLeft,
  onAgentStatusUpdate,
  onAgentTyping,
  broadcastAgentTyping,
} from '@/lib/collaboration';
import type { CollaboratorInfo } from '@/lib/collaboration';
import { useUser } from '@/stores/auth';

// Generate a random color for the user
function generateUserColor(): string {
  const colors = [
    '#ef4444',
    '#f97316',
    '#f59e0b',
    '#84cc16',
    '#22c55e',
    '#14b8a6',
    '#06b6d4',
    '#3b82f6',
    '#6366f1',
    '#8b5cf6',
    '#a855f7',
    '#ec4899',
  ];
  return colors[Math.floor(Math.random() * colors.length)] ?? '#3b82f6';
}

/**
 * Hook to manage session collaboration state.
 */
export function useSession(sessionId: string | null) {
  const user = useUser();
  const [collaborators, setCollaborators] = useState<string[]>([]);
  const colorRef = useRef(generateUserColor());

  useEffect(() => {
    if (!sessionId || !user) return;

    // Join session
    joinSession(sessionId, user.id);

    // Subscribe to user events
    const unsubJoin = onUserJoined((data) => {
      if (data.session_id === sessionId) {
        setCollaborators((prev) => [...new Set([...prev, data.user_id])]);
      }
    });

    const unsubLeave = onUserLeft((data) => {
      if (data.session_id === sessionId) {
        setCollaborators((prev) => prev.filter((id) => id !== data.user_id));
      }
    });

    return () => {
      leaveSession(sessionId, user.id);
      unsubJoin();
      unsubLeave();
    };
  }, [sessionId, user]);

  return {
    collaborators,
    userColor: colorRef.current,
  };
}

/**
 * Hook for collaborative file editing.
 */
export function useCollaborativeFile(
  sessionId: string | null,
  filePath: string | null,
  initialContent?: string
) {
  const user = useUser();
  const [content, setContent] = useState<string>(initialContent || '');
  const [collaborators, setCollaborators] = useState<CollaboratorInfo[]>([]);
  const yTextRef = useRef<Y.Text | null>(null);
  const colorRef = useRef(generateUserColor());
  // Store initialContent in a ref so effect doesn't re-run when parent passes new reference
  const initialContentRef = useRef(initialContent);
  initialContentRef.current = initialContent;

  useEffect(() => {
    if (!sessionId || !filePath) return;

    let isMounted = true;
    const docName = `file:${filePath}`;
    const yText = getFileContent(sessionId, filePath);
    yTextRef.current = yText;

    // Initialize content if provided and document is empty (use ref to avoid re-running effect)
    const contentToInit = initialContentRef.current;
    if (contentToInit && yText.length === 0) {
      initFileContent(sessionId, filePath, contentToInit);
    }

    // Set initial content from Yjs
    if (isMounted) {
      setContent(yText.toString());
    }

    // Subscribe to changes (guard against updates after unmount)
    const observer = () => {
      if (isMounted) {
        setContent(yText.toString());
      }
    };
    yText.observe(observer);

    // Set user awareness
    if (user) {
      setUserInfo(sessionId, docName, {
        id: user.id,
        name: user.name || user.email,
        color: colorRef.current,
      });
    }

    // Update collaborators periodically (guard against updates after unmount)
    const updateCollaborators = () => {
      if (isMounted) {
        setCollaborators(getCollaborators(sessionId, docName));
      }
    };
    const interval = setInterval(updateCollaborators, 1000);
    updateCollaborators();

    return () => {
      isMounted = false;
      yText.unobserve(observer);
      clearInterval(interval);
      destroyYDoc(sessionId, docName);
    };
  }, [sessionId, filePath, user]);

  // Update content handler
  const updateContent = useCallback(
    (newContent: string, cursorPosition?: { line: number; column: number }) => {
      if (!yTextRef.current || !sessionId || !filePath) return;

      const yText = yTextRef.current;
      const currentContent = yText.toString();

      // Simple diff - replace all content
      // In production, use a proper diff algorithm for efficiency
      if (newContent !== currentContent) {
        yText.delete(0, currentContent.length);
        yText.insert(0, newContent);
      }

      // Update cursor position in awareness
      if (cursorPosition && user) {
        setUserInfo(sessionId, `file:${filePath}`, {
          id: user.id,
          name: user.name || user.email,
          color: colorRef.current,
          cursor: cursorPosition,
        });
      }
    },
    [sessionId, filePath, user]
  );

  return {
    content,
    updateContent,
    collaborators,
    yText: yTextRef.current,
  };
}

/**
 * Hook for collaborative agent conversations.
 */
export function useCollaborativeAgent(sessionId: string | null, agentId: string | null) {
  const user = useUser();
  const [messages, setMessages] = useState<
    Array<{
      id: string;
      role: 'user' | 'assistant';
      content: string;
      timestamp: number;
      userId?: string;
    }>
  >([]);
  const [status, setStatus] = useState<string>('idle');
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const yArrayRef = useRef<Y.Array<Y.Map<unknown>> | null>(null);

  useEffect(() => {
    if (!sessionId || !agentId) return;

    let isMounted = true;
    const yArray = getAgentMessages(sessionId, agentId);
    yArrayRef.current = yArray;

    // Load initial messages (guard against updates after unmount)
    const loadMessages = () => {
      if (!isMounted) return;
      const msgs: typeof messages = [];
      yArray.forEach((item) => {
        if (item instanceof Y.Map) {
          msgs.push({
            id: item.get('id') as string,
            role: item.get('role') as 'user' | 'assistant',
            content: item.get('content') as string,
            timestamp: item.get('timestamp') as number,
            userId: item.get('userId') as string | undefined,
          });
        }
      });
      setMessages(msgs);
    };
    loadMessages();

    // Subscribe to changes
    const observer = () => loadMessages();
    yArray.observe(observer);

    // Subscribe to status updates (guard against updates after unmount)
    const unsubStatus = onAgentStatusUpdate((data) => {
      if (!isMounted) return;
      if (data.session_id === sessionId && data.agent_id === agentId) {
        setStatus(data.status);
      }
    });

    // Subscribe to typing indicators (guard against updates after unmount)
    const unsubTyping = onAgentTyping((data) => {
      if (!isMounted) return;
      if (data.session_id === sessionId && data.agent_id === agentId) {
        setTypingUsers((prev) => {
          if (data.is_typing) {
            return [...new Set([...prev, data.user_id])];
          } else {
            return prev.filter((id) => id !== data.user_id);
          }
        });
      }
    });

    return () => {
      isMounted = false;
      yArray.unobserve(observer);
      unsubStatus();
      unsubTyping();
      destroyYDoc(sessionId, `agent:${agentId}`);
    };
  }, [sessionId, agentId]);

  // Send a message
  const sendMessage = useCallback(
    (content: string) => {
      if (!sessionId || !agentId || !user) return;

      addAgentMessage(sessionId, agentId, {
        id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        role: 'user',
        content,
        timestamp: Date.now(),
        userId: user.id,
      });
    },
    [sessionId, agentId, user]
  );

  // Set typing indicator
  const setTyping = useCallback(
    (isTyping: boolean) => {
      if (!sessionId || !agentId || !user) return;
      broadcastAgentTyping(sessionId, agentId, user.id, isTyping);
    },
    [sessionId, agentId, user]
  );

  return {
    messages,
    status,
    typingUsers,
    sendMessage,
    setTyping,
  };
}

/**
 * Hook to track online collaborators in a session.
 */
export function useOnlineUsers(sessionId: string | null) {
  const [users, setUsers] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!sessionId) return;

    const unsubJoin = onUserJoined((data) => {
      if (data.session_id === sessionId) {
        setUsers((prev) => new Set([...prev, data.user_id]));
      }
    });

    const unsubLeave = onUserLeft((data) => {
      if (data.session_id === sessionId) {
        setUsers((prev) => {
          const next = new Set(prev);
          next.delete(data.user_id);
          return next;
        });
      }
    });

    return () => {
      unsubJoin();
      unsubLeave();
    };
  }, [sessionId]);

  return Array.from(users);
}
