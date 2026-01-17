import { useEffect } from 'react';
import { useAttentionStore } from '@/stores/attention';

/**
 * Hook to set the document title with optional notification count.
 *
 * @param title - The page title (will be appended with "| Podex")
 * @param options - Configuration options
 * @param options.sessionId - Session ID to get unread count for (optional)
 * @param options.showNotifications - Whether to show notification count (default: true)
 *
 * @example
 * // Basic usage
 * useDocumentTitle('Dashboard');
 * // Result: "Dashboard | Podex"
 *
 * @example
 * // With session-specific notifications
 * useDocumentTitle('My Project', { sessionId: 'abc123' });
 * // Result: "(3) My Project | Podex" when 3 unread notifications
 *
 * @example
 * // Without notifications
 * useDocumentTitle('Login', { showNotifications: false });
 * // Result: "Login | Podex"
 */
export function useDocumentTitle(
  title: string,
  options?: {
    sessionId?: string;
    showNotifications?: boolean;
  }
) {
  const { sessionId, showNotifications = true } = options ?? {};

  // Get total unread count across all sessions, or for specific session
  const unreadCount = useAttentionStore((state) => {
    if (!showNotifications) return 0;

    if (sessionId) {
      return state.unreadCountBySession[sessionId] ?? 0;
    }

    // Sum all unread counts across sessions
    return Object.values(state.unreadCountBySession).reduce((sum, count) => sum + count, 0);
  });

  useEffect(() => {
    const baseTitle = title ? `${title} | Podex` : 'Podex';

    if (unreadCount > 0) {
      document.title = `(${unreadCount}) ${baseTitle}`;
    } else {
      document.title = baseTitle;
    }

    // Cleanup: reset to base title on unmount
    return () => {
      document.title = 'Podex';
    };
  }, [title, unreadCount]);
}

/**
 * Hook to set the document title for a session/workspace page.
 * Automatically includes the session name and session-specific notifications.
 *
 * @param sessionName - The session/workspace name
 * @param sessionId - The session ID for notification count
 *
 * @example
 * useSessionTitle('my-project', 'abc123');
 * // Result: "(2) my-project | Podex" when 2 unread notifications for this session
 */
export function useSessionTitle(sessionName: string | undefined, sessionId: string) {
  const displayName = sessionName ?? 'Workspace';
  useDocumentTitle(displayName, { sessionId, showNotifications: true });
}
