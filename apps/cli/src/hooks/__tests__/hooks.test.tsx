/**
 * Tests for hooks.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { Text } from 'ink';

// Mock the services
vi.mock('../../services/session-service', () => ({
  getSessionService: () => ({
    getSession: vi.fn(() => Promise.resolve({ id: 'test-session', name: 'Test' })),
    getAgents: vi.fn(() => Promise.resolve([{ id: 'agent-1', name: 'Agent 1' }])),
    getMessages: vi.fn(() => Promise.resolve([])),
    createSession: vi.fn(() => Promise.resolve({ id: 'new-session', name: 'New' })),
    joinSession: vi.fn(),
    sendMessage: vi.fn(),
  }),
}));

vi.mock('../../adapters/auth-provider', () => ({
  getCliAuthProvider: () => ({
    isAuthenticated: vi.fn(() => true),
  }),
}));

vi.mock('../../services/socket-service', () => ({
  getSocketClient: () => ({
    onConnectionStateChange: vi.fn(() => () => {}),
    on: vi.fn(() => () => {}),
    joinSession: vi.fn(),
    emitApprovalResponse: vi.fn(),
  }),
  connectSocket: vi.fn(),
  disconnectSocket: vi.fn(),
  isSocketConnected: vi.fn(() => false),
}));

vi.mock('@podex/local-pod-discovery', () => ({
  discoverLocalPod: vi.fn(() =>
    Promise.resolve({ url: 'http://localhost:3000', name: 'Local Pod' })
  ),
  waitForLocalPod: vi.fn(() =>
    Promise.resolve({ url: 'http://localhost:3000', name: 'Local Pod' })
  ),
}));

// Import hooks after mocking
import { useSession } from '../useSession';
import { useSocket } from '../useSocket';
import { useLocalPod } from '../useLocalPod';

describe('Hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('useSession', () => {
    function SessionTest({
      sessionId,
      autoCreate,
      local,
    }: {
      sessionId?: string;
      autoCreate?: boolean;
      local?: boolean;
    }) {
      const { session, agents, isLoading, error, currentAgentId } = useSession({
        sessionId,
        autoCreate,
        local,
      });

      return (
        <Text>
          Session:{session?.id ?? 'none'}| Agents:{agents.length}| Loading:
          {isLoading ? 'yes' : 'no'}| Error:{error ?? 'none'}| Agent:{currentAgentId ?? 'none'}
        </Text>
      );
    }

    it('should initialize with default state', () => {
      const { lastFrame } = render(<SessionTest />);

      expect(lastFrame()).toContain('Session:none');
      expect(lastFrame()).toContain('Loading:no');
    });

    it('should accept sessionId option', () => {
      const { lastFrame } = render(<SessionTest sessionId="test-123" />);

      expect(lastFrame()).toBeDefined();
    });

    it('should accept autoCreate option', () => {
      const { lastFrame } = render(<SessionTest autoCreate />);

      expect(lastFrame()).toBeDefined();
    });

    it('should accept local option', () => {
      const { lastFrame } = render(<SessionTest local />);

      expect(lastFrame()).toBeDefined();
    });
  });

  describe('useSocket', () => {
    function SocketTest({
      sessionId,
      userId,
      autoConnect,
    }: {
      sessionId?: string;
      userId?: string;
      autoConnect?: boolean;
    }) {
      const { isConnected, streamingContent, pendingApproval, connect, disconnect } = useSocket({
        sessionId,
        userId,
        autoConnect,
      });

      return (
        <Text>
          Connected:{isConnected ? 'yes' : 'no'}| Streaming:{streamingContent || 'none'}| Approval:
          {pendingApproval ? 'pending' : 'none'}
        </Text>
      );
    }

    it('should initialize with default state', () => {
      const { lastFrame } = render(<SocketTest />);

      expect(lastFrame()).toContain('Connected:no');
      expect(lastFrame()).toContain('Streaming:none');
    });

    it('should accept sessionId option', () => {
      const { lastFrame } = render(<SocketTest sessionId="test-session" userId="user-1" />);

      expect(lastFrame()).toBeDefined();
    });

    it('should accept autoConnect option', () => {
      const { lastFrame } = render(<SocketTest autoConnect={false} />);

      expect(lastFrame()).toContain('Connected:no');
    });

    it('should render without approval', () => {
      const { lastFrame } = render(<SocketTest />);

      expect(lastFrame()).toContain('Approval:none');
    });
  });

  describe('useLocalPod', () => {
    function LocalPodTest({
      autoDiscover,
      pollInterval,
    }: {
      autoDiscover?: boolean;
      pollInterval?: number;
    }) {
      const { localPod, isDiscovering, error, discover, waitForPod } = useLocalPod({
        autoDiscover,
        pollInterval,
      });

      return (
        <Text>
          Pod:{localPod?.name ?? 'none'}| Discovering:{isDiscovering ? 'yes' : 'no'}| Error:
          {error ?? 'none'}
        </Text>
      );
    }

    it('should initialize with default state', () => {
      const { lastFrame } = render(<LocalPodTest autoDiscover={false} />);

      expect(lastFrame()).toContain('Pod:none');
      expect(lastFrame()).toContain('Discovering:no');
    });

    it('should auto-discover when enabled', () => {
      const { lastFrame } = render(<LocalPodTest autoDiscover />);

      expect(lastFrame()).toBeDefined();
    });

    it('should accept pollInterval option', () => {
      const { lastFrame } = render(<LocalPodTest autoDiscover={false} pollInterval={10000} />);

      expect(lastFrame()).toContain('Pod:none');
    });

    it('should show no error initially', () => {
      const { lastFrame } = render(<LocalPodTest autoDiscover={false} />);

      expect(lastFrame()).toContain('Error:none');
    });

    it('should return discover function', () => {
      let discoverFn: (() => Promise<void>) | undefined;
      function TestComponent() {
        const { discover } = useLocalPod({ autoDiscover: false });
        discoverFn = discover;
        return <Text>test</Text>;
      }

      render(<TestComponent />);
      expect(discoverFn).toBeDefined();
      expect(typeof discoverFn).toBe('function');
    });

    it('should return waitForPod function', () => {
      let waitFn: ((timeout?: number) => Promise<unknown>) | undefined;
      function TestComponent() {
        const { waitForPod } = useLocalPod({ autoDiscover: false });
        waitFn = waitForPod;
        return <Text>test</Text>;
      }

      render(<TestComponent />);
      expect(waitFn).toBeDefined();
      expect(typeof waitFn).toBe('function');
    });
  });

  describe('useSession functions', () => {
    it('should return sendMessage function', () => {
      let sendMessageFn: ((content: string) => Promise<void>) | undefined;
      function TestComponent() {
        const { sendMessage } = useSession();
        sendMessageFn = sendMessage;
        return <Text>test</Text>;
      }

      render(<TestComponent />);
      expect(sendMessageFn).toBeDefined();
      expect(typeof sendMessageFn).toBe('function');
    });

    it('should return selectAgent function', () => {
      let selectAgentFn: ((agentId: string) => void) | undefined;
      function TestComponent() {
        const { selectAgent } = useSession();
        selectAgentFn = selectAgent;
        return <Text>test</Text>;
      }

      render(<TestComponent />);
      expect(selectAgentFn).toBeDefined();
      expect(typeof selectAgentFn).toBe('function');
    });

    it('should return refreshMessages function', () => {
      let refreshFn: (() => Promise<void>) | undefined;
      function TestComponent() {
        const { refreshMessages } = useSession();
        refreshFn = refreshMessages;
        return <Text>test</Text>;
      }

      render(<TestComponent />);
      expect(refreshFn).toBeDefined();
      expect(typeof refreshFn).toBe('function');
    });

    it('should return createSession function', () => {
      let createFn: ((options?: { local?: boolean }) => Promise<void>) | undefined;
      function TestComponent() {
        const { createSession } = useSession();
        createFn = createSession;
        return <Text>test</Text>;
      }

      render(<TestComponent />);
      expect(createFn).toBeDefined();
      expect(typeof createFn).toBe('function');
    });

    it('should return loadSession function', () => {
      let loadFn: ((sessionId: string) => Promise<void>) | undefined;
      function TestComponent() {
        const { loadSession } = useSession();
        loadFn = loadSession;
        return <Text>test</Text>;
      }

      render(<TestComponent />);
      expect(loadFn).toBeDefined();
      expect(typeof loadFn).toBe('function');
    });
  });

  describe('useSocket functions', () => {
    it('should return connect function', () => {
      let connectFn: (() => void) | undefined;
      function TestComponent() {
        const { connect } = useSocket({ autoConnect: false });
        connectFn = connect;
        return <Text>test</Text>;
      }

      render(<TestComponent />);
      expect(connectFn).toBeDefined();
      expect(typeof connectFn).toBe('function');
    });

    it('should return disconnect function', () => {
      let disconnectFn: (() => void) | undefined;
      function TestComponent() {
        const { disconnect } = useSocket({ autoConnect: false });
        disconnectFn = disconnect;
        return <Text>test</Text>;
      }

      render(<TestComponent />);
      expect(disconnectFn).toBeDefined();
      expect(typeof disconnectFn).toBe('function');
    });

    it('should return respondToApproval function', () => {
      let respondFn: ((approved: boolean, addToAllowlist: boolean) => void) | undefined;
      function TestComponent() {
        const { respondToApproval } = useSocket({ autoConnect: false });
        respondFn = respondToApproval;
        return <Text>test</Text>;
      }

      render(<TestComponent />);
      expect(respondFn).toBeDefined();
      expect(typeof respondFn).toBe('function');
    });

    it('should return connectionState', () => {
      let state: unknown;
      function TestComponent() {
        const { connectionState } = useSocket({ autoConnect: false });
        state = connectionState;
        return <Text>state:{connectionState ? 'exists' : 'null'}</Text>;
      }

      const { lastFrame } = render(<TestComponent />);
      expect(lastFrame()).toContain('state:null');
    });
  });
});
