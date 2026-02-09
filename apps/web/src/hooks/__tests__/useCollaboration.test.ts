/**
 * Comprehensive tests for collaboration hooks
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

// Mock dependencies
vi.mock('@/lib/collaboration', () => ({
  joinSession: vi.fn(),
  leaveSession: vi.fn(),
  destroyYDoc: vi.fn(),
  setUserInfo: vi.fn(),
  getCollaborators: vi.fn(),
  getFileContent: vi.fn(),
  initFileContent: vi.fn(),
  getAgentMessages: vi.fn(),
  addAgentMessage: vi.fn(),
  onUserJoined: vi.fn(),
  onUserLeft: vi.fn(),
  onAgentStatusUpdate: vi.fn(),
  onAgentTyping: vi.fn(),
  broadcastAgentTyping: vi.fn(),
}));

// Mock Yjs
vi.mock('yjs', async () => {
  const { MockYDoc, MockYText, MockYArray, MockYMap } =
    await import('@/__tests__/mocks/collaboration');

  return {
    default: {
      Doc: MockYDoc,
      Text: MockYText,
      Array: MockYArray,
      Map: MockYMap,
    },
    Doc: MockYDoc,
    Text: MockYText,
    Array: MockYArray,
    Map: MockYMap,
  };
});

// Mock auth store
const mockUser = {
  id: 'user-123',
  email: 'test@example.com',
  name: 'Test User',
  avatarUrl: null,
  role: 'user',
};

vi.mock('@/stores/auth', () => ({
  useUser: () => mockUser,
}));

// Import after mocks
import {
  useSession,
  useCollaborativeFile,
  useCollaborativeAgent,
  useOnlineUsers,
} from '../useCollaboration';
import { MockYText, MockYArray, MockYMap } from '@/__tests__/mocks/collaboration';
import * as collaborationLib from '@/lib/collaboration';

// Get mocked functions
const mockJoinSession = vi.mocked(collaborationLib.joinSession);
const mockLeaveSession = vi.mocked(collaborationLib.leaveSession);
const mockDestroyYDoc = vi.mocked(collaborationLib.destroyYDoc);
const mockSetUserInfo = vi.mocked(collaborationLib.setUserInfo);
const mockGetCollaborators = vi.mocked(collaborationLib.getCollaborators);
const mockGetFileContent = vi.mocked(collaborationLib.getFileContent);
const mockInitFileContent = vi.mocked(collaborationLib.initFileContent);
const mockGetAgentMessages = vi.mocked(collaborationLib.getAgentMessages);
const mockAddAgentMessage = vi.mocked(collaborationLib.addAgentMessage);
const mockOnUserJoined = vi.mocked(collaborationLib.onUserJoined);
const mockOnUserLeft = vi.mocked(collaborationLib.onUserLeft);
const mockOnAgentStatusUpdate = vi.mocked(collaborationLib.onAgentStatusUpdate);
const mockOnAgentTyping = vi.mocked(collaborationLib.onAgentTyping);
const mockBroadcastAgentTyping = vi.mocked(collaborationLib.broadcastAgentTyping);

describe('useSession', () => {
  let unsubJoinFn: () => void;
  let unsubLeaveFn: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    unsubJoinFn = vi.fn();
    unsubLeaveFn = vi.fn();

    mockOnUserJoined.mockReturnValue(unsubJoinFn);
    mockOnUserLeft.mockReturnValue(unsubLeaveFn);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ========================================================================
  // Session Initialization
  // ========================================================================

  describe('Session Initialization', () => {
    it('should join session on mount with valid sessionId', () => {
      renderHook(() => useSession('session-1'));

      expect(mockJoinSession).toHaveBeenCalledWith('session-1', 'user-123');
    });

    it('should not join session when sessionId is null', () => {
      renderHook(() => useSession(null));

      expect(mockJoinSession).not.toHaveBeenCalled();
    });

    it('should subscribe to user joined events', () => {
      renderHook(() => useSession('session-1'));

      expect(mockOnUserJoined).toHaveBeenCalledTimes(1);
      expect(typeof mockOnUserJoined.mock.calls[0]?.[0]).toBe('function');
    });

    it('should subscribe to user left events', () => {
      renderHook(() => useSession('session-1'));

      expect(mockOnUserLeft).toHaveBeenCalledTimes(1);
      expect(typeof mockOnUserLeft.mock.calls[0]?.[0]).toBe('function');
    });

    it('should generate a random user color', () => {
      const { result } = renderHook(() => useSession('session-1'));

      expect(result.current.userColor).toMatch(/^#[0-9a-f]{6}$/i);
    });

    it('should maintain same color across re-renders', () => {
      const { result, rerender } = renderHook(() => useSession('session-1'));

      const initialColor = result.current.userColor;

      rerender();

      expect(result.current.userColor).toBe(initialColor);
    });
  });

  // ========================================================================
  // Collaborator Management
  // ========================================================================

  describe('Collaborator Management', () => {
    it('should start with empty collaborators list', () => {
      const { result } = renderHook(() => useSession('session-1'));

      expect(result.current.collaborators).toEqual([]);
    });

    it('should add collaborator when user joins', () => {
      const { result } = renderHook(() => useSession('session-1'));

      const joinHandler = mockOnUserJoined.mock.calls[0]?.[0];

      act(() => {
        joinHandler({ session_id: 'session-1', user_id: 'user-456' });
      });

      expect(result.current.collaborators).toContain('user-456');
    });

    it('should not add collaborator from different session', () => {
      const { result } = renderHook(() => useSession('session-1'));

      const joinHandler = mockOnUserJoined.mock.calls[0]?.[0];

      act(() => {
        joinHandler({ session_id: 'session-2', user_id: 'user-456' });
      });

      expect(result.current.collaborators).not.toContain('user-456');
    });

    it('should remove collaborator when user leaves', () => {
      const { result } = renderHook(() => useSession('session-1'));

      const joinHandler = mockOnUserJoined.mock.calls[0]?.[0];
      const leaveHandler = mockOnUserLeft.mock.calls[0]?.[0];

      // Add user
      act(() => {
        joinHandler({ session_id: 'session-1', user_id: 'user-456' });
      });

      expect(result.current.collaborators).toContain('user-456');

      // Remove user
      act(() => {
        leaveHandler({ session_id: 'session-1', user_id: 'user-456' });
      });

      expect(result.current.collaborators).not.toContain('user-456');
    });

    it('should handle multiple collaborators', () => {
      const { result } = renderHook(() => useSession('session-1'));

      const joinHandler = mockOnUserJoined.mock.calls[0]?.[0];

      act(() => {
        joinHandler({ session_id: 'session-1', user_id: 'user-456' });
        joinHandler({ session_id: 'session-1', user_id: 'user-789' });
        joinHandler({ session_id: 'session-1', user_id: 'user-101' });
      });

      expect(result.current.collaborators).toHaveLength(3);
      expect(result.current.collaborators).toContain('user-456');
      expect(result.current.collaborators).toContain('user-789');
      expect(result.current.collaborators).toContain('user-101');
    });

    it('should prevent duplicate collaborators', () => {
      const { result } = renderHook(() => useSession('session-1'));

      const joinHandler = mockOnUserJoined.mock.calls[0]?.[0];

      act(() => {
        joinHandler({ session_id: 'session-1', user_id: 'user-456' });
        joinHandler({ session_id: 'session-1', user_id: 'user-456' });
      });

      expect(result.current.collaborators).toHaveLength(1);
    });
  });

  // ========================================================================
  // Cleanup
  // ========================================================================

  describe('Cleanup', () => {
    it('should leave session on unmount', () => {
      const { unmount } = renderHook(() => useSession('session-1'));

      unmount();

      expect(mockLeaveSession).toHaveBeenCalledWith('session-1', 'user-123');
    });

    it('should unsubscribe from events on unmount', () => {
      const { unmount } = renderHook(() => useSession('session-1'));

      unmount();

      expect(unsubJoinFn).toHaveBeenCalledTimes(1);
      expect(unsubLeaveFn).toHaveBeenCalledTimes(1);
    });

    it('should not cleanup when sessionId is null', () => {
      const { unmount } = renderHook(() => useSession(null));

      unmount();

      expect(mockLeaveSession).not.toHaveBeenCalled();
    });
  });
});

// ============================================================================
// useCollaborativeFile Tests
// ============================================================================

describe('useCollaborativeFile', () => {
  let mockYText: MockYText;

  beforeEach(() => {
    vi.clearAllMocks();
    mockYText = new MockYText();
    mockGetFileContent.mockReturnValue(mockYText);
    mockGetCollaborators.mockReturnValue([]);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  // ========================================================================
  // File Initialization
  // ========================================================================

  describe('File Initialization', () => {
    it('should get file content on mount', () => {
      renderHook(() => useCollaborativeFile('session-1', '/file.ts', 'initial content'));

      expect(mockGetFileContent).toHaveBeenCalledWith('session-1', '/file.ts');
    });

    it('should not get file content when sessionId is null', () => {
      renderHook(() => useCollaborativeFile(null, '/file.ts', 'initial content'));

      expect(mockGetFileContent).not.toHaveBeenCalled();
    });

    it('should not get file content when filePath is null', () => {
      renderHook(() => useCollaborativeFile('session-1', null, 'initial content'));

      expect(mockGetFileContent).not.toHaveBeenCalled();
    });

    it('should initialize content when yText is empty and initialContent is provided', () => {
      renderHook(() => useCollaborativeFile('session-1', '/file.ts', 'initial content'));

      expect(mockInitFileContent).toHaveBeenCalledWith('session-1', '/file.ts', 'initial content');
    });

    it('should not initialize content when yText already has content', () => {
      mockYText.insert(0, 'existing content');

      renderHook(() => useCollaborativeFile('session-1', '/file.ts', 'initial content'));

      expect(mockInitFileContent).not.toHaveBeenCalled();
    });

    it('should set user info with awareness', () => {
      renderHook(() => useCollaborativeFile('session-1', '/file.ts', 'initial content'));

      expect(mockSetUserInfo).toHaveBeenCalledWith('session-1', 'file:/file.ts', {
        id: 'user-123',
        name: 'Test User',
        color: expect.stringMatching(/^#[0-9a-f]{6}$/i),
      });
    });

    it('should update content from yText', () => {
      mockYText.insert(0, 'hello world');

      const { result } = renderHook(() =>
        useCollaborativeFile('session-1', '/file.ts', 'initial content')
      );

      expect(result.current.content).toBe('hello world');
    });
  });

  // ========================================================================
  // Real-time Updates
  // ========================================================================

  describe('Real-time Updates', () => {
    it('should observe yText changes', () => {
      const { result } = renderHook(() => useCollaborativeFile('session-1', '/file.ts', 'initial'));

      act(() => {
        mockYText.insert(0, 'new content');
      });

      expect(result.current.content).toBe('new content');
    });

    it('should update collaborators periodically', async () => {
      const collaborators = [
        { id: 'user-1', name: 'User 1', color: '#ff0000' },
        { id: 'user-2', name: 'User 2', color: '#00ff00' },
      ];

      mockGetCollaborators.mockReturnValue(collaborators);

      const { result } = renderHook(() => useCollaborativeFile('session-1', '/file.ts', 'initial'));

      // Fast-forward time to trigger update
      act(() => {
        vi.advanceTimersByTime(1000);
      });

      expect(result.current.collaborators).toEqual(collaborators);
    });

    it('should handle multiple yText updates', () => {
      const { result } = renderHook(() => useCollaborativeFile('session-1', '/file.ts', ''));

      act(() => {
        mockYText.insert(0, 'hello');
      });

      expect(result.current.content).toBe('hello');

      act(() => {
        mockYText.insert(5, ' world');
      });

      expect(result.current.content).toBe('hello world');
    });

    it('should provide access to yText reference', () => {
      const { result } = renderHook(() => useCollaborativeFile('session-1', '/file.ts', ''));

      expect(result.current.yText).toBe(mockYText);
    });
  });

  // ========================================================================
  // Content Updates
  // ========================================================================

  describe('Content Updates', () => {
    it('should update content through updateContent function', () => {
      const { result } = renderHook(() => useCollaborativeFile('session-1', '/file.ts', ''));

      act(() => {
        result.current.updateContent('new content');
      });

      expect(mockYText.toString()).toBe('new content');
    });

    it('should not update if content is the same', () => {
      mockYText.insert(0, 'same content');

      const { result } = renderHook(() => useCollaborativeFile('session-1', '/file.ts', ''));

      const deleteSpy = vi.spyOn(mockYText, 'delete');

      act(() => {
        result.current.updateContent('same content');
      });

      expect(deleteSpy).not.toHaveBeenCalled();
    });

    it('should update cursor position in awareness', () => {
      const { result } = renderHook(() => useCollaborativeFile('session-1', '/file.ts', ''));

      act(() => {
        result.current.updateContent('new content', { line: 5, column: 10 });
      });

      expect(mockSetUserInfo).toHaveBeenCalledWith('session-1', 'file:/file.ts', {
        id: 'user-123',
        name: 'Test User',
        color: expect.any(String),
        cursor: { line: 5, column: 10 },
      });
    });

    it('should handle updateContent with null sessionId', () => {
      const { result, rerender } = renderHook(
        ({ sessionId }) => useCollaborativeFile(sessionId, '/file.ts', ''),
        { initialProps: { sessionId: 'session-1' } }
      );

      rerender({ sessionId: null });

      expect(() => {
        result.current.updateContent('new content');
      }).not.toThrow();
    });

    it('should replace entire content on update', () => {
      mockYText.insert(0, 'old content');

      const { result } = renderHook(() => useCollaborativeFile('session-1', '/file.ts', ''));

      act(() => {
        result.current.updateContent('completely new');
      });

      expect(mockYText.toString()).toBe('completely new');
    });
  });

  // ========================================================================
  // Cleanup
  // ========================================================================

  describe('Cleanup', () => {
    it('should unobserve yText on unmount', () => {
      const unobserveSpy = vi.spyOn(mockYText, 'unobserve');

      const { unmount } = renderHook(() => useCollaborativeFile('session-1', '/file.ts', ''));

      unmount();

      expect(unobserveSpy).toHaveBeenCalledTimes(1);
    });

    it('should clear collaborator update interval on unmount', () => {
      const { unmount } = renderHook(() => useCollaborativeFile('session-1', '/file.ts', ''));

      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

      unmount();

      expect(clearIntervalSpy).toHaveBeenCalled();
    });

    it('should destroy yDoc on unmount', () => {
      const { unmount } = renderHook(() => useCollaborativeFile('session-1', '/file.ts', ''));

      unmount();

      expect(mockDestroyYDoc).toHaveBeenCalledWith('session-1', 'file:/file.ts');
    });

    it('should not update state after unmount', () => {
      const { result, unmount } = renderHook(() =>
        useCollaborativeFile('session-1', '/file.ts', '')
      );

      unmount();

      // Try to trigger observer after unmount
      act(() => {
        mockYText.insert(0, 'should not update');
      });

      // Content should not update after unmount
      expect(result.current.content).toBe('');
    });
  });
});

// ============================================================================
// useCollaborativeAgent Tests
// ============================================================================

describe('useCollaborativeAgent', () => {
  let mockYArray: MockYArray;
  let unsubStatusFn: () => void;
  let unsubTypingFn: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    mockYArray = new MockYArray();
    mockGetAgentMessages.mockReturnValue(mockYArray);

    unsubStatusFn = vi.fn();
    unsubTypingFn = vi.fn();

    mockOnAgentStatusUpdate.mockReturnValue(unsubStatusFn);
    mockOnAgentTyping.mockReturnValue(unsubTypingFn);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ========================================================================
  // Agent Initialization
  // ========================================================================

  describe('Agent Initialization', () => {
    it('should get agent messages on mount', () => {
      renderHook(() => useCollaborativeAgent('session-1', 'agent-1'));

      expect(mockGetAgentMessages).toHaveBeenCalledWith('session-1', 'agent-1');
    });

    it('should not get messages when sessionId is null', () => {
      renderHook(() => useCollaborativeAgent(null, 'agent-1'));

      expect(mockGetAgentMessages).not.toHaveBeenCalled();
    });

    it('should not get messages when agentId is null', () => {
      renderHook(() => useCollaborativeAgent('session-1', null));

      expect(mockGetAgentMessages).not.toHaveBeenCalled();
    });

    it('should start with empty messages', () => {
      const { result } = renderHook(() => useCollaborativeAgent('session-1', 'agent-1'));

      expect(result.current.messages).toEqual([]);
    });

    it('should start with idle status', () => {
      const { result } = renderHook(() => useCollaborativeAgent('session-1', 'agent-1'));

      expect(result.current.status).toBe('idle');
    });

    it('should start with empty typing users', () => {
      const { result } = renderHook(() => useCollaborativeAgent('session-1', 'agent-1'));

      expect(result.current.typingUsers).toEqual([]);
    });

    it('should subscribe to agent status updates', () => {
      renderHook(() => useCollaborativeAgent('session-1', 'agent-1'));

      expect(mockOnAgentStatusUpdate).toHaveBeenCalledTimes(1);
    });

    it('should subscribe to agent typing events', () => {
      renderHook(() => useCollaborativeAgent('session-1', 'agent-1'));

      expect(mockOnAgentTyping).toHaveBeenCalledTimes(1);
    });
  });

  // ========================================================================
  // Message Management
  // ========================================================================

  describe('Message Management', () => {
    it('should load initial messages from yArray', () => {
      const message = new MockYMap();
      message.set('id', 'msg-1');
      message.set('role', 'user');
      message.set('content', 'Hello');
      message.set('timestamp', Date.now());
      message.set('userId', 'user-123');

      mockYArray.push([message]);

      const { result } = renderHook(() => useCollaborativeAgent('session-1', 'agent-1'));

      expect(result.current.messages).toHaveLength(1);
      expect(result.current.messages[0]).toMatchObject({
        id: 'msg-1',
        role: 'user',
        content: 'Hello',
        userId: 'user-123',
      });
    });

    it('should update messages when yArray changes', () => {
      const { result } = renderHook(() => useCollaborativeAgent('session-1', 'agent-1'));

      const message = new MockYMap();
      message.set('id', 'msg-2');
      message.set('role', 'assistant');
      message.set('content', 'Hi there');
      message.set('timestamp', Date.now());

      act(() => {
        mockYArray.push([message]);
      });

      expect(result.current.messages).toHaveLength(1);
      expect(result.current.messages[0]?.role).toBe('assistant');
    });

    it('should handle multiple messages', () => {
      const msg1 = new MockYMap();
      msg1.set('id', 'msg-1');
      msg1.set('role', 'user');
      msg1.set('content', 'Question');
      msg1.set('timestamp', Date.now());

      const msg2 = new MockYMap();
      msg2.set('id', 'msg-2');
      msg2.set('role', 'assistant');
      msg2.set('content', 'Answer');
      msg2.set('timestamp', Date.now());

      mockYArray.push([msg1, msg2]);

      const { result } = renderHook(() => useCollaborativeAgent('session-1', 'agent-1'));

      expect(result.current.messages).toHaveLength(2);
    });

    it('should send message through sendMessage function', () => {
      const { result } = renderHook(() => useCollaborativeAgent('session-1', 'agent-1'));

      act(() => {
        result.current.sendMessage('Test message');
      });

      expect(mockAddAgentMessage).toHaveBeenCalledWith('session-1', 'agent-1', {
        id: expect.stringMatching(/^msg-/),
        role: 'user',
        content: 'Test message',
        timestamp: expect.any(Number),
        userId: 'user-123',
      });
    });

    it('should not send message with null sessionId', () => {
      const { result } = renderHook(() => useCollaborativeAgent(null, 'agent-1'));

      act(() => {
        result.current.sendMessage('Test message');
      });

      expect(mockAddAgentMessage).not.toHaveBeenCalled();
    });

    it('should not send message with null agentId', () => {
      const { result } = renderHook(() => useCollaborativeAgent('session-1', null));

      act(() => {
        result.current.sendMessage('Test message');
      });

      expect(mockAddAgentMessage).not.toHaveBeenCalled();
    });
  });

  // ========================================================================
  // Status Updates
  // ========================================================================

  describe('Status Updates', () => {
    it('should update status when agent status changes', () => {
      const { result } = renderHook(() => useCollaborativeAgent('session-1', 'agent-1'));

      const statusHandler = mockOnAgentStatusUpdate.mock.calls[0]?.[0];

      act(() => {
        statusHandler({
          session_id: 'session-1',
          agent_id: 'agent-1',
          status: 'processing',
        });
      });

      expect(result.current.status).toBe('processing');
    });

    it('should not update status for different session', () => {
      const { result } = renderHook(() => useCollaborativeAgent('session-1', 'agent-1'));

      const statusHandler = mockOnAgentStatusUpdate.mock.calls[0]?.[0];

      act(() => {
        statusHandler({
          session_id: 'session-2',
          agent_id: 'agent-1',
          status: 'processing',
        });
      });

      expect(result.current.status).toBe('idle');
    });

    it('should not update status for different agent', () => {
      const { result } = renderHook(() => useCollaborativeAgent('session-1', 'agent-1'));

      const statusHandler = mockOnAgentStatusUpdate.mock.calls[0]?.[0];

      act(() => {
        statusHandler({
          session_id: 'session-1',
          agent_id: 'agent-2',
          status: 'processing',
        });
      });

      expect(result.current.status).toBe('idle');
    });
  });

  // ========================================================================
  // Typing Indicators
  // ========================================================================

  describe('Typing Indicators', () => {
    it('should add typing user', () => {
      const { result } = renderHook(() => useCollaborativeAgent('session-1', 'agent-1'));

      const typingHandler = mockOnAgentTyping.mock.calls[0]?.[0];

      act(() => {
        typingHandler({
          session_id: 'session-1',
          agent_id: 'agent-1',
          user_id: 'user-456',
          is_typing: true,
        });
      });

      expect(result.current.typingUsers).toContain('user-456');
    });

    it('should remove typing user', () => {
      const { result } = renderHook(() => useCollaborativeAgent('session-1', 'agent-1'));

      const typingHandler = mockOnAgentTyping.mock.calls[0]?.[0];

      // Add user
      act(() => {
        typingHandler({
          session_id: 'session-1',
          agent_id: 'agent-1',
          user_id: 'user-456',
          is_typing: true,
        });
      });

      expect(result.current.typingUsers).toContain('user-456');

      // Remove user
      act(() => {
        typingHandler({
          session_id: 'session-1',
          agent_id: 'agent-1',
          user_id: 'user-456',
          is_typing: false,
        });
      });

      expect(result.current.typingUsers).not.toContain('user-456');
    });

    it('should prevent duplicate typing users', () => {
      const { result } = renderHook(() => useCollaborativeAgent('session-1', 'agent-1'));

      const typingHandler = mockOnAgentTyping.mock.calls[0]?.[0];

      act(() => {
        typingHandler({
          session_id: 'session-1',
          agent_id: 'agent-1',
          user_id: 'user-456',
          is_typing: true,
        });
        typingHandler({
          session_id: 'session-1',
          agent_id: 'agent-1',
          user_id: 'user-456',
          is_typing: true,
        });
      });

      expect(result.current.typingUsers).toHaveLength(1);
    });

    it('should broadcast typing status through setTyping', () => {
      const { result } = renderHook(() => useCollaborativeAgent('session-1', 'agent-1'));

      act(() => {
        result.current.setTyping(true);
      });

      expect(mockBroadcastAgentTyping).toHaveBeenCalledWith(
        'session-1',
        'agent-1',
        'user-123',
        true
      );
    });

    it('should broadcast stop typing', () => {
      const { result } = renderHook(() => useCollaborativeAgent('session-1', 'agent-1'));

      act(() => {
        result.current.setTyping(false);
      });

      expect(mockBroadcastAgentTyping).toHaveBeenCalledWith(
        'session-1',
        'agent-1',
        'user-123',
        false
      );
    });
  });

  // ========================================================================
  // Cleanup
  // ========================================================================

  describe('Cleanup', () => {
    it('should unobserve yArray on unmount', () => {
      const unobserveSpy = vi.spyOn(mockYArray, 'unobserve');

      const { unmount } = renderHook(() => useCollaborativeAgent('session-1', 'agent-1'));

      unmount();

      expect(unobserveSpy).toHaveBeenCalledTimes(1);
    });

    it('should unsubscribe from status updates on unmount', () => {
      const { unmount } = renderHook(() => useCollaborativeAgent('session-1', 'agent-1'));

      unmount();

      expect(unsubStatusFn).toHaveBeenCalledTimes(1);
    });

    it('should unsubscribe from typing events on unmount', () => {
      const { unmount } = renderHook(() => useCollaborativeAgent('session-1', 'agent-1'));

      unmount();

      expect(unsubTypingFn).toHaveBeenCalledTimes(1);
    });

    it('should destroy yDoc on unmount', () => {
      const { unmount } = renderHook(() => useCollaborativeAgent('session-1', 'agent-1'));

      unmount();

      expect(mockDestroyYDoc).toHaveBeenCalledWith('session-1', 'agent:agent-1');
    });
  });
});

// ============================================================================
// useOnlineUsers Tests
// ============================================================================

describe('useOnlineUsers', () => {
  let unsubJoinFn: () => void;
  let unsubLeaveFn: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    unsubJoinFn = vi.fn();
    unsubLeaveFn = vi.fn();

    mockOnUserJoined.mockReturnValue(unsubJoinFn);
    mockOnUserLeft.mockReturnValue(unsubLeaveFn);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ========================================================================
  // Online Users Tracking
  // ========================================================================

  describe('Online Users Tracking', () => {
    it('should start with empty users list', () => {
      const { result } = renderHook(() => useOnlineUsers('session-1'));

      expect(result.current).toEqual([]);
    });

    it('should not subscribe when sessionId is null', () => {
      renderHook(() => useOnlineUsers(null));

      expect(mockOnUserJoined).not.toHaveBeenCalled();
      expect(mockOnUserLeft).not.toHaveBeenCalled();
    });

    it('should add user when they join', () => {
      const { result } = renderHook(() => useOnlineUsers('session-1'));

      const joinHandler = mockOnUserJoined.mock.calls[0]?.[0];

      act(() => {
        joinHandler({ session_id: 'session-1', user_id: 'user-456' });
      });

      expect(result.current).toContain('user-456');
    });

    it('should remove user when they leave', () => {
      const { result } = renderHook(() => useOnlineUsers('session-1'));

      const joinHandler = mockOnUserJoined.mock.calls[0]?.[0];
      const leaveHandler = mockOnUserLeft.mock.calls[0]?.[0];

      act(() => {
        joinHandler({ session_id: 'session-1', user_id: 'user-456' });
      });

      expect(result.current).toContain('user-456');

      act(() => {
        leaveHandler({ session_id: 'session-1', user_id: 'user-456' });
      });

      expect(result.current).not.toContain('user-456');
    });

    it('should only track users from the same session', () => {
      const { result } = renderHook(() => useOnlineUsers('session-1'));

      const joinHandler = mockOnUserJoined.mock.calls[0]?.[0];

      act(() => {
        joinHandler({ session_id: 'session-1', user_id: 'user-456' });
        joinHandler({ session_id: 'session-2', user_id: 'user-789' });
      });

      expect(result.current).toContain('user-456');
      expect(result.current).not.toContain('user-789');
    });

    it('should return array of user IDs', () => {
      const { result } = renderHook(() => useOnlineUsers('session-1'));

      const joinHandler = mockOnUserJoined.mock.calls[0]?.[0];

      act(() => {
        joinHandler({ session_id: 'session-1', user_id: 'user-1' });
        joinHandler({ session_id: 'session-1', user_id: 'user-2' });
      });

      expect(Array.isArray(result.current)).toBe(true);
      expect(result.current).toHaveLength(2);
    });

    it('should handle multiple joins and leaves', () => {
      const { result } = renderHook(() => useOnlineUsers('session-1'));

      const joinHandler = mockOnUserJoined.mock.calls[0]?.[0];
      const leaveHandler = mockOnUserLeft.mock.calls[0]?.[0];

      act(() => {
        joinHandler({ session_id: 'session-1', user_id: 'user-1' });
        joinHandler({ session_id: 'session-1', user_id: 'user-2' });
        joinHandler({ session_id: 'session-1', user_id: 'user-3' });
      });

      expect(result.current).toHaveLength(3);

      act(() => {
        leaveHandler({ session_id: 'session-1', user_id: 'user-2' });
      });

      expect(result.current).toHaveLength(2);
      expect(result.current).not.toContain('user-2');
    });
  });

  // ========================================================================
  // Cleanup
  // ========================================================================

  describe('Cleanup', () => {
    it('should unsubscribe from join events on unmount', () => {
      const { unmount } = renderHook(() => useOnlineUsers('session-1'));

      unmount();

      expect(unsubJoinFn).toHaveBeenCalledTimes(1);
    });

    it('should unsubscribe from leave events on unmount', () => {
      const { unmount } = renderHook(() => useOnlineUsers('session-1'));

      unmount();

      expect(unsubLeaveFn).toHaveBeenCalledTimes(1);
    });
  });
});
