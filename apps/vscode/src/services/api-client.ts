/**
 * API client service for VSCode extension.
 * Wraps @podex/api-client with VSCode-specific adapters.
 */

import * as vscode from 'vscode';
import { BaseApiClient } from '@podex/api-client';
import { createNodeHttpAdapter, getAuthProvider } from '../adapters';
import { DEFAULT_API_URL } from '../utils/constants';
import { logDebug } from '../utils/logger';

let apiClientInstance: BaseApiClient | null = null;

/**
 * Get the API URL from VSCode settings.
 */
function getApiUrl(): string {
  const config = vscode.workspace.getConfiguration('podex');
  return config.get<string>('apiUrl', DEFAULT_API_URL);
}

/**
 * Initialize the API client singleton.
 */
export function initializeApiClient(): BaseApiClient {
  if (!apiClientInstance) {
    const apiUrl = getApiUrl();
    logDebug(`Initializing API client with URL: ${apiUrl}`);

    apiClientInstance = new BaseApiClient({
      baseUrl: apiUrl,
      httpAdapter: createNodeHttpAdapter(),
      authProvider: getAuthProvider(),
    });
  }
  return apiClientInstance;
}

/**
 * Get the API client singleton.
 */
export function getApiClient(): BaseApiClient {
  if (!apiClientInstance) {
    return initializeApiClient();
  }
  return apiClientInstance;
}

/**
 * Update the API client base URL (e.g., when settings change).
 */
export function updateApiClientUrl(): void {
  const newUrl = getApiUrl();
  if (apiClientInstance) {
    logDebug(`Updating API client URL to: ${newUrl}`);
    apiClientInstance.setBaseUrl(newUrl);
  }
}

/**
 * Session API types (matching backend response).
 */
export interface SessionResponse {
  id: string;
  name: string;
  owner_id: string;
  workspace_id: string;
  branch: string;
  status: 'active' | 'paused' | 'terminated';
  created_at: string;
  updated_at: string;
}

export interface SessionListResponse {
  sessions: SessionResponse[];
  total: number;
  page: number;
  page_size: number;
}

export interface AgentResponse {
  id: string;
  session_id: string;
  name: string;
  role: string;
  model: string;
  status: 'idle' | 'thinking' | 'executing' | 'waiting' | 'error';
  color: string;
  created_at: string;
}

/**
 * Session API methods.
 */
export const sessionApi = {
  /**
   * List all sessions for the current user.
   */
  async listSessions(page = 1, pageSize = 20): Promise<SessionListResponse> {
    const client = getApiClient();
    return client.get<SessionListResponse>(`/api/v1/sessions?page=${page}&page_size=${pageSize}`);
  },

  /**
   * Get a specific session by ID.
   */
  async getSession(sessionId: string): Promise<SessionResponse> {
    const client = getApiClient();
    return client.get<SessionResponse>(`/api/v1/sessions/${sessionId}`);
  },

  /**
   * Create a new session.
   */
  async createSession(data: {
    name: string;
    git_url?: string;
    branch?: string;
  }): Promise<SessionResponse> {
    const client = getApiClient();
    return client.post<SessionResponse>('/api/v1/sessions', data);
  },

  /**
   * Delete a session.
   */
  async deleteSession(sessionId: string): Promise<void> {
    const client = getApiClient();
    await client.delete(`/api/v1/sessions/${sessionId}`);
  },

  /**
   * Get agents for a session.
   */
  async getAgents(sessionId: string): Promise<AgentResponse[]> {
    const client = getApiClient();
    return client.get<AgentResponse[]>(`/api/v1/sessions/${sessionId}/agents`);
  },
};
