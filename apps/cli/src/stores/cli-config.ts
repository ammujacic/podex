/**
 * CLI configuration store with file persistence.
 */

import { createStore, type StateCreator } from 'zustand/vanilla';
import { readConfigFile, writeConfigFile } from '../adapters/storage-adapter';
import { DEFAULT_CLI_CONFIG, type CliConfig } from '../types/config';

const CONFIG_FILE = 'config.json';

export interface CliConfigState extends CliConfig {
  // Actions
  setApiUrl: (url: string) => void;
  setDefaultLocal: (local: boolean) => void;
  setAutoApprove: (categories: string[]) => void;
  addAutoApprove: (category: string) => void;
  removeAutoApprove: (category: string) => void;
  setDebug: (debug: boolean) => void;
  set: <K extends keyof CliConfig>(key: K, value: CliConfig[K]) => void;
  get: <K extends keyof CliConfig>(key: K) => CliConfig[K];
  reset: () => void;
  load: () => void;
  save: () => void;
}

const createCliConfigSlice: StateCreator<CliConfigState> = (set, get) => ({
  // Initial state from defaults
  ...DEFAULT_CLI_CONFIG,

  setApiUrl: (url) => {
    set({ apiUrl: url });
    get().save();
  },

  setDefaultLocal: (local) => {
    set({ defaultLocal: local });
    get().save();
  },

  setAutoApprove: (categories) => {
    set({ autoApprove: categories });
    get().save();
  },

  addAutoApprove: (category) => {
    const current = get().autoApprove;
    if (!current.includes(category)) {
      set({ autoApprove: [...current, category] });
      get().save();
    }
  },

  removeAutoApprove: (category) => {
    const current = get().autoApprove;
    set({ autoApprove: current.filter((c) => c !== category) });
    get().save();
  },

  setDebug: (debug) => {
    set({ debug });
    get().save();
  },

  set: (key, value) => {
    set({ [key]: value });
    get().save();
  },

  get: (key) => {
    return get()[key];
  },

  reset: () => {
    set(DEFAULT_CLI_CONFIG);
    get().save();
  },

  load: () => {
    const saved = readConfigFile<CliConfig>(CONFIG_FILE);
    if (saved) {
      set({ ...DEFAULT_CLI_CONFIG, ...saved });
    }
  },

  save: () => {
    const state = get();
    const config: CliConfig = {
      apiUrl: state.apiUrl,
      defaultLocal: state.defaultLocal,
      autoApprove: state.autoApprove,
      maxMessageHistory: state.maxMessageHistory,
      debug: state.debug,
    };
    writeConfigFile(CONFIG_FILE, config);
  },
});

/**
 * Create the CLI config store.
 */
export function createCliConfigStore() {
  const store = createStore<CliConfigState>(createCliConfigSlice);
  // Load saved config on creation
  store.getState().load();
  return store;
}

// Singleton instance
let configStoreInstance: ReturnType<typeof createCliConfigStore> | null = null;

/**
 * Get the singleton config store instance.
 */
export function getCliConfigStore(): ReturnType<typeof createCliConfigStore> {
  if (!configStoreInstance) {
    configStoreInstance = createCliConfigStore();
  }
  return configStoreInstance;
}
