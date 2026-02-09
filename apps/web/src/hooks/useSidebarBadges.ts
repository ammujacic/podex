'use client';

import { useSessionStore } from '@/stores/session';
import { useMCPStore } from '@/stores/mcp';
import { useSentryStore, selectUnresolvedCount } from '@/stores/sentry';
import type { PanelId } from '@/stores/ui';

export function useSidebarBadges(sessionId: string): Partial<Record<PanelId, number>> {
  // Agents: count from current session
  const agents = useSessionStore((state) => state.sessions[sessionId]?.agents?.length || 0);

  // MCP: count enabled servers (builtin + enabled non-builtin)
  const mcp = useMCPStore((state) => {
    const allServers = state.categories.flatMap((c) => c.servers);
    return allServers.filter((s) => s.is_builtin || s.is_enabled).length;
  });

  // Sentry: count unresolved issues
  const sentryUnresolved = useSentryStore(selectUnresolvedCount);

  return {
    agents: agents > 0 ? agents : undefined,
    mcp: mcp > 0 ? mcp : undefined,
    sentry: sentryUnresolved > 0 ? sentryUnresolved : undefined,
  };
}
