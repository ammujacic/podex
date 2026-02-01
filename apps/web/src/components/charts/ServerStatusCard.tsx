'use client';

import { cn } from '@/lib/utils';
import { Server, Cpu, MemoryStick, HardDrive, Wifi } from 'lucide-react';

interface ServerHealth {
  server_id: string;
  status: string;
  is_healthy: boolean;
  cpu_utilization: number;
  memory_utilization: number;
  disk_utilization: number;
  bandwidth_utilization: number;
  active_workspaces: number;
}

interface ServerStatusCardProps {
  server: ServerHealth;
}

function UtilizationBar({ value, icon: Icon }: { value: number; icon: React.ElementType }) {
  const percentage = Math.min(Math.max(value, 0), 100);

  const getColor = () => {
    if (percentage >= 90) return 'bg-red-500';
    if (percentage >= 70) return 'bg-amber-500';
    return 'bg-emerald-500';
  };

  return (
    <div className="flex items-center gap-2">
      <Icon className="h-3 w-3 text-text-muted flex-shrink-0" />
      <div className="flex-1">
        <div className="h-1.5 bg-elevated rounded-full overflow-hidden">
          <div
            className={cn('h-full rounded-full transition-all duration-300', getColor())}
            style={{ width: `${percentage}%` }}
          />
        </div>
      </div>
      <span className="text-xs text-text-muted w-8 text-right">{percentage.toFixed(0)}%</span>
    </div>
  );
}

export function ServerStatusCard({ server }: ServerStatusCardProps) {
  const statusColors: Record<string, string> = {
    active: 'bg-emerald-500',
    draining: 'bg-amber-500',
    offline: 'bg-gray-500',
    error: 'bg-red-500',
  };

  return (
    <div className="bg-surface rounded-lg p-4 border border-border-subtle hover:border-border-default transition-colors">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Server className="h-4 w-4 text-text-muted" />
          <span className="text-sm font-medium text-text-primary truncate max-w-[120px]">
            {server.server_id}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div
            className={cn(
              'w-2 h-2 rounded-full',
              server.is_healthy ? 'bg-emerald-500' : 'bg-red-500'
            )}
          />
          <span
            className={cn(
              'text-xs px-1.5 py-0.5 rounded',
              statusColors[server.status] || 'bg-gray-500',
              'bg-opacity-20 text-text-secondary'
            )}
          >
            {server.status}
          </span>
        </div>
      </div>

      <div className="space-y-2">
        <UtilizationBar value={server.cpu_utilization} icon={Cpu} />
        <UtilizationBar value={server.memory_utilization} icon={MemoryStick} />
        <UtilizationBar value={server.disk_utilization} icon={HardDrive} />
        <UtilizationBar value={server.bandwidth_utilization} icon={Wifi} />
      </div>

      <div className="mt-3 pt-3 border-t border-border-subtle">
        <div className="flex items-center justify-between text-xs">
          <span className="text-text-muted">Workspaces</span>
          <span className="text-text-primary font-medium">{server.active_workspaces}</span>
        </div>
      </div>
    </div>
  );
}
