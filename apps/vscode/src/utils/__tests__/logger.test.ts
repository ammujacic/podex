/**
 * Logger utility tests.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock vscode module
const mockAppendLine = vi.fn();
const mockShow = vi.fn();
const mockDispose = vi.fn();
const mockCreateOutputChannel = vi.fn(() => ({
  appendLine: mockAppendLine,
  show: mockShow,
  dispose: mockDispose,
}));

vi.mock('vscode', () => ({
  window: {
    createOutputChannel: mockCreateOutputChannel,
  },
}));

// Mock constants
vi.mock('../constants', () => ({
  EXTENSION_NAME: 'Podex',
}));

describe('Logger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getOutputChannel', () => {
    it('should create output channel on first call', async () => {
      const { getOutputChannel } = await import('../logger');

      const channel = getOutputChannel();

      expect(mockCreateOutputChannel).toHaveBeenCalledWith('Podex');
      expect(channel).toBeDefined();
    });

    it('should return same channel on subsequent calls', async () => {
      const { getOutputChannel } = await import('../logger');

      const channel1 = getOutputChannel();
      const channel2 = getOutputChannel();

      expect(channel1).toBe(channel2);
      expect(mockCreateOutputChannel).toHaveBeenCalledTimes(1);
    });
  });

  describe('logInfo', () => {
    it('should log info message with timestamp', async () => {
      const { logInfo } = await import('../logger');

      logInfo('Test info message');

      expect(mockAppendLine).toHaveBeenCalledWith(
        expect.stringMatching(
          /\[INFO\] \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z - Test info message/
        )
      );
    });
  });

  describe('logWarning', () => {
    it('should log warning message with timestamp', async () => {
      const { logWarning } = await import('../logger');

      logWarning('Test warning message');

      expect(mockAppendLine).toHaveBeenCalledWith(
        expect.stringMatching(
          /\[WARN\] \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z - Test warning message/
        )
      );
    });
  });

  describe('logError', () => {
    it('should log error message with timestamp', async () => {
      const { logError } = await import('../logger');

      logError('Test error message');

      expect(mockAppendLine).toHaveBeenCalledWith(
        expect.stringMatching(
          /\[ERROR\] \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z - Test error message/
        )
      );
    });

    it('should log Error object details', async () => {
      const { logError } = await import('../logger');

      const error = new Error('Test error');
      logError('Error occurred', error);

      expect(mockAppendLine).toHaveBeenCalledTimes(3); // message + error message + stack
      expect(mockAppendLine).toHaveBeenCalledWith('  Test error');
    });

    it('should log non-Error objects as strings', async () => {
      const { logError } = await import('../logger');

      logError('Error occurred', 'string error');

      expect(mockAppendLine).toHaveBeenCalledWith('  string error');
    });

    it('should log Error stack trace', async () => {
      const { logError } = await import('../logger');

      const error = new Error('Test error');
      error.stack = 'Error: Test error\n    at test.js:1:1';
      logError('Error occurred', error);

      expect(mockAppendLine).toHaveBeenCalledWith('  Error: Test error\n    at test.js:1:1');
    });
  });

  describe('logDebug', () => {
    it('should log debug message when not in production', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      vi.resetModules();
      const { logDebug } = await import('../logger');

      logDebug('Test debug message');

      expect(mockAppendLine).toHaveBeenCalledWith(
        expect.stringMatching(
          /\[DEBUG\] \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z - Test debug message/
        )
      );

      process.env.NODE_ENV = originalEnv;
    });

    it('should not log debug message in production', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      vi.resetModules();
      const { logDebug } = await import('../logger');

      logDebug('Test debug message');

      expect(mockAppendLine).not.toHaveBeenCalled();

      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('showOutput', () => {
    it('should show the output channel', async () => {
      const { showOutput } = await import('../logger');

      showOutput();

      expect(mockShow).toHaveBeenCalled();
    });
  });

  describe('disposeLogger', () => {
    it('should dispose the output channel', async () => {
      const { getOutputChannel, disposeLogger } = await import('../logger');

      // Create the channel first
      getOutputChannel();

      disposeLogger();

      expect(mockDispose).toHaveBeenCalled();
    });

    it('should allow creating new channel after dispose', async () => {
      vi.resetModules();

      const { getOutputChannel, disposeLogger } = await import('../logger');

      getOutputChannel();
      disposeLogger();

      // Reset mock call count
      mockCreateOutputChannel.mockClear();

      // Should create new channel
      getOutputChannel();

      expect(mockCreateOutputChannel).toHaveBeenCalledTimes(1);
    });
  });
});
