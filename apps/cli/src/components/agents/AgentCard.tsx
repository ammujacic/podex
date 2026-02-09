/**
 * Agent card component for displaying individual agent information.
 */

import { Box, Text } from 'ink';
import { AgentStatus, type AgentState } from './AgentStatus';
import { colors, terminalColors, borders, icons } from '../../theme';
import { formatTokenCount, getContextColor } from '../../types/usage';

export type AgentMode = 'plan' | 'ask' | 'auto' | 'sovereign';

export interface Agent {
  id: string;
  name: string;
  role?: string;
  state: AgentState;
  colorIndex?: number;
  /** Current model being used */
  model?: string;
  /** Display name for the model (e.g., "Claude Opus 4.5") */
  modelDisplayName?: string;
  /** Agent mode */
  mode?: AgentMode;
  /** Session/conversation name attached to this agent */
  sessionName?: string;
  /** Context usage percentage (0-100) */
  contextPercentage?: number;
  /** Context tokens used */
  contextTokensUsed?: number;
  /** Context max tokens */
  contextTokensMax?: number;
}

export interface AgentCardProps {
  agent: Agent;
  isSelected?: boolean;
  isActive?: boolean;
  compact?: boolean;
  /** Show extended info (model, context, mode) */
  showDetails?: boolean;
  onSelect?: (agentId: string) => void;
}

/** Get mode badge color */
function getModeColor(mode: AgentMode): string {
  switch (mode) {
    case 'auto':
      return terminalColors.success;
    case 'sovereign':
      return terminalColors.error;
    case 'plan':
      return terminalColors.info;
    case 'ask':
    default:
      return terminalColors.warning;
  }
}

/** Format mode for display */
function formatMode(mode: AgentMode): string {
  return mode.charAt(0).toUpperCase() + mode.slice(1);
}

export function AgentCard({
  agent,
  isSelected = false,
  isActive = false,
  compact = false,
  showDetails = true,
  onSelect: _onSelect,
}: AgentCardProps) {
  // Get agent color from the color palette
  const agentColor = colors.agents[agent.colorIndex ?? 0] || colors.agents[0];
  const contextColor =
    agent.contextPercentage !== undefined
      ? terminalColors[getContextColor(agent.contextPercentage)]
      : terminalColors.muted;

  if (compact) {
    return (
      <Box gap={1}>
        <Text color={agentColor} bold={isActive}>
          {isSelected ? icons.chevronRight : ' '}
        </Text>
        <Text color={isActive ? agentColor : terminalColors.muted} bold={isActive}>
          {agent.name}
        </Text>
        {agent.sessionName && <Text dimColor>({agent.sessionName})</Text>}
        <AgentStatus state={agent.state} compact />
        {showDetails && agent.contextPercentage !== undefined && (
          <Text color={contextColor}>[{agent.contextPercentage}%]</Text>
        )}
      </Box>
    );
  }

  return (
    <Box
      flexDirection="column"
      borderStyle={isSelected ? borders.round : borders.single}
      borderColor={isSelected ? agentColor : terminalColors.muted}
      paddingX={1}
      paddingY={0}
      minWidth={28}
    >
      {/* Header: Name + Status */}
      <Box justifyContent="space-between">
        <Text color={agentColor} bold>
          {agent.name}
        </Text>
        <AgentStatus state={agent.state} compact />
      </Box>

      {/* Session name (conversation) */}
      {agent.sessionName && (
        <Text color={terminalColors.text}>
          {icons.bullet} {agent.sessionName}
        </Text>
      )}

      {/* Role */}
      {agent.role && <Text dimColor>{agent.role}</Text>}

      {/* Model + Mode row */}
      {showDetails && (agent.modelDisplayName || agent.mode) && (
        <Box gap={1} marginTop={0}>
          {agent.modelDisplayName && <Text dimColor>{agent.modelDisplayName}</Text>}
          {agent.mode && <Text color={getModeColor(agent.mode)}>[{formatMode(agent.mode)}]</Text>}
        </Box>
      )}

      {/* Context usage bar */}
      {showDetails && agent.contextPercentage !== undefined && (
        <Box gap={1}>
          <Text dimColor>Ctx:</Text>
          <Text color={contextColor}>{agent.contextPercentage}%</Text>
          {agent.contextTokensUsed !== undefined && agent.contextTokensMax !== undefined && (
            <Text dimColor>
              ({formatTokenCount(agent.contextTokensUsed)}/
              {formatTokenCount(agent.contextTokensMax)})
            </Text>
          )}
        </Box>
      )}

      {isActive && (
        <Box marginTop={1}>
          <Text color={terminalColors.success} dimColor>
            {icons.bullet} Active
          </Text>
        </Box>
      )}
    </Box>
  );
}
