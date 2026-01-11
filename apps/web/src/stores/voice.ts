import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

export interface VoiceConfig {
  ttsEnabled: boolean;
  autoPlay: boolean;
  voiceId: string | null;
  speed: number;
  language: string;
}

interface VoiceState {
  // Recording state
  isRecording: boolean;
  recordingAgentId: string | null;
  isTranscribing: boolean;
  currentTranscript: string;
  transcriptConfidence: number;

  // Playback state
  isPlaying: boolean;
  playingMessageId: string | null;
  audioQueue: string[]; // Message IDs queued for playback

  // Per-agent voice configs (cached)
  agentConfigs: Record<string, VoiceConfig>;

  // Recording actions
  startRecording: (agentId: string) => void;
  stopRecording: () => void;
  setTranscript: (text: string, confidence: number, isFinal: boolean) => void;
  clearTranscript: () => void;

  // Playback actions
  setPlaying: (messageId: string | null) => void;
  addToQueue: (messageId: string) => void;
  removeFromQueue: (messageId: string) => void;
  clearQueue: () => void;

  // Config actions
  setAgentConfig: (agentId: string, config: VoiceConfig) => void;
  getAgentConfig: (agentId: string) => VoiceConfig | undefined;
}

export const useVoiceStore = create<VoiceState>()(
  devtools(
    (set, get) => ({
      // Initial state
      isRecording: false,
      recordingAgentId: null,
      isTranscribing: false,
      currentTranscript: '',
      transcriptConfidence: 0,
      isPlaying: false,
      playingMessageId: null,
      audioQueue: [],
      agentConfigs: {},

      // Recording actions
      startRecording: (agentId: string) =>
        set({
          isRecording: true,
          recordingAgentId: agentId,
          currentTranscript: '',
          transcriptConfidence: 0,
        }),

      stopRecording: () =>
        set({
          isRecording: false,
          isTranscribing: true,
        }),

      setTranscript: (text: string, confidence: number, isFinal: boolean) =>
        set({
          currentTranscript: text,
          transcriptConfidence: confidence,
          isTranscribing: !isFinal,
        }),

      clearTranscript: () =>
        set({
          currentTranscript: '',
          transcriptConfidence: 0,
          isTranscribing: false,
          recordingAgentId: null,
        }),

      // Playback actions
      setPlaying: (messageId: string | null) =>
        set({
          isPlaying: messageId !== null,
          playingMessageId: messageId,
        }),

      addToQueue: (messageId: string) =>
        set((state) => ({
          audioQueue: [...state.audioQueue, messageId],
        })),

      removeFromQueue: (messageId: string) =>
        set((state) => ({
          audioQueue: state.audioQueue.filter((id) => id !== messageId),
        })),

      clearQueue: () => set({ audioQueue: [] }),

      // Config actions
      setAgentConfig: (agentId: string, config: VoiceConfig) =>
        set((state) => ({
          agentConfigs: {
            ...state.agentConfigs,
            [agentId]: config,
          },
        })),

      getAgentConfig: (agentId: string) => get().agentConfigs[agentId],
    }),
    { name: 'voice-store' }
  )
);
