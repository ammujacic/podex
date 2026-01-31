/**
 * Loading spinner component with Podex styling.
 */

import { Box, Text } from 'ink';
import InkSpinner from 'ink-spinner';
import { terminalColors } from '../../theme';

export type SpinnerType = 'dots' | 'line' | 'arc' | 'circle' | 'bouncingBar';

export interface SpinnerProps {
  label?: string;
  color?: string;
  type?: SpinnerType;
}

export function Spinner({ label, color = terminalColors.primary, type = 'dots' }: SpinnerProps) {
  return (
    <Box>
      <Text color={color}>
        <InkSpinner type={type} />
      </Text>
      {label && <Text color={terminalColors.muted}> {label}</Text>}
    </Box>
  );
}
