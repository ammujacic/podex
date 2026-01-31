/**
 * Pod selection screen - shown after login.
 * Allows users to select from available pods or create a new local pod.
 */

import { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { Spinner } from '../common/Spinner';
import { ErrorBox } from '../common/ErrorBox';
import { SuccessBox } from '../common/SuccessBox';
import { SelectMenu, type SelectOption } from '../input/SelectMenu';
import { getApiClient } from '../../services/api-client';
import { terminalColors, icons, borders } from '../../theme';

interface LocalPod {
  id: string;
  name: string;
  status: 'online' | 'offline' | 'busy' | 'error';
  os_info: string | null;
  architecture: string | null;
  total_memory_mb: number | null;
  total_cpu_cores: number | null;
  current_workspaces: number;
  last_heartbeat: string | null;
}

interface LocalPodListResponse {
  pods: LocalPod[];
  total: number;
}

interface LocalPodCreateResponse {
  pod: LocalPod;
  token: string;
  connection_url: string;
}

export interface PodSelectionScreenProps {
  onSelect: (podId: string | null, isLocal: boolean) => void;
}

type ScreenState =
  | 'loading'
  | 'select'
  | 'create-name'
  | 'create-loading'
  | 'create-success'
  | 'error';

type PodAction =
  | { type: 'select'; podId: string }
  | { type: 'create' }
  | { type: 'cloud' }
  | { type: 'refresh' };

export function PodSelectionScreen({ onSelect }: PodSelectionScreenProps) {
  const [state, setState] = useState<ScreenState>('loading');
  const [pods, setPods] = useState<LocalPod[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Pod creation state
  const [podName, setPodName] = useState('');
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [createdPodName, setCreatedPodName] = useState<string | null>(null);

  const fetchPods = useCallback(async () => {
    setState('loading');
    setError(null);

    try {
      const client = getApiClient();
      const response = await client.get<LocalPodListResponse>('/api/v1/local-pods');
      setPods(response.pods);
      setState('select');
    } catch (err) {
      setError((err as Error).message);
      setState('error');
    }
  }, []);

  useEffect(() => {
    fetchPods();
  }, [fetchPods]);

  const handleSelection = useCallback(
    (action: PodAction) => {
      if (action.type === 'select') {
        onSelect(action.podId, true);
      } else if (action.type === 'cloud') {
        onSelect(null, false);
      } else if (action.type === 'create') {
        setPodName('');
        setState('create-name');
      } else if (action.type === 'refresh') {
        fetchPods();
      }
    },
    [onSelect, fetchPods]
  );

  const handleCreatePod = useCallback(async () => {
    if (!podName.trim()) return;

    setState('create-loading');
    setError(null);

    try {
      const client = getApiClient();
      const response = await client.post<LocalPodCreateResponse>('/api/v1/local-pods', {
        name: podName.trim(),
      });
      setCreatedToken(response.token);
      setCreatedPodName(podName.trim());
      setState('create-success');
    } catch (err) {
      setError((err as Error).message);
      setState('error');
    }
  }, [podName]);

  // Handle text input for pod name
  useInput(
    (input, key) => {
      if (state !== 'create-name') return;

      if (key.return) {
        if (podName.trim()) {
          handleCreatePod();
        }
        return;
      }

      if (key.escape) {
        setState('select');
        return;
      }

      if (key.backspace || key.delete) {
        setPodName((prev) => prev.slice(0, -1));
        return;
      }

      if (input && !key.ctrl && !key.meta) {
        setPodName((prev) => prev + input);
      }
    },
    { isActive: state === 'create-name' }
  );

  if (state === 'loading') {
    return (
      <Box flexDirection="column" padding={1}>
        <Spinner label="Loading available pods..." color={terminalColors.primary} />
      </Box>
    );
  }

  if (state === 'error') {
    return (
      <Box flexDirection="column" padding={1}>
        <ErrorBox message={error || 'Failed to load pods'} />
        <Box marginTop={1}>
          <SelectMenu
            options={[
              {
                label: 'Try again',
                value: { type: 'refresh' } as PodAction,
                description: 'Retry loading pods',
              },
              {
                label: 'Use cloud compute',
                value: { type: 'cloud' } as PodAction,
                description: 'Skip pod selection',
              },
            ]}
            onSelect={(action) => {
              if (action.type === 'refresh') {
                fetchPods();
              } else {
                onSelect(null, false);
              }
            }}
          />
        </Box>
      </Box>
    );
  }

  if (state === 'create-name') {
    return (
      <Box flexDirection="column" padding={1}>
        <Box marginBottom={1}>
          <Text bold color={terminalColors.secondary}>
            {icons.lightning} Create New Local Pod
          </Text>
        </Box>

        <Box marginBottom={1}>
          <Text>Enter a name for your pod (e.g., "My MacBook Pro"):</Text>
        </Box>

        <Box
          borderStyle="single"
          borderColor={terminalColors.primary}
          paddingX={1}
          marginBottom={1}
        >
          <Text color={terminalColors.primary} bold>
            {'> '}
          </Text>
          <Text>{podName || <Text color="gray">Pod name...</Text>}</Text>
        </Box>

        <Box>
          <Text dimColor>
            Press <Text color={terminalColors.muted}>Enter</Text> to create,{' '}
            <Text color={terminalColors.muted}>Esc</Text> to cancel
          </Text>
        </Box>
      </Box>
    );
  }

  if (state === 'create-loading') {
    return (
      <Box flexDirection="column" padding={1}>
        <Spinner label={`Creating pod "${podName}"...`} color={terminalColors.primary} />
      </Box>
    );
  }

  if (state === 'create-success' && createdToken) {
    return (
      <Box flexDirection="column" padding={1}>
        <SuccessBox message={`Pod "${createdPodName}" created!`} />

        <Box
          flexDirection="column"
          borderStyle={borders.round}
          borderColor={terminalColors.warning}
          paddingX={2}
          paddingY={1}
          marginTop={1}
        >
          <Box marginBottom={1}>
            <Text bold color={terminalColors.warning}>
              {icons.warning} Save Your Token - Shown Only Once!
            </Text>
          </Box>

          <Box flexDirection="column" marginBottom={1}>
            <Text bold>Step 1:</Text>
            <Text> Install the agent</Text>
          </Box>

          <Box
            marginBottom={1}
            paddingX={1}
            borderStyle="single"
            borderColor={terminalColors.muted}
          >
            <Text color={terminalColors.secondary} bold>
              pip install podex-local-pod
            </Text>
          </Box>

          <Box flexDirection="column" marginBottom={1}>
            <Text bold>Step 2:</Text>
            <Text> Start your pod with this command</Text>
          </Box>

          <Box paddingX={1} borderStyle="single" borderColor={terminalColors.warning}>
            <Text color={terminalColors.warning} bold>
              podex-local-pod start --token {createdToken}
            </Text>
          </Box>

          <Box flexDirection="column" marginTop={1}>
            <Text dimColor>Your pod will appear as </Text>
            <Text color={terminalColors.success} bold>
              "Online"
            </Text>
            <Text dimColor> once connected.</Text>
          </Box>
        </Box>

        <Box marginTop={1}>
          <SelectMenu
            options={[
              {
                label: 'Refresh pod list',
                value: { type: 'refresh' } as PodAction,
                description: 'Check for newly connected pods',
              },
              {
                label: 'Use cloud compute for now',
                value: { type: 'cloud' } as PodAction,
                description: 'Continue without local pod',
              },
            ]}
            onSelect={(action) => {
              if (action.type === 'refresh') {
                setCreatedToken(null);
                setCreatedPodName(null);
                fetchPods();
              } else {
                onSelect(null, false);
              }
            }}
          />
        </Box>
      </Box>
    );
  }

  // Build menu options for pod selection
  const menuOptions: SelectOption<PodAction>[] = [];

  // Add online pods first
  const onlinePods = pods.filter((p) => p.status === 'online');
  const offlinePods = pods.filter((p) => p.status !== 'online');

  for (const pod of onlinePods) {
    const specs = [
      pod.os_info,
      pod.total_cpu_cores ? `${pod.total_cpu_cores} cores` : null,
      pod.total_memory_mb ? `${Math.round(pod.total_memory_mb / 1024)}GB RAM` : null,
    ]
      .filter(Boolean)
      .join(' | ');

    menuOptions.push({
      label: `${icons.local} ${pod.name}`,
      value: { type: 'select', podId: pod.id },
      description: specs || 'Local pod',
    });
  }

  // Add offline pods (disabled)
  for (const pod of offlinePods) {
    menuOptions.push({
      label: `${pod.name} (${pod.status})`,
      value: { type: 'select', podId: pod.id },
      description: 'Pod is not connected - start it with podex-local-pod',
      disabled: true,
    });
  }

  // Add create option
  menuOptions.push({
    label: `${icons.lightning} Create new local pod`,
    value: { type: 'create' },
    description: 'Register a new pod and get a connection token',
  });

  // Add cloud option
  menuOptions.push({
    label: `${icons.cloud} Use cloud compute`,
    value: { type: 'cloud' },
    description: 'Run workspaces on Podex cloud infrastructure',
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color={terminalColors.secondary}>
          Select a Pod
        </Text>
      </Box>

      <Box marginBottom={1}>
        <Text>Choose where to run your development environment:</Text>
      </Box>

      <Box marginTop={1}>
        <SelectMenu
          options={menuOptions}
          onSelect={handleSelection}
          highlightColor={terminalColors.primary}
        />
      </Box>
    </Box>
  );
}
