/**
 * Tests for local pod discovery utilities.
 * Uses real filesystem operations with temporary directories.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as net from 'net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  discoverLocalPod,
  discoverAllLocalPods,
  waitForLocalPod,
  writePodInfo,
  removePodInfo,
  isProcessRunning,
  isPortReachable,
  getLocalPodUrl,
  DEFAULT_PID_FILE,
  PODEX_CONFIG_DIR,
} from './discovery';

// Test configuration
const TEST_PORT_BASE = 59990;
let testPortCounter = 0;

function getTestPort(): number {
  return TEST_PORT_BASE + testPortCounter++;
}

// Helper to create a TCP server for port testing
function createTestServer(port: number): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

function closeServer(server: net.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

// Test directory setup
const testConfigDir = path.join(os.tmpdir(), `podex-test-${process.pid}-${Date.now()}`);
const testPidFile = path.join(testConfigDir, 'local-pod.pid');

function cleanupTestDir() {
  try {
    const files = fs.readdirSync(testConfigDir);
    for (const file of files) {
      fs.unlinkSync(path.join(testConfigDir, file));
    }
    fs.rmdirSync(testConfigDir);
  } catch {
    // Ignore cleanup errors
  }
}

describe('discovery', () => {
  describe('constants', () => {
    it('should have correct DEFAULT_PID_FILE path', () => {
      expect(DEFAULT_PID_FILE).toBe(path.join(os.homedir(), '.podex', 'local-pod.pid'));
    });

    it('should have correct PODEX_CONFIG_DIR path', () => {
      expect(PODEX_CONFIG_DIR).toBe(path.join(os.homedir(), '.podex'));
    });
  });

  describe('isProcessRunning', () => {
    it('should return true for running process', () => {
      const result = isProcessRunning(process.pid);
      expect(result).toBe(true);
    });

    it('should return false for non-existent process', () => {
      const result = isProcessRunning(999999999);
      expect(result).toBe(false);
    });
  });

  describe('isPortReachable', () => {
    it('should return false for unreachable port', async () => {
      const result = await isPortReachable(59999, 50);
      expect(result).toBe(false);
    }, 1000);

    it('should return true for reachable port', async () => {
      const testPort = getTestPort();
      const server = await createTestServer(testPort);

      try {
        const result = await isPortReachable(testPort, 1000);
        expect(result).toBe(true);
      } finally {
        await closeServer(server);
      }
    }, 5000);

    it('should timeout and return false for slow connections', async () => {
      // Very short timeout should fail even for valid ports
      const result = await isPortReachable(1, 1);
      expect(result).toBe(false);
    }, 1000);
  });
});

describe('discovery file operations', () => {
  beforeEach(() => {
    // Create test directory
    if (!fs.existsSync(testConfigDir)) {
      fs.mkdirSync(testConfigDir, { recursive: true });
    }
  });

  afterEach(() => {
    cleanupTestDir();
  });

  describe('discoverLocalPod', () => {
    it('should return null when PID file does not exist', async () => {
      const result = await discoverLocalPod({ pidFilePath: testPidFile });
      expect(result).toBeNull();
    });

    it('should return null when PID file contains invalid JSON', async () => {
      fs.writeFileSync(testPidFile, 'not valid json', 'utf-8');

      const result = await discoverLocalPod({ pidFilePath: testPidFile });
      expect(result).toBeNull();
    });

    it('should clean up stale PID file when process is not running', async () => {
      const mockPodInfo = {
        pid: 999999999,
        port: 3001,
        workspacePath: '/test/path',
        startedAt: new Date().toISOString(),
      };
      fs.writeFileSync(testPidFile, JSON.stringify(mockPodInfo), 'utf-8');

      const result = await discoverLocalPod({ pidFilePath: testPidFile });
      expect(result).toBeNull();

      // Stale PID file should be cleaned up
      expect(fs.existsSync(testPidFile)).toBe(false);
    });

    it('should return null when process is running but port is not reachable', async () => {
      const mockPodInfo = {
        pid: process.pid, // Current process is running
        port: 59888, // But this port is not listening
        workspacePath: '/test/path',
        startedAt: new Date().toISOString(),
      };
      fs.writeFileSync(testPidFile, JSON.stringify(mockPodInfo), 'utf-8');

      const result = await discoverLocalPod({ pidFilePath: testPidFile, timeout: 50 });
      expect(result).toBeNull();
    });
  });

  describe('discoverAllLocalPods', () => {
    it('should return empty array when no pods found', async () => {
      const result = await discoverAllLocalPods({ pidFilePath: testPidFile });
      expect(result).toEqual([]);
    });

    it('should find multiple pod files', async () => {
      // Create multiple pod files (none will be valid since no processes running)
      const pod1File = path.join(testConfigDir, 'local-pod-1.pid');
      const pod2File = path.join(testConfigDir, 'local-pod-2.pid');

      fs.writeFileSync(
        pod1File,
        JSON.stringify({
          pid: 999999998,
          port: 3001,
          workspacePath: '/test/1',
          startedAt: new Date().toISOString(),
        }),
        'utf-8'
      );

      fs.writeFileSync(
        pod2File,
        JSON.stringify({
          pid: 999999997,
          port: 3002,
          workspacePath: '/test/2',
          startedAt: new Date().toISOString(),
        }),
        'utf-8'
      );

      const result = await discoverAllLocalPods({ pidFilePath: testPidFile });
      // All should be filtered out due to non-running processes
      expect(result).toEqual([]);
    });
  });

  describe('waitForLocalPod', () => {
    it('should return null when timeout is reached', async () => {
      const result = await waitForLocalPod({ pidFilePath: testPidFile }, 100, 50);
      expect(result).toBeNull();
    });
  });

  describe('writePodInfo', () => {
    it('should create directory if it does not exist', () => {
      const nestedDir = path.join(testConfigDir, 'nested', 'dir');
      const nestedPidFile = path.join(nestedDir, 'pod.pid');

      writePodInfo(
        {
          pid: 1234,
          port: 3001,
          workspacePath: '/test/path',
        },
        nestedPidFile
      );

      expect(fs.existsSync(nestedPidFile)).toBe(true);

      // Cleanup
      fs.unlinkSync(nestedPidFile);
      fs.rmdirSync(path.join(testConfigDir, 'nested', 'dir'));
      fs.rmdirSync(path.join(testConfigDir, 'nested'));
    });

    it('should write correct pod info to file', () => {
      writePodInfo(
        {
          pid: 1234,
          port: 3001,
          workspacePath: '/test/path',
          name: 'test-pod',
        },
        testPidFile
      );

      const content = fs.readFileSync(testPidFile, 'utf-8');
      const parsed = JSON.parse(content);

      expect(parsed.pid).toBe(1234);
      expect(parsed.port).toBe(3001);
      expect(parsed.workspacePath).toBe('/test/path');
      expect(parsed.name).toBe('test-pod');
      expect(parsed.startedAt).toBeDefined();
    });
  });

  describe('removePodInfo', () => {
    it('should remove existing pid file', () => {
      fs.writeFileSync(testPidFile, '{}', 'utf-8');
      expect(fs.existsSync(testPidFile)).toBe(true);

      removePodInfo(testPidFile);

      expect(fs.existsSync(testPidFile)).toBe(false);
    });

    it('should not throw when file does not exist', () => {
      expect(() => removePodInfo(testPidFile)).not.toThrow();
    });
  });

  describe('getLocalPodUrl', () => {
    it('should return null when no pod is running', async () => {
      const result = await getLocalPodUrl({ pidFilePath: testPidFile });
      expect(result).toBeNull();
    });
  });
});

// Integration tests with real server
describe('discovery integration with server', () => {
  let testServer: net.Server | null = null;
  let testPort: number;

  beforeEach(async () => {
    testPort = getTestPort();
    if (!fs.existsSync(testConfigDir)) {
      fs.mkdirSync(testConfigDir, { recursive: true });
    }
  });

  afterEach(async () => {
    if (testServer) {
      await closeServer(testServer);
      testServer = null;
    }
    cleanupTestDir();
  });

  it('should discover running local pod', async () => {
    testServer = await createTestServer(testPort);

    writePodInfo(
      {
        pid: process.pid,
        port: testPort,
        workspacePath: '/test/workspace',
        name: 'test-pod',
      },
      testPidFile
    );

    const pod = await discoverLocalPod({ pidFilePath: testPidFile });

    expect(pod).not.toBeNull();
    expect(pod?.port).toBe(testPort);
    expect(pod?.workspacePath).toBe('/test/workspace');
    expect(pod?.name).toBe('test-pod');
    expect(pod?.pid).toBe(process.pid);
    expect(pod?.startedAt).toBeInstanceOf(Date);
  }, 10000);

  it('should return correct URL for running pod', async () => {
    testServer = await createTestServer(testPort);

    writePodInfo(
      {
        pid: process.pid,
        port: testPort,
        workspacePath: '/test/workspace',
      },
      testPidFile
    );

    const url = await getLocalPodUrl({ pidFilePath: testPidFile });

    expect(url).toBe(`http://127.0.0.1:${testPort}`);
  }, 10000);

  it('should wait for pod to become available', async () => {
    // Start writing pod info after a short delay
    setTimeout(async () => {
      testServer = await createTestServer(testPort);
      writePodInfo(
        {
          pid: process.pid,
          port: testPort,
          workspacePath: '/test/workspace',
        },
        testPidFile
      );
    }, 100);

    const pod = await waitForLocalPod({ pidFilePath: testPidFile }, 5000, 50);

    expect(pod).not.toBeNull();
    expect(pod?.port).toBe(testPort);
  }, 10000);

  it('should discover all running pods including additional ones', async () => {
    testServer = await createTestServer(testPort);

    // Write main pod file
    writePodInfo(
      {
        pid: process.pid,
        port: testPort,
        workspacePath: '/test/main',
      },
      testPidFile
    );

    // Write additional pod file
    const additionalPodFile = path.join(testConfigDir, 'local-pod-extra.pid');
    const additionalPort = getTestPort();
    const additionalServer = await createTestServer(additionalPort);

    try {
      writePodInfo(
        {
          pid: process.pid,
          port: additionalPort,
          workspacePath: '/test/extra',
          name: 'extra-pod',
        },
        additionalPodFile
      );

      const pods = await discoverAllLocalPods({ pidFilePath: testPidFile });

      expect(pods.length).toBe(2);
      expect(pods.some((p) => p.workspacePath === '/test/main')).toBe(true);
      expect(pods.some((p) => p.workspacePath === '/test/extra')).toBe(true);
    } finally {
      await closeServer(additionalServer);
    }
  }, 10000);
});
