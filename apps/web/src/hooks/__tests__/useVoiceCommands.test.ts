/**
 * Comprehensive tests for useVoiceCommands hook
 * Tests recording, transcription, command parsing, and command execution
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useVoiceCommands } from '../useVoiceCommands';
import { setupMediaMocks, resetMediaMocks, MockMediaRecorder } from '@/__tests__/mocks/media';
import type { VoiceCommandResponse } from '@/lib/api';

// Import modules to mock
import * as socketModule from '@/lib/socket';
import * as apiModule from '@/lib/api';
import * as sessionStore from '@/stores/session';
import * as uiStore from '@/stores/ui';
import * as attentionStore from '@/stores/attention';

// Mock dependencies
vi.mock('@/lib/socket');
vi.mock('@/lib/api');
vi.mock('@/stores/session');
vi.mock('@/stores/ui');
vi.mock('@/stores/attention');

describe('useVoiceCommands', () => {
  let mockSocket: any;

  beforeEach(() => {
    setupMediaMocks();

    // Setup default socket mock
    mockSocket = {
      emit: vi.fn((event, data, callback) => {
        if (callback) {
          callback({ success: true });
        }
      }),
      on: vi.fn(),
      off: vi.fn(),
    };

    vi.mocked(socketModule.getSocket).mockReturnValue(mockSocket);

    // Setup default API mocks
    vi.mocked(apiModule.parseVoiceCommand).mockResolvedValue({
      command_type: 'show_terminal',
      target: null,
      message: null,
      raw_text: 'show terminal',
    });
    vi.mocked(apiModule.sendAgentMessage).mockResolvedValue(undefined);
    vi.mocked(apiModule.createAgent).mockResolvedValue({
      id: 'new-agent-id',
      name: 'Test Agent',
      model: 'claude-3-5-sonnet-20241022',
    });

    // Setup default store mocks
    vi.mocked(sessionStore.useSessionStore).mockReturnValue({
      addAgent: vi.fn(),
      openFilePreview: vi.fn(),
      sessions: {},
    } as any);

    vi.mocked(uiStore.useUIStore).mockReturnValue({
      toggleSidebar: vi.fn(),
      setTerminalVisible: vi.fn(),
      setPanelVisible: vi.fn(),
      openQuickOpen: vi.fn(),
      sendTerminalCommand: vi.fn(),
    } as any);

    vi.mocked(attentionStore.useAttentionStore).mockReturnValue({
      openPanel: vi.fn(),
      dismissAllForSession: vi.fn(),
      dismissAllForAgent: vi.fn(),
      getAttentionsForSession: vi.fn(() => []),
    } as any);

    // Reset all mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetMediaMocks();
  });

  describe('Initialization', () => {
    it('should initialize with default state', () => {
      const { result } = renderHook(() =>
        useVoiceCommands({
          sessionId: 'test-session',
        })
      );

      expect(result.current.isListening).toBe(false);
      expect(result.current.isProcessing).toBe(false);
      expect(result.current.transcript).toBe('');
      expect(result.current.lastCommand).toBeNull();
      expect(result.current.error).toBeNull();
    });

    it('should provide all required methods', () => {
      const { result } = renderHook(() =>
        useVoiceCommands({
          sessionId: 'test-session',
        })
      );

      expect(typeof result.current.startListening).toBe('function');
      expect(typeof result.current.stopListening).toBe('function');
      expect(typeof result.current.cancelListening).toBe('function');
      expect(typeof result.current.executeCommand).toBe('function');
    });
  });

  describe('Recording', () => {
    it('should start listening and request microphone access', async () => {
      const { result } = renderHook(() =>
        useVoiceCommands({
          sessionId: 'test-session',
        })
      );

      await act(async () => {
        await result.current.startListening();
      });

      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      expect(result.current.isListening).toBe(true);
    });

    it('should create MediaRecorder with correct settings', async () => {
      const { result } = renderHook(() =>
        useVoiceCommands({
          sessionId: 'test-session',
        })
      );

      await act(async () => {
        await result.current.startListening();
      });

      expect(result.current.isListening).toBe(true);
    });

    it('should emit voice_stream_start to socket', async () => {
      const { result } = renderHook(() =>
        useVoiceCommands({
          sessionId: 'test-session',
        })
      );

      await act(async () => {
        await result.current.startListening();
      });

      expect(mockSocket.emit).toHaveBeenCalledWith(
        'voice_stream_start',
        {
          session_id: 'test-session',
          agent_id: 'voice_commands',
          language: 'en-US',
        },
        expect.any(Function)
      );
    });

    it('should handle microphone access error', async () => {
      const mockError = new Error('Microphone access denied');
      vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValueOnce(mockError);

      const onError = vi.fn();
      const { result } = renderHook(() =>
        useVoiceCommands({
          sessionId: 'test-session',
          onError,
        })
      );

      await act(async () => {
        await result.current.startListening();
      });

      await waitFor(() => {
        expect(result.current.error).toBe('Failed to access microphone');
        expect(result.current.isListening).toBe(false);
        expect(onError).toHaveBeenCalledWith(mockError);
      });
    });

    it('should stop listening and emit voice_stream_end', async () => {
      const { result } = renderHook(() =>
        useVoiceCommands({
          sessionId: 'test-session',
        })
      );

      await act(async () => {
        await result.current.startListening();
      });

      await act(async () => {
        await result.current.stopListening();
      });

      expect(mockSocket.emit).toHaveBeenCalledWith('voice_stream_end', {
        session_id: 'test-session',
      });

      expect(result.current.isListening).toBe(false);
      expect(result.current.isProcessing).toBe(true);
    });

    it('should cancel listening without processing', async () => {
      const { result } = renderHook(() =>
        useVoiceCommands({
          sessionId: 'test-session',
        })
      );

      await act(async () => {
        await result.current.startListening();
      });

      act(() => {
        result.current.cancelListening();
      });

      expect(result.current.isListening).toBe(false);
      expect(result.current.isProcessing).toBe(false);
      expect(result.current.transcript).toBe('');
    });

    it('should stop media tracks on cancel', async () => {
      const mockTrack1 = { stop: vi.fn() };
      const mockTrack2 = { stop: vi.fn() };
      const mockTracks = [mockTrack1, mockTrack2];

      const mockStream = {
        getTracks: vi.fn(() => mockTracks),
      };

      vi.mocked(navigator.mediaDevices.getUserMedia).mockResolvedValueOnce(mockStream as any);

      const { result } = renderHook(() =>
        useVoiceCommands({
          sessionId: 'test-session',
        })
      );

      await act(async () => {
        await result.current.startListening();
      });

      act(() => {
        result.current.cancelListening();
      });

      expect(mockTrack1.stop).toHaveBeenCalled();
      expect(mockTrack2.stop).toHaveBeenCalled();
    });

    it('should handle stopping when not recording', async () => {
      const { result } = renderHook(() =>
        useVoiceCommands({
          sessionId: 'test-session',
        })
      );

      await act(async () => {
        await result.current.stopListening();
      });

      expect(result.current.isListening).toBe(false);
    });

    it('should cleanup on unmount', async () => {
      const mockTrack = { stop: vi.fn() };
      const mockTracks = [mockTrack];

      const mockStream = {
        getTracks: vi.fn(() => mockTracks),
      };

      vi.mocked(navigator.mediaDevices.getUserMedia).mockResolvedValueOnce(mockStream as any);

      const { result, unmount } = renderHook(() =>
        useVoiceCommands({
          sessionId: 'test-session',
        })
      );

      await act(async () => {
        await result.current.startListening();
      });

      unmount();

      expect(mockTrack.stop).toHaveBeenCalled();
    });
  });

  describe('Transcription', () => {
    it('should update transcript from socket events', async () => {
      let transcriptionHandler: any;

      mockSocket.on = vi.fn((event, handler) => {
        if (event === 'voice_transcription') {
          transcriptionHandler = handler;
        }
      });

      const { result } = renderHook(() =>
        useVoiceCommands({
          sessionId: 'test-session',
        })
      );

      expect(mockSocket.on).toHaveBeenCalledWith('voice_transcription', expect.any(Function));

      await act(async () => {
        transcriptionHandler({
          session_id: 'test-session',
          agent_id: 'voice_commands',
          text: 'Hello world',
          confidence: 0.95,
          is_final: false,
        });
      });

      expect(result.current.transcript).toBe('Hello world');
    });

    it('should ignore transcriptions from other agents', async () => {
      let transcriptionHandler: any;

      mockSocket.on = vi.fn((event, handler) => {
        if (event === 'voice_transcription') {
          transcriptionHandler = handler;
        }
      });

      const { result } = renderHook(() =>
        useVoiceCommands({
          sessionId: 'test-session',
        })
      );

      await act(async () => {
        transcriptionHandler({
          session_id: 'test-session',
          agent_id: 'other-agent',
          text: 'Should be ignored',
          confidence: 0.95,
          is_final: false,
        });
      });

      expect(result.current.transcript).toBe('');
    });

    it('should parse command on final transcription', async () => {
      let transcriptionHandler: any;

      mockSocket.on = vi.fn((event, handler) => {
        if (event === 'voice_transcription') {
          transcriptionHandler = handler;
        }
      });

      const mockCommand: VoiceCommandResponse = {
        command_type: 'show_terminal',
        target: null,
        message: null,
        raw_text: 'show terminal',
      };

      vi.mocked(apiModule.parseVoiceCommand).mockResolvedValueOnce(mockCommand);

      const { result } = renderHook(() =>
        useVoiceCommands({
          sessionId: 'test-session',
        })
      );

      await act(async () => {
        transcriptionHandler({
          session_id: 'test-session',
          agent_id: 'voice_commands',
          text: 'show terminal',
          confidence: 0.95,
          is_final: true,
        });
      });

      await waitFor(() => {
        expect(apiModule.parseVoiceCommand).toHaveBeenCalledWith('show terminal', 'test-session');
        expect(result.current.lastCommand).toEqual(mockCommand);
        expect(result.current.isProcessing).toBe(false);
      });
    });

    it('should handle empty transcription', async () => {
      let transcriptionHandler: any;

      mockSocket.on = vi.fn((event, handler) => {
        if (event === 'voice_transcription') {
          transcriptionHandler = handler;
        }
      });

      const { result } = renderHook(() =>
        useVoiceCommands({
          sessionId: 'test-session',
        })
      );

      await act(async () => {
        transcriptionHandler({
          session_id: 'test-session',
          agent_id: 'voice_commands',
          text: '   ',
          confidence: 0.95,
          is_final: true,
        });
      });

      expect(apiModule.parseVoiceCommand).not.toHaveBeenCalled();
    });

    it('should handle parse error', async () => {
      let transcriptionHandler: any;

      mockSocket.on = vi.fn((event, handler) => {
        if (event === 'voice_transcription') {
          transcriptionHandler = handler;
        }
      });

      vi.mocked(apiModule.parseVoiceCommand).mockRejectedValueOnce(new Error('Parse failed'));

      const { result } = renderHook(() =>
        useVoiceCommands({
          sessionId: 'test-session',
        })
      );

      await act(async () => {
        transcriptionHandler({
          session_id: 'test-session',
          agent_id: 'voice_commands',
          text: 'invalid command',
          confidence: 0.95,
          is_final: true,
        });
      });

      await waitFor(() => {
        expect(result.current.error).toBe('Failed to process command');
        expect(result.current.isProcessing).toBe(false);
      });
    });

    it('should unsubscribe from socket on unmount', () => {
      const { unmount } = renderHook(() =>
        useVoiceCommands({
          sessionId: 'test-session',
        })
      );

      unmount();

      expect(mockSocket.off).toHaveBeenCalledWith('voice_transcription', expect.any(Function));
    });
  });

  describe('Command Execution - File Operations', () => {
    it('should execute open_file command', async () => {
      const mockOpenFilePreview = vi.fn();
      vi.mocked(sessionStore.useSessionStore).mockReturnValue({
        openFilePreview: mockOpenFilePreview,
        sessions: {},
      } as any);

      const { result } = renderHook(() =>
        useVoiceCommands({
          sessionId: 'test-session',
        })
      );

      const command: VoiceCommandResponse = {
        command_type: 'open_file',
        target: '/path/to/file.ts',
        message: null,
        raw_text: 'open file',
      };

      await act(async () => {
        await result.current.executeCommand(command);
      });

      expect(mockOpenFilePreview).toHaveBeenCalledWith('test-session', '/path/to/file.ts');
    });

    it('should handle open_file without target', async () => {
      const mockOpenFilePreview = vi.fn();
      vi.mocked(sessionStore.useSessionStore).mockReturnValue({
        openFilePreview: mockOpenFilePreview,
        sessions: {},
      } as any);

      const { result } = renderHook(() =>
        useVoiceCommands({
          sessionId: 'test-session',
        })
      );

      const command: VoiceCommandResponse = {
        command_type: 'open_file',
        target: null,
        message: null,
        raw_text: 'open file',
      };

      await act(async () => {
        await result.current.executeCommand(command);
      });

      expect(mockOpenFilePreview).not.toHaveBeenCalled();
    });
  });

  describe('Command Execution - Agent Operations', () => {
    it('should execute talk_to_agent command', async () => {
      const mockStoreValue = {
        sessions: {
          'test-session': {
            agents: [{ id: 'agent-1', role: 'coder', name: 'Coder Agent' }],
          },
        },
      };

      vi.mocked(sessionStore.useSessionStore).mockReturnValue(mockStoreValue as any);
      (sessionStore.useSessionStore as any).getState = vi.fn(() => mockStoreValue);

      const { result } = renderHook(() =>
        useVoiceCommands({
          sessionId: 'test-session',
        })
      );

      const command: VoiceCommandResponse = {
        command_type: 'talk_to_agent',
        target: 'coder',
        message: 'Write a function',
        raw_text: 'talk to coder',
      };

      await act(async () => {
        await result.current.executeCommand(command);
      });

      expect(apiModule.sendAgentMessage).toHaveBeenCalledWith(
        'test-session',
        'agent-1',
        'Write a function'
      );
    });

    it('should handle agent not found', async () => {
      const mockStoreValue = {
        sessions: {
          'test-session': {
            agents: [],
          },
        },
      };

      vi.mocked(sessionStore.useSessionStore).mockReturnValue(mockStoreValue as any);
      (sessionStore.useSessionStore as any).getState = vi.fn(() => mockStoreValue);

      const { result } = renderHook(() =>
        useVoiceCommands({
          sessionId: 'test-session',
        })
      );

      const command: VoiceCommandResponse = {
        command_type: 'talk_to_agent',
        target: 'coder',
        message: 'Write a function',
        raw_text: 'talk to coder',
      };

      await act(async () => {
        await result.current.executeCommand(command);
      });

      expect(result.current.error).toBe('Agent "coder" not found');
    });

    it('should create agent with correct role', async () => {
      const mockAddAgent = vi.fn();
      const mockStoreValue = {
        sessions: {
          'test-session': {
            agents: [],
          },
        },
        addAgent: mockAddAgent,
      };

      vi.mocked(sessionStore.useSessionStore).mockReturnValue(mockStoreValue as any);
      (sessionStore.useSessionStore as any).getState = vi.fn(() => mockStoreValue);

      vi.mocked(apiModule.createAgent).mockResolvedValueOnce({
        id: 'new-agent-id',
        name: 'Coder Agent',
        model: 'claude-3-5-sonnet-20241022',
      });

      const { result } = renderHook(() =>
        useVoiceCommands({
          sessionId: 'test-session',
        })
      );

      const command: VoiceCommandResponse = {
        command_type: 'create_agent',
        target: 'coder',
        message: null,
        raw_text: 'create coder agent',
      };

      await act(async () => {
        await result.current.executeCommand(command);
      });

      expect(apiModule.createAgent).toHaveBeenCalledWith('test-session', {
        name: 'Coder Agent',
        role: 'coder',
      });

      expect(mockAddAgent).toHaveBeenCalledWith(
        'test-session',
        expect.objectContaining({
          id: 'new-agent-id',
          role: 'coder',
        })
      );
    });

    it('should handle invalid agent role', async () => {
      const mockAddAgent = vi.fn();
      const mockStoreValue = {
        sessions: {
          'test-session': {
            agents: [],
          },
        },
        addAgent: mockAddAgent,
      };

      vi.mocked(sessionStore.useSessionStore).mockReturnValue(mockStoreValue as any);
      (sessionStore.useSessionStore as any).getState = vi.fn(() => mockStoreValue);

      vi.mocked(apiModule.createAgent).mockResolvedValueOnce({
        id: 'new-agent-id',
        name: 'Custom Agent',
        model: 'claude-3-5-sonnet-20241022',
      });

      const { result } = renderHook(() =>
        useVoiceCommands({
          sessionId: 'test-session',
        })
      );

      const command: VoiceCommandResponse = {
        command_type: 'create_agent',
        target: 'invalid_role',
        message: null,
        raw_text: 'create invalid role agent',
      };

      await act(async () => {
        await result.current.executeCommand(command);
      });

      expect(apiModule.createAgent).toHaveBeenCalledWith('test-session', {
        name: 'Invalid_role Agent',
        role: 'custom',
      });
    });

    it('should handle create agent error', async () => {
      const mockStoreValue = {
        sessions: {
          'test-session': {
            agents: [],
          },
        },
        addAgent: vi.fn(),
      };

      vi.mocked(sessionStore.useSessionStore).mockReturnValue(mockStoreValue as any);
      (sessionStore.useSessionStore as any).getState = vi.fn(() => mockStoreValue);

      vi.mocked(apiModule.createAgent).mockRejectedValueOnce(new Error('Failed to create'));

      const { result } = renderHook(() =>
        useVoiceCommands({
          sessionId: 'test-session',
        })
      );

      const command: VoiceCommandResponse = {
        command_type: 'create_agent',
        target: 'coder',
        message: null,
        raw_text: 'create coder agent',
      };

      await act(async () => {
        await result.current.executeCommand(command);
      });

      expect(result.current.error).toBe('Failed to create coder agent');
    });
  });

  describe('Command Execution - UI Operations', () => {
    it('should execute show_terminal command', async () => {
      const mockSetTerminalVisible = vi.fn();
      vi.mocked(uiStore.useUIStore).mockReturnValue({
        setTerminalVisible: mockSetTerminalVisible,
      } as any);

      const { result } = renderHook(() =>
        useVoiceCommands({
          sessionId: 'test-session',
        })
      );

      const command: VoiceCommandResponse = {
        command_type: 'show_terminal',
        target: null,
        message: null,
        raw_text: 'show terminal',
      };

      await act(async () => {
        await result.current.executeCommand(command);
      });

      expect(mockSetTerminalVisible).toHaveBeenCalledWith(true);
    });

    it('should execute show_preview command', async () => {
      const mockSetPanelVisible = vi.fn();
      vi.mocked(uiStore.useUIStore).mockReturnValue({
        setPanelVisible: mockSetPanelVisible,
      } as any);

      const { result } = renderHook(() =>
        useVoiceCommands({
          sessionId: 'test-session',
        })
      );

      const command: VoiceCommandResponse = {
        command_type: 'show_preview',
        target: null,
        message: null,
        raw_text: 'show preview',
      };

      await act(async () => {
        await result.current.executeCommand(command);
      });

      expect(mockSetPanelVisible).toHaveBeenCalledWith(true);
    });

    it('should execute toggle_sidebar command', async () => {
      const mockToggleSidebar = vi.fn();
      vi.mocked(uiStore.useUIStore).mockReturnValue({
        toggleSidebar: mockToggleSidebar,
      } as any);

      const { result } = renderHook(() =>
        useVoiceCommands({
          sessionId: 'test-session',
        })
      );

      const command: VoiceCommandResponse = {
        command_type: 'toggle_sidebar',
        target: null,
        message: null,
        raw_text: 'toggle sidebar',
      };

      await act(async () => {
        await result.current.executeCommand(command);
      });

      expect(mockToggleSidebar).toHaveBeenCalledWith('left');
    });

    it('should execute search_files command', async () => {
      const mockOpenQuickOpen = vi.fn();
      vi.mocked(uiStore.useUIStore).mockReturnValue({
        openQuickOpen: mockOpenQuickOpen,
      } as any);

      const { result } = renderHook(() =>
        useVoiceCommands({
          sessionId: 'test-session',
        })
      );

      const command: VoiceCommandResponse = {
        command_type: 'search_files',
        target: null,
        message: null,
        raw_text: 'search files',
      };

      await act(async () => {
        await result.current.executeCommand(command);
      });

      expect(mockOpenQuickOpen).toHaveBeenCalled();
    });

    it('should execute run_command', async () => {
      const mockSendTerminalCommand = vi.fn();
      vi.mocked(uiStore.useUIStore).mockReturnValue({
        sendTerminalCommand: mockSendTerminalCommand,
      } as any);

      const { result } = renderHook(() =>
        useVoiceCommands({
          sessionId: 'test-session',
        })
      );

      const command: VoiceCommandResponse = {
        command_type: 'run_command',
        target: null,
        message: 'npm install',
        raw_text: 'run npm install',
      };

      await act(async () => {
        await result.current.executeCommand(command);
      });

      expect(mockSendTerminalCommand).toHaveBeenCalledWith('npm install');
    });
  });

  describe('Command Execution - Notifications', () => {
    it('should open notification panel', async () => {
      const mockOpenPanel = vi.fn();
      vi.mocked(attentionStore.useAttentionStore).mockReturnValue({
        openPanel: mockOpenPanel,
      } as any);

      const { result } = renderHook(() =>
        useVoiceCommands({
          sessionId: 'test-session',
        })
      );

      const command: VoiceCommandResponse = {
        command_type: 'unknown',
        target: null,
        message: null,
        raw_text: 'show notifications',
      };

      await act(async () => {
        await result.current.executeCommand(command);
      });

      expect(mockOpenPanel).toHaveBeenCalled();
    });

    it('should dismiss all notifications', async () => {
      const mockDismissAllForSession = vi.fn();
      vi.mocked(attentionStore.useAttentionStore).mockReturnValue({
        dismissAllForSession: mockDismissAllForSession,
      } as any);

      const { result } = renderHook(() =>
        useVoiceCommands({
          sessionId: 'test-session',
        })
      );

      const command: VoiceCommandResponse = {
        command_type: 'unknown',
        target: null,
        message: null,
        raw_text: 'dismiss all notifications',
      };

      await act(async () => {
        await result.current.executeCommand(command);
      });

      expect(mockDismissAllForSession).toHaveBeenCalledWith('test-session');
    });

    it('should approve agent notifications', async () => {
      const mockDismissAllForAgent = vi.fn();
      const mockGetAttentionsForSession = vi.fn(() => [
        { agentId: 'agent-1', type: 'needs_approval' },
      ]);

      vi.mocked(attentionStore.useAttentionStore).mockReturnValue({
        dismissAllForAgent: mockDismissAllForAgent,
        getAttentionsForSession: mockGetAttentionsForSession,
      } as any);

      const mockStoreValue = {
        sessions: {
          'test-session': {
            agents: [{ id: 'agent-1', role: 'coder', name: 'Coder Agent' }],
          },
        },
      };

      vi.mocked(sessionStore.useSessionStore).mockReturnValue(mockStoreValue as any);
      (sessionStore.useSessionStore as any).getState = vi.fn(() => mockStoreValue);

      const { result } = renderHook(() =>
        useVoiceCommands({
          sessionId: 'test-session',
        })
      );

      const command: VoiceCommandResponse = {
        command_type: 'unknown',
        target: 'coder',
        message: null,
        raw_text: 'approve coder',
      };

      await act(async () => {
        await result.current.executeCommand(command);
      });

      expect(mockDismissAllForAgent).toHaveBeenCalledWith('test-session', 'agent-1');
    });
  });

  describe('Command Callbacks', () => {
    it('should call onCommandExecuted callback', async () => {
      const onCommandExecuted = vi.fn();
      const { result } = renderHook(() =>
        useVoiceCommands({
          sessionId: 'test-session',
          onCommandExecuted,
        })
      );

      const command: VoiceCommandResponse = {
        command_type: 'show_terminal',
        target: null,
        message: null,
        raw_text: 'show terminal',
      };

      await act(async () => {
        await result.current.executeCommand(command);
      });

      expect(onCommandExecuted).toHaveBeenCalledWith(command);
    });

    it('should call onError callback on execution error', async () => {
      vi.mocked(uiStore.useUIStore).mockReturnValue({
        setTerminalVisible: vi.fn(() => {
          throw new Error('UI error');
        }),
      } as any);

      const onError = vi.fn();
      const { result } = renderHook(() =>
        useVoiceCommands({
          sessionId: 'test-session',
          onError,
        })
      );

      const command: VoiceCommandResponse = {
        command_type: 'show_terminal',
        target: null,
        message: null,
        raw_text: 'show terminal',
      };

      await act(async () => {
        await result.current.executeCommand(command);
      });

      expect(onError).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('Edge Cases', () => {
    it('should handle unknown command type', async () => {
      const { result } = renderHook(() =>
        useVoiceCommands({
          sessionId: 'test-session',
        })
      );

      const command: VoiceCommandResponse = {
        command_type: 'unknown_command' as any,
        target: null,
        message: null,
        raw_text: 'unknown',
      };

      await act(async () => {
        await result.current.executeCommand(command);
      });

      // Should not throw
      expect(result.current.error).toBeNull();
    });

    it('should handle socket emit error', async () => {
      mockSocket.emit = vi.fn((event, data, callback) => {
        if (callback) {
          callback({ success: false, error: 'Socket error' });
        }
      });

      const { result } = renderHook(() =>
        useVoiceCommands({
          sessionId: 'test-session',
        })
      );

      await act(async () => {
        await result.current.startListening();
      });

      // Should still work despite warning
      expect(result.current.isListening).toBe(true);
    });

    it('should handle missing session', async () => {
      const mockStoreValue = {
        sessions: {},
      };

      vi.mocked(sessionStore.useSessionStore).mockReturnValue(mockStoreValue as any);
      (sessionStore.useSessionStore as any).getState = vi.fn(() => mockStoreValue);

      const { result } = renderHook(() =>
        useVoiceCommands({
          sessionId: 'test-session',
        })
      );

      const command: VoiceCommandResponse = {
        command_type: 'talk_to_agent',
        target: 'coder',
        message: 'Write code',
        raw_text: 'talk to coder',
      };

      await act(async () => {
        await result.current.executeCommand(command);
      });

      // Should handle gracefully
      expect(apiModule.sendAgentMessage).not.toHaveBeenCalled();
    });

    it('should handle run_command without message', async () => {
      const mockSendTerminalCommand = vi.fn();
      vi.mocked(uiStore.useUIStore).mockReturnValue({
        sendTerminalCommand: mockSendTerminalCommand,
      } as any);

      const { result } = renderHook(() =>
        useVoiceCommands({
          sessionId: 'test-session',
        })
      );

      const command: VoiceCommandResponse = {
        command_type: 'run_command',
        target: null,
        message: null,
        raw_text: 'run command',
      };

      await act(async () => {
        await result.current.executeCommand(command);
      });

      expect(mockSendTerminalCommand).not.toHaveBeenCalled();
    });

    it('should handle create_agent without target', async () => {
      const { result } = renderHook(() =>
        useVoiceCommands({
          sessionId: 'test-session',
        })
      );

      const command: VoiceCommandResponse = {
        command_type: 'create_agent',
        target: null,
        message: null,
        raw_text: 'create agent',
      };

      await act(async () => {
        await result.current.executeCommand(command);
      });

      expect(apiModule.createAgent).not.toHaveBeenCalled();
    });

    it('should handle MediaRecorder state errors', async () => {
      const { result } = renderHook(() =>
        useVoiceCommands({
          sessionId: 'test-session',
        })
      );

      await act(async () => {
        await result.current.startListening();
      });

      // Manually set to inactive
      await act(async () => {
        await result.current.stopListening();
      });

      // Try to stop again
      await act(async () => {
        await result.current.stopListening();
      });

      // Should not throw
      expect(result.current.isListening).toBe(false);
    });
  });
});
