/**
 * Tests for CLI config store.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DEFAULT_CLI_CONFIG } from '../../types/config';

// Mock the storage adapter
vi.mock('../../adapters/storage-adapter', () => ({
  readConfigFile: vi.fn(() => null),
  writeConfigFile: vi.fn(),
}));

describe('CLI Config Store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset module to get fresh store
    vi.resetModules();
  });

  it('should use default values when no config file exists', async () => {
    const { createCliConfigStore } = await import('../cli-config');
    const store = createCliConfigStore();

    expect(store.getState().apiUrl).toBe(DEFAULT_CLI_CONFIG.apiUrl);
    expect(store.getState().defaultLocal).toBe(DEFAULT_CLI_CONFIG.defaultLocal);
    expect(store.getState().debug).toBe(DEFAULT_CLI_CONFIG.debug);
  });

  it('should update apiUrl', async () => {
    const { createCliConfigStore } = await import('../cli-config');
    const store = createCliConfigStore();

    store.getState().setApiUrl('https://custom.api.com');

    expect(store.getState().apiUrl).toBe('https://custom.api.com');
  });

  it('should update defaultLocal', async () => {
    const { createCliConfigStore } = await import('../cli-config');
    const store = createCliConfigStore();

    store.getState().setDefaultLocal(true);

    expect(store.getState().defaultLocal).toBe(true);
  });

  it('should update debug', async () => {
    const { createCliConfigStore } = await import('../cli-config');
    const store = createCliConfigStore();

    store.getState().setDebug(true);

    expect(store.getState().debug).toBe(true);
  });

  it('should manage autoApprove list', async () => {
    const { createCliConfigStore } = await import('../cli-config');
    const store = createCliConfigStore();

    // Add category
    store.getState().addAutoApprove('read_file');
    expect(store.getState().autoApprove).toContain('read_file');

    // Don't add duplicates
    store.getState().addAutoApprove('read_file');
    expect(store.getState().autoApprove.filter((c) => c === 'read_file')).toHaveLength(1);

    // Remove category
    store.getState().removeAutoApprove('read_file');
    expect(store.getState().autoApprove).not.toContain('read_file');
  });

  it('should reset to defaults', async () => {
    const { createCliConfigStore } = await import('../cli-config');
    const store = createCliConfigStore();

    // Modify some values
    store.getState().setApiUrl('https://custom.api.com');
    store.getState().setDebug(true);

    // Reset
    store.getState().reset();

    expect(store.getState().apiUrl).toBe(DEFAULT_CLI_CONFIG.apiUrl);
    expect(store.getState().debug).toBe(DEFAULT_CLI_CONFIG.debug);
  });

  it('should use generic set/get methods', async () => {
    const { createCliConfigStore } = await import('../cli-config');
    const store = createCliConfigStore();

    store.getState().set('maxMessageHistory', 50);

    expect(store.getState().get('maxMessageHistory')).toBe(50);
  });
});
