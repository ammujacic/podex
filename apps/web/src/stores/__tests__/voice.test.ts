import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useVoiceStore, type VoiceConfig } from '../voice';

describe('voiceStore', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    act(() => {
      useVoiceStore.setState({
        isRecording: false,
        recordingAgentId: null,
        isTranscribing: false,
        currentTranscript: '',
        transcriptConfidence: 0,
        isPlaying: false,
        playingMessageId: null,
        audioQueue: [],
        agentConfigs: {},
      });
    });
  });

  // ========================================================================
  // Initial State
  // ========================================================================

  describe('Initial State', () => {
    it('has no active recording', () => {
      const { result } = renderHook(() => useVoiceStore());
      expect(result.current.isRecording).toBe(false);
      expect(result.current.recordingAgentId).toBeNull();
    });

    it('has no transcription in progress', () => {
      const { result } = renderHook(() => useVoiceStore());
      expect(result.current.isTranscribing).toBe(false);
      expect(result.current.currentTranscript).toBe('');
      expect(result.current.transcriptConfidence).toBe(0);
    });

    it('has no playback active', () => {
      const { result } = renderHook(() => useVoiceStore());
      expect(result.current.isPlaying).toBe(false);
      expect(result.current.playingMessageId).toBeNull();
    });

    it('has empty audio queue', () => {
      const { result } = renderHook(() => useVoiceStore());
      expect(result.current.audioQueue).toEqual([]);
    });

    it('has no agent configs', () => {
      const { result } = renderHook(() => useVoiceStore());
      expect(result.current.agentConfigs).toEqual({});
    });
  });

  // ========================================================================
  // Recording Actions
  // ========================================================================

  describe('Recording Management', () => {
    describe('startRecording', () => {
      it('starts recording for agent', () => {
        const { result } = renderHook(() => useVoiceStore());

        act(() => {
          result.current.startRecording('agent-1');
        });

        expect(result.current.isRecording).toBe(true);
        expect(result.current.recordingAgentId).toBe('agent-1');
      });

      it('clears transcript when starting new recording', () => {
        const { result } = renderHook(() => useVoiceStore());

        act(() => {
          result.current.setTranscript('old text', 0.9, false);
          result.current.startRecording('agent-1');
        });

        expect(result.current.currentTranscript).toBe('');
        expect(result.current.transcriptConfidence).toBe(0);
      });

      it('can switch recording between agents', () => {
        const { result } = renderHook(() => useVoiceStore());

        act(() => {
          result.current.startRecording('agent-1');
        });

        expect(result.current.recordingAgentId).toBe('agent-1');

        act(() => {
          result.current.startRecording('agent-2');
        });

        expect(result.current.recordingAgentId).toBe('agent-2');
      });
    });

    describe('stopRecording', () => {
      it('stops recording and starts transcribing', () => {
        const { result } = renderHook(() => useVoiceStore());

        act(() => {
          result.current.startRecording('agent-1');
          result.current.stopRecording();
        });

        expect(result.current.isRecording).toBe(false);
        expect(result.current.isTranscribing).toBe(true);
      });

      it('keeps recordingAgentId when transcribing', () => {
        const { result } = renderHook(() => useVoiceStore());

        act(() => {
          result.current.startRecording('agent-1');
          result.current.stopRecording();
        });

        expect(result.current.recordingAgentId).toBe('agent-1');
      });
    });

    describe('setTranscript', () => {
      it('sets interim transcript', () => {
        const { result } = renderHook(() => useVoiceStore());

        act(() => {
          result.current.setTranscript('Hello world', 0.85, false);
        });

        expect(result.current.currentTranscript).toBe('Hello world');
        expect(result.current.transcriptConfidence).toBe(0.85);
        expect(result.current.isTranscribing).toBe(true);
      });

      it('sets final transcript and stops transcribing', () => {
        const { result } = renderHook(() => useVoiceStore());

        act(() => {
          result.current.setTranscript('Final text', 0.95, true);
        });

        expect(result.current.currentTranscript).toBe('Final text');
        expect(result.current.transcriptConfidence).toBe(0.95);
        expect(result.current.isTranscribing).toBe(false);
      });

      it('updates transcript multiple times', () => {
        const { result } = renderHook(() => useVoiceStore());

        act(() => {
          result.current.setTranscript('Hello', 0.7, false);
        });
        expect(result.current.currentTranscript).toBe('Hello');

        act(() => {
          result.current.setTranscript('Hello world', 0.85, false);
        });
        expect(result.current.currentTranscript).toBe('Hello world');

        act(() => {
          result.current.setTranscript('Hello world!', 0.95, true);
        });
        expect(result.current.currentTranscript).toBe('Hello world!');
        expect(result.current.isTranscribing).toBe(false);
      });
    });

    describe('clearTranscript', () => {
      it('clears all transcript state', () => {
        const { result } = renderHook(() => useVoiceStore());

        act(() => {
          result.current.startRecording('agent-1');
          result.current.setTranscript('Some text', 0.9, false);
          result.current.clearTranscript();
        });

        expect(result.current.currentTranscript).toBe('');
        expect(result.current.transcriptConfidence).toBe(0);
        expect(result.current.isTranscribing).toBe(false);
        expect(result.current.recordingAgentId).toBeNull();
      });
    });
  });

  // ========================================================================
  // Playback Actions
  // ========================================================================

  describe('Playback Management', () => {
    describe('setPlaying', () => {
      it('starts playing message', () => {
        const { result } = renderHook(() => useVoiceStore());

        act(() => {
          result.current.setPlaying('msg-1');
        });

        expect(result.current.isPlaying).toBe(true);
        expect(result.current.playingMessageId).toBe('msg-1');
      });

      it('stops playing when set to null', () => {
        const { result } = renderHook(() => useVoiceStore());

        act(() => {
          result.current.setPlaying('msg-1');
          result.current.setPlaying(null);
        });

        expect(result.current.isPlaying).toBe(false);
        expect(result.current.playingMessageId).toBeNull();
      });

      it('can switch between messages', () => {
        const { result } = renderHook(() => useVoiceStore());

        act(() => {
          result.current.setPlaying('msg-1');
        });
        expect(result.current.playingMessageId).toBe('msg-1');

        act(() => {
          result.current.setPlaying('msg-2');
        });
        expect(result.current.playingMessageId).toBe('msg-2');
      });
    });

    describe('addToQueue', () => {
      it('adds message to queue', () => {
        const { result } = renderHook(() => useVoiceStore());

        act(() => {
          result.current.addToQueue('msg-1');
        });

        expect(result.current.audioQueue).toContain('msg-1');
      });

      it('adds multiple messages to queue', () => {
        const { result } = renderHook(() => useVoiceStore());

        act(() => {
          result.current.addToQueue('msg-1');
          result.current.addToQueue('msg-2');
          result.current.addToQueue('msg-3');
        });

        expect(result.current.audioQueue).toEqual(['msg-1', 'msg-2', 'msg-3']);
      });

      it('maintains queue order', () => {
        const { result } = renderHook(() => useVoiceStore());

        act(() => {
          result.current.addToQueue('first');
          result.current.addToQueue('second');
          result.current.addToQueue('third');
        });

        expect(result.current.audioQueue[0]).toBe('first');
        expect(result.current.audioQueue[1]).toBe('second');
        expect(result.current.audioQueue[2]).toBe('third');
      });
    });

    describe('removeFromQueue', () => {
      it('removes specific message from queue', () => {
        const { result } = renderHook(() => useVoiceStore());

        act(() => {
          result.current.addToQueue('msg-1');
          result.current.addToQueue('msg-2');
          result.current.addToQueue('msg-3');
          result.current.removeFromQueue('msg-2');
        });

        expect(result.current.audioQueue).toEqual(['msg-1', 'msg-3']);
      });

      it('handles removing non-existent message gracefully', () => {
        const { result } = renderHook(() => useVoiceStore());

        act(() => {
          result.current.addToQueue('msg-1');
        });

        expect(() => {
          act(() => {
            result.current.removeFromQueue('msg-999');
          });
        }).not.toThrow();

        expect(result.current.audioQueue).toEqual(['msg-1']);
      });

      it('can remove all messages individually', () => {
        const { result } = renderHook(() => useVoiceStore());

        act(() => {
          result.current.addToQueue('msg-1');
          result.current.addToQueue('msg-2');
          result.current.removeFromQueue('msg-1');
          result.current.removeFromQueue('msg-2');
        });

        expect(result.current.audioQueue).toEqual([]);
      });
    });

    describe('clearQueue', () => {
      it('clears entire queue', () => {
        const { result } = renderHook(() => useVoiceStore());

        act(() => {
          result.current.addToQueue('msg-1');
          result.current.addToQueue('msg-2');
          result.current.addToQueue('msg-3');
          result.current.clearQueue();
        });

        expect(result.current.audioQueue).toEqual([]);
      });

      it('handles clearing empty queue', () => {
        const { result } = renderHook(() => useVoiceStore());

        expect(() => {
          act(() => {
            result.current.clearQueue();
          });
        }).not.toThrow();

        expect(result.current.audioQueue).toEqual([]);
      });
    });
  });

  // ========================================================================
  // Agent Config
  // ========================================================================

  describe('Agent Configuration', () => {
    const mockConfig: VoiceConfig = {
      ttsEnabled: true,
      autoPlay: true,
      voiceId: 'voice-1',
      speed: 1.0,
      language: 'en-US',
    };

    describe('setAgentConfig', () => {
      it('sets config for agent', () => {
        const { result } = renderHook(() => useVoiceStore());

        act(() => {
          result.current.setAgentConfig('agent-1', mockConfig);
        });

        const config = result.current.getAgentConfig('agent-1');
        expect(config).toEqual(mockConfig);
      });

      it('can set configs for multiple agents', () => {
        const { result } = renderHook(() => useVoiceStore());
        const config2: VoiceConfig = {
          ...mockConfig,
          voiceId: 'voice-2',
          speed: 1.2,
        };

        act(() => {
          result.current.setAgentConfig('agent-1', mockConfig);
          result.current.setAgentConfig('agent-2', config2);
        });

        expect(result.current.getAgentConfig('agent-1')).toEqual(mockConfig);
        expect(result.current.getAgentConfig('agent-2')).toEqual(config2);
      });

      it('updates existing agent config', () => {
        const { result } = renderHook(() => useVoiceStore());
        const updatedConfig: VoiceConfig = {
          ...mockConfig,
          speed: 1.5,
          autoPlay: false,
        };

        act(() => {
          result.current.setAgentConfig('agent-1', mockConfig);
          result.current.setAgentConfig('agent-1', updatedConfig);
        });

        const config = result.current.getAgentConfig('agent-1');
        expect(config?.speed).toBe(1.5);
        expect(config?.autoPlay).toBe(false);
      });

      it('does not affect other agent configs', () => {
        const { result } = renderHook(() => useVoiceStore());
        const config2: VoiceConfig = { ...mockConfig, voiceId: 'voice-2' };

        act(() => {
          result.current.setAgentConfig('agent-1', mockConfig);
          result.current.setAgentConfig('agent-2', config2);
          result.current.setAgentConfig('agent-1', { ...mockConfig, speed: 2.0 });
        });

        const agent2Config = result.current.getAgentConfig('agent-2');
        expect(agent2Config?.speed).toBe(1.0); // Unchanged
      });
    });

    describe('getAgentConfig', () => {
      it('returns undefined for non-existent agent', () => {
        const { result } = renderHook(() => useVoiceStore());

        const config = result.current.getAgentConfig('non-existent');
        expect(config).toBeUndefined();
      });

      it('returns correct config for agent', () => {
        const { result } = renderHook(() => useVoiceStore());

        act(() => {
          result.current.setAgentConfig('agent-1', mockConfig);
        });

        const config = result.current.getAgentConfig('agent-1');
        expect(config).toEqual(mockConfig);
      });
    });
  });

  // ========================================================================
  // Voice Commands Integration
  // ========================================================================

  describe('Voice Commands Workflow', () => {
    it('handles complete voice input workflow', () => {
      const { result } = renderHook(() => useVoiceStore());

      // Start recording
      act(() => {
        result.current.startRecording('agent-1');
      });
      expect(result.current.isRecording).toBe(true);

      // Update transcript as user speaks
      act(() => {
        result.current.setTranscript('Create', 0.7, false);
      });
      expect(result.current.currentTranscript).toBe('Create');

      act(() => {
        result.current.setTranscript('Create a new', 0.8, false);
      });
      expect(result.current.currentTranscript).toBe('Create a new');

      // Stop recording
      act(() => {
        result.current.stopRecording();
      });
      expect(result.current.isRecording).toBe(false);
      expect(result.current.isTranscribing).toBe(true);

      // Finalize transcript
      act(() => {
        result.current.setTranscript('Create a new component', 0.95, true);
      });
      expect(result.current.isTranscribing).toBe(false);
      expect(result.current.currentTranscript).toBe('Create a new component');

      // Clear after use
      act(() => {
        result.current.clearTranscript();
      });
      expect(result.current.currentTranscript).toBe('');
    });

    it('handles playback queue workflow', () => {
      const { result } = renderHook(() => useVoiceStore());

      // Add messages to queue
      act(() => {
        result.current.addToQueue('msg-1');
        result.current.addToQueue('msg-2');
        result.current.addToQueue('msg-3');
      });
      expect(result.current.audioQueue).toHaveLength(3);

      // Start playing first message
      act(() => {
        result.current.setPlaying('msg-1');
      });
      expect(result.current.isPlaying).toBe(true);

      // Remove from queue when done
      act(() => {
        result.current.removeFromQueue('msg-1');
        result.current.setPlaying('msg-2');
      });
      expect(result.current.audioQueue).toHaveLength(2);
      expect(result.current.playingMessageId).toBe('msg-2');

      // Clear remaining queue
      act(() => {
        result.current.setPlaying(null);
        result.current.clearQueue();
      });
      expect(result.current.audioQueue).toHaveLength(0);
      expect(result.current.isPlaying).toBe(false);
    });
  });
});
