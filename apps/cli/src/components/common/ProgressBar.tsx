/**
 * ProgressBar component for showing progress.
 */

import { Box, Text } from 'ink';
import { terminalColors } from '../../theme';

export interface ProgressBarProps {
  value: number; // 0-100
  width?: number;
  showPercentage?: boolean;
  color?: string;
  backgroundColor?: string;
  label?: string;
}

export function ProgressBar({
  value,
  width = 30,
  showPercentage = true,
  color = terminalColors.primary,
  backgroundColor = terminalColors.muted,
  label,
}: ProgressBarProps) {
  const clampedValue = Math.max(0, Math.min(100, value));
  const filledWidth = Math.round((clampedValue / 100) * width);
  const emptyWidth = width - filledWidth;

  const filledBar = '\u2588'.repeat(filledWidth); // Full block
  const emptyBar = '\u2591'.repeat(emptyWidth); // Light shade

  return (
    <Box flexDirection="column">
      {label && (
        <Box marginBottom={1}>
          <Text dimColor>{label}</Text>
        </Box>
      )}
      <Box>
        <Text color={color}>{filledBar}</Text>
        <Text color={backgroundColor}>{emptyBar}</Text>
        {showPercentage && <Text dimColor> {Math.round(clampedValue)}%</Text>}
      </Box>
    </Box>
  );
}
