/**
 * Error display component.
 */

import { Box, Text } from 'ink';

interface ErrorBoxProps {
  message: string;
  title?: string;
}

export function ErrorBox({ message, title = 'Error' }: ErrorBoxProps) {
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="red" paddingX={1} marginY={1}>
      <Text color="red" bold>
        {title}
      </Text>
      <Text color="red">{message}</Text>
    </Box>
  );
}
