import { useCallback, useRef, useEffect } from 'react';
import { useVoiceStore } from '@/stores/voice';
import { getSocket } from '@/lib/socket';

interface UseVoiceCaptureOptions {
  sessionId: string;
  agentId: string;
  language?: string;
  onTranscript?: (text: string, isFinal: boolean) => void;
  onError?: (error: Error) => void;
}

export function useVoiceCapture({
  sessionId,
  agentId,
  language = 'en-US',
  onTranscript,
  onError,
}: UseVoiceCaptureOptions) {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const {
    isRecording,
    recordingAgentId,
    isTranscribing,
    currentTranscript,
    startRecording: setRecordingStart,
    stopRecording: setRecordingStop,
    setTranscript,
    clearTranscript,
  } = useVoiceStore();

  // Check if this agent is currently recording
  const isThisAgentRecording = isRecording && recordingAgentId === agentId;

  // Start recording
  const startRecording = useCallback(async () => {
    try {
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

      // Notify backend of stream start
      const socket = getSocket();
      socket.emit('voice_stream_start', {
        session_id: sessionId,
        agent_id: agentId,
        language,
      });

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
      setRecordingStart(agentId);
    } catch (error) {
      console.error('Failed to start recording:', error);
      onError?.(error as Error);
    }
  }, [sessionId, agentId, language, setRecordingStart, onError]);

  // Stop recording
  const stopRecording = useCallback(async (): Promise<Blob | null> => {
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
    socket.emit('voice_stream_end', {
      session_id: sessionId,
    });

    setRecordingStop();

    // Combine chunks and return full audio
    if (chunksRef.current.length > 0) {
      const audioBlob = new Blob(chunksRef.current, { type: 'audio/webm' });
      chunksRef.current = [];
      return audioBlob;
    }

    return null;
  }, [sessionId, setRecordingStop]);

  // Cancel recording without processing
  const cancelRecording = useCallback(() => {
    const mediaRecorder = mediaRecorderRef.current;
    const stream = streamRef.current;

    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }

    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }

    // Update store to reflect recording stopped
    setRecordingStop();
    clearTranscript();
    chunksRef.current = [];
  }, [clearTranscript, setRecordingStop]);

  // Listen for transcription events
  useEffect(() => {
    const socket = getSocket();

    const handleTranscription = (data: {
      session_id: string;
      agent_id: string;
      text: string;
      confidence: number;
      is_final: boolean;
    }) => {
      if (data.session_id === sessionId && data.agent_id === agentId) {
        setTranscript(data.text, data.confidence, data.is_final);
        onTranscript?.(data.text, data.is_final);
      }
    };

    socket.on('voice_transcription', handleTranscription);

    return () => {
      socket.off('voice_transcription', handleTranscription);
    };
  }, [sessionId, agentId, setTranscript, onTranscript]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  return {
    isRecording: isThisAgentRecording,
    isTranscribing,
    currentTranscript,
    startRecording,
    stopRecording,
    cancelRecording,
  };
}
