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
import { devtools, persist } from 'zustand/middleware';
import {
  checkSentryConfigured,
  testSentryToken,
  enableSentry,
  disableSentry,
  getSentryOrganizations,
  getSentryProjects,
  getSentryIssues,
  refreshSentryServer,
  type SentryOrganization,
  type SentryProject,
  type SentryIssue,
} from '@/lib/api/sentry';

// ============================================================================
// Types
// ============================================================================

export type StatusFilter = 'unresolved' | 'resolved' | 'ignored' | 'all';
export type ValidationStatus = 'idle' | 'checking' | 'valid' | 'invalid';

// Sentry region options
// NOTE: Currently only the main Sentry Cloud region is supported via the MCP server.
// Self-hosted instances can use the custom option with their hostname.
export const SENTRY_REGIONS = [
  { value: '', label: 'Sentry Cloud', host: '' },
  { value: 'custom', label: 'Self-hosted', host: '' },
] as const;

// Cache TTL for data fetches (5 minutes)
const DATA_CACHE_TTL_MS = 5 * 60 * 1000;

interface SentryState {
  // Configuration status
  isConfigured: boolean;
  serverId: string | null;
  isCheckingConfig: boolean;

  // Cache timestamps for data
  lastDataFetch: number | null; // Timestamp of last orgs/projects/issues fetch

  // Setup wizard state
  setupToken: string;
  setupShowToken: boolean;
  setupRegion: string; // '' for US, 'de.sentry.io' for EU, 'custom' for self-hosted
  setupCustomHost: string; // Used when region is 'custom'
  setupOpenAIKey: string; // OpenAI API key for AI-powered search tools
  setupValidationStatus: ValidationStatus;
  setupValidationError: string | null;
  setupIsEnabling: boolean;
  setupShowInstructions: boolean;

  // Data
  organizations: SentryOrganization[];
  selectedOrganizationSlug: string | null;
  projects: SentryProject[];
  issues: SentryIssue[];
  selectedProjectSlug: string | null;
  expandedIssueId: string | null;

  // Filters
  statusFilter: StatusFilter;

  // Loading/Error
  isLoadingOrganizations: boolean;
  isLoadingProjects: boolean;
  isLoadingIssues: boolean;
  error: string | null;

  // Configuration actions
  checkConfiguration: (forceRefresh?: boolean) => Promise<void>;
  setSetupToken: (token: string) => void;
  setSetupRegion: (region: string) => void;
  setSetupCustomHost: (host: string) => void;
  setSetupOpenAIKey: (key: string) => void;
  toggleSetupShowToken: () => void;
  toggleSetupInstructions: () => void;
  validateToken: () => Promise<boolean>;
  connectSentry: () => Promise<boolean>;
  disconnectSentry: () => Promise<void>;
  resetSetup: () => void;

  // Data actions
  loadOrganizations: (retryAfterRefresh?: boolean, forceRefresh?: boolean) => Promise<void>;
  loadProjects: (forceRefresh?: boolean) => Promise<void>;
  loadIssues: (forceRefresh?: boolean) => Promise<void>;
  refresh: () => Promise<void>; // Always forces fresh data
  refreshServer: () => Promise<void>;
  selectOrganization: (slug: string | null) => void;
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

  // Cache timestamps
  lastDataFetch: null as number | null,

  // Setup wizard state
  setupToken: '',
  setupShowToken: false,
  setupRegion: '', // Default to US region
  setupCustomHost: '',
  setupOpenAIKey: '', // OpenAI API key for AI-powered search
  setupValidationStatus: 'idle' as ValidationStatus,
  setupValidationError: null,
  setupIsEnabling: false,
  setupShowInstructions: false,

  // Data
  organizations: [] as SentryOrganization[],
  selectedOrganizationSlug: null,
  projects: [] as SentryProject[],
  issues: [] as SentryIssue[],
  selectedProjectSlug: null,
  expandedIssueId: null,

  // Filters
  statusFilter: 'unresolved' as StatusFilter,

  // Loading/Error
  isLoadingOrganizations: false,
  isLoadingProjects: false,
  isLoadingIssues: false,
  error: null,
};

// ============================================================================
// Store
// ============================================================================

export const useSentryStore = create<SentryState>()(
  devtools(
    persist(
      (set, get) => ({
        ...initialState,

        // ======================================================================
        // Configuration Actions
        // ======================================================================

        checkConfiguration: async (forceRefresh = false) => {
          const { lastDataFetch, isConfigured, organizations } = get();
          const now = Date.now();

          // If we have cached data within TTL and not forcing refresh, use it
          const hasCachedData =
            lastDataFetch && now - lastDataFetch < DATA_CACHE_TTL_MS && organizations.length > 0;

          if (!forceRefresh && hasCachedData && isConfigured) {
            // Data is fresh, no need to refetch
            return;
          }

          set({ isCheckingConfig: true, error: null });
          try {
            const { isConfigured: configured, server } = await checkSentryConfigured();

            if (!configured) {
              // Sentry MCP is not configured for this workspace.
              // Clean up any stale localStorage state from previous workspaces so
              // we don't show outdated badges or cached issues.
              set({
                isConfigured: false,
                serverId: null,
                isCheckingConfig: false,
                lastDataFetch: null,
                organizations: [],
                selectedOrganizationSlug: null,
                projects: [],
                issues: [],
                selectedProjectSlug: null,
                expandedIssueId: null,
              });
              return;
            }

            set({
              isConfigured: true,
              serverId: server?.id || null,
              isCheckingConfig: false,
            });

            // If configured, load organizations (respects cache unless forcing)
            await get().loadOrganizations(true, forceRefresh);
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

        setSetupRegion: (region: string) => {
          set({
            setupRegion: region,
            setupValidationStatus: 'idle',
            setupValidationError: null,
          });
        },

        setSetupCustomHost: (host: string) => {
          set({
            setupCustomHost: host,
            setupValidationStatus: 'idle',
            setupValidationError: null,
          });
        },

        setSetupOpenAIKey: (key: string) => {
          set({ setupOpenAIKey: key });
        },

        toggleSetupShowToken: () => {
          set((state) => ({ setupShowToken: !state.setupShowToken }));
        },

        toggleSetupInstructions: () => {
          set((state) => ({ setupShowInstructions: !state.setupShowInstructions }));
        },

        validateToken: async () => {
          const { setupToken, setupRegion, setupCustomHost } = get();
          if (!setupToken.trim()) {
            set({ setupValidationStatus: 'invalid', setupValidationError: 'Token is required' });
            return false;
          }

          // Determine the host based on region selection
          let host: string | undefined;
          if (setupRegion === 'custom') {
            if (!setupCustomHost.trim()) {
              set({
                setupValidationStatus: 'invalid',
                setupValidationError: 'Custom host is required',
              });
              return false;
            }
            host = setupCustomHost.trim();
          } else if (setupRegion) {
            host = setupRegion;
          }

          set({ setupValidationStatus: 'checking', setupValidationError: null });

          try {
            const result = await testSentryToken(setupToken, host);
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
          const { setupToken, setupRegion, setupCustomHost, setupOpenAIKey } = get();
          set({ setupIsEnabling: true, error: null });

          // Determine the host based on region selection
          let host: string | undefined;
          if (setupRegion === 'custom') {
            host = setupCustomHost.trim() || undefined;
          } else if (setupRegion) {
            host = setupRegion;
          }

          // Pass OpenAI key if provided
          const openAIKey = setupOpenAIKey.trim() || undefined;

          try {
            const result = await enableSentry(setupToken, host, openAIKey);
            if (result.success && result.server) {
              set({
                isConfigured: true,
                serverId: result.server.id,
                setupIsEnabling: false,
                // Reset setup wizard state
                setupToken: '',
                setupShowToken: false,
                setupRegion: '',
                setupCustomHost: '',
                setupOpenAIKey: '',
                setupValidationStatus: 'idle',
                setupValidationError: null,
                setupShowInstructions: false,
              });

              // Load organizations after successful connection (which will then load projects)
              // IMPORTANT: Await to ensure orgs/projects are loaded before returning
              await get().loadOrganizations();
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
              lastDataFetch: null, // Clear cache so next check fetches fresh
              organizations: [],
              selectedOrganizationSlug: null,
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
            setupRegion: '',
            setupCustomHost: '',
            setupOpenAIKey: '',
            setupValidationStatus: 'idle',
            setupValidationError: null,
            setupIsEnabling: false,
            setupShowInstructions: false,
          });
        },

        // ======================================================================
        // Data Actions
        // ======================================================================

        loadOrganizations: async (retryAfterRefresh = true, forceRefresh = false) => {
          const { lastDataFetch, organizations } = get();
          const now = Date.now();

          // If we have cached data within TTL and not forcing refresh, skip fetch
          const hasCachedData =
            lastDataFetch && now - lastDataFetch < DATA_CACHE_TTL_MS && organizations.length > 0;

          if (!forceRefresh && hasCachedData) {
            // Data is fresh, just ensure projects are loaded
            const { selectedOrganizationSlug } = get();
            if (selectedOrganizationSlug) {
              await get().loadProjects(forceRefresh);
            }
            return;
          }

          set({ isLoadingOrganizations: true, error: null });

          try {
            const orgs = await getSentryOrganizations();
            set({
              organizations: orgs,
              isLoadingOrganizations: false,
              lastDataFetch: now,
            });

            // Check if persisted selection exists in loaded organizations
            const { selectedOrganizationSlug } = get();
            const firstOrg = orgs[0];
            const persistedOrgExists =
              selectedOrganizationSlug && orgs.some((org) => org.slug === selectedOrganizationSlug);

            if (persistedOrgExists) {
              // Use persisted selection, load its projects
              await get().loadProjects(forceRefresh);
            } else if (firstOrg) {
              // Fall back to first org if no valid persisted selection
              set({ selectedOrganizationSlug: firstOrg.slug, selectedProjectSlug: null });
              await get().loadProjects(forceRefresh);
            }
          } catch (err) {
            const errorMessage =
              err instanceof Error ? err.message : 'Failed to load organizations';

            // If tools are not found, try to refresh the server first (only once)
            if (retryAfterRefresh && errorMessage.includes('not found')) {
              console.warn('Tools not discovered, refreshing Sentry server...');
              try {
                await refreshSentryServer();
                // Retry loading organizations, but don't refresh again if it fails
                return get().loadOrganizations(false, forceRefresh);
              } catch {
                // If refresh fails, show the original error
                set({
                  isLoadingOrganizations: false,
                  error: errorMessage,
                });
                return;
              }
            }

            set({
              isLoadingOrganizations: false,
              error: errorMessage,
            });
          }
        },

        loadProjects: async (forceRefresh = false) => {
          const { selectedOrganizationSlug, organizations, projects, lastDataFetch } = get();
          if (!selectedOrganizationSlug) {
            set({ projects: [] });
            return;
          }

          // If we have cached projects within TTL and not forcing refresh, skip fetch
          const now = Date.now();
          const hasCachedData =
            lastDataFetch && now - lastDataFetch < DATA_CACHE_TTL_MS && projects.length > 0;

          if (!forceRefresh && hasCachedData) {
            // Data is fresh, just ensure issues are loaded
            const { selectedProjectSlug } = get();
            if (selectedProjectSlug) {
              await get().loadIssues(forceRefresh);
            }
            return;
          }

          // Get regionUrl for the selected organization (required for cloud Sentry)
          const selectedOrg = organizations.find((o) => o.slug === selectedOrganizationSlug);
          const regionUrl = selectedOrg?.regionUrl;

          set({ isLoadingProjects: true, error: null });

          try {
            const projs = await getSentryProjects(selectedOrganizationSlug, regionUrl);
            set({ projects: projs, isLoadingProjects: false });

            // Check if persisted selection exists in loaded projects
            const { selectedProjectSlug } = get();
            const firstProject = projs[0];
            const persistedProjectExists =
              selectedProjectSlug && projs.some((p) => p.slug === selectedProjectSlug);

            if (persistedProjectExists) {
              // Use persisted selection, load its issues
              await get().loadIssues(forceRefresh);
            } else if (firstProject) {
              // Fall back to first project if no valid persisted selection
              set({ selectedProjectSlug: firstProject.slug });
              await get().loadIssues(forceRefresh);
            }
          } catch (err) {
            set({
              isLoadingProjects: false,
              error: err instanceof Error ? err.message : 'Failed to load projects',
            });
          }
        },

        loadIssues: async (forceRefresh = false) => {
          const {
            selectedOrganizationSlug,
            selectedProjectSlug,
            statusFilter,
            organizations,
            issues,
            lastDataFetch,
          } = get();
          if (!selectedOrganizationSlug) {
            set({ issues: [] });
            return;
          }

          // If we have cached issues within TTL and not forcing refresh, skip fetch
          const now = Date.now();
          const hasCachedData =
            lastDataFetch && now - lastDataFetch < DATA_CACHE_TTL_MS && issues.length > 0;

          if (!forceRefresh && hasCachedData) {
            // Data is fresh, no need to refetch
            return;
          }

          // Get regionUrl for the selected organization (required for cloud Sentry)
          const selectedOrg = organizations.find((o) => o.slug === selectedOrganizationSlug);
          const regionUrl = selectedOrg?.regionUrl;

          set({ isLoadingIssues: true, error: null });

          try {
            const fetchedIssues = await getSentryIssues(selectedOrganizationSlug, {
              projectSlug: selectedProjectSlug || undefined,
              status: statusFilter === 'all' ? undefined : statusFilter,
              limit: 50,
              regionUrl,
            });
            set({ issues: fetchedIssues, isLoadingIssues: false });
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
            await get().checkConfiguration(true);
            return;
          }

          // Manual refresh always forces fresh data
          await get().loadIssues(true);
        },

        refreshServer: async () => {
          set({ isLoadingOrganizations: true, error: null, lastDataFetch: null });

          try {
            // Refresh the server to rediscover tools
            await refreshSentryServer();
            // Force a fresh config check
            await get().checkConfiguration(true);
          } catch (err) {
            set({
              isLoadingOrganizations: false,
              error: err instanceof Error ? err.message : 'Failed to refresh server',
            });
          }
        },

        selectOrganization: (slug: string | null) => {
          set({
            selectedOrganizationSlug: slug,
            projects: [],
            selectedProjectSlug: null,
            issues: [],
            expandedIssueId: null,
          });
          if (slug) {
            // Force refresh since it's a new organization
            get().loadProjects(true);
          }
        },

        selectProject: (slug: string | null) => {
          set({ selectedProjectSlug: slug, issues: [], expandedIssueId: null });
          // Force refresh since it's a new project
          get().loadIssues(true);
        },

        setStatusFilter: (filter: StatusFilter) => {
          set({ statusFilter: filter });
          // Force refresh since filter changed
          get().loadIssues(true);
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
      {
        name: 'sentry-store-persist',
        // Persist configuration status, data, and user selections for immediate UI rendering
        partialize: (state) => ({
          // Configuration status
          isConfigured: state.isConfigured,
          serverId: state.serverId,
          // Cache timestamp for data freshness check
          lastDataFetch: state.lastDataFetch,
          // User selections
          selectedOrganizationSlug: state.selectedOrganizationSlug,
          selectedProjectSlug: state.selectedProjectSlug,
          statusFilter: state.statusFilter,
          // Persist all data so UI renders immediately on reload (cached for 5 min)
          organizations: state.organizations,
          projects: state.projects,
          issues: state.issues,
        }),
      }
    ),
    { name: 'sentry-store' }
  )
);

// ============================================================================
// Selectors
// ============================================================================

export const selectUnresolvedCount = (state: SentryState): number => {
  // If Sentry isn't configured for this workspace, ignore any stale persisted
  // issues data that may still be in localStorage from a different workspace.
  if (!state.isConfigured) return 0;
  return state.issues.filter((i) => i.status === 'unresolved').length;
};

export const selectFilteredIssues = (state: SentryState): SentryIssue[] => {
  if (state.statusFilter === 'all') {
    return state.issues;
  }
  return state.issues.filter((i) => i.status === state.statusFilter);
};

export const selectIsLoading = (state: SentryState): boolean =>
  state.isCheckingConfig ||
  state.isLoadingOrganizations ||
  state.isLoadingProjects ||
  state.isLoadingIssues;
