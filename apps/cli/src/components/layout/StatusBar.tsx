/**
 * Status bar component with enhanced styling.
 */

import { Box, Text } from 'ink';
import { AgentStatus, type AgentState } from '../agents/AgentStatus';
import { terminalColors, icons, borders } from '../../theme';
import { formatTokenCount, formatCredits } from '../../types/usage';

export interface StatusBarProps {
  agentStatus?: AgentState;
  agentName?: string;
  message?: string;
  credits?: number;
  /** Input tokens used in session */
  inputTokens?: number;
  /** Output tokens used in session */
  outputTokens?: number;
}

export function StatusBar({
  agentStatus,
  agentName,
  message,
  credits,
  inputTokens,
  outputTokens,
}: StatusBarProps) {
  const hasTokenUsage = inputTokens !== undefined || outputTokens !== undefined;

  return (
    <Box
      borderStyle={borders.single}
      borderColor={terminalColors.muted}
      paddingX={1}
      justifyContent="space-between"
    >
      <Box gap={1}>
        {agentStatus && (
          <Box gap={1}>
            {agentName && <Text dimColor>{agentName}:</Text>}
            <AgentStatus state={agentStatus} />
          </Box>
        )}

        {message && (
          <>
            <Text dimColor>{icons.verticalLine}</Text>
            <Text dimColor>{message}</Text>
          </>
        )}
      </Box>

      <Box gap={2}>
        {/* Token usage display */}
        {hasTokenUsage && (
          <Box gap={1}>
            <Text dimColor>Tokens:</Text>
            <Text color={terminalColors.info}>{formatTokenCount(inputTokens ?? 0)} in</Text>
            <Text dimColor>/</Text>
            <Text color={terminalColors.secondary}>{formatTokenCount(outputTokens ?? 0)} out</Text>
          </Box>
        )}

        {/* Credits display */}
        {credits !== undefined && (
          <Box gap={1}>
            <Text dimColor>{icons.verticalLine}</Text>
            <Text dimColor>Credits:</Text>
            <Text color={credits > 100 ? terminalColors.success : terminalColors.warning}>
              {formatCredits(credits)}
            </Text>
          </Box>
        )}

        <Text dimColor>{icons.verticalLine}</Text>

        <Box gap={1}>
          <Text dimColor>
            <Text color={terminalColors.muted}>Ctrl+C</Text> exit
          </Text>
          <Text dimColor>{icons.verticalLine}</Text>
          <Text dimColor>
            <Text color={terminalColors.muted}>Ctrl+L</Text> clear
          </Text>
          <Text dimColor>{icons.verticalLine}</Text>
          <Text dimColor>
            <Text color={terminalColors.muted}>Tab</Text> switch agent
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
