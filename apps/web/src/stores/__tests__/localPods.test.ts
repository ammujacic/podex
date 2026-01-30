import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  useLocalPodsStore,
  selectOnlinePods,
  selectPodById,
  selectIsDeleting,
  selectIsRegenerating,
} from '../localPods';
import * as api from '@/lib/api';
import type {
  LocalPod,
  CreateLocalPodRequest,
  CreateLocalPodResponse,
  UpdateLocalPodRequest,
  RegenerateTokenResponse,
} from '@/lib/api';

// Mock the API module
vi.mock('@/lib/api', () => ({
  listLocalPods: vi.fn(),
  createLocalPod: vi.fn(),
  updateLocalPod: vi.fn(),
  deleteLocalPod: vi.fn(),
  regenerateLocalPodToken: vi.fn(),
}));

// Mock fixtures - simplified local pod (no docker_version, max_workspaces, mode, mounts)
const mockLocalPod: LocalPod = {
  id: 'pod-1',
  user_id: 'user-1',
  name: 'Development Pod',
  token_prefix: 'lpod_abc123',
  status: 'online',
  last_heartbeat: '2024-01-20T12:00:00Z',
  last_error: null,
  os_info: 'Linux 5.15.0',
  architecture: 'x86_64',
  total_memory_mb: 16384,
  total_cpu_cores: 8,
  current_workspaces: 2,
  labels: { env: 'development', region: 'us-east-1' },
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-20T12:00:00Z',
};

const mockOfflinePod: LocalPod = {
  ...mockLocalPod,
  id: 'pod-2',
  name: 'Offline Pod',
  status: 'offline',
  last_heartbeat: '2024-01-15T10:00:00Z',
  current_workspaces: 0,
};

const mockErrorPod: LocalPod = {
  ...mockLocalPod,
  id: 'pod-3',
  name: 'Error Pod',
  status: 'error',
  last_error: 'Connection failed',
  current_workspaces: 0,
};

const mockBusyPod: LocalPod = {
  ...mockLocalPod,
  id: 'pod-4',
  name: 'Busy Pod',
  status: 'busy',
  current_workspaces: 5,
};

describe('localPodsStore', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    act(() => {
      useLocalPodsStore.setState(
        {
          pods: [],
          selectedPodId: null,
          isLoading: false,
          isCreating: false,
          isDeleting: new Set(),
          isRegenerating: new Set(),
          error: null,
          newToken: null,
        },
        false
      );
    });

    // Reset all mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ========================================================================
  // Initial State
  // ========================================================================

  describe('Initial State', () => {
    it('has empty pods array', () => {
      const { result } = renderHook(() => useLocalPodsStore());
      expect(result.current.pods).toEqual([]);
    });

    it('has no selected pod', () => {
      const { result } = renderHook(() => useLocalPodsStore());
      expect(result.current.selectedPodId).toBeNull();
    });

    it('is not loading initially', () => {
      const { result } = renderHook(() => useLocalPodsStore());
      expect(result.current.isLoading).toBe(false);
      expect(result.current.isCreating).toBe(false);
    });

    it('has no errors initially', () => {
      const { result } = renderHook(() => useLocalPodsStore());
      expect(result.current.error).toBeNull();
      expect(result.current.newToken).toBeNull();
    });
  });

  // ========================================================================
  // Local Pod Management
  // ========================================================================

  describe('Local Pod Management', () => {
    describe('loadPods', () => {
      it('loads pods successfully', async () => {
        const mockPods = [mockLocalPod, mockOfflinePod];
        vi.mocked(api.listLocalPods).mockResolvedValue(mockPods);

        const { result } = renderHook(() => useLocalPodsStore());

        await act(async () => {
          await result.current.loadPods();
        });

        expect(result.current.pods).toEqual(mockPods);
        expect(result.current.isLoading).toBe(false);
        expect(result.current.error).toBeNull();
      });

      it('sets loading state while fetching', async () => {
        let resolvePromise: (value: LocalPod[]) => void;
        const controlledPromise = new Promise<LocalPod[]>((resolve) => {
          resolvePromise = resolve;
        });

        vi.mocked(api.listLocalPods).mockReturnValue(controlledPromise);

        const { result } = renderHook(() => useLocalPodsStore());

        // Start the async operation and immediately check state within act
        await act(async () => {
          const loadPromise = result.current.loadPods();

          // Check loading state is set immediately by checking the store directly
          expect(useLocalPodsStore.getState().isLoading).toBe(true);

          // Resolve the promise
          resolvePromise!([mockLocalPod]);
          await loadPromise;
        });

        expect(result.current.isLoading).toBe(false);
      });

      it('handles error when loading pods fails', async () => {
        const errorMessage = 'Network error';
        vi.mocked(api.listLocalPods).mockRejectedValue(new Error(errorMessage));

        const { result } = renderHook(() => useLocalPodsStore());

        await act(async () => {
          await result.current.loadPods();
        });

        expect(result.current.error).toBe(errorMessage);
        expect(result.current.isLoading).toBe(false);
        expect(result.current.pods).toEqual([]);
      });

      it('clears previous error on successful load', async () => {
        vi.mocked(api.listLocalPods).mockResolvedValue([mockLocalPod]);

        const { result } = renderHook(() => useLocalPodsStore());

        // Set an error first
        act(() => {
          result.current.setError('Previous error');
        });

        await act(async () => {
          await result.current.loadPods();
        });

        expect(result.current.error).toBeNull();
      });
    });

    describe('createPod', () => {
      it('creates pod successfully', async () => {
        const createRequest: CreateLocalPodRequest = {
          name: 'New Pod',
          labels: { env: 'test' },
        };

        const createResponse: CreateLocalPodResponse = {
          pod: mockLocalPod,
          token: 'lpod_full_token_abc123xyz',
        };

        vi.mocked(api.createLocalPod).mockResolvedValue(createResponse);

        const { result } = renderHook(() => useLocalPodsStore());

        let response: CreateLocalPodResponse | undefined;
        await act(async () => {
          response = await result.current.createPod(createRequest);
        });

        expect(result.current.pods).toContainEqual(mockLocalPod);
        expect(result.current.newToken).toEqual({
          podId: mockLocalPod.id,
          token: createResponse.token,
        });
        expect(response).toEqual(createResponse);
        expect(result.current.isCreating).toBe(false);
      });

      it('sets creating state while creating pod', async () => {
        const createRequest: CreateLocalPodRequest = { name: 'New Pod' };
        const createResponse: CreateLocalPodResponse = {
          pod: mockLocalPod,
          token: 'token',
        };

        let resolvePromise: (value: CreateLocalPodResponse) => void;
        const controlledPromise = new Promise<CreateLocalPodResponse>((resolve) => {
          resolvePromise = resolve;
        });

        vi.mocked(api.createLocalPod).mockReturnValue(controlledPromise);

        const { result } = renderHook(() => useLocalPodsStore());

        // Start the async operation and immediately check state within act
        await act(async () => {
          const createPromise = result.current.createPod(createRequest);

          // Check creating state is set immediately by checking the store directly
          expect(useLocalPodsStore.getState().isCreating).toBe(true);

          // Resolve the promise
          resolvePromise!(createResponse);
          await createPromise;
        });

        expect(result.current.isCreating).toBe(false);
      });

      it('handles error when pod is missing in response', async () => {
        const createRequest: CreateLocalPodRequest = { name: 'New Pod' };
        vi.mocked(api.createLocalPod).mockResolvedValue({
          pod: null as any,
          token: 'token',
        });

        const { result } = renderHook(() => useLocalPodsStore());

        let caughtError;
        try {
          await act(async () => {
            await result.current.createPod(createRequest);
          });
        } catch (err) {
          caughtError = err;
        }

        expect(caughtError).toBeInstanceOf(Error);
        expect((caughtError as Error).message).toBe('Invalid response: pod data is missing');
        expect(result.current.error).toBe('Invalid response: pod data is missing');
        expect(result.current.isCreating).toBe(false);
      });

      it('handles error when token is missing in response', async () => {
        const createRequest: CreateLocalPodRequest = { name: 'New Pod' };
        vi.mocked(api.createLocalPod).mockResolvedValue({
          pod: mockLocalPod,
          token: null as any,
        });

        const { result } = renderHook(() => useLocalPodsStore());

        let caughtError;
        try {
          await act(async () => {
            await result.current.createPod(createRequest);
          });
        } catch (err) {
          caughtError = err;
        }

        expect(caughtError).toBeInstanceOf(Error);
        expect((caughtError as Error).message).toBe('Invalid response: token is missing');
        expect(result.current.error).toBe('Invalid response: token is missing');
      });

      it('handles API error during creation', async () => {
        const createRequest: CreateLocalPodRequest = { name: 'New Pod' };
        const errorMessage = 'Quota exceeded';
        vi.mocked(api.createLocalPod).mockRejectedValue(new Error(errorMessage));

        const { result } = renderHook(() => useLocalPodsStore());

        let caughtError;
        try {
          await act(async () => {
            await result.current.createPod(createRequest);
          });
        } catch (err) {
          caughtError = err;
        }

        expect(caughtError).toBeInstanceOf(Error);
        expect((caughtError as Error).message).toBe(errorMessage);
        expect(result.current.error).toBe(errorMessage);
        expect(result.current.isCreating).toBe(false);
      });
    });

    describe('updatePod', () => {
      it('updates pod successfully', async () => {
        const updateRequest: UpdateLocalPodRequest = {
          name: 'Updated Name',
        };

        const updatedPod: LocalPod = {
          ...mockLocalPod,
          name: 'Updated Name',
        };

        vi.mocked(api.updateLocalPod).mockResolvedValue(updatedPod);

        const { result } = renderHook(() => useLocalPodsStore());

        // Set initial pods
        act(() => {
          useLocalPodsStore.setState({ pods: [mockLocalPod, mockOfflinePod] }, false);
        });

        await act(async () => {
          await result.current.updatePod(mockLocalPod.id, updateRequest);
        });

        const pod = result.current.pods.find((p) => p.id === mockLocalPod.id);
        expect(pod?.name).toBe('Updated Name');
        expect(result.current.error).toBeNull();
      });

      it('does not affect other pods when updating', async () => {
        const updateRequest: UpdateLocalPodRequest = { name: 'Updated' };
        const updatedPod: LocalPod = { ...mockLocalPod, name: 'Updated' };

        vi.mocked(api.updateLocalPod).mockResolvedValue(updatedPod);

        const { result } = renderHook(() => useLocalPodsStore());

        act(() => {
          useLocalPodsStore.setState({ pods: [mockLocalPod, mockOfflinePod] }, false);
        });

        await act(async () => {
          await result.current.updatePod(mockLocalPod.id, updateRequest);
        });

        const unchangedPod = result.current.pods.find((p) => p.id === mockOfflinePod.id);
        expect(unchangedPod).toEqual(mockOfflinePod);
      });

      it('handles error during update', async () => {
        const updateRequest: UpdateLocalPodRequest = { name: 'Updated' };
        const errorMessage = 'Update failed';
        vi.mocked(api.updateLocalPod).mockRejectedValue(new Error(errorMessage));

        const { result } = renderHook(() => useLocalPodsStore());

        act(() => {
          useLocalPodsStore.setState({ pods: [mockLocalPod] }, false);
        });

        let caughtError;
        try {
          await act(async () => {
            await result.current.updatePod(mockLocalPod.id, updateRequest);
          });
        } catch (err) {
          caughtError = err;
        }

        expect(caughtError).toBeInstanceOf(Error);
        expect((caughtError as Error).message).toBe(errorMessage);
        expect(result.current.error).toBe(errorMessage);
      });
    });

    describe('deletePod', () => {
      it('deletes pod successfully', async () => {
        vi.mocked(api.deleteLocalPod).mockResolvedValue();

        const { result } = renderHook(() => useLocalPodsStore());

        act(() => {
          useLocalPodsStore.setState({ pods: [mockLocalPod, mockOfflinePod] }, false);
        });

        await act(async () => {
          await result.current.deletePod(mockLocalPod.id);
        });

        expect(result.current.pods).not.toContainEqual(mockLocalPod);
        expect(result.current.pods).toContainEqual(mockOfflinePod);
        expect(result.current.error).toBeNull();
      });

      it('sets deleting state while deleting', async () => {
        let resolvePromise: () => void;
        const controlledPromise = new Promise<void>((resolve) => {
          resolvePromise = resolve;
        });

        vi.mocked(api.deleteLocalPod).mockReturnValue(controlledPromise);

        const { result } = renderHook(() => useLocalPodsStore());

        act(() => {
          useLocalPodsStore.setState({ pods: [mockLocalPod] }, false);
        });

        // Start the async operation and immediately check state within act
        await act(async () => {
          const deletePromise = result.current.deletePod(mockLocalPod.id);

          // Check deleting state is set immediately by checking the store directly
          expect(useLocalPodsStore.getState().isDeleting.has(mockLocalPod.id)).toBe(true);

          // Resolve the promise
          resolvePromise!();
          await deletePromise;
        });

        expect(result.current.isDeleting.has(mockLocalPod.id)).toBe(false);
      });

      it('clears selected pod if deleted pod was selected', async () => {
        vi.mocked(api.deleteLocalPod).mockResolvedValue();

        const { result } = renderHook(() => useLocalPodsStore());

        act(() => {
          useLocalPodsStore.setState(
            {
              pods: [mockLocalPod],
              selectedPodId: mockLocalPod.id,
            },
            false
          );
        });

        await act(async () => {
          await result.current.deletePod(mockLocalPod.id);
        });

        expect(result.current.selectedPodId).toBeNull();
      });

      it('keeps selected pod if deleted pod was not selected', async () => {
        vi.mocked(api.deleteLocalPod).mockResolvedValue();

        const { result } = renderHook(() => useLocalPodsStore());

        act(() => {
          useLocalPodsStore.setState(
            {
              pods: [mockLocalPod, mockOfflinePod],
              selectedPodId: mockLocalPod.id,
            },
            false
          );
        });

        await act(async () => {
          await result.current.deletePod(mockOfflinePod.id);
        });

        expect(result.current.selectedPodId).toBe(mockLocalPod.id);
      });

      it('handles error during deletion', async () => {
        const errorMessage = 'Cannot delete pod with active workspaces';
        vi.mocked(api.deleteLocalPod).mockRejectedValue(new Error(errorMessage));

        const { result } = renderHook(() => useLocalPodsStore());

        act(() => {
          useLocalPodsStore.setState({ pods: [mockLocalPod] }, false);
        });

        let caughtError;
        try {
          await act(async () => {
            await result.current.deletePod(mockLocalPod.id);
          });
        } catch (err) {
          caughtError = err;
        }

        expect(caughtError).toBeInstanceOf(Error);
        expect((caughtError as Error).message).toBe(errorMessage);
        expect(result.current.error).toBe(errorMessage);
        expect(result.current.isDeleting.has(mockLocalPod.id)).toBe(false);
        expect(result.current.pods).toContainEqual(mockLocalPod);
      });

      it('can delete multiple pods independently', async () => {
        vi.mocked(api.deleteLocalPod).mockResolvedValue();

        const { result } = renderHook(() => useLocalPodsStore());

        act(() => {
          useLocalPodsStore.setState(
            {
              pods: [mockLocalPod, mockOfflinePod, mockErrorPod],
            },
            false
          );
        });

        await act(async () => {
          await Promise.all([
            result.current.deletePod(mockLocalPod.id),
            result.current.deletePod(mockOfflinePod.id),
          ]);
        });

        expect(result.current.pods).toHaveLength(1);
        expect(result.current.pods[0]).toEqual(mockErrorPod);
      });
    });

    describe('regenerateToken', () => {
      it('regenerates token successfully', async () => {
        const regenerateResponse: RegenerateTokenResponse = {
          token: 'lpod_new_token_xyz789',
          token_prefix: 'lpod_xyz789',
        };

        vi.mocked(api.regenerateLocalPodToken).mockResolvedValue(regenerateResponse);

        const { result } = renderHook(() => useLocalPodsStore());

        act(() => {
          useLocalPodsStore.setState({ pods: [mockLocalPod] }, false);
        });

        let response: RegenerateTokenResponse | undefined;
        await act(async () => {
          response = await result.current.regenerateToken(mockLocalPod.id);
        });

        const pod = result.current.pods.find((p) => p.id === mockLocalPod.id);
        expect(pod?.token_prefix).toBe(regenerateResponse.token_prefix);
        expect(result.current.newToken).toEqual({
          podId: mockLocalPod.id,
          token: regenerateResponse.token,
        });
        expect(response).toEqual(regenerateResponse);
      });

      it('sets regenerating state while regenerating', async () => {
        const regenerateResponse: RegenerateTokenResponse = {
          token: 'token',
          token_prefix: 'prefix',
        };

        let resolvePromise: (value: RegenerateTokenResponse) => void;
        const controlledPromise = new Promise<RegenerateTokenResponse>((resolve) => {
          resolvePromise = resolve;
        });

        vi.mocked(api.regenerateLocalPodToken).mockReturnValue(controlledPromise);

        const { result } = renderHook(() => useLocalPodsStore());

        act(() => {
          useLocalPodsStore.setState({ pods: [mockLocalPod] }, false);
        });

        // Start the async operation and immediately check state within act
        await act(async () => {
          const regeneratePromise = result.current.regenerateToken(mockLocalPod.id);

          // Check regenerating state is set immediately by checking the store directly
          expect(useLocalPodsStore.getState().isRegenerating.has(mockLocalPod.id)).toBe(true);

          // Resolve the promise
          resolvePromise!(regenerateResponse);
          await regeneratePromise;
        });

        expect(result.current.isRegenerating.has(mockLocalPod.id)).toBe(false);
      });

      it('handles error during token regeneration', async () => {
        const errorMessage = 'Failed to regenerate token';
        vi.mocked(api.regenerateLocalPodToken).mockRejectedValue(new Error(errorMessage));

        const { result } = renderHook(() => useLocalPodsStore());

        act(() => {
          useLocalPodsStore.setState({ pods: [mockLocalPod] }, false);
        });

        let caughtError;
        try {
          await act(async () => {
            await result.current.regenerateToken(mockLocalPod.id);
          });
        } catch (err) {
          caughtError = err;
        }

        expect(caughtError).toBeInstanceOf(Error);
        expect((caughtError as Error).message).toBe(errorMessage);
        expect(result.current.error).toBe(errorMessage);
        expect(result.current.isRegenerating.has(mockLocalPod.id)).toBe(false);
      });
    });

    describe('selectPod', () => {
      it('selects a pod', () => {
        const { result } = renderHook(() => useLocalPodsStore());

        act(() => {
          result.current.selectPod(mockLocalPod.id);
        });

        expect(result.current.selectedPodId).toBe(mockLocalPod.id);
      });

      it('can clear selection by passing null', () => {
        const { result } = renderHook(() => useLocalPodsStore());

        act(() => {
          result.current.selectPod(mockLocalPod.id);
          result.current.selectPod(null);
        });

        expect(result.current.selectedPodId).toBeNull();
      });

      it('can switch between pods', () => {
        const { result } = renderHook(() => useLocalPodsStore());

        act(() => {
          result.current.selectPod(mockLocalPod.id);
        });

        expect(result.current.selectedPodId).toBe(mockLocalPod.id);

        act(() => {
          result.current.selectPod(mockOfflinePod.id);
        });

        expect(result.current.selectedPodId).toBe(mockOfflinePod.id);
      });
    });
  });

  // ========================================================================
  // Pod Status Management
  // ========================================================================

  describe('Pod Status Management', () => {
    it('filters online pods correctly', () => {
      const { result } = renderHook(() => useLocalPodsStore());

      act(() => {
        useLocalPodsStore.setState(
          {
            pods: [mockLocalPod, mockOfflinePod, mockErrorPod, mockBusyPod],
          },
          false
        );
      });

      const onlinePods = result.current.pods.filter((p) => p.status === 'online');
      expect(onlinePods).toHaveLength(1);
      expect(onlinePods[0]).toEqual(mockLocalPod);
    });

    it('filters busy pods correctly', () => {
      const { result } = renderHook(() => useLocalPodsStore());

      act(() => {
        useLocalPodsStore.setState(
          {
            pods: [mockLocalPod, mockOfflinePod, mockErrorPod, mockBusyPod],
          },
          false
        );
      });

      const busyPods = result.current.pods.filter((p) => p.status === 'busy');
      expect(busyPods).toHaveLength(1);
      expect(busyPods[0]).toEqual(mockBusyPod);
    });

    it('filters error pods correctly', () => {
      const { result } = renderHook(() => useLocalPodsStore());

      act(() => {
        useLocalPodsStore.setState(
          {
            pods: [mockLocalPod, mockOfflinePod, mockErrorPod, mockBusyPod],
          },
          false
        );
      });

      const errorPods = result.current.pods.filter((p) => p.status === 'error');
      expect(errorPods).toHaveLength(1);
      expect(errorPods[0]).toEqual(mockErrorPod);
    });

    it('tracks pod heartbeat status', () => {
      const { result } = renderHook(() => useLocalPodsStore());

      act(() => {
        useLocalPodsStore.setState({ pods: [mockLocalPod, mockOfflinePod] });
      });

      const onlinePod = result.current.pods.find((p) => p.id === mockLocalPod.id);
      const offlinePod = result.current.pods.find((p) => p.id === mockOfflinePod.id);

      expect(onlinePod?.last_heartbeat).toBe('2024-01-20T12:00:00Z');
      expect(offlinePod?.last_heartbeat).toBe('2024-01-15T10:00:00Z');
    });
  });

  // ========================================================================
  // Pod Resources
  // ========================================================================

  describe('Pod Resources', () => {
    it('tracks CPU and memory correctly', () => {
      const { result } = renderHook(() => useLocalPodsStore());

      act(() => {
        useLocalPodsStore.setState({ pods: [mockLocalPod] }, false);
      });

      const pod = result.current.pods[0];
      expect(pod.total_cpu_cores).toBe(8);
      expect(pod.total_memory_mb).toBe(16384);
    });

    it('tracks current workspace count', () => {
      const { result } = renderHook(() => useLocalPodsStore());

      act(() => {
        useLocalPodsStore.setState({ pods: [mockLocalPod, mockBusyPod] }, false);
      });

      const normalPod = result.current.pods.find((p) => p.id === mockLocalPod.id);
      const busyPod = result.current.pods.find((p) => p.id === mockBusyPod.id);

      expect(normalPod?.current_workspaces).toBe(2);
      expect(busyPod?.current_workspaces).toBe(5);
    });

    it('handles pods with null resource values', () => {
      const podWithNullResources: LocalPod = {
        ...mockLocalPod,
        id: 'pod-null',
        total_cpu_cores: null,
        total_memory_mb: null,
      };

      const { result } = renderHook(() => useLocalPodsStore());

      act(() => {
        useLocalPodsStore.setState({ pods: [podWithNullResources] }, false);
      });

      const pod = result.current.pods[0];
      expect(pod.total_cpu_cores).toBeNull();
      expect(pod.total_memory_mb).toBeNull();
    });
  });

  // ========================================================================
  // Pod Configuration
  // ========================================================================

  describe('Pod Configuration', () => {
    it('manages pod labels correctly', () => {
      const { result } = renderHook(() => useLocalPodsStore());

      act(() => {
        useLocalPodsStore.setState({ pods: [mockLocalPod] }, false);
      });

      const pod = result.current.pods[0];
      expect(pod.labels).toEqual({ env: 'development', region: 'us-east-1' });
    });

    it('handles pods with null labels', () => {
      const podWithoutLabels: LocalPod = {
        ...mockLocalPod,
        id: 'pod-no-labels',
        labels: null,
      };

      const { result } = renderHook(() => useLocalPodsStore());

      act(() => {
        useLocalPodsStore.setState({ pods: [podWithoutLabels] }, false);
      });

      const pod = result.current.pods[0];
      expect(pod.labels).toBeNull();
    });

    it('updates pod labels through update', async () => {
      const newLabels = { env: 'production', region: 'us-west-1', tier: 'premium' };
      const updatedPod: LocalPod = {
        ...mockLocalPod,
        labels: newLabels,
      };

      vi.mocked(api.updateLocalPod).mockResolvedValue(updatedPod);

      const { result } = renderHook(() => useLocalPodsStore());

      act(() => {
        useLocalPodsStore.setState({ pods: [mockLocalPod] }, false);
      });

      await act(async () => {
        await result.current.updatePod(mockLocalPod.id, { labels: newLabels });
      });

      const pod = result.current.pods[0];
      expect(pod.labels).toEqual(newLabels);
    });

    it('tracks pod system information', () => {
      const { result } = renderHook(() => useLocalPodsStore());

      act(() => {
        useLocalPodsStore.setState({ pods: [mockLocalPod] }, false);
      });

      const pod = result.current.pods[0];
      expect(pod.os_info).toBe('Linux 5.15.0');
      expect(pod.architecture).toBe('x86_64');
    });
  });

  // ========================================================================
  // Error & Token Management
  // ========================================================================

  describe('Error and Token Management', () => {
    it('sets error message', () => {
      const { result } = renderHook(() => useLocalPodsStore());

      act(() => {
        result.current.setError('Custom error message');
      });

      expect(result.current.error).toBe('Custom error message');
    });

    it('clears error message', () => {
      const { result } = renderHook(() => useLocalPodsStore());

      act(() => {
        result.current.setError('Error');
        result.current.clearError();
      });

      expect(result.current.error).toBeNull();
    });

    it('stores new token after creation', async () => {
      const createResponse: CreateLocalPodResponse = {
        pod: mockLocalPod,
        token: 'lpod_full_token_abc123xyz',
      };

      vi.mocked(api.createLocalPod).mockResolvedValue(createResponse);

      const { result } = renderHook(() => useLocalPodsStore());

      await act(async () => {
        await result.current.createPod({ name: 'New Pod' });
      });

      expect(result.current.newToken).toEqual({
        podId: mockLocalPod.id,
        token: createResponse.token,
      });
    });

    it('clears new token', async () => {
      const createResponse: CreateLocalPodResponse = {
        pod: mockLocalPod,
        token: 'token',
      };

      vi.mocked(api.createLocalPod).mockResolvedValue(createResponse);

      const { result } = renderHook(() => useLocalPodsStore());

      await act(async () => {
        await result.current.createPod({ name: 'New Pod' });
      });

      expect(result.current.newToken).not.toBeNull();

      act(() => {
        result.current.clearNewToken();
      });

      expect(result.current.newToken).toBeNull();
    });

    it('stores new token after regeneration', async () => {
      const regenerateResponse: RegenerateTokenResponse = {
        token: 'lpod_regenerated_token',
        token_prefix: 'lpod_regen',
      };

      vi.mocked(api.regenerateLocalPodToken).mockResolvedValue(regenerateResponse);

      const { result } = renderHook(() => useLocalPodsStore());

      act(() => {
        useLocalPodsStore.setState({ pods: [mockLocalPod] }, false);
      });

      await act(async () => {
        await result.current.regenerateToken(mockLocalPod.id);
      });

      expect(result.current.newToken).toEqual({
        podId: mockLocalPod.id,
        token: regenerateResponse.token,
      });
    });
  });

  // ========================================================================
  // Selectors
  // ========================================================================

  describe('Selectors', () => {
    it('selectOnlinePods returns only online pods', () => {
      const { result } = renderHook(() => useLocalPodsStore());

      act(() => {
        useLocalPodsStore.setState(
          {
            pods: [mockLocalPod, mockOfflinePod, mockErrorPod, mockBusyPod],
          },
          false
        );
      });

      const onlinePods = selectOnlinePods(result.current);

      expect(onlinePods).toHaveLength(1);
      expect(onlinePods[0].status).toBe('online');
    });

    it('selectPodById returns correct pod', () => {
      const { result } = renderHook(() => useLocalPodsStore());

      act(() => {
        useLocalPodsStore.setState({ pods: [mockLocalPod, mockOfflinePod] });
      });

      const pod = selectPodById(result.current, mockLocalPod.id);

      expect(pod).toEqual(mockLocalPod);
    });

    it('selectPodById returns undefined for non-existent pod', () => {
      const { result } = renderHook(() => useLocalPodsStore());

      act(() => {
        useLocalPodsStore.setState({ pods: [mockLocalPod] }, false);
      });

      const pod = selectPodById(result.current, 'non-existent-id');

      expect(pod).toBeUndefined();
    });

    it('selectIsDeleting returns true when pod is being deleted', () => {
      const { result } = renderHook(() => useLocalPodsStore());

      act(() => {
        useLocalPodsStore.setState(
          {
            isDeleting: new Set([mockLocalPod.id]),
          },
          false
        );
      });

      const isDeleting = selectIsDeleting(result.current, mockLocalPod.id);

      expect(isDeleting).toBe(true);
    });

    it('selectIsDeleting returns false when pod is not being deleted', () => {
      const { result } = renderHook(() => useLocalPodsStore());

      const isDeleting = selectIsDeleting(result.current, mockLocalPod.id);

      expect(isDeleting).toBe(false);
    });

    it('selectIsRegenerating returns true when token is being regenerated', () => {
      const { result } = renderHook(() => useLocalPodsStore());

      act(() => {
        useLocalPodsStore.setState(
          {
            isRegenerating: new Set([mockLocalPod.id]),
          },
          false
        );
      });

      const isRegenerating = selectIsRegenerating(result.current, mockLocalPod.id);

      expect(isRegenerating).toBe(true);
    });

    it('selectIsRegenerating returns false when token is not being regenerated', () => {
      const { result } = renderHook(() => useLocalPodsStore());

      const isRegenerating = selectIsRegenerating(result.current, mockLocalPod.id);

      expect(isRegenerating).toBe(false);
    });
  });
});
