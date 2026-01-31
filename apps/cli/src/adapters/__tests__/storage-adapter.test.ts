/**
 * Tests for storage adapter.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Use a real temp directory for these tests
const TEST_DIR = path.join(os.tmpdir(), 'podex-storage-test');
const PODEX_DIR = path.join(TEST_DIR, '.podex');

// Mock os.homedir before importing the storage adapter
vi.mock('os', async () => {
  const actual = await vi.importActual('os');
  return {
    ...actual,
    homedir: () => TEST_DIR,
  };
});

describe('Storage Adapter', () => {
  beforeEach(() => {
    // Create test directories
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    // Reset modules to ensure fresh imports
    vi.resetModules();

    // Clean up test directory
    try {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('createFileStorageAdapter', () => {
    it('should return null for non-existent items', async () => {
      const { createFileStorageAdapter } = await import('../storage-adapter');
      const adapter = createFileStorageAdapter();
      expect(adapter.getItem('nonexistent')).toBeNull();
    });

    it('should set and get items', async () => {
      const { createFileStorageAdapter } = await import('../storage-adapter');
      const adapter = createFileStorageAdapter();
      const data = JSON.stringify({ test: 'value' });

      adapter.setItem('test-key', data);
      expect(adapter.getItem('test-key')).toBe(data);
    });

    it('should remove items', async () => {
      const { createFileStorageAdapter } = await import('../storage-adapter');
      const adapter = createFileStorageAdapter();
      const data = JSON.stringify({ test: 'value' });

      adapter.setItem('test-key', data);
      adapter.removeItem('test-key');

      expect(adapter.getItem('test-key')).toBeNull();
    });

    it('should create config directory if not exists', async () => {
      const { createFileStorageAdapter } = await import('../storage-adapter');
      const adapter = createFileStorageAdapter();
      adapter.setItem('test', 'value');

      expect(fs.existsSync(PODEX_DIR)).toBe(true);
    });
  });

  describe('readConfigFile', () => {
    it('should return null for non-existent file', async () => {
      const { readConfigFile } = await import('../storage-adapter');
      expect(readConfigFile('nonexistent.json')).toBeNull();
    });

    it('should read JSON file', async () => {
      fs.mkdirSync(PODEX_DIR, { recursive: true });
      fs.writeFileSync(path.join(PODEX_DIR, 'test.json'), JSON.stringify({ foo: 'bar' }));

      const { readConfigFile } = await import('../storage-adapter');
      const result = readConfigFile<{ foo: string }>('test.json');
      expect(result).toEqual({ foo: 'bar' });
    });

    it('should return null for invalid JSON', async () => {
      fs.mkdirSync(PODEX_DIR, { recursive: true });
      fs.writeFileSync(path.join(PODEX_DIR, 'invalid.json'), 'not json');

      const { readConfigFile } = await import('../storage-adapter');
      expect(readConfigFile('invalid.json')).toBeNull();
    });
  });

  describe('writeConfigFile', () => {
    it('should write JSON file', async () => {
      const { writeConfigFile } = await import('../storage-adapter');
      writeConfigFile('output.json', { hello: 'world' });

      const content = fs.readFileSync(path.join(PODEX_DIR, 'output.json'), 'utf-8');
      expect(JSON.parse(content)).toEqual({ hello: 'world' });
    });

    it('should create directory if not exists', async () => {
      const { writeConfigFile } = await import('../storage-adapter');
      writeConfigFile('nested.json', { data: true });

      expect(fs.existsSync(PODEX_DIR)).toBe(true);
    });
  });

  describe('deleteConfigFile', () => {
    it('should delete existing file', async () => {
      fs.mkdirSync(PODEX_DIR, { recursive: true });
      fs.writeFileSync(path.join(PODEX_DIR, 'todelete.json'), '{}');

      const { deleteConfigFile } = await import('../storage-adapter');
      const result = deleteConfigFile('todelete.json');

      expect(result).toBe(true);
      expect(fs.existsSync(path.join(PODEX_DIR, 'todelete.json'))).toBe(false);
    });

    it('should return false for non-existent file', async () => {
      const { deleteConfigFile } = await import('../storage-adapter');
      const result = deleteConfigFile('nonexistent.json');
      expect(result).toBe(false);
    });
  });

  describe('configFileExists', () => {
    it('should return false for non-existent file', async () => {
      const { configFileExists } = await import('../storage-adapter');
      expect(configFileExists('nonexistent.json')).toBe(false);
    });

    it('should return true for existing file', async () => {
      fs.mkdirSync(PODEX_DIR, { recursive: true });
      fs.writeFileSync(path.join(PODEX_DIR, 'exists.json'), '{}');

      const { configFileExists } = await import('../storage-adapter');
      expect(configFileExists('exists.json')).toBe(true);
    });
  });
});
