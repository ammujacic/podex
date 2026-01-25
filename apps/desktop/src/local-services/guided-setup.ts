/**
 * Guided Setup
 *
 * State machine for guiding users through local development setup.
 */

import { EventEmitter } from 'events';
import log from 'electron-log/main';
import Store from 'electron-store';
import { getDockerManager, DockerStatus } from './docker-manager';
import { getLocalPodManager, LocalPodStatus } from './local-pod-manager';
import { getOllamaBridge, OllamaStatus } from './ollama-bridge';
import { getLMStudioBridge, LMStudioStatus } from './lmstudio-bridge';

export type SetupStep =
  | 'welcome'
  | 'docker'
  | 'llm_choice'
  | 'ollama_setup'
  | 'lmstudio_setup'
  | 'local_pod'
  | 'complete';

export type StepStatus = 'pending' | 'in_progress' | 'completed' | 'skipped' | 'error';

export interface SetupStepState {
  step: SetupStep;
  status: StepStatus;
  message: string | null;
  canSkip: boolean;
  canContinue: boolean;
}

export interface SetupState {
  currentStep: SetupStep;
  steps: Record<SetupStep, SetupStepState>;
  hasCompletedSetup: boolean;
  llmChoice: 'ollama' | 'lmstudio' | 'none' | null;
}

export interface SetupConfig {
  hasCompletedSetup: boolean;
  setupCompletedAt: number | null;
  llmChoice: 'ollama' | 'lmstudio' | 'none' | null;
  skippedSteps: SetupStep[];
}

const DEFAULT_CONFIG: SetupConfig = {
  hasCompletedSetup: false,
  setupCompletedAt: null,
  llmChoice: null,
  skippedSteps: [],
};

const STEP_ORDER: SetupStep[] = [
  'welcome',
  'docker',
  'llm_choice',
  'ollama_setup',
  'lmstudio_setup',
  'local_pod',
  'complete',
];

export class GuidedSetup extends EventEmitter {
  private store: Store;
  private state: SetupState;
  private checkInterval: NodeJS.Timeout | null = null;

  constructor(store: Store) {
    super();
    this.store = store;

    if (!this.store.has('guidedSetup')) {
      this.store.set('guidedSetup', DEFAULT_CONFIG);
    }

    // Initialize state
    this.state = this.createInitialState();
  }

  /**
   * Create initial state
   */
  private createInitialState(): SetupState {
    const config = this.getConfig();

    return {
      currentStep: config.hasCompletedSetup ? 'complete' : 'welcome',
      steps: {
        welcome: {
          step: 'welcome',
          status: config.hasCompletedSetup ? 'completed' : 'pending',
          message: null,
          canSkip: false,
          canContinue: true,
        },
        docker: {
          step: 'docker',
          status: 'pending',
          message: null,
          canSkip: false,
          canContinue: false,
        },
        llm_choice: {
          step: 'llm_choice',
          status: 'pending',
          message: null,
          canSkip: true,
          canContinue: false,
        },
        ollama_setup: {
          step: 'ollama_setup',
          status: 'pending',
          message: null,
          canSkip: true,
          canContinue: false,
        },
        lmstudio_setup: {
          step: 'lmstudio_setup',
          status: 'pending',
          message: null,
          canSkip: true,
          canContinue: false,
        },
        local_pod: {
          step: 'local_pod',
          status: 'pending',
          message: null,
          canSkip: true,
          canContinue: false,
        },
        complete: {
          step: 'complete',
          status: config.hasCompletedSetup ? 'completed' : 'pending',
          message: null,
          canSkip: false,
          canContinue: true,
        },
      },
      hasCompletedSetup: config.hasCompletedSetup,
      llmChoice: config.llmChoice,
    };
  }

  /**
   * Get configuration
   */
  getConfig(): SetupConfig {
    return (this.store.get('guidedSetup') as SetupConfig) || DEFAULT_CONFIG;
  }

  /**
   * Update configuration
   */
  private updateConfig(updates: Partial<SetupConfig>): void {
    const current = this.getConfig();
    this.store.set('guidedSetup', { ...current, ...updates });
  }

  /**
   * Get current state
   */
  getState(): SetupState {
    return { ...this.state };
  }

  /**
   * Start or resume setup
   */
  async startSetup(): Promise<void> {
    const config = this.getConfig();

    if (config.hasCompletedSetup) {
      log.info('Setup already completed');
      this.emit('setup-already-complete');
      return;
    }

    this.state.currentStep = 'welcome';
    this.state.steps.welcome.status = 'in_progress';
    this.emit('state-changed', this.state);

    log.info('Guided setup started');
  }

  /**
   * Go to next step
   */
  async nextStep(): Promise<void> {
    const currentIndex = STEP_ORDER.indexOf(this.state.currentStep);
    if (currentIndex === -1 || currentIndex >= STEP_ORDER.length - 1) {
      return;
    }

    // Mark current step as completed
    this.state.steps[this.state.currentStep].status = 'completed';

    // Find next applicable step
    let nextIndex = currentIndex + 1;
    let nextStep = STEP_ORDER[nextIndex];

    // Skip LLM setup steps based on choice
    if (this.state.llmChoice) {
      if (nextStep === 'ollama_setup' && this.state.llmChoice !== 'ollama') {
        this.state.steps.ollama_setup.status = 'skipped';
        nextIndex++;
        nextStep = STEP_ORDER[nextIndex];
      }
      if (nextStep === 'lmstudio_setup' && this.state.llmChoice !== 'lmstudio') {
        this.state.steps.lmstudio_setup.status = 'skipped';
        nextIndex++;
        nextStep = STEP_ORDER[nextIndex];
      }
    }

    if (
      this.state.llmChoice === 'none' &&
      (nextStep === 'ollama_setup' || nextStep === 'lmstudio_setup')
    ) {
      this.state.steps.ollama_setup.status = 'skipped';
      this.state.steps.lmstudio_setup.status = 'skipped';
      nextIndex = STEP_ORDER.indexOf('local_pod');
      nextStep = 'local_pod';
    }

    this.state.currentStep = nextStep;
    this.state.steps[nextStep].status = 'in_progress';

    // Check step requirements
    await this.checkCurrentStep();

    this.emit('state-changed', this.state);
    log.info(`Moved to step: ${nextStep}`);
  }

  /**
   * Go to previous step
   */
  previousStep(): void {
    const currentIndex = STEP_ORDER.indexOf(this.state.currentStep);
    if (currentIndex <= 0) {
      return;
    }

    // Find previous non-skipped step
    let prevIndex = currentIndex - 1;
    while (prevIndex >= 0 && this.state.steps[STEP_ORDER[prevIndex]].status === 'skipped') {
      prevIndex--;
    }

    if (prevIndex >= 0) {
      this.state.steps[this.state.currentStep].status = 'pending';
      this.state.currentStep = STEP_ORDER[prevIndex];
      this.state.steps[this.state.currentStep].status = 'in_progress';
      this.emit('state-changed', this.state);
      log.info(`Moved back to step: ${this.state.currentStep}`);
    }
  }

  /**
   * Skip current step
   */
  skipStep(): void {
    if (!this.state.steps[this.state.currentStep].canSkip) {
      return;
    }

    const config = this.getConfig();
    this.updateConfig({
      skippedSteps: [...config.skippedSteps, this.state.currentStep],
    });

    this.state.steps[this.state.currentStep].status = 'skipped';
    this.nextStep();
  }

  /**
   * Set LLM choice
   */
  setLLMChoice(choice: 'ollama' | 'lmstudio' | 'none'): void {
    this.state.llmChoice = choice;
    this.updateConfig({ llmChoice: choice });

    this.state.steps.llm_choice.canContinue = true;
    this.emit('state-changed', this.state);
    log.info(`LLM choice set to: ${choice}`);
  }

  /**
   * Check current step status
   */
  async checkCurrentStep(): Promise<void> {
    const step = this.state.currentStep;
    const stepState = this.state.steps[step];

    switch (step) {
      case 'welcome':
        stepState.canContinue = true;
        break;

      case 'docker':
        await this.checkDockerStep();
        break;

      case 'llm_choice':
        stepState.canContinue = this.state.llmChoice !== null;
        break;

      case 'ollama_setup':
        await this.checkOllamaStep();
        break;

      case 'lmstudio_setup':
        await this.checkLMStudioStep();
        break;

      case 'local_pod':
        await this.checkLocalPodStep();
        break;

      case 'complete':
        this.completeSetup();
        break;
    }

    this.emit('state-changed', this.state);
  }

  /**
   * Check Docker step
   */
  private async checkDockerStep(): Promise<void> {
    const dockerManager = getDockerManager();
    if (!dockerManager) {
      this.state.steps.docker.message = 'Docker manager not available';
      this.state.steps.docker.canContinue = false;
      return;
    }

    const info = await dockerManager.getInfo();

    switch (info.status) {
      case 'running':
        this.state.steps.docker.status = 'completed';
        this.state.steps.docker.message = `Docker ${info.version} is running`;
        this.state.steps.docker.canContinue = true;
        break;

      case 'stopped':
        this.state.steps.docker.message =
          'Docker is installed but not running. Click "Start Docker" below.';
        this.state.steps.docker.canContinue = false;
        break;

      case 'not_installed':
        this.state.steps.docker.message =
          'Docker is not installed. Follow the guide below to install it.';
        this.state.steps.docker.canContinue = false;
        break;

      default:
        this.state.steps.docker.message = 'Checking Docker status...';
        this.state.steps.docker.canContinue = false;
    }
  }

  /**
   * Check Ollama step
   */
  private async checkOllamaStep(): Promise<void> {
    const ollamaBridge = getOllamaBridge();
    if (!ollamaBridge) {
      this.state.steps.ollama_setup.message = 'Ollama bridge not available';
      this.state.steps.ollama_setup.canContinue = false;
      return;
    }

    const info = await ollamaBridge.checkStatus();

    switch (info.status) {
      case 'running':
        if (info.models.length > 0) {
          this.state.steps.ollama_setup.status = 'completed';
          this.state.steps.ollama_setup.message = `Ollama is running with ${info.models.length} model(s)`;
          this.state.steps.ollama_setup.canContinue = true;
        } else {
          this.state.steps.ollama_setup.message =
            'Ollama is running but no models installed. Pull a model below.';
          this.state.steps.ollama_setup.canContinue = false;
        }
        break;

      case 'stopped':
        this.state.steps.ollama_setup.message =
          'Ollama is installed but not running. Click "Start Ollama" below.';
        this.state.steps.ollama_setup.canContinue = false;
        break;

      case 'not_installed':
        this.state.steps.ollama_setup.message =
          'Ollama is not installed. Follow the guide below to install it.';
        this.state.steps.ollama_setup.canContinue = false;
        break;

      default:
        this.state.steps.ollama_setup.message = 'Checking Ollama status...';
        this.state.steps.ollama_setup.canContinue = false;
    }
  }

  /**
   * Check LM Studio step
   */
  private async checkLMStudioStep(): Promise<void> {
    const lmStudioBridge = getLMStudioBridge();
    if (!lmStudioBridge) {
      this.state.steps.lmstudio_setup.message = 'LM Studio bridge not available';
      this.state.steps.lmstudio_setup.canContinue = false;
      return;
    }

    const info = await lmStudioBridge.checkStatus();

    switch (info.status) {
      case 'running':
        if (info.models.length > 0) {
          this.state.steps.lmstudio_setup.status = 'completed';
          this.state.steps.lmstudio_setup.message = `LM Studio server running with ${info.models.length} model(s)`;
          this.state.steps.lmstudio_setup.canContinue = true;
        } else {
          this.state.steps.lmstudio_setup.message =
            'LM Studio server running but no models loaded. Load a model in LM Studio.';
          this.state.steps.lmstudio_setup.canContinue = false;
        }
        break;

      case 'stopped':
        this.state.steps.lmstudio_setup.message =
          'LM Studio server not running. Open LM Studio and start the local server.';
        this.state.steps.lmstudio_setup.canContinue = false;
        break;

      default:
        this.state.steps.lmstudio_setup.message = 'Checking LM Studio status...';
        this.state.steps.lmstudio_setup.canContinue = false;
    }
  }

  /**
   * Check Local Pod step
   */
  private async checkLocalPodStep(): Promise<void> {
    const localPodManager = getLocalPodManager();
    if (!localPodManager) {
      this.state.steps.local_pod.message = 'Local pod manager not available';
      this.state.steps.local_pod.canContinue = false;
      return;
    }

    const config = localPodManager.getConfig();
    const status = localPodManager.getStatus();

    if (status === 'running') {
      this.state.steps.local_pod.status = 'completed';
      this.state.steps.local_pod.message = 'Local pod is running and connected';
      this.state.steps.local_pod.canContinue = true;
    } else if (config.podToken) {
      this.state.steps.local_pod.message =
        'Local pod is configured but not running. Click "Start" to begin.';
      this.state.steps.local_pod.canContinue = true; // Can continue with token set
    } else {
      this.state.steps.local_pod.message =
        'Register your local pod to run workspaces on this machine.';
      this.state.steps.local_pod.canContinue = false;
    }
  }

  /**
   * Complete setup
   */
  private completeSetup(): void {
    this.state.hasCompletedSetup = true;
    this.state.steps.complete.status = 'completed';

    this.updateConfig({
      hasCompletedSetup: true,
      setupCompletedAt: Date.now(),
    });

    this.emit('setup-complete');
    log.info('Guided setup completed');
  }

  /**
   * Reset setup (for testing or re-running)
   */
  resetSetup(): void {
    this.store.set('guidedSetup', DEFAULT_CONFIG);
    this.state = this.createInitialState();
    this.emit('state-changed', this.state);
    log.info('Guided setup reset');
  }

  /**
   * Start periodic status checking
   */
  startStatusChecking(): void {
    if (this.checkInterval) return;

    this.checkInterval = setInterval(() => {
      if (this.state.currentStep !== 'welcome' && this.state.currentStep !== 'complete') {
        this.checkCurrentStep();
      }
    }, 5000);

    log.info('Setup status checking started');
  }

  /**
   * Stop periodic status checking
   */
  stopStatusChecking(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /**
   * Shutdown
   */
  shutdown(): void {
    this.stopStatusChecking();
    this.removeAllListeners();
    log.info('Guided setup shutdown complete');
  }
}

// Singleton
let guidedSetup: GuidedSetup | null = null;

export function initializeGuidedSetup(store: Store): GuidedSetup {
  if (!guidedSetup) {
    guidedSetup = new GuidedSetup(store);
  }
  return guidedSetup;
}

export function getGuidedSetup(): GuidedSetup | null {
  return guidedSetup;
}
