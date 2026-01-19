'use client';

import React, { useEffect, useState } from 'react';
import { X, Clock, Loader2 } from 'lucide-react';
import { useSessionStore } from '@/stores/session';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { getStandbySettings, updateStandbySettings, clearStandbySettings } from '@/lib/api';
import { useConfigStore } from '@/stores/config';

interface StandbySettingsModalProps {
  sessionId: string;
  onClose: () => void;
}

/**
 * Modal for configuring auto-standby timeout settings.
 */
export function StandbySettingsModal({ sessionId, onClose }: StandbySettingsModalProps) {
  const modalRef = useFocusTrap<HTMLDivElement>(true);

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeoutMinutes, setTimeoutMinutes] = useState<number | null>(60);
  const [_source, setSource] = useState<'session' | 'user_default'>('user_default');
  const [useSessionOverride, setUseSessionOverride] = useState(false);
  const { setStandbySettings } = useSessionStore();

  // Get timeout options from config store
  const timeoutOptions = useConfigStore((state) => state.getTimeoutOptions());

  // Load current settings
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const settings = await getStandbySettings(sessionId);
        setTimeoutMinutes(settings.timeout_minutes);
        setSource(settings.source);
        setUseSessionOverride(settings.source === 'session');
      } catch (err) {
        console.error('Failed to load standby settings:', err);
        setError('Failed to load settings');
      } finally {
        setIsLoading(false);
      }
    };
    loadSettings();
  }, [sessionId]);

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);

    try {
      let result;
      if (useSessionOverride) {
        result = await updateStandbySettings(sessionId, timeoutMinutes);
      } else {
        result = await clearStandbySettings(sessionId);
      }
      setStandbySettings(sessionId, {
        timeoutMinutes: result.timeout_minutes,
        source: result.source,
      });
      onClose();
    } catch (err) {
      console.error('Failed to save standby settings:', err);
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-void/80 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="standby-settings-title"
        className="relative w-full max-w-md rounded-xl border border-border-default bg-surface shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-border-subtle px-6 py-4">
          <div className="flex items-center gap-3">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-primary/10"
              aria-hidden="true"
            >
              <Clock className="h-5 w-5 text-accent-primary" />
            </div>
            <div>
              <h2 id="standby-settings-title" className="text-lg font-semibold text-text-primary">
                Auto-Standby Settings
              </h2>
              <p className="text-sm text-text-muted">Configure idle timeout</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-2 text-text-muted hover:bg-overlay hover:text-text-primary min-w-[40px] min-h-[40px] flex items-center justify-center"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-text-muted" aria-hidden="true" />
            </div>
          ) : (
            <>
              <p className="text-sm text-text-secondary mb-4">
                Your session will automatically pause after a period of inactivity to save
                resources. Resuming a paused session takes 10-30 seconds.
              </p>

              <div className="space-y-4">
                <div>
                  <label className="flex items-center gap-2 mb-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={useSessionOverride}
                      onChange={(e) => setUseSessionOverride(e.target.checked)}
                      className="rounded border-border-default bg-elevated text-accent-primary focus:ring-accent-primary w-4 h-4"
                    />
                    <span className="text-sm text-text-primary">
                      Override default for this session only
                    </span>
                  </label>

                  {!useSessionOverride && (
                    <p className="text-xs text-text-muted mb-3">
                      Using your default timeout setting. Change it in{' '}
                      <a href="/settings" className="text-accent-primary hover:underline">
                        user settings
                      </a>
                      .
                    </p>
                  )}
                </div>

                <div>
                  <label
                    htmlFor="timeout-select"
                    className="block text-sm font-medium text-text-secondary mb-2"
                  >
                    Auto-pause after inactivity
                  </label>
                  <select
                    id="timeout-select"
                    value={timeoutMinutes === null ? 'never' : timeoutMinutes.toString()}
                    onChange={(e) =>
                      setTimeoutMinutes(
                        e.target.value === 'never' ? null : parseInt(e.target.value)
                      )
                    }
                    disabled={!useSessionOverride}
                    className="w-full rounded-lg border border-border-default bg-elevated px-4 py-2 text-text-primary focus:border-accent-primary focus:outline-none focus:ring-1 focus:ring-accent-primary disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]"
                  >
                    {timeoutOptions?.map((opt: { value: number | null; label: string }) => (
                      <option key={opt.value ?? 'never'} value={opt.value ?? 'never'}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {error && (
                <div
                  className="mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm"
                  role="alert"
                  aria-live="polite"
                >
                  {error}
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-border-subtle px-6 py-4">
          <button
            onClick={onClose}
            disabled={isSaving}
            className="rounded-lg px-4 py-2 text-sm font-medium text-text-secondary hover:bg-overlay hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50 min-h-[44px]"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isLoading || isSaving}
            className="rounded-lg bg-accent-primary px-4 py-2 text-sm font-medium text-text-inverse hover:bg-accent-primary/90 disabled:cursor-not-allowed disabled:opacity-50 flex items-center gap-2 min-h-[44px]"
          >
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Saving...
              </>
            ) : (
              'Save Settings'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
