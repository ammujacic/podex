'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft,
  Check,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Server,
  Clock,
  WifiOff,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '@podex/ui';
import { getWorkspaceStatus, resumeWorkspace } from '@/lib/api';
import { useSessionStore } from '@/stores/session';

type WorkspaceStatus =
  | 'pending'
  | 'running'
  | 'standby'
  | 'stopped'
  | 'error'
  | 'offline'
  | undefined;

type LoadingMessage = { progress: number; message: string; detail: string };

const loadingMessages: LoadingMessage[] = [
  { progress: 0, message: 'Connecting to pod...', detail: 'Establishing secure connection' },
  { progress: 20, message: 'Starting pod...', detail: 'Initializing your environment' },
  {
    progress: 40,
    message: 'Loading workspace...',
    detail: 'Syncing your files from cloud storage',
  },
  { progress: 60, message: 'Installing packages...', detail: 'Setting up project dependencies' },
  { progress: 80, message: 'Syncing configuration...', detail: 'Applying your preferences' },
  { progress: 95, message: 'Almost ready...', detail: 'Finalizing workspace setup' },
];

const defaultLoadingMessage: LoadingMessage = loadingMessages[0] ?? {
  progress: 0,
  message: 'Loading...',
  detail: 'Please wait',
};

interface WorkspaceStatusOverlayProps {
  sessionId: string;
  status: WorkspaceStatus;
  isCheckingStatus?: boolean;
  sessionName?: string | null;
  workspaceId?: string | null;
}

export function WorkspaceStatusOverlay({
  sessionId,
  status,
  isCheckingStatus = false,
  sessionName,
  workspaceId,
}: WorkspaceStatusOverlayProps) {
  const router = useRouter();
  const setWorkspaceStatus = useSessionStore((state) => state.setWorkspaceStatus);
  const setWorkspaceStatusChecking = useSessionStore((state) => state.setWorkspaceStatusChecking);

  const [loadingProgress, setLoadingProgress] = useState(defaultLoadingMessage.progress);
  const [currentLoadingMessage, setCurrentLoadingMessage] =
    useState<LoadingMessage>(defaultLoadingMessage);
  const [isTimedOut, setIsTimedOut] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);

  // Resume state
  const [isResuming, setIsResuming] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);

  const startupIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (status !== 'pending') {
      if (startupIntervalRef.current) {
        clearInterval(startupIntervalRef.current);
        startupIntervalRef.current = null;
      }
      return;
    }

    setCurrentLoadingMessage(defaultLoadingMessage);
    setLoadingProgress(defaultLoadingMessage.progress);

    let currentIndex = 0;
    startupIntervalRef.current = setInterval(() => {
      if (currentIndex < loadingMessages.length - 1) {
        currentIndex += 1;
        const message = loadingMessages[currentIndex];
        if (message) {
          setCurrentLoadingMessage(message);
          setLoadingProgress(message.progress);
        }
      } else if (startupIntervalRef.current) {
        clearInterval(startupIntervalRef.current);
        startupIntervalRef.current = null;
      }
    }, 1500);

    return () => {
      if (startupIntervalRef.current) {
        clearInterval(startupIntervalRef.current);
        startupIntervalRef.current = null;
      }
    };
  }, [status]);

  useEffect(() => {
    if (!isCheckingStatus) {
      setIsTimedOut(false);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      return;
    }

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      setIsTimedOut(true);
    }, 60000);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [isCheckingStatus]);

  const handleRetryStatus = async () => {
    if (!workspaceId || isRetrying) return;
    setIsRetrying(true);
    setIsTimedOut(false);
    setWorkspaceStatusChecking(sessionId, true);

    try {
      const workspaceStatus = await getWorkspaceStatus(workspaceId);
      setWorkspaceStatus(sessionId, workspaceStatus.status, workspaceStatus.standby_at ?? null);
      setWorkspaceStatusChecking(sessionId, false);
    } catch (err) {
      console.warn('Failed to refresh workspace status:', err);
      setWorkspaceStatusChecking(sessionId, false);
      setIsTimedOut(true);
    } finally {
      setIsRetrying(false);
    }
  };

  const handleResume = async () => {
    if (!workspaceId || isResuming) return;
    setIsResuming(true);
    setResumeError(null);

    try {
      const result = await resumeWorkspace(workspaceId);
      setWorkspaceStatus(sessionId, result.status, null);
      // Status will change to 'running' or 'pending', which will hide this overlay
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to resume workspace';
      // If workspace is already running, it's actually a success - just update the status
      if (errorMessage.includes("'running' state") || errorMessage.includes('already running')) {
        setWorkspaceStatus(sessionId, 'running', null);
        return;
      }
      console.error('Failed to resume workspace:', err);
      setResumeError(errorMessage);
    } finally {
      setIsResuming(false);
    }
  };

  if (status === 'pending' && isCheckingStatus) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-void">
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex flex-col items-center gap-4 rounded-2xl border border-border-default bg-surface/90 px-8 py-6 text-center shadow-2xl"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent-primary/10">
            <Loader2 className="h-6 w-6 text-accent-primary animate-spin" />
          </div>
          <div>
            <p className="text-base font-semibold text-text-primary">Checking compute status</p>
            <p className="text-sm text-text-muted">
              {isTimedOut
                ? 'Still checking. Try again to refresh.'
                : 'Fetching the latest pod state...'}
            </p>
          </div>
          {isTimedOut && (
            <Button onClick={handleRetryStatus} disabled={isRetrying || !workspaceId}>
              {isRetrying ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Retrying...
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Retry
                </>
              )}
            </Button>
          )}
        </motion.div>
      </div>
    );
  }

  if (status === 'pending') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-void">
        {/* Background effects */}
        <div className="fixed inset-0 -z-10 overflow-hidden">
          <motion.div
            animate={{
              scale: [1, 1.2, 1],
              opacity: [0.3, 0.5, 0.3],
            }}
            transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
            className="absolute top-1/3 left-1/3 h-[600px] w-[600px] rounded-full bg-accent-primary/10 blur-3xl"
          />
          <motion.div
            animate={{
              scale: [1.2, 1, 1.2],
              opacity: [0.3, 0.5, 0.3],
            }}
            transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut', delay: 2 }}
            className="absolute bottom-1/3 right-1/3 h-[600px] w-[600px] rounded-full bg-accent-secondary/10 blur-3xl"
          />
        </div>

        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center max-w-lg px-6"
        >
          {/* Animated Logo */}
          <div className="relative mx-auto mb-8 w-fit">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
              className="absolute -inset-8 opacity-20"
            >
              {[...Array(8)].map((_, i) => (
                <motion.div
                  key={i}
                  className="absolute w-2 h-2 rounded-full bg-accent-primary"
                  style={{
                    top: '50%',
                    left: '50%',
                    transform: `rotate(${i * 45}deg) translateX(40px) translateY(-50%)`,
                  }}
                  animate={{
                    opacity: [0.2, 1, 0.2],
                    scale: [0.8, 1.2, 0.8],
                  }}
                  transition={{
                    duration: 2,
                    repeat: Infinity,
                    delay: i * 0.2,
                  }}
                />
              ))}
            </motion.div>
            <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-accent-primary to-accent-secondary flex items-center justify-center relative z-10">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
              >
                <Loader2 className="w-12 h-12 text-white" />
              </motion.div>
            </div>
          </div>

          {/* Session Name */}
          <motion.h1
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-2xl font-bold text-text-primary mb-2"
          >
            {sessionName || 'Connecting to Pod'}
          </motion.h1>

          {/* Current Status */}
          <AnimatePresence mode="wait">
            <motion.div
              key={currentLoadingMessage.message}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="mb-2"
            >
              <p className="text-text-secondary text-lg">{currentLoadingMessage.message}</p>
              <p className="text-text-muted text-sm">{currentLoadingMessage.detail}</p>
            </motion.div>
          </AnimatePresence>

          {/* Progress Bar */}
          <div className="mt-8 mb-4">
            <div className="w-full bg-overlay rounded-full h-2 overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${loadingProgress}%` }}
                transition={{ duration: 0.5, ease: 'easeOut' }}
                className="h-full bg-gradient-to-r from-accent-primary to-accent-secondary rounded-full relative"
              >
                <motion.div
                  animate={{ x: ['-100%', '100%'] }}
                  transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
                  className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent"
                />
              </motion.div>
            </div>
            <p className="text-sm text-text-muted mt-2">{loadingProgress}%</p>
          </div>

          {/* Status Steps */}
          <div className="flex justify-center gap-4 mt-6 text-xs text-text-muted">
            {['Pod', 'Workspace', 'Config'].map((step, i) => {
              const stepProgress = i === 0 ? 20 : i === 1 ? 60 : 95;
              const isComplete = loadingProgress >= stepProgress;
              const isActive =
                loadingProgress < stepProgress &&
                loadingProgress >= (i === 0 ? 0 : i === 1 ? 20 : 60);

              return (
                <div key={step} className="flex items-center gap-1.5">
                  <div
                    className={`w-4 h-4 rounded-full flex items-center justify-center ${
                      isComplete
                        ? 'bg-accent-success text-white'
                        : isActive
                          ? 'bg-accent-primary/20 text-accent-primary'
                          : 'bg-overlay text-text-muted'
                    }`}
                  >
                    {isComplete ? (
                      <Check className="w-2.5 h-2.5" />
                    ) : isActive ? (
                      <motion.div
                        animate={{ opacity: [1, 0.5, 1] }}
                        transition={{ duration: 1, repeat: Infinity }}
                        className="w-1.5 h-1.5 rounded-full bg-current"
                      />
                    ) : (
                      <span className="w-1.5 h-1.5 rounded-full bg-current" />
                    )}
                  </div>
                  <span className={isComplete || isActive ? 'text-text-secondary' : ''}>
                    {step}
                  </span>
                </div>
              );
            })}
          </div>

          <button
            onClick={() => router.push('/dashboard')}
            className="mt-8 text-sm text-text-muted hover:text-text-secondary transition-colors"
          >
            Cancel and return to dashboard
          </button>
        </motion.div>
      </div>
    );
  }

  if (status === 'offline') {
    return (
      <div className="fixed inset-0 z-40 flex items-center justify-center">
        <div className="absolute inset-0 bg-void/75 backdrop-blur-md" aria-hidden="true" />
        <div className="relative w-full max-w-md rounded-2xl border border-border-default bg-surface/90 p-6 shadow-2xl">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-red-500/15">
              <WifiOff className="h-5 w-5 text-red-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-text-primary">Local Pod Offline</h2>
              <p className="text-sm text-text-muted">
                {sessionName ? `Connection to ${sessionName} lost` : 'Connection to local pod lost'}
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-border-subtle bg-overlay/60 p-4 text-sm text-text-secondary">
            <div className="flex items-start gap-3">
              <Server className="h-5 w-5 text-text-muted mt-0.5" />
              <div>
                <p className="text-text-secondary">
                  Your local pod has disconnected. This workspace will automatically reconnect when
                  the local pod comes back online.
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-start gap-3 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 mt-4">
            <Clock className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" aria-hidden="true" />
            <p className="text-xs text-blue-200/80">
              Make sure your local pod application is running and connected to the internet.
            </p>
          </div>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
            <Button
              variant="secondary"
              onClick={() => router.push('/dashboard')}
              className="w-full sm:w-auto"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Dashboard
            </Button>
            <Button onClick={handleRetryStatus} disabled={isRetrying || !workspaceId}>
              {isRetrying ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Checking...
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Check Status
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (status !== 'standby') {
    return null;
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center">
      <div className="absolute inset-0 bg-void/75 backdrop-blur-md" aria-hidden="true" />
      <div className="relative w-full max-w-md rounded-2xl border border-border-default bg-surface/90 p-6 shadow-2xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-500/15">
            <Pause className="h-5 w-5 text-amber-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-text-primary">Compute in standby</h2>
            <p className="text-sm text-text-muted">
              {sessionName ? `${sessionName} is paused` : 'Your session is paused'}
            </p>
          </div>
        </div>

        <div className="rounded-lg border border-border-subtle bg-overlay/60 p-4 text-sm text-text-secondary">
          <div className="flex items-start gap-3">
            <Server className="h-5 w-5 text-text-muted mt-0.5" />
            <div>
              <p className="text-text-secondary">
                Your compute was paused to save resources. Resume to reconnect and continue working.
              </p>
            </div>
          </div>
        </div>

        {/* Time estimate info */}
        <div className="flex items-start gap-3 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 mt-4">
          <Clock className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" aria-hidden="true" />
          <p className="text-xs text-blue-200/80">
            Resuming may take 10-30 seconds while we restart your pod.
          </p>
        </div>

        {resumeError && (
          <div
            className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm mt-4"
            role="alert"
            aria-live="polite"
          >
            {resumeError}
          </div>
        )}

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
          <Button
            variant="secondary"
            onClick={() => router.push('/dashboard')}
            disabled={isResuming}
            className="w-full sm:w-auto"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Dashboard
          </Button>
          <Button
            onClick={handleResume}
            disabled={!workspaceId || isResuming}
            className="w-full sm:w-auto"
          >
            {isResuming ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Resuming...
              </>
            ) : (
              <>
                <Play className="h-4 w-4 mr-2" />
                Resume Session
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
