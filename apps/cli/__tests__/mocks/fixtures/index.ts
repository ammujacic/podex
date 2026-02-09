/**
 * Test fixtures.
 */

export const mockUser = {
  id: 'test-user-id',
  email: 'test@example.com',
  name: 'Test User',
};

export const mockSession = {
  id: 'test-session-id',
  name: 'Test Session',
  ownerId: 'test-user-id',
  workspaceId: 'workspace-123',
  branch: 'main',
  status: 'active' as const,
  collaborators: [],
  agents: [],
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

export const mockAgent = {
  id: 'test-agent-id',
  sessionId: 'test-session-id',
  name: 'Coder',
  role: 'coder' as const,
  model: 'claude-sonnet',
  status: 'idle' as const,
  color: 'cyan' as const,
  tools: [],
  createdAt: new Date('2024-01-01'),
};

export const mockMessage = {
  id: 'test-message-id',
  agentId: 'test-agent-id',
  role: 'user' as const,
  content: 'Hello, world!',
  timestamp: new Date('2024-01-01'),
};

export const mockCredentials = {
  accessToken: 'test-access-token',
  refreshToken: 'test-refresh-token',
  expiresAt: Date.now() + 3600000,
  userId: 'test-user-id',
  email: 'test@example.com',
};

export const mockDeviceCode = {
  device_code: 'test-device-code',
  user_code: 'TEST-1234',
  verification_uri: 'http://localhost:3000/device',
  verification_uri_complete: 'http://localhost:3000/device?code=TEST-1234',
  expires_in: 900,
  interval: 5,
};
