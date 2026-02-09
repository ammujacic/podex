import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  useSentryStore,
  selectUnresolvedCount,
  selectFilteredIssues,
  selectIsLoading,
} from '../sentry';
import type { SentryOrganization, SentryProject, SentryIssue } from '@/lib/api/sentry';
import * as sentryApi from '@/lib/api/sentry';

// ============================================================================
// Mock Data
// ============================================================================

const mockSentryOrganization: SentryOrganization = {
  slug: 'test-org',
  name: 'Test Organization',
  regionUrl: 'https://us.sentry.io',
};

const mockSentryOrganization2: SentryOrganization = {
  slug: 'second-org',
  name: 'Second Organization',
  regionUrl: 'https://us.sentry.io',
};

const mockSentryProject: SentryProject = {
  id: 'test-org-my-app',
  slug: 'my-app',
  name: 'My App',
  platform: 'javascript',
  organizationSlug: 'test-org',
};

const mockSentryProject2: SentryProject = {
  id: 'test-org-api',
  slug: 'api',
  name: 'API',
  platform: 'python',
  organizationSlug: 'test-org',
};

const mockSentryIssue: SentryIssue = {
  id: 'ISSUE-1',
  shortId: 'MY-APP-1',
  title: 'TypeError: Cannot read property of undefined',
  culprit: 'src/components/App.tsx',
  permalink: 'https://sentry.io/organizations/test-org/issues/ISSUE-1/',
  level: 'error',
  status: 'unresolved',
  count: 42,
  userCount: 5,
  firstSeen: '2024-01-01T00:00:00Z',
  lastSeen: '2024-01-15T12:00:00Z',
  project: {
    id: 'my-app',
    slug: 'my-app',
    name: 'My App',
  },
};

const mockSentryIssueFatal: SentryIssue = {
  ...mockSentryIssue,
  id: 'ISSUE-2',
  shortId: 'MY-APP-2',
  title: 'Fatal Error: Application Crash',
  level: 'fatal',
  count: 100,
  userCount: 25,
};

const mockSentryIssueWarning: SentryIssue = {
  ...mockSentryIssue,
  id: 'ISSUE-3',
  shortId: 'MY-APP-3',
  title: 'Warning: Deprecated API Usage',
  level: 'warning',
  status: 'resolved',
  count: 10,
  userCount: 2,
};

const mockSentryIssueInfo: SentryIssue = {
  ...mockSentryIssue,
  id: 'ISSUE-4',
  shortId: 'MY-APP-4',
  title: 'Info: User action logged',
  level: 'info',
  status: 'ignored',
  count: 5,
  userCount: 1,
};

const mockMCPServer = {
  id: 'server-123',
  source_slug: 'sentry',
  is_enabled: true,
  name: 'Sentry',
};

// ============================================================================
// Mocks
// ============================================================================

vi.mock('@/lib/api/sentry', () => ({
  checkSentryConfigured: vi.fn(),
  testSentryToken: vi.fn(),
  enableSentry: vi.fn(),
  disableSentry: vi.fn(),
  getSentryOrganizations: vi.fn(),
  getSentryProjects: vi.fn(),
  getSentryIssues: vi.fn(),
  refreshSentryServer: vi.fn(),
}));

describe('sentryStore', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    act(() => {
      useSentryStore.setState({
        isConfigured: false,
        serverId: null,
        isCheckingConfig: false,
        lastDataFetch: null,
        setupToken: '',
        setupShowToken: false,
        setupRegion: '',
        setupCustomHost: '',
        setupOpenAIKey: '',
        setupValidationStatus: 'idle',
        setupValidationError: null,
        setupIsEnabling: false,
        setupShowInstructions: false,
        organizations: [],
        selectedOrganizationSlug: null,
        projects: [],
        issues: [],
        selectedProjectSlug: null,
        expandedIssueId: null,
        statusFilter: 'unresolved',
        isLoadingOrganizations: false,
        isLoadingProjects: false,
        isLoadingIssues: false,
        error: null,
      });
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
    it('has not configured status', () => {
      const { result } = renderHook(() => useSentryStore());
      expect(result.current.isConfigured).toBe(false);
    });

    it('has no server ID', () => {
      const { result } = renderHook(() => useSentryStore());
      expect(result.current.serverId).toBeNull();
    });

    it('has empty setup wizard state', () => {
      const { result } = renderHook(() => useSentryStore());
      expect(result.current.setupToken).toBe('');
      expect(result.current.setupRegion).toBe('');
      expect(result.current.setupCustomHost).toBe('');
      expect(result.current.setupOpenAIKey).toBe('');
      expect(result.current.setupValidationStatus).toBe('idle');
    });

    it('has empty data arrays', () => {
      const { result } = renderHook(() => useSentryStore());
      expect(result.current.organizations).toEqual([]);
      expect(result.current.projects).toEqual([]);
      expect(result.current.issues).toEqual([]);
    });

    it('has unresolved as default status filter', () => {
      const { result } = renderHook(() => useSentryStore());
      expect(result.current.statusFilter).toBe('unresolved');
    });
  });

  // ========================================================================
  // Configuration Actions
  // ========================================================================

  describe('Configuration Management', () => {
    describe('checkConfiguration', () => {
      it('checks if Sentry is configured', async () => {
        const { result } = renderHook(() => useSentryStore());
        vi.mocked(sentryApi.checkSentryConfigured).mockResolvedValue({
          isConfigured: true,
          server: mockMCPServer,
        });
        vi.mocked(sentryApi.getSentryOrganizations).mockResolvedValue([]);

        await act(async () => {
          await result.current.checkConfiguration();
        });

        expect(result.current.isConfigured).toBe(true);
        expect(result.current.serverId).toBe('server-123');
      });

      it('sets checking flag during check', async () => {
        const { result } = renderHook(() => useSentryStore());
        vi.mocked(sentryApi.checkSentryConfigured).mockImplementation(
          () =>
            new Promise((resolve) =>
              setTimeout(() => resolve({ isConfigured: false, server: null }), 100)
            )
        );

        act(() => {
          result.current.checkConfiguration();
        });

        expect(result.current.isCheckingConfig).toBe(true);
      });

      it('loads organizations if configured', async () => {
        const { result } = renderHook(() => useSentryStore());
        vi.mocked(sentryApi.checkSentryConfigured).mockResolvedValue({
          isConfigured: true,
          server: mockMCPServer,
        });
        vi.mocked(sentryApi.getSentryOrganizations).mockResolvedValue([mockSentryOrganization]);

        await act(async () => {
          await result.current.checkConfiguration();
        });

        expect(sentryApi.getSentryOrganizations).toHaveBeenCalled();
      });

      it('handles errors gracefully', async () => {
        const { result } = renderHook(() => useSentryStore());
        vi.mocked(sentryApi.checkSentryConfigured).mockRejectedValue(new Error('Network error'));

        await act(async () => {
          await result.current.checkConfiguration();
        });

        expect(result.current.error).toBe('Network error');
        expect(result.current.isCheckingConfig).toBe(false);
      });
    });

    describe('setSetupToken', () => {
      it('sets setup token', () => {
        const { result } = renderHook(() => useSentryStore());

        act(() => {
          result.current.setSetupToken('test-token-123');
        });

        expect(result.current.setupToken).toBe('test-token-123');
      });

      it('resets validation status when token changes', () => {
        const { result } = renderHook(() => useSentryStore());

        act(() => {
          useSentryStore.setState({ setupValidationStatus: 'valid' });
          result.current.setSetupToken('new-token');
        });

        expect(result.current.setupValidationStatus).toBe('idle');
      });

      it('clears validation error when token changes', () => {
        const { result } = renderHook(() => useSentryStore());

        act(() => {
          useSentryStore.setState({ setupValidationError: 'Invalid token' });
          result.current.setSetupToken('new-token');
        });

        expect(result.current.setupValidationError).toBeNull();
      });
    });

    describe('setSetupRegion', () => {
      it('sets setup region', () => {
        const { result } = renderHook(() => useSentryStore());

        act(() => {
          result.current.setSetupRegion('de.sentry.io');
        });

        expect(result.current.setupRegion).toBe('de.sentry.io');
      });

      it('resets validation status when region changes', () => {
        const { result } = renderHook(() => useSentryStore());

        act(() => {
          useSentryStore.setState({ setupValidationStatus: 'valid' });
          result.current.setSetupRegion('de.sentry.io');
        });

        expect(result.current.setupValidationStatus).toBe('idle');
      });
    });

    describe('setSetupCustomHost', () => {
      it('sets custom host', () => {
        const { result } = renderHook(() => useSentryStore());

        act(() => {
          result.current.setSetupCustomHost('sentry.mycompany.com');
        });

        expect(result.current.setupCustomHost).toBe('sentry.mycompany.com');
      });

      it('resets validation when host changes', () => {
        const { result } = renderHook(() => useSentryStore());

        act(() => {
          useSentryStore.setState({ setupValidationStatus: 'valid' });
          result.current.setSetupCustomHost('new-host.com');
        });

        expect(result.current.setupValidationStatus).toBe('idle');
      });
    });

    describe('setSetupOpenAIKey', () => {
      it('sets OpenAI API key', () => {
        const { result } = renderHook(() => useSentryStore());

        act(() => {
          result.current.setSetupOpenAIKey('sk-test-key');
        });

        expect(result.current.setupOpenAIKey).toBe('sk-test-key');
      });
    });

    describe('toggleSetupShowToken', () => {
      it('toggles token visibility', () => {
        const { result } = renderHook(() => useSentryStore());

        act(() => {
          result.current.toggleSetupShowToken();
        });

        expect(result.current.setupShowToken).toBe(true);

        act(() => {
          result.current.toggleSetupShowToken();
        });

        expect(result.current.setupShowToken).toBe(false);
      });
    });

    describe('toggleSetupInstructions', () => {
      it('toggles instructions visibility', () => {
        const { result } = renderHook(() => useSentryStore());

        act(() => {
          result.current.toggleSetupInstructions();
        });

        expect(result.current.setupShowInstructions).toBe(true);

        act(() => {
          result.current.toggleSetupInstructions();
        });

        expect(result.current.setupShowInstructions).toBe(false);
      });
    });

    describe('validateToken', () => {
      it('validates token successfully', async () => {
        const { result } = renderHook(() => useSentryStore());
        vi.mocked(sentryApi.testSentryToken).mockResolvedValue({ success: true });

        act(() => {
          result.current.setSetupToken('valid-token');
        });

        let isValid: boolean = false;
        await act(async () => {
          isValid = await result.current.validateToken();
        });

        expect(isValid).toBe(true);
        expect(result.current.setupValidationStatus).toBe('valid');
      });

      it('fails validation for empty token', async () => {
        const { result } = renderHook(() => useSentryStore());

        let isValid: boolean = true;
        await act(async () => {
          isValid = await result.current.validateToken();
        });

        expect(isValid).toBe(false);
        expect(result.current.setupValidationStatus).toBe('invalid');
        expect(result.current.setupValidationError).toBe('Token is required');
      });

      it('fails validation for invalid token', async () => {
        const { result } = renderHook(() => useSentryStore());
        vi.mocked(sentryApi.testSentryToken).mockResolvedValue({
          success: false,
          error: 'Invalid credentials',
        });

        act(() => {
          result.current.setSetupToken('invalid-token');
        });

        let isValid: boolean = true;
        await act(async () => {
          isValid = await result.current.validateToken();
        });

        expect(isValid).toBe(false);
        expect(result.current.setupValidationStatus).toBe('invalid');
        expect(result.current.setupValidationError).toBe('Invalid credentials');
      });

      it('validates with custom host', async () => {
        const { result } = renderHook(() => useSentryStore());
        vi.mocked(sentryApi.testSentryToken).mockResolvedValue({ success: true });

        act(() => {
          result.current.setSetupToken('token');
          result.current.setSetupRegion('custom');
          result.current.setSetupCustomHost('sentry.mycompany.com');
        });

        await act(async () => {
          await result.current.validateToken();
        });

        expect(sentryApi.testSentryToken).toHaveBeenCalledWith('token', 'sentry.mycompany.com');
      });

      it('requires custom host when region is custom', async () => {
        const { result } = renderHook(() => useSentryStore());

        act(() => {
          result.current.setSetupToken('token');
          result.current.setSetupRegion('custom');
        });

        let isValid: boolean = true;
        await act(async () => {
          isValid = await result.current.validateToken();
        });

        expect(isValid).toBe(false);
        expect(result.current.setupValidationError).toBe('Custom host is required');
      });

      it('sets checking status during validation', async () => {
        const { result } = renderHook(() => useSentryStore());
        vi.mocked(sentryApi.testSentryToken).mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve({ success: true }), 100))
        );

        act(() => {
          result.current.setSetupToken('token');
          result.current.validateToken();
        });

        expect(result.current.setupValidationStatus).toBe('checking');
      });

      it('handles validation errors', async () => {
        const { result } = renderHook(() => useSentryStore());
        vi.mocked(sentryApi.testSentryToken).mockRejectedValue(new Error('Network error'));

        act(() => {
          result.current.setSetupToken('token');
        });

        await act(async () => {
          await result.current.validateToken();
        });

        expect(result.current.setupValidationStatus).toBe('invalid');
        expect(result.current.setupValidationError).toBe('Network error');
      });
    });

    describe('connectSentry', () => {
      it('connects successfully', async () => {
        const { result } = renderHook(() => useSentryStore());
        vi.mocked(sentryApi.enableSentry).mockResolvedValue({
          success: true,
          server: mockMCPServer,
        });
        vi.mocked(sentryApi.getSentryOrganizations).mockResolvedValue([]);

        act(() => {
          result.current.setSetupToken('token');
        });

        let success: boolean = false;
        await act(async () => {
          success = await result.current.connectSentry();
        });

        expect(success).toBe(true);
        expect(result.current.isConfigured).toBe(true);
        expect(result.current.serverId).toBe('server-123');
      });

      it('resets setup wizard after successful connection', async () => {
        const { result } = renderHook(() => useSentryStore());
        vi.mocked(sentryApi.enableSentry).mockResolvedValue({
          success: true,
          server: mockMCPServer,
        });
        vi.mocked(sentryApi.getSentryOrganizations).mockResolvedValue([]);

        act(() => {
          result.current.setSetupToken('token');
          result.current.setSetupRegion('de.sentry.io');
          result.current.setSetupOpenAIKey('sk-key');
        });

        await act(async () => {
          await result.current.connectSentry();
        });

        expect(result.current.setupToken).toBe('');
        expect(result.current.setupRegion).toBe('');
        expect(result.current.setupOpenAIKey).toBe('');
      });

      it('loads organizations after connection', async () => {
        const { result } = renderHook(() => useSentryStore());
        vi.mocked(sentryApi.enableSentry).mockResolvedValue({
          success: true,
          server: mockMCPServer,
        });
        vi.mocked(sentryApi.getSentryOrganizations).mockResolvedValue([mockSentryOrganization]);

        act(() => {
          result.current.setSetupToken('token');
        });

        await act(async () => {
          await result.current.connectSentry();
        });

        expect(sentryApi.getSentryOrganizations).toHaveBeenCalled();
      });

      it('passes custom host to enable API', async () => {
        const { result } = renderHook(() => useSentryStore());
        vi.mocked(sentryApi.enableSentry).mockResolvedValue({
          success: true,
          server: mockMCPServer,
        });
        vi.mocked(sentryApi.getSentryOrganizations).mockResolvedValue([]);

        act(() => {
          result.current.setSetupToken('token');
          result.current.setSetupRegion('custom');
          result.current.setSetupCustomHost('sentry.custom.com');
        });

        await act(async () => {
          await result.current.connectSentry();
        });

        expect(sentryApi.enableSentry).toHaveBeenCalledWith(
          'token',
          'sentry.custom.com',
          undefined
        );
      });

      it('passes OpenAI key if provided', async () => {
        const { result } = renderHook(() => useSentryStore());
        vi.mocked(sentryApi.enableSentry).mockResolvedValue({
          success: true,
          server: mockMCPServer,
        });
        vi.mocked(sentryApi.getSentryOrganizations).mockResolvedValue([]);

        act(() => {
          result.current.setSetupToken('token');
          result.current.setSetupOpenAIKey('sk-openai-key');
        });

        await act(async () => {
          await result.current.connectSentry();
        });

        expect(sentryApi.enableSentry).toHaveBeenCalledWith('token', undefined, 'sk-openai-key');
      });

      it('handles connection failure', async () => {
        const { result } = renderHook(() => useSentryStore());
        vi.mocked(sentryApi.enableSentry).mockResolvedValue({
          success: false,
          error: 'Connection failed',
        });

        act(() => {
          result.current.setSetupToken('token');
        });

        let success: boolean = true;
        await act(async () => {
          success = await result.current.connectSentry();
        });

        expect(success).toBe(false);
        expect(result.current.error).toBe('Connection failed');
      });

      it('handles connection errors', async () => {
        const { result } = renderHook(() => useSentryStore());
        vi.mocked(sentryApi.enableSentry).mockRejectedValue(new Error('Network error'));

        act(() => {
          result.current.setSetupToken('token');
        });

        await act(async () => {
          await result.current.connectSentry();
        });

        expect(result.current.error).toBe('Network error');
      });
    });

    describe('disconnectSentry', () => {
      it('disconnects successfully', async () => {
        const { result } = renderHook(() => useSentryStore());
        vi.mocked(sentryApi.disableSentry).mockResolvedValue({ success: true });

        act(() => {
          useSentryStore.setState({
            isConfigured: true,
            serverId: 'server-123',
            organizations: [mockSentryOrganization],
            projects: [mockSentryProject],
            issues: [mockSentryIssue],
          });
        });

        await act(async () => {
          await result.current.disconnectSentry();
        });

        expect(result.current.isConfigured).toBe(false);
        expect(result.current.serverId).toBeNull();
      });

      it('clears all data on disconnect', async () => {
        const { result } = renderHook(() => useSentryStore());
        vi.mocked(sentryApi.disableSentry).mockResolvedValue({ success: true });

        act(() => {
          useSentryStore.setState({
            isConfigured: true,
            organizations: [mockSentryOrganization],
            selectedOrganizationSlug: 'test-org',
            projects: [mockSentryProject],
            selectedProjectSlug: 'my-app',
            issues: [mockSentryIssue],
            expandedIssueId: 'ISSUE-1',
          });
        });

        await act(async () => {
          await result.current.disconnectSentry();
        });

        expect(result.current.organizations).toEqual([]);
        expect(result.current.selectedOrganizationSlug).toBeNull();
        expect(result.current.projects).toEqual([]);
        expect(result.current.selectedProjectSlug).toBeNull();
        expect(result.current.issues).toEqual([]);
        expect(result.current.expandedIssueId).toBeNull();
      });

      it('handles disconnect errors', async () => {
        const { result } = renderHook(() => useSentryStore());
        vi.mocked(sentryApi.disableSentry).mockRejectedValue(new Error('Disconnect failed'));

        await act(async () => {
          await result.current.disconnectSentry();
        });

        expect(result.current.error).toBe('Disconnect failed');
      });
    });

    describe('resetSetup', () => {
      it('resets all setup wizard fields', () => {
        const { result } = renderHook(() => useSentryStore());

        act(() => {
          useSentryStore.setState({
            setupToken: 'token',
            setupShowToken: true,
            setupRegion: 'de.sentry.io',
            setupCustomHost: 'custom.com',
            setupOpenAIKey: 'sk-key',
            setupValidationStatus: 'valid',
            setupValidationError: 'error',
            setupIsEnabling: true,
            setupShowInstructions: true,
          });
          result.current.resetSetup();
        });

        expect(result.current.setupToken).toBe('');
        expect(result.current.setupShowToken).toBe(false);
        expect(result.current.setupRegion).toBe('');
        expect(result.current.setupCustomHost).toBe('');
        expect(result.current.setupOpenAIKey).toBe('');
        expect(result.current.setupValidationStatus).toBe('idle');
        expect(result.current.setupValidationError).toBeNull();
        expect(result.current.setupIsEnabling).toBe(false);
        expect(result.current.setupShowInstructions).toBe(false);
      });
    });
  });

  // ========================================================================
  // Data Actions
  // ========================================================================

  describe('Data Management', () => {
    describe('loadOrganizations', () => {
      it('loads organizations successfully', async () => {
        const { result } = renderHook(() => useSentryStore());
        vi.mocked(sentryApi.getSentryOrganizations).mockResolvedValue([
          mockSentryOrganization,
          mockSentryOrganization2,
        ]);

        await act(async () => {
          await result.current.loadOrganizations();
        });

        expect(result.current.organizations).toHaveLength(2);
        expect(result.current.organizations[0]).toEqual(mockSentryOrganization);
      });

      it('sets loading flag during load', async () => {
        const { result } = renderHook(() => useSentryStore());
        vi.mocked(sentryApi.getSentryOrganizations).mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve([]), 100))
        );

        act(() => {
          result.current.loadOrganizations();
        });

        expect(result.current.isLoadingOrganizations).toBe(true);
      });

      it('selects first organization if none selected', async () => {
        const { result } = renderHook(() => useSentryStore());
        vi.mocked(sentryApi.getSentryOrganizations).mockResolvedValue([mockSentryOrganization]);
        vi.mocked(sentryApi.getSentryProjects).mockResolvedValue([]);

        await act(async () => {
          await result.current.loadOrganizations();
        });

        expect(result.current.selectedOrganizationSlug).toBe('test-org');
      });

      it('loads projects for selected organization', async () => {
        const { result } = renderHook(() => useSentryStore());
        vi.mocked(sentryApi.getSentryOrganizations).mockResolvedValue([mockSentryOrganization]);
        vi.mocked(sentryApi.getSentryProjects).mockResolvedValue([mockSentryProject]);

        await act(async () => {
          await result.current.loadOrganizations();
        });

        expect(sentryApi.getSentryProjects).toHaveBeenCalledWith(
          'test-org',
          'https://us.sentry.io'
        );
      });

      it('preserves persisted organization selection', async () => {
        const { result } = renderHook(() => useSentryStore());
        vi.mocked(sentryApi.getSentryOrganizations).mockResolvedValue([
          mockSentryOrganization,
          mockSentryOrganization2,
        ]);
        vi.mocked(sentryApi.getSentryProjects).mockResolvedValue([]);

        act(() => {
          useSentryStore.setState({ selectedOrganizationSlug: 'second-org' });
        });

        await act(async () => {
          await result.current.loadOrganizations();
        });

        expect(result.current.selectedOrganizationSlug).toBe('second-org');
      });

      it('falls back to first org if persisted selection not found', async () => {
        const { result } = renderHook(() => useSentryStore());
        vi.mocked(sentryApi.getSentryOrganizations).mockResolvedValue([mockSentryOrganization]);
        vi.mocked(sentryApi.getSentryProjects).mockResolvedValue([]);

        act(() => {
          useSentryStore.setState({ selectedOrganizationSlug: 'non-existent' });
        });

        await act(async () => {
          await result.current.loadOrganizations();
        });

        expect(result.current.selectedOrganizationSlug).toBe('test-org');
      });

      it('handles load errors', async () => {
        const { result } = renderHook(() => useSentryStore());
        vi.mocked(sentryApi.getSentryOrganizations).mockRejectedValue(new Error('API error'));

        await act(async () => {
          await result.current.loadOrganizations();
        });

        expect(result.current.error).toBe('API error');
        expect(result.current.isLoadingOrganizations).toBe(false);
      });

      it('refreshes server if tools not found', async () => {
        const { result } = renderHook(() => useSentryStore());
        vi.mocked(sentryApi.getSentryOrganizations)
          .mockRejectedValueOnce(new Error('Tool not found'))
          .mockResolvedValueOnce([mockSentryOrganization]);
        vi.mocked(sentryApi.refreshSentryServer).mockResolvedValue();
        vi.mocked(sentryApi.getSentryProjects).mockResolvedValue([]);

        await act(async () => {
          await result.current.loadOrganizations();
        });

        expect(sentryApi.refreshSentryServer).toHaveBeenCalled();
        expect(sentryApi.getSentryOrganizations).toHaveBeenCalledTimes(2);
      });

      it('does not retry refresh if it fails', async () => {
        const { result } = renderHook(() => useSentryStore());
        vi.mocked(sentryApi.getSentryOrganizations).mockRejectedValue(new Error('Tool not found'));
        vi.mocked(sentryApi.refreshSentryServer).mockRejectedValue(new Error('Refresh failed'));

        await act(async () => {
          await result.current.loadOrganizations();
        });

        expect(result.current.error).toBe('Tool not found');
      });
    });

    describe('loadProjects', () => {
      it('loads projects for selected organization', async () => {
        const { result } = renderHook(() => useSentryStore());
        vi.mocked(sentryApi.getSentryProjects).mockResolvedValue([
          mockSentryProject,
          mockSentryProject2,
        ]);

        act(() => {
          useSentryStore.setState({
            selectedOrganizationSlug: 'test-org',
            organizations: [mockSentryOrganization],
          });
        });

        await act(async () => {
          await result.current.loadProjects();
        });

        expect(result.current.projects).toHaveLength(2);
      });

      it('does nothing if no organization selected', async () => {
        const { result } = renderHook(() => useSentryStore());

        await act(async () => {
          await result.current.loadProjects();
        });

        expect(sentryApi.getSentryProjects).not.toHaveBeenCalled();
        expect(result.current.projects).toEqual([]);
      });

      it('sets loading flag during load', async () => {
        const { result } = renderHook(() => useSentryStore());
        vi.mocked(sentryApi.getSentryProjects).mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve([]), 100))
        );

        act(() => {
          useSentryStore.setState({ selectedOrganizationSlug: 'test-org' });
          result.current.loadProjects();
        });

        expect(result.current.isLoadingProjects).toBe(true);
      });

      it('selects first project if none selected', async () => {
        const { result } = renderHook(() => useSentryStore());
        vi.mocked(sentryApi.getSentryProjects).mockResolvedValue([mockSentryProject]);
        vi.mocked(sentryApi.getSentryIssues).mockResolvedValue([]);

        act(() => {
          useSentryStore.setState({
            selectedOrganizationSlug: 'test-org',
            organizations: [mockSentryOrganization],
          });
        });

        await act(async () => {
          await result.current.loadProjects();
        });

        expect(result.current.selectedProjectSlug).toBe('my-app');
      });

      it('loads issues for selected project', async () => {
        const { result } = renderHook(() => useSentryStore());
        vi.mocked(sentryApi.getSentryProjects).mockResolvedValue([mockSentryProject]);
        vi.mocked(sentryApi.getSentryIssues).mockResolvedValue([]);

        act(() => {
          useSentryStore.setState({
            selectedOrganizationSlug: 'test-org',
            organizations: [mockSentryOrganization],
          });
        });

        await act(async () => {
          await result.current.loadProjects();
        });

        expect(sentryApi.getSentryIssues).toHaveBeenCalled();
      });

      it('preserves persisted project selection', async () => {
        const { result } = renderHook(() => useSentryStore());
        vi.mocked(sentryApi.getSentryProjects).mockResolvedValue([
          mockSentryProject,
          mockSentryProject2,
        ]);
        vi.mocked(sentryApi.getSentryIssues).mockResolvedValue([]);

        act(() => {
          useSentryStore.setState({
            selectedOrganizationSlug: 'test-org',
            selectedProjectSlug: 'api',
            organizations: [mockSentryOrganization],
          });
        });

        await act(async () => {
          await result.current.loadProjects();
        });

        expect(result.current.selectedProjectSlug).toBe('api');
      });

      it('passes regionUrl to API', async () => {
        const { result } = renderHook(() => useSentryStore());
        vi.mocked(sentryApi.getSentryProjects).mockResolvedValue([]);

        act(() => {
          useSentryStore.setState({
            selectedOrganizationSlug: 'test-org',
            organizations: [mockSentryOrganization],
          });
        });

        await act(async () => {
          await result.current.loadProjects();
        });

        expect(sentryApi.getSentryProjects).toHaveBeenCalledWith(
          'test-org',
          'https://us.sentry.io'
        );
      });

      it('handles load errors', async () => {
        const { result } = renderHook(() => useSentryStore());
        vi.mocked(sentryApi.getSentryProjects).mockRejectedValue(new Error('API error'));

        act(() => {
          useSentryStore.setState({ selectedOrganizationSlug: 'test-org' });
        });

        await act(async () => {
          await result.current.loadProjects();
        });

        expect(result.current.error).toBe('API error');
        expect(result.current.isLoadingProjects).toBe(false);
      });
    });

    describe('loadIssues', () => {
      it('loads issues for organization', async () => {
        const { result } = renderHook(() => useSentryStore());
        vi.mocked(sentryApi.getSentryIssues).mockResolvedValue([
          mockSentryIssue,
          mockSentryIssueFatal,
        ]);

        act(() => {
          useSentryStore.setState({
            selectedOrganizationSlug: 'test-org',
            organizations: [mockSentryOrganization],
          });
        });

        await act(async () => {
          await result.current.loadIssues();
        });

        expect(result.current.issues).toHaveLength(2);
      });

      it('does nothing if no organization selected', async () => {
        const { result } = renderHook(() => useSentryStore());

        await act(async () => {
          await result.current.loadIssues();
        });

        expect(sentryApi.getSentryIssues).not.toHaveBeenCalled();
        expect(result.current.issues).toEqual([]);
      });

      it('filters by selected project', async () => {
        const { result } = renderHook(() => useSentryStore());
        vi.mocked(sentryApi.getSentryIssues).mockResolvedValue([]);

        act(() => {
          useSentryStore.setState({
            selectedOrganizationSlug: 'test-org',
            selectedProjectSlug: 'my-app',
            organizations: [mockSentryOrganization],
          });
        });

        await act(async () => {
          await result.current.loadIssues();
        });

        expect(sentryApi.getSentryIssues).toHaveBeenCalledWith('test-org', {
          projectSlug: 'my-app',
          status: 'unresolved',
          limit: 50,
          regionUrl: 'https://us.sentry.io',
        });
      });

      it('filters by status filter', async () => {
        const { result } = renderHook(() => useSentryStore());
        vi.mocked(sentryApi.getSentryIssues).mockResolvedValue([]);

        act(() => {
          useSentryStore.setState({
            selectedOrganizationSlug: 'test-org',
            statusFilter: 'resolved',
            organizations: [mockSentryOrganization],
          });
        });

        await act(async () => {
          await result.current.loadIssues();
        });

        expect(sentryApi.getSentryIssues).toHaveBeenCalledWith('test-org', {
          projectSlug: undefined,
          status: 'resolved',
          limit: 50,
          regionUrl: 'https://us.sentry.io',
        });
      });

      it('does not filter when status is all', async () => {
        const { result } = renderHook(() => useSentryStore());
        vi.mocked(sentryApi.getSentryIssues).mockResolvedValue([]);

        act(() => {
          useSentryStore.setState({
            selectedOrganizationSlug: 'test-org',
            statusFilter: 'all',
            organizations: [mockSentryOrganization],
          });
        });

        await act(async () => {
          await result.current.loadIssues();
        });

        expect(sentryApi.getSentryIssues).toHaveBeenCalledWith('test-org', {
          projectSlug: undefined,
          status: undefined,
          limit: 50,
          regionUrl: 'https://us.sentry.io',
        });
      });

      it('sets loading flag during load', async () => {
        const { result } = renderHook(() => useSentryStore());
        vi.mocked(sentryApi.getSentryIssues).mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve([]), 100))
        );

        act(() => {
          useSentryStore.setState({ selectedOrganizationSlug: 'test-org' });
          result.current.loadIssues();
        });

        expect(result.current.isLoadingIssues).toBe(true);
      });

      it('handles load errors', async () => {
        const { result } = renderHook(() => useSentryStore());
        vi.mocked(sentryApi.getSentryIssues).mockRejectedValue(new Error('API error'));

        act(() => {
          useSentryStore.setState({ selectedOrganizationSlug: 'test-org' });
        });

        await act(async () => {
          await result.current.loadIssues();
        });

        expect(result.current.error).toBe('API error');
        expect(result.current.isLoadingIssues).toBe(false);
      });
    });

    describe('refresh', () => {
      it('checks configuration if not configured', async () => {
        const { result } = renderHook(() => useSentryStore());
        vi.mocked(sentryApi.checkSentryConfigured).mockResolvedValue({
          isConfigured: false,
          server: null,
        });

        await act(async () => {
          await result.current.refresh();
        });

        expect(sentryApi.checkSentryConfigured).toHaveBeenCalled();
      });

      it('loads issues if configured', async () => {
        const { result } = renderHook(() => useSentryStore());
        vi.mocked(sentryApi.getSentryIssues).mockResolvedValue([]);

        act(() => {
          useSentryStore.setState({
            isConfigured: true,
            selectedOrganizationSlug: 'test-org',
            organizations: [mockSentryOrganization],
          });
        });

        await act(async () => {
          await result.current.refresh();
        });

        expect(sentryApi.getSentryIssues).toHaveBeenCalled();
      });
    });

    describe('refreshServer', () => {
      it('refreshes server and reloads organizations', async () => {
        const { result } = renderHook(() => useSentryStore());
        vi.mocked(sentryApi.refreshSentryServer).mockResolvedValue();
        // refreshServer calls checkConfiguration which needs this to return configured
        vi.mocked(sentryApi.checkSentryConfigured).mockResolvedValue({
          isConfigured: true,
          server: mockMCPServer,
        });
        vi.mocked(sentryApi.getSentryOrganizations).mockResolvedValue([mockSentryOrganization]);
        vi.mocked(sentryApi.getSentryProjects).mockResolvedValue([]);

        await act(async () => {
          await result.current.refreshServer();
        });

        expect(sentryApi.refreshSentryServer).toHaveBeenCalled();
        expect(sentryApi.getSentryOrganizations).toHaveBeenCalled();
      });

      it('handles refresh errors', async () => {
        const { result } = renderHook(() => useSentryStore());
        vi.mocked(sentryApi.refreshSentryServer).mockRejectedValue(new Error('Refresh failed'));

        await act(async () => {
          await result.current.refreshServer();
        });

        expect(result.current.error).toBe('Refresh failed');
      });
    });

    describe('selectOrganization', () => {
      it('selects organization', () => {
        const { result } = renderHook(() => useSentryStore());
        vi.mocked(sentryApi.getSentryProjects).mockResolvedValue([]);

        act(() => {
          result.current.selectOrganization('test-org');
        });

        expect(result.current.selectedOrganizationSlug).toBe('test-org');
      });

      it('clears projects and issues when changing organization', () => {
        const { result } = renderHook(() => useSentryStore());
        vi.mocked(sentryApi.getSentryProjects).mockResolvedValue([]);

        act(() => {
          useSentryStore.setState({
            projects: [mockSentryProject],
            selectedProjectSlug: 'my-app',
            issues: [mockSentryIssue],
            expandedIssueId: 'ISSUE-1',
          });
          result.current.selectOrganization('another-org');
        });

        expect(result.current.projects).toEqual([]);
        expect(result.current.selectedProjectSlug).toBeNull();
        expect(result.current.issues).toEqual([]);
        expect(result.current.expandedIssueId).toBeNull();
      });

      it('loads projects for selected organization', async () => {
        const { result } = renderHook(() => useSentryStore());
        vi.mocked(sentryApi.getSentryProjects).mockResolvedValue([mockSentryProject]);

        await act(async () => {
          result.current.selectOrganization('test-org');
        });

        // Wait for async operation
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(sentryApi.getSentryProjects).toHaveBeenCalled();
      });

      it('handles null organization', () => {
        const { result } = renderHook(() => useSentryStore());

        act(() => {
          result.current.selectOrganization(null);
        });

        expect(result.current.selectedOrganizationSlug).toBeNull();
        expect(sentryApi.getSentryProjects).not.toHaveBeenCalled();
      });
    });

    describe('selectProject', () => {
      it('selects project', () => {
        const { result } = renderHook(() => useSentryStore());
        vi.mocked(sentryApi.getSentryIssues).mockResolvedValue([]);

        act(() => {
          useSentryStore.setState({
            selectedOrganizationSlug: 'test-org',
            organizations: [mockSentryOrganization],
          });
          result.current.selectProject('my-app');
        });

        expect(result.current.selectedProjectSlug).toBe('my-app');
      });

      it('clears issues when changing project', () => {
        const { result } = renderHook(() => useSentryStore());
        vi.mocked(sentryApi.getSentryIssues).mockResolvedValue([]);

        act(() => {
          useSentryStore.setState({
            selectedOrganizationSlug: 'test-org',
            issues: [mockSentryIssue],
            expandedIssueId: 'ISSUE-1',
            organizations: [mockSentryOrganization],
          });
          result.current.selectProject('another-project');
        });

        expect(result.current.issues).toEqual([]);
        expect(result.current.expandedIssueId).toBeNull();
      });

      it('loads issues for selected project', async () => {
        const { result } = renderHook(() => useSentryStore());
        vi.mocked(sentryApi.getSentryIssues).mockResolvedValue([mockSentryIssue]);

        await act(async () => {
          useSentryStore.setState({
            selectedOrganizationSlug: 'test-org',
            organizations: [mockSentryOrganization],
          });
          result.current.selectProject('my-app');
        });

        // Wait for async operation
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(sentryApi.getSentryIssues).toHaveBeenCalled();
      });
    });

    describe('setStatusFilter', () => {
      it('sets status filter', () => {
        const { result } = renderHook(() => useSentryStore());
        vi.mocked(sentryApi.getSentryIssues).mockResolvedValue([]);

        act(() => {
          useSentryStore.setState({
            selectedOrganizationSlug: 'test-org',
            organizations: [mockSentryOrganization],
          });
          result.current.setStatusFilter('resolved');
        });

        expect(result.current.statusFilter).toBe('resolved');
      });

      it('reloads issues when filter changes', async () => {
        const { result } = renderHook(() => useSentryStore());
        vi.mocked(sentryApi.getSentryIssues).mockResolvedValue([]);

        await act(async () => {
          useSentryStore.setState({
            selectedOrganizationSlug: 'test-org',
            organizations: [mockSentryOrganization],
          });
          result.current.setStatusFilter('ignored');
        });

        // Wait for async operation
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(sentryApi.getSentryIssues).toHaveBeenCalled();
      });
    });

    describe('toggleIssueExpanded', () => {
      it('expands issue', () => {
        const { result } = renderHook(() => useSentryStore());

        act(() => {
          result.current.toggleIssueExpanded('ISSUE-1');
        });

        expect(result.current.expandedIssueId).toBe('ISSUE-1');
      });

      it('collapses expanded issue', () => {
        const { result } = renderHook(() => useSentryStore());

        act(() => {
          useSentryStore.setState({ expandedIssueId: 'ISSUE-1' });
          result.current.toggleIssueExpanded('ISSUE-1');
        });

        expect(result.current.expandedIssueId).toBeNull();
      });

      it('switches to different expanded issue', () => {
        const { result } = renderHook(() => useSentryStore());

        act(() => {
          useSentryStore.setState({ expandedIssueId: 'ISSUE-1' });
          result.current.toggleIssueExpanded('ISSUE-2');
        });

        expect(result.current.expandedIssueId).toBe('ISSUE-2');
      });
    });
  });

  // ========================================================================
  // Utilities
  // ========================================================================

  describe('Utilities', () => {
    describe('setError', () => {
      it('sets error message', () => {
        const { result } = renderHook(() => useSentryStore());

        act(() => {
          result.current.setError('Test error');
        });

        expect(result.current.error).toBe('Test error');
      });

      it('clears error when set to null', () => {
        const { result } = renderHook(() => useSentryStore());

        act(() => {
          useSentryStore.setState({ error: 'Previous error' });
          result.current.setError(null);
        });

        expect(result.current.error).toBeNull();
      });
    });

    describe('reset', () => {
      it('resets all state to initial values', () => {
        const { result } = renderHook(() => useSentryStore());

        act(() => {
          useSentryStore.setState({
            isConfigured: true,
            serverId: 'server-123',
            setupToken: 'token',
            organizations: [mockSentryOrganization],
            selectedOrganizationSlug: 'test-org',
            projects: [mockSentryProject],
            selectedProjectSlug: 'my-app',
            issues: [mockSentryIssue],
            expandedIssueId: 'ISSUE-1',
            statusFilter: 'resolved',
            error: 'Some error',
          });
          result.current.reset();
        });

        expect(result.current.isConfigured).toBe(false);
        expect(result.current.serverId).toBeNull();
        expect(result.current.setupToken).toBe('');
        expect(result.current.organizations).toEqual([]);
        expect(result.current.selectedOrganizationSlug).toBeNull();
        expect(result.current.projects).toEqual([]);
        expect(result.current.selectedProjectSlug).toBeNull();
        expect(result.current.issues).toEqual([]);
        expect(result.current.expandedIssueId).toBeNull();
        expect(result.current.statusFilter).toBe('unresolved');
        expect(result.current.error).toBeNull();
      });
    });
  });

  // ========================================================================
  // Selectors
  // ========================================================================

  describe('Selectors', () => {
    it('selectUnresolvedCount returns count of unresolved issues', () => {
      const { result } = renderHook(() => useSentryStore());

      act(() => {
        useSentryStore.setState({
          isConfigured: true, // Must be configured for selector to count issues
          issues: [mockSentryIssue, mockSentryIssueFatal, mockSentryIssueWarning],
        });
      });

      const count = selectUnresolvedCount(result.current);
      expect(count).toBe(2); // mockSentryIssue and mockSentryIssueFatal
    });

    it('selectFilteredIssues returns all issues when filter is all', () => {
      const { result } = renderHook(() => useSentryStore());

      act(() => {
        useSentryStore.setState({
          issues: [mockSentryIssue, mockSentryIssueWarning, mockSentryIssueInfo],
          statusFilter: 'all',
        });
      });

      const filtered = selectFilteredIssues(result.current);
      expect(filtered).toHaveLength(3);
    });

    it('selectFilteredIssues returns filtered issues by status', () => {
      const { result } = renderHook(() => useSentryStore());

      act(() => {
        useSentryStore.setState({
          issues: [mockSentryIssue, mockSentryIssueWarning, mockSentryIssueInfo],
          statusFilter: 'resolved',
        });
      });

      const filtered = selectFilteredIssues(result.current);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].status).toBe('resolved');
    });

    it('selectIsLoading returns true when any loading flag is set', () => {
      const { result } = renderHook(() => useSentryStore());

      act(() => {
        useSentryStore.setState({ isLoadingOrganizations: true });
      });

      expect(selectIsLoading(result.current)).toBe(true);
    });

    it('selectIsLoading returns false when no loading flags are set', () => {
      const { result } = renderHook(() => useSentryStore());

      expect(selectIsLoading(result.current)).toBe(false);
    });
  });
});
