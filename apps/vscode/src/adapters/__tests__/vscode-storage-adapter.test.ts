/**
 * VSCode storage adapter tests.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as os from 'os';

// Mock fs module
const mockExistsSync = vi.fn();
const mockMkdirSync = vi.fn();
const mockReadFileSync = vi.fn();
const mockWriteFileSync = vi.fn();
const mockUnlinkSync = vi.fn();

vi.mock('fs', () => ({
  existsSync: mockExistsSync,
  mkdirSync: mockMkdirSync,
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
  unlinkSync: mockUnlinkSync,
}));

// Mock constants
const MOCK_CONFIG_DIR = path.join(os.homedir(), '.podex');

vi.mock('../../utils/constants', () => ({
  PODEX_CONFIG_DIR: path.join(os.homedir(), '.podex'),
}));

describe('VSCode Storage Adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createFileStorageAdapter', () => {
    describe('getItem', () => {
      it('should return null when file does not exist', async () => {
        mockExistsSync.mockReturnValue(false);

        const { createFileStorageAdapter } = await import('../vscode-storage-adapter');
        const adapter = createFileStorageAdapter();

        const result = adapter.getItem('credentials');

        expect(result).toBeNull();
        expect(mockExistsSync).toHaveBeenCalledWith(path.join(MOCK_CONFIG_DIR, 'credentials.json'));
      });

      it('should return file content when file exists', async () => {
        mockExistsSync.mockReturnValue(true);
        mockReadFileSync.mockReturnValue('{"token": "test-token"}');

        const { createFileStorageAdapter } = await import('../vscode-storage-adapter');
        const adapter = createFileStorageAdapter();

        const result = adapter.getItem('credentials');

        expect(result).toBe('{"token": "test-token"}');
      });

      it('should return null on read error', async () => {
        mockExistsSync.mockReturnValue(true);
        mockReadFileSync.mockImplementation(() => {
          throw new Error('Read error');
        });

        const { createFileStorageAdapter } = await import('../vscode-storage-adapter');
        const adapter = createFileStorageAdapter();

        const result = adapter.getItem('credentials');

        expect(result).toBeNull();
      });
    });

    describe('setItem', () => {
      it('should create config directory if it does not exist', async () => {
        mockExistsSync.mockReturnValue(false);

        const { createFileStorageAdapter } = await import('../vscode-storage-adapter');
        const adapter = createFileStorageAdapter();

        adapter.setItem('credentials', '{"token": "new-token"}');

        expect(mockMkdirSync).toHaveBeenCalledWith(MOCK_CONFIG_DIR, {
          recursive: true,
          mode: 0o700,
        });
      });

      it('should write file with secure permissions', async () => {
        mockExistsSync.mockReturnValue(true);

        const { createFileStorageAdapter } = await import('../vscode-storage-adapter');
        const adapter = createFileStorageAdapter();

        adapter.setItem('credentials', '{"token": "new-token"}');

        expect(mockWriteFileSync).toHaveBeenCalledWith(
          path.join(MOCK_CONFIG_DIR, 'credentials.json'),
          '{"token": "new-token"}',
          {
            encoding: 'utf-8',
            mode: 0o600,
          }
        );
      });
    });

    describe('removeItem', () => {
      it('should delete file when it exists', async () => {
        mockExistsSync.mockReturnValue(true);

        const { createFileStorageAdapter } = await import('../vscode-storage-adapter');
        const adapter = createFileStorageAdapter();

        adapter.removeItem('credentials');

        expect(mockUnlinkSync).toHaveBeenCalledWith(path.join(MOCK_CONFIG_DIR, 'credentials.json'));
      });

      it('should not throw when file does not exist', async () => {
        mockExistsSync.mockReturnValue(false);

        const { createFileStorageAdapter } = await import('../vscode-storage-adapter');
        const adapter = createFileStorageAdapter();

        expect(() => adapter.removeItem('credentials')).not.toThrow();
      });

      it('should not throw on delete error', async () => {
        mockExistsSync.mockReturnValue(true);
        mockUnlinkSync.mockImplementation(() => {
          throw new Error('Delete error');
        });

        const { createFileStorageAdapter } = await import('../vscode-storage-adapter');
        const adapter = createFileStorageAdapter();

        expect(() => adapter.removeItem('credentials')).not.toThrow();
      });
    });
  });

  describe('readConfigFile', () => {
    it('should return null when file does not exist', async () => {
      mockExistsSync.mockReturnValue(false);

      const { readConfigFile } = await import('../vscode-storage-adapter');
      const result = readConfigFile('config.json');

      expect(result).toBeNull();
    });

    it('should parse JSON and return typed object', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('{"name": "test", "value": 42}');

      const { readConfigFile } = await import('../vscode-storage-adapter');
      const result = readConfigFile<{ name: string; value: number }>('config.json');

      expect(result).toEqual({ name: 'test', value: 42 });
    });

    it('should return null on JSON parse error', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('invalid json');

      const { readConfigFile } = await import('../vscode-storage-adapter');
      const result = readConfigFile('config.json');

      expect(result).toBeNull();
    });
  });

  describe('writeConfigFile', () => {
    it('should create config directory if needed', async () => {
      mockExistsSync.mockReturnValue(false);

      const { writeConfigFile } = await import('../vscode-storage-adapter');
      writeConfigFile('config.json', { test: true });

      expect(mockMkdirSync).toHaveBeenCalled();
    });

    it('should write formatted JSON', async () => {
      mockExistsSync.mockReturnValue(true);

      const { writeConfigFile } = await import('../vscode-storage-adapter');
      writeConfigFile('config.json', { name: 'test', value: 42 });

      expect(mockWriteFileSync).toHaveBeenCalledWith(
        path.join(MOCK_CONFIG_DIR, 'config.json'),
        JSON.stringify({ name: 'test', value: 42 }, null, 2),
        {
          encoding: 'utf-8',
          mode: 0o600,
        }
      );
    });
  });

  describe('deleteConfigFile', () => {
    it('should return true when file is deleted', async () => {
      mockExistsSync.mockReturnValue(true);

      const { deleteConfigFile } = await import('../vscode-storage-adapter');
      const result = deleteConfigFile('config.json');

      expect(result).toBe(true);
      expect(mockUnlinkSync).toHaveBeenCalled();
    });

    it('should return false when file does not exist', async () => {
      mockExistsSync.mockReturnValue(false);

      const { deleteConfigFile } = await import('../vscode-storage-adapter');
      const result = deleteConfigFile('config.json');

      expect(result).toBe(false);
    });

    it('should return false on delete error', async () => {
      mockExistsSync.mockReturnValue(true);
      mockUnlinkSync.mockImplementation(() => {
        throw new Error('Delete error');
      });

      const { deleteConfigFile } = await import('../vscode-storage-adapter');
      const result = deleteConfigFile('config.json');

      expect(result).toBe(false);
    });
  });

  describe('configFileExists', () => {
    it('should return true when file exists', async () => {
      mockExistsSync.mockReturnValue(true);

      const { configFileExists } = await import('../vscode-storage-adapter');
      const result = configFileExists('config.json');

      expect(result).toBe(true);
    });

    it('should return false when file does not exist', async () => {
      mockExistsSync.mockReturnValue(false);

      const { configFileExists } = await import('../vscode-storage-adapter');
      const result = configFileExists('config.json');

      expect(result).toBe(false);
    });
  });

  describe('getConfigFilePath', () => {
    it('should return full path to config file', async () => {
      const { getConfigFilePath } = await import('../vscode-storage-adapter');
      const result = getConfigFilePath('config.json');

      expect(result).toBe(path.join(MOCK_CONFIG_DIR, 'config.json'));
    });
  });
});
