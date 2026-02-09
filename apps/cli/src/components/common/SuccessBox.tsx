/**
 * Success display component.
 */

import { Box, Text } from 'ink';

interface SuccessBoxProps {
  message: string;
  title?: string;
}

export function SuccessBox({ message, title = 'Success' }: SuccessBoxProps) {
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="green" paddingX={1} marginY={1}>
      <Text color="green" bold>
        {title}
      </Text>
      <Text color="green">{message}</Text>
    </Box>
  );
}
