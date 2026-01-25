/**
 * Comprehensive tests for useFileChangeNotifications hooks
 * Tests file change toast notifications, agent status notifications, and workspace notifications
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import {
  useFileChangeNotifications,
  useAgentStatusNotifications,
  useWorkspaceNotifications,
} from '../useFileChangeNotifications';
import { toast } from 'sonner';
import * as socketLib from '@/lib/socket';
import type { FileChangeEvent } from '@/lib/socket';

// Track socket event handlers
const socketHandlers: Record<string, (event: unknown) => void> = {};

// Mock dependencies
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('@/lib/socket', () => ({
  onSocketEvent: vi.fn((event: string, handler: (data: unknown) => void) => {
    socketHandlers[event] = handler;
    return () => {
      delete socketHandlers[event];
    };
  }),
}));

vi.mock('@/stores/editor', () => ({
  useEditorStore: {
    getState: () => ({
      openTab: vi.fn(),
    }),
  },
}));

vi.mock('@/stores/sessionTypes', () => ({
  getLanguageFromPath: (path: string) => {
    if (path.endsWith('.ts')) return 'typescript';
    if (path.endsWith('.tsx')) return 'typescriptreact';
    if (path.endsWith('.js')) return 'javascript';
    if (path.endsWith('.py')) return 'python';
    return 'plaintext';
  },
}));

vi.mock('@/hooks/useAgentAttention', () => ({
  useAgentAttention: vi.fn(),
}));

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  FileCode: () => React.createElement('span', { 'data-testid': 'file-code-icon' }),
  FilePlus: () => React.createElement('span', { 'data-testid': 'file-plus-icon' }),
  FileX: () => React.createElement('span', { 'data-testid': 'file-x-icon' }),
  FileEdit: () => React.createElement('span', { 'data-testid': 'file-edit-icon' }),
}));

// Helper to trigger socket events
const triggerSocketEvent = (event: string, data: unknown) => {
  socketHandlers[event]?.(data);
};

// Helper to clear socket handlers
const clearSocketHandlers = () => {
  Object.keys(socketHandlers).forEach((key) => delete socketHandlers[key]);
};

describe('useFileChangeNotifications', () => {
  const sessionId = 'session-123';

  beforeEach(() => {
    vi.clearAllMocks();
    clearSocketHandlers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ========================================
  // Initialization Tests
  // ========================================

  describe('Initialization', () => {
    it('should subscribe to file_change socket event on mount', () => {
      renderHook(() => useFileChangeNotifications({ sessionId }));

      expect(socketLib.onSocketEvent).toHaveBeenCalledWith('file_change', expect.any(Function));
    });

    it('should not subscribe when disabled', () => {
      renderHook(() => useFileChangeNotifications({ sessionId, enabled: false }));

      expect(socketLib.onSocketEvent).not.toHaveBeenCalled();
    });

    it('should use default enabled value of true', () => {
      renderHook(() => useFileChangeNotifications({ sessionId }));

      expect(socketLib.onSocketEvent).toHaveBeenCalled();
    });

    it('should unsubscribe on unmount', () => {
      const { unmount } = renderHook(() => useFileChangeNotifications({ sessionId }));

      expect(socketHandlers['file_change']).toBeDefined();

      unmount();

      expect(socketHandlers['file_change']).toBeUndefined();
    });
  });

  // ========================================
  // File Created Event Tests
  // ========================================

  describe('File Created Events', () => {
    it('should show success toast for file creation', () => {
      renderHook(() => useFileChangeNotifications({ sessionId }));

      const event: FileChangeEvent = {
        session_id: sessionId,
        file_path: '/src/components/Button.tsx',
        change_type: 'created',
        changed_by: 'agent',
      };

      triggerSocketEvent('file_change', event);

      expect(toast.success).toHaveBeenCalledWith(
        'Agent created Button.tsx',
        expect.objectContaining({
          description: '/src/components/Button.tsx',
        })
      );
    });

    it('should include View action in toast for created files', () => {
      renderHook(() => useFileChangeNotifications({ sessionId }));

      const event: FileChangeEvent = {
        session_id: sessionId,
        file_path: '/src/utils.ts',
        change_type: 'created',
        changed_by: 'agent',
      };

      triggerSocketEvent('file_change', event);

      expect(toast.success).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          action: expect.objectContaining({
            label: 'View',
          }),
        })
      );
    });

    it('should use user name for non-agent changes', () => {
      renderHook(() => useFileChangeNotifications({ sessionId }));

      const event: FileChangeEvent = {
        session_id: sessionId,
        file_path: '/src/index.ts',
        change_type: 'created',
        changed_by: 'John Doe',
      };

      triggerSocketEvent('file_change', event);

      expect(toast.success).toHaveBeenCalledWith('John Doe created index.ts', expect.any(Object));
    });
  });

  // ========================================
  // File Modified Event Tests
  // ========================================

  describe('File Modified Events', () => {
    it('should show info toast for file modification', () => {
      renderHook(() => useFileChangeNotifications({ sessionId }));

      const event: FileChangeEvent = {
        session_id: sessionId,
        file_path: '/src/App.tsx',
        change_type: 'modified',
        changed_by: 'agent',
      };

      triggerSocketEvent('file_change', event);

      expect(toast.info).toHaveBeenCalledWith(
        'Agent modified App.tsx',
        expect.objectContaining({
          description: '/src/App.tsx',
        })
      );
    });

    it('should include View action in toast for modified files', () => {
      renderHook(() => useFileChangeNotifications({ sessionId }));

      const event: FileChangeEvent = {
        session_id: sessionId,
        file_path: '/src/config.ts',
        change_type: 'modified',
        changed_by: 'agent',
      };

      triggerSocketEvent('file_change', event);

      expect(toast.info).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          action: expect.objectContaining({
            label: 'View',
          }),
        })
      );
    });
  });

  // ========================================
  // File Deleted Event Tests
  // ========================================

  describe('File Deleted Events', () => {
    it('should show warning toast for file deletion', () => {
      renderHook(() => useFileChangeNotifications({ sessionId }));

      const event: FileChangeEvent = {
        session_id: sessionId,
        file_path: '/src/old-file.ts',
        change_type: 'deleted',
        changed_by: 'agent',
      };

      triggerSocketEvent('file_change', event);

      expect(toast.warning).toHaveBeenCalledWith(
        'Agent deleted old-file.ts',
        expect.objectContaining({
          description: '/src/old-file.ts',
        })
      );
    });

    it('should not include View action for deleted files', () => {
      renderHook(() => useFileChangeNotifications({ sessionId }));

      const event: FileChangeEvent = {
        session_id: sessionId,
        file_path: '/src/removed.ts',
        change_type: 'deleted',
        changed_by: 'agent',
      };

      triggerSocketEvent('file_change', event);

      expect(toast.warning).toHaveBeenCalledWith(
        expect.any(String),
        expect.not.objectContaining({
          action: expect.anything(),
        })
      );
    });
  });

  // ========================================
  // Unknown Change Type Tests
  // ========================================

  describe('Unknown Change Types', () => {
    it('should show generic toast for unknown change types', () => {
      renderHook(() => useFileChangeNotifications({ sessionId }));

      const event = {
        session_id: sessionId,
        file_path: '/src/file.ts',
        change_type: 'renamed',
        changed_by: 'agent',
      } as FileChangeEvent;

      triggerSocketEvent('file_change', event);

      expect(toast).toHaveBeenCalledWith(
        'File changed: file.ts',
        expect.objectContaining({
          description: 'renamed by Agent',
        })
      );
    });
  });

  // ========================================
  // Session Filtering Tests
  // ========================================

  describe('Session Filtering', () => {
    it('should ignore events from different sessions', () => {
      renderHook(() => useFileChangeNotifications({ sessionId }));

      const event: FileChangeEvent = {
        session_id: 'different-session',
        file_path: '/src/file.ts',
        change_type: 'created',
        changed_by: 'agent',
      };

      triggerSocketEvent('file_change', event);

      expect(toast.success).not.toHaveBeenCalled();
      expect(toast.info).not.toHaveBeenCalled();
      expect(toast.warning).not.toHaveBeenCalled();
    });

    it('should process events matching session ID', () => {
      renderHook(() => useFileChangeNotifications({ sessionId }));

      const event: FileChangeEvent = {
        session_id: sessionId,
        file_path: '/src/test.ts',
        change_type: 'created',
        changed_by: 'agent',
      };

      triggerSocketEvent('file_change', event);

      expect(toast.success).toHaveBeenCalled();
    });
  });

  // ========================================
  // Callback Tests
  // ========================================

  describe('onFileChange Callback', () => {
    it('should call onFileChange callback when provided', () => {
      const onFileChange = vi.fn();
      renderHook(() => useFileChangeNotifications({ sessionId, onFileChange }));

      const event: FileChangeEvent = {
        session_id: sessionId,
        file_path: '/src/file.ts',
        change_type: 'modified',
        changed_by: 'agent',
      };

      triggerSocketEvent('file_change', event);

      expect(onFileChange).toHaveBeenCalledWith(event);
    });

    it('should not fail when onFileChange is not provided', () => {
      renderHook(() => useFileChangeNotifications({ sessionId }));

      const event: FileChangeEvent = {
        session_id: sessionId,
        file_path: '/src/file.ts',
        change_type: 'modified',
        changed_by: 'agent',
      };

      // Should not throw
      expect(() => triggerSocketEvent('file_change', event)).not.toThrow();
    });

    it('should call callback even for filtered session events', () => {
      const onFileChange = vi.fn();
      renderHook(() => useFileChangeNotifications({ sessionId, onFileChange }));

      const event: FileChangeEvent = {
        session_id: 'different-session',
        file_path: '/src/file.ts',
        change_type: 'modified',
        changed_by: 'agent',
      };

      triggerSocketEvent('file_change', event);

      // Callback should not be called for different session
      expect(onFileChange).not.toHaveBeenCalled();
    });
  });

  // ========================================
  // File Path Parsing Tests
  // ========================================

  describe('File Path Parsing', () => {
    it('should extract filename from path', () => {
      renderHook(() => useFileChangeNotifications({ sessionId }));

      const event: FileChangeEvent = {
        session_id: sessionId,
        file_path: '/very/deep/nested/path/to/myfile.tsx',
        change_type: 'created',
        changed_by: 'agent',
      };

      triggerSocketEvent('file_change', event);

      expect(toast.success).toHaveBeenCalledWith(
        expect.stringContaining('myfile.tsx'),
        expect.any(Object)
      );
    });

    it('should handle root level files', () => {
      renderHook(() => useFileChangeNotifications({ sessionId }));

      const event: FileChangeEvent = {
        session_id: sessionId,
        file_path: 'rootfile.ts',
        change_type: 'created',
        changed_by: 'agent',
      };

      triggerSocketEvent('file_change', event);

      expect(toast.success).toHaveBeenCalledWith(
        expect.stringContaining('rootfile.ts'),
        expect.any(Object)
      );
    });

    it('should handle files with no extension', () => {
      renderHook(() => useFileChangeNotifications({ sessionId }));

      const event: FileChangeEvent = {
        session_id: sessionId,
        file_path: '/src/Makefile',
        change_type: 'created',
        changed_by: 'agent',
      };

      triggerSocketEvent('file_change', event);

      expect(toast.success).toHaveBeenCalledWith(
        expect.stringContaining('Makefile'),
        expect.any(Object)
      );
    });
  });

  // ========================================
  // Edge Cases
  // ========================================

  describe('Edge Cases', () => {
    it('should handle empty file path', () => {
      renderHook(() => useFileChangeNotifications({ sessionId }));

      const event: FileChangeEvent = {
        session_id: sessionId,
        file_path: '',
        change_type: 'created',
        changed_by: 'agent',
      };

      triggerSocketEvent('file_change', event);

      expect(toast.success).toHaveBeenCalled();
    });

    it('should handle multiple rapid events', () => {
      renderHook(() => useFileChangeNotifications({ sessionId }));

      for (let i = 0; i < 10; i++) {
        const event: FileChangeEvent = {
          session_id: sessionId,
          file_path: `/src/file${i}.ts`,
          change_type: 'modified',
          changed_by: 'agent',
        };
        triggerSocketEvent('file_change', event);
      }

      expect(toast.info).toHaveBeenCalledTimes(10);
    });

    it('should resubscribe when enabled changes from false to true', () => {
      const { rerender } = renderHook(
        ({ enabled }) => useFileChangeNotifications({ sessionId, enabled }),
        { initialProps: { enabled: false } }
      );

      expect(socketLib.onSocketEvent).not.toHaveBeenCalled();

      rerender({ enabled: true });

      expect(socketLib.onSocketEvent).toHaveBeenCalled();
    });
  });
});

describe('useAgentStatusNotifications', () => {
  const sessionId = 'session-123';

  beforeEach(() => {
    vi.clearAllMocks();
    clearSocketHandlers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ========================================
  // Initialization Tests
  // ========================================

  describe('Initialization', () => {
    it('should subscribe to agent_status socket event on mount', () => {
      renderHook(() => useAgentStatusNotifications({ sessionId }));

      expect(socketLib.onSocketEvent).toHaveBeenCalledWith('agent_status', expect.any(Function));
    });

    it('should not subscribe when disabled', () => {
      renderHook(() => useAgentStatusNotifications({ sessionId, enabled: false }));

      expect(socketLib.onSocketEvent).not.toHaveBeenCalled();
    });

    it('should unsubscribe on unmount', () => {
      const { unmount } = renderHook(() => useAgentStatusNotifications({ sessionId }));

      expect(socketHandlers['agent_status']).toBeDefined();

      unmount();

      expect(socketHandlers['agent_status']).toBeUndefined();
    });
  });

  // ========================================
  // Error Status Tests
  // ========================================

  describe('Error Status', () => {
    it('should show error toast for agent error status', () => {
      renderHook(() => useAgentStatusNotifications({ sessionId }));

      const event = {
        session_id: sessionId,
        agent_id: 'agent-1',
        status: 'error',
        error: 'Connection timeout',
      };

      triggerSocketEvent('agent_status', event);

      expect(toast.error).toHaveBeenCalledWith(
        'Agent error',
        expect.objectContaining({
          description: 'Connection timeout',
        })
      );
    });

    it('should not show toast for non-error status', () => {
      renderHook(() => useAgentStatusNotifications({ sessionId }));

      const event = {
        session_id: sessionId,
        agent_id: 'agent-1',
        status: 'active',
      };

      triggerSocketEvent('agent_status', event);

      expect(toast.error).not.toHaveBeenCalled();
    });

    it('should not show toast for error status without error message', () => {
      renderHook(() => useAgentStatusNotifications({ sessionId }));

      const event = {
        session_id: sessionId,
        agent_id: 'agent-1',
        status: 'error',
      };

      triggerSocketEvent('agent_status', event);

      expect(toast.error).not.toHaveBeenCalled();
    });
  });

  // ========================================
  // Session Filtering Tests
  // ========================================

  describe('Session Filtering', () => {
    it('should ignore events from different sessions', () => {
      renderHook(() => useAgentStatusNotifications({ sessionId }));

      const event = {
        session_id: 'different-session',
        agent_id: 'agent-1',
        status: 'error',
        error: 'Test error',
      };

      triggerSocketEvent('agent_status', event);

      expect(toast.error).not.toHaveBeenCalled();
    });
  });
});

describe('useWorkspaceNotifications', () => {
  const sessionId = 'session-123';

  beforeEach(() => {
    vi.clearAllMocks();
    clearSocketHandlers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ========================================
  // Combined Hooks Tests
  // ========================================

  describe('Combined Functionality', () => {
    it('should subscribe to file_change events', () => {
      renderHook(() => useWorkspaceNotifications({ sessionId }));

      expect(socketLib.onSocketEvent).toHaveBeenCalledWith('file_change', expect.any(Function));
    });

    it('should subscribe to agent_status events', () => {
      renderHook(() => useWorkspaceNotifications({ sessionId }));

      expect(socketLib.onSocketEvent).toHaveBeenCalledWith('agent_status', expect.any(Function));
    });

    it('should pass enabled option to child hooks', () => {
      renderHook(() => useWorkspaceNotifications({ sessionId, enabled: false }));

      expect(socketLib.onSocketEvent).not.toHaveBeenCalled();
    });

    it('should pass onFileChange callback', () => {
      const onFileChange = vi.fn();
      renderHook(() => useWorkspaceNotifications({ sessionId, onFileChange }));

      const event: FileChangeEvent = {
        session_id: sessionId,
        file_path: '/src/test.ts',
        change_type: 'created',
        changed_by: 'agent',
      };

      triggerSocketEvent('file_change', event);

      expect(onFileChange).toHaveBeenCalledWith(event);
    });

    it('should handle multiple event types', () => {
      renderHook(() => useWorkspaceNotifications({ sessionId }));

      // File change
      triggerSocketEvent('file_change', {
        session_id: sessionId,
        file_path: '/test.ts',
        change_type: 'created',
        changed_by: 'agent',
      });

      // Agent status
      triggerSocketEvent('agent_status', {
        session_id: sessionId,
        agent_id: 'agent-1',
        status: 'error',
        error: 'Test error',
      });

      expect(toast.success).toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalled();
    });
  });

  // ========================================
  // Cleanup Tests
  // ========================================

  describe('Cleanup', () => {
    it('should unsubscribe all handlers on unmount', () => {
      const { unmount } = renderHook(() => useWorkspaceNotifications({ sessionId }));

      expect(Object.keys(socketHandlers).length).toBeGreaterThan(0);

      unmount();

      // Handlers should be cleaned up
      expect(socketHandlers['file_change']).toBeUndefined();
      expect(socketHandlers['agent_status']).toBeUndefined();
    });
  });
});
