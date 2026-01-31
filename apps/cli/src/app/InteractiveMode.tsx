/**
 * Interactive chat mode component.
 */

import { useState, useCallback, useMemo } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { useSession } from '../hooks/useSession';
import { useSocket } from '../hooks/useSocket';
import { Spinner } from '../components/common/Spinner';
import { ErrorBox } from '../components/common/ErrorBox';
import { MessageList } from '../components/chat/MessageList';
import { StreamingMessage } from '../components/chat/StreamingMessage';
import { SimpleChatInput } from '../components/chat/ChatInput';
import { ApprovalPrompt } from '../components/chat/ApprovalPrompt';
import { Header } from '../components/layout/Header';
import { StatusBar } from '../components/layout/StatusBar';
import { getCliAuthProvider } from '../adapters/auth-provider';
import type { AgentState } from '../components/agents/AgentStatus';

interface InteractiveModeProps {
  sessionId?: string;
  local?: boolean;
  podId?: string | null;
}

export function InteractiveMode({ sessionId, local, podId }: InteractiveModeProps) {
  const { exit } = useApp();
  const authProvider = getCliAuthProvider();
  const credentials = authProvider.getCredentials();

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

  const {
    isConnected,
    streamingContent,
    thinkingContent,
    pendingApproval,
    agentContextUsage,
    agentConfigs,
    sessionUsage,
    respondToApproval,
  } = useSocket({
    sessionId: session?.id,
    userId: credentials?.userId,
    autoConnect: true,
  });

  const [inputDisabled, setInputDisabled] = useState(false);

  // Handle keyboard shortcuts
  useInput((input, key) => {
    // Ctrl+C to exit
    if (key.ctrl && input === 'c') {
      exit();
    }

    // Ctrl+L to clear (would need state for this)
    if (key.ctrl && input === 'l') {
      // Clear functionality would go here
    }
  });

  const handleSendMessage = useCallback(
    async (content: string) => {
      setInputDisabled(true);
      try {
        await sendMessage(content);
      } finally {
        setInputDisabled(false);
      }
    },
    [sendMessage]
  );

  const handleApprovalResponse = useCallback(
    (approved: boolean, addToAllowlist: boolean) => {
      respondToApproval(approved, addToAllowlist);
    },
    [respondToApproval]
  );

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

  const currentAgent = agents.find((a) => a.id === currentAgentId);

  // Get current agent's context usage and config
  const currentAgentContext = currentAgentId ? agentContextUsage[currentAgentId] : undefined;
  const currentAgentConfig = currentAgentId ? agentConfigs[currentAgentId] : undefined;

  // Map agent status to AgentState
  const agentStatusToState = (status: string): AgentState => {
    switch (status) {
      case 'active':
        return 'executing';
      case 'error':
        return 'error';
      default:
        return 'idle';
    }
  };

  // Get model display name - prefer from config update, fallback to agent data
  const modelDisplayName = useMemo(() => {
    if (currentAgentConfig?.model) {
      // Format model ID to display name
      const modelId = currentAgentConfig.model;
      if (modelId.includes('opus')) return 'Claude Opus 4.5';
      if (modelId.includes('sonnet')) return 'Claude Sonnet 4';
      if (modelId.includes('haiku')) return 'Claude Haiku 3.5';
      if (modelId.includes('gpt-4')) return 'GPT-4';
      if (modelId.includes('gpt-3')) return 'GPT-3.5';
      return modelId;
    }
    return currentAgent?.model;
  }, [currentAgentConfig?.model, currentAgent?.model]);

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* Header with session info, model, and context usage */}
      <Header
        sessionName={session.name}
        branch={session.branch}
        isConnected={isConnected}
        isLocal={local}
        agentName={currentAgent?.name}
        modelName={modelDisplayName}
        contextPercentage={currentAgentContext?.percentage}
        contextTokensUsed={currentAgentContext?.tokensUsed}
        contextTokensMax={currentAgentContext?.tokensMax}
      />

      {/* Agent tabs */}
      {agents.length > 1 && (
        <Box marginY={1}>
          {agents.map((agent) => {
            const agentContext = agentContextUsage[agent.id];
            return (
              <Box key={agent.id} marginRight={2}>
                <Text
                  color={agent.id === currentAgentId ? 'cyan' : 'gray'}
                  bold={agent.id === currentAgentId}
                >
                  {agent.name}
                </Text>
                <Text color={agent.status === 'idle' ? 'green' : 'yellow'}> ({agent.status})</Text>
                {agentContext && <Text dimColor> [{agentContext.percentage}%]</Text>}
              </Box>
            );
          })}
        </Box>
      )}

      {/* Messages */}
      <Box flexDirection="column" flexGrow={1}>
        <MessageList messages={messages} />
        {(streamingContent || thinkingContent) && (
          <StreamingMessage
            content={streamingContent || thinkingContent}
            isThinking={!!thinkingContent && !streamingContent}
          />
        )}
      </Box>

      {/* Approval prompt */}
      {pendingApproval && (
        <ApprovalPrompt request={pendingApproval} onRespond={handleApprovalResponse} />
      )}

      {/* Input */}
      <SimpleChatInput
        onSubmit={handleSendMessage}
        disabled={inputDisabled || !isConnected || !!pendingApproval || !!streamingContent}
        placeholder={
          !isConnected
            ? 'Connecting...'
            : pendingApproval
              ? 'Respond to approval above...'
              : streamingContent
                ? 'Waiting for response...'
                : 'Type a message...'
        }
      />

      {/* Status bar with token usage */}
      <StatusBar
        agentStatus={currentAgent ? agentStatusToState(currentAgent.status) : undefined}
        agentName={currentAgent?.name}
        inputTokens={sessionUsage.inputTokens}
        outputTokens={sessionUsage.outputTokens}
      />
    </Box>
  );
}
