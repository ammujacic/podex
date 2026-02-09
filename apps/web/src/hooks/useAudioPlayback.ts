import { useCallback, useRef, useEffect } from 'react';
import { useVoiceStore } from '@/stores/voice';
import { getSocket } from '@/lib/socket';

interface UseAudioPlaybackOptions {
  sessionId: string;
  onPlayStart?: (messageId: string) => void;
  onPlayEnd?: (messageId: string) => void;
  onError?: (error: Error) => void;
}

// Tiny silent MP3 (generates ~0.1s of silence) - used to unlock audio on mobile
const SILENT_MP3_BASE64 =
  'SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7v////////////////////////////////AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7v////////////////////////////////AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7v////////////////////////////////AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';

export function useAudioPlayback({
  sessionId,
  onPlayStart,
  onPlayEnd,
  onError,
}: UseAudioPlaybackOptions) {
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const currentMessageIdRef = useRef<string | null>(null);
  const isUnlockedRef = useRef<boolean>(false);

  const {
    isPlaying,
    playingMessageId,
    audioQueue,
    setPlaying,
    addToQueue,
    removeFromQueue,
    clearQueue,
  } = useVoiceStore();

  // Initialize audio element
  useEffect(() => {
    if (!audioElementRef.current) {
      audioElementRef.current = new Audio();
      audioElementRef.current.onended = () => {
        const messageId = currentMessageIdRef.current;
        if (messageId) {
          onPlayEnd?.(messageId);
          currentMessageIdRef.current = null;
        }
        setPlaying(null);

        // Play next in queue
        const nextId = audioQueue[0];
        if (nextId) {
          removeFromQueue(nextId);
          // Note: Caller needs to trigger playback for the next item
        }
      };
      audioElementRef.current.onerror = () => {
        onError?.(new Error('Audio playback failed'));
        setPlaying(null);
      };
    }

    return () => {
      if (audioElementRef.current) {
        audioElementRef.current.pause();
        audioElementRef.current = null;
      }
    };
  }, [audioQueue, removeFromQueue, setPlaying, onPlayEnd, onError]);

  // Unlock audio on mobile - must be called synchronously during user gesture
  // This plays a tiny silent audio to satisfy mobile autoplay policies
  const unlockAudio = useCallback(() => {
    if (isUnlockedRef.current) return;

    const audio = audioElementRef.current;
    if (!audio) return;

    try {
      // Create a blob URL from the silent MP3
      const binaryString = atob(SILENT_MP3_BASE64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: 'audio/mpeg' });
      const url = URL.createObjectURL(blob);

      // Play silent audio to unlock
      audio.src = url;
      audio.volume = 0;
      const playPromise = audio.play();

      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            isUnlockedRef.current = true;
            audio.pause();
            audio.currentTime = 0;
            audio.volume = 1;
            URL.revokeObjectURL(url);
          })
          .catch(() => {
            // Unlock failed, but we'll try again on actual playback
            URL.revokeObjectURL(url);
          });
      }
    } catch {
      // Ignore unlock errors - actual playback will handle them
    }
  }, []);

  // Play audio from URL
  const playAudioUrl = useCallback(
    async (messageId: string, audioUrl: string) => {
      try {
        const audio = audioElementRef.current;
        if (!audio) return;

        // Stop current playback
        audio.pause();
        audio.currentTime = 0;

        currentMessageIdRef.current = messageId;

        // Wait for audio to be ready before playing
        await new Promise<void>((resolve, reject) => {
          const handleCanPlay = () => {
            audio.removeEventListener('canplaythrough', handleCanPlay);
            audio.removeEventListener('error', handleError);
            resolve();
          };
          const handleError = () => {
            audio.removeEventListener('canplaythrough', handleCanPlay);
            audio.removeEventListener('error', handleError);
            reject(new Error('Failed to load audio'));
          };
          audio.addEventListener('canplaythrough', handleCanPlay);
          audio.addEventListener('error', handleError);
          audio.src = audioUrl;
          audio.load();
        });

        setPlaying(messageId);
        onPlayStart?.(messageId);

        await audio.play();
      } catch (error) {
        // Ignore AbortError - it's expected when switching tracks
        if (error instanceof Error && error.name === 'AbortError') {
          return;
        }
        console.error('Failed to play audio:', error);
        onError?.(error as Error);
        setPlaying(null);
      }
    },
    [setPlaying, onPlayStart, onError]
  );

  // Play audio from base64
  const playAudioBase64 = useCallback(
    async (messageId: string, audioBase64: string, contentType: string = 'audio/mpeg') => {
      try {
        const audio = audioElementRef.current;
        if (!audio) return;

        // Stop current playback
        audio.pause();
        audio.currentTime = 0;

        // Create blob URL from base64
        const binaryString = atob(audioBase64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: contentType });
        const url = URL.createObjectURL(blob);

        currentMessageIdRef.current = messageId;

        // Clean up blob URL when done
        audio.onended = () => {
          URL.revokeObjectURL(url);
          const msgId = currentMessageIdRef.current;
          if (msgId) {
            onPlayEnd?.(msgId);
            currentMessageIdRef.current = null;
          }
          setPlaying(null);
        };

        // Wait for audio to be ready before playing
        await new Promise<void>((resolve, reject) => {
          const handleCanPlay = () => {
            audio.removeEventListener('canplaythrough', handleCanPlay);
            audio.removeEventListener('error', handleError);
            resolve();
          };
          const handleError = () => {
            audio.removeEventListener('canplaythrough', handleCanPlay);
            audio.removeEventListener('error', handleError);
            reject(new Error('Failed to load audio'));
          };
          audio.addEventListener('canplaythrough', handleCanPlay);
          audio.addEventListener('error', handleError);
          audio.src = url;
          audio.load();
        });

        setPlaying(messageId);
        onPlayStart?.(messageId);

        await audio.play();
      } catch (error) {
        // Ignore AbortError - it's expected when switching tracks
        if (error instanceof Error && error.name === 'AbortError') {
          return;
        }
        console.error('Failed to play audio:', error);
        onError?.(error as Error);
        setPlaying(null);
      }
    },
    [setPlaying, onPlayStart, onPlayEnd, onError]
  );

  // Stop current playback
  const stopPlayback = useCallback(() => {
    const audio = audioElementRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    currentMessageIdRef.current = null;
    setPlaying(null);
  }, [setPlaying]);

  // Pause current playback
  const pausePlayback = useCallback(() => {
    const audio = audioElementRef.current;
    if (audio) {
      audio.pause();
    }
  }, []);

  // Resume playback
  const resumePlayback = useCallback(async () => {
    try {
      const audio = audioElementRef.current;
      if (audio && audio.paused) {
        await audio.play();
      }
    } catch (error) {
      // Ignore AbortError
      if (error instanceof Error && error.name === 'AbortError') {
        return;
      }
      throw error;
    }
  }, []);

  // Listen for TTS ready events
  useEffect(() => {
    const socket = getSocket();

    const handleTTSReady = (data: {
      session_id: string;
      message_id: string;
      audio_url: string;
      duration_ms: number;
    }) => {
      if (data.session_id !== sessionId) return;

      // Auto-play if this message is in the queue
      if (audioQueue.includes(data.message_id)) {
        removeFromQueue(data.message_id);
        playAudioUrl(data.message_id, data.audio_url);
      }
    };

    socket.on('tts_audio_ready', handleTTSReady);

    return () => {
      socket.off('tts_audio_ready', handleTTSReady);
    };
  }, [sessionId, audioQueue, removeFromQueue, playAudioUrl]);

  return {
    isPlaying,
    playingMessageId,
    playAudioUrl,
    playAudioBase64,
    stopPlayback,
    pausePlayback,
    resumePlayback,
    addToQueue,
    clearQueue,
    unlockAudio,
  };
}
