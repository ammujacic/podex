'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Mic, ChevronLeft, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface VoiceRecordingOverlayProps {
  isRecording: boolean;
  isTranscribing: boolean;
  currentTranscript: string;
  onCancel: () => void;
  /** Swipe threshold in pixels to trigger cancel */
  cancelThreshold?: number;
}

/**
 * WhatsApp-style voice recording overlay.
 * Shows a recording indicator with timer, waveform visualization,
 * and slide-to-cancel functionality.
 */
export function VoiceRecordingOverlay({
  isRecording,
  isTranscribing,
  currentTranscript,
  onCancel,
  cancelThreshold = 100,
}: VoiceRecordingOverlayProps) {
  const [duration, setDuration] = useState(0);
  const [slideX, setSlideX] = useState(0);
  const [isCancelling, setIsCancelling] = useState(false);
  const startXRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Timer for recording duration
  useEffect(() => {
    if (!isRecording) {
      setDuration(0);
      setSlideX(0);
      setIsCancelling(false);
      return;
    }

    const interval = setInterval(() => {
      setDuration((d) => d + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, [isRecording]);

  // Format duration as MM:SS
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Handle touch/mouse events for slide-to-cancel
  const handlePointerDown = (e: React.PointerEvent) => {
    startXRef.current = e.clientX;
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (startXRef.current === null) return;

    const deltaX = startXRef.current - e.clientX;
    if (deltaX > 0) {
      setSlideX(Math.min(deltaX, cancelThreshold + 50));
      setIsCancelling(deltaX > cancelThreshold);
    }
  };

  const handlePointerUp = () => {
    if (isCancelling) {
      onCancel();
    }
    startXRef.current = null;
    setSlideX(0);
    setIsCancelling(false);
  };

  // Don't render if not recording and not transcribing
  if (!isRecording && !isTranscribing) {
    return null;
  }

  // Show transcribing state
  if (isTranscribing && !isRecording) {
    return (
      <div className="absolute inset-x-0 bottom-0 bg-surface border-t border-border-subtle p-4 z-20">
        <div className="flex items-center gap-3">
          <div className="relative flex-shrink-0">
            <div className="w-10 h-10 rounded-full bg-accent-primary/20 flex items-center justify-center">
              <Loader2 className="h-5 w-5 text-accent-primary animate-spin" />
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-accent-primary font-medium mb-0.5">Processing speech...</p>
            <p className="text-sm text-text-secondary truncate">
              {currentTranscript || 'Converting to text...'}
            </p>
          </div>
        </div>
        {/* Progress bar */}
        <div className="mt-3 h-1 bg-surface-hover rounded-full overflow-hidden">
          <div className="h-full bg-accent-primary rounded-full animate-pulse w-2/3" />
        </div>
      </div>
    );
  }

  // Recording state
  return (
    <div
      ref={containerRef}
      className="absolute inset-x-0 bottom-0 bg-surface border-t border-border-subtle z-20 touch-none select-none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      <div
        className="p-4 transition-transform"
        style={{
          transform: `translateX(${-slideX}px)`,
          opacity: isCancelling ? 0.5 : 1,
        }}
      >
        <div className="flex items-center gap-3">
          {/* Pulsing mic indicator */}
          <div className="relative flex-shrink-0">
            <div className="absolute inset-0 bg-status-error/30 rounded-full animate-ping" />
            <div className="relative w-10 h-10 rounded-full bg-status-error flex items-center justify-center">
              <Mic className="h-5 w-5 text-white" />
            </div>
          </div>

          {/* Timer and waveform area */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm font-mono text-status-error font-medium">
                {formatDuration(duration)}
              </span>
              <span className="text-xs text-text-tertiary">Recording</span>
            </div>

            {/* Waveform visualization */}
            <div className="flex items-center gap-0.5 h-6">
              {Array.from({ length: 30 }).map((_, i) => (
                <div
                  key={i}
                  className="w-1 bg-status-error/60 rounded-full animate-waveform"
                  style={{
                    height: `${Math.random() * 100}%`,
                    animationDelay: `${i * 50}ms`,
                    minHeight: '4px',
                  }}
                />
              ))}
            </div>

            {/* Live transcript preview */}
            {currentTranscript && (
              <p className="text-xs text-text-secondary mt-1 truncate">{currentTranscript}</p>
            )}
          </div>

          {/* Slide to cancel indicator */}
          <div
            className={cn(
              'flex items-center gap-1 text-text-tertiary transition-all',
              isCancelling && 'text-status-error scale-110'
            )}
          >
            <ChevronLeft className="h-4 w-4 animate-pulse" />
            <span className="text-xs whitespace-nowrap">
              {isCancelling ? 'Release to cancel' : 'Slide to cancel'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
