/**
 * Local pod discovery hook.
 */

import { useState, useEffect, useCallback } from 'react';
import { discoverLocalPod, waitForLocalPod, type LocalPodInfo } from '@podex/local-pod-discovery';

interface UseLocalPodOptions {
  autoDiscover?: boolean;
  pollInterval?: number;
}

interface UseLocalPodReturn {
  localPod: LocalPodInfo | null;
  isDiscovering: boolean;
  error: string | null;
  discover: () => Promise<void>;
  waitForPod: (timeout?: number) => Promise<LocalPodInfo | null>;
}

export function useLocalPod(options: UseLocalPodOptions = {}): UseLocalPodReturn {
  const { autoDiscover = true, pollInterval = 5000 } = options;

  const [localPod, setLocalPod] = useState<LocalPodInfo | null>(null);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const discover = useCallback(async () => {
    setIsDiscovering(true);
    setError(null);

    try {
      const pod = await discoverLocalPod();
      setLocalPod(pod);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsDiscovering(false);
    }
  }, []);

  const waitForPod = useCallback(async (timeout = 30000): Promise<LocalPodInfo | null> => {
    setIsDiscovering(true);
    setError(null);

    try {
      const pod = await waitForLocalPod({}, timeout);
      setLocalPod(pod);
      return pod;
    } catch (err) {
      setError((err as Error).message);
      return null;
    } finally {
      setIsDiscovering(false);
    }
  }, []);

  // Auto-discover on mount and poll periodically
  useEffect(() => {
    if (!autoDiscover) return;

    discover();

    const interval = setInterval(discover, pollInterval);
    return () => clearInterval(interval);
  }, [autoDiscover, pollInterval, discover]);

  return {
    localPod,
    isDiscovering,
    error,
    discover,
    waitForPod,
  };
}
