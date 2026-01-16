'use client';

import { useEffect, useState, useMemo } from 'react';
import {
  X,
  Bot,
  Code,
  Eye,
  FileText,
  MessageCircle,
  Server,
  Shield,
  TestTube,
  Wrench,
  Sparkles,
  Search,
  User,
  Share2,
  Check,
  Copy,
  ExternalLink,
  Workflow,
  Pause,
  Play,
  Clock,
  AlertTriangle,
  Loader2,
  Plug,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/stores/ui';
import { useSessionStore, type Agent } from '@/stores/session';
import { MCPSettings } from '@/components/settings/MCPSettings';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import {
  api,
  createAgent,
  getAgentTemplates,
  createShareLink,
  pauseWorkspace,
  resumeWorkspace,
  getStandbySettings,
  updateStandbySettings,
  clearStandbySettings,
  type AgentTemplate,
} from '@/lib/api';

interface TerminalAgentType {
  id: string;
  name: string;
  slug: string;
  logo_url?: string;
  description?: string;
  is_enabled: boolean;
}

interface EnvProfile {
  id: string;
  name: string;
  agent_type_id?: string;
  env_vars: Record<string, string>;
}

interface ModalLayerProps {
  sessionId: string;
}

type AgentRole =
  | 'architect'
  | 'coder'
  | 'reviewer'
  | 'tester'
  | 'agent_builder'
  | 'orchestrator'
  | 'chat'
  | 'security'
  | 'devops'
  | 'documentator'
  | 'custom';
type AgentStatus = 'idle' | 'active' | 'error';

type AgentOption = {
  id: string;
  role: AgentRole;
  name: string;
  icon: typeof Bot;
  color: string;
  description: string;
  isCustom: boolean;
  templateId?: string;
  shareToken?: string | null;
};

const BUILTIN_AGENTS: AgentOption[] = [
  {
    id: 'architect',
    role: 'architect',
    name: 'Architect',
    icon: Wrench,
    color: '#a855f7',
    description: 'Plans system architecture and makes high-level design decisions',
    isCustom: false,
  },
  {
    id: 'coder',
    role: 'coder',
    name: 'Coder',
    icon: Code,
    color: '#22c55e',
    description: 'Writes and modifies code based on requirements',
    isCustom: false,
  },
  {
    id: 'reviewer',
    role: 'reviewer',
    name: 'Reviewer',
    icon: Eye,
    color: '#f59e0b',
    description: 'Reviews code for quality, bugs, and best practices',
    isCustom: false,
  },
  {
    id: 'tester',
    role: 'tester',
    name: 'Tester',
    icon: TestTube,
    color: '#00e5ff',
    description: 'Writes and runs tests to ensure code quality',
    isCustom: false,
  },
  {
    id: 'agent_builder',
    role: 'agent_builder',
    name: 'Agent Builder',
    icon: Sparkles,
    color: '#ec4899',
    description: 'Create custom AI agents through conversation',
    isCustom: false,
  },
  {
    id: 'orchestrator',
    role: 'orchestrator',
    name: 'Orchestrator',
    icon: Workflow,
    color: '#06b6d4',
    description: 'Coordinates multiple agents, delegates tasks, and synthesizes results',
    isCustom: false,
  },
  {
    id: 'chat',
    role: 'chat',
    name: 'Chat',
    icon: MessageCircle,
    color: '#8b5cf6',
    description: 'Conversational assistant for discussions with no file or command access',
    isCustom: false,
  },
  {
    id: 'security',
    role: 'security',
    name: 'Security',
    icon: Shield,
    color: '#ef4444',
    description: 'Identifies security vulnerabilities and recommends fixes',
    isCustom: false,
  },
  {
    id: 'devops',
    role: 'devops',
    name: 'DevOps',
    icon: Server,
    color: '#10b981',
    description: 'Designs and implements infrastructure and deployment pipelines',
    isCustom: false,
  },
  {
    id: 'documentator',
    role: 'documentator',
    name: 'Documentator',
    icon: FileText,
    color: '#f59e0b',
    description: 'Writes comprehensive code documentation and guides',
    isCustom: false,
  },
];

function CreateAgentModal({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const { addAgent, sessions } = useSessionStore();
  const workspaceId = sessions[sessionId]?.workspaceId ?? '';
  const [activeTab, setActiveTab] = useState<'podex' | 'external'>('podex');

  // Focus trap for accessibility
  const modalRef = useFocusTrap<HTMLDivElement>(true);

  // Podex native agent state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAgent, setSelectedAgent] = useState<AgentOption | null>(null);
  const [customName, setCustomName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customTemplates, setCustomTemplates] = useState<AgentTemplate[]>([]);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(true);

  // External terminal agent state
  const [terminalAgentTypes, setTerminalAgentTypes] = useState<TerminalAgentType[]>([]);
  const [_envProfiles, setEnvProfiles] = useState<EnvProfile[]>([]);
  const [selectedTerminalAgent, setSelectedTerminalAgent] = useState<TerminalAgentType | null>(
    null
  );
  const [selectedEnvProfile, _setSelectedEnvProfile] = useState<EnvProfile | null>(null);
  const [isLoadingTerminalAgents, setIsLoadingTerminalAgents] = useState(false);
  const [_isLoadingEnvProfiles, setIsLoadingEnvProfiles] = useState(false);

  // Fetch custom templates on mount
  useEffect(() => {
    const fetchTemplates = async () => {
      try {
        const templates = await getAgentTemplates();
        setCustomTemplates(templates);
      } catch (err) {
        console.error('Failed to fetch templates:', err);
      } finally {
        setIsLoadingTemplates(false);
      }
    };
    fetchTemplates();
  }, []);

  // Fetch terminal agents and env profiles when external tab is active
  useEffect(() => {
    if (activeTab === 'external') {
      const fetchTerminalAgents = async () => {
        setIsLoadingTerminalAgents(true);
        try {
          const data = await api.get<TerminalAgentType[]>(
            '/api/v1/terminal-agents/terminal-agent-types'
          );
          setTerminalAgentTypes(data);
        } catch (err) {
          console.error('Failed to fetch terminal agents:', err);
        } finally {
          setIsLoadingTerminalAgents(false);
        }
      };

      const fetchEnvProfiles = async () => {
        setIsLoadingEnvProfiles(true);
        try {
          const data = await api.get<EnvProfile[]>('/api/v1/terminal-agents/env-profiles');
          setEnvProfiles(data);
        } catch (err) {
          console.error('Failed to fetch env profiles:', err);
        } finally {
          setIsLoadingEnvProfiles(false);
        }
      };

      fetchTerminalAgents();
      fetchEnvProfiles();
    }
  }, [activeTab]);

  // Convert custom templates to AgentOption format
  const customAgentOptions: AgentOption[] = useMemo(() => {
    return customTemplates.map((template) => ({
      id: template.id,
      role: 'custom',
      name: template.name,
      icon: User,
      color: '#6366f1',
      description: template.description || 'Custom agent template',
      model: template.model,
      isCustom: true,
      templateId: template.id,
      shareToken: template.share_token,
    }));
  }, [customTemplates]);

  // Filter agents based on search
  const filteredAgents = useMemo(() => {
    const allAgents = [...BUILTIN_AGENTS, ...customAgentOptions];
    if (!searchQuery.trim()) return allAgents;

    const query = searchQuery.toLowerCase();
    return allAgents.filter(
      (agent) =>
        agent.name.toLowerCase().includes(query) ||
        agent.description.toLowerCase().includes(query) ||
        agent.role.toLowerCase().includes(query)
    );
  }, [searchQuery, customAgentOptions]);

  // Group filtered agents
  const builtinFiltered = filteredAgents.filter((a) => !a.isCustom);
  const customFiltered = filteredAgents.filter((a) => a.isCustom);

  const handleCreate = async () => {
    setIsCreating(true);
    setError(null);

    try {
      if (activeTab === 'podex') {
        // Create Podex native agent
        if (!selectedAgent) return;

        const createdAgent = await createAgent(sessionId, {
          name: customName || selectedAgent.name,
          role: selectedAgent.role,
          template_id: selectedAgent.templateId,
        });

        const agentColor =
          typeof createdAgent.config?.color === 'string'
            ? createdAgent.config.color
            : selectedAgent.color;
        const agent: Agent = {
          id: createdAgent.id,
          name: createdAgent.name,
          role: createdAgent.role as AgentRole,
          model: createdAgent.model,
          status: (createdAgent.status || 'idle') as AgentStatus,
          color: agentColor,
          mode: 'auto',
          templateId: createdAgent.template_id ?? undefined,
          messages: [],
        };

        addAgent(sessionId, agent);
      } else {
        // Create external terminal agent
        if (!selectedTerminalAgent) return;
        if (!workspaceId) {
          throw new Error('No workspace available. Please ensure the session has a workspace.');
        }

        const terminalSession = await api.post<{ id: string }>('/api/v1/terminal-agents', {
          workspace_id: workspaceId,
          agent_type_id: selectedTerminalAgent.id,
          env_profile_id: selectedEnvProfile?.id,
        });

        // Create a placeholder agent in the session store for the terminal
        const agent: Agent = {
          id: `terminal-${terminalSession.id}`,
          name: customName || selectedTerminalAgent.name,
          role: 'custom' as AgentRole,
          model: 'terminal',
          status: 'active' as AgentStatus,
          color: '#10b981',
          mode: 'auto',
          terminalSessionId: terminalSession.id,
          terminalAgentTypeId: selectedTerminalAgent.id,
          messages: [],
          gridSpan: { colSpan: 2, rowSpan: 2 }, // Default to 2x2 for better terminal visibility
        };

        addAgent(sessionId, agent);
      }

      onClose();
    } catch (err: unknown) {
      // Extract error message from different error types
      let errorMessage = 'Failed to create agent';
      if (err instanceof Error) {
        errorMessage = err.message;
      } else if (typeof err === 'object' && err !== null && 'detail' in err) {
        errorMessage = String((err as { detail: unknown }).detail);
      } else if (typeof err === 'string') {
        errorMessage = err;
      }

      setError(errorMessage);
    } finally {
      setIsCreating(false);
    }
  };

  // State for share popover
  const [sharingAgentId, setSharingAgentId] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareCopied, setShareCopied] = useState(false);
  const [isGeneratingLink, setIsGeneratingLink] = useState(false);

  const handleShare = async (e: React.MouseEvent, agent: AgentOption) => {
    e.stopPropagation();

    if (sharingAgentId === agent.id) {
      // Close if already open
      setSharingAgentId(null);
      setShareUrl(null);
      return;
    }

    setSharingAgentId(agent.id);
    setShareCopied(false);

    if (agent.shareToken) {
      // Already has share link
      setShareUrl(`${window.location.origin}/agents/shared/${agent.shareToken}`);
    } else {
      // Generate new share link
      setIsGeneratingLink(true);
      try {
        const result = await createShareLink(agent.id);
        setShareUrl(`${window.location.origin}${result.share_url}`);
        // Update the template in local state
        setCustomTemplates((prev) =>
          prev.map((t) => (t.id === agent.id ? { ...t, share_token: result.share_token } : t))
        );
      } catch (err) {
        console.error('Failed to generate share link:', err);
      } finally {
        setIsGeneratingLink(false);
      }
    }
  };

  const handleCopyShareUrl = () => {
    if (shareUrl) {
      navigator.clipboard.writeText(shareUrl);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    }
  };

  const AgentButton = ({ agent }: { agent: AgentOption }) => {
    const Icon = agent.icon;
    const isSharing = sharingAgentId === agent.id;

    return (
      <div className="relative">
        <button
          onClick={() => {
            setSelectedAgent(agent);
            setCustomName('');
            setSharingAgentId(null);
          }}
          className={`w-full flex items-start gap-3 rounded-lg border p-3 text-left transition-all ${
            selectedAgent?.id === agent.id
              ? 'border-accent-primary bg-accent-primary/5 ring-1 ring-accent-primary'
              : 'border-border-default hover:border-border-subtle hover:bg-overlay'
          }`}
        >
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
            style={{ backgroundColor: `${agent.color}20` }}
          >
            <Icon className="h-4 w-4" style={{ color: agent.color }} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="font-medium text-text-primary truncate">{agent.name}</h3>
              {agent.isCustom && (
                <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-400 font-medium">
                  Custom
                </span>
              )}
            </div>
            <p className="text-xs text-text-muted line-clamp-2">{agent.description}</p>
          </div>
          {agent.isCustom && (
            <button
              onClick={(e) => handleShare(e, agent)}
              className={`shrink-0 p-1.5 rounded-md transition-colors ${
                isSharing
                  ? 'bg-accent-primary/10 text-accent-primary'
                  : 'text-text-muted hover:text-text-primary hover:bg-overlay'
              }`}
              title="Share agent"
            >
              <Share2 className="h-4 w-4" />
            </button>
          )}
        </button>

        {/* Share Popover */}
        {isSharing && (
          <div className="absolute right-0 top-full mt-2 z-50 w-72 rounded-lg border border-border-default bg-surface shadow-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <Share2 className="h-4 w-4 text-accent-primary" />
              <span className="font-medium text-text-primary">Share Agent</span>
            </div>

            {isGeneratingLink ? (
              <div className="flex items-center gap-2 text-text-muted text-sm py-2">
                <div className="h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                Generating link...
              </div>
            ) : shareUrl ? (
              <>
                <p className="text-xs text-text-muted mb-3">
                  Anyone with this link can preview and clone this agent.
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    readOnly
                    value={shareUrl}
                    className="flex-1 px-3 py-1.5 text-xs bg-elevated border border-border-default rounded-md text-text-secondary truncate"
                  />
                  <button
                    onClick={handleCopyShareUrl}
                    className="shrink-0 px-3 py-1.5 rounded-md bg-accent-primary text-text-inverse text-xs font-medium hover:bg-accent-primary/90 transition-colors flex items-center gap-1"
                  >
                    {shareCopied ? (
                      <>
                        <Check className="h-3 w-3" />
                        Copied!
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3" />
                        Copy
                      </>
                    )}
                  </button>
                </div>
                <a
                  href={shareUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 flex items-center gap-1.5 text-xs text-accent-primary hover:underline"
                >
                  <ExternalLink className="h-3 w-3" />
                  Preview share page
                </a>
              </>
            ) : null}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-void/80 backdrop-blur-sm"
        onClick={() => {
          setSharingAgentId(null);
          onClose();
        }}
      />

      {/* Modal */}
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className="relative w-full max-w-2xl max-h-[85vh] flex flex-col rounded-xl border border-border-default bg-surface shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border-subtle px-6 py-4 shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-primary/10">
              <Bot className="h-5 w-5 text-accent-primary" />
            </div>
            <div>
              <h2 id="modal-title" className="text-lg font-semibold text-text-primary">
                Add Agent
              </h2>
              <p className="text-sm text-text-muted">
                Choose an AI agent to help with your project
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-2 text-text-muted hover:bg-overlay hover:text-text-primary"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="px-6 py-3 border-b border-border-subtle shrink-0">
          <div className="flex gap-1">
            <button
              onClick={() => setActiveTab('podex')}
              className={cn(
                'px-4 py-2 text-sm font-medium rounded-lg transition-colors',
                activeTab === 'podex'
                  ? 'bg-accent-primary text-text-inverse'
                  : 'text-text-secondary hover:text-text-primary hover:bg-overlay'
              )}
            >
              Podex Native
            </button>
            <button
              onClick={() => setActiveTab('external')}
              className={cn(
                'px-4 py-2 text-sm font-medium rounded-lg transition-colors',
                activeTab === 'external'
                  ? 'bg-accent-primary text-text-inverse'
                  : 'text-text-secondary hover:text-text-primary hover:bg-overlay'
              )}
            >
              External Terminal
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {activeTab === 'podex' ? (
            <div className="p-6">
              {/* Search for Podex agents */}
              <div className="mb-4">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search agents..."
                    autoFocus
                    className="w-full rounded-lg border border-border-default bg-elevated pl-10 pr-4 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-primary focus:outline-none focus:ring-1 focus:ring-accent-primary"
                  />
                </div>
              </div>
              {isLoadingTemplates ? (
                <div className="flex items-center justify-center py-8 text-text-muted">
                  Loading agents...
                </div>
              ) : filteredAgents.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <Search className="h-8 w-8 text-text-muted mb-2" />
                  <p className="text-text-secondary">No agents found</p>
                  <p className="text-sm text-text-muted">Try a different search term</p>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Built-in agents */}
                  {builtinFiltered.length > 0 && (
                    <div>
                      <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">
                        Built-in Agents
                      </h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {builtinFiltered.map((agent) => (
                          <AgentButton key={agent.id} agent={agent} />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Custom agents */}
                  {customFiltered.length > 0 && (
                    <div>
                      <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">
                        Your Custom Agents
                      </h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {customFiltered.map((agent) => (
                          <AgentButton key={agent.id} agent={agent} />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* No custom agents hint */}
                  {customTemplates.length === 0 && !searchQuery && (
                    <div className="text-center py-4 px-6 rounded-lg bg-elevated border border-border-subtle">
                      <Sparkles className="h-5 w-5 text-pink-400 mx-auto mb-2" />
                      <p className="text-sm text-text-secondary">
                        Create your own agents with the <strong>Agent Builder</strong>
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Custom name input for Podex agents */}
              {activeTab === 'podex' && selectedAgent && (
                <div className="mt-6 pt-6 border-t border-border-subtle px-6">
                  <label className="block text-sm font-medium text-text-secondary mb-2">
                    Custom Name (optional)
                  </label>
                  <input
                    type="text"
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                    placeholder={selectedAgent.name}
                    className="w-full rounded-lg border border-border-default bg-elevated px-4 py-2 text-text-primary placeholder:text-text-muted focus:border-accent-primary focus:outline-none focus:ring-1 focus:ring-accent-primary"
                  />
                </div>
              )}
            </div>
          ) : (
            <div className="p-6">
              {/* External Terminal Agents */}
              {isLoadingTerminalAgents ? (
                <div className="flex items-center justify-center py-8 text-text-muted">
                  <Loader2 className="h-5 w-5 animate-spin mr-2" />
                  Loading terminal agents...
                </div>
              ) : terminalAgentTypes.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <Plug className="h-8 w-8 text-text-muted mb-2" />
                  <p className="text-text-secondary">No terminal agents available</p>
                  <p className="text-sm text-text-muted">Configure external agents in settings</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {terminalAgentTypes.map((agent) => (
                    <button
                      key={agent.id}
                      onClick={() => setSelectedTerminalAgent(agent)}
                      className={cn(
                        'w-full p-4 rounded-lg border text-left transition-colors',
                        selectedTerminalAgent?.id === agent.id
                          ? 'border-accent-primary bg-accent-primary/10'
                          : 'border-border-default hover:border-border-subtle hover:bg-overlay'
                      )}
                    >
                      <div className="flex items-center gap-3">
                        {agent.logo_url ? (
                          <img src={agent.logo_url} alt={agent.name} className="h-8 w-8 rounded" />
                        ) : (
                          <Plug className="h-8 w-8 text-text-muted" />
                        )}
                        <div>
                          <h4 className="font-medium text-text-primary">{agent.name}</h4>
                          {agent.description && (
                            <p className="text-sm text-text-muted">{agent.description}</p>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Error Display - Fixed position above footer */}
        {error && (
          <div className="px-6 py-4 border-t border-border-subtle shrink-0 bg-surface">
            <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h4 className="text-sm font-semibold text-red-300 mb-1">
                    {error.includes('quota') || error.includes('exceeded')
                      ? 'Agent Limit Reached'
                      : 'Failed to Create Agent'}
                  </h4>
                  <p className="text-sm text-red-400/90">{error}</p>
                  {(error.includes('quota') || error.includes('exceeded')) && (
                    <p className="text-xs text-red-400/70 mt-2">
                      Remove an existing agent or upgrade your plan to add more agents.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-border-subtle px-6 py-4 shrink-0">
          <div className="text-sm text-text-muted">
            {activeTab === 'podex' && selectedAgent && (
              <span>
                Selected: <strong className="text-text-secondary">{selectedAgent.name}</strong>
              </span>
            )}
            {activeTab === 'external' && selectedTerminalAgent && (
              <span>
                Selected:{' '}
                <strong className="text-text-secondary">{selectedTerminalAgent.name}</strong>
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              disabled={isCreating}
              className="rounded-lg px-4 py-2 text-sm font-medium text-text-secondary hover:bg-overlay hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={
                (activeTab === 'podex' && !selectedAgent) ||
                (activeTab === 'external' && !selectedTerminalAgent) ||
                isCreating
              }
              className="rounded-lg bg-accent-primary px-4 py-2 text-sm font-medium text-text-inverse hover:bg-accent-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isCreating ? 'Creating...' : 'Add Agent'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ==================== Standby/Pause Modals ====================

function PauseSessionModal({
  sessionId,
  workspaceId,
  onClose,
}: {
  sessionId: string;
  workspaceId: string;
  onClose: () => void;
}) {
  const [isPausing, setIsPausing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { setWorkspaceStatus } = useSessionStore();

  const handlePause = async () => {
    setIsPausing(true);
    setError(null);

    try {
      const result = await pauseWorkspace(workspaceId);
      setWorkspaceStatus(sessionId, result.status, result.standby_at);
      onClose();
    } catch (err) {
      console.error('Failed to pause workspace:', err);
      setError(err instanceof Error ? err.message : 'Failed to pause session');
    } finally {
      setIsPausing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-void/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-xl border border-border-default bg-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-border-subtle px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-yellow-500/10">
              <Pause className="h-5 w-5 text-yellow-500" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-text-primary">Pause Session</h2>
              <p className="text-sm text-text-muted">Enter standby mode</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-2 text-text-muted hover:bg-overlay hover:text-text-primary"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6">
          <div className="flex items-start gap-3 p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/20 mb-4">
            <AlertTriangle className="h-5 w-5 text-yellow-500 shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="text-yellow-200 font-medium">Pausing will stop your workspace</p>
              <p className="text-yellow-200/70 mt-1">
                The Docker container will be stopped to save resources. Resuming typically takes
                10-30 seconds.
              </p>
            </div>
          </div>

          <p className="text-sm text-text-secondary mb-4">
            Your files and state will be preserved. You can resume the session at any time from the
            dashboard or command palette.
          </p>

          {error && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm mb-4">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-border-subtle px-6 py-4">
          <button
            onClick={onClose}
            disabled={isPausing}
            className="rounded-lg px-4 py-2 text-sm font-medium text-text-secondary hover:bg-overlay hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handlePause}
            disabled={isPausing}
            className="rounded-lg bg-yellow-500 px-4 py-2 text-sm font-medium text-black hover:bg-yellow-400 disabled:cursor-not-allowed disabled:opacity-50 flex items-center gap-2"
          >
            {isPausing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Pausing...
              </>
            ) : (
              <>
                <Pause className="h-4 w-4" />
                Pause Session
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function ResumeSessionModal({
  sessionId,
  workspaceId,
  onClose,
}: {
  sessionId: string;
  workspaceId: string;
  onClose: () => void;
}) {
  const [isResuming, setIsResuming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { setWorkspaceStatus } = useSessionStore();

  const handleResume = async () => {
    setIsResuming(true);
    setError(null);

    try {
      const result = await resumeWorkspace(workspaceId);
      setWorkspaceStatus(sessionId, result.status, null);
      onClose();
    } catch (err) {
      console.error('Failed to resume workspace:', err);
      setError(err instanceof Error ? err.message : 'Failed to resume session');
    } finally {
      setIsResuming(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-void/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-xl border border-border-default bg-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-border-subtle px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/10">
              <Play className="h-5 w-5 text-green-500" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-text-primary">Resume Session</h2>
              <p className="text-sm text-text-muted">Wake from standby</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-2 text-text-muted hover:bg-overlay hover:text-text-primary"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6">
          <p className="text-sm text-text-secondary mb-4">
            Your session is currently in standby mode. Resuming will restart the Docker container
            and restore your workspace.
          </p>

          <div className="flex items-start gap-3 p-4 rounded-lg bg-blue-500/10 border border-blue-500/20 mb-4">
            <Clock className="h-5 w-5 text-blue-400 shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="text-blue-200">This may take 10-30 seconds</p>
              <p className="text-blue-200/70 mt-1">
                The container needs to restart. Please wait while we restore your environment.
              </p>
            </div>
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm mb-4">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-border-subtle px-6 py-4">
          <button
            onClick={onClose}
            disabled={isResuming}
            className="rounded-lg px-4 py-2 text-sm font-medium text-text-secondary hover:bg-overlay hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleResume}
            disabled={isResuming}
            className="rounded-lg bg-green-500 px-4 py-2 text-sm font-medium text-black hover:bg-green-400 disabled:cursor-not-allowed disabled:opacity-50 flex items-center gap-2"
          >
            {isResuming ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Resuming...
              </>
            ) : (
              <>
                <Play className="h-4 w-4" />
                Resume Session
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

const TIMEOUT_OPTIONS = [
  { value: 15, label: '15 minutes' },
  { value: 30, label: '30 minutes' },
  { value: 60, label: '1 hour' },
  { value: 120, label: '2 hours' },
  { value: null, label: 'Never' },
];

function StandbySettingsModal({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  // Focus trap for accessibility
  const modalRef = useFocusTrap<HTMLDivElement>(true);

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeoutMinutes, setTimeoutMinutes] = useState<number | null>(60);
  const [_source, setSource] = useState<'session' | 'user_default'>('user_default');
  const [useSessionOverride, setUseSessionOverride] = useState(false);
  const { setStandbySettings } = useSessionStore();

  // Load current settings
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const settings = await getStandbySettings(sessionId);
        setTimeoutMinutes(settings.timeout_minutes);
        setSource(settings.source);
        setUseSessionOverride(settings.source === 'session');
      } catch (err) {
        console.error('Failed to load standby settings:', err);
        setError('Failed to load settings');
      } finally {
        setIsLoading(false);
      }
    };
    loadSettings();
  }, [sessionId]);

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);

    try {
      let result;
      if (useSessionOverride) {
        result = await updateStandbySettings(sessionId, timeoutMinutes);
      } else {
        result = await clearStandbySettings(sessionId);
      }
      setStandbySettings(sessionId, {
        timeoutMinutes: result.timeout_minutes,
        source: result.source,
      });
      onClose();
    } catch (err) {
      console.error('Failed to save standby settings:', err);
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-void/80 backdrop-blur-sm" onClick={onClose} />
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="standby-modal-title"
        className="relative w-full max-w-md rounded-xl border border-border-default bg-surface shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-border-subtle px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-primary/10">
              <Clock className="h-5 w-5 text-accent-primary" />
            </div>
            <div>
              <h2 id="standby-modal-title" className="text-lg font-semibold text-text-primary">
                Auto-Standby Settings
              </h2>
              <p className="text-sm text-text-muted">Configure idle timeout</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-2 text-text-muted hover:bg-overlay hover:text-text-primary"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
            </div>
          ) : (
            <>
              <p className="text-sm text-text-secondary mb-4">
                Your session will automatically pause after a period of inactivity to save
                resources. Resuming a paused session takes 10-30 seconds.
              </p>

              <div className="space-y-4">
                <div>
                  <label className="flex items-center gap-2 mb-3">
                    <input
                      type="checkbox"
                      checked={useSessionOverride}
                      onChange={(e) => setUseSessionOverride(e.target.checked)}
                      className="rounded border-border-default bg-elevated text-accent-primary focus:ring-accent-primary"
                    />
                    <span className="text-sm text-text-primary">
                      Override default for this session only
                    </span>
                  </label>

                  {!useSessionOverride && (
                    <p className="text-xs text-text-muted mb-3">
                      Using your default timeout setting. Change it in{' '}
                      <a href="/settings" className="text-accent-primary hover:underline">
                        user settings
                      </a>
                      .
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-2">
                    Auto-pause after inactivity
                  </label>
                  <select
                    value={timeoutMinutes === null ? 'never' : timeoutMinutes.toString()}
                    onChange={(e) =>
                      setTimeoutMinutes(
                        e.target.value === 'never' ? null : parseInt(e.target.value)
                      )
                    }
                    disabled={!useSessionOverride}
                    className="w-full rounded-lg border border-border-default bg-elevated px-4 py-2 text-text-primary focus:border-accent-primary focus:outline-none focus:ring-1 focus:ring-accent-primary disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {TIMEOUT_OPTIONS.map((opt) => (
                      <option key={opt.value ?? 'never'} value={opt.value ?? 'never'}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {error && (
                <div className="mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                  {error}
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-border-subtle px-6 py-4">
          <button
            onClick={onClose}
            disabled={isSaving}
            className="rounded-lg px-4 py-2 text-sm font-medium text-text-secondary hover:bg-overlay hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isLoading || isSaving}
            className="rounded-lg bg-accent-primary px-4 py-2 text-sm font-medium text-text-inverse hover:bg-accent-primary/90 disabled:cursor-not-allowed disabled:opacity-50 flex items-center gap-2"
          >
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              'Save Settings'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function MCPSettingsModal({ onClose }: { onClose: () => void }) {
  // Focus trap for accessibility
  const modalRef = useFocusTrap<HTMLDivElement>(true);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-void/80 backdrop-blur-sm" onClick={onClose} />
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mcp-modal-title"
        className="relative w-full max-w-3xl max-h-[85vh] flex flex-col rounded-xl border border-border-default bg-surface shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border-subtle px-6 py-4 shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-primary/10">
              <Plug className="h-5 w-5 text-accent-primary" />
            </div>
            <div>
              <h2 id="mcp-modal-title" className="text-lg font-semibold text-text-primary">
                MCP Integrations
              </h2>
              <p className="text-sm text-text-muted">
                Configure Model Context Protocol servers and tools
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-2 text-text-muted hover:bg-overlay hover:text-text-primary"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* MCPSettings content */}
        <div className="flex-1 overflow-hidden">
          <MCPSettings className="h-full" />
        </div>
      </div>
    </div>
  );
}

export function ModalLayer({ sessionId }: ModalLayerProps) {
  const { activeModal, closeModal } = useUIStore();
  const { sessions } = useSessionStore();
  const currentSession = sessions[sessionId];

  // Close modal on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && activeModal) {
        closeModal();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeModal, closeModal]);

  if (!activeModal) return null;

  const workspaceId = currentSession?.workspaceId;

  return (
    <>
      {activeModal === 'create-agent' && (
        <CreateAgentModal sessionId={sessionId} onClose={closeModal} />
      )}
      {activeModal === 'pause-session' && workspaceId && (
        <PauseSessionModal sessionId={sessionId} workspaceId={workspaceId} onClose={closeModal} />
      )}
      {activeModal === 'resume-session' && workspaceId && (
        <ResumeSessionModal sessionId={sessionId} workspaceId={workspaceId} onClose={closeModal} />
      )}
      {activeModal === 'standby-settings' && (
        <StandbySettingsModal sessionId={sessionId} onClose={closeModal} />
      )}
      {activeModal === 'mcp-settings' && <MCPSettingsModal onClose={closeModal} />}
    </>
  );
}
