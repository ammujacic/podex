/**
 * Header component with Podex branding.
 */

import { Box, Text } from 'ink';
import { Logo } from '../branding/Logo';
import { terminalColors, icons, borders } from '../../theme';
import { formatTokenCount, getContextColor } from '../../types/usage';

export interface HeaderProps {
  sessionName?: string;
  branch?: string;
  isConnected?: boolean;
  isLocal?: boolean;
  agentName?: string;
  /** Current model display name */
  modelName?: string;
  /** Context usage percentage (0-100) */
  contextPercentage?: number;
  /** Context tokens used */
  contextTokensUsed?: number;
  /** Context max tokens */
  contextTokensMax?: number;
}

export function Header({
  sessionName,
  branch,
  isConnected,
  isLocal,
  agentName,
  modelName,
  contextPercentage,
  contextTokensUsed,
  contextTokensMax,
}: HeaderProps) {
  const contextColor =
    contextPercentage !== undefined
      ? terminalColors[getContextColor(contextPercentage)]
      : terminalColors.muted;

  return (
    <Box
      borderStyle={borders.round}
      borderColor={terminalColors.primary}
      paddingX={1}
      justifyContent="space-between"
    >
      <Box gap={1}>
        <Logo variant="minimal" />

        {sessionName && (
          <>
            <Text dimColor>{icons.verticalLine}</Text>
            <Text color={terminalColors.text}>{sessionName}</Text>
          </>
        )}

        {branch && (
          <>
            <Text dimColor>(</Text>
            <Text color={terminalColors.secondary}>{branch}</Text>
            <Text dimColor>)</Text>
          </>
        )}

        {agentName && (
          <>
            <Text dimColor>{icons.verticalLine}</Text>
            <Text color={terminalColors.info}>{agentName}</Text>
          </>
        )}

        {modelName && (
          <>
            <Text dimColor>{icons.verticalLine}</Text>
            <Text dimColor>{modelName}</Text>
          </>
        )}
      </Box>

      <Box gap={1}>
        {/* Context usage */}
        {contextPercentage !== undefined && (
          <>
            <Box gap={1}>
              <Text dimColor>Ctx:</Text>
              <Text color={contextColor}>{contextPercentage}%</Text>
              {contextTokensUsed !== undefined && contextTokensMax !== undefined && (
                <Text dimColor>
                  ({formatTokenCount(contextTokensUsed)}/{formatTokenCount(contextTokensMax)})
                </Text>
              )}
            </Box>
            <Text dimColor>{icons.verticalLine}</Text>
          </>
        )}

        {isLocal ? (
          <Box gap={1}>
            <Text color={terminalColors.warning}>{icons.local}</Text>
            <Text color={terminalColors.warning}>Local</Text>
          </Box>
        ) : (
          <Box gap={1}>
            <Text color={terminalColors.success}>{icons.cloud}</Text>
            <Text color={terminalColors.success}>Cloud</Text>
          </Box>
        )}

        <Text dimColor>{icons.verticalLine}</Text>

        <Text color={isConnected ? terminalColors.success : terminalColors.error}>
          {isConnected ? icons.success : icons.error} {isConnected ? 'Connected' : 'Disconnected'}
        </Text>
      </Box>
    </Box>
  );
}
