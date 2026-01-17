import type { LucideIcon } from 'lucide-react';
import {
  Code,
  Eye,
  FileText,
  MessageCircle,
  Server,
  Shield,
  TestTube,
  Wrench,
  Sparkles,
  User,
  Workflow,
} from 'lucide-react';

export type AgentRole =
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

export type AgentStatus = 'idle' | 'active' | 'error';

export type AgentOption = {
  id: string;
  role: AgentRole;
  name: string;
  icon: LucideIcon;
  color: string;
  description: string;
  isCustom: boolean;
  templateId?: string;
  shareToken?: string | null;
  model?: string;
};

export const BUILTIN_AGENTS: AgentOption[] = [
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

/** Create custom agent option from template */
export function createCustomAgentOption(template: {
  id: string;
  name: string;
  description?: string | null;
  model?: string;
  share_token?: string | null;
}): AgentOption {
  return {
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
  };
}

/** Timeout options for standby settings */
export const TIMEOUT_OPTIONS = [
  { value: 15, label: '15 minutes' },
  { value: 30, label: '30 minutes' },
  { value: 60, label: '1 hour' },
  { value: 120, label: '2 hours' },
  { value: null, label: 'Never' },
] as const;
