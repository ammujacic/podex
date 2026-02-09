/**
 * Login screen component with selection menu navigation.
 */

import { useState, useEffect, useCallback } from 'react';
import { Box, Text } from 'ink';
import { Spinner } from '../common/Spinner';
import { ErrorBox } from '../common/ErrorBox';
import { SuccessBox } from '../common/SuccessBox';
import { Logo } from '../branding/Logo';
import { SelectMenu, type SelectOption } from '../input/SelectMenu';
import { getAuthService } from '../../services/auth-service';
import { terminalColors, icons, borders } from '../../theme';
import type { DeviceCodeResponse } from '../../services/auth-service';

export interface LoginScreenProps {
  onSuccess: () => void;
}

type LoginState = 'idle' | 'initiating' | 'waiting' | 'success' | 'error';

export function LoginScreen({ onSuccess }: LoginScreenProps) {
  const [state, setState] = useState<LoginState>('idle');
  const [deviceCode, setDeviceCode] = useState<DeviceCodeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dots, setDots] = useState('');

  const authService = getAuthService();

  // Single sign-in option
  const menuOptions: SelectOption<'login'>[] = [
    {
      label: 'Sign in to Podex',
      value: 'login',
      description: 'Authenticate via browser to access all features',
    },
  ];

  // Animate dots while waiting
  useEffect(() => {
    if (state === 'waiting') {
      const interval = setInterval(() => {
        setDots((prev) => (prev.length >= 3 ? '' : prev + '.'));
      }, 500);
      return () => clearInterval(interval);
    }
  }, [state]);

  const startLogin = useCallback(async () => {
    setState('initiating');
    setError(null);

    try {
      const code = await authService.initiateDeviceAuth();
      setDeviceCode(code);
      setState('waiting');

      // Try to open browser automatically
      try {
        await authService.openBrowser(code.verification_uri_complete);
      } catch {
        // Browser didn't open, user can manually navigate
      }

      // Start polling
      await authService.pollForToken(code.device_code, code.interval);

      setState('success');
      setTimeout(onSuccess, 1000);
    } catch (err) {
      setError((err as Error).message);
      setState('error');
    }
  }, [authService, onSuccess]);

  const handleMenuSelect = useCallback(
    (action: 'login') => {
      if (action === 'login') {
        startLogin();
      }
    },
    [startLogin]
  );

  if (state === 'idle') {
    return (
      <Box flexDirection="column" padding={1} alignItems="center">
        <Box marginBottom={2} justifyContent="center">
          <Logo variant="large" inverted showVersion />
        </Box>

        <Box marginBottom={1}>
          <Text>Welcome! Sign in to start using Podex.</Text>
        </Box>

        <Box marginTop={1}>
          <SelectMenu
            options={menuOptions}
            onSelect={handleMenuSelect}
            highlightColor={terminalColors.primary}
          />
        </Box>
      </Box>
    );
  }

  if (state === 'initiating') {
    return (
      <Box flexDirection="column" padding={1}>
        <Spinner label="Initiating login..." color={terminalColors.primary} />
      </Box>
    );
  }

  if (state === 'waiting' && deviceCode) {
    return (
      <Box flexDirection="column" padding={1}>
        <Box
          flexDirection="column"
          borderStyle={borders.round}
          borderColor={terminalColors.secondary}
          paddingX={2}
          paddingY={1}
          marginBottom={1}
        >
          <Box marginBottom={1}>
            <Text bold color={terminalColors.secondary}>
              {icons.info} Complete Login in Browser
            </Text>
          </Box>

          <Box flexDirection="column" marginBottom={1}>
            <Text dimColor>Open this URL:</Text>
            <Text color={terminalColors.secondary} bold>
              {deviceCode.verification_uri}
            </Text>
          </Box>

          <Box>
            <Text>
              Enter code:{' '}
              <Text color={terminalColors.warning} bold>
                {deviceCode.user_code}
              </Text>
            </Text>
          </Box>
        </Box>

        <Box>
          <Spinner label={`Waiting for authentication${dots}`} color={terminalColors.primary} />
        </Box>
      </Box>
    );
  }

  if (state === 'success') {
    return (
      <Box flexDirection="column" padding={1}>
        <SuccessBox message="Successfully logged in!" />
      </Box>
    );
  }

  if (state === 'error') {
    return (
      <Box flexDirection="column" padding={1}>
        <ErrorBox message={error || 'Login failed'} />

        <Box marginTop={1}>
          <SelectMenu
            options={[
              { label: 'Try again', value: 'login' as const, description: 'Retry authentication' },
            ]}
            onSelect={handleMenuSelect}
          />
        </Box>
      </Box>
    );
  }

  return null;
}
