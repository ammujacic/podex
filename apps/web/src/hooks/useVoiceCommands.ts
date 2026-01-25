'use client';

import { useCallback, useState, useRef, useEffect } from 'react';
import { getSocket } from '@/lib/socket';
import {
  parseVoiceCommand,
  sendAgentMessage,
  createAgent,
  type VoiceCommandResponse,
} from '@/lib/api';
import { useSessionStore } from '@/stores/session';
import { useUIStore } from '@/stores/ui';
import { useAttentionStore } from '@/stores/attention';

export interface VoiceCommandState {
  isListening: boolean;
  isProcessing: boolean;
  transcript: string;
  lastCommand: VoiceCommandResponse | null;
  error: string | null;
}

interface UseVoiceCommandsOptions {
  sessionId: string;
  onCommandExecuted?: (command: VoiceCommandResponse) => void;
  onError?: (error: Error) => void;
}

export function useVoiceCommands({
  sessionId,
  onCommandExecuted,
  onError,
}: UseVoiceCommandsOptions) {
  const [state, setState] = useState<VoiceCommandState>({
    isListening: false,
    isProcessing: false,
    transcript: '',
    lastCommand: null,
    error: null,
  });

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const { addAgent, openFilePreview } = useSessionStore();
  const { toggleSidebar, setTerminalVisible, setPanelVisible, openQuickOpen, sendTerminalCommand } =
    useUIStore();
  const {
    openPanel: openNotificationPanel,
    dismissAllForSession,
    dismissAllForAgent,
    getAttentionsForSession,
  } = useAttentionStore();

  // Start listening for voice commands
  const startListening = useCallback(async () => {
    try {
      setState((s) => ({ ...s, isListening: true, error: null, transcript: '' }));

      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      streamRef.current = stream;

      // Determine supported mime type
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : 'audio/mp4';

      // Create MediaRecorder
      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      // Notify backend of stream start with error handling
      const socket = getSocket();
      socket.emit(
        'voice_stream_start',
        {
          session_id: sessionId,
          agent_id: 'voice_commands', // Special ID for voice commands
          language: 'en-US',
        },
        (ack: { success?: boolean; error?: string } | undefined) => {
          if (ack && !ack.success) {
            console.warn('Voice stream start failed:', ack.error);
          }
        }
      );

      // Handle audio chunks
      mediaRecorder.ondataavailable = async (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);

          // Convert to base64 and send
          const reader = new FileReader();
          reader.onloadend = () => {
            const result = reader.result as string;
            const base64 = result.split(',')[1];
            if (base64) {
              socket.emit('voice_chunk', {
                session_id: sessionId,
                chunk: base64,
              });
            }
          };
          reader.readAsDataURL(event.data);
        }
      };

      mediaRecorder.start(100); // Collect data every 100ms
    } catch (error) {
      console.error('Failed to start voice command listening:', error);
      setState((s) => ({
        ...s,
        isListening: false,
        error: 'Failed to access microphone',
      }));
      onError?.(error as Error);
    }
  }, [sessionId, onError]);

  // Stop listening and process command
  const stopListening = useCallback(async () => {
    const mediaRecorder = mediaRecorderRef.current;
    const stream = streamRef.current;

    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }

    // Stop all tracks
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }

    // Notify backend
    const socket = getSocket();
    socket.emit('voice_stream_end', { session_id: sessionId });

    setState((s) => ({ ...s, isListening: false, isProcessing: true }));
  }, [sessionId]);

  // Cancel listening without processing
  const cancelListening = useCallback(() => {
    const mediaRecorder = mediaRecorderRef.current;
    const stream = streamRef.current;

    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }

    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }

    chunksRef.current = [];
    setState((s) => ({
      ...s,
      isListening: false,
      isProcessing: false,
      transcript: '',
    }));
  }, []);

  // Execute a parsed command
  const executeCommand = useCallback(
    async (command: VoiceCommandResponse) => {
      try {
        switch (command.command_type) {
          case 'open_file':
            if (command.target) {
              openFilePreview(sessionId, command.target);
            }
            break;

          case 'talk_to_agent':
            if (command.target && command.message) {
              // Get fresh session state to avoid stale closure
              const currentSession = useSessionStore.getState().sessions[sessionId];
              if (currentSession) {
                // Find the agent by role/name
                const targetLower = command.target.toLowerCase();
                const agent = currentSession.agents.find(
                  (a) =>
                    a.role.toLowerCase() === targetLower ||
                    a.name.toLowerCase().includes(targetLower)
                );

                if (agent) {
                  await sendAgentMessage(sessionId, agent.id, command.message);
                } else {
                  setState((s) => ({
                    ...s,
                    error: `Agent "${command.target}" not found`,
                  }));
                }
              }
            }
            break;

          case 'show_terminal':
            setTerminalVisible(true);
            break;

          case 'show_preview':
            setPanelVisible(true);
            break;

          case 'toggle_sidebar':
            toggleSidebar('left');
            break;

          case 'search_files':
            // Open quick open for file search
            openQuickOpen();
            break;

          case 'run_command':
            // Send command to terminal for execution
            if (command.message) {
              sendTerminalCommand(command.message);
            }
            break;

          case 'create_agent':
            // Create a new agent with the specified role
            if (command.target) {
              const role = command.target.toLowerCase() as
                | 'architect'
                | 'coder'
                | 'reviewer'
                | 'tester'
                | 'custom';
              const validRoles = ['architect', 'coder', 'reviewer', 'tester'];
              const agentRole = validRoles.includes(role) ? role : 'custom';

              try {
                // Don't specify model - backend will use the role's default model
                const agentResponse = await createAgent(sessionId, {
                  name: `${role.charAt(0).toUpperCase() + role.slice(1)} Agent`,
                  role: agentRole,
                });

                // Get fresh session state for accurate agent count
                const currentSession = useSessionStore.getState().sessions[sessionId];
                const agentCount = currentSession?.agents.length ?? 0;

                // Add to local store
                addAgent(sessionId, {
                  id: agentResponse.id,
                  name: agentResponse.name,
                  role: agentRole,
                  model: agentResponse.model,
                  status: 'idle',
                  color: `agent-${(agentCount % 6) + 1}`,
                  messages: [],
                  mode: 'auto',
                });
              } catch (error) {
                console.error('Failed to create agent:', error);
                setState((s) => ({
                  ...s,
                  error: `Failed to create ${command.target} agent`,
                }));
              }
            }
            break;

          // Notification commands (handled via keyword matching)
          default: {
            // Check for notification-related keywords
            const text = command.raw_text?.toLowerCase() ?? '';

            if (text.includes('show notification') || text.includes('open notification')) {
              openNotificationPanel();
            } else if (
              text.includes('dismiss all notification') ||
              text.includes('clear notification')
            ) {
              dismissAllForSession(sessionId);
            } else if (text.includes('approve') && command.target) {
              // Get fresh session state
              const currentSession = useSessionStore.getState().sessions[sessionId];
              // Find agent by name and dismiss their approval notifications
              const targetLower = command.target.toLowerCase();
              const agent = currentSession?.agents.find(
                (a) =>
                  a.role.toLowerCase() === targetLower || a.name.toLowerCase().includes(targetLower)
              );

              if (agent) {
                // Dismiss approval notifications for this agent
                const attentions = getAttentionsForSession(sessionId);
                const approvalAttentions = attentions.filter(
                  (a) => a.agentId === agent.id && a.type === 'needs_approval'
                );
                if (approvalAttentions.length > 0) {
                  dismissAllForAgent(sessionId, agent.id);
                }
              }
            } else {
              console.warn('Unknown voice command:', command.command_type);
            }
          }
        }

        onCommandExecuted?.(command);
      } catch (error) {
        console.error('Failed to execute command:', error);
        onError?.(error as Error);
      }
    },
    [
      sessionId,
      openFilePreview,
      setTerminalVisible,
      setPanelVisible,
      toggleSidebar,
      openQuickOpen,
      sendTerminalCommand,
      addAgent,
      openNotificationPanel,
      dismissAllForSession,
      dismissAllForAgent,
      getAttentionsForSession,
      onCommandExecuted,
      onError,
    ]
  );

  // Listen for transcription results
  useEffect(() => {
    const socket = getSocket();

    const handleTranscription = async (data: {
      session_id: string;
      agent_id: string;
      text: string;
      confidence: number;
      is_final: boolean;
    }) => {
      // Only handle voice command transcriptions
      if (data.agent_id !== 'voice_commands') return;

      setState((s) => ({ ...s, transcript: data.text }));

      if (data.is_final && data.text.trim()) {
        setState((s) => ({ ...s, isProcessing: true }));

        try {
          // Parse the command
          const command = await parseVoiceCommand(data.text, sessionId);
          setState((s) => ({
            ...s,
            lastCommand: command,
            isProcessing: false,
          }));

          // Execute the command
          await executeCommand(command);
        } catch (error) {
          console.error('Failed to parse voice command:', error);
          setState((s) => ({
            ...s,
            isProcessing: false,
            error: 'Failed to process command',
          }));
        }
      }
    };

    socket.on('voice_transcription', handleTranscription);

    return () => {
      socket.off('voice_transcription', handleTranscription);
    };
  }, [sessionId, executeCommand]);

  // Cleanup on unmount - stop both MediaRecorder and stream
  useEffect(() => {
    return () => {
      // Stop MediaRecorder if still recording
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        try {
          mediaRecorderRef.current.stop();
        } catch {
          // Ignore errors during cleanup
        }
      }
      mediaRecorderRef.current = null;

      // Stop all media tracks
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
      streamRef.current = null;
      chunksRef.current = [];
    };
  }, []);

  return {
    ...state,
    startListening,
    stopListening,
    cancelListening,
    executeCommand,
  };
}
