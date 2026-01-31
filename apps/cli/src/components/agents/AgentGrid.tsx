/**
 * Agent grid component for displaying multiple agents.
 */

import { useState, useCallback } from 'react';
import { Box, useInput } from 'ink';
import { AgentCard, type Agent } from './AgentCard';

export interface AgentGridProps {
  agents: Agent[];
  currentAgentId?: string;
  onSelect?: (agentId: string) => void;
  columns?: 1 | 2 | 3;
  isActive?: boolean;
}

// Chunk array into rows
function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

export function AgentGrid({
  agents,
  currentAgentId,
  onSelect,
  columns = 2,
  isActive = true,
}: AgentGridProps) {
  const [selectedIndex, setSelectedIndex] = useState(() => {
    const index = agents.findIndex((a) => a.id === currentAgentId);
    return index >= 0 ? index : 0;
  });

  const handleSelect = useCallback(() => {
    const agent = agents[selectedIndex];
    if (agent && onSelect) {
      onSelect(agent.id);
    }
  }, [agents, selectedIndex, onSelect]);

  useInput(
    (input, key) => {
      if (!isActive || agents.length === 0) return;

      if (key.upArrow || input === 'k') {
        setSelectedIndex((prev) => {
          const newIndex = prev - columns;
          return newIndex >= 0 ? newIndex : prev;
        });
      } else if (key.downArrow || input === 'j') {
        setSelectedIndex((prev) => {
          const newIndex = prev + columns;
          return newIndex < agents.length ? newIndex : prev;
        });
      } else if (key.leftArrow || input === 'h') {
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : agents.length - 1));
      } else if (key.rightArrow || input === 'l') {
        setSelectedIndex((prev) => (prev < agents.length - 1 ? prev + 1 : 0));
      } else if (key.return) {
        handleSelect();
      } else if (key.tab) {
        // Tab cycles through agents
        setSelectedIndex((prev) => (prev + 1) % agents.length);
      }
    },
    { isActive }
  );

  if (agents.length === 0) {
    return null;
  }

  const rows = chunkArray(agents, columns);

  return (
    <Box flexDirection="column" gap={1}>
      {rows.map((row, rowIndex) => (
        <Box key={rowIndex} gap={1}>
          {row.map((agent, colIndex) => {
            const globalIndex = rowIndex * columns + colIndex;
            const isSelected = globalIndex === selectedIndex;
            const isActiveAgent = agent.id === currentAgentId;

            return (
              <AgentCard
                key={agent.id}
                agent={agent}
                isSelected={isSelected}
                isActive={isActiveAgent}
                onSelect={onSelect}
              />
            );
          })}
        </Box>
      ))}
    </Box>
  );
}
