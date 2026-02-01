/**
 * Vitest setup for CLI tests.
 */

import { vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as os from 'os';

// Mock home directory to use temp dir for tests
const TEST_HOME = path.join(os.tmpdir(), 'podex-cli-test-home');

vi.mock('os', async () => {
  const actual = await vi.importActual('os');
  return {
    ...actual,
    homedir: () => TEST_HOME,
  };
});

// Mock socket.io-client
vi.mock('socket.io-client', () => ({
  io: vi.fn(() => ({
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    connected: false,
    io: {
      on: vi.fn(),
      off: vi.fn(),
    },
  })),
}));

// Mock open (browser opener)
vi.mock('open', () => ({
  default: vi.fn(),
}));

// Mock qrcode-terminal
vi.mock('qrcode-terminal', () => ({
  generate: vi.fn(),
}));

// Setup and teardown
beforeAll(() => {
  // Create test home directory
  const fs = require('fs');
  if (!fs.existsSync(TEST_HOME)) {
    fs.mkdirSync(TEST_HOME, { recursive: true });
  }
});

afterAll(() => {
  // Clean up test home directory
  const fs = require('fs');
  try {
    fs.rmSync(TEST_HOME, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  // Clean up any created files in test home
  const fs = require('fs');
  const podexDir = path.join(TEST_HOME, '.podex');
  try {
    if (fs.existsSync(podexDir)) {
      fs.rmSync(podexDir, { recursive: true, force: true });
    }
  } catch {
    // Ignore cleanup errors
  }
});
