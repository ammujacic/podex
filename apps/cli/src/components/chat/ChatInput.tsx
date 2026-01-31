/**
 * Chat input component.
 */

import { useState } from 'react';
import { Box, Text, useInput } from 'ink';

interface ChatInputProps {
  onSubmit: (message: string) => void;
  disabled?: boolean;
  placeholder?: string;
  onHistoryUp?: () => string;
  onHistoryDown?: () => string;
}

export function ChatInput({
  onSubmit,
  disabled = false,
  placeholder = 'Type a message...',
  onHistoryUp,
  onHistoryDown,
}: ChatInputProps) {
  const [value, setValue] = useState('');

  useInput((input, key) => {
    if (disabled) return;

    // Submit on Enter
    if (key.return) {
      if (value.trim()) {
        onSubmit(value);
        setValue('');
      }
      return;
    }

    // Handle history navigation
    if (key.upArrow && onHistoryUp) {
      const historyValue = onHistoryUp();
      setValue(historyValue);
    } else if (key.downArrow && onHistoryDown) {
      const historyValue = onHistoryDown();
      setValue(historyValue);
    }

    // Handle backspace
    if (key.backspace || key.delete) {
      setValue((prev) => prev.slice(0, -1));
      return;
    }

    // Regular character input
    if (input && !key.ctrl && !key.meta) {
      setValue((prev) => prev + input);
    }
  });

  return (
    <Box borderStyle="single" borderColor={disabled ? 'gray' : 'blue'} paddingX={1}>
      <Text color={disabled ? 'gray' : 'blue'} bold>
        {'> '}
      </Text>
      <Box flexGrow={1}>
        {disabled ? (
          <Text color="gray">{placeholder}</Text>
        ) : (
          <Text>{value || <Text color="gray">{placeholder}</Text>}</Text>
        )}
      </Box>
    </Box>
  );
}

// Simplified text input that works with Ink
export function SimpleChatInput({
  onSubmit,
  disabled = false,
  placeholder = 'Type a message...',
}: Omit<ChatInputProps, 'onHistoryUp' | 'onHistoryDown'>) {
  const [value, setValue] = useState('');

  useInput((input, key) => {
    if (disabled) return;

    if (key.return) {
      if (value.trim()) {
        onSubmit(value);
        setValue('');
      }
      return;
    }

    if (key.backspace || key.delete) {
      setValue((prev) => prev.slice(0, -1));
      return;
    }

    // Regular character input
    if (input && !key.ctrl && !key.meta) {
      setValue((prev) => prev + input);
    }
  });

  return (
    <Box borderStyle="single" borderColor={disabled ? 'gray' : 'blue'} paddingX={1}>
      <Text color={disabled ? 'gray' : 'blue'} bold>
        {'> '}
      </Text>
      <Box flexGrow={1}>
        {value ? <Text>{value}</Text> : <Text color="gray">{placeholder}</Text>}
      </Box>
    </Box>
  );
}
