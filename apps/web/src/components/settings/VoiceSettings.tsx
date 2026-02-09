'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Volume2,
  Mic,
  Play,
  Square,
  RefreshCw,
  RotateCcw,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useVoiceSettingsStore } from '@/stores/voiceSettings';
import { listVoices, synthesizeSpeech, type VoiceInfo } from '@/lib/api';
import { useConfigStore } from '@/stores/config';
import { useSessionStore } from '@/stores/session';

// ============================================================================
// Types
// ============================================================================

interface AudioDevice {
  deviceId: string;
  label: string;
}

// ============================================================================
// Toggle Switch Component
// ============================================================================

interface ToggleSwitchProps {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  disabled?: boolean;
}

function ToggleSwitch({ enabled, onChange, disabled }: ToggleSwitchProps) {
  return (
    <button
      onClick={() => onChange(!enabled)}
      disabled={disabled}
      className={cn(
        'relative h-6 w-11 rounded-full transition-colors',
        enabled ? 'bg-accent-primary' : 'bg-elevated',
        disabled && 'opacity-50 cursor-not-allowed'
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform',
          enabled ? 'left-5' : 'left-0.5'
        )}
      />
    </button>
  );
}

// ============================================================================
// Main Component
// ============================================================================

interface VoiceSettingsProps {
  className?: string;
}

export function VoiceSettings({ className }: VoiceSettingsProps) {
  const {
    tts_enabled,
    voice_id,
    speed,
    auto_play,
    language,
    stt_enabled,
    stt_language,
    stt_input_device_id,
    updateSetting,
    resetToDefaults,
  } = useVoiceSettingsStore();

  // Get languages from config store
  const getVoiceLanguages = useConfigStore((state) => state.getVoiceLanguages);
  const configError = useConfigStore((state) => state.error);
  const configLoading = useConfigStore((state) => state.isLoading);
  const initializeConfig = useConfigStore((state) => state.initialize);

  // Get languages (null if not loaded)
  const languages = useMemo(() => getVoiceLanguages(), [getVoiceLanguages]);

  // Initialize config store on mount
  useEffect(() => {
    initializeConfig();
  }, [initializeConfig]);

  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const [audioDevices, setAudioDevices] = useState<AudioDevice[]>([]);
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [testingTts, setTestingTts] = useState(false);
  const [testingMic, setTestingMic] = useState(false);
  const [micLevel, setMicLevel] = useState(0);

  // Audio element ref for TTS playback
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Get any available session for TTS test (needed for API call)
  const sessions = useSessionStore((state) => state.sessions);
  const firstSessionId = useMemo(() => {
    const sessionIds = Object.keys(sessions);
    return sessionIds.length > 0 ? sessionIds[0] : null;
  }, [sessions]);

  // Load available voices
  const loadVoices = useCallback(async () => {
    setLoadingVoices(true);
    try {
      const availableVoices = await listVoices();
      setVoices(availableVoices);
    } catch (error) {
      console.error('Failed to load voices:', error);
    } finally {
      setLoadingVoices(false);
    }
  }, []);

  // Load audio input devices
  const loadAudioDevices = useCallback(async () => {
    // Check if mediaDevices API is available (requires HTTPS or localhost)
    if (!navigator.mediaDevices?.getUserMedia) {
      console.warn('MediaDevices API not available - requires secure context (HTTPS)');
      return;
    }

    setLoadingDevices(true);
    try {
      // Request microphone permission to get device labels
      await navigator.mediaDevices.getUserMedia({ audio: true });
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices
        .filter((d) => d.kind === 'audioinput')
        .map((d) => ({
          deviceId: d.deviceId,
          label: d.label || `Microphone ${d.deviceId.slice(0, 8)}`,
        }));
      setAudioDevices(audioInputs);
    } catch (error) {
      console.error('Failed to load audio devices:', error);
    } finally {
      setLoadingDevices(false);
    }
  }, []);

  useEffect(() => {
    loadVoices();
    loadAudioDevices();
  }, [loadVoices, loadAudioDevices]);

  // Helper to use browser TTS as fallback
  const playBrowserTts = (testText: string) => {
    const utterance = new SpeechSynthesisUtterance(testText);
    utterance.rate = speed;
    utterance.lang = language;
    utterance.onend = () => setTestingTts(false);
    utterance.onerror = () => setTestingTts(false);
    speechSynthesis.speak(utterance);
  };

  // Test TTS using OpenAI API with selected voice settings
  const testTts = async () => {
    setTestingTts(true);
    const testText = 'Hello! This is a test of the text to speech settings.';

    // If we have a session, try the API first
    if (firstSessionId) {
      try {
        const result = await synthesizeSpeech(
          firstSessionId,
          testText,
          voice_id || undefined,
          'mp3',
          speed
        );

        if (result.audio_b64) {
          // Play the audio from base64
          const audioBlob = new Blob(
            [Uint8Array.from(atob(result.audio_b64), (c) => c.charCodeAt(0))],
            { type: result.content_type || 'audio/mpeg' }
          );
          const audioUrl = URL.createObjectURL(audioBlob);
          audioRef.current = new Audio(audioUrl);
          audioRef.current.onended = () => {
            setTestingTts(false);
            URL.revokeObjectURL(audioUrl);
          };
          audioRef.current.onerror = () => {
            setTestingTts(false);
            URL.revokeObjectURL(audioUrl);
          };
          await audioRef.current.play();
        } else {
          // API returned empty audio (e.g., pyttsx3 not installed), fall back to browser TTS
          console.warn('API returned empty audio, falling back to browser TTS');
          playBrowserTts(testText);
        }
      } catch (error) {
        // API failed, fall back to browser TTS
        console.warn('TTS API failed, falling back to browser TTS:', error);
        playBrowserTts(testText);
      }
    } else {
      // No session available, use browser TTS directly
      playBrowserTts(testText);
    }
  };

  const stopTts = () => {
    // Stop API audio playback
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    // Also cancel browser TTS if it was used as fallback
    speechSynthesis.cancel();
    setTestingTts(false);
  };

  // Test microphone
  const testMicrophone = async () => {
    // Check if mediaDevices API is available (requires HTTPS or localhost)
    if (!navigator.mediaDevices?.getUserMedia) {
      console.warn('MediaDevices API not available - requires secure context (HTTPS)');
      return;
    }

    setTestingMic(true);
    try {
      const constraints: MediaStreamConstraints = {
        audio: stt_input_device_id ? { deviceId: { exact: stt_input_device_id } } : true,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      const audioContext = new AudioContext();
      const analyser = audioContext.createAnalyser();
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);

      analyser.fftSize = 256;
      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const updateLevel = () => {
        if (!testingMic) return;
        analyser.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        setMicLevel(average / 255);
        requestAnimationFrame(updateLevel);
      };
      updateLevel();

      // Auto-stop after 5 seconds
      setTimeout(() => {
        stream.getTracks().forEach((t) => t.stop());
        audioContext.close();
        setTestingMic(false);
        setMicLevel(0);
      }, 5000);
    } catch (error) {
      console.error('Microphone test failed:', error);
      setTestingMic(false);
    }
  };

  // Filter voices by selected language
  const filteredVoices = voices.filter(
    (v) => v.language_code?.startsWith(language?.split('-')[0] ?? '') || !language
  );

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border-subtle">
        <Volume2 className="h-5 w-5 text-accent-primary" />
        <h2 className="text-lg font-semibold text-text-primary">Voice & Audio Settings</h2>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-8">
        {/* Text-to-Speech Section */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Volume2 className="h-4 w-4 text-accent-primary" />
            <h3 className="text-base font-medium text-text-primary">Text-to-Speech</h3>
          </div>

          <div className="space-y-4">
            {/* Enable TTS */}
            <div className="flex items-center justify-between p-4 rounded-lg bg-elevated border border-border-subtle">
              <div>
                <p className="font-medium text-text-primary">Enable Text-to-Speech</p>
                <p className="text-sm text-text-muted">Allow agents to speak responses aloud</p>
              </div>
              <ToggleSwitch
                enabled={tts_enabled}
                onChange={(v) => updateSetting('tts_enabled', v)}
              />
            </div>

            {/* Auto-play */}
            <div className="flex items-center justify-between p-4 rounded-lg bg-elevated border border-border-subtle">
              <div>
                <p className="font-medium text-text-primary">Auto-play Responses</p>
                <p className="text-sm text-text-muted">
                  Automatically speak agent responses when received
                </p>
              </div>
              <ToggleSwitch
                enabled={auto_play}
                onChange={(v) => updateSetting('auto_play', v)}
                disabled={!tts_enabled}
              />
            </div>

            {/* Language */}
            <div className="p-4 rounded-lg bg-elevated border border-border-subtle">
              <label className="block font-medium text-text-primary mb-2">Language</label>
              {configError ? (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30">
                  <AlertCircle className="h-4 w-4 text-red-400" />
                  <span className="text-sm text-red-400">Failed to load languages</span>
                  <button
                    onClick={() => initializeConfig()}
                    className="ml-auto text-xs text-red-400 hover:text-red-300"
                  >
                    Retry
                  </button>
                </div>
              ) : configLoading || !languages ? (
                <div className="flex items-center gap-2 p-3">
                  <Loader2 className="h-4 w-4 animate-spin text-text-muted" />
                  <span className="text-sm text-text-muted">Loading languages...</span>
                </div>
              ) : (
                <select
                  value={language}
                  onChange={(e) => updateSetting('language', e.target.value)}
                  disabled={!tts_enabled}
                  className="w-full rounded-md bg-surface border border-border-default px-3 py-2 text-sm text-text-primary focus:border-border-focus focus:outline-none disabled:opacity-50"
                >
                  {languages.map((lang) => (
                    <option key={lang.code} value={lang.code}>
                      {lang.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Voice Selection */}
            <div className="p-4 rounded-lg bg-elevated border border-border-subtle">
              <div className="flex items-center justify-between mb-2">
                <label className="block font-medium text-text-primary">Voice</label>
                <button
                  onClick={loadVoices}
                  disabled={loadingVoices}
                  className="flex items-center gap-1 text-xs text-text-muted hover:text-text-primary"
                >
                  <RefreshCw className={cn('h-3 w-3', loadingVoices && 'animate-spin')} />
                  Refresh
                </button>
              </div>
              <select
                value={voice_id || ''}
                onChange={(e) => updateSetting('voice_id', e.target.value || null)}
                disabled={!tts_enabled || loadingVoices}
                className="w-full rounded-md bg-surface border border-border-default px-3 py-2 text-sm text-text-primary focus:border-border-focus focus:outline-none disabled:opacity-50"
              >
                <option value="">Default (Joanna)</option>
                {filteredVoices.map((voice) => (
                  <option key={voice.id} value={voice.id}>
                    {voice.name} ({voice.gender}, {voice.language_name})
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-text-muted">{voices.length} voices available</p>
            </div>

            {/* Speed */}
            <div className="p-4 rounded-lg bg-elevated border border-border-subtle">
              <label className="block font-medium text-text-primary mb-2">
                Speed: {speed.toFixed(1)}x
              </label>
              <input
                type="range"
                min="0.5"
                max="2"
                step="0.1"
                value={speed}
                onChange={(e) => updateSetting('speed', parseFloat(e.target.value))}
                disabled={!tts_enabled}
                className="w-full accent-accent-primary disabled:opacity-50"
              />
              <div className="flex justify-between text-xs text-text-muted mt-1">
                <span>0.5x (Slow)</span>
                <span>1.0x</span>
                <span>2.0x (Fast)</span>
              </div>
            </div>

            {/* Test TTS */}
            <div className="flex gap-2">
              <button
                onClick={testingTts ? stopTts : testTts}
                disabled={!tts_enabled}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors',
                  testingTts
                    ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                    : 'bg-accent-primary/10 text-accent-primary hover:bg-accent-primary/20',
                  !tts_enabled && 'opacity-50 cursor-not-allowed'
                )}
              >
                {testingTts ? (
                  <>
                    <Square className="h-4 w-4" />
                    Stop
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4" />
                    Test Voice
                  </>
                )}
              </button>
            </div>
          </div>
        </section>

        {/* Speech-to-Text Section */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Mic className="h-4 w-4 text-accent-primary" />
            <h3 className="text-base font-medium text-text-primary">Speech-to-Text</h3>
          </div>

          <div className="space-y-4">
            {/* Enable STT */}
            <div className="flex items-center justify-between p-4 rounded-lg bg-elevated border border-border-subtle">
              <div>
                <p className="font-medium text-text-primary">Enable Speech-to-Text</p>
                <p className="text-sm text-text-muted">Use voice commands and dictation</p>
              </div>
              <ToggleSwitch
                enabled={stt_enabled}
                onChange={(v) => updateSetting('stt_enabled', v)}
              />
            </div>

            {/* STT Language */}
            <div className="p-4 rounded-lg bg-elevated border border-border-subtle">
              <label className="block font-medium text-text-primary mb-2">
                Recognition Language
              </label>
              {configError ? (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30">
                  <AlertCircle className="h-4 w-4 text-red-400" />
                  <span className="text-sm text-red-400">Failed to load languages</span>
                  <button
                    onClick={() => initializeConfig()}
                    className="ml-auto text-xs text-red-400 hover:text-red-300"
                  >
                    Retry
                  </button>
                </div>
              ) : configLoading || !languages ? (
                <div className="flex items-center gap-2 p-3">
                  <Loader2 className="h-4 w-4 animate-spin text-text-muted" />
                  <span className="text-sm text-text-muted">Loading languages...</span>
                </div>
              ) : (
                <select
                  value={stt_language}
                  onChange={(e) => updateSetting('stt_language', e.target.value)}
                  disabled={!stt_enabled}
                  className="w-full rounded-md bg-surface border border-border-default px-3 py-2 text-sm text-text-primary focus:border-border-focus focus:outline-none disabled:opacity-50"
                >
                  {languages.map((lang) => (
                    <option key={lang.code} value={lang.code}>
                      {lang.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Input Device */}
            <div className="p-4 rounded-lg bg-elevated border border-border-subtle">
              <div className="flex items-center justify-between mb-2">
                <label className="block font-medium text-text-primary">Microphone</label>
                <button
                  onClick={loadAudioDevices}
                  disabled={loadingDevices}
                  className="flex items-center gap-1 text-xs text-text-muted hover:text-text-primary"
                >
                  <RefreshCw className={cn('h-3 w-3', loadingDevices && 'animate-spin')} />
                  Refresh
                </button>
              </div>
              <select
                value={stt_input_device_id || ''}
                onChange={(e) => updateSetting('stt_input_device_id', e.target.value || null)}
                disabled={!stt_enabled || loadingDevices}
                className="w-full rounded-md bg-surface border border-border-default px-3 py-2 text-sm text-text-primary focus:border-border-focus focus:outline-none disabled:opacity-50"
              >
                <option value="">System Default</option>
                {audioDevices.map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-text-muted">
                {audioDevices.length} microphone{audioDevices.length !== 1 ? 's' : ''} detected
              </p>
            </div>

            {/* Test Microphone */}
            <div className="space-y-2">
              <button
                onClick={testMicrophone}
                disabled={!stt_enabled || testingMic}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors',
                  testingMic
                    ? 'bg-green-500/20 text-green-400'
                    : 'bg-accent-primary/10 text-accent-primary hover:bg-accent-primary/20',
                  (!stt_enabled || testingMic) && 'cursor-not-allowed',
                  !stt_enabled && 'opacity-50'
                )}
              >
                <Mic className={cn('h-4 w-4', testingMic && 'animate-pulse')} />
                {testingMic ? 'Listening...' : 'Test Microphone'}
              </button>

              {testingMic && (
                <div className="h-2 bg-elevated rounded-full overflow-hidden">
                  <div
                    className="h-full bg-green-500 transition-all duration-100"
                    style={{ width: `${micLevel * 100}%` }}
                  />
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Reset Section */}
        <section className="pt-4 border-t border-border-subtle">
          <button
            onClick={resetToDefaults}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-overlay text-text-secondary hover:text-text-primary hover:bg-surface transition-colors text-sm"
          >
            <RotateCcw className="h-4 w-4" />
            Reset to Defaults
          </button>
        </section>
      </div>
    </div>
  );
}
