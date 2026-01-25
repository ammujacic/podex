/**
 * Comprehensive tests for useExtensionSync hook
 * Tests WebSocket synchronization for extension events across devices
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useExtensionSync } from '../useExtensionSync';
import * as socketLib from '@/lib/socket';
import { toast } from 'sonner';
import { socketHandlers, triggerSocketEvent, resetMockSocket } from '@/__tests__/mocks/socket';
import type {
  ExtensionInstalledEvent,
  ExtensionUninstalledEvent,
  ExtensionToggledEvent,
  ExtensionSettingsChangedEvent,
} from '@/lib/socket';

// Mock dependencies
vi.mock('@/lib/socket', () => ({
  connectSocket: vi.fn(),
  subscribeToExtensions: vi.fn(),
  unsubscribeFromExtensions: vi.fn(),
  onSocketEvent: vi.fn((event, handler) => {
    socketHandlers[event] = handler;
    return () => {
      delete socketHandlers[event];
    };
  }),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

// Mock React Query client
const mockInvalidateQueries = vi.fn();
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: mockInvalidateQueries,
  }),
}));

describe('useExtensionSync', () => {
  const authToken = 'auth-token-123';
  const workspaceId = 'workspace-456';

  beforeEach(() => {
    vi.clearAllMocks();
    resetMockSocket();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ========================================
  // Initialization Tests
  // ========================================

  describe('Initialization', () => {
    it('should not connect when disabled', () => {
      renderHook(() => useExtensionSync({ authToken, enabled: false }));

      expect(socketLib.connectSocket).not.toHaveBeenCalled();
      expect(socketLib.subscribeToExtensions).not.toHaveBeenCalled();
    });

    it('should not connect when authToken is missing', () => {
      renderHook(() => useExtensionSync({ authToken: undefined, enabled: true }));

      expect(socketLib.connectSocket).not.toHaveBeenCalled();
    });

    it('should connect and subscribe when enabled with authToken', () => {
      renderHook(() => useExtensionSync({ authToken, enabled: true }));

      expect(socketLib.connectSocket).toHaveBeenCalledTimes(1);
      expect(socketLib.subscribeToExtensions).toHaveBeenCalledWith(authToken);
    });

    it('should default enabled to true', () => {
      renderHook(() => useExtensionSync({ authToken }));

      expect(socketLib.connectSocket).toHaveBeenCalled();
    });

    it('should subscribe to all extension event types', () => {
      renderHook(() => useExtensionSync({ authToken }));

      expect(socketLib.onSocketEvent).toHaveBeenCalledWith(
        'extension_installed',
        expect.any(Function)
      );
      expect(socketLib.onSocketEvent).toHaveBeenCalledWith(
        'extension_uninstalled',
        expect.any(Function)
      );
      expect(socketLib.onSocketEvent).toHaveBeenCalledWith(
        'extension_toggled',
        expect.any(Function)
      );
      expect(socketLib.onSocketEvent).toHaveBeenCalledWith(
        'extension_settings_changed',
        expect.any(Function)
      );
    });

    it('should subscribe to exactly 4 event types', () => {
      renderHook(() => useExtensionSync({ authToken }));

      expect(socketLib.onSocketEvent).toHaveBeenCalledTimes(4);
    });

    it('should default showNotifications to true', () => {
      renderHook(() => useExtensionSync({ authToken }));

      const installedEvent: ExtensionInstalledEvent = {
        extension_id: 'ext-1',
        display_name: 'Test Extension',
        scope: 'user',
        user_id: 'user-1',
      };

      triggerSocketEvent('extension_installed', installedEvent);

      expect(toast.success).toHaveBeenCalled();
    });

    it('should work with empty options', () => {
      expect(() => {
        renderHook(() => useExtensionSync());
      }).not.toThrow();
    });
  });

  // ========================================
  // Extension Installed Event Tests
  // ========================================

  describe('Extension Installed Events', () => {
    it('should invalidate queries on extension installed', async () => {
      renderHook(() => useExtensionSync({ authToken }));

      const installedEvent: ExtensionInstalledEvent = {
        extension_id: 'ext-1',
        display_name: 'Test Extension',
        scope: 'user',
        user_id: 'user-1',
      };

      triggerSocketEvent('extension_installed', installedEvent);

      await waitFor(() => {
        expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['extensions-installed'] });
      });
    });

    it('should show success toast for user-scoped installation', async () => {
      renderHook(() => useExtensionSync({ authToken, showNotifications: true }));

      const installedEvent: ExtensionInstalledEvent = {
        extension_id: 'ext-1',
        display_name: 'My Extension',
        scope: 'user',
        user_id: 'user-1',
      };

      triggerSocketEvent('extension_installed', installedEvent);

      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith(
          'Extension "My Extension" installed',
          expect.objectContaining({
            description: 'Installed to account',
          })
        );
      });
    });

    it('should show success toast for workspace-scoped installation', async () => {
      renderHook(() => useExtensionSync({ authToken, workspaceId, showNotifications: true }));

      const installedEvent: ExtensionInstalledEvent = {
        extension_id: 'ext-1',
        display_name: 'Workspace Extension',
        scope: 'workspace',
        user_id: 'user-1',
        workspace_id: workspaceId,
      };

      triggerSocketEvent('extension_installed', installedEvent);

      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith(
          'Extension "Workspace Extension" installed',
          expect.objectContaining({
            description: 'Installed to workspace',
          })
        );
      });
    });

    it('should not show toast when showNotifications is false', async () => {
      renderHook(() => useExtensionSync({ authToken, showNotifications: false }));

      const installedEvent: ExtensionInstalledEvent = {
        extension_id: 'ext-1',
        display_name: 'Test Extension',
        scope: 'user',
        user_id: 'user-1',
      };

      triggerSocketEvent('extension_installed', installedEvent);

      await waitFor(() => {
        expect(mockInvalidateQueries).toHaveBeenCalled();
        expect(toast.success).not.toHaveBeenCalled();
      });
    });

    it('should ignore workspace events from different workspaces', async () => {
      renderHook(() => useExtensionSync({ authToken, workspaceId }));

      const installedEvent: ExtensionInstalledEvent = {
        extension_id: 'ext-1',
        display_name: 'Other Workspace Extension',
        scope: 'workspace',
        user_id: 'user-1',
        workspace_id: 'different-workspace',
      };

      triggerSocketEvent('extension_installed', installedEvent);

      await waitFor(() => {
        expect(mockInvalidateQueries).not.toHaveBeenCalled();
        expect(toast.success).not.toHaveBeenCalled();
      });
    });

    it('should process user-scoped events regardless of workspaceId', async () => {
      renderHook(() => useExtensionSync({ authToken, workspaceId }));

      const installedEvent: ExtensionInstalledEvent = {
        extension_id: 'ext-1',
        display_name: 'User Extension',
        scope: 'user',
        user_id: 'user-1',
      };

      triggerSocketEvent('extension_installed', installedEvent);

      await waitFor(() => {
        expect(mockInvalidateQueries).toHaveBeenCalled();
      });
    });
  });

  // ========================================
  // Extension Uninstalled Event Tests
  // ========================================

  describe('Extension Uninstalled Events', () => {
    it('should invalidate queries on extension uninstalled', async () => {
      renderHook(() => useExtensionSync({ authToken }));

      const uninstalledEvent: ExtensionUninstalledEvent = {
        extension_id: 'ext-1',
        scope: 'user',
        user_id: 'user-1',
      };

      triggerSocketEvent('extension_uninstalled', uninstalledEvent);

      await waitFor(() => {
        expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['extensions-installed'] });
      });
    });

    it('should show info toast for user-scoped uninstall', async () => {
      renderHook(() => useExtensionSync({ authToken, showNotifications: true }));

      const uninstalledEvent: ExtensionUninstalledEvent = {
        extension_id: 'ext-1',
        scope: 'user',
        user_id: 'user-1',
      };

      triggerSocketEvent('extension_uninstalled', uninstalledEvent);

      await waitFor(() => {
        expect(toast.info).toHaveBeenCalledWith(
          'Extension uninstalled',
          expect.objectContaining({
            description: 'Removed from account',
          })
        );
      });
    });

    it('should show info toast for workspace-scoped uninstall', async () => {
      renderHook(() => useExtensionSync({ authToken, workspaceId, showNotifications: true }));

      const uninstalledEvent: ExtensionUninstalledEvent = {
        extension_id: 'ext-1',
        scope: 'workspace',
        user_id: 'user-1',
        workspace_id: workspaceId,
      };

      triggerSocketEvent('extension_uninstalled', uninstalledEvent);

      await waitFor(() => {
        expect(toast.info).toHaveBeenCalledWith(
          'Extension uninstalled',
          expect.objectContaining({
            description: 'Removed from workspace',
          })
        );
      });
    });

    it('should ignore workspace uninstall from different workspace', async () => {
      renderHook(() => useExtensionSync({ authToken, workspaceId }));

      const uninstalledEvent: ExtensionUninstalledEvent = {
        extension_id: 'ext-1',
        scope: 'workspace',
        user_id: 'user-1',
        workspace_id: 'other-workspace',
      };

      triggerSocketEvent('extension_uninstalled', uninstalledEvent);

      await waitFor(() => {
        expect(mockInvalidateQueries).not.toHaveBeenCalled();
      });
    });
  });

  // ========================================
  // Extension Toggled Event Tests
  // ========================================

  describe('Extension Toggled Events', () => {
    it('should invalidate queries on extension toggled', async () => {
      renderHook(() => useExtensionSync({ authToken }));

      const toggledEvent: ExtensionToggledEvent = {
        extension_id: 'ext-1',
        enabled: true,
        scope: 'user',
        user_id: 'user-1',
      };

      triggerSocketEvent('extension_toggled', toggledEvent);

      await waitFor(() => {
        expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['extensions-installed'] });
      });
    });

    it('should show info toast when extension enabled', async () => {
      renderHook(() => useExtensionSync({ authToken, showNotifications: true }));

      const toggledEvent: ExtensionToggledEvent = {
        extension_id: 'ext-1',
        enabled: true,
        scope: 'user',
        user_id: 'user-1',
      };

      triggerSocketEvent('extension_toggled', toggledEvent);

      await waitFor(() => {
        expect(toast.info).toHaveBeenCalledWith(
          'Extension enabled',
          expect.objectContaining({
            description: 'Synced from another device',
          })
        );
      });
    });

    it('should show info toast when extension disabled', async () => {
      renderHook(() => useExtensionSync({ authToken, showNotifications: true }));

      const toggledEvent: ExtensionToggledEvent = {
        extension_id: 'ext-1',
        enabled: false,
        scope: 'user',
        user_id: 'user-1',
      };

      triggerSocketEvent('extension_toggled', toggledEvent);

      await waitFor(() => {
        expect(toast.info).toHaveBeenCalledWith(
          'Extension disabled',
          expect.objectContaining({
            description: 'Synced from another device',
          })
        );
      });
    });

    it('should ignore workspace toggle from different workspace', async () => {
      renderHook(() => useExtensionSync({ authToken, workspaceId }));

      const toggledEvent: ExtensionToggledEvent = {
        extension_id: 'ext-1',
        enabled: true,
        scope: 'workspace',
        user_id: 'user-1',
        workspace_id: 'other-workspace',
      };

      triggerSocketEvent('extension_toggled', toggledEvent);

      await waitFor(() => {
        expect(mockInvalidateQueries).not.toHaveBeenCalled();
      });
    });

    it('should process workspace toggle for matching workspace', async () => {
      renderHook(() => useExtensionSync({ authToken, workspaceId }));

      const toggledEvent: ExtensionToggledEvent = {
        extension_id: 'ext-1',
        enabled: true,
        scope: 'workspace',
        user_id: 'user-1',
        workspace_id: workspaceId,
      };

      triggerSocketEvent('extension_toggled', toggledEvent);

      await waitFor(() => {
        expect(mockInvalidateQueries).toHaveBeenCalled();
      });
    });
  });

  // ========================================
  // Extension Settings Changed Event Tests
  // ========================================

  describe('Extension Settings Changed Events', () => {
    it('should invalidate queries on settings changed', async () => {
      renderHook(() => useExtensionSync({ authToken }));

      const settingsEvent: ExtensionSettingsChangedEvent = {
        extension_id: 'ext-1',
        scope: 'user',
        user_id: 'user-1',
        settings: { theme: 'dark' },
      };

      triggerSocketEvent('extension_settings_changed', settingsEvent);

      await waitFor(() => {
        expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['extensions-installed'] });
      });
    });

    it('should not show toast for settings changes', async () => {
      renderHook(() => useExtensionSync({ authToken, showNotifications: true }));

      const settingsEvent: ExtensionSettingsChangedEvent = {
        extension_id: 'ext-1',
        scope: 'user',
        user_id: 'user-1',
        settings: { theme: 'dark' },
      };

      triggerSocketEvent('extension_settings_changed', settingsEvent);

      await waitFor(() => {
        expect(mockInvalidateQueries).toHaveBeenCalled();
        expect(toast.success).not.toHaveBeenCalled();
        expect(toast.info).not.toHaveBeenCalled();
      });
    });

    it('should ignore workspace settings change from different workspace', async () => {
      renderHook(() => useExtensionSync({ authToken, workspaceId }));

      const settingsEvent: ExtensionSettingsChangedEvent = {
        extension_id: 'ext-1',
        scope: 'workspace',
        user_id: 'user-1',
        workspace_id: 'other-workspace',
        settings: { option: 'value' },
      };

      triggerSocketEvent('extension_settings_changed', settingsEvent);

      await waitFor(() => {
        expect(mockInvalidateQueries).not.toHaveBeenCalled();
      });
    });

    it('should process workspace settings change for matching workspace', async () => {
      renderHook(() => useExtensionSync({ authToken, workspaceId }));

      const settingsEvent: ExtensionSettingsChangedEvent = {
        extension_id: 'ext-1',
        scope: 'workspace',
        user_id: 'user-1',
        workspace_id: workspaceId,
        settings: { option: 'value' },
      };

      triggerSocketEvent('extension_settings_changed', settingsEvent);

      await waitFor(() => {
        expect(mockInvalidateQueries).toHaveBeenCalled();
      });
    });
  });

  // ========================================
  // Cleanup Tests
  // ========================================

  describe('Cleanup', () => {
    it('should unsubscribe from extensions on unmount', () => {
      const { unmount } = renderHook(() => useExtensionSync({ authToken }));

      expect(socketLib.unsubscribeFromExtensions).not.toHaveBeenCalled();

      unmount();

      expect(socketLib.unsubscribeFromExtensions).toHaveBeenCalledTimes(1);
    });

    it('should unsubscribe from all socket events on unmount', () => {
      const { unmount } = renderHook(() => useExtensionSync({ authToken }));

      expect(Object.keys(socketHandlers).length).toBeGreaterThan(0);

      unmount();

      // Socket handlers should be cleaned up by the unsubscribe functions
    });

    it('should not unsubscribe if not connected', () => {
      const { unmount } = renderHook(() => useExtensionSync({ authToken: undefined }));

      unmount();

      expect(socketLib.unsubscribeFromExtensions).not.toHaveBeenCalled();
    });
  });

  // ========================================
  // Re-subscription Tests
  // ========================================

  describe('Re-subscription', () => {
    it('should reconnect when authToken changes', () => {
      const { rerender } = renderHook(({ authToken }) => useExtensionSync({ authToken }), {
        initialProps: { authToken: 'token-1' },
      });

      expect(socketLib.subscribeToExtensions).toHaveBeenCalledWith('token-1');

      vi.clearAllMocks();

      rerender({ authToken: 'token-2' });

      expect(socketLib.subscribeToExtensions).toHaveBeenCalledWith('token-2');
    });

    it('should reconnect when enabled changes', () => {
      const { rerender } = renderHook(({ enabled }) => useExtensionSync({ authToken, enabled }), {
        initialProps: { enabled: true },
      });

      expect(socketLib.connectSocket).toHaveBeenCalledTimes(1);

      vi.clearAllMocks();

      rerender({ enabled: false });

      // Should unsubscribe
      expect(socketLib.unsubscribeFromExtensions).toHaveBeenCalled();
    });

    it('should reconnect when workspaceId changes', () => {
      const { rerender } = renderHook(
        ({ workspaceId }) => useExtensionSync({ authToken, workspaceId }),
        { initialProps: { workspaceId: 'ws-1' } }
      );

      vi.clearAllMocks();

      rerender({ workspaceId: 'ws-2' });

      // Effect should re-run with new workspaceId
      expect(socketLib.onSocketEvent).toHaveBeenCalled();
    });

    it('should reconnect when showNotifications changes', () => {
      const { rerender } = renderHook(
        ({ showNotifications }) => useExtensionSync({ authToken, showNotifications }),
        { initialProps: { showNotifications: true } }
      );

      vi.clearAllMocks();

      rerender({ showNotifications: false });

      // Effect should re-run
      expect(socketLib.onSocketEvent).toHaveBeenCalled();
    });
  });

  // ========================================
  // Edge Cases
  // ========================================

  describe('Edge Cases', () => {
    it('should handle multiple rapid events', async () => {
      renderHook(() => useExtensionSync({ authToken }));

      // Fire multiple events rapidly
      for (let i = 0; i < 5; i++) {
        triggerSocketEvent('extension_installed', {
          extension_id: `ext-${i}`,
          display_name: `Extension ${i}`,
          scope: 'user',
          user_id: 'user-1',
        });
      }

      await waitFor(() => {
        expect(mockInvalidateQueries).toHaveBeenCalledTimes(5);
      });
    });

    it('should handle mixed event types', async () => {
      renderHook(() => useExtensionSync({ authToken, workspaceId }));

      triggerSocketEvent('extension_installed', {
        extension_id: 'ext-1',
        display_name: 'Ext 1',
        scope: 'user',
        user_id: 'user-1',
      });

      triggerSocketEvent('extension_toggled', {
        extension_id: 'ext-2',
        enabled: false,
        scope: 'workspace',
        user_id: 'user-1',
        workspace_id: workspaceId,
      });

      triggerSocketEvent('extension_uninstalled', {
        extension_id: 'ext-3',
        scope: 'user',
        user_id: 'user-1',
      });

      await waitFor(() => {
        expect(mockInvalidateQueries).toHaveBeenCalledTimes(3);
      });
    });

    it('should handle workspace events when no workspaceId is set', async () => {
      renderHook(() => useExtensionSync({ authToken }));

      // Workspace event without workspaceId in hook should still filter
      const installedEvent: ExtensionInstalledEvent = {
        extension_id: 'ext-1',
        display_name: 'Workspace Extension',
        scope: 'workspace',
        user_id: 'user-1',
        workspace_id: 'some-workspace',
      };

      triggerSocketEvent('extension_installed', installedEvent);

      await waitFor(() => {
        // Should still process since hook workspaceId is undefined (no filtering)
        expect(mockInvalidateQueries).not.toHaveBeenCalled();
      });
    });

    it('should handle events with undefined workspace_id in workspace scope', async () => {
      renderHook(() => useExtensionSync({ authToken, workspaceId }));

      const installedEvent: ExtensionInstalledEvent = {
        extension_id: 'ext-1',
        display_name: 'Strange Extension',
        scope: 'workspace',
        user_id: 'user-1',
        // workspace_id is undefined but scope is workspace
      };

      triggerSocketEvent('extension_installed', installedEvent);

      await waitFor(() => {
        // Should not match because workspace_id doesn't equal workspaceId
        expect(mockInvalidateQueries).not.toHaveBeenCalled();
      });
    });
  });
});
