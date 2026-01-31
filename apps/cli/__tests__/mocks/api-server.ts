/**
 * Mock API server for CLI testing.
 */

import Fastify, { type FastifyInstance } from 'fastify';

export interface MockUser {
  id: string;
  email: string;
  name: string;
}

export interface MockSession {
  id: string;
  name: string;
  status: string;
  branch: string;
  created_at: string;
}

export interface MockApiState {
  users: Map<string, MockUser>;
  sessions: Map<string, MockSession>;
  deviceCodes: Map<string, { completed: boolean; userId?: string }>;
  tokens: Map<string, { userId: string; expiresAt: number }>;
}

export interface MockApiServer {
  server: FastifyInstance;
  state: MockApiState;
  start: () => Promise<string>;
  stop: () => Promise<void>;
  reset: () => void;
  completeDeviceAuth: (deviceCode: string, userId: string) => void;
}

export function createMockApiServer(): MockApiServer {
  const server = Fastify({ logger: false });

  const state: MockApiState = {
    users: new Map(),
    sessions: new Map(),
    deviceCodes: new Map(),
    tokens: new Map(),
  };

  // Add default test user
  state.users.set('test-user', {
    id: 'test-user',
    email: 'test@example.com',
    name: 'Test User',
  });

  // Health check
  server.get('/health', async () => ({ status: 'ok' }));

  // Device auth - initiate
  server.post('/api/v1/auth/device/code', async () => {
    const deviceCode = `device-${Date.now()}`;
    state.deviceCodes.set(deviceCode, { completed: false });

    return {
      device_code: deviceCode,
      user_code: 'TEST-1234',
      verification_uri: 'http://localhost:3000/device',
      verification_uri_complete: 'http://localhost:3000/device?code=TEST-1234',
      expires_in: 900,
      interval: 1,
    };
  });

  // Device auth - token
  server.post('/api/v1/auth/device/token', async (req) => {
    const body = req.body as { device_code: string };
    const flow = state.deviceCodes.get(body.device_code);

    if (!flow) {
      return { error: 'invalid_device_code' };
    }

    if (!flow.completed) {
      return { error: 'authorization_pending' };
    }

    const token = `token-${Date.now()}`;
    state.tokens.set(token, {
      userId: flow.userId || 'test-user',
      expiresAt: Date.now() + 3600000,
    });

    return {
      access_token: token,
      refresh_token: `refresh-${token}`,
      token_type: 'bearer',
      expires_in: 3600,
    };
  });

  // Token refresh
  server.post('/api/v1/auth/refresh', async (req) => {
    const body = req.body as { refresh_token: string };
    const token = `token-${Date.now()}`;

    return {
      access_token: token,
      refresh_token: body.refresh_token,
      token_type: 'bearer',
      expires_in: 3600,
    };
  });

  // Logout
  server.post('/api/v1/auth/logout', async () => {
    return { success: true };
  });

  // Get current user
  server.get('/api/v1/users/me', async (req) => {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) {
      throw { statusCode: 401, message: 'Unauthorized' };
    }

    const token = auth.slice(7);
    const tokenData = state.tokens.get(token);

    if (!tokenData || Date.now() > tokenData.expiresAt) {
      throw { statusCode: 401, message: 'Unauthorized' };
    }

    const user = state.users.get(tokenData.userId);
    if (!user) {
      throw { statusCode: 404, message: 'User not found' };
    }

    return user;
  });

  // Sessions
  server.get('/api/v1/sessions', async () => {
    return {
      sessions: Array.from(state.sessions.values()),
      total: state.sessions.size,
    };
  });

  server.post('/api/v1/sessions', async (req) => {
    const body = req.body as { name?: string; local?: boolean };
    const session: MockSession = {
      id: `session-${Date.now()}`,
      name: body.name || 'New Session',
      status: 'active',
      branch: 'main',
      created_at: new Date().toISOString(),
    };
    state.sessions.set(session.id, session);
    return session;
  });

  server.get('/api/v1/sessions/:id', async (req) => {
    const params = req.params as { id: string };
    const session = state.sessions.get(params.id);
    if (!session) {
      throw { statusCode: 404, message: 'Session not found' };
    }
    return session;
  });

  server.delete('/api/v1/sessions/:id', async (req) => {
    const params = req.params as { id: string };
    state.sessions.delete(params.id);
    return { success: true };
  });

  // Agents
  server.get('/api/v1/sessions/:id/agents', async () => {
    return [
      {
        id: 'agent-1',
        name: 'Coder',
        role: 'coder',
        status: 'idle',
        model: 'claude-sonnet',
      },
    ];
  });

  // Messages
  server.get('/api/v1/sessions/:sessionId/agents/:agentId/messages', async () => {
    return [];
  });

  server.post('/api/v1/sessions/:sessionId/agents/:agentId/messages', async () => {
    return { success: true };
  });

  const start = async (): Promise<string> => {
    const address = await server.listen({ port: 0, host: '127.0.0.1' });
    return address;
  };

  const stop = async (): Promise<void> => {
    await server.close();
  };

  const reset = (): void => {
    state.sessions.clear();
    state.deviceCodes.clear();
    state.tokens.clear();
  };

  const completeDeviceAuth = (deviceCode: string, userId: string): void => {
    const flow = state.deviceCodes.get(deviceCode);
    if (flow) {
      flow.completed = true;
      flow.userId = userId;
    }
  };

  return { server, state, start, stop, reset, completeDeviceAuth };
}
