'use client';

import { useMemo } from 'react';
import { useSessionStore } from '@/stores/session';
import { useMCPStore } from '@/stores/mcp';
import { useDiagnosticsStore, DiagnosticSeverity } from '@/components/workspace/ProblemsPanel';
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

  // Problems: get raw diagnostics and compute counts manually to avoid selector issues
  const diagnostics = useDiagnosticsStore((state) => state.diagnostics);
  const problems = useMemo(() => {
    let errors = 0;
    let warnings = 0;
    Object.values(diagnostics).forEach((diags) => {
      // Handle null or undefined diagnostic arrays
      if (!diags) return;
      diags.forEach((d) => {
        if (d.severity === DiagnosticSeverity.Error) errors++;
        else if (d.severity === DiagnosticSeverity.Warning) warnings++;
      });
    });
    return errors + warnings;
  }, [diagnostics]);

  // Sentry: count unresolved issues
  const sentryUnresolved = useSentryStore(selectUnresolvedCount);

  return {
    agents: agents > 0 ? agents : undefined,
    mcp: mcp > 0 ? mcp : undefined,
    problems: problems > 0 ? problems : undefined,
    sentry: sentryUnresolved > 0 ? sentryUnresolved : undefined,
  };
}
