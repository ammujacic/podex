'use client';

import { useEffect, useState } from 'react';
import {
  Plus,
  Server,
  Cpu,
  Activity,
  AlertTriangle,
  Check,
  Play,
  Pause,
  Trash2,
  RefreshCw,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  useAdminStore,
  type AdminWorkspaceServer,
  type ClusterStatus,
  type CreateServerRequest,
} from '@/stores/admin';

function formatBytes(mb: number): string {
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(1)} GB`;
  }
  return `${mb} MB`;
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'active':
      return 'text-green-500';
    case 'draining':
      return 'text-yellow-500';
    case 'maintenance':
      return 'text-blue-500';
    case 'offline':
    case 'error':
      return 'text-red-500';
    default:
      return 'text-text-muted';
  }
}

function getStatusBgColor(status: string): string {
  switch (status) {
    case 'active':
      return 'bg-green-500/10';
    case 'draining':
      return 'bg-yellow-500/10';
    case 'maintenance':
      return 'bg-blue-500/10';
    case 'offline':
    case 'error':
      return 'bg-red-500/10';
    default:
      return 'bg-elevated';
  }
}

interface UtilizationBarProps {
  label: string;
  used: number;
  total: number;
  unit?: string;
}

function UtilizationBar({ label, used, total, unit = '' }: UtilizationBarProps) {
  const percent = total > 0 ? (used / total) * 100 : 0;
  const color = percent > 90 ? 'bg-red-500' : percent > 70 ? 'bg-yellow-500' : 'bg-green-500';

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-text-muted">{label}</span>
        <span className="text-text-secondary">
          {used.toFixed(1)}
          {unit} / {total}
          {unit} ({percent.toFixed(0)}%)
        </span>
      </div>
      <div className="h-2 bg-elevated rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all', color)}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

interface ServerCardProps {
  server: AdminWorkspaceServer;
  onDrain: (serverId: string) => void;
  onActivate: (serverId: string) => void;
  onDelete: (serverId: string) => void;
}

function ServerCard({ server, onDrain, onActivate, onDelete }: ServerCardProps) {
  return (
    <div
      className={cn(
        'bg-surface rounded-xl border p-6',
        server.is_healthy ? 'border-border-subtle' : 'border-red-500/30'
      )}
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              'w-10 h-10 rounded-lg flex items-center justify-center',
              getStatusBgColor(server.status)
            )}
          >
            <Server className={cn('h-5 w-5', getStatusColor(server.status))} />
          </div>
          <div>
            <h3 className="font-semibold text-text-primary">{server.name}</h3>
            <p className="text-text-muted text-sm">{server.hostname}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {server.status === 'active' ? (
            <button
              onClick={() => onDrain(server.id)}
              className="p-2 hover:bg-yellow-500/10 rounded-lg transition-colors"
              title="Drain server"
            >
              <Pause className="h-4 w-4 text-yellow-500" />
            </button>
          ) : server.status === 'draining' ? (
            <button
              onClick={() => onActivate(server.id)}
              className="p-2 hover:bg-green-500/10 rounded-lg transition-colors"
              title="Activate server"
            >
              <Play className="h-4 w-4 text-green-500" />
            </button>
          ) : null}
          <button
            onClick={() => onDelete(server.id)}
            className="p-2 hover:bg-red-500/10 rounded-lg transition-colors"
            title="Delete server"
          >
            <Trash2 className="h-4 w-4 text-red-500" />
          </button>
        </div>
      </div>

      {/* Status & Health */}
      <div className="flex items-center gap-4 mb-4">
        <span
          className={cn(
            'px-2 py-1 rounded text-xs font-medium',
            getStatusBgColor(server.status),
            getStatusColor(server.status)
          )}
        >
          {server.status.toUpperCase()}
        </span>
        <span
          className={cn(
            'flex items-center gap-1 text-xs',
            server.is_healthy ? 'text-green-500' : 'text-red-500'
          )}
        >
          {server.is_healthy ? (
            <Check className="h-3 w-3" />
          ) : (
            <AlertTriangle className="h-3 w-3" />
          )}
          {server.is_healthy ? 'Healthy' : 'Unhealthy'}
        </span>
      </div>

      {/* Specs */}
      <div className="grid grid-cols-2 gap-4 mb-4 text-sm">
        <div className="flex items-center gap-2">
          <Cpu className="h-4 w-4 text-text-muted" />
          <span className="text-text-secondary">{server.architecture}</span>
        </div>
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-text-muted" />
          <span className="text-text-secondary">{server.active_workspaces} workspaces</span>
        </div>
        {server.has_gpu && (
          <div className="flex items-center gap-2 col-span-2">
            <Zap className="h-4 w-4 text-yellow-500" />
            <span className="text-text-secondary">
              {server.gpu_count}x {server.gpu_type || 'GPU'}
            </span>
          </div>
        )}
        {server.region && (
          <div className="flex items-center gap-2">
            <Server className="h-4 w-4 text-text-muted" />
            <span className="text-text-secondary">{server.region}</span>
          </div>
        )}
      </div>

      {/* Resource Utilization */}
      <div className="space-y-3">
        <UtilizationBar label="CPU" used={server.used_cpu} total={server.total_cpu} unit=" cores" />
        <UtilizationBar
          label="Memory"
          used={server.used_memory_mb / 1024}
          total={server.total_memory_mb / 1024}
          unit=" GB"
        />
        <UtilizationBar
          label="Disk"
          used={server.used_disk_gb}
          total={server.total_disk_gb}
          unit=" GB"
        />
        <UtilizationBar
          label="Network"
          used={server.used_bandwidth_mbps}
          total={server.total_bandwidth_mbps}
          unit=" Mbps"
        />
      </div>

      {/* Per-Workspace Resources (expandable) */}
      {server.active_workspaces > 0 && (
        <details className="mt-4 pt-4 border-t border-border-subtle">
          <summary className="text-xs font-medium text-text-muted cursor-pointer hover:text-text-primary">
            View {server.active_workspaces} workspace{server.active_workspaces > 1 ? 's' : ''}
          </summary>
          <div className="mt-2 text-xs text-text-muted">
            <p>Workspace-level metrics coming soon</p>
          </div>
        </details>
      )}

      {/* Last Heartbeat */}
      <div className="mt-4 pt-4 border-t border-border-subtle text-xs text-text-muted">
        Last heartbeat:{' '}
        {server.last_heartbeat ? new Date(server.last_heartbeat).toLocaleString() : 'Never'}
      </div>
    </div>
  );
}

interface ClusterOverviewProps {
  status: ClusterStatus;
}

function ClusterOverview({ status }: ClusterOverviewProps) {
  return (
    <div className="bg-surface rounded-xl border border-border-subtle p-6 mb-8">
      <h2 className="text-lg font-semibold text-text-primary mb-4">Cluster Overview</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
        <div>
          <p className="text-text-muted text-sm">Servers</p>
          <p className="text-2xl font-bold text-text-primary">
            {status.healthy_servers}/{status.total_servers}
          </p>
          <p className="text-xs text-text-muted">healthy</p>
        </div>
        <div>
          <p className="text-text-muted text-sm">CPU Usage</p>
          <p className="text-2xl font-bold text-text-primary">
            {status.cpu_utilization.toFixed(1)}%
          </p>
          <p className="text-xs text-text-muted">
            {status.used_cpu.toFixed(1)} / {status.total_cpu} cores
          </p>
        </div>
        <div>
          <p className="text-text-muted text-sm">Memory Usage</p>
          <p className="text-2xl font-bold text-text-primary">
            {status.memory_utilization.toFixed(1)}%
          </p>
          <p className="text-xs text-text-muted">
            {formatBytes(status.used_memory_mb)} / {formatBytes(status.total_memory_mb)}
          </p>
        </div>
        <div>
          <p className="text-text-muted text-sm">Workspaces</p>
          <p className="text-2xl font-bold text-text-primary">{status.total_workspaces}</p>
          <p className="text-xs text-text-muted">active</p>
        </div>
      </div>
    </div>
  );
}

interface AddServerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: CreateServerRequest) => Promise<AdminWorkspaceServer>;
}

function AddServerModal({ isOpen, onClose, onSubmit }: AddServerModalProps) {
  const [formData, setFormData] = useState<CreateServerRequest>({
    name: '',
    hostname: '',
    ip_address: '',
    docker_port: 2376,
    total_cpu: 4,
    total_memory_mb: 8192,
    total_disk_gb: 100,
    total_bandwidth_mbps: 1000,
    architecture: 'amd64',
    region: '',
    has_gpu: false,
    gpu_type: '',
    gpu_count: 0,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await onSubmit(formData);
      onClose();
      setFormData({
        name: '',
        hostname: '',
        ip_address: '',
        docker_port: 2376,
        total_cpu: 4,
        total_memory_mb: 8192,
        total_disk_gb: 100,
        total_bandwidth_mbps: 1000,
        architecture: 'amd64',
        region: '',
        has_gpu: false,
        gpu_type: '',
        gpu_count: 0,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-surface rounded-xl border border-border-subtle p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <h2 className="text-xl font-semibold text-text-primary mb-4">Add Workspace Server</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-text-secondary mb-1">Name</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-3 py-2 bg-elevated border border-border-subtle rounded-lg text-text-primary"
                required
              />
            </div>
            <div>
              <label className="block text-sm text-text-secondary mb-1">Hostname</label>
              <input
                type="text"
                value={formData.hostname}
                onChange={(e) => setFormData({ ...formData, hostname: e.target.value })}
                className="w-full px-3 py-2 bg-elevated border border-border-subtle rounded-lg text-text-primary"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-text-secondary mb-1">IP Address</label>
              <input
                type="text"
                value={formData.ip_address}
                onChange={(e) => setFormData({ ...formData, ip_address: e.target.value })}
                className="w-full px-3 py-2 bg-elevated border border-border-subtle rounded-lg text-text-primary"
                placeholder="192.168.1.100"
                required
              />
            </div>
            <div>
              <label className="block text-sm text-text-secondary mb-1">Docker Port</label>
              <input
                type="number"
                value={formData.docker_port}
                onChange={(e) =>
                  setFormData({ ...formData, docker_port: parseInt(e.target.value) })
                }
                className="w-full px-3 py-2 bg-elevated border border-border-subtle rounded-lg text-text-primary"
              />
            </div>
          </div>

          <div className="grid grid-cols-4 gap-4">
            <div>
              <label className="block text-sm text-text-secondary mb-1">CPU Cores</label>
              <input
                type="number"
                value={formData.total_cpu}
                onChange={(e) => setFormData({ ...formData, total_cpu: parseInt(e.target.value) })}
                className="w-full px-3 py-2 bg-elevated border border-border-subtle rounded-lg text-text-primary"
                min={1}
                required
              />
            </div>
            <div>
              <label className="block text-sm text-text-secondary mb-1">Memory (MB)</label>
              <input
                type="number"
                value={formData.total_memory_mb}
                onChange={(e) =>
                  setFormData({ ...formData, total_memory_mb: parseInt(e.target.value) })
                }
                className="w-full px-3 py-2 bg-elevated border border-border-subtle rounded-lg text-text-primary"
                min={512}
                step={512}
                required
              />
            </div>
            <div>
              <label className="block text-sm text-text-secondary mb-1">Disk (GB)</label>
              <input
                type="number"
                value={formData.total_disk_gb}
                onChange={(e) =>
                  setFormData({ ...formData, total_disk_gb: parseInt(e.target.value) })
                }
                className="w-full px-3 py-2 bg-elevated border border-border-subtle rounded-lg text-text-primary"
                min={1}
                required
              />
            </div>
            <div>
              <label className="block text-sm text-text-secondary mb-1">Bandwidth (Mbps)</label>
              <input
                type="number"
                value={formData.total_bandwidth_mbps}
                onChange={(e) =>
                  setFormData({ ...formData, total_bandwidth_mbps: parseInt(e.target.value) })
                }
                className="w-full px-3 py-2 bg-elevated border border-border-subtle rounded-lg text-text-primary"
                min={100}
                step={100}
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-text-secondary mb-1">Architecture</label>
              <select
                value={formData.architecture}
                onChange={(e) => setFormData({ ...formData, architecture: e.target.value })}
                className="w-full px-3 py-2 bg-elevated border border-border-subtle rounded-lg text-text-primary"
              >
                <option value="amd64">x86_64 (amd64)</option>
                <option value="arm64">ARM64 (arm64)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-text-secondary mb-1">Region</label>
              <input
                type="text"
                value={formData.region || ''}
                onChange={(e) => setFormData({ ...formData, region: e.target.value })}
                className="w-full px-3 py-2 bg-elevated border border-border-subtle rounded-lg text-text-primary"
                placeholder="us-east-1"
              />
            </div>
          </div>

          <div className="border-t border-border-subtle pt-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.has_gpu}
                onChange={(e) => setFormData({ ...formData, has_gpu: e.target.checked })}
                className="rounded border-border-subtle"
              />
              <span className="text-sm text-text-secondary">Has GPU</span>
            </label>

            {formData.has_gpu && (
              <div className="grid grid-cols-2 gap-4 mt-4">
                <div>
                  <label className="block text-sm text-text-secondary mb-1">GPU Type</label>
                  <input
                    type="text"
                    value={formData.gpu_type || ''}
                    onChange={(e) => setFormData({ ...formData, gpu_type: e.target.value })}
                    className="w-full px-3 py-2 bg-elevated border border-border-subtle rounded-lg text-text-primary"
                    placeholder="NVIDIA A100"
                  />
                </div>
                <div>
                  <label className="block text-sm text-text-secondary mb-1">GPU Count</label>
                  <input
                    type="number"
                    value={formData.gpu_count}
                    onChange={(e) =>
                      setFormData({ ...formData, gpu_count: parseInt(e.target.value) })
                    }
                    className="w-full px-3 py-2 bg-elevated border border-border-subtle rounded-lg text-text-primary"
                    min={1}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-text-secondary hover:text-text-primary transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 bg-accent-primary text-white rounded-lg hover:bg-accent-primary/90 transition-colors disabled:opacity-50"
            >
              {isSubmitting ? 'Adding...' : 'Add Server'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function ServersManagement() {
  const {
    workspaceServers,
    workspaceServersLoading,
    clusterStatus,
    clusterStatusLoading,
    fetchWorkspaceServers,
    fetchClusterStatus,
    createWorkspaceServer,
    drainWorkspaceServer,
    activateWorkspaceServer,
    deleteWorkspaceServer,
    error,
  } = useAdminStore();

  const [showAddModal, setShowAddModal] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('');

  useEffect(() => {
    fetchWorkspaceServers();
    fetchClusterStatus();
  }, [fetchWorkspaceServers, fetchClusterStatus]);

  const handleRefresh = () => {
    fetchWorkspaceServers(statusFilter || undefined);
    fetchClusterStatus();
  };

  const handleDrain = async (serverId: string) => {
    if (
      confirm('Are you sure you want to drain this server? No new workspaces will be placed on it.')
    ) {
      await drainWorkspaceServer(serverId);
    }
  };

  const handleActivate = async (serverId: string) => {
    await activateWorkspaceServer(serverId);
  };

  const handleDelete = async (serverId: string) => {
    const server = workspaceServers.find((s) => s.id === serverId);
    if (!server) return;

    if (server.active_workspaces > 0) {
      if (
        !confirm(
          `This server has ${server.active_workspaces} active workspaces. Are you sure you want to force delete it?`
        )
      ) {
        return;
      }
      await deleteWorkspaceServer(serverId, true);
    } else {
      if (confirm('Are you sure you want to delete this server?')) {
        await deleteWorkspaceServer(serverId);
      }
    }
  };

  const filteredServers = statusFilter
    ? workspaceServers.filter((s) => s.status === statusFilter)
    : workspaceServers;

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">Workspace Servers</h1>
          <p className="text-text-muted mt-1">Manage compute infrastructure for workspaces</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleRefresh}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border-subtle hover:bg-elevated transition-colors"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent-primary text-white hover:bg-accent-primary/90 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Add Server
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 text-red-500 p-4 rounded-lg mb-6">Error: {error}</div>
      )}

      {/* Cluster Overview */}
      {clusterStatusLoading ? (
        <div className="bg-surface rounded-xl border border-border-subtle p-6 mb-8 animate-pulse">
          <div className="h-6 bg-elevated rounded w-48 mb-4" />
          <div className="grid grid-cols-4 gap-6">
            {[...Array(4)].map((_, i) => (
              <div key={i}>
                <div className="h-4 bg-elevated rounded w-24 mb-2" />
                <div className="h-8 bg-elevated rounded w-16" />
              </div>
            ))}
          </div>
        </div>
      ) : clusterStatus ? (
        <ClusterOverview status={clusterStatus} />
      ) : null}

      {/* Filters */}
      <div className="flex items-center gap-4 mb-6">
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            fetchWorkspaceServers(e.target.value || undefined);
          }}
          className="px-3 py-2 bg-elevated border border-border-subtle rounded-lg text-text-primary"
        >
          <option value="">All Statuses</option>
          <option value="active">Active</option>
          <option value="draining">Draining</option>
          <option value="maintenance">Maintenance</option>
          <option value="offline">Offline</option>
          <option value="error">Error</option>
        </select>
      </div>

      {/* Server Grid */}
      {workspaceServersLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[...Array(3)].map((_, i) => (
            <div
              key={i}
              className="bg-surface rounded-xl border border-border-subtle p-6 animate-pulse"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-elevated rounded-lg" />
                <div>
                  <div className="h-5 bg-elevated rounded w-32 mb-1" />
                  <div className="h-4 bg-elevated rounded w-24" />
                </div>
              </div>
              <div className="space-y-3">
                <div className="h-4 bg-elevated rounded w-full" />
                <div className="h-4 bg-elevated rounded w-3/4" />
              </div>
            </div>
          ))}
        </div>
      ) : filteredServers.length === 0 ? (
        <div className="bg-surface rounded-xl border border-border-subtle p-12 text-center">
          <Server className="h-12 w-12 text-text-muted mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-text-primary mb-2">No Servers Found</h3>
          <p className="text-text-muted mb-4">
            {statusFilter
              ? `No servers with status "${statusFilter}"`
              : 'Add a workspace server to get started'}
          </p>
          <button
            onClick={() => setShowAddModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-accent-primary text-white hover:bg-accent-primary/90 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Add Server
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredServers.map((server) => (
            <ServerCard
              key={server.id}
              server={server}
              onDrain={handleDrain}
              onActivate={handleActivate}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      {/* Add Server Modal */}
      <AddServerModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSubmit={createWorkspaceServer}
      />
    </div>
  );
}
