/**
 * Run mode component for one-shot task execution.
 */

import { useEffect, useState } from 'react';
import { Box, Text, useApp } from 'ink';
import { useSession } from '../hooks/useSession';
import { useSocket } from '../hooks/useSocket';
import { Spinner } from '../components/common/Spinner';
import { ErrorBox } from '../components/common/ErrorBox';
import { SuccessBox } from '../components/common/SuccessBox';
import { MessageList } from '../components/chat/MessageList';
import { StreamingMessage } from '../components/chat/StreamingMessage';
import { ApprovalPrompt } from '../components/chat/ApprovalPrompt';
import { getCliAuthProvider } from '../adapters/auth-provider';

interface RunModeProps {
  task: string;
  sessionId?: string;
  local?: boolean;
  podId?: string | null;
  exitOnComplete?: boolean;
}

export function RunMode({ task, sessionId, local, podId, exitOnComplete }: RunModeProps) {
  const { exit } = useApp();
  const authProvider = getCliAuthProvider();
  const credentials = authProvider.getCredentials();

  const [taskSent, setTaskSent] = useState(false);
  const [taskComplete, setTaskComplete] = useState(false);

  const {
    session,
    agents,
    messages,
    currentAgentId,
    isLoading: sessionLoading,
    error: sessionError,
    sendMessage,
  } = useSession({
    sessionId,
    autoCreate: !sessionId,
    local,
    podId: podId ?? undefined,
  });

  const { isConnected, streamingContent, pendingApproval, respondToApproval } = useSocket({
    sessionId: session?.id,
    userId: credentials?.userId,
    autoConnect: true,
  });

  // Send task when session is ready
  useEffect(() => {
    if (session && isConnected && !taskSent && currentAgentId) {
      setTaskSent(true);
      sendMessage(task);
    }
  }, [session, isConnected, taskSent, currentAgentId, task, sendMessage]);

  // Check for task completion
  useEffect(() => {
    const currentAgent = agents.find((a) => a.id === currentAgentId);
    if (taskSent && currentAgent?.status === 'idle' && !streamingContent && !pendingApproval) {
      // Task is complete when agent is idle and no streaming
      const lastMessage = messages[messages.length - 1];
      if (lastMessage && lastMessage.role === 'assistant') {
        setTaskComplete(true);
        if (exitOnComplete) {
          setTimeout(() => exit(), 1000);
        }
      }
    }
  }, [
    agents,
    currentAgentId,
    taskSent,
    streamingContent,
    pendingApproval,
    messages,
    exitOnComplete,
    exit,
  ]);

  if (sessionLoading) {
    return (
      <Box flexDirection="column" padding={1}>
        <Spinner label="Loading session..." />
      </Box>
    );
  }

  if (sessionError) {
    return (
      <Box flexDirection="column" padding={1}>
        <ErrorBox message={sessionError} />
        <Text color="gray">Press Ctrl+C to exit</Text>
      </Box>
    );
  }

  if (!session) {
    return (
      <Box flexDirection="column" padding={1}>
        <Spinner label="Creating session..." />
      </Box>
    );
  }

  if (!isConnected) {
    return (
      <Box flexDirection="column" padding={1}>
        <Spinner label="Connecting..." />
      </Box>
    );
  }

  const currentAgent = agents.find((a) => a.id === currentAgentId);

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* Task header */}
      <Box borderStyle="single" borderColor="blue" paddingX={1} marginBottom={1}>
        <Text color="blue" bold>
          Task:{' '}
        </Text>
        <Text>{task}</Text>
      </Box>

      {/* Status */}
      <Box marginBottom={1}>
        <Text color="gray">Agent: {currentAgent?.name || 'Unknown'} | Status: </Text>
        <Text color={currentAgent?.status === 'idle' ? 'green' : 'yellow'}>
          {currentAgent?.status || 'unknown'}
        </Text>
      </Box>

      {/* Messages */}
      <Box flexDirection="column" flexGrow={1}>
        <MessageList messages={messages} />
        {streamingContent && (
          <StreamingMessage
            content={streamingContent}
            isThinking={currentAgent?.status === 'thinking'}
          />
        )}
      </Box>

      {/* Approval prompt */}
      {pendingApproval && (
        <ApprovalPrompt
          request={pendingApproval}
          onRespond={(approved, addToAllowlist) => respondToApproval(approved, addToAllowlist)}
        />
      )}

      {/* Completion message */}
      {taskComplete && (
        <SuccessBox
          title="Task Complete"
          message={exitOnComplete ? 'Exiting...' : 'Press Ctrl+C to exit'}
        />
      )}
    </Box>
  );
}
