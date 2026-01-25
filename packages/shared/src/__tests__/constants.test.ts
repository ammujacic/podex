import { describe, it, expect } from 'vitest';
import {
  SUPPORTED_IMAGE_TYPES,
  MAX_ATTACHMENT_SIZE_MB,
  API_ENDPOINTS,
  WS_EVENTS,
} from '../constants';

describe('Constants', () => {
  describe('Image Constants', () => {
    it('should define supported image types', () => {
      expect(SUPPORTED_IMAGE_TYPES).toEqual(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
    });

    it('should define max attachment size', () => {
      expect(MAX_ATTACHMENT_SIZE_MB).toBe(20);
    });
  });

  describe('API_ENDPOINTS', () => {
    it('should have auth endpoints', () => {
      expect(API_ENDPOINTS.auth.login).toBe('/api/auth/login');
      expect(API_ENDPOINTS.auth.logout).toBe('/api/auth/logout');
      expect(API_ENDPOINTS.auth.refresh).toBe('/api/auth/refresh');
      expect(API_ENDPOINTS.auth.me).toBe('/api/auth/me');
    });

    it('should have sessions endpoints', () => {
      expect(API_ENDPOINTS.sessions.list).toBe('/api/sessions');
      expect(API_ENDPOINTS.sessions.create).toBe('/api/sessions');
      expect(API_ENDPOINTS.sessions.get('123')).toBe('/api/sessions/123');
      expect(API_ENDPOINTS.sessions.delete('456')).toBe('/api/sessions/456');
    });

    it('should have agents endpoints', () => {
      expect(API_ENDPOINTS.agents.list('session-1')).toBe('/api/sessions/session-1/agents');
      expect(API_ENDPOINTS.agents.create('session-1')).toBe('/api/sessions/session-1/agents');
      expect(API_ENDPOINTS.agents.get('session-1', 'agent-1')).toBe(
        '/api/sessions/session-1/agents/agent-1'
      );
      expect(API_ENDPOINTS.agents.message('session-1', 'agent-1')).toBe(
        '/api/sessions/session-1/agents/agent-1/messages'
      );
    });

    it('should have workspaces endpoints', () => {
      expect(API_ENDPOINTS.workspaces.get('ws-1')).toBe('/api/workspaces/ws-1');
      expect(API_ENDPOINTS.workspaces.files('ws-1')).toBe('/api/workspaces/ws-1/files');
      expect(API_ENDPOINTS.workspaces.terminal('ws-1')).toBe('/api/workspaces/ws-1/terminal');
    });
  });

  describe('WS_EVENTS', () => {
    it('should have connection events', () => {
      expect(WS_EVENTS.CONNECT).toBe('connect');
      expect(WS_EVENTS.DISCONNECT).toBe('disconnect');
      expect(WS_EVENTS.ERROR).toBe('error');
    });

    it('should have session events', () => {
      expect(WS_EVENTS.SESSION_JOIN).toBe('session:join');
      expect(WS_EVENTS.SESSION_LEAVE).toBe('session:leave');
      expect(WS_EVENTS.SESSION_UPDATE).toBe('session:update');
    });

    it('should have collaboration events', () => {
      expect(WS_EVENTS.CURSOR_UPDATE).toBe('cursor:update');
      expect(WS_EVENTS.SELECTION_UPDATE).toBe('selection:update');
    });

    it('should have file events', () => {
      expect(WS_EVENTS.FILE_CHANGE).toBe('file:change');
      expect(WS_EVENTS.FILE_SYNC).toBe('file:sync');
    });

    it('should have agent events', () => {
      expect(WS_EVENTS.AGENT_MESSAGE).toBe('agent:message');
      expect(WS_EVENTS.AGENT_STATUS).toBe('agent:status');
      expect(WS_EVENTS.AGENT_TOOL_CALL).toBe('agent:tool_call');
    });

    it('should have terminal events', () => {
      expect(WS_EVENTS.TERMINAL_DATA).toBe('terminal:data');
      expect(WS_EVENTS.TERMINAL_INPUT).toBe('terminal:input');
      expect(WS_EVENTS.TERMINAL_RESIZE).toBe('terminal:resize');
    });
  });
});
