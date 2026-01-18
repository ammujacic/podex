import {
  Bot,
  Code2,
  FileText,
  MessageCircle,
  Server,
  Settings2,
  Shield,
  Terminal,
  TestTube2,
  Workflow,
  Eye,
  HelpCircle,
  Zap,
  ShieldOff,
} from 'lucide-react';
import type { AgentMode } from '@/stores/session';

/**
 * Icon mapping for agent roles.
 */
export const roleIcons = {
  architect: Workflow,
  coder: Code2,
  reviewer: Bot,
  tester: TestTube2,
  agent_builder: Settings2,
  orchestrator: Workflow,
  chat: MessageCircle,
  security: Shield,
  devops: Server,
  documentator: FileText,
  custom: Bot,
  'claude-code': Terminal,
} as const;

export type AgentRole = keyof typeof roleIcons;

/**
 * Border color classes for agent colors.
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
 * Mode configuration with icon, label, and color.
 */
export const modeConfig: Record<AgentMode, { icon: typeof Eye; label: string; color: string }> = {
  plan: { icon: Eye, label: 'Plan', color: 'text-blue-400' },
  ask: { icon: HelpCircle, label: 'Ask', color: 'text-yellow-400' },
  auto: { icon: Zap, label: 'Auto', color: 'text-green-400' },
  sovereign: { icon: ShieldOff, label: 'Sovereign', color: 'text-red-400' },
};

/**
 * Get the icon component for an agent role.
 */
export function getRoleIcon(role: string) {
  return roleIcons[role as AgentRole] || Bot;
}

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

/**
 * Get mode configuration for an agent mode.
 * Returns 'ask' mode config as default for undefined or invalid modes.
 */
export function getModeConfig(mode: AgentMode | undefined) {
  const config = modeConfig[mode || 'ask'];
  // Fallback to 'ask' if mode is invalid (not in modeConfig)
  return config ?? modeConfig.ask;
}
