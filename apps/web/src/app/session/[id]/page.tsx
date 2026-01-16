'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Loader2,
  RefreshCw,
  AlertCircle,
  Zap,
  Server,
  GitBranch,
  Check,
  ArrowLeft,
} from 'lucide-react';
import { Button } from '@podex/ui';
import { WorkspaceLayout } from '@/components/workspace/WorkspaceLayout';
import { AgentGrid } from '@/components/workspace/AgentGrid';
import { CommandPalette } from '@/components/workspace/CommandPalette';
import {
  getSession,
  listAgents,
  getAgentMessages,
  createAgent,
  type Session,
  type AgentResponse,
} from '@/lib/api';
import type { Agent, AgentMessage } from '@/stores/session';
import { useUser, useAuthStore } from '@/stores/auth';
import { useSessionStore } from '@/stores/session';
import { useOnboardingTour, WORKSPACE_TOUR_STEPS } from '@/components/ui/OnboardingTour';

// Agent colors for mapping
const agentColors = ['agent-1', 'agent-2', 'agent-3', 'agent-4', 'agent-5', 'agent-6'];

// Loading messages for each stage
type LoadingMessage = { progress: number; message: string; detail: string };
const loadingMessages: LoadingMessage[] = [
  { progress: 0, message: 'Connecting to pod...', detail: 'Establishing secure connection' },
  { progress: 20, message: 'Starting container...', detail: 'Initializing your environment' },
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

export default function SessionPage() {
  const params = useParams();
  const router = useRouter();
  const user = useUser();
  const isInitialized = useAuthStore((s) => s.isInitialized);
  const sessionId = params.id as string;
  const { sessions, createSession } = useSessionStore();

  // Onboarding tour
  const { startTour, hasCompleted } = useOnboardingTour();
  const hasTriggeredTourRef = useRef(false);

  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [podStatus, setPodStatus] = useState<'starting' | 'running' | 'stopped' | 'error'>(
    'starting'
  );
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [currentLoadingMessage, setCurrentLoadingMessage] =
    useState<LoadingMessage>(defaultLoadingMessage);
  const [restarting, setRestarting] = useState(false);

  // Track startup simulation interval for cleanup
  const startupIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startupTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restartTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup function for startup simulation
  const cleanupStartupSimulation = useCallback(() => {
    if (startupIntervalRef.current) {
      clearInterval(startupIntervalRef.current);
      startupIntervalRef.current = null;
    }
    if (startupTimeoutRef.current) {
      clearTimeout(startupTimeoutRef.current);
      startupTimeoutRef.current = null;
    }
  }, []);

  // Simulate startup progress
  const simulateStartup = useCallback(() => {
    // Clean up any existing simulation first
    cleanupStartupSimulation();

    let currentIndex = 0;
    startupIntervalRef.current = setInterval(() => {
      if (currentIndex < loadingMessages.length - 1) {
        currentIndex++;
        const message = loadingMessages[currentIndex];
        if (message) {
          setCurrentLoadingMessage(message);
          setLoadingProgress(message.progress);
        }
      } else {
        if (startupIntervalRef.current) {
          clearInterval(startupIntervalRef.current);
          startupIntervalRef.current = null;
        }
        // After simulation, mark as running
        startupTimeoutRef.current = setTimeout(() => {
          setPodStatus('running');
          setLoadingProgress(100);
        }, 1000);
      }
    }, 1500);
  }, [cleanupStartupSimulation]);

  useEffect(() => {
    // Wait for auth to initialize before checking user
    if (!isInitialized) {
      return;
    }

    if (!user) {
      router.push('/auth/login');
      return;
    }

    let isCancelled = false;

    async function loadSession() {
      try {
        // Fetch session and agents in parallel
        const [data, agentsData] = await Promise.all([
          getSession(sessionId),
          listAgents(sessionId),
        ]);

        // Check if request was cancelled
        if (isCancelled) return;

        setSession(data);

        // Create a default Chat agent if no agents exist (needed for onboarding)
        // Backend will use the platform default model for the 'chat' role
        let agents = agentsData;
        if (agents.length === 0) {
          try {
            const defaultAgent = await createAgent(sessionId, {
              name: 'Chat',
              role: 'chat',
            });
            agents = [defaultAgent];
          } catch {
            // If agent creation fails, continue without default agent
            console.warn('Failed to create default Chat agent');
          }
        }

        if (isCancelled) return;

        // Fetch messages for each agent
        const agentsWithMessages: Agent[] = await Promise.all(
          agents.map(async (agentResponse: AgentResponse, index: number) => {
            try {
              const messagesData = await getAgentMessages(sessionId, agentResponse.id);
              const messages: AgentMessage[] = messagesData.map((msg) => ({
                id: msg.id,
                role: msg.role,
                content: msg.content,
                timestamp: new Date(msg.created_at),
              }));

              return {
                id: agentResponse.id,
                name: agentResponse.name,
                role: agentResponse.role as Agent['role'],
                model: agentResponse.model,
                modelDisplayName: agentResponse.model_display_name ?? undefined,
                status: agentResponse.status as Agent['status'],
                color: agentColors[index % agentColors.length] ?? 'agent-1',
                messages,
                mode: (agentResponse.mode as Agent['mode']) || 'auto',
              };
            } catch {
              // If messages fail to load, return agent with empty messages
              return {
                id: agentResponse.id,
                name: agentResponse.name,
                role: agentResponse.role as Agent['role'],
                model: agentResponse.model,
                modelDisplayName: agentResponse.model_display_name ?? undefined,
                status: agentResponse.status as Agent['status'],
                color: agentColors[index % agentColors.length] ?? 'agent-1',
                messages: [],
                mode: (agentResponse.mode as Agent['mode']) || 'auto',
              };
            }
          })
        );

        if (isCancelled) return;

        // Sync session to Zustand store if not already present
        // Note: workspace_id can be null during session creation - handle gracefully
        // Components should check for valid workspaceId before performing terminal/LSP operations
        if (!sessions[sessionId]) {
          createSession({
            id: sessionId,
            name: data.name,
            workspaceId: data.workspace_id ?? '', // Store requires string, empty means no workspace yet
            branch: data.branch,
            agents: agentsWithMessages,
            filePreviews: [],
            activeAgentId: null,
            viewMode: 'grid',
            workspaceStatus: data.status === 'active' ? 'running' : 'pending',
            standbyAt: null,
            standbySettings: null,
          });
        }

        // Check pod status
        if (data.status === 'creating') {
          setPodStatus('starting');
          simulateStartup();
        } else if (data.status === 'active') {
          setPodStatus('running');
          setLoadingProgress(100);
        } else if (data.status === 'stopped') {
          setPodStatus('stopped');
        } else if (data.status === 'error') {
          setPodStatus('error');
          setError('Pod encountered an error');
        }
      } catch (err) {
        if (isCancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load session');
        setPodStatus('error');
      } finally {
        if (!isCancelled) {
          setLoading(false);
        }
      }
    }

    loadSession();

    // Cleanup on unmount or deps change
    return () => {
      isCancelled = true;
      cleanupStartupSimulation();
    };
  }, [
    sessionId,
    user,
    router,
    sessions,
    createSession,
    isInitialized,
    simulateStartup,
    cleanupStartupSimulation,
  ]);

  // Cleanup restart timeout on unmount
  useEffect(() => {
    return () => {
      if (restartTimeoutRef.current) {
        clearTimeout(restartTimeoutRef.current);
      }
    };
  }, []);

  // Trigger onboarding tour when workspace first loads
  useEffect(() => {
    if (podStatus === 'running' && !hasTriggeredTourRef.current) {
      hasTriggeredTourRef.current = true;

      // Small delay to ensure UI is fully rendered
      const timer = setTimeout(() => {
        if (!hasCompleted('workspace-tour')) {
          startTour(WORKSPACE_TOUR_STEPS, 'workspace-tour');
        }
      }, 800);

      return () => clearTimeout(timer);
    }
    return undefined;
  }, [podStatus, hasCompleted, startTour]);

  const handleRestart = async () => {
    setRestarting(true);
    setPodStatus('starting');
    setLoadingProgress(0);
    setCurrentLoadingMessage(defaultLoadingMessage);

    // Simulate restart
    simulateStartup();

    // Clear any previous restart timeout
    if (restartTimeoutRef.current) {
      clearTimeout(restartTimeoutRef.current);
    }
    restartTimeoutRef.current = setTimeout(() => {
      setRestarting(false);
    }, 8000);
  };

  // Initial loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-void flex items-center justify-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex flex-col items-center gap-4"
        >
          <div className="relative">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-accent-primary to-accent-secondary flex items-center justify-center">
              <Zap className="w-8 h-8 text-white" />
            </div>
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
              className="absolute -inset-2 rounded-2xl border-2 border-accent-primary/20 border-t-accent-primary"
            />
          </div>
          <p className="text-text-secondary">Loading session...</p>
        </motion.div>
      </div>
    );
  }

  // Error state
  if (error && podStatus === 'error') {
    return (
      <div className="min-h-screen bg-void flex items-center justify-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center max-w-md"
        >
          <div className="w-16 h-16 rounded-2xl bg-accent-error/10 flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-8 h-8 text-accent-error" />
          </div>
          <h2 className="text-xl font-semibold text-text-primary mb-2">Unable to connect to pod</h2>
          <p className="text-text-secondary mb-6">{error}</p>
          <div className="flex gap-3 justify-center">
            <Button variant="secondary" onClick={() => router.push('/dashboard')}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Dashboard
            </Button>
            <Button onClick={handleRestart}>
              <RefreshCw className="w-4 h-4 mr-2" />
              Try Again
            </Button>
          </div>
        </motion.div>
      </div>
    );
  }

  // Stopped state
  if (podStatus === 'stopped') {
    return (
      <div className="min-h-screen bg-void flex items-center justify-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center max-w-md"
        >
          <div className="w-16 h-16 rounded-2xl bg-overlay flex items-center justify-center mx-auto mb-4">
            <Server className="w-8 h-8 text-text-muted" />
          </div>
          <h2 className="text-xl font-semibold text-text-primary mb-2">Pod is stopped</h2>
          <p className="text-text-secondary mb-2">
            {session?.name || 'This workspace'} is currently not running.
          </p>
          {session?.git_url && (
            <div className="flex items-center justify-center gap-2 text-sm text-text-muted mb-6">
              <GitBranch className="w-4 h-4" />
              {session.branch}
            </div>
          )}
          <div className="flex gap-3 justify-center">
            <Button variant="secondary" onClick={() => router.push('/dashboard')}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
            <Button onClick={handleRestart} disabled={restarting}>
              {restarting ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4 mr-2" />
              )}
              Start Pod
            </Button>
          </div>
        </motion.div>
      </div>
    );
  }

  // Starting state - beautiful loading screen
  if (podStatus === 'starting') {
    return (
      <div className="min-h-screen bg-void flex items-center justify-center">
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
            {session?.name || 'Starting Pod'}
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
            {['Container', 'Workspace', 'Config'].map((step, i) => {
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

          {/* Cancel button */}
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

  // Running state - show workspace
  return (
    <WorkspaceLayout sessionId={sessionId}>
      <AgentGrid sessionId={sessionId} />
      <CommandPalette />
    </WorkspaceLayout>
  );
}
