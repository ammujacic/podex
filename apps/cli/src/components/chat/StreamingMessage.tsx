/**
 * Streaming message display component.
 */

import { Box, Text } from 'ink';
import InkSpinner from 'ink-spinner';

interface StreamingMessageProps {
  content: string;
  thinkingContent?: string;
  isThinking?: boolean;
}

export function StreamingMessage({ content, thinkingContent, isThinking }: StreamingMessageProps) {
  return (
    <Box flexDirection="column" marginY={1}>
      <Box>
        <Text color="green" bold>
          Assistant
        </Text>
        <Text color="gray" dimColor>
          {' '}
          (streaming...)
        </Text>
      </Box>
      {thinkingContent && (
        <Box marginLeft={2} flexDirection="column" marginBottom={1}>
          <Text color="gray" italic>
            Thinking: {thinkingContent}
          </Text>
        </Box>
      )}
      <Box marginLeft={2} flexDirection="column">
        <Text wrap="wrap">{content}</Text>
        {isThinking && (
          <Box>
            <Text color="cyan">
              <InkSpinner type="dots" />
            </Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}
