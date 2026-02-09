import { useState, useEffect, useCallback } from 'react';
import { listTunnels, exposePort, unexposePort, type TunnelItem } from '@/lib/api';

export interface UseTunnelsReturn {
  tunnels: TunnelItem[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  exposePort: (port: number) => Promise<TunnelItem | null>;
  unexposePort: (port: number) => Promise<void>;
}

export function useTunnels(workspaceId: string | null): UseTunnelsReturn {
  const [tunnels, setTunnels] = useState<TunnelItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTunnels = useCallback(async () => {
    if (!workspaceId) {
      setTunnels([]);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const res = await listTunnels(workspaceId);
      setTunnels(res.tunnels ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tunnels');
      setTunnels([]);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    fetchTunnels();
  }, [fetchTunnels]);

  const doExposePort = useCallback(
    async (port: number): Promise<TunnelItem | null> => {
      if (!workspaceId) return null;
      try {
        setError(null);
        const t = await exposePort(workspaceId, port);
        await fetchTunnels();
        return t;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to expose port');
        return null;
      }
    },
    [workspaceId, fetchTunnels]
  );

  const doUnexposePort = useCallback(
    async (port: number) => {
      if (!workspaceId) return;
      try {
        setError(null);
        await unexposePort(workspaceId, port);
        await fetchTunnels();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to remove tunnel');
      }
    },
    [workspaceId, fetchTunnels]
  );

  return {
    tunnels,
    loading,
    error,
    refetch: fetchTunnels,
    exposePort: doExposePort,
    unexposePort: doUnexposePort,
  };
}
