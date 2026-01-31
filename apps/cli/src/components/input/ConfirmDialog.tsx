/**
 * ConfirmDialog - Confirmation dialog with keyboard navigation.
 */

import { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { terminalColors, icons, borders } from '../../theme';

export type ConfirmOption = 'yes' | 'no' | 'always';

export interface ConfirmDialogProps {
  message: string;
  description?: string;
  onConfirm: (option: ConfirmOption) => void;
  showAlways?: boolean;
  defaultOption?: ConfirmOption;
  isActive?: boolean;
}

const OPTIONS: { value: ConfirmOption; label: string; key: string }[] = [
  { value: 'yes', label: 'Yes', key: 'y' },
  { value: 'no', label: 'No', key: 'n' },
  { value: 'always', label: 'Always Allow', key: 'a' },
];

export function ConfirmDialog({
  message,
  description,
  onConfirm,
  showAlways = true,
  defaultOption = 'yes',
  isActive = true,
}: ConfirmDialogProps) {
  const availableOptions = showAlways ? OPTIONS : OPTIONS.filter((o) => o.value !== 'always');
  const defaultIndex = availableOptions.findIndex((o) => o.value === defaultOption);
  const [selectedIndex, setSelectedIndex] = useState(defaultIndex >= 0 ? defaultIndex : 0);

  const handleSelect = useCallback(() => {
    const option = availableOptions[selectedIndex];
    if (option) {
      onConfirm(option.value);
    }
  }, [availableOptions, selectedIndex, onConfirm]);

  useInput(
    (input, key) => {
      if (!isActive) return;

      const lowerInput = input.toLowerCase();

      // Direct key shortcuts
      const matchedOption = availableOptions.find((o) => o.key === lowerInput);
      if (matchedOption) {
        onConfirm(matchedOption.value);
        return;
      }

      // Arrow key navigation
      if (key.leftArrow || input === 'h') {
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : availableOptions.length - 1));
      } else if (key.rightArrow || input === 'l') {
        setSelectedIndex((prev) => (prev < availableOptions.length - 1 ? prev + 1 : 0));
      } else if (key.return) {
        handleSelect();
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
    >
      <Box marginBottom={1}>
        <Text color={terminalColors.warning} bold>
          {icons.warning} {message}
        </Text>
      </Box>

      {description && (
        <Box marginBottom={1}>
          <Text dimColor>{description}</Text>
        </Box>
      )}

      <Box gap={2}>
        {availableOptions.map((option, index) => {
          const isSelected = index === selectedIndex;
          return (
            <Box key={option.value}>
              <Text
                color={isSelected ? terminalColors.success : undefined}
                bold={isSelected}
                inverse={isSelected}
              >
                {' '}
                [{option.key.toUpperCase()}] {option.label}{' '}
              </Text>
            </Box>
          );
        })}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          Press{' '}
          {availableOptions.map((o, i) => (
            <Text key={o.key}>
              <Text color={terminalColors.muted}>{o.key.toUpperCase()}</Text>
              {i < availableOptions.length - 1 ? '/' : ''}
            </Text>
          ))}{' '}
          or use{' '}
          <Text color={terminalColors.muted}>
            {icons.arrowLeft}/{icons.arrowRight}
          </Text>{' '}
          + Enter
        </Text>
      </Box>
    </Box>
  );
}
