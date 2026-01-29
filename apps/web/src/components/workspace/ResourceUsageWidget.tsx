'use client';

import { useState, useEffect, useCallback } from 'react';
import { Cpu, MemoryStick, HardDrive, Wifi, RefreshCw, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getWorkspaceResources, type WorkspaceResourceMetrics } from '@/lib/api';
import { useSessionStore } from '@/stores/session';

interface ResourceUsageWidgetProps {
  sessionId: string;
  isVisible?: boolean;
}

function formatBytes(mb: number): string {
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(1)} GB`;
  }
  if (mb >= 1) {
    return `${mb.toFixed(1)} MB`;
  }
  return `${(mb * 1024).toFixed(0)} KB`;
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${mins}m`;
}

interface UtilizationBarProps {
  label: string;
  icon: React.ReactNode;
  value: number;
  limit: number;
  unit?: string;
  showPercentage?: boolean;
}

function UtilizationBar({
  label,
  icon,
  value,
  limit,
  unit = '',
  showPercentage = true,
}: UtilizationBarProps) {
  const percent = limit > 0 ? (value / limit) * 100 : 0;
  const color = percent > 90 ? 'bg-red-500' : percent > 70 ? 'bg-yellow-500' : 'bg-accent-primary';

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-1.5 text-text-muted">
          {icon}
          <span>{label}</span>
        </div>
        <span className="text-text-secondary font-mono">
          {showPercentage ? `${percent.toFixed(0)}%` : `${value.toFixed(1)}${unit}`}
        </span>
      </div>
      <div className="h-1.5 bg-elevated rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all', color)}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
      {showPercentage && (
        <div className="text-[10px] text-text-muted text-right">
          {formatBytes(value)} / {formatBytes(limit)}
        </div>
      )}
    </div>
  );
}

interface IOStatProps {
  label: string;
  icon: React.ReactNode;
  rxValue: number;
  txValue: number;
}

function IOStat({ label, icon, rxValue, txValue }: IOStatProps) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-xs text-text-muted">
        {icon}
        <span>{label}</span>
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-green-500">↓ {formatBytes(rxValue)}</span>
        <span className="text-blue-500">↑ {formatBytes(txValue)}</span>
      </div>
    </div>
  );
}

export function ResourceUsageWidget({ sessionId, isVisible = true }: ResourceUsageWidgetProps) {
  const [metrics, setMetrics] = useState<WorkspaceResourceMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const session = useSessionStore((state) => state.sessions[sessionId]);
  const workspaceId = session?.workspaceId;

  const fetchMetrics = useCallback(async () => {
    if (!workspaceId) return;

    try {
      setLoading(true);
      setError(null);
      const data = await getWorkspaceResources(workspaceId);
      setMetrics(data);
      setLastUpdated(new Date());
    } catch (err) {
      console.error('Failed to fetch workspace resources:', err);
      setError('Failed to load metrics');
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  // Initial fetch and polling
  useEffect(() => {
    if (!isVisible || !workspaceId) return;

    // Fetch immediately
    fetchMetrics();

    // Poll every 30 seconds
    const interval = setInterval(fetchMetrics, 30000);
    return () => clearInterval(interval);
  }, [isVisible, workspaceId, fetchMetrics]);

  if (!workspaceId) {
    return (
      <div className="flex flex-col items-center justify-center h-32 text-center px-4">
        <Cpu className="h-8 w-8 text-text-muted mb-2" />
        <p className="text-xs text-text-muted">No workspace connected</p>
      </div>
    );
  }

  if (loading && !metrics) {
    return (
      <div className="flex items-center justify-center h-32">
        <Loader2 className="h-5 w-5 animate-spin text-text-muted" />
      </div>
    );
  }

  if (error && !metrics) {
    return (
      <div className="flex flex-col items-center justify-center h-32 text-center px-4">
        <Cpu className="h-8 w-8 text-red-500 mb-2" />
        <p className="text-xs text-red-500">{error}</p>
        <button onClick={fetchMetrics} className="mt-2 text-xs text-accent-primary hover:underline">
          Retry
        </button>
      </div>
    );
  }

  const cpuValue = metrics?.cpu_percent ?? 0;
  const cpuLimit = (metrics?.cpu_limit_cores ?? 1) * 100; // Convert cores to percentage scale
  const memValue = metrics?.memory_used_mb ?? 0;
  const memLimit = metrics?.memory_limit_mb ?? 1024;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 border-b border-border-subtle flex items-center justify-between">
        <span className="text-xs font-medium text-text-muted">Container Resources</span>
        <button
          onClick={fetchMetrics}
          disabled={loading}
          className="p-1 hover:bg-elevated rounded transition-colors"
          title="Refresh"
        >
          <RefreshCw className={cn('h-3.5 w-3.5 text-text-muted', loading && 'animate-spin')} />
        </button>
      </div>

      {/* Metrics */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* CPU */}
        <UtilizationBar
          label="CPU"
          icon={<Cpu className="h-3.5 w-3.5" />}
          value={cpuValue}
          limit={cpuLimit}
          showPercentage={true}
        />

        {/* Memory */}
        <UtilizationBar
          label="Memory"
          icon={<MemoryStick className="h-3.5 w-3.5" />}
          value={memValue}
          limit={memLimit}
          showPercentage={true}
        />

        {/* Disk I/O */}
        <IOStat
          label="Disk I/O"
          icon={<HardDrive className="h-3.5 w-3.5" />}
          rxValue={metrics?.disk_read_mb ?? 0}
          txValue={metrics?.disk_write_mb ?? 0}
        />

        {/* Network */}
        <IOStat
          label="Network"
          icon={<Wifi className="h-3.5 w-3.5" />}
          rxValue={metrics?.network_rx_mb ?? 0}
          txValue={metrics?.network_tx_mb ?? 0}
        />
      </div>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-border-subtle text-[10px] text-text-muted flex items-center justify-between">
        <span>
          Uptime:{' '}
          {metrics?.container_uptime_seconds ? formatUptime(metrics.container_uptime_seconds) : '-'}
        </span>
        <span>
          Updated{' '}
          {lastUpdated ? `${Math.floor((Date.now() - lastUpdated.getTime()) / 1000)}s ago` : '-'}
        </span>
      </div>
    </div>
  );
}
