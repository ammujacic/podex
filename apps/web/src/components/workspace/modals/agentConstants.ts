/**
 * Agent constants and icon mapping.
 *
 * Agent role data (name, description, color, etc.) should be fetched from the backend
 * via useConfigStore().agentRoles. Only icon mapping remains here since React components
 * cannot be serialized in the database.
 */

import type { LucideIcon } from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';
import {
  Bot,
  Code2,
  Compass,
  Container,
  Eye,
  FileText,
  FlaskConical,
  MessageCircle,
  Network,
  Shield,
  Sparkles,
  User,
} from 'lucide-react';
import { ClaudeIcon, OpenAIIcon, GeminiIcon } from '@/components/icons';

// Icon type that accepts both LucideIcon and custom SVG icons
type IconComponent =
  | LucideIcon
  | ComponentType<SVGProps<SVGSVGElement> & { size?: number | string }>;

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
  | 'custom'
  | 'claude-code'
  | 'openai-codex'
  | 'gemini-cli';

export type AgentStatus = 'idle' | 'active' | 'error';

/**
 * Icon mapping for agent roles.
 * Icons cannot be stored in the database, so this mapping is maintained in frontend code.
 * Use this with agent role data from useConfigStore().agentRoles.
 */
export const ROLE_ICONS: Record<string, IconComponent> = {
  // Core development workflow
  architect: Compass,
  coder: Code2,
  reviewer: Eye,
  tester: FlaskConical,
  // System / orchestration
  agent_builder: Sparkles,
  orchestrator: Network,
  // Communication / meta roles
  chat: MessageCircle,
  security: Shield,
  devops: Container,
  documentator: FileText,
  custom: User,
  'claude-code': ClaudeIcon,
  'openai-codex': OpenAIIcon,
  'gemini-cli': GeminiIcon,
};

/**
 * Get icon component for an agent role.
 */
export function getRoleIcon(role: string): IconComponent {
  return ROLE_ICONS[role] || Bot;
}

export type AgentOption = {
  id: string;
  role: AgentRole;
  name: string;
  icon: IconComponent;
  color: string;
  description: string;
  isCustom: boolean;
  templateId?: string;
  shareToken?: string | null;
  model?: string;
};

/**
 * Create AgentOption from backend AgentRoleConfig.
 * Maps backend data with frontend icon component.
 */
export function createAgentOptionFromRole(role: {
  role: string;
  name: string;
  description?: string | null;
  color: string;
}): AgentOption {
  return {
    id: role.role,
    role: role.role as AgentRole,
    name: role.name,
    icon: getRoleIcon(role.role),
    color: role.color,
    description: role.description || '',
    isCustom: false,
  };
}

/**
 * Create custom agent option from template.
 */
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
