/**
 * Approval prompt component with enhanced keyboard navigation.
 */

import { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { terminalColors, icons, borders } from '../../theme';

export interface ApprovalRequest {
  id: string;
  tool: string;
  description: string;
  command?: string;
  args?: Record<string, unknown>;
}

export interface ApprovalPromptProps {
  request: ApprovalRequest;
  onRespond: (approved: boolean, addToAllowlist: boolean) => void;
  isActive?: boolean;
}

type ApprovalOption = 'approve' | 'deny' | 'always';

const OPTIONS: { value: ApprovalOption; label: string; key: string; color: string }[] = [
  { value: 'approve', label: 'Approve', key: 'y', color: terminalColors.success },
  { value: 'deny', label: 'Deny', key: 'n', color: terminalColors.error },
  { value: 'always', label: 'Always Allow', key: 'a', color: terminalColors.info },
];

export function ApprovalPrompt({ request, onRespond, isActive = true }: ApprovalPromptProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  const handleSelect = useCallback(
    (option: ApprovalOption) => {
      switch (option) {
        case 'approve':
          onRespond(true, false);
          break;
        case 'deny':
          onRespond(false, false);
          break;
        case 'always':
          onRespond(true, true);
          break;
      }
    },
    [onRespond]
  );

  useInput(
    (input, key) => {
      if (!isActive) return;

      const lowerInput = input.toLowerCase();

      // Direct key shortcuts
      const matchedOption = OPTIONS.find((o) => o.key === lowerInput);
      if (matchedOption) {
        handleSelect(matchedOption.value);
        return;
      }

      // Enter key defaults to approve
      if (key.return) {
        handleSelect(OPTIONS[selectedIndex].value);
        return;
      }

      // Escape key denies
      if (key.escape) {
        handleSelect('deny');
        return;
      }

      // Arrow key navigation
      if (key.leftArrow || input === 'h') {
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : OPTIONS.length - 1));
      } else if (key.rightArrow || input === 'l') {
        setSelectedIndex((prev) => (prev < OPTIONS.length - 1 ? prev + 1 : 0));
      }
    },
    { isActive }
  );

  return (
    <Box
      flexDirection="column"
      borderStyle={borders.round}
      borderColor={terminalColors.warning}
      paddingX={2}
      paddingY={1}
      marginY={1}
    >
      <Box marginBottom={1}>
        <Text color={terminalColors.warning} bold>
          {icons.warning} Approval Required
        </Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Box>
          <Text dimColor>Tool: </Text>
          <Text color={terminalColors.secondary} bold>
            {request.tool}
          </Text>
        </Box>
        <Box>
          <Text dimColor>Action: </Text>
          <Text>{request.description}</Text>
        </Box>
        {request.command && (
          <Box marginTop={1} flexDirection="column">
            <Text dimColor>Command:</Text>
            <Box
              paddingX={1}
              marginTop={1}
              borderStyle={borders.single}
              borderColor={terminalColors.muted}
            >
              <Text color={terminalColors.text}>{request.command}</Text>
            </Box>
          </Box>
        )}
      </Box>

      <Box gap={2} marginTop={1}>
        {OPTIONS.map((option, index) => {
          const isSelected = index === selectedIndex;
          return (
            <Box key={option.value}>
              <Text color={option.color} bold={isSelected} inverse={isSelected}>
                {' '}
                [{option.key.toUpperCase()}] {option.label}{' '}
              </Text>
            </Box>
          );
        })}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          Press <Text color={terminalColors.muted}>Y/N/A</Text> or use{' '}
          <Text color={terminalColors.muted}>
            {icons.arrowLeft}/{icons.arrowRight}
          </Text>{' '}
          + Enter
        </Text>
      </Box>
    </Box>
  );
}
