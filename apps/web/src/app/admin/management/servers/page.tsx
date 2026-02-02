'use client';

import { useEffect, useState } from 'react';
import {
  Plus,
  Server,
  Cpu,
  Boxes,
  AlertTriangle,
  Check,
  Play,
  Pause,
  Trash2,
  RefreshCw,
  Zap,
  MapPin,
  Users,
  Clock,
  Loader2,
  User,
  HardDrive,
  Pencil,
  ChevronDown,
  ChevronRight,
  Lock,
  Unlock,
  Settings,
  Package,
  Download,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  useAdminStore,
  type AdminWorkspaceServer,
  type ClusterStatus,
  type CreateServerRequest,
  type TestServerConnectionResponse,
} from '@/stores/admin';
import type { ServerWorkspaceInfo } from '@/lib/api';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

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

function formatTimeAgo(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

interface WorkspaceRowProps {
  workspace: ServerWorkspaceInfo;
}

function WorkspaceRow({ workspace }: WorkspaceRowProps) {
  const statusColors: Record<string, string> = {
    running: 'text-green-500',
    starting: 'text-yellow-500',
    stopping: 'text-yellow-500',
    stopped: 'text-text-muted',
    error: 'text-red-500',
  };

  return (
    <div className="flex items-center justify-between py-2 px-3 bg-elevated/50 rounded-lg">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <User className="h-3.5 w-3.5 text-text-muted flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-text-primary truncate">
            {workspace.user_email || workspace.user_id.slice(0, 8)}
          </p>
          <p className="text-[10px] text-text-muted truncate">
            {workspace.workspace_id.slice(0, 8)}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-4 text-[10px] text-text-muted flex-shrink-0">
        <span className={cn('font-medium', statusColors[workspace.status] || 'text-text-muted')}>
          {workspace.status}
        </span>
        {workspace.assigned_cpu && (
          <span className="flex items-center gap-1">
            <Cpu className="h-3 w-3" />
            {workspace.assigned_cpu}
          </span>
        )}
        {workspace.assigned_memory_mb && (
          <span className="flex items-center gap-1">
            <HardDrive className="h-3 w-3" />
            {formatBytes(workspace.assigned_memory_mb)}
          </span>
        )}
        <span className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {formatTimeAgo(workspace.last_activity)}
        </span>
      </div>
    </div>
  );
}

interface ServerCardProps {
  server: AdminWorkspaceServer;
  onDrain: (serverId: string) => void;
  onActivate: (serverId: string) => void;
  onDelete: (serverId: string) => void;
  onEdit: (server: AdminWorkspaceServer) => void;
}

function ServerCard({ server, onDrain, onActivate, onDelete, onEdit }: ServerCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [showImages, setShowImages] = useState(false);
  const {
    serverWorkspaces,
    serverWorkspacesLoading,
    fetchServerWorkspaces,
    serverImages,
    serverImagesLoading,
    imagePullLoading,
    fetchServerImages,
    pullServerImage,
  } = useAdminStore();

  const workspaces = serverWorkspaces[server.id] ?? [];
  const isLoadingWorkspaces = serverWorkspacesLoading[server.id] ?? false;
  const hasLoadedWorkspaces = server.id in serverWorkspaces;

  const handleToggleExpand = () => {
    const newExpanded = !isExpanded;
    setIsExpanded(newExpanded);
    // Lazy load workspaces when expanding for the first time
    if (newExpanded && !hasLoadedWorkspaces && server.active_workspaces > 0) {
      fetchServerWorkspaces(server.id);
    }
  };

  // Docker images state
  const images = serverImages[server.id];
  const isLoadingImages = serverImagesLoading[server.id] ?? false;
  const isPulling = imagePullLoading[server.id] ?? false;
  const hasLoadedImages = server.id in serverImages;

  const handleToggleImages = () => {
    const newExpanded = !showImages;
    setShowImages(newExpanded);
    if (newExpanded && !hasLoadedImages) {
      fetchServerImages(server.id);
    }
  };

  // Check if a configured image is loaded on the server
  const isImageLoaded = (imageName: string | null): boolean => {
    if (!imageName || !images) return false;
    return images.images.some((img) => img.tags.includes(imageName));
  };

  const handlePullImage = async (image: string) => {
    // Parse image:tag format
    const lastColonIndex = image.lastIndexOf(':');
    const imageName = lastColonIndex > 0 ? image.slice(0, lastColonIndex) : image;
    const tag = lastColonIndex > 0 ? image.slice(lastColonIndex + 1) : 'latest';
    try {
      await pullServerImage(server.id, imageName, tag);
    } catch {
      // Error handled in store
    }
  };

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
            onClick={() => onEdit(server)}
            className="p-2 hover:bg-blue-500/10 rounded-lg transition-colors"
            title="Edit server"
          >
            <Pencil className="h-4 w-4 text-blue-500" />
          </button>
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
          <Boxes className="h-4 w-4 text-text-muted" />
          <span className="text-text-secondary">{server.active_workspaces} workspaces</span>
        </div>
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-text-muted" />
          <span className="text-text-secondary">{server.region || 'No region'}</span>
        </div>
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-text-muted" />
          <span className="text-text-secondary">max {server.max_workspaces}</span>
        </div>
        {server.has_gpu && (
          <div className="flex items-center gap-2 col-span-2">
            <Zap className="h-4 w-4 text-yellow-500" />
            <span className="text-text-secondary">
              {server.gpu_count}x {server.gpu_type || 'GPU'}
            </span>
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
        <div className="mt-4 pt-4 border-t border-border-subtle">
          <button
            onClick={handleToggleExpand}
            className="text-xs font-medium text-text-muted cursor-pointer hover:text-text-primary flex items-center gap-1"
          >
            <span className={cn('transition-transform', isExpanded ? 'rotate-90' : '')}>▶</span>
            View {server.active_workspaces} workspace{server.active_workspaces > 1 ? 's' : ''}
          </button>
          {isExpanded && (
            <div className="mt-3 space-y-2">
              {isLoadingWorkspaces ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-4 w-4 animate-spin text-text-muted" />
                  <span className="ml-2 text-xs text-text-muted">Loading workspaces...</span>
                </div>
              ) : workspaces.length > 0 ? (
                workspaces.map((ws) => <WorkspaceRow key={ws.workspace_id} workspace={ws} />)
              ) : (
                <p className="text-xs text-text-muted py-2">No workspace details available</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Last Heartbeat */}
      <div className="mt-4 pt-4 border-t border-border-subtle text-xs text-text-muted">
        Last heartbeat:{' '}
        {server.last_heartbeat ? new Date(server.last_heartbeat).toLocaleString() : 'Never'}
      </div>

      {/* Configuration Details (expandable) */}
      <div className="mt-4 pt-4 border-t border-border-subtle">
        <button
          onClick={() => setShowConfig(!showConfig)}
          className="text-xs font-medium text-text-muted cursor-pointer hover:text-text-primary flex items-center gap-1 w-full"
        >
          {showConfig ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          <Settings className="h-3 w-3 mr-1" />
          Configuration
        </button>
        {showConfig && (
          <div className="mt-3 space-y-2 text-xs bg-elevated/50 rounded-lg p-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-text-muted">ID:</span>
                <span className="ml-2 text-text-secondary font-mono">{server.id}</span>
              </div>
              <div>
                <span className="text-text-muted">IP:</span>
                <span className="ml-2 text-text-secondary font-mono">{server.ip_address}</span>
              </div>
              <div>
                <span className="text-text-muted">Port:</span>
                <span className="ml-2 text-text-secondary font-mono">{server.docker_port}</span>
              </div>
              <div className="col-span-2">
                <span className="text-text-muted">Compute URL:</span>
                <span
                  className="ml-2 text-text-secondary font-mono text-[10px] break-all"
                  title={server.compute_service_url}
                >
                  {server.compute_service_url}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-text-muted">TLS:</span>
                {server.tls_enabled ? (
                  <span className="flex items-center gap-1 text-green-500">
                    <Lock className="h-3 w-3" />
                    Enabled
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-yellow-500">
                    <Unlock className="h-3 w-3" />
                    Disabled
                  </span>
                )}
              </div>
            </div>
            {server.tls_enabled && (
              <div className="mt-2 pt-2 border-t border-border-subtle space-y-1">
                <div>
                  <span className="text-text-muted">Cert:</span>
                  <span className="ml-2 text-text-secondary font-mono text-[10px] break-all">
                    {server.tls_cert_path || <span className="text-red-400">NOT SET</span>}
                  </span>
                </div>
                <div>
                  <span className="text-text-muted">Key:</span>
                  <span className="ml-2 text-text-secondary font-mono text-[10px] break-all">
                    {server.tls_key_path || <span className="text-red-400">NOT SET</span>}
                  </span>
                </div>
                <div>
                  <span className="text-text-muted">CA:</span>
                  <span className="ml-2 text-text-secondary font-mono text-[10px] break-all">
                    {server.tls_ca_path || <span className="text-red-400">NOT SET</span>}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Docker Images Section */}
      <div className="mt-4 pt-4 border-t border-border-subtle">
        <button
          onClick={handleToggleImages}
          className="text-xs font-medium text-text-muted cursor-pointer hover:text-text-primary flex items-center gap-1 w-full"
        >
          {showImages ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          <Package className="h-3 w-3 mr-1" />
          Docker Images
        </button>
        {showImages && (
          <div className="mt-3 space-y-3 text-xs bg-elevated/50 rounded-lg p-3">
            {/* Configured Images */}
            <div className="space-y-2">
              <h4 className="text-text-muted font-medium">Configured Images</h4>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-text-muted">Default:</span>
                  <div className="flex items-center gap-2">
                    <span
                      className="font-mono text-text-secondary truncate max-w-[180px]"
                      title={server.workspace_image}
                    >
                      {server.workspace_image}
                    </span>
                    {isPulling ? (
                      <Loader2 className="h-3 w-3 animate-spin text-blue-500" />
                    ) : isImageLoaded(server.workspace_image) ? (
                      <span title="Loaded">
                        <Check className="h-3 w-3 text-green-500" />
                      </span>
                    ) : (
                      <>
                        <span title="Not loaded">
                          <AlertTriangle className="h-3 w-3 text-yellow-500" />
                        </span>
                        <button
                          onClick={() => handlePullImage(server.workspace_image)}
                          disabled={isPulling}
                          className="p-1 hover:bg-blue-500/10 rounded transition-colors disabled:opacity-50"
                          title="Pull image"
                        >
                          <Download className="h-3 w-3 text-blue-500" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {server.workspace_image_arm64 && (
                  <div className="flex items-center justify-between">
                    <span className="text-text-muted">ARM64:</span>
                    <div className="flex items-center gap-2">
                      <span
                        className="font-mono text-text-secondary truncate max-w-[180px]"
                        title={server.workspace_image_arm64}
                      >
                        {server.workspace_image_arm64}
                      </span>
                      {isPulling ? (
                        <Loader2 className="h-3 w-3 animate-spin text-blue-500" />
                      ) : isImageLoaded(server.workspace_image_arm64) ? (
                        <span title="Loaded">
                          <Check className="h-3 w-3 text-green-500" />
                        </span>
                      ) : (
                        <>
                          <span title="Not loaded">
                            <AlertTriangle className="h-3 w-3 text-yellow-500" />
                          </span>
                          <button
                            onClick={() => handlePullImage(server.workspace_image_arm64!)}
                            disabled={isPulling}
                            className="p-1 hover:bg-blue-500/10 rounded transition-colors disabled:opacity-50"
                            title="Pull image"
                          >
                            <Download className="h-3 w-3 text-blue-500" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}
                {server.workspace_image_amd64 && (
                  <div className="flex items-center justify-between">
                    <span className="text-text-muted">AMD64:</span>
                    <div className="flex items-center gap-2">
                      <span
                        className="font-mono text-text-secondary truncate max-w-[180px]"
                        title={server.workspace_image_amd64}
                      >
                        {server.workspace_image_amd64}
                      </span>
                      {isPulling ? (
                        <Loader2 className="h-3 w-3 animate-spin text-blue-500" />
                      ) : isImageLoaded(server.workspace_image_amd64) ? (
                        <span title="Loaded">
                          <Check className="h-3 w-3 text-green-500" />
                        </span>
                      ) : (
                        <>
                          <span title="Not loaded">
                            <AlertTriangle className="h-3 w-3 text-yellow-500" />
                          </span>
                          <button
                            onClick={() => handlePullImage(server.workspace_image_amd64!)}
                            disabled={isPulling}
                            className="p-1 hover:bg-blue-500/10 rounded transition-colors disabled:opacity-50"
                            title="Pull image"
                          >
                            <Download className="h-3 w-3 text-blue-500" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}
                {server.workspace_image_gpu && (
                  <div className="flex items-center justify-between">
                    <span className="text-text-muted">GPU:</span>
                    <div className="flex items-center gap-2">
                      <span
                        className="font-mono text-text-secondary truncate max-w-[180px]"
                        title={server.workspace_image_gpu}
                      >
                        {server.workspace_image_gpu}
                      </span>
                      {isPulling ? (
                        <Loader2 className="h-3 w-3 animate-spin text-blue-500" />
                      ) : isImageLoaded(server.workspace_image_gpu) ? (
                        <span title="Loaded">
                          <Check className="h-3 w-3 text-green-500" />
                        </span>
                      ) : (
                        <>
                          <span title="Not loaded">
                            <AlertTriangle className="h-3 w-3 text-yellow-500" />
                          </span>
                          <button
                            onClick={() => handlePullImage(server.workspace_image_gpu!)}
                            disabled={isPulling}
                            className="p-1 hover:bg-blue-500/10 rounded transition-colors disabled:opacity-50"
                            title="Pull image"
                          >
                            <Download className="h-3 w-3 text-blue-500" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* All Images on Server */}
            {isLoadingImages ? (
              <div className="flex items-center justify-center py-2">
                <Loader2 className="h-4 w-4 animate-spin text-text-muted" />
                <span className="ml-2 text-text-muted">Loading images...</span>
              </div>
            ) : images && images.images.length > 0 ? (
              <div className="space-y-2">
                <h4 className="text-text-muted font-medium">All Images ({images.total_count})</h4>
                <div className="max-h-32 overflow-y-auto space-y-1">
                  {images.images.map((img) => (
                    <div key={img.id} className="flex items-center justify-between text-[10px]">
                      <span className="font-mono text-text-secondary truncate max-w-[180px]">
                        {img.tags[0] || img.id}
                      </span>
                      <span className="text-text-muted">{img.size_mb} MB</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )}
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
  const { testServerConnection } = useAdminStore();
  const [formData, setFormData] = useState<CreateServerRequest>({
    name: '',
    hostname: '',
    ip_address: '',
    ssh_port: 22,
    docker_port: 2375,
    docker_runtime: 'runsc',
    total_cpu: 4,
    total_memory_mb: 8192,
    total_disk_gb: 100,
    total_bandwidth_mbps: 1000,
    architecture: 'amd64',
    region: '',
    provider: '',
    labels: {},
    has_gpu: false,
    gpu_type: '',
    gpu_count: 0,
    tls_enabled: false,
    tls_cert_path: '',
    tls_key_path: '',
    tls_ca_path: '',
    compute_service_url: 'http://compute:3003',
    workspace_image: 'podex/workspace:latest',
    workspace_image_arm64: '',
    workspace_image_amd64: '',
    workspace_image_gpu: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestServerConnectionResponse | null>(null);

  // Auto-fill TLS paths based on server name
  const updateTlsPaths = (name: string, tlsEnabled: boolean) => {
    if (tlsEnabled && name) {
      const basePath = `/etc/docker/workspace-certs/${name}`;
      return {
        tls_cert_path: `${basePath}/cert.pem`,
        tls_key_path: `${basePath}/key.pem`,
        tls_ca_path: `${basePath}/ca.pem`,
      };
    }
    return {};
  };

  const handleNameChange = (name: string) => {
    const tlsPaths = updateTlsPaths(name, formData.tls_enabled || false);
    setFormData({ ...formData, name, ...tlsPaths });
  };

  const handleTlsToggle = (enabled: boolean) => {
    const tlsPaths = updateTlsPaths(formData.name, enabled);
    setFormData({
      ...formData,
      tls_enabled: enabled,
      docker_port: enabled ? 2376 : 2375,
      ...tlsPaths,
    });
  };

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
        ssh_port: 22,
        docker_port: 2375,
        docker_runtime: 'runsc',
        total_cpu: 4,
        total_memory_mb: 8192,
        total_disk_gb: 100,
        total_bandwidth_mbps: 1000,
        architecture: 'amd64',
        region: '',
        provider: '',
        labels: {},
        has_gpu: false,
        gpu_type: '',
        gpu_count: 0,
        tls_enabled: false,
        tls_cert_path: '',
        tls_key_path: '',
        tls_ca_path: '',
        compute_service_url: 'http://compute:3003',
        workspace_image: 'podex/workspace:latest',
        workspace_image_arm64: '',
        workspace_image_amd64: '',
        workspace_image_gpu: '',
      });
      setTestResult(null);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTestConnection = async () => {
    if (!formData.ip_address || !formData.docker_port) {
      setTestResult({
        success: false,
        message: 'IP address and Docker port are required',
        error: 'Missing required fields',
      });
      return;
    }

    setIsTesting(true);
    setTestResult(null);
    try {
      const result = await testServerConnection({
        ip_address: formData.ip_address,
        docker_port: formData.docker_port,
        tls_enabled: formData.tls_enabled || false,
        tls_cert_path: formData.tls_cert_path,
        tls_key_path: formData.tls_key_path,
        tls_ca_path: formData.tls_ca_path,
      });
      setTestResult(result);
    } finally {
      setIsTesting(false);
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
                onChange={(e) => handleNameChange(e.target.value)}
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
              <label className="block text-sm text-text-secondary mb-1">SSH Port</label>
              <input
                type="number"
                value={formData.ssh_port}
                onChange={(e) => setFormData({ ...formData, ssh_port: parseInt(e.target.value) })}
                className="w-full px-3 py-2 bg-elevated border border-border-subtle rounded-lg text-text-primary"
                min={1}
                max={65535}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
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
            <div>
              <label className="block text-sm text-text-secondary mb-1">Docker Runtime</label>
              <select
                value={formData.docker_runtime}
                onChange={(e) => setFormData({ ...formData, docker_runtime: e.target.value })}
                className="w-full px-3 py-2 bg-elevated border border-border-subtle rounded-lg text-text-primary"
              >
                <option value="runsc">runsc (gVisor)</option>
                <option value="runc">runc (default)</option>
                <option value="nvidia">nvidia (GPU)</option>
              </select>
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
                placeholder="eu / us"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm text-text-secondary mb-1">Provider</label>
            <input
              type="text"
              value={formData.provider || ''}
              onChange={(e) => setFormData({ ...formData, provider: e.target.value })}
              className="w-full px-3 py-2 bg-elevated border border-border-subtle rounded-lg text-text-primary"
              placeholder="gcp / aws / hetzner / local"
            />
          </div>

          <div>
            <label className="block text-sm text-text-secondary mb-1">Compute Service URL</label>
            <input
              type="url"
              value={formData.compute_service_url || 'http://compute:3003'}
              onChange={(e) => setFormData({ ...formData, compute_service_url: e.target.value })}
              className="w-full px-3 py-2 bg-elevated border border-border-subtle rounded-lg text-text-primary font-mono text-sm"
              placeholder="http://compute:3003"
              required
            />
            <p className="text-xs text-text-muted mt-1">
              URL of the regional compute service that manages this server
            </p>
          </div>

          {/* TLS Configuration */}
          <div className="border-t border-border-subtle pt-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.tls_enabled}
                onChange={(e) => handleTlsToggle(e.target.checked)}
                className="rounded border-border-subtle"
              />
              <span className="text-sm text-text-secondary">Enable TLS (Production)</span>
            </label>

            {formData.tls_enabled && (
              <div className="space-y-3 mt-4">
                <div>
                  <label className="block text-sm text-text-secondary mb-1">Certificate Path</label>
                  <input
                    type="text"
                    value={formData.tls_cert_path || ''}
                    onChange={(e) => setFormData({ ...formData, tls_cert_path: e.target.value })}
                    className="w-full px-3 py-2 bg-elevated border border-border-subtle rounded-lg text-text-primary text-sm font-mono"
                    placeholder="/etc/docker/workspace-certs/server/cert.pem"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm text-text-secondary mb-1">Key Path</label>
                  <input
                    type="text"
                    value={formData.tls_key_path || ''}
                    onChange={(e) => setFormData({ ...formData, tls_key_path: e.target.value })}
                    className="w-full px-3 py-2 bg-elevated border border-border-subtle rounded-lg text-text-primary text-sm font-mono"
                    placeholder="/etc/docker/workspace-certs/server/key.pem"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm text-text-secondary mb-1">CA Path</label>
                  <input
                    type="text"
                    value={formData.tls_ca_path || ''}
                    onChange={(e) => setFormData({ ...formData, tls_ca_path: e.target.value })}
                    className="w-full px-3 py-2 bg-elevated border border-border-subtle rounded-lg text-text-primary text-sm font-mono"
                    placeholder="/etc/docker/workspace-certs/server/ca.pem"
                    required
                  />
                </div>
                <p className="text-xs text-text-muted">
                  Paths are on the platform server where compute service runs
                </p>
              </div>
            )}

            {/* Test Connection Button */}
            <div className="mt-4">
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={isTesting || !formData.ip_address}
                className="flex items-center gap-2 px-3 py-2 bg-elevated border border-border-subtle rounded-lg text-text-secondary hover:text-text-primary hover:bg-elevated/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isTesting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Testing...
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4" />
                    Test Connection
                  </>
                )}
              </button>

              {/* Test Results */}
              {testResult && (
                <div
                  className={cn(
                    'mt-3 p-3 rounded-lg text-sm',
                    testResult.success
                      ? 'bg-green-500/10 border border-green-500/30'
                      : 'bg-red-500/10 border border-red-500/30'
                  )}
                >
                  <div className="flex items-center gap-2 mb-2">
                    {testResult.success ? (
                      <Check className="h-4 w-4 text-green-500" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 text-red-500" />
                    )}
                    <span className={testResult.success ? 'text-green-500' : 'text-red-500'}>
                      {testResult.message}
                    </span>
                  </div>
                  {testResult.success && testResult.docker_info && (
                    <div className="text-xs text-text-muted space-y-1 ml-6">
                      {testResult.docker_info.server_version && (
                        <p>Docker: {testResult.docker_info.server_version}</p>
                      )}
                      {testResult.docker_info.os && testResult.docker_info.architecture && (
                        <p>
                          OS: {testResult.docker_info.os} ({testResult.docker_info.architecture})
                        </p>
                      )}
                      {testResult.docker_info.cpus !== undefined && (
                        <p>CPUs: {testResult.docker_info.cpus}</p>
                      )}
                      {testResult.docker_info.memory_total !== undefined && (
                        <p>
                          Memory:{' '}
                          {(testResult.docker_info.memory_total / 1024 / 1024 / 1024).toFixed(1)} GB
                        </p>
                      )}
                      {testResult.docker_info.containers !== undefined && (
                        <p>Containers: {testResult.docker_info.containers}</p>
                      )}
                    </div>
                  )}
                  {testResult.error && !testResult.success && (
                    <p className="text-xs text-red-400 ml-6 mt-1">{testResult.error}</p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* GPU Configuration */}
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

          {/* Docker Images Configuration */}
          <div className="border-t border-border-subtle pt-4">
            <h3 className="text-sm font-medium text-text-primary mb-3 flex items-center gap-2">
              <Package className="h-4 w-4" />
              Workspace Images
            </h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm text-text-secondary mb-1">
                  Default Image <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={formData.workspace_image || ''}
                  onChange={(e) => setFormData({ ...formData, workspace_image: e.target.value })}
                  className="w-full px-3 py-2 bg-elevated border border-border-subtle rounded-lg text-text-primary font-mono text-sm"
                  placeholder="podex/workspace:latest"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-text-secondary mb-1">ARM64 Image</label>
                  <input
                    type="text"
                    value={formData.workspace_image_arm64 || ''}
                    onChange={(e) =>
                      setFormData({ ...formData, workspace_image_arm64: e.target.value })
                    }
                    className="w-full px-3 py-2 bg-elevated border border-border-subtle rounded-lg text-text-primary font-mono text-sm"
                    placeholder="Optional"
                  />
                </div>
                <div>
                  <label className="block text-sm text-text-secondary mb-1">AMD64 Image</label>
                  <input
                    type="text"
                    value={formData.workspace_image_amd64 || ''}
                    onChange={(e) =>
                      setFormData({ ...formData, workspace_image_amd64: e.target.value })
                    }
                    className="w-full px-3 py-2 bg-elevated border border-border-subtle rounded-lg text-text-primary font-mono text-sm"
                    placeholder="Optional"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm text-text-secondary mb-1">GPU Image</label>
                <input
                  type="text"
                  value={formData.workspace_image_gpu || ''}
                  onChange={(e) =>
                    setFormData({ ...formData, workspace_image_gpu: e.target.value })
                  }
                  className="w-full px-3 py-2 bg-elevated border border-border-subtle rounded-lg text-text-primary font-mono text-sm"
                  placeholder="Optional - for GPU-enabled workspaces"
                />
              </div>
            </div>
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

interface EditServerModalProps {
  server: AdminWorkspaceServer | null;
  onClose: () => void;
  onSubmit: (serverId: string, data: Partial<AdminWorkspaceServer>) => Promise<void>;
}

function EditServerModal({ server, onClose, onSubmit }: EditServerModalProps) {
  const { testServerConnection } = useAdminStore();
  const [formData, setFormData] = useState({
    name: '',
    hostname: '',
    ip_address: '',
    ssh_port: 22,
    docker_port: 2376,
    docker_runtime: 'runsc',
    region: '',
    provider: '',
    max_workspaces: 50,
    tls_enabled: true,
    tls_cert_path: '',
    tls_key_path: '',
    tls_ca_path: '',
    compute_service_url: 'http://compute:3003',
    workspace_image: 'podex/workspace:latest',
    workspace_image_arm64: '',
    workspace_image_amd64: '',
    workspace_image_gpu: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestServerConnectionResponse | null>(null);

  // Update form when server changes
  useEffect(() => {
    if (server) {
      setFormData({
        name: server.name,
        hostname: server.hostname,
        ip_address: server.ip_address,
        ssh_port: server.ssh_port || 22,
        docker_port: server.docker_port,
        docker_runtime: server.docker_runtime || 'runsc',
        region: server.region || '',
        provider: server.provider || '',
        max_workspaces: server.max_workspaces,
        tls_enabled: server.tls_enabled,
        tls_cert_path: server.tls_cert_path || '',
        tls_key_path: server.tls_key_path || '',
        tls_ca_path: server.tls_ca_path || '',
        compute_service_url: server.compute_service_url || 'http://compute:3003',
        workspace_image: server.workspace_image || 'podex/workspace:latest',
        workspace_image_arm64: server.workspace_image_arm64 || '',
        workspace_image_amd64: server.workspace_image_amd64 || '',
        workspace_image_gpu: server.workspace_image_gpu || '',
      });
      setTestResult(null);
    }
  }, [server]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!server) return;
    setIsSubmitting(true);
    try {
      await onSubmit(server.id, {
        name: formData.name,
        hostname: formData.hostname,
        ip_address: formData.ip_address,
        ssh_port: formData.ssh_port,
        docker_port: formData.docker_port,
        docker_runtime: formData.docker_runtime,
        region: formData.region || null,
        provider: formData.provider || null,
        max_workspaces: formData.max_workspaces,
        tls_enabled: formData.tls_enabled,
        tls_cert_path: formData.tls_cert_path || null,
        tls_key_path: formData.tls_key_path || null,
        tls_ca_path: formData.tls_ca_path || null,
        compute_service_url: formData.compute_service_url,
        workspace_image: formData.workspace_image,
        workspace_image_arm64: formData.workspace_image_arm64 || null,
        workspace_image_amd64: formData.workspace_image_amd64 || null,
        workspace_image_gpu: formData.workspace_image_gpu || null,
      });
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTestConnection = async () => {
    if (!formData.ip_address || !formData.docker_port) {
      setTestResult({
        success: false,
        message: 'IP address and Docker port are required',
        error: 'Missing required fields',
      });
      return;
    }

    setIsTesting(true);
    setTestResult(null);
    try {
      const result = await testServerConnection({
        ip_address: formData.ip_address,
        docker_port: formData.docker_port,
        tls_enabled: formData.tls_enabled,
        tls_cert_path: formData.tls_cert_path,
        tls_key_path: formData.tls_key_path,
        tls_ca_path: formData.tls_ca_path,
      });
      setTestResult(result);
    } finally {
      setIsTesting(false);
    }
  };

  // Auto-fill TLS paths based on server name
  const updateTlsPaths = (name: string, tlsEnabled: boolean) => {
    if (tlsEnabled && name) {
      const basePath = `/etc/docker/workspace-certs/${name}`;
      return {
        tls_cert_path: `${basePath}/cert.pem`,
        tls_key_path: `${basePath}/key.pem`,
        tls_ca_path: `${basePath}/ca.pem`,
      };
    }
    return {};
  };

  const handleNameChange = (name: string) => {
    // Only auto-update TLS paths if they were previously auto-generated
    const currentBasePath = formData.name ? `/etc/docker/workspace-certs/${formData.name}` : '';
    const wasAutoGenerated =
      formData.tls_cert_path === `${currentBasePath}/cert.pem` || !formData.tls_cert_path;
    const tlsPaths = wasAutoGenerated ? updateTlsPaths(name, formData.tls_enabled) : {};
    setFormData({ ...formData, name, ...tlsPaths });
  };

  const handleTlsToggle = (enabled: boolean) => {
    const tlsPaths = updateTlsPaths(formData.name, enabled);
    setFormData({
      ...formData,
      tls_enabled: enabled,
      docker_port: enabled ? 2376 : 2375,
      ...tlsPaths,
    });
  };

  if (!server) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-surface rounded-xl border border-border-subtle p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <h2 className="text-xl font-semibold text-text-primary mb-4">Edit Server: {server.name}</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-text-secondary mb-1">Name</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => handleNameChange(e.target.value)}
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
                required
              />
            </div>
            <div>
              <label className="block text-sm text-text-secondary mb-1">SSH Port</label>
              <input
                type="number"
                value={formData.ssh_port}
                onChange={(e) => setFormData({ ...formData, ssh_port: parseInt(e.target.value) })}
                className="w-full px-3 py-2 bg-elevated border border-border-subtle rounded-lg text-text-primary"
                min={1}
                max={65535}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-text-secondary mb-1">Docker Port</label>
              <input
                type="number"
                value={formData.docker_port}
                onChange={(e) =>
                  setFormData({ ...formData, docker_port: parseInt(e.target.value) })
                }
                className="w-full px-3 py-2 bg-elevated border border-border-subtle rounded-lg text-text-primary"
                required
              />
            </div>
            <div>
              <label className="block text-sm text-text-secondary mb-1">Docker Runtime</label>
              <select
                value={formData.docker_runtime}
                onChange={(e) => setFormData({ ...formData, docker_runtime: e.target.value })}
                className="w-full px-3 py-2 bg-elevated border border-border-subtle rounded-lg text-text-primary"
              >
                <option value="runsc">runsc (gVisor)</option>
                <option value="runc">runc (default)</option>
                <option value="nvidia">nvidia (GPU)</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-text-secondary mb-1">Max Workspaces</label>
              <input
                type="number"
                value={formData.max_workspaces}
                onChange={(e) =>
                  setFormData({ ...formData, max_workspaces: parseInt(e.target.value) })
                }
                className="w-full px-3 py-2 bg-elevated border border-border-subtle rounded-lg text-text-primary"
                min={1}
              />
            </div>
            <div>
              <label className="block text-sm text-text-secondary mb-1">Region</label>
              <input
                type="text"
                value={formData.region}
                onChange={(e) => setFormData({ ...formData, region: e.target.value })}
                className="w-full px-3 py-2 bg-elevated border border-border-subtle rounded-lg text-text-primary"
                placeholder="eu / us"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm text-text-secondary mb-1">Provider</label>
            <input
              type="text"
              value={formData.provider}
              onChange={(e) => setFormData({ ...formData, provider: e.target.value })}
              className="w-full px-3 py-2 bg-elevated border border-border-subtle rounded-lg text-text-primary"
              placeholder="gcp / aws / hetzner / local"
            />
          </div>

          <div>
            <label className="block text-sm text-text-secondary mb-1">Compute Service URL</label>
            <input
              type="url"
              value={formData.compute_service_url}
              onChange={(e) => setFormData({ ...formData, compute_service_url: e.target.value })}
              className="w-full px-3 py-2 bg-elevated border border-border-subtle rounded-lg text-text-primary font-mono text-sm"
              placeholder="http://compute:3003"
              required
            />
            <p className="text-xs text-text-muted mt-1">
              URL of the regional compute service that manages this server
            </p>
          </div>

          {/* TLS Configuration */}
          <div className="border-t border-border-subtle pt-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.tls_enabled}
                onChange={(e) => handleTlsToggle(e.target.checked)}
                className="rounded border-border-subtle"
              />
              <span className="text-sm text-text-secondary">
                Enable TLS (recommended for production)
              </span>
            </label>

            {formData.tls_enabled && (
              <div className="mt-4 space-y-3">
                <div>
                  <label className="block text-sm text-text-secondary mb-1">Certificate Path</label>
                  <input
                    type="text"
                    value={formData.tls_cert_path}
                    onChange={(e) => setFormData({ ...formData, tls_cert_path: e.target.value })}
                    className="w-full px-3 py-2 bg-elevated border border-border-subtle rounded-lg text-text-primary font-mono text-sm"
                    placeholder="/etc/docker/workspace-certs/server-name/cert.pem"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm text-text-secondary mb-1">Key Path</label>
                  <input
                    type="text"
                    value={formData.tls_key_path}
                    onChange={(e) => setFormData({ ...formData, tls_key_path: e.target.value })}
                    className="w-full px-3 py-2 bg-elevated border border-border-subtle rounded-lg text-text-primary font-mono text-sm"
                    placeholder="/etc/docker/workspace-certs/server-name/key.pem"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm text-text-secondary mb-1">CA Path</label>
                  <input
                    type="text"
                    value={formData.tls_ca_path}
                    onChange={(e) => setFormData({ ...formData, tls_ca_path: e.target.value })}
                    className="w-full px-3 py-2 bg-elevated border border-border-subtle rounded-lg text-text-primary font-mono text-sm"
                    placeholder="/etc/docker/workspace-certs/server-name/ca.pem"
                    required
                  />
                </div>
                <p className="text-xs text-text-muted">
                  Paths are on the platform server where compute service runs
                </p>
              </div>
            )}

            {/* Test Connection Button */}
            <div className="mt-4">
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={isTesting || !formData.ip_address}
                className="flex items-center gap-2 px-3 py-2 bg-elevated border border-border-subtle rounded-lg text-text-secondary hover:text-text-primary hover:bg-elevated/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isTesting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Testing...
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4" />
                    Test Connection
                  </>
                )}
              </button>

              {/* Test Results */}
              {testResult && (
                <div
                  className={cn(
                    'mt-3 p-3 rounded-lg text-sm',
                    testResult.success
                      ? 'bg-green-500/10 border border-green-500/30'
                      : 'bg-red-500/10 border border-red-500/30'
                  )}
                >
                  <div className="flex items-center gap-2 mb-2">
                    {testResult.success ? (
                      <Check className="h-4 w-4 text-green-500" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 text-red-500" />
                    )}
                    <span className={testResult.success ? 'text-green-500' : 'text-red-500'}>
                      {testResult.message}
                    </span>
                  </div>
                  {testResult.success && testResult.docker_info && (
                    <div className="text-xs text-text-muted space-y-1 ml-6">
                      {testResult.docker_info.server_version && (
                        <p>Docker: {testResult.docker_info.server_version}</p>
                      )}
                      {testResult.docker_info.os && testResult.docker_info.architecture && (
                        <p>
                          OS: {testResult.docker_info.os} ({testResult.docker_info.architecture})
                        </p>
                      )}
                      {testResult.docker_info.cpus !== undefined && (
                        <p>CPUs: {testResult.docker_info.cpus}</p>
                      )}
                      {testResult.docker_info.memory_total !== undefined && (
                        <p>
                          Memory:{' '}
                          {(testResult.docker_info.memory_total / 1024 / 1024 / 1024).toFixed(1)} GB
                        </p>
                      )}
                    </div>
                  )}
                  {testResult.error && !testResult.success && (
                    <p className="text-xs text-red-400 ml-6 mt-1">{testResult.error}</p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Docker Images Configuration */}
          <div className="border-t border-border-subtle pt-4">
            <h3 className="text-sm font-medium text-text-primary mb-3 flex items-center gap-2">
              <Package className="h-4 w-4" />
              Workspace Images
            </h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm text-text-secondary mb-1">
                  Default Image <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={formData.workspace_image}
                  onChange={(e) => setFormData({ ...formData, workspace_image: e.target.value })}
                  className="w-full px-3 py-2 bg-elevated border border-border-subtle rounded-lg text-text-primary font-mono text-sm"
                  placeholder="podex/workspace:latest"
                  required
                />
                <p className="text-[10px] text-text-muted mt-1">
                  Used when no architecture-specific image is set
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-text-secondary mb-1">ARM64 Image</label>
                  <input
                    type="text"
                    value={formData.workspace_image_arm64}
                    onChange={(e) =>
                      setFormData({ ...formData, workspace_image_arm64: e.target.value })
                    }
                    className="w-full px-3 py-2 bg-elevated border border-border-subtle rounded-lg text-text-primary font-mono text-sm"
                    placeholder="Optional"
                  />
                </div>
                <div>
                  <label className="block text-sm text-text-secondary mb-1">AMD64 Image</label>
                  <input
                    type="text"
                    value={formData.workspace_image_amd64}
                    onChange={(e) =>
                      setFormData({ ...formData, workspace_image_amd64: e.target.value })
                    }
                    className="w-full px-3 py-2 bg-elevated border border-border-subtle rounded-lg text-text-primary font-mono text-sm"
                    placeholder="Optional"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm text-text-secondary mb-1">GPU Image</label>
                <input
                  type="text"
                  value={formData.workspace_image_gpu}
                  onChange={(e) =>
                    setFormData({ ...formData, workspace_image_gpu: e.target.value })
                  }
                  className="w-full px-3 py-2 bg-elevated border border-border-subtle rounded-lg text-text-primary font-mono text-sm"
                  placeholder="Optional - for GPU-enabled workspaces"
                />
              </div>
            </div>
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
              {isSubmitting ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function ServersManagement() {
  useDocumentTitle('Workspace Servers');
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
    updateWorkspaceServer,
    error,
  } = useAdminStore();

  const [showAddModal, setShowAddModal] = useState(false);
  const [editingServer, setEditingServer] = useState<AdminWorkspaceServer | null>(null);
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

  const filteredServers = (
    statusFilter ? workspaceServers.filter((s) => s.status === statusFilter) : workspaceServers
  ).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="px-8 py-8">
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
              onEdit={setEditingServer}
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

      {/* Edit Server Modal */}
      <EditServerModal
        server={editingServer}
        onClose={() => setEditingServer(null)}
        onSubmit={updateWorkspaceServer}
      />
    </div>
  );
}
