'use client';

import React, { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import {
  X,
  Bot,
  Search,
  Share2,
  Check,
  Copy,
  ExternalLink,
  Sparkles,
  AlertTriangle,
  Loader2,
  Plug,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSessionStore, type Agent } from '@/stores/session';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import {
  api,
  createAgent,
  getAgentTemplates,
  createShareLink,
  type AgentTemplate,
} from '@/lib/api';
import {
  createCustomAgentOption,
  createAgentOptionFromRole,
  type AgentOption,
  type AgentRole,
  type AgentStatus,
} from './agentConstants';
import { useConfigStore } from '@/stores/config';

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

interface CreateAgentModalProps {
  sessionId: string;
  onClose: () => void;
}

/**
 * Modal for creating new agents (Podex native or external terminal).
 */
export function CreateAgentModal({ sessionId, onClose }: CreateAgentModalProps) {
  const { addAgent, sessions } = useSessionStore();
  const workspaceId = sessions[sessionId]?.workspaceId ?? '';
  const [activeTab, setActiveTab] = useState<'podex' | 'external'>('podex');

  // Get agent roles from config store
  const agentRoles = useConfigStore((state) => state.agentRoles);

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

  // Share state
  const [sharingAgentId, setSharingAgentId] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareCopied, setShareCopied] = useState(false);
  const [isGeneratingLink, setIsGeneratingLink] = useState(false);

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

  // Fetch terminal agents when external tab is active
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

  // Convert agent roles to AgentOption format
  const builtinAgentOptions: AgentOption[] = useMemo(() => {
    return agentRoles.map(createAgentOptionFromRole);
  }, [agentRoles]);

  // Convert custom templates to AgentOption format
  const customAgentOptions: AgentOption[] = useMemo(() => {
    return customTemplates.map(createCustomAgentOption);
  }, [customTemplates]);

  // Filter agents based on search
  const filteredAgents = useMemo(() => {
    const allAgents = [...builtinAgentOptions, ...customAgentOptions];
    if (!searchQuery.trim()) return allAgents;

    const query = searchQuery.toLowerCase();
    return allAgents.filter(
      (agent) =>
        agent.name.toLowerCase().includes(query) ||
        agent.description.toLowerCase().includes(query) ||
        agent.role.toLowerCase().includes(query)
    );
  }, [searchQuery, builtinAgentOptions, customAgentOptions]);

  // Group filtered agents
  const builtinFiltered = filteredAgents.filter((a) => !a.isCustom);
  const customFiltered = filteredAgents.filter((a) => a.isCustom);

  const handleCreate = async () => {
    setIsCreating(true);
    setError(null);

    try {
      if (activeTab === 'podex') {
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
        if (!selectedTerminalAgent) return;
        if (!workspaceId) {
          throw new Error('No workspace available. Please ensure the session has a workspace.');
        }

        const terminalSession = await api.post<{ id: string }>('/api/v1/terminal-agents', {
          workspace_id: workspaceId,
          agent_type_id: selectedTerminalAgent.id,
          env_profile_id: selectedEnvProfile?.id,
        });

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
          gridSpan: { colSpan: 2, rowSpan: 2 },
        };

        addAgent(sessionId, agent);
      }

      onClose();
    } catch (err: unknown) {
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

  const handleShare = async (e: React.MouseEvent, agent: AgentOption) => {
    e.stopPropagation();

    if (sharingAgentId === agent.id) {
      setSharingAgentId(null);
      setShareUrl(null);
      return;
    }

    setSharingAgentId(agent.id);
    setShareCopied(false);

    if (agent.shareToken) {
      setShareUrl(`${window.location.origin}/agents/shared/${agent.shareToken}`);
    } else {
      setIsGeneratingLink(true);
      try {
        const result = await createShareLink(agent.id);
        setShareUrl(`${window.location.origin}${result.share_url}`);
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
          className={cn(
            'w-full flex items-start gap-3 rounded-lg border p-3 text-left transition-all min-h-[72px]',
            selectedAgent?.id === agent.id
              ? 'border-accent-primary bg-accent-primary/5 ring-1 ring-accent-primary'
              : 'border-border-default hover:border-border-subtle hover:bg-overlay'
          )}
          aria-pressed={selectedAgent?.id === agent.id}
        >
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
            style={{ backgroundColor: `${agent.color}20` }}
            aria-hidden="true"
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
              className={cn(
                'shrink-0 p-2 rounded-md transition-colors min-w-[36px] min-h-[36px] flex items-center justify-center',
                isSharing
                  ? 'bg-accent-primary/10 text-accent-primary'
                  : 'text-text-muted hover:text-text-primary hover:bg-overlay'
              )}
              aria-label={`Share ${agent.name}`}
            >
              <Share2 className="h-4 w-4" />
            </button>
          )}
        </button>

        {/* Share Popover */}
        {isSharing && (
          <div
            className="absolute right-0 top-full mt-2 z-50 w-72 rounded-lg border border-border-default bg-surface shadow-xl p-4"
            role="dialog"
            aria-label="Share agent"
          >
            <div className="flex items-center gap-2 mb-3">
              <Share2 className="h-4 w-4 text-accent-primary" aria-hidden="true" />
              <span className="font-medium text-text-primary">Share Agent</span>
            </div>

            {isGeneratingLink ? (
              <div className="flex items-center gap-2 text-text-muted text-sm py-2">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
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
                    className="flex-1 px-3 py-2 text-xs bg-elevated border border-border-default rounded-md text-text-secondary truncate min-h-[36px]"
                    aria-label="Share URL"
                  />
                  <button
                    onClick={handleCopyShareUrl}
                    className="shrink-0 px-3 py-2 rounded-md bg-accent-primary text-text-inverse text-xs font-medium hover:bg-accent-primary/90 transition-colors flex items-center gap-1 min-h-[36px]"
                    aria-label={shareCopied ? 'Copied' : 'Copy URL'}
                  >
                    {shareCopied ? (
                      <>
                        <Check className="h-3 w-3" aria-hidden="true" />
                        Copied!
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3" aria-hidden="true" />
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
                  <ExternalLink className="h-3 w-3" aria-hidden="true" />
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
        aria-hidden="true"
      />

      {/* Modal */}
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-agent-title"
        className="relative w-full max-w-2xl max-h-[85vh] flex flex-col rounded-xl border border-border-default bg-surface shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border-subtle px-6 py-4 shrink-0">
          <div className="flex items-center gap-3">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-primary/10"
              aria-hidden="true"
            >
              <Bot className="h-5 w-5 text-accent-primary" />
            </div>
            <div>
              <h2 id="create-agent-title" className="text-lg font-semibold text-text-primary">
                Add Agent
              </h2>
              <p className="text-sm text-text-muted">
                Choose an AI agent to help with your project
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-2 text-text-muted hover:bg-overlay hover:text-text-primary min-w-[40px] min-h-[40px] flex items-center justify-center"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="px-6 py-3 border-b border-border-subtle shrink-0" role="tablist">
          <div className="flex gap-1">
            <button
              role="tab"
              aria-selected={activeTab === 'podex'}
              onClick={() => setActiveTab('podex')}
              className={cn(
                'px-4 py-2 text-sm font-medium rounded-lg transition-colors min-h-[40px]',
                activeTab === 'podex'
                  ? 'bg-accent-primary text-text-inverse'
                  : 'text-text-secondary hover:text-text-primary hover:bg-overlay'
              )}
            >
              Podex Native
            </button>
            <button
              role="tab"
              aria-selected={activeTab === 'external'}
              onClick={() => setActiveTab('external')}
              className={cn(
                'px-4 py-2 text-sm font-medium rounded-lg transition-colors min-h-[40px]',
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
        <div className="flex-1 overflow-y-auto" role="tabpanel">
          {activeTab === 'podex' ? (
            <div className="p-6">
              {/* Search */}
              <div className="mb-4">
                <div className="relative">
                  <Search
                    className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted"
                    aria-hidden="true"
                  />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search agents..."
                    autoFocus
                    className="w-full rounded-lg border border-border-default bg-elevated pl-10 pr-4 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-primary focus:outline-none focus:ring-1 focus:ring-accent-primary min-h-[44px]"
                    aria-label="Search agents"
                  />
                </div>
              </div>

              {isLoadingTemplates ? (
                <div className="flex items-center justify-center py-8 text-text-muted">
                  <Loader2 className="h-5 w-5 animate-spin mr-2" aria-hidden="true" />
                  Loading agents...
                </div>
              ) : filteredAgents.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <Search className="h-8 w-8 text-text-muted mb-2" aria-hidden="true" />
                  <p className="text-text-secondary">No agents found</p>
                  <p className="text-sm text-text-muted">Try a different search term</p>
                </div>
              ) : (
                <div className="space-y-6" role="listbox" aria-label="Available agents">
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
                      <Sparkles className="h-5 w-5 text-pink-400 mx-auto mb-2" aria-hidden="true" />
                      <p className="text-sm text-text-secondary">
                        Create your own agents with the <strong>Agent Builder</strong>
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Custom name input */}
              {selectedAgent && (
                <div className="mt-6 pt-6 border-t border-border-subtle">
                  <label
                    htmlFor="custom-name"
                    className="block text-sm font-medium text-text-secondary mb-2"
                  >
                    Custom Name (optional)
                  </label>
                  <input
                    id="custom-name"
                    type="text"
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                    placeholder={selectedAgent.name}
                    className="w-full rounded-lg border border-border-default bg-elevated px-4 py-2 text-text-primary placeholder:text-text-muted focus:border-accent-primary focus:outline-none focus:ring-1 focus:ring-accent-primary min-h-[44px]"
                  />
                </div>
              )}
            </div>
          ) : (
            <div className="p-6">
              {/* External Terminal Agents */}
              {isLoadingTerminalAgents ? (
                <div className="flex items-center justify-center py-8 text-text-muted">
                  <Loader2 className="h-5 w-5 animate-spin mr-2" aria-hidden="true" />
                  Loading terminal agents...
                </div>
              ) : terminalAgentTypes.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <Plug className="h-8 w-8 text-text-muted mb-2" aria-hidden="true" />
                  <p className="text-text-secondary">No terminal agents available</p>
                  <p className="text-sm text-text-muted">Configure external agents in settings</p>
                </div>
              ) : (
                <div className="space-y-2" role="listbox" aria-label="Terminal agents">
                  {terminalAgentTypes.map((agent) => (
                    <button
                      key={agent.id}
                      onClick={() => setSelectedTerminalAgent(agent)}
                      className={cn(
                        'w-full p-4 rounded-lg border text-left transition-colors min-h-[72px]',
                        selectedTerminalAgent?.id === agent.id
                          ? 'border-accent-primary bg-accent-primary/10'
                          : 'border-border-default hover:border-border-subtle hover:bg-overlay'
                      )}
                      aria-pressed={selectedTerminalAgent?.id === agent.id}
                    >
                      <div className="flex items-center gap-3">
                        {agent.logo_url ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            src={agent.logo_url}
                            alt=""
                            className="h-8 w-8 rounded"
                            aria-hidden="true"
                          />
                        ) : (
                          <Plug className="h-8 w-8 text-text-muted" aria-hidden="true" />
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

        {/* Error Display */}
        {error && (
          <div className="px-6 py-4 border-t border-border-subtle shrink-0 bg-surface">
            <div
              className="p-4 rounded-lg bg-red-500/10 border border-red-500/20"
              role="alert"
              aria-live="polite"
            >
              <div className="flex items-start gap-3">
                <AlertTriangle
                  className="h-5 w-5 text-red-400 shrink-0 mt-0.5"
                  aria-hidden="true"
                />
                <div className="flex-1">
                  <h4 className="text-sm font-semibold text-red-300 mb-1">
                    {error.includes('quota') || error.includes('exceeded')
                      ? 'Agent Limit Reached'
                      : 'Failed to Create Agent'}
                  </h4>
                  <p className="text-sm text-red-400/90">{error}</p>
                  {(error.includes('quota') || error.includes('exceeded')) && (
                    <div className="mt-3">
                      <p className="text-xs text-red-400/70 mb-2">
                        Remove an existing agent or upgrade your plan to add more agents.
                      </p>
                      <div className="flex gap-2">
                        <Link
                          href="/settings/billing/credits"
                          className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium rounded bg-red-500 hover:bg-red-600 text-white transition-colors min-h-[36px]"
                        >
                          Buy Credits
                        </Link>
                        <Link
                          href="/settings/billing/plans"
                          className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium rounded bg-red-500/20 hover:bg-red-500/30 text-red-300 transition-colors min-h-[36px]"
                        >
                          Upgrade Plan
                        </Link>
                      </div>
                    </div>
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
              className="rounded-lg px-4 py-2 text-sm font-medium text-text-secondary hover:bg-overlay hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50 min-h-[44px]"
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
              className="rounded-lg bg-accent-primary px-4 py-2 text-sm font-medium text-text-inverse hover:bg-accent-primary/90 disabled:cursor-not-allowed disabled:opacity-50 min-h-[44px] flex items-center gap-2"
            >
              {isCreating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Creating...
                </>
              ) : (
                'Add Agent'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
