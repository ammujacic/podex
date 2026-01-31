/**
 * Welcome screen shown on CLI startup.
 */

import { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { Spinner } from '../common/Spinner';
import { Logo } from './Logo';
import { terminalColors } from '../../theme';

export interface WelcomeScreenProps {
  version?: string;
  onComplete?: () => void;
  showLoading?: boolean;
  loadingMessage?: string;
  duration?: number;
}

export function WelcomeScreen({
  version = '0.1.0',
  onComplete,
  showLoading = true,
  loadingMessage = 'Initializing',
  duration = 1500,
}: WelcomeScreenProps) {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    if (onComplete) {
      const timer = setTimeout(() => {
        setIsVisible(false);
        onComplete();
      }, duration);

      return () => clearTimeout(timer);
    }
  }, [onComplete, duration]);

  if (!isVisible) {
    return null;
  }

  return (
    <Box flexDirection="column" alignItems="center" justifyContent="center" paddingY={2}>
      <Logo variant="full" showTagline showVersion version={version} />

      {showLoading && (
        <Box marginTop={2}>
          <Spinner label={loadingMessage} color={terminalColors.primary} />
        </Box>
      )}

      <Box marginTop={2} flexDirection="column" alignItems="center">
        <Text dimColor>Press </Text>
        <Box>
          <Text color={terminalColors.muted}>Ctrl+C</Text>
          <Text dimColor> to exit</Text>
        </Box>
      </Box>
    </Box>
  );
}
