/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-require-imports */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @next/next/no-assign-module-variable */
import { act } from '@testing-library/react';

// Import all stores that need resetting
// Note: These imports will be added as we create tests for each store

/**
 * Resets all Zustand stores to their initial state.
 * Call this in beforeEach() to ensure test isolation.
 */
export const resetAllStores = () => {
  // Session store
  try {
    const { useSessionStore } = require('@/stores/session');
    act(() => {
      useSessionStore.setState({
        sessions: {},
        currentSessionId: null,
        recentFiles: [],
      });
    });
  } catch (e) {
    // Store may not be imported yet
  }

  // Auth store
  try {
    const { useAuthStore } = require('@/stores/auth');
    act(() => {
      useAuthStore.setState({
        user: null,
        tokens: null,
        loading: false,
        error: null,
        isInitialized: false,
      });
    });
  } catch (e) {
    // Store may not be imported yet
  }

  // UI store
  try {
    const { useUIStore } = require('@/stores/ui');
    act(() => {
      useUIStore.setState({
        theme: 'system',
        sidebarLayout: { collapsed: false, width: 300, panelHeights: [] },
        // ... other initial state
      });
    });
  } catch (e) {
    // Store may not be imported yet
  }

  // Editor store
  try {
    const { useEditorStore } = require('@/stores/editor');
    act(() => {
      useEditorStore.setState({
        panes: {},
        activePane: null,
        // ... other initial state
      });
    });
  } catch (e) {
    // Store may not be imported yet
  }

  // Billing store
  try {
    const { useBillingStore } = require('@/stores/billing');
    act(() => {
      useBillingStore.setState({
        plans: [],
        subscription: null,
        usage: null,
        quotas: [],
        // ... other initial state
      });
    });
  } catch (e) {
    // Store may not be imported yet
  }

  // Add more stores as needed
};

/**
 * Resets a specific store to its initial state.
 */
export const resetStore = (storeName: string) => {
  try {
    const module = require(`@/stores/${storeName}`);
    const storeHook = Object.values(module).find(
      (value: any) => typeof value === 'function' && value.name.startsWith('use')
    ) as any;

    if (storeHook && typeof storeHook.setState === 'function') {
      act(() => {
        storeHook.setState({});
      });
    }
  } catch (e) {
    console.warn(`Could not reset store: ${storeName}`, e);
  }
};

/**
 * Gets the current state of a store without subscribing to it.
 */
export const getStoreState = (storeHook: any) => {
  return storeHook.getState();
};

/**
 * Sets the state of a store without triggering subscribers.
 * Useful for setting up test state.
 */
export const setStoreState = (storeHook: any, state: any) => {
  act(() => {
    storeHook.setState(state, true); // true = replace state
  });
};

/**
 * Waits for a store state condition to be met.
 * Useful for testing async store updates.
 */
export const waitForStoreCondition = async (
  storeHook: any,
  condition: (state: any) => boolean,
  timeout = 5000
): Promise<void> => {
  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    const checkCondition = () => {
      const state = storeHook.getState();
      if (condition(state)) {
        resolve();
      } else if (Date.now() - startTime > timeout) {
        reject(new Error('Timeout waiting for store condition'));
      } else {
        setTimeout(checkCondition, 50);
      }
    };
    checkCondition();
  });
};
