/**
 * Re-export agent constants from the central location.
 *
 * @deprecated Import directly from '@/lib/agentConstants' instead.
 * This file exists only for backwards compatibility.
 */

export {
  // Icon utilities
  getIconByName,
  getRoleIcon,
  roleIcons,
  ROLE_ICONS,
  // Mode utilities
  getModeConfig,
  modeConfig,
  // Color utilities
  agentBorderColors,
  agentTextColors,
  agentBgColors,
  getAgentBorderColor,
  getAgentTextColor,
  // Types
  type AgentRole,
  type AgentStatus,
  type AgentOption,
  // Factory functions
  createAgentOptionFromRole,
  createCustomAgentOption,
} from '@/lib/agentConstants';
