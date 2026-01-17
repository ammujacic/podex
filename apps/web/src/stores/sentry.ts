/**
 * Sentry Store
 *
 * Manages state for the Sentry integration panel including:
 * - Configuration status (connected/disconnected)
 * - Setup wizard state
 * - Projects and issues data
 * - Filters and UI state
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import {
  checkSentryConfigured,
  testSentryToken,
  enableSentry,
  disableSentry,
  getSentryProjects,
  getSentryIssues,
  type SentryProject,
  type SentryIssue,
} from '@/lib/api/sentry';

// ============================================================================
// Types
// ============================================================================

export type StatusFilter = 'unresolved' | 'resolved' | 'ignored' | 'all';
export type ValidationStatus = 'idle' | 'checking' | 'valid' | 'invalid';

interface SentryState {
  // Configuration status
  isConfigured: boolean;
  serverId: string | null;
  isCheckingConfig: boolean;

  // Setup wizard state
  setupToken: string;
  setupShowToken: boolean;
  setupValidationStatus: ValidationStatus;
  setupValidationError: string | null;
  setupIsEnabling: boolean;
  setupShowInstructions: boolean;

  // Data
  projects: SentryProject[];
  issues: SentryIssue[];
  selectedProjectSlug: string | null;
  expandedIssueId: string | null;

  // Filters
  statusFilter: StatusFilter;

  // Loading/Error
  isLoadingProjects: boolean;
  isLoadingIssues: boolean;
  error: string | null;

  // Configuration actions
  checkConfiguration: () => Promise<void>;
  setSetupToken: (token: string) => void;
  toggleSetupShowToken: () => void;
  toggleSetupInstructions: () => void;
  validateToken: () => Promise<boolean>;
  connectSentry: () => Promise<boolean>;
  disconnectSentry: () => Promise<void>;
  resetSetup: () => void;

  // Data actions
  loadProjects: () => Promise<void>;
  loadIssues: () => Promise<void>;
  refresh: () => Promise<void>;
  selectProject: (slug: string | null) => void;
  setStatusFilter: (filter: StatusFilter) => void;
  toggleIssueExpanded: (issueId: string) => void;

  // Utilities
  setError: (error: string | null) => void;
  reset: () => void;
}

// ============================================================================
// Initial State
// ============================================================================

const initialState = {
  // Configuration status
  isConfigured: false,
  serverId: null,
  isCheckingConfig: false,

  // Setup wizard state
  setupToken: '',
  setupShowToken: false,
  setupValidationStatus: 'idle' as ValidationStatus,
  setupValidationError: null,
  setupIsEnabling: false,
  setupShowInstructions: false,

  // Data
  projects: [] as SentryProject[],
  issues: [] as SentryIssue[],
  selectedProjectSlug: null,
  expandedIssueId: null,

  // Filters
  statusFilter: 'unresolved' as StatusFilter,

  // Loading/Error
  isLoadingProjects: false,
  isLoadingIssues: false,
  error: null,
};

// ============================================================================
// Store
// ============================================================================

export const useSentryStore = create<SentryState>()(
  devtools(
    (set, get) => ({
      ...initialState,

      // ======================================================================
      // Configuration Actions
      // ======================================================================

      checkConfiguration: async () => {
        set({ isCheckingConfig: true, error: null });
        try {
          const { isConfigured, server } = await checkSentryConfigured();
          set({
            isConfigured,
            serverId: server?.id || null,
            isCheckingConfig: false,
          });

          // If configured, load projects and issues
          if (isConfigured) {
            get().loadProjects();
          }
        } catch (err) {
          set({
            isCheckingConfig: false,
            error: err instanceof Error ? err.message : 'Failed to check configuration',
          });
        }
      },

      setSetupToken: (token: string) => {
        set({
          setupToken: token,
          setupValidationStatus: 'idle',
          setupValidationError: null,
        });
      },

      toggleSetupShowToken: () => {
        set((state) => ({ setupShowToken: !state.setupShowToken }));
      },

      toggleSetupInstructions: () => {
        set((state) => ({ setupShowInstructions: !state.setupShowInstructions }));
      },

      validateToken: async () => {
        const { setupToken } = get();
        if (!setupToken.trim()) {
          set({ setupValidationStatus: 'invalid', setupValidationError: 'Token is required' });
          return false;
        }

        set({ setupValidationStatus: 'checking', setupValidationError: null });

        try {
          const result = await testSentryToken(setupToken);
          if (result.success) {
            set({ setupValidationStatus: 'valid', setupValidationError: null });
            return true;
          } else {
            set({
              setupValidationStatus: 'invalid',
              setupValidationError: result.error || 'Invalid token',
            });
            return false;
          }
        } catch (err) {
          set({
            setupValidationStatus: 'invalid',
            setupValidationError: err instanceof Error ? err.message : 'Validation failed',
          });
          return false;
        }
      },

      connectSentry: async () => {
        const { setupToken } = get();
        set({ setupIsEnabling: true, error: null });

        try {
          const result = await enableSentry(setupToken);
          if (result.success && result.server) {
            set({
              isConfigured: true,
              serverId: result.server.id,
              setupIsEnabling: false,
              // Reset setup wizard state
              setupToken: '',
              setupShowToken: false,
              setupValidationStatus: 'idle',
              setupValidationError: null,
              setupShowInstructions: false,
            });

            // Load projects after successful connection
            get().loadProjects();
            return true;
          } else {
            set({
              setupIsEnabling: false,
              error: result.error || 'Failed to connect to Sentry',
            });
            return false;
          }
        } catch (err) {
          set({
            setupIsEnabling: false,
            error: err instanceof Error ? err.message : 'Failed to connect to Sentry',
          });
          return false;
        }
      },

      disconnectSentry: async () => {
        try {
          await disableSentry();
          set({
            isConfigured: false,
            serverId: null,
            projects: [],
            issues: [],
            selectedProjectSlug: null,
            expandedIssueId: null,
          });
        } catch (err) {
          set({
            error: err instanceof Error ? err.message : 'Failed to disconnect from Sentry',
          });
        }
      },

      resetSetup: () => {
        set({
          setupToken: '',
          setupShowToken: false,
          setupValidationStatus: 'idle',
          setupValidationError: null,
          setupIsEnabling: false,
          setupShowInstructions: false,
        });
      },

      // ======================================================================
      // Data Actions
      // ======================================================================

      loadProjects: async () => {
        set({ isLoadingProjects: true, error: null });

        try {
          const projects = await getSentryProjects();
          set({ projects, isLoadingProjects: false });

          // Auto-select first project if none selected
          const { selectedProjectSlug } = get();
          const firstProject = projects[0];
          if (!selectedProjectSlug && firstProject) {
            set({ selectedProjectSlug: firstProject.slug });
            get().loadIssues();
          }
        } catch (err) {
          set({
            isLoadingProjects: false,
            error: err instanceof Error ? err.message : 'Failed to load projects',
          });
        }
      },

      loadIssues: async () => {
        const { selectedProjectSlug, statusFilter } = get();
        if (!selectedProjectSlug) {
          set({ issues: [] });
          return;
        }

        set({ isLoadingIssues: true, error: null });

        try {
          const issues = await getSentryIssues(selectedProjectSlug, {
            status: statusFilter === 'all' ? undefined : statusFilter,
            limit: 50,
          });
          set({ issues, isLoadingIssues: false });
        } catch (err) {
          set({
            isLoadingIssues: false,
            error: err instanceof Error ? err.message : 'Failed to load issues',
          });
        }
      },

      refresh: async () => {
        const { isConfigured } = get();
        if (!isConfigured) {
          await get().checkConfiguration();
          return;
        }

        await get().loadIssues();
      },

      selectProject: (slug: string | null) => {
        set({ selectedProjectSlug: slug, issues: [], expandedIssueId: null });
        if (slug) {
          get().loadIssues();
        }
      },

      setStatusFilter: (filter: StatusFilter) => {
        set({ statusFilter: filter });
        get().loadIssues();
      },

      toggleIssueExpanded: (issueId: string) => {
        set((state) => ({
          expandedIssueId: state.expandedIssueId === issueId ? null : issueId,
        }));
      },

      // ======================================================================
      // Utilities
      // ======================================================================

      setError: (error: string | null) => {
        set({ error });
      },

      reset: () => {
        set(initialState);
      },
    }),
    { name: 'sentry-store' }
  )
);

// ============================================================================
// Selectors
// ============================================================================

export const selectUnresolvedCount = (state: SentryState): number =>
  state.issues.filter((i) => i.status === 'unresolved').length;

export const selectFilteredIssues = (state: SentryState): SentryIssue[] => {
  if (state.statusFilter === 'all') {
    return state.issues;
  }
  return state.issues.filter((i) => i.status === state.statusFilter);
};

export const selectIsLoading = (state: SentryState): boolean =>
  state.isCheckingConfig || state.isLoadingProjects || state.isLoadingIssues;
