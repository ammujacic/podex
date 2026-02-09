'use client';

import { useEffect, useState } from 'react';
import {
  Plus,
  Edit,
  Trash2,
  Eye,
  EyeOff,
  Save,
  X,
  TrendingUp,
  BarChart3,
  Bot,
  Activity,
  Clock,
  Award,
  Workflow,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

function formatNumber(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toString();
}

// Horizontal bar chart component
interface BarChartProps {
  data: Array<{ label: string; value: number; color: string }>;
  maxValue?: number;
  showPercentage?: boolean;
  totalValue?: number;
}

function HorizontalBarChart({ data, maxValue, showPercentage, totalValue }: BarChartProps) {
  const max = maxValue ?? Math.max(...data.map((d) => d.value));
  const total = totalValue ?? data.reduce((sum, d) => sum + d.value, 0);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  return (
    <div className="space-y-3">
      {data.map((item, i) => {
        const percentage = total > 0 ? (item.value / total) * 100 : 0;
        const isHovered = hoveredIndex === i;
        return (
          <div
            key={i}
            className={cn(
              'p-3 rounded-lg transition-all cursor-pointer',
              isHovered ? 'bg-elevated scale-[1.02]' : 'hover:bg-elevated/50'
            )}
            onMouseEnter={() => setHoveredIndex(i)}
            onMouseLeave={() => setHoveredIndex(null)}
          >
            <div className="flex justify-between text-sm mb-2">
              <span
                className={cn(
                  'font-medium',
                  isHovered ? 'text-text-primary' : 'text-text-secondary'
                )}
              >
                {item.label}
              </span>
              <div className="flex items-center gap-2">
                <span className="text-text-primary font-bold">{formatNumber(item.value)}</span>
                {showPercentage && (
                  <span className="text-text-muted text-xs">({percentage.toFixed(1)}%)</span>
                )}
              </div>
            </div>
            <div className="h-3 bg-elevated rounded-full overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-full transition-all duration-300',
                  isHovered && 'opacity-90'
                )}
                style={{
                  width: `${max > 0 ? (item.value / max) * 100 : 0}%`,
                  backgroundColor: item.color,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Donut chart component for distribution
interface DonutChartProps {
  data: Array<{ label: string; value: number; color: string }>;
  size?: number;
}

function DonutChart({ data, size = 200 }: DonutChartProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const total = data.reduce((sum, d) => sum + d.value, 0);
  const strokeWidth = 35;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  let currentOffset = 0;

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="transform -rotate-90">
          {data.map((item, i) => {
            const percentage = total > 0 ? item.value / total : 0;
            const strokeDasharray = `${circumference * percentage} ${circumference}`;
            const strokeDashoffset = -currentOffset;
            currentOffset += circumference * percentage;
            const isHovered = hoveredIndex === i;

            return (
              <circle
                key={i}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={item.color}
                strokeWidth={isHovered ? strokeWidth + 8 : strokeWidth}
                strokeDasharray={strokeDasharray}
                strokeDashoffset={strokeDashoffset}
                className="transition-all duration-200 cursor-pointer"
                style={{ opacity: hoveredIndex !== null && !isHovered ? 0.5 : 1 }}
                onMouseEnter={() => setHoveredIndex(i)}
                onMouseLeave={() => setHoveredIndex(null)}
              />
            );
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {hoveredIndex !== null && data[hoveredIndex] ? (
            <>
              <span className="text-2xl font-bold text-text-primary">
                {formatNumber(data[hoveredIndex].value)}
              </span>
              <span className="text-sm text-text-muted">
                {((data[hoveredIndex].value / total) * 100).toFixed(1)}%
              </span>
            </>
          ) : (
            <>
              <span className="text-2xl font-bold text-text-primary">{formatNumber(total)}</span>
              <span className="text-sm text-text-muted">Total Uses</span>
            </>
          )}
        </div>
      </div>
      {/* Legend */}
      <div className="flex flex-wrap justify-center gap-3">
        {data.slice(0, 6).map((item, i) => (
          <div
            key={i}
            className={cn(
              'flex items-center gap-2 px-2 py-1 rounded transition-all cursor-pointer',
              hoveredIndex === i ? 'bg-elevated' : 'hover:bg-elevated/50'
            )}
            onMouseEnter={() => setHoveredIndex(i)}
            onMouseLeave={() => setHoveredIndex(null)}
          >
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }} />
            <span className="text-xs text-text-secondary">{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Ranking card component
interface RankingCardProps {
  rank: number;
  name: string;
  value: number;
  color: string;
  percentage: number;
  lastUsed?: string;
}

function RankingCard({ rank, name, value, color, percentage, lastUsed }: RankingCardProps) {
  return (
    <div className="flex items-center gap-4 p-4 bg-elevated rounded-xl hover:scale-[1.02] transition-transform">
      <div className="w-8 h-8 rounded-lg bg-surface flex items-center justify-center text-sm font-bold text-text-muted">
        {rank + 1}
      </div>
      <div
        className="w-12 h-12 rounded-xl flex items-center justify-center text-white font-bold text-lg"
        style={{ backgroundColor: color }}
      >
        {name[0]}
      </div>
      <div className="flex-1">
        <div className="font-semibold text-text-primary">{name}</div>
        <div className="text-sm text-text-muted">
          {lastUsed ? `Last used ${new Date(lastUsed).toLocaleDateString()}` : 'Never used'}
        </div>
      </div>
      <div className="text-right">
        <div className="text-xl font-bold text-text-primary">{formatNumber(value)}</div>
        <div className="text-sm text-text-muted">{percentage.toFixed(1)}% of total</div>
      </div>
    </div>
  );
}

interface AgentRoleConfig {
  id: string;
  role: string;
  name: string;
  color: string;
  icon?: string;
  description?: string;
  system_prompt: string;
  tools: string[];
  category?: string;
  gradient_start?: string;
  gradient_end?: string;
  features?: string[];
  example_prompts?: string[];
  requires_subscription?: boolean;
  sort_order: number;
  is_enabled: boolean;
  is_system: boolean;
  usage_count: number;
  last_used_at?: string;
  created_at: string;
  updated_at: string;
}

interface AgentTool {
  id: string;
  name: string;
  description: string;
  category: string;
  is_enabled: boolean;
  // Permission flags for mode-based access control
  is_read_operation: boolean;
  is_write_operation: boolean;
  is_command_operation: boolean;
  is_deploy_operation: boolean;
}

interface CreateRoleForm {
  role: string;
  name: string;
  color: string;
  icon: string;
  description: string;
  system_prompt: string;
  tools: string[];
  category: string;
  gradient_start: string;
  gradient_end: string;
  features: string; // JSON string
  example_prompts: string; // JSON string
  requires_subscription: boolean;
  sort_order: number;
  is_enabled: boolean;
}

const defaultForm: CreateRoleForm = {
  role: '',
  name: '',
  color: 'cyan',
  icon: '',
  description: '',
  system_prompt: '',
  tools: [],
  category: 'general',
  gradient_start: '',
  gradient_end: '',
  features: '[]',
  example_prompts: '[]',
  requires_subscription: false,
  sort_order: 100,
  is_enabled: true,
};

const colorOptions = [
  'cyan',
  'purple',
  'green',
  'orange',
  'red',
  'blue',
  'emerald',
  'pink',
  'amber',
  'violet',
  'indigo',
];

export default function AgentRolesAdminPage() {
  useDocumentTitle('Agent Management');
  const [roles, setRoles] = useState<AgentRoleConfig[]>([]);
  const [tools, setTools] = useState<AgentTool[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingRole, setEditingRole] = useState<AgentRoleConfig | null>(null);
  const [formData, setFormData] = useState<CreateRoleForm>(defaultForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'roles' | 'stats'>('roles');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [rolesData, toolsData] = await Promise.all([
        api.get<{ roles: AgentRoleConfig[]; total: number }>('/api/admin/agents'),
        api.get<{ tools: AgentTool[]; total: number }>('/api/admin/tools'),
      ]);
      setRoles(rolesData.roles);
      setTools(toolsData.tools);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    setSaving(true);
    setError(null);

    try {
      // Parse JSON fields
      let parsedFeatures: string[] = [];
      let parsedExamplePrompts: string[] = [];
      try {
        parsedFeatures = JSON.parse(formData.features);
      } catch {
        parsedFeatures = [];
      }
      try {
        parsedExamplePrompts = JSON.parse(formData.example_prompts);
      } catch {
        parsedExamplePrompts = [];
      }
      await api.post('/api/admin/agents', {
        ...formData,
        features: parsedFeatures,
        example_prompts: parsedExamplePrompts,
      });
      await loadData();
      setShowCreateForm(false);
      setFormData(defaultForm);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async (roleId: string) => {
    if (!editingRole) return;

    setSaving(true);
    setError(null);

    try {
      // Parse JSON fields
      let parsedFeatures: string[] = [];
      let parsedExamplePrompts: string[] = [];
      try {
        parsedFeatures = JSON.parse(formData.features);
      } catch {
        parsedFeatures = [];
      }
      try {
        parsedExamplePrompts = JSON.parse(formData.example_prompts);
      } catch {
        parsedExamplePrompts = [];
      }
      await api.put(`/api/admin/agents/${roleId}`, {
        ...formData,
        features: parsedFeatures,
        example_prompts: parsedExamplePrompts,
      });
      await loadData();
      setEditingRole(null);
      setFormData(defaultForm);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (roleId: string) => {
    if (!confirm('Are you sure you want to delete this role?')) return;

    try {
      await api.delete(`/api/admin/agents/${roleId}`);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  };

  const toggleEnabled = async (role: AgentRoleConfig) => {
    try {
      await api.put(`/api/admin/agents/${role.id}`, {
        is_enabled: !role.is_enabled,
      });
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  };

  const startEdit = (role: AgentRoleConfig) => {
    setEditingRole(role);
    setFormData({
      role: role.role,
      name: role.name,
      color: role.color,
      icon: role.icon || '',
      description: role.description || '',
      system_prompt: role.system_prompt,
      tools: role.tools,
      category: role.category || 'general',
      gradient_start: role.gradient_start || '',
      gradient_end: role.gradient_end || '',
      features: JSON.stringify(role.features || [], null, 2),
      example_prompts: JSON.stringify(role.example_prompts || [], null, 2),
      requires_subscription: role.requires_subscription || false,
      sort_order: role.sort_order,
      is_enabled: role.is_enabled,
    });
  };

  const cancelEdit = () => {
    setEditingRole(null);
    setFormData(defaultForm);
  };

  const toggleTool = (toolName: string) => {
    if (formData.tools.includes(toolName)) {
      setFormData({
        ...formData,
        tools: formData.tools.filter((t) => t !== toolName),
      });
    } else {
      setFormData({
        ...formData,
        tools: [...formData.tools, toolName],
      });
    }
  };

  // Get sorted roles by usage for stats
  const rolesByUsage = [...roles].sort((a, b) => b.usage_count - a.usage_count);
  const totalUsage = roles.reduce((sum, r) => sum + r.usage_count, 0);

  // Helper to check if a role has disabled tools
  const getDisabledToolsForRole = (role: AgentRoleConfig): string[] => {
    const enabledToolNames = new Set(tools.filter((t) => t.is_enabled).map((t) => t.name));
    return role.tools.filter((toolName) => !enabledToolNames.has(toolName));
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-1/4 mb-6"></div>
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-16 bg-gray-200 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-text-primary mb-2">Agent Management</h1>
        <p className="text-text-muted">Configure orchestrated agent roles</p>
      </div>

      {/* Tab Navigation */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex bg-surface border border-border-subtle rounded-xl p-1.5 gap-1">
          <button
            onClick={() => setActiveTab('roles')}
            className={cn(
              'px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2',
              activeTab === 'roles'
                ? 'bg-gradient-to-r from-purple-600 to-purple-500 text-white shadow-md'
                : 'text-text-secondary hover:text-text-primary hover:bg-elevated'
            )}
          >
            <Workflow className="h-4 w-4" />
            Agent Roles
            <span
              className={cn(
                'px-1.5 py-0.5 rounded-full text-xs',
                activeTab === 'roles' ? 'bg-white/20' : 'bg-elevated'
              )}
            >
              {roles.filter((r) => r.is_enabled).length}
            </span>
          </button>
          <button
            onClick={() => setActiveTab('stats')}
            className={cn(
              'px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2',
              activeTab === 'stats'
                ? 'bg-gradient-to-r from-emerald-600 to-emerald-500 text-white shadow-md'
                : 'text-text-secondary hover:text-text-primary hover:bg-elevated'
            )}
          >
            <BarChart3 className="h-4 w-4" />
            Usage Stats
          </button>
        </div>
        {activeTab === 'roles' && (
          <button
            onClick={() => setShowCreateForm(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-purple-600 to-purple-500 text-white rounded-xl hover:from-purple-700 hover:to-purple-600 transition-all shadow-md hover:shadow-lg"
          >
            <Plus className="h-4 w-4" />
            Add Role
          </button>
        )}
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
          <p className="text-red-400">{error}</p>
        </div>
      )}

      {/* Usage Stats Tab */}
      {activeTab === 'stats' && (
        <div className="space-y-6">
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-5 bg-surface rounded-xl border border-border-subtle">
              <div className="flex items-center gap-2 mb-3">
                <Activity className="h-5 w-5 text-blue-500" />
                <span className="text-sm text-text-muted">Total Usage</span>
              </div>
              <div className="text-3xl font-bold text-text-primary">{formatNumber(totalUsage)}</div>
              <div className="text-sm text-text-muted mt-1">Agent invocations</div>
            </div>
            <div className="p-5 bg-surface rounded-xl border border-border-subtle">
              <div className="flex items-center gap-2 mb-3">
                <Bot className="h-5 w-5 text-green-500" />
                <span className="text-sm text-text-muted">Active Roles</span>
              </div>
              <div className="text-3xl font-bold text-text-primary">
                {roles.filter((r) => r.is_enabled).length}
              </div>
              <div className="text-sm text-text-muted mt-1">of {roles.length} total roles</div>
            </div>
            <div className="p-5 bg-surface rounded-xl border border-border-subtle">
              <div className="flex items-center gap-2 mb-3">
                <Award className="h-5 w-5 text-yellow-500" />
                <span className="text-sm text-text-muted">Most Popular</span>
              </div>
              <div className="text-xl font-bold text-text-primary truncate">
                {rolesByUsage[0]?.name || 'N/A'}
              </div>
              <div className="text-sm text-text-muted mt-1">
                {rolesByUsage[0]
                  ? `${formatNumber(rolesByUsage[0].usage_count)} uses`
                  : 'No usage yet'}
              </div>
            </div>
            <div className="p-5 bg-surface rounded-xl border border-border-subtle">
              <div className="flex items-center gap-2 mb-3">
                <Clock className="h-5 w-5 text-purple-500" />
                <span className="text-sm text-text-muted">Last Activity</span>
              </div>
              <div className="text-lg font-bold text-text-primary">
                {rolesByUsage.find((r) => r.last_used_at)
                  ? new Date(
                      rolesByUsage.find((r) => r.last_used_at)!.last_used_at!
                    ).toLocaleDateString()
                  : 'N/A'}
              </div>
              <div className="text-sm text-text-muted mt-1">
                {rolesByUsage.find((r) => r.last_used_at)?.name || 'No recent activity'}
              </div>
            </div>
          </div>

          {/* Top 3 Ranking */}
          {rolesByUsage.length > 0 && (
            <div className="bg-surface rounded-xl border border-border-subtle p-6">
              <h2 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
                <Award className="h-5 w-5 text-yellow-500" />
                Top Performing Agents
              </h2>
              <div className="space-y-3">
                {rolesByUsage.slice(0, 3).map((role, i) => (
                  <RankingCard
                    key={role.id}
                    rank={i}
                    name={role.name}
                    value={role.usage_count}
                    color={getColorValue(role.color)}
                    percentage={totalUsage > 0 ? (role.usage_count / totalUsage) * 100 : 0}
                    lastUsed={role.last_used_at}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Charts Section */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Donut Chart */}
            <div className="bg-surface rounded-xl border border-border-subtle p-6">
              <h2 className="text-lg font-semibold text-text-primary mb-6 flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                Usage Distribution
              </h2>
              {rolesByUsage.length > 0 ? (
                <DonutChart
                  data={rolesByUsage.map((role) => ({
                    label: role.name,
                    value: role.usage_count,
                    color: getColorValue(role.color),
                  }))}
                  size={220}
                />
              ) : (
                <div className="h-48 flex items-center justify-center text-text-muted">
                  No usage data yet
                </div>
              )}
            </div>

            {/* Bar Chart */}
            <div className="bg-surface rounded-xl border border-border-subtle p-6">
              <h2 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
                <TrendingUp className="h-5 w-5" />
                Usage by Role
              </h2>
              {rolesByUsage.length > 0 ? (
                <HorizontalBarChart
                  data={rolesByUsage.map((role) => ({
                    label: role.name,
                    value: role.usage_count,
                    color: getColorValue(role.color),
                  }))}
                  showPercentage
                  totalValue={totalUsage}
                />
              ) : (
                <div className="h-48 flex items-center justify-center text-text-muted">
                  No usage data yet
                </div>
              )}
            </div>
          </div>

          {/* Detailed Stats Table */}
          <div className="bg-surface rounded-xl border border-border-subtle overflow-hidden">
            <div className="p-4 border-b border-border-subtle">
              <h2 className="text-lg font-semibold text-text-primary">All Roles Statistics</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-elevated">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-medium text-text-muted">
                      Role
                    </th>
                    <th className="px-4 py-3 text-right text-sm font-medium text-text-muted">
                      Uses
                    </th>
                    <th className="px-4 py-3 text-right text-sm font-medium text-text-muted">
                      % Share
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-text-muted">
                      Last Used
                    </th>
                    <th className="px-4 py-3 text-center text-sm font-medium text-text-muted">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {rolesByUsage.map((role) => {
                    const percentage = totalUsage > 0 ? (role.usage_count / totalUsage) * 100 : 0;
                    return (
                      <tr key={role.id} className="hover:bg-elevated/50">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div
                              className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold text-sm"
                              style={{ backgroundColor: getColorValue(role.color) }}
                            >
                              {role.name[0]}
                            </div>
                            <div>
                              <div className="font-medium text-text-primary">{role.name}</div>
                              <div className="text-xs text-text-muted">{role.role}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="font-semibold text-text-primary">
                            {formatNumber(role.usage_count)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-16 h-2 bg-elevated rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full"
                                style={{
                                  width: `${percentage}%`,
                                  backgroundColor: getColorValue(role.color),
                                }}
                              />
                            </div>
                            <span className="text-sm text-text-muted w-12 text-right">
                              {percentage.toFixed(1)}%
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-text-muted text-sm">
                          {role.last_used_at
                            ? new Date(role.last_used_at).toLocaleString()
                            : 'Never'}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span
                            className={cn(
                              'px-2 py-1 rounded-full text-xs font-medium',
                              role.is_enabled
                                ? 'bg-green-100 text-green-700'
                                : 'bg-gray-100 text-gray-600'
                            )}
                          >
                            {role.is_enabled ? 'Active' : 'Disabled'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Roles Tab */}
      {activeTab === 'roles' && (
        <>
          {/* Create/Edit Form */}
          {(showCreateForm || editingRole) && (
            <div className="mb-6 p-6 bg-surface rounded-lg border border-border-subtle">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-text-primary">
                  {editingRole ? 'Edit Role' : 'Create New Role'}
                </h2>
                <button
                  onClick={() => {
                    setShowCreateForm(false);
                    cancelEdit();
                  }}
                  className="p-1 hover:bg-overlay/30 rounded"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-sm font-medium text-text-primary mb-1">
                    Role ID *
                  </label>
                  <input
                    type="text"
                    value={formData.role}
                    onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                    disabled={!!editingRole}
                    className="w-full px-3 py-2 border border-border-subtle rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
                    placeholder="e.g., security_auditor"
                  />
                  <p className="text-xs text-text-muted mt-1">
                    Lowercase, numbers, underscores only
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-primary mb-1">
                    Display Name *
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-3 py-2 border border-border-subtle rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="e.g., Security Auditor"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-primary mb-1">Color</label>
                  <div className="flex flex-wrap gap-2">
                    {colorOptions.map((color) => (
                      <button
                        key={color}
                        onClick={() => setFormData({ ...formData, color })}
                        className={cn(
                          'w-8 h-8 rounded-full transition-all',
                          formData.color === color ? 'ring-2 ring-offset-2 ring-gray-400' : ''
                        )}
                        style={{ backgroundColor: getColorValue(color) }}
                        title={color}
                      />
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-primary mb-1">
                    Icon (Lucide name)
                  </label>
                  <input
                    type="text"
                    value={formData.icon}
                    onChange={(e) => setFormData({ ...formData, icon: e.target.value })}
                    className="w-full px-3 py-2 border border-border-subtle rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="e.g., Shield, Code2, Bot"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-text-primary mb-1">
                    Description
                  </label>
                  <input
                    type="text"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="w-full px-3 py-2 border border-border-subtle rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="Brief description of this role"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-text-primary mb-1">
                    System Prompt *
                  </label>
                  <textarea
                    value={formData.system_prompt}
                    onChange={(e) => setFormData({ ...formData, system_prompt: e.target.value })}
                    rows={8}
                    className="w-full px-3 py-2 border border-border-subtle rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
                    placeholder="You are an expert..."
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-primary mb-1">
                    Category
                  </label>
                  <select
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                    className="w-full px-3 py-2 border border-border-subtle rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="general">General</option>
                    <option value="development">Development</option>
                    <option value="analysis">Analysis</option>
                    <option value="creative">Creative</option>
                    <option value="research">Research</option>
                    <option value="operations">Operations</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-primary mb-1">
                    Sort Order
                  </label>
                  <input
                    type="number"
                    value={formData.sort_order}
                    onChange={(e) =>
                      setFormData({ ...formData, sort_order: parseInt(e.target.value) || 0 })
                    }
                    className="w-full px-3 py-2 border border-border-subtle rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    min={0}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-primary mb-1">
                    Gradient Start (hex)
                  </label>
                  <input
                    type="text"
                    value={formData.gradient_start}
                    onChange={(e) => setFormData({ ...formData, gradient_start: e.target.value })}
                    className="w-full px-3 py-2 border border-border-subtle rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="#a855f7"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-primary mb-1">
                    Gradient End (hex)
                  </label>
                  <input
                    type="text"
                    value={formData.gradient_end}
                    onChange={(e) => setFormData({ ...formData, gradient_end: e.target.value })}
                    className="w-full px-3 py-2 border border-border-subtle rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="#6366f1"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-text-primary mb-1">
                    Features (JSON array)
                  </label>
                  <textarea
                    value={formData.features}
                    onChange={(e) => setFormData({ ...formData, features: e.target.value })}
                    rows={3}
                    className="w-full px-3 py-2 border border-border-subtle rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
                    placeholder='["Feature 1", "Feature 2"]'
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-text-primary mb-1">
                    Example Prompts (JSON array)
                  </label>
                  <textarea
                    value={formData.example_prompts}
                    onChange={(e) => setFormData({ ...formData, example_prompts: e.target.value })}
                    rows={3}
                    className="w-full px-3 py-2 border border-border-subtle rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
                    placeholder='["How do I...", "Can you help with..."]'
                  />
                </div>

                <div className="md:col-span-2 flex flex-wrap gap-6">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={formData.is_enabled}
                      onChange={(e) => setFormData({ ...formData, is_enabled: e.target.checked })}
                      className="rounded border-border-subtle"
                    />
                    <span className="text-sm text-text-secondary">Enabled</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={formData.requires_subscription}
                      onChange={(e) =>
                        setFormData({ ...formData, requires_subscription: e.target.checked })
                      }
                      className="rounded border-border-subtle"
                    />
                    <span className="text-sm text-text-secondary">Requires Subscription</span>
                  </label>
                </div>
              </div>

              {/* Tools Selection */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-text-primary mb-2">
                  Available Tools
                </label>
                <div className="mb-2 flex items-center gap-4 text-xs text-text-muted">
                  <span>Permission badges:</span>
                  <span className="px-1.5 py-0.5 bg-blue-500/20 text-blue-400 rounded font-mono">
                    R
                  </span>
                  <span>Read</span>
                  <span className="px-1.5 py-0.5 bg-amber-500/20 text-amber-400 rounded font-mono">
                    W
                  </span>
                  <span>Write</span>
                  <span className="px-1.5 py-0.5 bg-red-500/20 text-red-400 rounded font-mono">
                    C
                  </span>
                  <span>Command</span>
                  <span className="px-1.5 py-0.5 bg-purple-500/20 text-purple-400 rounded font-mono">
                    D
                  </span>
                  <span>Deploy</span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {tools
                    .filter((t) => t.is_enabled)
                    .map((tool) => (
                      <button
                        key={tool.id}
                        onClick={() => toggleTool(tool.name)}
                        className={cn(
                          'p-2 text-left rounded-lg border transition-colors text-sm',
                          formData.tools.includes(tool.name)
                            ? 'border-purple-500 bg-purple-500/20 text-text-primary'
                            : 'border-border-subtle hover:border-gray-300'
                        )}
                        title={tool.description}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <div className="font-medium truncate">{tool.name}</div>
                          <div className="flex gap-0.5 flex-shrink-0">
                            {tool.is_read_operation && (
                              <span className="px-1 py-0.5 text-[10px] bg-blue-500/20 text-blue-400 rounded font-mono">
                                R
                              </span>
                            )}
                            {tool.is_write_operation && (
                              <span className="px-1 py-0.5 text-[10px] bg-amber-500/20 text-amber-400 rounded font-mono">
                                W
                              </span>
                            )}
                            {tool.is_command_operation && (
                              <span className="px-1 py-0.5 text-[10px] bg-red-500/20 text-red-400 rounded font-mono">
                                C
                              </span>
                            )}
                            {tool.is_deploy_operation && (
                              <span className="px-1 py-0.5 text-[10px] bg-purple-500/20 text-purple-400 rounded font-mono">
                                D
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="text-xs text-text-muted truncate">{tool.category}</div>
                      </button>
                    ))}
                </div>
                <p className="text-xs text-text-muted mt-1">
                  Selected: {formData.tools.length} tools
                </p>
              </div>

              <div className="flex justify-end gap-3">
                <button
                  onClick={() => {
                    setShowCreateForm(false);
                    cancelEdit();
                  }}
                  className="px-4 py-2 text-text-secondary hover:bg-overlay/30 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={editingRole ? () => handleUpdate(editingRole.id) : handleCreate}
                  disabled={saving || !formData.role || !formData.name || !formData.system_prompt}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <Save className="h-4 w-4" />
                  {saving ? 'Saving...' : editingRole ? 'Update' : 'Create'}
                </button>
              </div>
            </div>
          )}

          {/* Roles List */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {roles.map((role) => (
              <div
                key={role.id}
                className={cn(
                  'group relative p-5 rounded-2xl border transition-all duration-200 hover:scale-[1.02]',
                  role.is_enabled
                    ? 'bg-gradient-to-br from-surface to-elevated border-border-subtle hover:shadow-lg'
                    : 'bg-surface/50 border-border-subtle opacity-60'
                )}
                style={
                  {
                    '--role-color': getColorValue(role.color),
                  } as React.CSSProperties
                }
              >
                {/* Subtle gradient accent */}
                <div
                  className="absolute inset-0 rounded-2xl opacity-5"
                  style={{
                    background: `linear-gradient(135deg, ${getColorValue(role.color)} 0%, transparent 60%)`,
                  }}
                />

                <div className="relative">
                  <div className="flex items-start gap-4">
                    <div className="relative">
                      <div
                        className="w-12 h-12 rounded-xl flex items-center justify-center text-white font-bold text-lg shadow-lg"
                        style={{
                          background: `linear-gradient(135deg, ${getColorValue(role.color)} 0%, ${getColorValue(role.color)}dd 100%)`,
                        }}
                      >
                        {role.name[0]}
                      </div>
                      {role.is_enabled && (
                        <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-green-500 rounded-full border-2 border-surface" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-text-primary truncate">{role.name}</h3>
                      <p className="text-xs text-text-muted font-mono mt-0.5">{role.role}</p>
                    </div>
                  </div>

                  {role.description && (
                    <p className="text-sm text-text-secondary mt-3 line-clamp-2">
                      {role.description}
                    </p>
                  )}

                  {/* Warning for disabled tools */}
                  {(() => {
                    const disabledTools = getDisabledToolsForRole(role);
                    if (disabledTools.length > 0) {
                      return (
                        <div className="mt-3 p-2 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                          <p className="text-xs text-amber-400">
                            ⚠️ {disabledTools.length} disabled tool
                            {disabledTools.length > 1 ? 's' : ''}:{' '}
                            {disabledTools.slice(0, 3).join(', ')}
                            {disabledTools.length > 3 && ` +${disabledTools.length - 3} more`}
                          </p>
                        </div>
                      );
                    }
                    return null;
                  })()}

                  <div className="mt-4 pt-3 border-t border-border-subtle flex items-center justify-between">
                    <div className="text-xs text-text-muted">
                      <span className="font-semibold text-text-primary">
                        {formatNumber(role.usage_count)}
                      </span>{' '}
                      uses • {role.tools.length} tools
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => toggleEnabled(role)}
                        className={cn(
                          'p-1.5 rounded-lg transition-colors',
                          role.is_enabled
                            ? 'text-green-400 hover:bg-green-500/10'
                            : 'text-text-muted hover:bg-elevated'
                        )}
                      >
                        {role.is_enabled ? (
                          <Eye className="h-4 w-4" />
                        ) : (
                          <EyeOff className="h-4 w-4" />
                        )}
                      </button>
                      <button
                        onClick={() => startEdit(role)}
                        className="p-1.5 text-blue-400 hover:bg-blue-500/10 rounded-lg transition-colors"
                      >
                        <Edit className="h-4 w-4" />
                      </button>
                      {!role.is_system && (
                        <button
                          onClick={() => handleDelete(role.id)}
                          className="p-1.5 text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {roles.length === 0 && (
            <div className="text-center py-16 bg-surface rounded-2xl border border-border-subtle">
              <Workflow className="h-12 w-12 text-text-muted mx-auto mb-4" />
              <p className="text-text-muted">No agent roles configured yet.</p>
              <button
                onClick={() => setShowCreateForm(true)}
                className="mt-4 text-purple-400 hover:text-purple-300"
              >
                Create your first role
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function getColorValue(color: string): string {
  const colors: Record<string, string> = {
    cyan: '#06b6d4',
    purple: '#a855f7',
    green: '#22c55e',
    orange: '#f97316',
    red: '#ef4444',
    blue: '#3b82f6',
    emerald: '#10b981',
    pink: '#ec4899',
    amber: '#f59e0b',
    violet: '#8b5cf6',
    indigo: '#6366f1',
  };
  return colors[color] || '#6b7280';
}
