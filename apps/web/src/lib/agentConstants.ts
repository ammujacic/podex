/**
 * Agent icon mapping and UI utilities.
 *
 * Agent role data (name, description, color, tools, etc.) is fetched from the backend
 * via useConfigStore().agentRoles. Only icon mapping remains here since React components
 * cannot be serialized in the database.
 *
 * The database stores icon NAMES (e.g., "Compass", "Code2") which we map to components here.
 */

import type { LucideIcon } from 'lucide-react';
import {
  Bot,
  Code2,
  Compass,
  Container,
  Eye,
  FileText,
  FlaskConical,
  HelpCircle,
  ListTodo,
  MessageCircle,
  Network,
  Search,
  Shield,
  ShieldOff,
  Sparkles,
  User,
  Zap,
} from 'lucide-react';
import type { AgentMode } from '@/stores/session';

/**
 * Map of icon names (stored in DB) to Lucide icon components.
 * This is the only place where we need to hardcode icon mappings,
 * since React components cannot be stored in the database.
 */
const ICON_MAP: Record<string, LucideIcon> = {
  // Core development icons
  Compass: Compass,
  Code2: Code2,
  Eye: Eye,
  FlaskConical: FlaskConical,
  TestTube2: FlaskConical, // Alias
  // System icons
  Sparkles: Sparkles,
  Network: Network,
  // Communication icons
  MessageCircle: MessageCircle,
  Shield: Shield,
  Container: Container,
  Server: Container, // Alias
  FileText: FileText,
  Bot: Bot,
  User: User,
  // Research/planning icons
  Search: Search,
  ListTodo: ListTodo,
};

/**
 * Get icon component for an agent role based on the icon name from the database.
 * Falls back to Bot icon if the icon name is not found.
 *
 * @param iconName - The icon name from the AgentRoleConfig.icon field
 * @returns The corresponding Lucide icon component
 */
export function getIconByName(iconName: string | null | undefined): LucideIcon {
  if (!iconName) return Bot;
  return ICON_MAP[iconName] || Bot;
}

/**
 * Get icon component for an agent role.
 * This function accepts an AgentRoleConfig-like object and extracts the icon.
 *
 * @param role - Object with an optional icon field (or just the icon name string)
 * @returns The corresponding Lucide icon component
 */
export function getRoleIcon(role: string | { icon?: string | null }): LucideIcon {
  if (typeof role === 'string') {
    // Legacy support: try to find icon by role name as a fallback
    // This is for backwards compatibility during migration
    const legacyMapping: Record<string, LucideIcon> = {
      architect: Compass,
      coder: Code2,
      reviewer: Eye,
      tester: FlaskConical,
      agent_builder: Sparkles,
      orchestrator: Network,
      chat: MessageCircle,
      security: Shield,
      devops: Container,
      documentator: FileText,
      researcher: Search,
      planner: ListTodo,
      custom: User,
    };
    return legacyMapping[role] || Bot;
  }
  return getIconByName(role.icon);
}

/**
 * Mode configuration for agent modes (plan, ask, auto, sovereign).
 * These are UI interaction modes, not agent roles, so they stay hardcoded.
 */
export const modeConfig: Record<AgentMode, { icon: LucideIcon; label: string; color: string }> = {
  plan: { icon: Eye, label: 'Plan', color: 'text-blue-400' },
  ask: { icon: HelpCircle, label: 'Ask', color: 'text-yellow-400' },
  auto: { icon: Zap, label: 'Auto', color: 'text-green-400' },
  sovereign: { icon: ShieldOff, label: 'Sovereign', color: 'text-red-400' },
};

/**
 * Get mode configuration for an agent mode.
 * Returns 'ask' mode config as default for undefined or invalid modes.
 */
export function getModeConfig(mode: AgentMode | undefined) {
  const config = modeConfig[mode || 'ask'];
  return config ?? modeConfig.ask;
}

/**
 * Border color classes for agent colors.
 * Maps color identifiers to Tailwind classes.
 */
export const agentBorderColors: Record<string, string> = {
  'agent-1': 'border-agent-1',
  'agent-2': 'border-agent-2',
  'agent-3': 'border-agent-3',
  'agent-4': 'border-agent-4',
  'agent-5': 'border-agent-5',
  'agent-6': 'border-agent-6',
};

/**
 * Text color classes for agent colors.
 */
export const agentTextColors: Record<string, string> = {
  'agent-1': 'text-agent-1',
  'agent-2': 'text-agent-2',
  'agent-3': 'text-agent-3',
  'agent-4': 'text-agent-4',
  'agent-5': 'text-agent-5',
  'agent-6': 'text-agent-6',
};

/**
 * Background color classes for agent colors.
 */
export const agentBgColors: Record<string, string> = {
  'agent-1': 'bg-agent-1',
  'agent-2': 'bg-agent-2',
  'agent-3': 'bg-agent-3',
  'agent-4': 'bg-agent-4',
  'agent-5': 'bg-agent-5',
  'agent-6': 'bg-agent-6',
};

/**
 * Get border color class for an agent.
 */
export function getAgentBorderColor(color: string): string {
  return agentBorderColors[color] ?? 'border-border-default';
}

/**
 * Get text color class for an agent.
 */
export function getAgentTextColor(color: string): string {
  return agentTextColors[color] ?? 'text-text-primary';
}

// Legacy exports for backwards compatibility
// These are deprecated - use getIconByName or getRoleIcon with icon field instead
export const roleIcons = ICON_MAP;
export const ROLE_ICONS = ICON_MAP; // Alias for backwards compatibility
export type AgentRole = string; // Now dynamic from DB, just a string
export type AgentStatus = 'idle' | 'active' | 'error';

/**
 * Agent option for UI components (dropdowns, modals, etc.)
 */
export type AgentOption = {
  id: string;
  role: string;
  name: string;
  icon: LucideIcon;
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
  icon?: string | null;
}): AgentOption {
  return {
    id: role.role,
    role: role.role,
    name: role.name,
    icon: getRoleIcon(role),
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
