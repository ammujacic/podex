/**
 * React hook for extension sync via WebSocket.
 * Listens for extension events (install/uninstall/toggle/settings) from other devices
 * and invalidates React Query cache to keep UI in sync.
 */

import { useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  connectSocket,
  subscribeToExtensions,
  unsubscribeFromExtensions,
  onSocketEvent,
  type ExtensionInstalledEvent,
  type ExtensionUninstalledEvent,
  type ExtensionToggledEvent,
  type ExtensionSettingsChangedEvent,
} from '@/lib/socket';

interface UseExtensionSyncOptions {
  /** Auth token for socket authentication */
  authToken?: string;
  /** Enable the sync (set to false to disable) */
  enabled?: boolean;
  /** Current workspace ID for filtering workspace-scoped events */
  workspaceId?: string;
  /** Show toast notifications for remote changes */
  showNotifications?: boolean;
}

/**
 * Hook to sync extension state across devices via WebSocket.
 * Automatically subscribes/unsubscribes and invalidates React Query cache on events.
 */
export function useExtensionSync({
  authToken,
  enabled = true,
  workspaceId,
  showNotifications = true,
}: UseExtensionSyncOptions = {}) {
  const queryClient = useQueryClient();

  // Invalidate extension queries to trigger refetch
  const invalidateExtensions = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['extensions-installed'] });
  }, [queryClient]);

  useEffect(() => {
    if (!enabled || !authToken) return;

    // Connect to socket and subscribe to extension events
    connectSocket();
    subscribeToExtensions(authToken);

    // Handle extension installed event
    const unsubInstalled = onSocketEvent('extension_installed', (data: ExtensionInstalledEvent) => {
      // Skip workspace events that don't match current workspace
      if (data.scope === 'workspace' && data.workspace_id !== workspaceId) {
        return;
      }

      invalidateExtensions();

      if (showNotifications) {
        toast.success(`Extension "${data.display_name}" installed`, {
          description:
            data.scope === 'workspace' ? 'Installed to workspace' : 'Installed to account',
        });
      }
    });

    // Handle extension uninstalled event
    const unsubUninstalled = onSocketEvent(
      'extension_uninstalled',
      (data: ExtensionUninstalledEvent) => {
        // Skip workspace events that don't match current workspace
        if (data.scope === 'workspace' && data.workspace_id !== workspaceId) {
          return;
        }

        invalidateExtensions();

        if (showNotifications) {
          toast.info('Extension uninstalled', {
            description: `Removed from ${data.scope === 'workspace' ? 'workspace' : 'account'}`,
          });
        }
      }
    );

    // Handle extension toggled event
    const unsubToggled = onSocketEvent('extension_toggled', (data: ExtensionToggledEvent) => {
      // Skip workspace events that don't match current workspace
      if (data.scope === 'workspace' && data.workspace_id !== workspaceId) {
        return;
      }

      invalidateExtensions();

      if (showNotifications) {
        toast.info(`Extension ${data.enabled ? 'enabled' : 'disabled'}`, {
          description: 'Synced from another device',
        });
      }
    });

    // Handle extension settings changed event
    const unsubSettings = onSocketEvent(
      'extension_settings_changed',
      (data: ExtensionSettingsChangedEvent) => {
        // Skip workspace events that don't match current workspace
        if (data.scope === 'workspace' && data.workspace_id !== workspaceId) {
          return;
        }

        invalidateExtensions();

        // Settings changes are subtle, no notification needed
      }
    );

    // Cleanup on unmount
    return () => {
      unsubInstalled();
      unsubUninstalled();
      unsubToggled();
      unsubSettings();
      unsubscribeFromExtensions();
    };
  }, [authToken, enabled, workspaceId, showNotifications, invalidateExtensions]);
}
