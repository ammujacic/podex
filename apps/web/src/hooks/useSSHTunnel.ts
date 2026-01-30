import { useState, useEffect, useCallback } from 'react';
import { getSSHTunnel, enableSSHTunnel, disableSSHTunnel, type SSHTunnelResponse } from '@/lib/api';

export interface UseSSHTunnelReturn {
  sshTunnel: SSHTunnelResponse | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  enable: () => Promise<SSHTunnelResponse | null>;
  disable: () => Promise<void>;
  enabling: boolean;
  disabling: boolean;
}

export function useSSHTunnel(workspaceId: string | null): UseSSHTunnelReturn {
  const [sshTunnel, setSSHTunnel] = useState<SSHTunnelResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enabling, setEnabling] = useState(false);
  const [disabling, setDisabling] = useState(false);

  const fetchSSHTunnel = useCallback(async () => {
    if (!workspaceId) {
      setSSHTunnel(null);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const res = await getSSHTunnel(workspaceId);
      setSSHTunnel(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load SSH tunnel');
      setSSHTunnel(null);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    fetchSSHTunnel();
  }, [fetchSSHTunnel]);

  const doEnable = useCallback(async (): Promise<SSHTunnelResponse | null> => {
    if (!workspaceId) return null;
    try {
      setError(null);
      setEnabling(true);
      const res = await enableSSHTunnel(workspaceId);
      setSSHTunnel(res);
      return res;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to enable SSH tunnel');
      return null;
    } finally {
      setEnabling(false);
    }
  }, [workspaceId]);

  const doDisable = useCallback(async () => {
    if (!workspaceId) return;
    try {
      setError(null);
      setDisabling(true);
      await disableSSHTunnel(workspaceId);
      setSSHTunnel({
        enabled: false,
        hostname: null,
        public_url: null,
        status: null,
        connection_string: null,
        proxy_command: null,
        ssh_config_snippet: null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disable SSH tunnel');
    } finally {
      setDisabling(false);
    }
  }, [workspaceId]);

  return {
    sshTunnel,
    loading,
    error,
    refetch: fetchSSHTunnel,
    enable: doEnable,
    disable: doDisable,
    enabling,
    disabling,
  };
}
