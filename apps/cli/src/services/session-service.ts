/**
 * Session management service for CLI.
 */

import { getApiClient } from './api-client';
import { getSocketClient } from './socket-service';
import { getCliAuthProvider } from '../adapters/auth-provider';
import type { Session, AgentInstance, Message } from '@podex/shared';

/**
 * Session list response.
 */
export interface SessionListResponse {
  sessions: Session[];
  total: number;
}

/**
 * Create session request.
 */
export interface CreateSessionRequest {
  name?: string;
  git_url?: string;
  branch?: string;
  local?: boolean;
  pod_id?: string;
}

/**
 * Session service for managing development sessions.
 */
export class SessionService {
  /**
   * List all sessions for the current user.
   */
  async listSessions(limit = 20, offset = 0): Promise<SessionListResponse> {
    const client = getApiClient();
    return client.get<SessionListResponse>(`/api/v1/sessions?limit=${limit}&offset=${offset}`);
  }

  /**
   * Get a specific session by ID.
   */
  async getSession(sessionId: string): Promise<Session> {
    const client = getApiClient();
    return client.get<Session>(`/api/v1/sessions/${sessionId}`);
  }

  /**
   * Create a new session.
   */
  async createSession(request: CreateSessionRequest = {}): Promise<Session> {
    const client = getApiClient();
    return client.post<Session>('/api/v1/sessions', request);
  }

  /**
   * Delete a session.
   */
  async deleteSession(sessionId: string): Promise<void> {
    const client = getApiClient();
    await client.delete(`/api/v1/sessions/${sessionId}`);
  }

  /**
   * Get agents for a session.
   */
  async getAgents(sessionId: string): Promise<AgentInstance[]> {
    const client = getApiClient();
    return client.get<AgentInstance[]>(`/api/v1/sessions/${sessionId}/agents`);
  }

  /**
   * Get messages for an agent in a session.
   */
  async getMessages(sessionId: string, agentId: string): Promise<Message[]> {
    const client = getApiClient();
    return client.get<Message[]>(`/api/v1/sessions/${sessionId}/agents/${agentId}/messages`);
  }

  /**
   * Join a session via WebSocket.
   */
  joinSession(sessionId: string): void {
    const authProvider = getCliAuthProvider();
    const credentials = authProvider.getCredentials();

    if (!credentials?.userId) {
      throw new Error('Not authenticated');
    }

    const socketClient = getSocketClient();
    socketClient.joinSession(sessionId, credentials.userId, credentials.accessToken);
  }

  /**
   * Leave a session via WebSocket.
   */
  leaveSession(sessionId: string): void {
    const authProvider = getCliAuthProvider();
    const credentials = authProvider.getCredentials();

    if (!credentials?.userId) {
      return;
    }

    const socketClient = getSocketClient();
    socketClient.leaveSession(sessionId, credentials.userId);
  }

  /**
   * Send a message to an agent.
   */
  async sendMessage(sessionId: string, agentId: string, content: string): Promise<void> {
    const client = getApiClient();
    await client.post(`/api/v1/sessions/${sessionId}/agents/${agentId}/messages`, {
      content,
    });
  }

  /**
   * Abort an agent's current task.
   */
  async abortAgent(sessionId: string, agentId: string): Promise<void> {
    const client = getApiClient();
    await client.post(`/api/v1/sessions/${sessionId}/agents/${agentId}/abort`, {});
  }

  /**
   * Respond to an approval request.
   */
  respondToApproval(
    sessionId: string,
    agentId: string,
    approvalId: string,
    approved: boolean,
    addToAllowlist = false
  ): void {
    const socketClient = getSocketClient();
    socketClient.emitApprovalResponse(sessionId, agentId, approvalId, approved, addToAllowlist);
  }
}

// Singleton instance
let sessionServiceInstance: SessionService | null = null;

/**
 * Get the singleton session service instance.
 */
export function getSessionService(): SessionService {
  if (!sessionServiceInstance) {
    sessionServiceInstance = new SessionService();
  }
  return sessionServiceInstance;
}
