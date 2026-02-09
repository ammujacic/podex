'use client';

import { useEffect, useRef, useMemo } from 'react';
import { useAuthStore } from '@/stores/auth';
import { useSessionStore } from '@/stores/session';
import { listSessions } from '@/lib/api';

/**
 * Hook to synchronize localStorage sessions with the backend.
 *
 * This hook runs once after authentication is initialized and the user is logged in.
 * It fetches all valid session IDs from the backend and removes any orphaned sessions
 * from localStorage that no longer exist on the server.
 *
 * This fixes the issue where the mobile menu shows stale sessions that were:
 * - Deleted on another device
 * - Deleted directly from the backend
 * - Left over from previous logins
 */
export function useSessionSync() {
  const user = useAuthStore((state) => state.user);
  const isInitialized = useAuthStore((state) => state.isInitialized);
  const syncSessionsWithBackend = useSessionStore((state) => state.syncSessionsWithBackend);
  const sessions = useSessionStore((state) => state.sessions);

  // Memoize session count to avoid effect re-runs when sessions object reference changes
  // We only care about the count/existence for the sync decision
  const sessionCount = useMemo(() => Object.keys(sessions).length, [sessions]);

  // Track if we've already synced this session to avoid repeated calls
  const hasSyncedRef = useRef(false);

  useEffect(() => {
    // Only sync once per app load, when auth is ready and user is logged in
    if (!isInitialized || !user || hasSyncedRef.current) {
      return;
    }

    // Don't sync if there are no local sessions to clean up
    if (sessionCount === 0) {
      hasSyncedRef.current = true;
      return;
    }

    async function syncSessions() {
      try {
        // Fetch all sessions from backend (paginated, get first 100 which should cover most users)
        // We only need the IDs to validate against localStorage
        const response = await listSessions(1, 100);
        const validSessionIds = new Set<string>(response.items.map((s) => s.id));

        // If user has more than 100 sessions, fetch remaining pages
        if (response.total > 100) {
          const totalPages = Math.ceil(response.total / 100);
          for (let page = 2; page <= totalPages; page++) {
            const pageResponse = await listSessions(page, 100);
            for (const session of pageResponse.items) {
              validSessionIds.add(session.id);
            }
          }
        }

        // Sync with backend - this will remove orphaned sessions from localStorage
        syncSessionsWithBackend(validSessionIds);
        hasSyncedRef.current = true;
      } catch (error) {
        // Don't block app startup on sync failure - just log and continue
        console.warn('[SessionSync] Failed to sync sessions with backend:', error);
        hasSyncedRef.current = true;
      }
    }

    syncSessions();
  }, [isInitialized, user, sessionCount, syncSessionsWithBackend]);
}
