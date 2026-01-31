/**
 * Agent status indicator component.
 */

import { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { terminalColors, icons, animation } from '../../theme';

export type AgentState = 'idle' | 'thinking' | 'executing' | 'waiting' | 'error';

export interface AgentStatusProps {
  state: AgentState;
  compact?: boolean;
}

const stateConfig: Record<AgentState, { icon: string; color: string; label: string }> = {
  idle: { icon: icons.idle, color: terminalColors.muted, label: 'Idle' },
  thinking: { icon: icons.thinking, color: terminalColors.primary, label: 'Thinking' },
  executing: { icon: icons.executing, color: terminalColors.secondary, label: 'Executing' },
  waiting: { icon: icons.pending, color: terminalColors.warning, label: 'Waiting' },
  error: { icon: icons.error, color: terminalColors.error, label: 'Error' },
};

export function AgentStatus({ state, compact = false }: AgentStatusProps) {
  const [animatedIcon, setAnimatedIcon] = useState(stateConfig[state].icon);
  const config = stateConfig[state];

  // Animate the icon for active states
  useEffect(() => {
    if (state === 'thinking' || state === 'executing') {
      let frameIndex = 0;
      const frames = animation.spinnerFrames;
      const interval = setInterval(() => {
        frameIndex = (frameIndex + 1) % frames.length;
        setAnimatedIcon(frames[frameIndex]);
      }, animation.fast);

      return () => clearInterval(interval);
    } else {
      setAnimatedIcon(config.icon);
    }
  }, [state, config.icon]);

  if (compact) {
    return <Text color={config.color}>{animatedIcon}</Text>;
  }

  return (
    <Box gap={1}>
      <Text color={config.color}>{animatedIcon}</Text>
      <Text color={config.color}>{config.label}</Text>
    </Box>
  );
}
