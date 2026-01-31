/**
 * @podex/local-pod-discovery
 *
 * Utilities for discovering and managing local-pod processes.
 * Used by VSCode extension and CLI to find running local pods.
 *
 * @example
 * ```typescript
 * import { discoverLocalPod, waitForLocalPod } from '@podex/local-pod-discovery';
 *
 * // Check if a local pod is running
 * const pod = await discoverLocalPod();
 * if (pod) {
 *   console.log(`Found local pod at port ${pod.port}`);
 *   console.log(`Workspace: ${pod.workspacePath}`);
 * }
 *
 * // Wait for a local pod to start (with timeout)
 * const pod = await waitForLocalPod({}, 30000);
 * if (pod) {
 *   console.log('Local pod is ready!');
 * } else {
 *   console.log('Local pod did not start within timeout');
 * }
 * ```
 */

export {
  // Discovery functions
  discoverLocalPod,
  discoverAllLocalPods,
  waitForLocalPod,
  getLocalPodUrl,

  // PID file management
  writePodInfo,
  removePodInfo,

  // Helper functions
  isProcessRunning,
  isPortReachable,

  // Constants
  DEFAULT_PID_FILE,
  PODEX_CONFIG_DIR,

  // Types
  type LocalPodInfo,
  type DiscoveryOptions,
} from './discovery';
