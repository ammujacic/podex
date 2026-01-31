/**
 * SelectMenu - Arrow key navigable selection menu.
 * Wraps @inkjs/ui Select with Podex styling.
 */

import { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { terminalColors, icons } from '../../theme';

export interface SelectOption<T = string> {
  label: string;
  value: T;
  description?: string;
  disabled?: boolean;
}

export interface SelectMenuProps<T = string> {
  options: SelectOption<T>[];
  onSelect: (value: T) => void;
  label?: string;
  defaultIndex?: number;
  highlightColor?: string;
  showDescriptions?: boolean;
  isActive?: boolean;
}

export function SelectMenu<T = string>({
  options,
  onSelect,
  label,
  defaultIndex = 0,
  highlightColor = terminalColors.primary,
  showDescriptions = true,
  isActive = true,
}: SelectMenuProps<T>) {
  const [selectedIndex, setSelectedIndex] = useState(defaultIndex);

  const handleSelect = useCallback(() => {
    const option = options[selectedIndex];
    if (option && !option.disabled) {
      onSelect(option.value);
    }
  }, [options, selectedIndex, onSelect]);

  useInput(
    (input, key) => {
      if (!isActive) return;

      if (key.upArrow || input === 'k') {
        setSelectedIndex((prev) => {
          let newIndex = prev - 1;
          if (newIndex < 0) newIndex = options.length - 1;
          // Skip disabled options
          while (options[newIndex]?.disabled && newIndex !== prev) {
            newIndex = newIndex - 1;
            if (newIndex < 0) newIndex = options.length - 1;
          }
          return newIndex;
        });
      } else if (key.downArrow || input === 'j') {
        setSelectedIndex((prev) => {
          let newIndex = prev + 1;
          if (newIndex >= options.length) newIndex = 0;
          // Skip disabled options
          while (options[newIndex]?.disabled && newIndex !== prev) {
            newIndex = newIndex + 1;
            if (newIndex >= options.length) newIndex = 0;
          }
          return newIndex;
        });
      } else if (key.return) {
        handleSelect();
      }
    },
    { isActive }
  );

  return (
    <Box flexDirection="column">
      {label && (
        <Box marginBottom={1}>
          <Text bold color={terminalColors.secondary}>
            {label}
          </Text>
        </Box>
      )}

      {options.map((option, index) => {
        const isSelected = index === selectedIndex;
        const isDisabled = option.disabled;

        return (
          <Box key={index} flexDirection="column">
            <Box>
              <Text
                color={isDisabled ? terminalColors.muted : isSelected ? highlightColor : undefined}
                bold={isSelected}
                dimColor={isDisabled}
              >
                {isSelected ? `${icons.chevronRight} ` : '  '}
                {option.label}
              </Text>
            </Box>

            {showDescriptions && option.description && isSelected && (
              <Box marginLeft={2} marginBottom={1}>
                <Text dimColor>{option.description}</Text>
              </Box>
            )}
          </Box>
        );
      })}

      <Box marginTop={1}>
        <Text dimColor>
          Use{' '}
          <Text color={terminalColors.muted}>
            {icons.arrowUp}/{icons.arrowDown}
          </Text>{' '}
          to navigate, <Text color={terminalColors.muted}>Enter</Text> to select
        </Text>
      </Box>
    </Box>
  );
}
