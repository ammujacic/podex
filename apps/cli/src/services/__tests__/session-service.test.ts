/**
 * Tests for session service.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock api-client
const mockGet = vi.fn();
const mockPost = vi.fn();
const mockDelete = vi.fn();

vi.mock('../api-client', () => ({
  getApiClient: vi.fn(() => ({
    get: mockGet,
    post: mockPost,
    delete: mockDelete,
  })),
}));

// Mock socket-service
const mockJoinSession = vi.fn();
const mockLeaveSession = vi.fn();
const mockEmitApprovalResponse = vi.fn();

vi.mock('../socket-service', () => ({
  getSocketClient: vi.fn(() => ({
    joinSession: mockJoinSession,
    leaveSession: mockLeaveSession,
    emitApprovalResponse: mockEmitApprovalResponse,
  })),
}));

// Mock auth-provider
const mockGetCredentials = vi.fn();

vi.mock('../../adapters/auth-provider', () => ({
  getCliAuthProvider: vi.fn(() => ({
    getCredentials: mockGetCredentials,
  })),
}));

describe('SessionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCredentials.mockReturnValue({
      userId: 'test-user',
      accessToken: 'test-token',
    });
  });

  describe('SessionService class', () => {
    it('should list sessions', async () => {
      mockGet.mockResolvedValue({
        sessions: [{ id: 'session-1', name: 'Test Session', status: 'active' }],
        total: 1,
      });

      const { SessionService } = await import('../session-service');
      const service = new SessionService();

      const result = await service.listSessions();

      expect(result.sessions).toHaveLength(1);
      expect(result.sessions[0].id).toBe('session-1');
      expect(mockGet).toHaveBeenCalledWith('/api/v1/sessions?limit=20&offset=0');
    });

    it('should list sessions with custom pagination', async () => {
      mockGet.mockResolvedValue({ sessions: [], total: 0 });

      const { SessionService } = await import('../session-service');
      const service = new SessionService();

      await service.listSessions(50, 10);

      expect(mockGet).toHaveBeenCalledWith('/api/v1/sessions?limit=50&offset=10');
    });

    it('should create a session', async () => {
      mockPost.mockResolvedValue({
        id: 'new-session',
        name: 'New Session',
        status: 'active',
      });

      const { SessionService } = await import('../session-service');
      const service = new SessionService();

      const result = await service.createSession({ name: 'New Session' });

      expect(result.id).toBe('new-session');
      expect(mockPost).toHaveBeenCalledWith('/api/v1/sessions', { name: 'New Session' });
    });

    it('should get session details', async () => {
      mockGet.mockResolvedValue({
        id: 'session-1',
        name: 'Test Session',
        status: 'active',
      });

      const { SessionService } = await import('../session-service');
      const service = new SessionService();

      const result = await service.getSession('session-1');

      expect(result.id).toBe('session-1');
      expect(mockGet).toHaveBeenCalledWith('/api/v1/sessions/session-1');
    });

    it('should delete a session', async () => {
      mockDelete.mockResolvedValue(undefined);

      const { SessionService } = await import('../session-service');
      const service = new SessionService();

      await expect(service.deleteSession('session-1')).resolves.not.toThrow();
      expect(mockDelete).toHaveBeenCalledWith('/api/v1/sessions/session-1');
    });

    it('should get agents for a session', async () => {
      mockGet.mockResolvedValue([{ id: 'agent-1', name: 'Coder', role: 'coder', status: 'idle' }]);

      const { SessionService } = await import('../session-service');
      const service = new SessionService();

      const result = await service.getAgents('session-1');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('agent-1');
      expect(mockGet).toHaveBeenCalledWith('/api/v1/sessions/session-1/agents');
    });

    it('should get messages for an agent', async () => {
      mockGet.mockResolvedValue([{ id: 'msg-1', role: 'user', content: 'Hello' }]);

      const { SessionService } = await import('../session-service');
      const service = new SessionService();

      const result = await service.getMessages('session-1', 'agent-1');

      expect(result).toHaveLength(1);
      expect(result[0].content).toBe('Hello');
      expect(mockGet).toHaveBeenCalledWith('/api/v1/sessions/session-1/agents/agent-1/messages');
    });

    it('should send a message', async () => {
      mockPost.mockResolvedValue(undefined);

      const { SessionService } = await import('../session-service');
      const service = new SessionService();

      await service.sendMessage('session-1', 'agent-1', 'Test message');

      expect(mockPost).toHaveBeenCalledWith('/api/v1/sessions/session-1/agents/agent-1/messages', {
        content: 'Test message',
      });
    });

    it('should abort an agent', async () => {
      mockPost.mockResolvedValue(undefined);

      const { SessionService } = await import('../session-service');
      const service = new SessionService();

      await service.abortAgent('session-1', 'agent-1');

      expect(mockPost).toHaveBeenCalledWith('/api/v1/sessions/session-1/agents/agent-1/abort', {});
    });

    it('should join a session via socket', async () => {
      const { SessionService } = await import('../session-service');
      const service = new SessionService();

      service.joinSession('session-1');

      expect(mockJoinSession).toHaveBeenCalledWith('session-1', 'test-user', 'test-token');
    });

    it('should throw when joining session without authentication', async () => {
      mockGetCredentials.mockReturnValue(null);

      const { SessionService } = await import('../session-service');
      const service = new SessionService();

      expect(() => service.joinSession('session-1')).toThrow('Not authenticated');
    });

    it('should leave a session via socket', async () => {
      const { SessionService } = await import('../session-service');
      const service = new SessionService();

      service.leaveSession('session-1');

      expect(mockLeaveSession).toHaveBeenCalledWith('session-1', 'test-user');
    });

    it('should silently return when leaving session without authentication', async () => {
      mockGetCredentials.mockReturnValue(null);

      const { SessionService } = await import('../session-service');
      const service = new SessionService();

      // Should not throw
      expect(() => service.leaveSession('session-1')).not.toThrow();
      expect(mockLeaveSession).not.toHaveBeenCalled();
    });

    it('should respond to approval request', async () => {
      const { SessionService } = await import('../session-service');
      const service = new SessionService();

      service.respondToApproval('session-1', 'agent-1', 'approval-1', true, false);

      expect(mockEmitApprovalResponse).toHaveBeenCalledWith(
        'session-1',
        'agent-1',
        'approval-1',
        true,
        false
      );
    });
  });

  describe('getSessionService singleton', () => {
    it('should return the same instance', async () => {
      const { getSessionService } = await import('../session-service');

      const service1 = getSessionService();
      const service2 = getSessionService();

      expect(service1).toBe(service2);
    });
  });
});
