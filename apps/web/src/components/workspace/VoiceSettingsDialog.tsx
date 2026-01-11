'use client';

import { useState, useEffect } from 'react';
import { Volume2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@podex/ui';
import { cn } from '@/lib/utils';
import {
  getAgentVoiceConfig,
  updateAgentVoiceConfig,
  listVoices,
  type VoiceConfig,
  type VoiceInfo,
} from '@/lib/api';

interface VoiceSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string;
  agentId: string;
  agentName: string;
}

export function VoiceSettingsDialog({
  open,
  onOpenChange,
  sessionId,
  agentId,
  agentName,
}: VoiceSettingsDialogProps) {
  const [config, setConfig] = useState<VoiceConfig | null>(null);
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Load voice config and available voices
  useEffect(() => {
    if (!open) return;

    async function loadData() {
      setIsLoading(true);
      try {
        const [voiceConfig, availableVoices] = await Promise.all([
          getAgentVoiceConfig(sessionId, agentId),
          listVoices(),
        ]);
        setConfig(voiceConfig);
        setVoices(availableVoices);
      } catch (error) {
        console.error('Failed to load voice settings:', error);
      } finally {
        setIsLoading(false);
      }
    }

    loadData();
  }, [open, sessionId, agentId]);

  const handleSave = async (updates: Partial<VoiceConfig>) => {
    if (!config) return;

    setIsSaving(true);
    try {
      const updated = await updateAgentVoiceConfig(sessionId, agentId, updates);
      setConfig(updated);
    } catch (error) {
      console.error('Failed to save voice settings:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggle = (key: keyof VoiceConfig, value: boolean) => {
    if (!config) return;
    const newConfig = { ...config, [key]: value };
    setConfig(newConfig);
    handleSave({ [key]: value });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-surface border-border-default">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-text-primary">
            <Volume2 className="h-5 w-5" />
            Voice Settings - {agentName}
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent-primary border-t-transparent" />
          </div>
        ) : config ? (
          <div className="space-y-6 py-4">
            {/* Auto-play toggle */}
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-text-primary">Auto-play Responses</p>
                <p className="text-sm text-text-muted">Automatically speak agent responses aloud</p>
              </div>
              <button
                onClick={() => handleToggle('auto_play', !config.auto_play)}
                disabled={isSaving}
                className={cn(
                  'relative h-6 w-11 rounded-full transition-colors',
                  config.auto_play ? 'bg-accent-primary' : 'bg-elevated'
                )}
              >
                <span
                  className={cn(
                    'absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform',
                    config.auto_play ? 'left-5' : 'left-0.5'
                  )}
                />
              </button>
            </div>

            {/* TTS enabled toggle */}
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-text-primary">Text-to-Speech</p>
                <p className="text-sm text-text-muted">Enable speaker button on messages</p>
              </div>
              <button
                onClick={() => handleToggle('tts_enabled', !config.tts_enabled)}
                disabled={isSaving}
                className={cn(
                  'relative h-6 w-11 rounded-full transition-colors',
                  config.tts_enabled ? 'bg-accent-primary' : 'bg-elevated'
                )}
              >
                <span
                  className={cn(
                    'absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform',
                    config.tts_enabled ? 'left-5' : 'left-0.5'
                  )}
                />
              </button>
            </div>

            {/* Voice selection */}
            <div>
              <label className="block font-medium text-text-primary mb-2">Voice</label>
              <select
                value={config.voice_id || ''}
                onChange={(e) => {
                  const newVoiceId = e.target.value || null;
                  setConfig({ ...config, voice_id: newVoiceId });
                  handleSave({ voice_id: newVoiceId });
                }}
                disabled={isSaving}
                className="w-full rounded-md bg-elevated border border-border-default px-3 py-2 text-sm text-text-primary focus:border-border-focus focus:outline-none"
              >
                <option value="">Default (Joanna)</option>
                {voices.map((voice) => (
                  <option key={voice.id} value={voice.id}>
                    {voice.name} ({voice.gender}, {voice.language_name})
                  </option>
                ))}
              </select>
            </div>

            {/* Speed slider */}
            <div>
              <label className="block font-medium text-text-primary mb-2">
                Speed: {config.speed.toFixed(1)}x
              </label>
              <input
                type="range"
                min="0.5"
                max="2"
                step="0.1"
                value={config.speed}
                onChange={(e) => {
                  const speed = parseFloat(e.target.value);
                  setConfig({ ...config, speed });
                }}
                onMouseUp={() => handleSave({ speed: config.speed })}
                onTouchEnd={() => handleSave({ speed: config.speed })}
                disabled={isSaving}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-text-muted mt-1">
                <span>0.5x</span>
                <span>1.0x</span>
                <span>2.0x</span>
              </div>
            </div>

            {/* Language selection */}
            <div>
              <label className="block font-medium text-text-primary mb-2">Language</label>
              <select
                value={config.language}
                onChange={(e) => {
                  const language = e.target.value;
                  setConfig({ ...config, language });
                  handleSave({ language });
                }}
                disabled={isSaving}
                className="w-full rounded-md bg-elevated border border-border-default px-3 py-2 text-sm text-text-primary focus:border-border-focus focus:outline-none"
              >
                <option value="en-US">English (US)</option>
                <option value="en-GB">English (UK)</option>
                <option value="en-AU">English (Australia)</option>
                <option value="es-ES">Spanish (Spain)</option>
                <option value="es-MX">Spanish (Mexico)</option>
                <option value="fr-FR">French</option>
                <option value="de-DE">German</option>
                <option value="it-IT">Italian</option>
                <option value="ja-JP">Japanese</option>
                <option value="ko-KR">Korean</option>
                <option value="pt-BR">Portuguese (Brazil)</option>
                <option value="zh-CN">Chinese (Mandarin)</option>
              </select>
            </div>
          </div>
        ) : (
          <div className="py-8 text-center text-text-muted">Failed to load voice settings</div>
        )}
      </DialogContent>
    </Dialog>
  );
}
