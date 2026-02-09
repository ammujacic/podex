/**
 * Divider component for visual separation.
 */

import { Box, Text } from 'ink';
import { terminalColors } from '../../theme';

export interface DividerProps {
  width?: number;
  title?: string;
  color?: string;
  character?: string;
}

export function Divider({
  width = 40,
  title,
  color = terminalColors.muted,
  character = '\u2500', // horizontal line
}: DividerProps) {
  if (title) {
    const titleWithPadding = ` ${title} `;
    const remainingWidth = Math.max(0, width - titleWithPadding.length);
    const leftWidth = Math.floor(remainingWidth / 2);
    const rightWidth = remainingWidth - leftWidth;

    return (
      <Box>
        <Text color={color}>{character.repeat(leftWidth)}</Text>
        <Text bold color={color}>
          {titleWithPadding}
        </Text>
        <Text color={color}>{character.repeat(rightWidth)}</Text>
      </Box>
    );
  }

  return (
    <Box>
      <Text color={color}>{character.repeat(width)}</Text>
    </Box>
  );
}
