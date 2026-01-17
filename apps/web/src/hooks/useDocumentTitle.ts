import { useEffect, useRef } from 'react';
import { useAttentionStore } from '@/stores/attention';
import { useVisibilityStore } from '@/hooks/useVisibilityTracking';

/**
 * Hook to set the document title with optional notification count.
 * When the tab is unfocused and there are unread notifications,
 * the title will flash between showing the notification indicator
 * and the base title to get the user's attention.
 *
 * @param title - The page title (will be appended with "| Podex")
 * @param options - Configuration options
 * @param options.sessionId - Session ID to get unread count for (optional)
 * @param options.showNotifications - Whether to show notification count (default: true)
 * @param options.flashWhenUnfocused - Flash title when unfocused with unread (default: true)
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
 * // When unfocused: alternates between "● (3) My Project | Podex" and "(3) My Project | Podex"
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
    flashWhenUnfocused?: boolean;
  }
) {
  const { sessionId, showNotifications = true, flashWhenUnfocused = true } = options ?? {};

  // Get total unread count across all sessions, or for specific session
  const unreadCount = useAttentionStore((state) => {
    if (!showNotifications) return 0;

    if (sessionId) {
      return state.unreadCountBySession[sessionId] ?? 0;
    }

    // Sum all unread counts across sessions
    return Object.values(state.unreadCountBySession).reduce((sum, count) => sum + count, 0);
  });

  const isFocused = useVisibilityStore((state) => state.isFocused);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const showIndicatorRef = useRef(false);

  useEffect(() => {
    const baseTitle = title ? `${title} | Podex` : 'Podex';
    const notificationTitle = unreadCount > 0 ? `(${unreadCount}) ${baseTitle}` : baseTitle;

    // Clear any existing interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    // If unfocused with unread notifications, start flashing
    if (!isFocused && unreadCount > 0 && flashWhenUnfocused) {
      // Start with the indicator shown
      showIndicatorRef.current = true;
      document.title = `● ${notificationTitle}`;

      // Flash the title every 1.5 seconds
      intervalRef.current = setInterval(() => {
        showIndicatorRef.current = !showIndicatorRef.current;
        document.title = showIndicatorRef.current ? `● ${notificationTitle}` : notificationTitle;
      }, 1500);
    } else {
      // Normal title (with or without count)
      showIndicatorRef.current = false;
      document.title = notificationTitle;
    }

    // Cleanup
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [title, unreadCount, isFocused, flashWhenUnfocused]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      document.title = 'Podex';
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);
}

/**
 * Hook to set the document title for a session/workspace page.
 * Automatically includes the session name and session-specific notifications.
 * Title will flash when unfocused with unread notifications.
 *
 * @param sessionName - The session/workspace name
 * @param sessionId - The session ID for notification count
 *
 * @example
 * useSessionTitle('my-project', 'abc123');
 * // Result: "(2) my-project | Podex" when 2 unread notifications for this session
 * // When unfocused: "● (2) my-project | Podex" (flashing)
 */
export function useSessionTitle(sessionName: string | undefined, sessionId: string) {
  const displayName = sessionName ?? 'Workspace';
  useDocumentTitle(displayName, { sessionId, showNotifications: true, flashWhenUnfocused: true });
}
