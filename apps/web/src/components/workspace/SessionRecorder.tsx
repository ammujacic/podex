'use client';

import {
  Video,
  Play,
  Pause,
  Square,
  SkipBack,
  SkipForward,
  FastForward,
  Clock,
  Download,
  Share2,
  X,
  Circle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { create } from 'zustand';

// ============================================================================
// Types
// ============================================================================

export type RecordingEventType =
  | 'file_open'
  | 'file_edit'
  | 'file_save'
  | 'cursor_move'
  | 'selection_change'
  | 'terminal_command'
  | 'terminal_output'
  | 'agent_message'
  | 'user_message'
  | 'scroll';

export interface RecordingEvent {
  id: string;
  timestamp: number; // Milliseconds from start
  type: RecordingEventType;
  data: Record<string, unknown>;
}

export interface Recording {
  id: string;
  sessionId: string;
  name: string;
  createdAt: Date;
  duration: number; // Milliseconds
  events: RecordingEvent[];
  thumbnail?: string;
}

export type RecordingStatus = 'idle' | 'recording' | 'paused' | 'playing';
export type PlaybackSpeed = 0.5 | 1 | 1.5 | 2 | 4;

// ============================================================================
// Store
// ============================================================================

interface RecordingState {
  status: RecordingStatus;
  currentRecording: Recording | null;
  playbackPosition: number;
  playbackSpeed: PlaybackSpeed;
  recordings: Recording[];

  startRecording: (sessionId: string) => void;
  stopRecording: () => void;
  pauseRecording: () => void;
  resumeRecording: () => void;
  addEvent: (event: Omit<RecordingEvent, 'id' | 'timestamp'>) => void;
  loadRecording: (recording: Recording) => void;
  play: () => void;
  pause: () => void;
  stop: () => void;
  seek: (position: number) => void;
  setPlaybackSpeed: (speed: PlaybackSpeed) => void;
}

export const useRecordingStore = create<RecordingState>((set, get) => {
  let recordingStartTime: number | null = null;
  let playbackInterval: ReturnType<typeof setInterval> | null = null;

  return {
    status: 'idle',
    currentRecording: null,
    playbackPosition: 0,
    playbackSpeed: 1,
    recordings: [],

    startRecording: (sessionId) => {
      recordingStartTime = Date.now();
      set({
        status: 'recording',
        currentRecording: {
          id: `rec-${Date.now()}`,
          sessionId,
          name: `Recording ${new Date().toLocaleString()}`,
          createdAt: new Date(),
          duration: 0,
          events: [],
        },
        playbackPosition: 0,
      });
    },

    stopRecording: () => {
      const { currentRecording } = get();
      if (currentRecording && recordingStartTime) {
        const duration = Date.now() - recordingStartTime;
        const finalRecording = { ...currentRecording, duration };
        set((state) => ({
          status: 'idle',
          currentRecording: null,
          recordings: [...state.recordings, finalRecording],
        }));
      }
      recordingStartTime = null;
    },

    pauseRecording: () => set({ status: 'paused' }),
    resumeRecording: () => set({ status: 'recording' }),

    addEvent: (eventData) => {
      const { status, currentRecording } = get();
      if (status !== 'recording' || !currentRecording || !recordingStartTime) return;

      const event: RecordingEvent = {
        id: `evt-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        timestamp: Date.now() - recordingStartTime,
        ...eventData,
      };

      set({
        currentRecording: {
          ...currentRecording,
          events: [...currentRecording.events, event],
          duration: Date.now() - recordingStartTime,
        },
      });
    },

    loadRecording: (recording) => {
      set({
        currentRecording: recording,
        playbackPosition: 0,
        status: 'idle',
      });
    },

    play: () => {
      const { currentRecording } = get();
      if (!currentRecording) return;

      if (playbackInterval) clearInterval(playbackInterval);

      set({ status: 'playing' });

      playbackInterval = setInterval(() => {
        const { status, playbackPosition, currentRecording, playbackSpeed } = get();
        if (status !== 'playing' || !currentRecording) {
          if (playbackInterval) clearInterval(playbackInterval);
          return;
        }

        const newPosition = playbackPosition + 100 * playbackSpeed;
        if (newPosition >= currentRecording.duration) {
          set({ status: 'idle', playbackPosition: currentRecording.duration });
          if (playbackInterval) clearInterval(playbackInterval);
        } else {
          set({ playbackPosition: newPosition });
        }
      }, 100);
    },

    pause: () => {
      if (playbackInterval) clearInterval(playbackInterval);
      set({ status: 'paused' });
    },

    stop: () => {
      if (playbackInterval) clearInterval(playbackInterval);
      set({ status: 'idle', playbackPosition: 0 });
    },

    seek: (position) => set({ playbackPosition: position }),

    setPlaybackSpeed: (speed) => set({ playbackSpeed: speed }),
  };
});

// ============================================================================
// Format Utilities
// ============================================================================

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}:${(minutes % 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
  }
  return `${minutes}:${(seconds % 60).toString().padStart(2, '0')}`;
}

// ============================================================================
// Recording Controls
// ============================================================================

interface RecordingControlsProps {
  sessionId: string;
  className?: string;
}

export function RecordingControls({ sessionId, className }: RecordingControlsProps) {
  const {
    status,
    currentRecording,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
  } = useRecordingStore();

  const isRecording = status === 'recording' || status === 'paused';

  return (
    <div className={cn('flex items-center gap-2', className)}>
      {!isRecording ? (
        <button
          onClick={() => startRecording(sessionId)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-500 hover:bg-red-600 text-white text-sm font-medium"
        >
          <Circle className="h-3 w-3 fill-current" />
          Record
        </button>
      ) : (
        <>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-500/20 text-red-400">
            <Circle
              className={cn('h-3 w-3 fill-current', status === 'recording' && 'animate-pulse')}
            />
            <span className="text-sm font-medium">
              {formatDuration(currentRecording?.duration || 0)}
            </span>
          </div>

          {status === 'recording' ? (
            <button
              onClick={pauseRecording}
              className="p-1.5 rounded hover:bg-overlay text-text-muted hover:text-text-primary"
              title="Pause"
            >
              <Pause className="h-4 w-4" />
            </button>
          ) : (
            <button
              onClick={resumeRecording}
              className="p-1.5 rounded hover:bg-overlay text-text-muted hover:text-text-primary"
              title="Resume"
            >
              <Play className="h-4 w-4" />
            </button>
          )}

          <button
            onClick={stopRecording}
            className="p-1.5 rounded hover:bg-overlay text-red-400 hover:text-red-300"
            title="Stop"
          >
            <Square className="h-4 w-4" />
          </button>
        </>
      )}
    </div>
  );
}

// ============================================================================
// Playback Controls
// ============================================================================

interface PlaybackControlsProps {
  className?: string;
}

export function PlaybackControls({ className }: PlaybackControlsProps) {
  const {
    status,
    currentRecording,
    playbackPosition,
    playbackSpeed,
    play,
    pause,
    stop,
    seek,
    setPlaybackSpeed,
  } = useRecordingStore();

  if (!currentRecording) return null;

  const isPlaying = status === 'playing';
  const progress = (playbackPosition / currentRecording.duration) * 100;

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {/* Progress bar */}
      <div className="relative h-1.5 bg-overlay rounded-full overflow-hidden">
        <div
          className="absolute left-0 top-0 h-full bg-accent-primary rounded-full transition-all"
          style={{ width: `${progress}%` }}
        />
        <input
          type="range"
          min={0}
          max={currentRecording.duration}
          value={playbackPosition}
          onChange={(e) => seek(Number(e.target.value))}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        />
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <button
            onClick={() => seek(Math.max(0, playbackPosition - 10000))}
            className="p-1.5 rounded hover:bg-overlay text-text-muted hover:text-text-primary"
            title="Back 10s"
          >
            <SkipBack className="h-4 w-4" />
          </button>

          {isPlaying ? (
            <button
              onClick={pause}
              className="p-2 rounded-full bg-accent-primary hover:bg-accent-primary/90 text-void"
            >
              <Pause className="h-5 w-5" />
            </button>
          ) : (
            <button
              onClick={play}
              className="p-2 rounded-full bg-accent-primary hover:bg-accent-primary/90 text-void"
            >
              <Play className="h-5 w-5" />
            </button>
          )}

          <button
            onClick={() => seek(Math.min(currentRecording.duration, playbackPosition + 10000))}
            className="p-1.5 rounded hover:bg-overlay text-text-muted hover:text-text-primary"
            title="Forward 10s"
          >
            <SkipForward className="h-4 w-4" />
          </button>

          <button
            onClick={stop}
            className="p-1.5 rounded hover:bg-overlay text-text-muted hover:text-text-primary"
            title="Stop"
          >
            <Square className="h-4 w-4" />
          </button>
        </div>

        {/* Time display */}
        <div className="text-xs text-text-muted font-mono">
          {formatDuration(playbackPosition)} / {formatDuration(currentRecording.duration)}
        </div>

        {/* Speed control */}
        <div className="flex items-center gap-1">
          <FastForward className="h-3.5 w-3.5 text-text-muted" />
          <select
            value={playbackSpeed}
            onChange={(e) => setPlaybackSpeed(Number(e.target.value) as PlaybackSpeed)}
            className="bg-overlay border border-border-subtle rounded px-1.5 py-0.5 text-xs text-text-secondary"
          >
            <option value={0.5}>0.5x</option>
            <option value={1}>1x</option>
            <option value={1.5}>1.5x</option>
            <option value={2}>2x</option>
            <option value={4}>4x</option>
          </select>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Event Timeline
// ============================================================================

interface EventTimelineProps {
  events: RecordingEvent[];
  currentPosition: number;
  duration: number;
  onSeek: (position: number) => void;
  className?: string;
}

export function EventTimeline({
  events,
  currentPosition,
  duration,
  onSeek,
  className,
}: EventTimelineProps) {
  // Group events that are close together
  const groupedEvents = events.reduce(
    (acc, event) => {
      const lastGroup = acc[acc.length - 1];
      if (lastGroup && event.timestamp - lastGroup.timestamp < 1000) {
        lastGroup.events.push(event);
      } else {
        acc.push({ timestamp: event.timestamp, events: [event] });
      }
      return acc;
    },
    [] as { timestamp: number; events: RecordingEvent[] }[]
  );

  return (
    <div className={cn('relative h-8', className)}>
      {/* Timeline bar */}
      <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1 bg-overlay rounded-full" />

      {/* Current position indicator */}
      <div
        className="absolute top-0 bottom-0 w-0.5 bg-accent-primary z-10"
        style={{ left: `${(currentPosition / duration) * 100}%` }}
      />

      {/* Event markers */}
      {groupedEvents.map((group, i) => {
        const position = (group.timestamp / duration) * 100;
        const isPast = group.timestamp <= currentPosition;

        return (
          <button
            key={i}
            onClick={() => onSeek(group.timestamp)}
            className={cn(
              'absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full border-2 transition-colors',
              isPast
                ? 'bg-accent-primary border-accent-primary'
                : 'bg-surface border-text-muted hover:border-accent-primary'
            )}
            style={{ left: `${position}%` }}
            title={`${formatDuration(group.timestamp)} - ${group.events.length} event(s)`}
          />
        );
      })}
    </div>
  );
}

// ============================================================================
// Recording List
// ============================================================================

interface RecordingListProps {
  recordings: Recording[];
  onSelect: (recording: Recording) => void;
  onDelete?: (recording: Recording) => void;
  onShare?: (recording: Recording) => void;
  onDownload?: (recording: Recording) => void;
  className?: string;
}

export function RecordingList({
  recordings,
  onSelect,
  onDelete,
  onShare,
  onDownload,
  className,
}: RecordingListProps) {
  if (recordings.length === 0) {
    return (
      <div
        className={cn('flex flex-col items-center justify-center h-32 text-text-muted', className)}
      >
        <Video className="h-8 w-8 mb-2 opacity-50" />
        <p className="text-sm">No recordings yet</p>
      </div>
    );
  }

  return (
    <div className={cn('space-y-2', className)}>
      {recordings.map((recording) => (
        <div
          key={recording.id}
          className="flex items-center gap-3 p-3 rounded-lg border border-border-subtle hover:bg-overlay cursor-pointer"
          onClick={() => onSelect(recording)}
        >
          <div className="w-10 h-10 rounded bg-accent-primary/20 flex items-center justify-center">
            <Video className="h-5 w-5 text-accent-primary" />
          </div>

          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-text-primary truncate">{recording.name}</div>
            <div className="flex items-center gap-2 text-xs text-text-muted">
              <Clock className="h-3 w-3" />
              <span>{formatDuration(recording.duration)}</span>
              <span>•</span>
              <span>{recording.createdAt.toLocaleDateString()}</span>
              <span>•</span>
              <span>{recording.events.length} events</span>
            </div>
          </div>

          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            {onDownload && (
              <button
                onClick={() => onDownload(recording)}
                className="p-1.5 rounded hover:bg-elevated text-text-muted hover:text-text-primary"
                title="Download"
              >
                <Download className="h-4 w-4" />
              </button>
            )}
            {onShare && (
              <button
                onClick={() => onShare(recording)}
                className="p-1.5 rounded hover:bg-elevated text-text-muted hover:text-text-primary"
                title="Share"
              >
                <Share2 className="h-4 w-4" />
              </button>
            )}
            {onDelete && (
              <button
                onClick={() => onDelete(recording)}
                className="p-1.5 rounded hover:bg-elevated text-text-muted hover:text-red-400"
                title="Delete"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// Main Session Recorder Panel
// ============================================================================

interface SessionRecorderProps {
  sessionId: string;
  className?: string;
}

export function SessionRecorder({ sessionId, className }: SessionRecorderProps) {
  const { status, currentRecording, recordings, playbackPosition, loadRecording, seek } =
    useRecordingStore();

  const isRecording = status === 'recording' || status === 'paused';

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
        <div className="flex items-center gap-2">
          <Video className="h-5 w-5 text-accent-primary" />
          <h2 className="text-lg font-semibold text-text-primary">Session Recording</h2>
        </div>
        <RecordingControls sessionId={sessionId} />
      </div>

      {/* Current recording or playback */}
      {(currentRecording || isRecording) && (
        <div className="p-4 border-b border-border-subtle">
          {isRecording ? (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-red-500/10 border border-red-500/30">
              <Circle className="h-4 w-4 text-red-400 fill-current animate-pulse" />
              <div className="flex-1">
                <div className="text-sm font-medium text-text-primary">Recording in progress</div>
                <div className="text-xs text-text-muted">
                  {formatDuration(currentRecording?.duration || 0)} •{' '}
                  {currentRecording?.events.length || 0} events captured
                </div>
              </div>
            </div>
          ) : currentRecording ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-lg bg-accent-primary/20 flex items-center justify-center">
                  <Video className="h-6 w-6 text-accent-primary" />
                </div>
                <div className="flex-1">
                  <div className="text-sm font-medium text-text-primary">
                    {currentRecording.name}
                  </div>
                  <div className="text-xs text-text-muted">
                    {formatDuration(currentRecording.duration)} • {currentRecording.events.length}{' '}
                    events
                  </div>
                </div>
              </div>

              <EventTimeline
                events={currentRecording.events}
                currentPosition={playbackPosition}
                duration={currentRecording.duration}
                onSeek={seek}
              />

              <PlaybackControls />
            </div>
          ) : null}
        </div>
      )}

      {/* Recordings list */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-text-secondary">Saved Recordings</h3>
          <span className="text-xs text-text-muted">{recordings.length} recordings</span>
        </div>
        <RecordingList
          recordings={recordings}
          onSelect={loadRecording}
          onDelete={() => {
            /* TODO: Implement delete recording API */
            // await api.delete(`/api/sessions/${sessionId}/recordings/${recording.id}`);
            console.warn('Delete recording');
          }}
          onShare={() => {
            /* TODO: Implement share recording API */
            // const shareUrl = await api.post(`/api/sessions/${sessionId}/recordings/${recording.id}/share`);
            // navigator.clipboard.writeText(shareUrl);
            console.warn('Share recording');
          }}
          onDownload={() => {
            /* TODO: Implement download recording API */
            // const blob = await api.get(`/api/sessions/${sessionId}/recordings/${recording.id}/download`, { responseType: 'blob' });
            // const url = URL.createObjectURL(blob);
            // const a = document.createElement('a');
            // a.href = url;
            // a.download = 'session-recording.json';
            // a.click();
            console.warn('Download recording');
          }}
        />
      </div>
    </div>
  );
}
