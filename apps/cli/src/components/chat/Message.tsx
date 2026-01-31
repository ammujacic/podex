/**
 * Message display component.
 */

import { Box, Text } from 'ink';
import type { Message as MessageType } from '@podex/shared';

interface MessageProps {
  message: MessageType;
}

export function Message({ message }: MessageProps) {
  const isUser = message.role === 'user';
  const roleColor = isUser ? 'blue' : 'green';
  const roleName = isUser ? 'You' : 'Assistant';

  const timestamp = message.timestamp
    ? new Date(message.timestamp).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';

  return (
    <Box flexDirection="column" marginY={1}>
      <Box>
        <Text color={roleColor} bold>
          {roleName}
        </Text>
        {timestamp && (
          <Text color="gray" dimColor>
            {' '}
            ({timestamp})
          </Text>
        )}
      </Box>
      <Box marginLeft={2} flexDirection="column">
        <Text wrap="wrap">{message.content}</Text>
        {message.toolCalls && message.toolCalls.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            {message.toolCalls.map((tc) => (
              <Box key={tc.id} flexDirection="column" marginY={1}>
                <Text color="yellow">
                  Tool: {tc.name} [{tc.status}]
                </Text>
                {tc.result && (
                  <Box marginLeft={2}>
                    <Text color={tc.result.success ? 'green' : 'red'}>
                      {tc.result.success
                        ? tc.result.output?.slice(0, 200) || 'Success'
                        : tc.result.error || 'Failed'}
                    </Text>
                  </Box>
                )}
              </Box>
            ))}
          </Box>
        )}
      </Box>
    </Box>
  );
}
