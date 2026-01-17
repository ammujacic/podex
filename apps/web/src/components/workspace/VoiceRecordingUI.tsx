'use client';

import { Mic, X, Send } from 'lucide-react';
import { cn } from '@/lib/utils';

interface VoiceRecordingUIProps {
  currentTranscript: string;
  onCancel: () => void;
  onSend: () => void;
  disabled?: boolean;
}

/**
 * Voice recording UI component for displaying recording state and controls.
 */
export function VoiceRecordingUI({
  currentTranscript,
  onCancel,
  onSend,
  disabled = false,
}: VoiceRecordingUIProps) {
  return (
    <div className="flex flex-col gap-3" role="region" aria-label="Voice recording">
      {/* Recording indicator and transcript */}
      <div className="flex items-center gap-3 px-2">
        {/* Pulsing mic indicator */}
        <div className="relative flex-shrink-0" aria-hidden="true">
          <div className="absolute inset-0 bg-status-error/30 rounded-full animate-ping" />
          <div className="relative w-10 h-10 rounded-full bg-status-error flex items-center justify-center">
            <Mic className="h-5 w-5 text-white" />
          </div>
        </div>

        {/* Live transcript */}
        <div className="flex-1 min-w-0">
          <p className="text-xs text-status-error font-medium mb-0.5" role="status">
            Recording...
          </p>
          <p className="text-sm text-text-primary truncate" aria-live="polite">
            {currentTranscript || 'Listening...'}
          </p>
        </div>
      </div>

      {/* Recording controls */}
      <div className="flex items-center justify-center gap-4">
        {/* Cancel button */}
        <button
          onClick={onCancel}
          className={cn(
            'flex items-center gap-2 px-4 py-2 rounded-lg min-h-[44px]',
            'bg-surface-hover text-text-secondary',
            'hover:bg-surface-active hover:text-text-primary',
            'transition-colors touch-manipulation',
            'focus:outline-none focus:ring-2 focus:ring-accent-primary focus:ring-offset-1'
          )}
          aria-label="Cancel recording"
        >
          <X className="h-4 w-4" aria-hidden="true" />
          <span className="text-sm font-medium">Cancel</span>
        </button>

        {/* Send button */}
        <button
          onClick={onSend}
          disabled={disabled || !currentTranscript.trim()}
          className={cn(
            'flex items-center gap-2 px-4 py-2 rounded-lg min-h-[44px]',
            'bg-accent-primary text-text-inverse',
            'hover:bg-accent-primary/90',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            'transition-colors touch-manipulation',
            'focus:outline-none focus:ring-2 focus:ring-accent-primary focus:ring-offset-1'
          )}
          aria-label="Send voice message"
        >
          <Send className="h-4 w-4" aria-hidden="true" />
          <span className="text-sm font-medium">Send</span>
        </button>
      </div>
    </div>
  );
}
