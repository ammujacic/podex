'use client';

import { useEffect, useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@podex/ui';
import { Button } from '@podex/ui';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Download,
  ExternalLink,
  HardDrive,
  Loader2,
  Play,
  Rocket,
  Server,
  SkipForward,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type SetupStep =
  | 'welcome'
  | 'docker'
  | 'llm_choice'
  | 'ollama_setup'
  | 'lmstudio_setup'
  | 'local_pod'
  | 'complete';

interface SetupStepState {
  step: SetupStep;
  status: 'pending' | 'in_progress' | 'completed' | 'skipped' | 'error';
  message: string | null;
  canSkip: boolean;
  canContinue: boolean;
}

interface SetupState {
  currentStep: SetupStep;
  steps: Record<SetupStep, SetupStepState>;
  hasCompletedSetup: boolean;
  llmChoice: 'ollama' | 'lmstudio' | 'none' | null;
}

interface GuidedSetupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const STEP_INFO: Record<SetupStep, { title: string; description: string; icon: React.ReactNode }> =
  {
    welcome: {
      title: 'Welcome to Local Development',
      description: 'Set up your machine for local workspaces and AI',
      icon: <Rocket className="w-8 h-8" />,
    },
    docker: {
      title: 'Docker Setup',
      description: 'Docker is required for running local workspaces',
      icon: <Server className="w-8 h-8" />,
    },
    llm_choice: {
      title: 'Choose Your Local LLM',
      description: 'Select how you want to run AI models locally',
      icon: <span className="text-4xl">🤖</span>,
    },
    ollama_setup: {
      title: 'Ollama Setup',
      description: 'Install and configure Ollama for local inference',
      icon: <span className="text-4xl">🦙</span>,
    },
    lmstudio_setup: {
      title: 'LM Studio Setup',
      description: 'Configure LM Studio for local inference',
      icon: <span className="text-4xl">🎛️</span>,
    },
    local_pod: {
      title: 'Local Pod',
      description: 'Register this machine to run workspaces locally',
      icon: <HardDrive className="w-8 h-8" />,
    },
    complete: {
      title: 'Setup Complete!',
      description: "You're all set for local development",
      icon: <CheckCircle2 className="w-8 h-8 text-green-500" />,
    },
  };

export function GuidedSetupDialog({ open, onOpenChange }: GuidedSetupDialogProps) {
  const [state, setState] = useState<SetupState | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  const loadState = useCallback(async () => {
    const electron = window.electronAPI;
    if (!electron) return;

    try {
      const setupState = await electron.localServices.setup.getState();
      setState(setupState);
    } catch (error) {
      console.error('Failed to load setup state:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      loadState();

      const electron = window.electronAPI;
      if (electron) {
        const unsubscribe = electron.localServices.setup.onStateChange((newState: SetupState) => {
          setState(newState);
        });

        return () => {
          unsubscribe();
        };
      }
    }
    return undefined;
  }, [open, loadState]);

  const handleNext = async () => {
    const electron = window.electronAPI;
    if (!electron) return;
    setActionLoading(true);
    try {
      await electron.localServices.setup.next();
    } finally {
      setActionLoading(false);
    }
  };

  const handlePrevious = async () => {
    const electron = window.electronAPI;
    if (!electron) return;
    await electron.localServices.setup.previous();
  };

  const handleSkip = async () => {
    const electron = window.electronAPI;
    if (!electron) return;
    await electron.localServices.setup.skip();
  };

  const handleSetLLMChoice = async (choice: 'ollama' | 'lmstudio' | 'none') => {
    const electron = window.electronAPI;
    if (!electron) return;
    await electron.localServices.setup.setLLMChoice(choice);
  };

  const handleStartDocker = async () => {
    const electron = window.electronAPI;
    if (!electron) return;
    setActionLoading(true);
    try {
      await electron.localServices.docker.start();
      await electron.localServices.setup.checkStep();
    } finally {
      setActionLoading(false);
    }
  };

  const handleStartOllama = async () => {
    const electron = window.electronAPI;
    if (!electron) return;
    setActionLoading(true);
    try {
      await electron.localServices.ollama.start();
      await electron.localServices.setup.checkStep();
    } finally {
      setActionLoading(false);
    }
  };

  const handleComplete = () => {
    onOpenChange(false);
  };

  if (!open) return null;

  const currentStep = state?.currentStep || 'welcome';
  const stepInfo = STEP_INFO[currentStep];
  const stepState = state?.steps[currentStep];

  // Calculate progress
  const stepOrder: SetupStep[] = [
    'welcome',
    'docker',
    'llm_choice',
    'ollama_setup',
    'lmstudio_setup',
    'local_pod',
    'complete',
  ];
  const currentIndex = stepOrder.indexOf(currentStep);
  const progress = ((currentIndex + 1) / stepOrder.length) * 100;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center justify-center mb-4">{stepInfo.icon}</div>
          <DialogTitle className="text-center">{stepInfo.title}</DialogTitle>
          <DialogDescription className="text-center">{stepInfo.description}</DialogDescription>
        </DialogHeader>

        {/* Progress Bar */}
        <Progress value={progress} className="h-1" />

        {/* Step Content */}
        <div className="py-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          ) : (
            <>
              {/* Welcome Step */}
              {currentStep === 'welcome' && (
                <div className="space-y-4 text-center">
                  <p className="text-sm text-muted-foreground">
                    This wizard will help you set up local development on your machine.
                  </p>
                  <div className="space-y-2 text-left">
                    <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/50">
                      <Server className="w-4 h-4 text-blue-500" />
                      <span className="text-sm">Run workspaces locally (faster, no latency)</span>
                    </div>
                    <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/50">
                      <span className="text-base">🦙</span>
                      <span className="text-sm">Use local AI models (private, free)</span>
                    </div>
                    <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/50">
                      <HardDrive className="w-4 h-4 text-green-500" />
                      <span className="text-sm">Keep your code on your machine</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Docker Step */}
              {currentStep === 'docker' && (
                <div className="space-y-4">
                  {stepState?.message && (
                    <div
                      className={cn(
                        'p-3 rounded-lg text-sm',
                        stepState.status === 'completed'
                          ? 'bg-green-500/10 text-green-500'
                          : 'bg-yellow-500/10 text-yellow-500'
                      )}
                    >
                      {stepState.status === 'completed' && (
                        <CheckCircle2 className="w-4 h-4 inline mr-2" />
                      )}
                      {stepState.status !== 'completed' && (
                        <AlertCircle className="w-4 h-4 inline mr-2" />
                      )}
                      {stepState.message}
                    </div>
                  )}

                  {stepState?.status !== 'completed' && (
                    <div className="space-y-3">
                      <Button asChild className="w-full">
                        <a
                          href="https://www.docker.com/products/docker-desktop/"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <ExternalLink className="w-4 h-4 mr-2" />
                          Download Docker Desktop
                        </a>
                      </Button>
                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={handleStartDocker}
                        disabled={actionLoading}
                      >
                        {actionLoading ? (
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : (
                          <Play className="w-4 h-4 mr-2" />
                        )}
                        Start Docker
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {/* LLM Choice Step */}
              {currentStep === 'llm_choice' && (
                <div className="space-y-3">
                  <button
                    onClick={() => handleSetLLMChoice('ollama')}
                    className={cn(
                      'w-full p-4 rounded-lg border text-left transition-colors',
                      state?.llmChoice === 'ollama'
                        ? 'border-blue-500 bg-blue-500/10'
                        : 'hover:bg-muted/50'
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">🦙</span>
                        <div>
                          <p className="font-medium">Ollama</p>
                          <p className="text-xs text-muted-foreground">
                            Command-line based, easy to use
                          </p>
                        </div>
                      </div>
                      {state?.llmChoice === 'ollama' && (
                        <CheckCircle2 className="w-5 h-5 text-blue-500" />
                      )}
                    </div>
                    <Badge className="mt-2 bg-green-500/10 text-green-500">Recommended</Badge>
                  </button>

                  <button
                    onClick={() => handleSetLLMChoice('lmstudio')}
                    className={cn(
                      'w-full p-4 rounded-lg border text-left transition-colors',
                      state?.llmChoice === 'lmstudio'
                        ? 'border-blue-500 bg-blue-500/10'
                        : 'hover:bg-muted/50'
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">🎛️</span>
                        <div>
                          <p className="font-medium">LM Studio</p>
                          <p className="text-xs text-muted-foreground">
                            GUI-based, visual model management
                          </p>
                        </div>
                      </div>
                      {state?.llmChoice === 'lmstudio' && (
                        <CheckCircle2 className="w-5 h-5 text-blue-500" />
                      )}
                    </div>
                  </button>

                  <button
                    onClick={() => handleSetLLMChoice('none')}
                    className={cn(
                      'w-full p-4 rounded-lg border text-left transition-colors',
                      state?.llmChoice === 'none'
                        ? 'border-blue-500 bg-blue-500/10'
                        : 'hover:bg-muted/50'
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <SkipForward className="w-6 h-6 text-muted-foreground" />
                        <div>
                          <p className="font-medium">Skip for now</p>
                          <p className="text-xs text-muted-foreground">Use cloud AI only</p>
                        </div>
                      </div>
                      {state?.llmChoice === 'none' && (
                        <CheckCircle2 className="w-5 h-5 text-blue-500" />
                      )}
                    </div>
                  </button>
                </div>
              )}

              {/* Ollama Setup Step */}
              {currentStep === 'ollama_setup' && (
                <div className="space-y-4">
                  {stepState?.message && (
                    <div
                      className={cn(
                        'p-3 rounded-lg text-sm',
                        stepState.status === 'completed'
                          ? 'bg-green-500/10 text-green-500'
                          : 'bg-yellow-500/10 text-yellow-500'
                      )}
                    >
                      {stepState.message}
                    </div>
                  )}

                  <div className="space-y-3">
                    <Button asChild className="w-full">
                      <a href="https://ollama.ai" target="_blank" rel="noopener noreferrer">
                        <Download className="w-4 h-4 mr-2" />
                        Download Ollama
                      </a>
                    </Button>

                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={handleStartOllama}
                      disabled={actionLoading}
                    >
                      {actionLoading ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Play className="w-4 h-4 mr-2" />
                      )}
                      Start Ollama
                    </Button>

                    <p className="text-xs text-muted-foreground text-center">
                      After starting, pull a model: <code>ollama pull qwen2.5-coder:14b</code>
                    </p>
                  </div>
                </div>
              )}

              {/* LM Studio Setup Step */}
              {currentStep === 'lmstudio_setup' && (
                <div className="space-y-4">
                  {stepState?.message && (
                    <div
                      className={cn(
                        'p-3 rounded-lg text-sm',
                        stepState.status === 'completed'
                          ? 'bg-green-500/10 text-green-500'
                          : 'bg-yellow-500/10 text-yellow-500'
                      )}
                    >
                      {stepState.message}
                    </div>
                  )}

                  <div className="space-y-3">
                    <Button asChild className="w-full">
                      <a href="https://lmstudio.ai" target="_blank" rel="noopener noreferrer">
                        <Download className="w-4 h-4 mr-2" />
                        Download LM Studio
                      </a>
                    </Button>

                    <div className="text-xs text-muted-foreground space-y-1">
                      <p>1. Install and open LM Studio</p>
                      <p>2. Download a model from the Discover tab</p>
                      <p>3. Go to Local Server tab and click &quot;Start Server&quot;</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Local Pod Step */}
              {currentStep === 'local_pod' && (
                <div className="space-y-4">
                  {stepState?.message && (
                    <div className="p-3 rounded-lg text-sm bg-muted">{stepState.message}</div>
                  )}

                  <p className="text-sm text-muted-foreground">
                    Register this machine as a local pod to run workspaces on your own hardware.
                  </p>

                  <div className="p-3 rounded-lg bg-muted/50 text-sm">
                    <p className="font-medium">Coming soon</p>
                    <p className="text-muted-foreground">
                      Local pod registration will be available in the next update.
                    </p>
                  </div>
                </div>
              )}

              {/* Complete Step */}
              {currentStep === 'complete' && (
                <div className="space-y-4 text-center">
                  <div className="text-6xl">🎉</div>
                  <p className="text-sm text-muted-foreground">
                    Your machine is now configured for local development. You can manage these
                    settings anytime from the Settings page.
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Navigation Buttons */}
        <div className="flex items-center justify-between pt-4 border-t">
          <div>
            {currentStep !== 'welcome' && currentStep !== 'complete' && (
              <Button variant="ghost" onClick={handlePrevious}>
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {stepState?.canSkip && (
              <Button variant="ghost" onClick={handleSkip}>
                Skip
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            )}

            {currentStep === 'complete' ? (
              <Button onClick={handleComplete}>
                Get Started
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            ) : (
              <Button onClick={handleNext} disabled={!stepState?.canContinue || actionLoading}>
                {actionLoading ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <>
                    Continue
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
