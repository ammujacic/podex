/**
 * Message list component.
 */

import { Box, Text } from 'ink';
import type { Message as MessageType } from '@podex/shared';
import { Message } from './Message';

interface MessageListProps {
  messages: MessageType[];
  maxHeight?: number;
}

export function MessageList({ messages, maxHeight }: MessageListProps) {
  if (messages.length === 0) {
    return (
      <Box flexGrow={1} justifyContent="center" alignItems="center">
        <Text color="gray">No messages yet. Type something to get started.</Text>
      </Box>
    );
  }

  // Show only the most recent messages if maxHeight is specified
  const displayMessages = maxHeight ? messages.slice(-maxHeight) : messages;

  return (
    <Box flexDirection="column" flexGrow={1}>
      {displayMessages.map((msg) => (
        <Message key={msg.id} message={msg} />
      ))}
    </Box>
  );
}
