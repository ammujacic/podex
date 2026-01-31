/**
 * Agent selector component with keyboard navigation.
 */

import { Box, Text } from 'ink';
import { SelectMenu, type SelectOption } from '../input/SelectMenu';
import { AgentStatus, type AgentState } from './AgentStatus';
import { colors, terminalColors } from '../../theme';

export interface AgentInfo {
  id: string;
  name: string;
  role?: string;
  state: AgentState;
  colorIndex?: number;
}

export interface AgentSelectorProps {
  agents: AgentInfo[];
  currentAgentId?: string;
  onSelect: (agentId: string) => void;
  isActive?: boolean;
}

export function AgentSelector({
  agents,
  currentAgentId,
  onSelect,
  isActive = true,
}: AgentSelectorProps) {
  const options: SelectOption<string>[] = agents.map((agent) => ({
    label: agent.name,
    value: agent.id,
    description: agent.role,
  }));

  const defaultIndex = agents.findIndex((a) => a.id === currentAgentId);

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color={terminalColors.secondary}>
          Select Agent
        </Text>
      </Box>

      <Box flexDirection="column" gap={1}>
        {agents.map((agent, index) => {
          const isSelected = agent.id === currentAgentId;
          const agentColor = colors.agents[agent.colorIndex ?? index] || colors.agents[0];

          return (
            <Box key={agent.id} gap={2}>
              <Text color={agentColor} bold={isSelected}>
                {isSelected ? '\u25B6' : ' '} {agent.name}
              </Text>
              <AgentStatus state={agent.state} compact />
              {agent.role && <Text dimColor>({agent.role})</Text>}
            </Box>
          );
        })}
      </Box>

      <SelectMenu
        options={options}
        onSelect={onSelect}
        defaultIndex={defaultIndex >= 0 ? defaultIndex : 0}
        isActive={isActive}
        showDescriptions={false}
      />
    </Box>
  );
}
