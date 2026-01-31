/**
 * Root application component with enhanced branding.
 */

import { useState, useCallback } from 'react';
import { Box, useApp, useInput } from 'ink';
import { Header } from '../components/layout/Header';
import { StatusBar } from '../components/layout/StatusBar';
import { LoginScreen } from '../components/auth/LoginScreen';
import { WelcomeScreen } from '../components/branding/WelcomeScreen';
import { PodSelectionScreen } from '../components/pods/PodSelectionScreen';
import { ThemeProvider } from '../theme';
import { InteractiveMode } from './InteractiveMode';
import { RunMode } from './RunMode';
import { getAuthService } from '../services/auth-service';

export interface AppProps {
  mode: 'interactive' | 'run';
  task?: string;
  sessionId?: string;
  local?: boolean;
  exitOnComplete?: boolean;
  skipWelcome?: boolean;
}

type AppState = 'welcome' | 'login' | 'pod-selection' | 'ready';

export function App({
  mode,
  task,
  sessionId,
  local,
  exitOnComplete,
  skipWelcome = false,
}: AppProps) {
  const { exit } = useApp();
  const authService = getAuthService();

  // Track app state
  const isInitiallyAuthenticated = authService.isAuthenticated();
  const initialState: AppState = skipWelcome
    ? isInitiallyAuthenticated
      ? 'pod-selection'
      : 'login'
    : 'welcome';

  const [appState, setAppState] = useState<AppState>(initialState);
  const [isAuthenticated, setIsAuthenticated] = useState(isInitiallyAuthenticated);
  const [selectedPodId, setSelectedPodId] = useState<string | null>(null);
  const [isLocalPod, setIsLocalPod] = useState<boolean>(local ?? false);

  // Global keyboard shortcuts
  useInput((input, key) => {
    // Ctrl+C to exit
    if (key.ctrl && input === 'c') {
      exit();
    }
  });

  const handleWelcomeComplete = useCallback(() => {
    if (isAuthenticated) {
      setAppState('pod-selection');
    } else {
      setAppState('login');
    }
  }, [isAuthenticated]);

  const handleLoginSuccess = useCallback(() => {
    setIsAuthenticated(true);
    setAppState('pod-selection');
  }, []);

  const handlePodSelect = useCallback((podId: string | null, isLocal: boolean) => {
    setSelectedPodId(podId);
    setIsLocalPod(isLocal);
    setAppState('ready');
  }, []);

  // Show welcome screen
  if (appState === 'welcome') {
    return (
      <ThemeProvider>
        <WelcomeScreen version="0.1.0" onComplete={handleWelcomeComplete} duration={1500} />
      </ThemeProvider>
    );
  }

  // Show login screen if not authenticated
  if (appState === 'login') {
    return (
      <ThemeProvider>
        <Box flexDirection="column" minHeight={10}>
          <Box flexDirection="column" flexGrow={1} paddingX={1}>
            <LoginScreen onSuccess={handleLoginSuccess} />
          </Box>
          <StatusBar />
        </Box>
      </ThemeProvider>
    );
  }

  // Show pod selection after login
  if (appState === 'pod-selection') {
    return (
      <ThemeProvider>
        <Box flexDirection="column" minHeight={10}>
          <Header isLocal={isLocalPod} isConnected={isAuthenticated} />
          <Box flexDirection="column" flexGrow={1} paddingX={1}>
            <PodSelectionScreen onSelect={handlePodSelect} />
          </Box>
          <StatusBar />
        </Box>
      </ThemeProvider>
    );
  }

  // Main application
  return (
    <ThemeProvider>
      <Box flexDirection="column" minHeight={10}>
        <Header
          sessionName={sessionId ? `Session ${sessionId.slice(0, 8)}` : undefined}
          isLocal={isLocalPod}
          isConnected={isAuthenticated}
        />

        <Box flexDirection="column" flexGrow={1} paddingX={1}>
          {mode === 'interactive' ? (
            <InteractiveMode sessionId={sessionId} local={isLocalPod} podId={selectedPodId} />
          ) : (
            <RunMode
              task={task!}
              sessionId={sessionId}
              local={isLocalPod}
              podId={selectedPodId}
              exitOnComplete={exitOnComplete}
            />
          )}
        </Box>

        <StatusBar />
      </Box>
    </ThemeProvider>
  );
}
