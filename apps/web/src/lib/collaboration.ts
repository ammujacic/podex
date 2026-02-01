/**
 * Real-time collaboration using Yjs and Socket.IO.
 * Supports collaborative editing of code and agent conversations.
 */

import * as Y from 'yjs';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import {
  Awareness,
  encodeAwarenessUpdate,
  applyAwarenessUpdate,
  removeAwarenessStates,
} from 'y-protocols/awareness';

const SOCKET_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

// Singleton socket connection
let socket: Socket | null = null;

// Document cache
const docCache = new Map<string, Y.Doc>();
const awarenessCache = new Map<string, Awareness>();

// Track socket event handlers to prevent duplicates and enable cleanup
const socketHandlers = new Map<string, Set<string>>();
// Store actual handler functions for cleanup
const socketHandlerFns = new Map<string, Map<string, (...args: unknown[]) => void>>();
// Track beforeunload handlers for cleanup
const beforeUnloadHandlers = new Map<string, () => void>();

export interface CollaboratorInfo {
  id: string;
  name: string;
  color: string;
  cursor?: {
    line: number;
    column: number;
  };
}

// Helper to convert Uint8Array to base64
function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

// Helper to convert base64 to Uint8Array
function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// Get or create socket connection
export function getSocket(): Socket {
  if (!socket) {
    socket = io(SOCKET_URL, {
      transports: ['websocket'],
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      withCredentials: true, // Required for cross-origin cookie authentication
    });

    socket.on('connect', () => {
      // Re-subscribe to all documents on reconnect
      docCache.forEach((_, key) => {
        const [sessionId, docName] = key.split(':');
        if (sessionId && docName) {
          socket?.emit('yjs_subscribe', { session_id: sessionId, doc_name: docName });
        }
      });
    });

    socket.on('disconnect', () => {
      // Mark all remote users as offline when disconnected
      awarenessCache.forEach((awareness) => {
        const states = awareness.getStates();
        const clientsToRemove: number[] = [];
        states.forEach((_, clientId) => {
          if (clientId !== awareness.clientID) {
            clientsToRemove.push(clientId);
          }
        });
        if (clientsToRemove.length > 0) {
          removeAwarenessStates(awareness, clientsToRemove, 'disconnect');
        }
      });
    });
  }

  return socket;
}

// Join a session for real-time updates
export function joinSession(sessionId: string, userId: string): void {
  const sock = getSocket();
  sock.emit('session_join', { session_id: sessionId, user_id: userId });
}

// Leave a session
export function leaveSession(sessionId: string, userId: string): void {
  const sock = getSocket();
  sock.emit('session_leave', { session_id: sessionId, user_id: userId });
}

/**
 * Get or create a Yjs document for collaborative editing.
 * @param sessionId - The session ID
 * @param docName - Document identifier (e.g., "file:/workspace/src/app.tsx" or "agent:123")
 */
export function getYDoc(sessionId: string, docName: string): Y.Doc {
  const key = `${sessionId}:${docName}`;

  if (docCache.has(key)) {
    return docCache.get(key)!;
  }

  const doc = new Y.Doc();
  docCache.set(key, doc);

  // Set up socket sync
  const sock = getSocket();

  // Track handlers for this key
  if (!socketHandlers.has(key)) {
    socketHandlers.set(key, new Set());
  }
  if (!socketHandlerFns.has(key)) {
    socketHandlerFns.set(key, new Map());
  }
  const handlers = socketHandlers.get(key)!;
  const handlerFns = socketHandlerFns.get(key)!;

  // Subscribe to document updates
  sock.emit('yjs_subscribe', { session_id: sessionId, doc_name: docName });

  // Handle incoming sync state (full document state)
  if (!handlers.has('yjs_sync')) {
    handlers.add('yjs_sync');
    const syncHandler = (data: { session_id: string; doc_name: string; state: string }) => {
      if (data.session_id === sessionId && data.doc_name === docName) {
        const state = base64ToUint8Array(data.state);
        Y.applyUpdate(doc, state, 'socket');
      }
    };
    handlerFns.set('yjs_sync', syncHandler as (...args: unknown[]) => void);
    sock.on('yjs_sync', syncHandler);
  }

  // Handle incoming updates from other clients
  if (!handlers.has('yjs_update')) {
    handlers.add('yjs_update');
    const updateHandler = (data: { session_id: string; doc_name: string; update: string }) => {
      if (data.session_id === sessionId && data.doc_name === docName) {
        const update = base64ToUint8Array(data.update);
        Y.applyUpdate(doc, update, 'socket');
      }
    };
    handlerFns.set('yjs_update', updateHandler as (...args: unknown[]) => void);
    sock.on('yjs_update', updateHandler);
  }

  // Send local updates to server
  doc.on('update', (update: Uint8Array, origin: unknown) => {
    // Don't broadcast updates that came from the socket
    if (origin === 'socket') return;

    const updateB64 = uint8ArrayToBase64(update);
    sock.emit('yjs_update', {
      session_id: sessionId,
      doc_name: docName,
      update: updateB64,
    });
  });

  return doc;
}

/**
 * Get awareness instance for cursor positions and user presence.
 */
export function getAwareness(sessionId: string, docName: string): Awareness {
  const key = `${sessionId}:${docName}`;

  if (awarenessCache.has(key)) {
    return awarenessCache.get(key)!;
  }

  const doc = getYDoc(sessionId, docName);
  const awareness = new Awareness(doc);
  awarenessCache.set(key, awareness);

  const sock = getSocket();

  // Track handlers for this key
  if (!socketHandlers.has(key)) {
    socketHandlers.set(key, new Set());
  }
  if (!socketHandlerFns.has(key)) {
    socketHandlerFns.set(key, new Map());
  }
  const handlers = socketHandlers.get(key)!;
  const handlerFns = socketHandlerFns.get(key)!;

  // Handle incoming awareness updates from other clients
  if (!handlers.has('yjs_awareness')) {
    handlers.add('yjs_awareness');
    const awarenessHandler = (data: {
      session_id: string;
      doc_name: string;
      awareness: string;
    }) => {
      if (data.session_id === sessionId && data.doc_name === docName) {
        const awarenessUpdate = base64ToUint8Array(data.awareness);
        applyAwarenessUpdate(awareness, awarenessUpdate, 'socket');
      }
    };
    handlerFns.set('yjs_awareness', awarenessHandler as (...args: unknown[]) => void);
    sock.on('yjs_awareness', awarenessHandler);
  }

  // Handle user disconnect - remove their awareness state
  if (!handlers.has('yjs_awareness_remove')) {
    handlers.add('yjs_awareness_remove');
    const awarenessRemoveHandler = (data: {
      session_id: string;
      doc_name: string;
      client_ids: number[];
    }) => {
      if (data.session_id === sessionId && data.doc_name === docName) {
        removeAwarenessStates(awareness, data.client_ids, 'socket');
      }
    };
    handlerFns.set('yjs_awareness_remove', awarenessRemoveHandler as (...args: unknown[]) => void);
    sock.on('yjs_awareness_remove', awarenessRemoveHandler);
  }

  // Send local awareness updates to server
  awareness.on(
    'update',
    ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
      const changedClients = [...added, ...updated, ...removed];
      if (changedClients.length === 0) return;

      // Only broadcast changes that include our own client
      if (!changedClients.includes(awareness.clientID)) return;

      // Encode the awareness update using y-protocols
      const awarenessUpdate = encodeAwarenessUpdate(awareness, changedClients);
      const updateB64 = uint8ArrayToBase64(awarenessUpdate);

      sock.emit('yjs_awareness', {
        session_id: sessionId,
        doc_name: docName,
        awareness: updateB64,
        client_id: awareness.clientID,
      });
    }
  );

  // Clean up awareness when window unloads
  if (typeof window !== 'undefined') {
    // Remove any existing handler for this key to prevent duplicates
    const existingHandler = beforeUnloadHandlers.get(key);
    if (existingHandler) {
      window.removeEventListener('beforeunload', existingHandler);
    }

    const handleBeforeUnload = () => {
      // Notify others that we're leaving
      const awarenessUpdate = encodeAwarenessUpdate(awareness, [awareness.clientID]);
      const updateB64 = uint8ArrayToBase64(awarenessUpdate);
      sock.emit('yjs_awareness_remove', {
        session_id: sessionId,
        doc_name: docName,
        client_ids: [awareness.clientID],
        awareness: updateB64,
      });
    };
    beforeUnloadHandlers.set(key, handleBeforeUnload);
    window.addEventListener('beforeunload', handleBeforeUnload);
  }

  return awareness;
}

/**
 * Clean up a Yjs document subscription.
 */
export function destroyYDoc(sessionId: string, docName: string): void {
  const key = `${sessionId}:${docName}`;
  const sock = getSocket();

  // Notify server we're leaving
  sock.emit('yjs_unsubscribe', { session_id: sessionId, doc_name: docName });

  // Clean up awareness first
  const awareness = awarenessCache.get(key);
  if (awareness) {
    // Notify others we're leaving this document
    const awarenessUpdate = encodeAwarenessUpdate(awareness, [awareness.clientID]);
    const updateB64 = uint8ArrayToBase64(awarenessUpdate);
    sock.emit('yjs_awareness_remove', {
      session_id: sessionId,
      doc_name: docName,
      client_ids: [awareness.clientID],
      awareness: updateB64,
    });

    awareness.destroy();
    awarenessCache.delete(key);
  }

  // Clean up document
  const doc = docCache.get(key);
  if (doc) {
    doc.destroy();
    docCache.delete(key);
  }

  // Remove socket event listeners to prevent memory leaks
  const handlerFns = socketHandlerFns.get(key);
  if (handlerFns) {
    handlerFns.forEach((handler, eventName) => {
      sock.off(eventName, handler);
    });
    socketHandlerFns.delete(key);
  }

  // Clean up handler tracking
  socketHandlers.delete(key);

  // Clean up beforeunload handler
  if (typeof window !== 'undefined') {
    const beforeUnloadHandler = beforeUnloadHandlers.get(key);
    if (beforeUnloadHandler) {
      window.removeEventListener('beforeunload', beforeUnloadHandler);
      beforeUnloadHandlers.delete(key);
    }
  }
}

/**
 * Set user info for awareness (name, color, cursor position).
 */
export function setUserInfo(sessionId: string, docName: string, userInfo: CollaboratorInfo): void {
  const awareness = getAwareness(sessionId, docName);
  awareness.setLocalState({
    user: userInfo,
    cursor: userInfo.cursor,
  });
}

/**
 * Update cursor position for the current user.
 */
export function updateCursor(
  sessionId: string,
  docName: string,
  cursor: { line: number; column: number } | null
): void {
  const awareness = getAwareness(sessionId, docName);
  const currentState = awareness.getLocalState();
  if (currentState) {
    awareness.setLocalState({
      ...currentState,
      cursor,
    });
  }
}

/**
 * Get all collaborators currently editing a document.
 */
export function getCollaborators(sessionId: string, docName: string): CollaboratorInfo[] {
  const awareness = getAwareness(sessionId, docName);
  const states = awareness.getStates();
  const collaborators: CollaboratorInfo[] = [];

  states.forEach((state, clientId) => {
    if (state.user && clientId !== awareness.clientID) {
      collaborators.push(state.user as CollaboratorInfo);
    }
  });

  return collaborators;
}

/**
 * Subscribe to awareness changes for a document.
 */
export function onAwarenessChange(
  sessionId: string,
  docName: string,
  callback: (collaborators: CollaboratorInfo[]) => void
): () => void {
  const awareness = getAwareness(sessionId, docName);

  const handler = () => {
    callback(getCollaborators(sessionId, docName));
  };

  awareness.on('change', handler);
  return () => awareness.off('change', handler);
}

// ============== Agent Collaboration ==============

/**
 * Get a Yjs text type for agent conversation messages.
 */
export function getAgentMessages(sessionId: string, agentId: string): Y.Array<Y.Map<unknown>> {
  const doc = getYDoc(sessionId, `agent:${agentId}`);
  return doc.getArray('messages');
}

/**
 * Add a message to an agent conversation (synced across all clients).
 */
export function addAgentMessage(
  sessionId: string,
  agentId: string,
  message: {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
    userId?: string;
  }
): void {
  const messages = getAgentMessages(sessionId, agentId);
  const msgMap = new Y.Map();
  msgMap.set('id', message.id);
  msgMap.set('role', message.role);
  msgMap.set('content', message.content);
  msgMap.set('timestamp', message.timestamp);
  if (message.userId) {
    msgMap.set('userId', message.userId);
  }
  messages.push([msgMap]);
}

/**
 * Subscribe to agent status updates.
 */
export function onAgentStatusUpdate(
  callback: (data: { session_id: string; agent_id: string; status: string }) => void
): () => void {
  const sock = getSocket();
  sock.on('agent_status_update', callback);
  return () => sock.off('agent_status_update', callback);
}

/**
 * Broadcast agent status update.
 */
export function broadcastAgentStatus(sessionId: string, agentId: string, status: string): void {
  const sock = getSocket();
  sock.emit('agent_status_update', {
    session_id: sessionId,
    agent_id: agentId,
    status,
  });
}

/**
 * Subscribe to agent typing indicators.
 */
export function onAgentTyping(
  callback: (data: {
    session_id: string;
    agent_id: string;
    user_id: string;
    is_typing: boolean;
  }) => void
): () => void {
  const sock = getSocket();
  sock.on('agent_typing', callback);
  return () => sock.off('agent_typing', callback);
}

/**
 * Broadcast that user is typing to an agent.
 */
export function broadcastAgentTyping(
  sessionId: string,
  agentId: string,
  userId: string,
  isTyping: boolean
): void {
  const sock = getSocket();
  sock.emit('agent_typing', {
    session_id: sessionId,
    agent_id: agentId,
    user_id: userId,
    is_typing: isTyping,
  });
}

// ============== File Collaboration ==============

/**
 * Get a Yjs text type for collaborative file editing.
 */
export function getFileContent(sessionId: string, filePath: string): Y.Text {
  const doc = getYDoc(sessionId, `file:${filePath}`);
  return doc.getText('content');
}

/**
 * Initialize file content (only if empty).
 */
export function initFileContent(sessionId: string, filePath: string, content: string): void {
  const text = getFileContent(sessionId, filePath);
  if (text.length === 0) {
    text.insert(0, content);
  }
}

// ============== Socket Event Subscriptions ==============

/**
 * Subscribe to user join events.
 */
export function onUserJoined(
  callback: (data: { user_id: string; session_id: string }) => void
): () => void {
  const sock = getSocket();
  sock.on('user_joined', callback);
  return () => sock.off('user_joined', callback);
}

/**
 * Subscribe to user leave events.
 */
export function onUserLeft(
  callback: (data: { user_id: string; session_id: string }) => void
): () => void {
  const sock = getSocket();
  sock.on('user_left', callback);
  return () => sock.off('user_left', callback);
}

/**
 * Subscribe to agent message events.
 */
export function onAgentMessage(
  callback: (data: { session_id: string; agent_id: string; message: unknown }) => void
): () => void {
  const sock = getSocket();
  sock.on('agent_message', callback);
  return () => sock.off('agent_message', callback);
}

/**
 * Get the current socket connection state.
 */
export function isConnected(): boolean {
  return socket?.connected ?? false;
}

/**
 * Manually reconnect the socket.
 */
export function reconnect(): void {
  socket?.connect();
}

/**
 * Disconnect and clean up all resources.
 */
export function disconnect(): void {
  // Clean up all documents and awareness
  docCache.forEach((_, key) => {
    const [sessionId, docName] = key.split(':');
    if (sessionId && docName) {
      destroyYDoc(sessionId, docName);
    }
  });

  // Disconnect socket
  socket?.disconnect();
  socket = null;
}
