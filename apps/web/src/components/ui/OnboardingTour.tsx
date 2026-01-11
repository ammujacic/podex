'use client';

import {
  useState,
  useEffect,
  useCallback,
  createContext,
  useContext,
  useRef,
  useId,
  useLayoutEffect,
} from 'react';
import { X, ChevronRight, ChevronLeft, Sparkles } from 'lucide-react';
import { Button } from '@podex/ui';
import { cn } from '@/lib/utils';
import {
  getCompletedTours,
  completeTour as completeTourApi,
  resetAllTours as resetAllToursApi,
} from '@/lib/api';
import { useAuthStore } from '@/stores/auth';

interface TourStep {
  id: string;
  target: string; // CSS selector
  title: string;
  description: string;
  placement?: 'top' | 'bottom' | 'left' | 'right';
  spotlight?: boolean;
  action?: {
    label: string;
    onClick: () => void;
  };
}

interface OnboardingTourContextValue {
  isActive: boolean;
  currentStep: number;
  steps: TourStep[];
  currentTourId: string | null;
  startTour: (steps: TourStep[], tourId?: string) => void;
  endTour: () => void;
  nextStep: () => void;
  prevStep: () => void;
  goToStep: (index: number) => void;
  markAsComplete: (tourId: string) => void;
  hasCompleted: (tourId: string) => boolean;
  resetAllTours: () => void;
}

const OnboardingTourContext = createContext<OnboardingTourContextValue | null>(null);

export function useOnboardingTour() {
  const context = useContext(OnboardingTourContext);
  if (!context) {
    throw new Error('useOnboardingTour must be used within OnboardingTourProvider');
  }
  return context;
}

interface OnboardingTourProviderProps {
  children: React.ReactNode;
}

const STORAGE_KEY = 'podex-completed-tours';
const FETCHED_SESSION_KEY = 'podex-tours-fetched';

export function OnboardingTourProvider({ children }: OnboardingTourProviderProps) {
  const [isActive, setIsActive] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [steps, setSteps] = useState<TourStep[]>([]);
  const [completedTours, setCompletedTours] = useState<string[]>([]);
  const [currentTourId, setCurrentTourId] = useState<string | null>(null);
  const { tokens, isInitialized } = useAuthStore();

  // Load completed tours from localStorage and sync with backend (once per session)
  useEffect(() => {
    // First, load from localStorage for immediate availability
    const stored = localStorage.getItem(STORAGE_KEY);
    let localTours: string[] = [];
    if (stored) {
      try {
        localTours = JSON.parse(stored);
        setCompletedTours(localTours);
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }
    }

    // Only fetch from backend once per session (sessionStorage persists across navigation but not tab close)
    const alreadyFetched = sessionStorage.getItem(FETCHED_SESSION_KEY);
    if (!alreadyFetched && isInitialized && tokens?.accessToken) {
      sessionStorage.setItem(FETCHED_SESSION_KEY, 'true');
      getCompletedTours()
        .then((response) => {
          const backendTours = response.completed_tours || [];
          // Merge: union of localStorage and backend tours
          const merged = [...new Set([...localTours, ...backendTours])];
          setCompletedTours(merged);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
        })
        .catch(() => {
          // Silently fail - localStorage will work as fallback
          sessionStorage.removeItem(FETCHED_SESSION_KEY);
        });
    }
  }, [isInitialized, tokens?.accessToken]);

  const startTour = useCallback((newSteps: TourStep[], tourId?: string) => {
    setSteps(newSteps);
    setCurrentStep(0);
    setCurrentTourId(tourId ?? null);
    setIsActive(true);
  }, []);

  const endTour = useCallback(() => {
    setIsActive(false);
    setCurrentStep(0);
    setSteps([]);
    setCurrentTourId(null);
  }, []);

  const nextStep = useCallback(() => {
    if (currentStep < steps.length - 1) {
      setCurrentStep((prev) => prev + 1);
    } else {
      endTour();
    }
  }, [currentStep, steps.length, endTour]);

  const prevStep = useCallback(() => {
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1);
    }
  }, [currentStep]);

  const goToStep = useCallback(
    (index: number) => {
      if (index >= 0 && index < steps.length) {
        setCurrentStep(index);
      }
    },
    [steps.length]
  );

  const markAsComplete = useCallback((tourId: string) => {
    setCompletedTours((prev) => {
      if (prev.includes(tourId)) return prev;
      const updated = [...prev, tourId];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
    // Sync to backend (fire and forget, localStorage is fallback)
    completeTourApi(tourId).catch(() => {
      // Silently fail - localStorage already has the data
    });
  }, []);

  const hasCompleted = useCallback(
    (tourId: string) => completedTours.includes(tourId),
    [completedTours]
  );

  const resetAllTours = useCallback(() => {
    setCompletedTours([]);
    localStorage.removeItem(STORAGE_KEY);
    // Sync to backend (fire and forget)
    resetAllToursApi().catch(() => {
      // Silently fail - localStorage already cleared
    });
  }, []);

  return (
    <OnboardingTourContext.Provider
      value={{
        isActive,
        currentStep,
        steps,
        currentTourId,
        startTour,
        endTour,
        nextStep,
        prevStep,
        goToStep,
        markAsComplete,
        hasCompleted,
        resetAllTours,
      }}
    >
      {children}
      {isActive && <TourOverlay />}
    </OnboardingTourContext.Provider>
  );
}

function TourOverlay() {
  const {
    steps,
    currentStep,
    nextStep,
    prevStep,
    endTour,
    goToStep,
    currentTourId,
    markAsComplete,
  } = useOnboardingTour();
  const step = steps[currentStep];
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const [isSearching, setIsSearching] = useState(true);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const retryCountRef = useRef(0);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [tooltipHeight, setTooltipHeight] = useState(200); // Default estimate
  const foundElementRef = useRef(false);
  const maxRetries = 50; // Max ~2.5 seconds of retrying (50 * 50ms)

  // Track which steps have been viewed (for dot indicators)
  const [visitedSteps, setVisitedSteps] = useState<Set<number>>(() => new Set([0]));

  // Mark current step as visited when it changes
  useEffect(() => {
    setVisitedSteps((prev) => {
      if (prev.has(currentStep)) return prev;
      const next = new Set(prev);
      next.add(currentStep);
      return next;
    });
  }, [currentStep]);

  // Unique ID for SVG mask to prevent collisions
  const maskId = useId();

  // Measure tooltip height after render using layoutEffect for accuracy
  useLayoutEffect(() => {
    if (tooltipRef.current) {
      const height = tooltipRef.current.getBoundingClientRect().height;
      if (height > 0) {
        setTooltipHeight(height);
      }
    }
  }, [currentStep, step]);

  // Find and track target element with retry mechanism
  useEffect(() => {
    if (!step?.target) return;

    let rafId: number;
    let timeoutId: ReturnType<typeof setTimeout>;
    let isCancelled = false;
    let transitionTimeoutFired = false;
    retryCountRef.current = 0;
    foundElementRef.current = false;

    // Brief transition state to prevent flicker
    setIsTransitioning(true);
    setIsSearching(true);

    // Small delay before clearing targetRect to allow smooth transition
    // This timeout will be cancelled if element is found quickly
    const transitionTimeoutId = setTimeout(() => {
      if (!isCancelled) {
        transitionTimeoutFired = true;
        setTargetRect(null);
        setIsTransitioning(false);
      }
    }, 50);

    const updatePosition = () => {
      if (isCancelled) return false;

      const element = document.querySelector(step.target);
      if (element) {
        const rect = element.getBoundingClientRect();
        // Only accept valid rects (element is visible and has dimensions)
        if (rect.width > 0 && rect.height > 0) {
          // Cancel the transition timeout if it hasn't fired yet
          // This prevents the race condition where timeout clears targetRect after we set it
          if (!transitionTimeoutFired) {
            clearTimeout(transitionTimeoutId);
          }
          setTargetRect(rect);
          setIsSearching(false);
          setIsTransitioning(false);
          foundElementRef.current = true;
          retryCountRef.current = 0;
          return true;
        }
      }
      return false;
    };

    const tryFindElement = () => {
      if (isCancelled) return;

      const found = updatePosition();
      if (!found && retryCountRef.current < maxRetries) {
        retryCountRef.current++;
        // Use RAF + timeout for smoother retries
        timeoutId = setTimeout(() => {
          rafId = requestAnimationFrame(tryFindElement);
        }, 50);
      } else if (!found) {
        // Give up after max retries, show centered tooltip
        setIsSearching(false);
        setIsTransitioning(false);
      }
    };

    // Start searching
    rafId = requestAnimationFrame(tryFindElement);

    // Update on resize/scroll (using ref to track if element was found)
    const handleReposition = () => {
      if (foundElementRef.current) {
        updatePosition();
      }
    };

    window.addEventListener('resize', handleReposition);
    window.addEventListener('scroll', handleReposition, true);

    return () => {
      isCancelled = true;
      clearTimeout(transitionTimeoutId);
      cancelAnimationFrame(rafId);
      clearTimeout(timeoutId);
      window.removeEventListener('resize', handleReposition);
      window.removeEventListener('scroll', handleReposition, true);
    };
  }, [step?.target]);

  // Handle keyboard navigation (disabled during search/transition to prevent weird states)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Always allow Escape to close
      if (e.key === 'Escape') {
        endTour();
        return;
      }

      // Disable navigation while searching or transitioning
      if (isSearching || isTransitioning) {
        return;
      }

      if (e.key === 'ArrowRight' || e.key === 'Enter') {
        nextStep();
      } else if (e.key === 'ArrowLeft') {
        prevStep();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [endTour, nextStep, prevStep, isSearching, isTransitioning]);

  if (!step) return null;

  const placement = step.placement || 'bottom';
  const isFirstStep = currentStep === 0;
  const isLastStep = currentStep === steps.length - 1;

  // Show spotlight only when we have a valid target and not transitioning
  const showSpotlight = step.spotlight && targetRect && !isSearching && !isTransitioning;

  // Calculate tooltip position with proper bounds checking
  const getTooltipStyles = (): React.CSSProperties => {
    if (!targetRect || isSearching) {
      return {
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
      };
    }

    const padding = 16;
    const tooltipWidth = 320;

    // Helper to clamp horizontal position
    const clampHorizontal = (idealLeft: number) =>
      Math.max(padding, Math.min(idealLeft, window.innerWidth - tooltipWidth - padding));

    // Helper to clamp vertical position (accounting for tooltip height)
    const clampVertical = (idealTop: number) =>
      Math.max(padding, Math.min(idealTop, window.innerHeight - tooltipHeight - padding));

    switch (placement) {
      case 'top': {
        // Position tooltip above target, with bounds checking
        const idealTop = targetRect.top - tooltipHeight - padding;
        const clampedTop = clampVertical(idealTop);
        const horizontalCenter = targetRect.left + targetRect.width / 2 - tooltipWidth / 2;
        return {
          position: 'fixed',
          top: `${clampedTop}px`,
          left: `${clampHorizontal(horizontalCenter)}px`,
        };
      }
      case 'bottom': {
        // Position tooltip below target, with bounds checking
        const idealTop = targetRect.bottom + padding;
        const clampedTop = clampVertical(idealTop);
        const horizontalCenter = targetRect.left + targetRect.width / 2 - tooltipWidth / 2;
        return {
          position: 'fixed',
          top: `${clampedTop}px`,
          left: `${clampHorizontal(horizontalCenter)}px`,
        };
      }
      case 'left': {
        // Position tooltip to the left of target, vertically centered
        // Calculate the ideal centered position first, then clamp
        const targetCenterY = targetRect.top + targetRect.height / 2;
        const idealTop = targetCenterY - tooltipHeight / 2;
        const clampedTop = clampVertical(idealTop);
        return {
          position: 'fixed',
          top: `${clampedTop}px`,
          right: `${window.innerWidth - targetRect.left + padding}px`,
        };
      }
      case 'right': {
        // Position tooltip to the right of target, vertically centered
        // Calculate the ideal centered position first, then clamp
        const targetCenterY = targetRect.top + targetRect.height / 2;
        const idealTop = targetCenterY - tooltipHeight / 2;
        const clampedTop = clampVertical(idealTop);
        return {
          position: 'fixed',
          top: `${clampedTop}px`,
          left: `${targetRect.right + padding}px`,
        };
      }
      default:
        return {};
    }
  };

  // Don't render anything while transitioning to prevent flicker
  const isReady = !isTransitioning && !isSearching;

  return (
    <>
      {/* Backdrop with spotlight */}
      <div
        className={cn(
          'fixed inset-0 z-[9998] transition-opacity duration-200',
          isReady ? 'opacity-100' : 'opacity-90'
        )}
      >
        {showSpotlight && targetRect ? (
          <svg className="absolute inset-0 w-full h-full" style={{ isolation: 'isolate' }}>
            <defs>
              <mask id={maskId}>
                <rect x="0" y="0" width="100%" height="100%" fill="white" />
                <rect
                  x={targetRect.left - 8}
                  y={targetRect.top - 8}
                  width={targetRect.width + 16}
                  height={targetRect.height + 16}
                  rx="8"
                  fill="black"
                />
              </mask>
            </defs>
            <rect
              x="0"
              y="0"
              width="100%"
              height="100%"
              fill="rgba(7, 7, 10, 0.85)"
              mask={`url(#${maskId})`}
            />
          </svg>
        ) : (
          <div className="absolute inset-0 bg-void/85 backdrop-blur-sm" />
        )}
      </div>

      {/* Spotlight ring - with smooth transitions */}
      {showSpotlight && targetRect && (
        <div
          className="fixed z-[9999] pointer-events-none rounded-lg ring-2 ring-accent-primary animate-pulse-glow transition-all duration-300 ease-out"
          style={{
            left: targetRect.left - 8,
            top: targetRect.top - 8,
            width: targetRect.width + 16,
            height: targetRect.height + 16,
          }}
        />
      )}

      {/* Loading indicator while searching */}
      {isSearching && !isTransitioning && (
        <div className="fixed z-[10000] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
          <div className="flex items-center gap-2 px-4 py-2 bg-surface border border-border-default rounded-lg shadow-modal">
            <div className="w-4 h-4 border-2 border-accent-primary border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-text-secondary">Finding element...</span>
          </div>
        </div>
      )}

      {/* Tooltip - with smooth position transitions */}
      <div
        ref={tooltipRef}
        className={cn(
          'fixed z-[10000] w-80 bg-surface border border-border-default rounded-xl shadow-modal',
          'transition-all duration-300 ease-out',
          isReady ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
        )}
        style={getTooltipStyles()}
        role="dialog"
        aria-modal="true"
        aria-label={step.title}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border-subtle">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-accent-primary" />
            <span className="text-sm font-medium text-text-primary">{step.title}</span>
          </div>
          <button
            onClick={endTour}
            className="p-1 rounded hover:bg-overlay transition-colors"
            aria-label="Close tour"
          >
            <X className="w-4 h-4 text-text-muted" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4">
          <p className="text-sm text-text-secondary leading-relaxed">{step.description}</p>

          {step.action && (
            <Button onClick={step.action.onClick} variant="link" size="sm" className="mt-2 p-0">
              {step.action.label}
            </Button>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-col gap-3 p-4 border-t border-border-subtle">
          {/* Don't show again checkbox - only show on last step */}
          {isLastStep && currentTourId && (
            <label className="flex items-center gap-2 text-xs text-text-muted cursor-pointer hover:text-text-secondary">
              <input
                type="checkbox"
                checked={dontShowAgain}
                onChange={(e) => setDontShowAgain(e.target.checked)}
                className="w-3.5 h-3.5 rounded border-border-default bg-elevated accent-accent-primary cursor-pointer"
              />
              Don&apos;t show this tutorial again
            </label>
          )}

          <div className="flex items-center justify-between">
            {/* Progress dots */}
            <div className="flex items-center gap-1.5">
              {steps.map((stepItem, index) => {
                const isCurrentStep = index === currentStep;
                const isVisited = visitedSteps.has(index);

                return (
                  <button
                    key={stepItem.id}
                    onClick={() => goToStep(index)}
                    disabled={isSearching || isTransitioning}
                    className={cn(
                      'w-2 h-2 rounded-full transition-all duration-200 ease-out cursor-pointer',
                      'disabled:cursor-not-allowed disabled:opacity-50',
                      isCurrentStep
                        ? 'bg-accent-primary scale-125 ring-2 ring-accent-primary/30'
                        : isVisited
                          ? 'bg-accent-primary/60 hover:bg-accent-primary/80 hover:scale-110'
                          : 'bg-border-default hover:bg-border-subtle hover:scale-110'
                    )}
                    aria-label={`Go to step ${index + 1}: ${stepItem.title}${isVisited && !isCurrentStep ? ' (viewed)' : ''}`}
                    aria-current={isCurrentStep ? 'step' : undefined}
                    title={`${stepItem.title}${isVisited && !isCurrentStep ? ' (viewed)' : ''}`}
                  />
                );
              })}
            </div>

            {/* Navigation */}
            <div className="flex items-center gap-2">
              {!isFirstStep && (
                <Button
                  onClick={prevStep}
                  variant="ghost"
                  size="sm"
                  disabled={isSearching || isTransitioning}
                >
                  <ChevronLeft className="w-4 h-4" />
                  Back
                </Button>
              )}
              <Button
                onClick={() => {
                  if (isLastStep && dontShowAgain && currentTourId) {
                    markAsComplete(currentTourId);
                  }
                  nextStep();
                }}
                variant="primary"
                size="sm"
                disabled={isSearching || isTransitioning}
              >
                {isLastStep ? 'Finish' : 'Next'}
                {!isLastStep && <ChevronRight className="w-4 h-4" />}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// Pre-defined tour steps for common flows
export const WORKSPACE_TOUR_STEPS: TourStep[] = [
  {
    id: 'welcome',
    target: '[data-tour="workspace-header"]',
    title: 'Welcome to Your AI Workspace',
    description:
      "This is your development environment powered by AI agents. Let's take a quick tour of the key features!",
    placement: 'bottom',
    spotlight: true,
  },
  {
    id: 'agents',
    target: '[data-tour="agent-grid"]',
    title: 'Your AI Team',
    description:
      'Meet your AI agents! Each specializes in different tasks - Architect plans your system, Coders implement features, and QA tests your code. Click any agent to start a conversation.',
    placement: 'bottom',
    spotlight: true,
  },
  {
    id: 'agent-input',
    target: '[data-tour="agent-input"]',
    title: 'Chat with Agents',
    description:
      "Type your request here to communicate with agents. Be specific about what you need - the more context you provide, the better results you'll get!",
    placement: 'top',
    spotlight: true,
  },
  {
    id: 'sidebar',
    target: '[data-tour="sidebar"]',
    title: 'File Explorer',
    description:
      'Browse your project files here. Click any file to preview it, or drag files to agents to give them context about your codebase.',
    placement: 'right',
    spotlight: true,
  },
  {
    id: 'terminal',
    target: '[data-tour="terminal-toggle"]',
    title: 'Integrated Terminal',
    description:
      'Press ` (backtick) to toggle the terminal. Run commands, see agent executions, and interact with your development environment.',
    placement: 'top',
    spotlight: true,
  },
  {
    id: 'command-palette',
    target: '[data-tour="command-palette-trigger"]',
    title: 'Command Palette',
    description:
      'Press Cmd+K (or Ctrl+K) to open the command palette. Search files, switch between agents, change settings, and access all features quickly!',
    placement: 'bottom',
    spotlight: true,
  },
  {
    id: 'ready',
    target: '[data-tour="agent-grid"]',
    title: "You're All Set!",
    description:
      'Start by telling an agent what you want to build. Need help anytime? Press Cmd+/ for keyboard shortcuts or Cmd+K to search.',
    placement: 'bottom',
    spotlight: false,
  },
];

export const DASHBOARD_TOUR_STEPS: TourStep[] = [
  {
    id: 'dashboard-welcome',
    target: '[data-tour="dashboard-header"]',
    title: 'Welcome to Podex',
    description:
      'This is your dashboard. Create new sessions, manage your work, and track your usage.',
    placement: 'bottom',
    spotlight: true,
  },
  {
    id: 'new-session',
    target: '[data-tour="new-session-btn"]',
    title: 'Create a New Session',
    description: 'Click here to start a new development session with AI agents.',
    placement: 'bottom',
    spotlight: true,
  },
  {
    id: 'sessions-list',
    target: '[data-tour="sessions-list"]',
    title: 'Your Sessions',
    description: 'All your development sessions appear here. Click any session to resume working.',
    placement: 'top',
    spotlight: true,
  },
  {
    id: 'quick-actions',
    target: '[data-tour="quick-actions"]',
    title: 'Quick Actions',
    description: 'Use these shortcuts to quickly start common tasks or access recent work.',
    placement: 'left',
    spotlight: true,
  },
];

// Helper hook to start a specific tour
export function useTourTrigger(tourId: string, steps: TourStep[]) {
  const { startTour, hasCompleted, markAsComplete } = useOnboardingTour();

  const trigger = useCallback(() => {
    startTour(steps, tourId);
  }, [startTour, steps, tourId]);

  const triggerIfNew = useCallback(() => {
    if (!hasCompleted(tourId)) {
      startTour(steps, tourId);
    }
  }, [hasCompleted, tourId, startTour, steps]);

  const complete = useCallback(() => {
    markAsComplete(tourId);
  }, [markAsComplete, tourId]);

  return { trigger, triggerIfNew, complete, hasCompleted: hasCompleted(tourId) };
}
