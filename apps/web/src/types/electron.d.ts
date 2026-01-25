// Type definitions for Electron API in desktop app

import type { SetupState } from '@/components/local-services/GuidedSetupDialog';
import type { LocalServicesStatus } from '@/components/local-services/LocalServicesPanel';

interface ElectronLocalServices {
  setup: {
    getState(): Promise<SetupState>;
    onStateChange(callback: (state: SetupState) => void): () => void;
    next(): Promise<void>;
    previous(): Promise<void>;
    skip(): Promise<void>;
    setLLMChoice(choice: 'ollama' | 'lmstudio' | 'none'): Promise<void>;
    checkStep(): Promise<void>;
    reset(): Promise<void>;
    start(): Promise<void>;
  };
  docker: {
    start(): Promise<void>;
  };
  localPod: {
    start(): Promise<{ success: boolean; error?: string }>;
    stop(): Promise<void>;
  };
  ollama: {
    start(): Promise<void>;
    getInfo(): Promise<{ models?: Array<{ name: string; size: number; digest: string }> }>;
    pullModel(modelName: string): Promise<void>;
    deleteModel(modelName: string): Promise<void>;
    onPullProgress(
      callback: (progress: { status: string; completed?: number; total?: number }) => void
    ): () => void;
    connectBridge(cloudUrl: string, authToken: string): Promise<void>;
    disconnectBridge(): Promise<void>;
  };
  lmstudio: {
    connectBridge(cloudUrl: string, authToken: string): Promise<void>;
    disconnectBridge(): Promise<void>;
  };
  cache: {
    clear(): Promise<void>;
  };
  getStatus(): Promise<LocalServicesStatus>;
  onStatusUpdate(callback: (status: LocalServicesStatus) => void): () => void;
}

interface ElectronAPI {
  localServices: ElectronLocalServices;
  getApiUrl: () => Promise<string>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
