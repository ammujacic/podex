'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  GitBranch,
  Github,
  Loader2,
  Sparkles,
  Server,
  Check,
  Zap,
  Box,
  Code2,
  Cloud,
  Laptop,
  Cpu,
  MemoryStick,
  RefreshCw,
  Plus,
  Copy,
  X,
  Terminal,
  Trash2,
} from 'lucide-react';
import { Button, Input } from '@podex/ui';
import Image from 'next/image';
import {
  listTemplates,
  createSession,
  getUserConfig,
  listHardwareSpecs,
  listLocalPods,
  deleteLocalPod,
  getLocalPodPricing,
  getGitHubLinkURL,
  getGitHubBranches,
  getRegionCapacity,
  type PodTemplate,
  type UserConfig,
  type HardwareSpecResponse,
  type LocalPod,
  type LocalPodPricing,
  type RegionCapacityResponse,
} from '@/lib/api';
import { useUser } from '@/stores/auth';
import { useLocalPodsStore } from '@/stores/localPods';
import { toast } from 'sonner';
import { HardwareSelector } from '@/components/billing/HardwareSelector';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { cn } from '@/lib/utils';
import { getGitHubStatus, getGitHubRepos } from '@/lib/api';
import { DirectoryBrowser } from '@/components/workspace/DirectoryBrowser';

// Template icon configuration with CDN URLs (Simple Icons)
const templateIconConfig: Record<string, { url: string }> = {
  nodejs: { url: 'https://cdn.simpleicons.org/nodedotjs/339933' },
  python: { url: 'https://cdn.simpleicons.org/python/3776AB' },
  go: { url: 'https://cdn.simpleicons.org/go/00ADD8' },
  rust: { url: 'https://cdn.simpleicons.org/rust/DEA584' },
  typescript: { url: 'https://cdn.simpleicons.org/typescript/3178C6' },
  react: { url: 'https://cdn.simpleicons.org/react/61DAFB' },
  layers: { url: 'https://cdn.simpleicons.org/stackblitz/1389FD' }, // Full Stack
};

// OS icon configuration
const osIconConfig: Record<string, { url: string; label: string }> = {
  macos: { url: 'https://cdn.simpleicons.org/apple/FFFFFF', label: 'macOS' },
  darwin: { url: 'https://cdn.simpleicons.org/apple/FFFFFF', label: 'macOS' },
  linux: { url: 'https://cdn.simpleicons.org/linux/FCC624', label: 'Linux' },
  ubuntu: { url: 'https://cdn.simpleicons.org/ubuntu/E95420', label: 'Ubuntu' },
  debian: { url: 'https://cdn.simpleicons.org/debian/A81D33', label: 'Debian' },
  fedora: { url: 'https://cdn.simpleicons.org/fedora/51A2DA', label: 'Fedora' },
  windows: { url: 'https://cdn.simpleicons.org/windows/0078D4', label: 'Windows' },
};

// Helper to parse OS info and get icon
function getOsInfo(osInfo: string | null): { icon: string; label: string; arch: string | null } {
  if (!osInfo) return { icon: '', label: 'Unknown', arch: null };

  const lower = osInfo.toLowerCase();

  // Try to detect specific distros first
  for (const [key, config] of Object.entries(osIconConfig)) {
    if (lower.includes(key)) {
      // Extract architecture if present
      let arch: string | null = null;
      if (lower.includes('arm64') || lower.includes('aarch64')) arch = 'ARM64';
      else if (lower.includes('x86_64') || lower.includes('amd64')) arch = 'x64';

      return { icon: config.url, label: config.label, arch };
    }
  }

  return { icon: '', label: osInfo.split(' ')[0] || 'Unknown', arch: null };
}

function TemplateIcon({
  icon,
  iconUrl,
  size = 'md',
}: {
  icon: string | null;
  iconUrl?: string | null;
  size?: 'sm' | 'md' | 'lg';
}) {
  const sizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-6 h-6',
    lg: 'w-8 h-8',
  };
  const sizePixels = { sm: 16, md: 24, lg: 32 };

  // Use iconUrl from API if available, otherwise fall back to local mapping
  const url = iconUrl || (icon ? templateIconConfig[icon]?.url : null);

  if (url) {
    return (
      <Image
        src={url}
        alt={icon || 'template'}
        width={sizePixels[size]}
        height={sizePixels[size]}
        className={sizeClasses[size]}
        unoptimized
      />
    );
  }

  return <Box className={`${sizeClasses[size]} text-text-muted`} />;
}

// ============================================================================
// ADD LOCAL POD MODAL - Simple name + token flow
// ============================================================================

interface AddLocalPodModalProps {
  onClose: () => void;
  onPodCreated: () => void;
}

function AddLocalPodModal({ onClose, onPodCreated }: AddLocalPodModalProps) {
  const [name, setName] = useState('');
  const [showComplete, setShowComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { createPod, isCreating, newToken, clearNewToken } = useLocalPodsStore();
  const [copiedToken, setCopiedToken] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError('Name is required');
      return;
    }

    try {
      await createPod({ name: name.trim() });
      setShowComplete(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create pod');
    }
  };

  const handleDone = () => {
    clearNewToken();
    onPodCreated();
    onClose();
  };

  const handleClose = () => {
    if (newToken) {
      clearNewToken();
    }
    onClose();
  };

  const handleCopyToken = async () => {
    if (!newToken) return;
    const fullCommand = `podex-local-pod start --token ${newToken.token}`;
    await navigator.clipboard.writeText(fullCommand);
    setCopiedToken(true);
    toast.success('Command copied to clipboard');
    setTimeout(() => setCopiedToken(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-void/80">
      <div className="w-full max-w-xl mx-4 rounded-lg border border-border-default bg-surface shadow-xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle sticky top-0 bg-surface z-10">
          <div className="flex items-center gap-2">
            <Laptop className="h-5 w-5 text-accent-primary" />
            <h3 className="text-lg font-semibold text-text-primary">
              {showComplete ? 'Setup Complete' : 'Add Local Pod'}
            </h3>
          </div>
          <button
            onClick={handleClose}
            className="p-1 rounded hover:bg-overlay text-text-muted hover:text-text-primary"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4">
          {/* Name Input Form */}
          {!showComplete && (
            <div className="space-y-5">
              {/* Info banner */}
              <div className="p-3 rounded-lg bg-accent-primary/5 border border-accent-primary/20">
                <p className="text-sm text-text-secondary">
                  A local pod lets you run workspaces on your own hardware.{' '}
                  <span className="text-accent-primary font-medium">
                    Free, private, and fully under your control.
                  </span>
                </p>
              </div>

              {error && (
                <div className="p-3 rounded bg-error/10 border border-error/30 text-error text-sm flex items-center gap-2">
                  <AlertCircle className="h-4 w-4" />
                  {error}
                </div>
              )}

              {/* Pod Name */}
              <div>
                <label className="text-sm font-medium text-text-secondary">Pod Name *</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., My MacBook Pro"
                  className="w-full mt-1 px-3 py-2 text-sm rounded bg-void border border-border-default text-text-primary placeholder:text-text-muted focus:border-accent-primary focus:ring-1 focus:ring-accent-primary"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && name.trim()) {
                      handleSubmit();
                    }
                  }}
                />
                <p className="text-xs text-text-muted mt-1">
                  A friendly name to identify this machine
                </p>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={handleClose}
                  className="px-4 py-2 text-sm font-medium rounded bg-overlay text-text-secondary hover:text-text-primary"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={!name.trim() || isCreating}
                  className="px-4 py-2 text-sm font-medium rounded bg-accent-primary text-void hover:bg-accent-primary/90 disabled:opacity-50 flex items-center gap-2"
                >
                  {isCreating && <Loader2 className="h-4 w-4 animate-spin" />}
                  {isCreating ? 'Creating...' : 'Create Pod'}
                </button>
              </div>
            </div>
          )}

          {/* Complete - Show token and setup commands */}
          {showComplete && newToken && (
            <div className="space-y-5">
              {/* Success header */}
              <div className="flex items-center gap-3 p-4 rounded-xl bg-gradient-to-r from-success/20 to-success/5 border border-success/30">
                <div className="p-2 rounded-full bg-success/20">
                  <Check className="h-5 w-5 text-success" />
                </div>
                <div>
                  <p className="text-base font-semibold text-text-primary">
                    Pod &quot;{name}&quot; created!
                  </p>
                  <p className="text-sm text-text-muted">
                    Follow these steps to connect your machine.
                  </p>
                </div>
              </div>

              {/* Setup Steps */}
              <div className="space-y-4">
                {/* Step 1: Install */}
                <div className="flex gap-3">
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-accent-primary/20 text-accent-primary text-xs font-bold flex items-center justify-center">
                    1
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-text-primary mb-1">Install the agent</p>
                    <code className="block text-xs text-text-secondary font-mono px-3 py-2 bg-void rounded-lg border border-border-subtle">
                      pip install podex-local-pod
                    </code>
                  </div>
                </div>

                {/* Step 2: Start with token */}
                <div className="flex gap-3">
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-accent-primary/20 text-accent-primary text-xs font-bold flex items-center justify-center">
                    2
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-sm font-medium text-text-primary">
                        Start the agent with your token
                      </p>
                      <button
                        onClick={handleCopyToken}
                        className={cn(
                          'flex items-center gap-1 px-2 py-1 text-xs font-medium rounded transition-all',
                          copiedToken
                            ? 'bg-success/20 text-success'
                            : 'bg-overlay hover:bg-accent-primary/20 text-text-muted hover:text-accent-primary'
                        )}
                      >
                        {copiedToken ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                        {copiedToken ? 'Copied!' : 'Copy'}
                      </button>
                    </div>
                    <code className="block text-xs text-accent-primary font-mono px-3 py-2 bg-void rounded-lg border border-accent-primary/30 overflow-x-auto whitespace-pre-wrap break-all">
                      podex-local-pod start --token {newToken.token}
                    </code>
                    <p className="text-xs text-text-muted mt-1">
                      Your pod will appear as{' '}
                      <span className="text-success font-medium">&quot;Online&quot;</span> once
                      connected!
                    </p>
                  </div>
                </div>
              </div>

              {/* Done button */}
              <div className="flex justify-end pt-2">
                <button
                  onClick={handleDone}
                  className="px-5 py-2.5 text-sm font-medium rounded-lg bg-accent-primary text-void hover:bg-accent-primary/90 transition-colors"
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Step type - compute is now first, template is conditional
type Step = 'compute' | 'template' | 'hardware' | 'workspace' | 'creating';

// Available Python versions
const pythonVersions = [
  { value: '3.13', label: 'Python 3.13 (Latest)' },
  { value: '3.12', label: 'Python 3.12' },
  { value: '3.11', label: 'Python 3.11' },
  { value: '3.10', label: 'Python 3.10' },
  { value: 'none', label: 'No Python' },
];

// Available Node versions
const nodeVersions = [
  { value: '22', label: 'Node.js 22 (Latest)' },
  { value: '20', label: 'Node.js 20 LTS' },
  { value: '18', label: 'Node.js 18 LTS' },
  { value: 'none', label: 'No Node.js' },
];

// Available OS versions
const osVersions = [
  { value: 'ubuntu-22.04', label: 'Ubuntu 22.04 LTS' },
  { value: 'ubuntu-24.04', label: 'Ubuntu 24.04 LTS' },
  { value: 'debian-12', label: 'Debian 12' },
  { value: 'rocky-linux-9', label: 'Rocky Linux 9' },
];

// Compute target type
type ComputeTarget = 'cloud' | string; // 'cloud' or local_pod_id

interface GitHubConnectionStatus {
  connected: boolean;
  username?: string | null;
  avatar_url?: string | null;
  scopes?: string[] | null;
}

interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  html_url: string;
  default_branch: string;
}

interface GitHubBranch {
  name: string;
}

export default function NewSessionPage() {
  useDocumentTitle('New Pod');
  const router = useRouter();
  const user = useUser();
  const [step, setStep] = useState<Step>('compute');
  const [templates, setTemplates] = useState<PodTemplate[]>([]);
  const [hardwareSpecs, setHardwareSpecs] = useState<HardwareSpecResponse[]>([]);
  const [localPods, setLocalPods] = useState<LocalPod[]>([]);
  const [localPodPricing, setLocalPodPricing] = useState<LocalPodPricing | null>(null);
  const [_userConfig, setUserConfig] = useState<UserConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [_creating, setCreating] = useState(false);
  const [creatingProgress, setCreatingProgress] = useState(0);
  const [creatingStatus, setCreatingStatus] = useState('Initializing...');
  const [creationError, setCreationError] = useState<string | null>(null);

  // Form state
  const [selectedTemplate, setSelectedTemplate] = useState<PodTemplate | null>(null);
  const [sessionName, setSessionName] = useState('');
  const [gitUrl, setGitUrl] = useState('');
  const [branch, setBranch] = useState('main');
  const [githubStatus, setGithubStatus] = useState<GitHubConnectionStatus | null>(null);
  const [githubRepos, setGithubRepos] = useState<GitHubRepo[]>([]);
  const [githubLoading, setGithubLoading] = useState(false);
  const [githubReposLoading, setGithubReposLoading] = useState(false);
  const [githubRepoError, setGithubRepoError] = useState<string | null>(null);
  const [githubBranches, setGithubBranches] = useState<GitHubBranch[]>([]);
  const [githubBranchesLoading, setGithubBranchesLoading] = useState(false);
  const [githubBranchesError, setGithubBranchesError] = useState<string | null>(null);
  const [githubConnecting, setGithubConnecting] = useState(false);
  const [useCustomBranch, setUseCustomBranch] = useState(false);

  // Pod configuration state
  const [selectedRegion, setSelectedRegion] = useState<string>('eu');
  const [regionCapacity, setRegionCapacity] = useState<RegionCapacityResponse | null>(null);
  const [selectedTier, setSelectedTier] = useState<string | null>(null);
  const [selectedPythonVersion, setSelectedPythonVersion] = useState<string>('3.12');
  const [selectedNodeVersion, setSelectedNodeVersion] = useState<string>('20');
  const [selectedOsVersion, setSelectedOsVersion] = useState<string>('ubuntu-22.04');
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Compute target (cloud or local pod)
  const [computeTarget, setComputeTarget] = useState<ComputeTarget>('cloud');
  const [showAddPodModal, setShowAddPodModal] = useState(false);
  const [selectedMountPath, setSelectedMountPath] = useState<string | null>(null);

  // Delete pod confirmation
  const [podToDelete, setPodToDelete] = useState<LocalPod | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (!user) {
      router.push('/auth/login');
      return;
    }

    async function loadData() {
      try {
        const [templatesData, configData, hardwareData, localPodsData, localPodPricingData] =
          await Promise.all([
            listTemplates(true),
            getUserConfig().catch(() => null),
            listHardwareSpecs().catch(() => []),
            listLocalPods().catch(() => []),
            getLocalPodPricing().catch(() => ({
              hourly_rate_cents: 0,
              description: 'Your local machine',
              billing_enabled: false,
            })),
          ]);
        setTemplates(templatesData);
        setUserConfig(configData);
        setHardwareSpecs(hardwareData);
        setLocalPods(localPodsData);
        setLocalPodPricing(localPodPricingData);

        // Pre-select default template if set
        if (configData?.default_template_id) {
          const defaultTemplate = templatesData.find(
            (t) => t.id === configData.default_template_id
          );
          if (defaultTemplate) {
            setSelectedTemplate(defaultTemplate);
          }
        }
      } catch {
        // Continue without templates
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [user, router]);

  // Fetch region capacity when region changes (only for cloud compute)
  useEffect(() => {
    if (computeTarget !== 'cloud') {
      setRegionCapacity(null);
      return;
    }

    // Reset selected tier when region changes since availability may differ
    setSelectedTier(null);

    async function fetchCapacity() {
      try {
        const capacity = await getRegionCapacity(selectedRegion);
        setRegionCapacity(capacity);
      } catch (err) {
        console.error('Failed to fetch region capacity:', err);
        setRegionCapacity(null);
      }
    }

    fetchCapacity();
  }, [selectedRegion, computeTarget]);

  const fetchGitHubRepos = useCallback(async () => {
    setGithubReposLoading(true);
    setGithubRepoError(null);
    try {
      const data = await getGitHubRepos({ per_page: 100 });
      setGithubRepos(data);
    } catch (err) {
      setGithubRepoError(err instanceof Error ? err.message : 'Failed to load GitHub repositories');
    } finally {
      setGithubReposLoading(false);
    }
  }, []);

  const parseGitHubRepoFromUrl = useCallback((url: string) => {
    try {
      if (url.startsWith('git@github.com:')) {
        const match = url.match(/^git@github\.com:(.+?)\/(.+?)(\.git)?$/);
        if (!match) return null;
        return { owner: match[1], repo: match[2] };
      }
      const parsed = new URL(url);
      if (parsed.hostname !== 'github.com') return null;
      const [owner, repo] = parsed.pathname.replace(/^\/+/, '').split('/');
      if (!owner || !repo) return null;
      return { owner, repo: repo.replace(/\.git$/, '') };
    } catch {
      return null;
    }
  }, []);

  const fetchGitHubBranches = useCallback(
    async (url: string) => {
      const repoInfo = parseGitHubRepoFromUrl(url);
      if (!repoInfo) {
        setGithubBranches([]);
        return;
      }

      setGithubBranchesLoading(true);
      setGithubBranchesError(null);
      try {
        const branches = await getGitHubBranches(repoInfo.owner!, repoInfo.repo!);
        setGithubBranches(branches);
      } catch (err) {
        setGithubBranches([]);
        setGithubBranchesError(err instanceof Error ? err.message : 'Failed to load branches');
      } finally {
        setGithubBranchesLoading(false);
      }
    },
    [parseGitHubRepoFromUrl]
  );

  const fetchGitHubStatus = useCallback(async () => {
    setGithubLoading(true);
    try {
      const data: GitHubConnectionStatus = await getGitHubStatus();
      setGithubStatus(data);
      if (data.connected) {
        await fetchGitHubRepos();
      } else {
        setGithubRepos([]);
      }
    } catch {
      setGithubStatus({ connected: false });
      setGithubRepos([]);
    } finally {
      setGithubLoading(false);
    }
  }, [fetchGitHubRepos]);

  useEffect(() => {
    if (step !== 'workspace') return;
    fetchGitHubStatus();
  }, [step, fetchGitHubStatus]);

  useEffect(() => {
    if (!githubStatus?.connected) {
      setGithubBranches([]);
      return;
    }
    if (gitUrl) {
      setUseCustomBranch(false);
      fetchGitHubBranches(gitUrl);
    } else {
      setGithubBranches([]);
    }
  }, [gitUrl, githubStatus?.connected, fetchGitHubBranches]);

  const handleConnectGitHub = async () => {
    if (typeof window === 'undefined') return;
    setGithubConnecting(true);
    setGithubRepoError(null);
    try {
      // Use the link URL to link GitHub to the current account
      const url = await getGitHubLinkURL();
      window.location.href = url;
    } catch (err) {
      setGithubConnecting(false);
      setGithubRepoError(err instanceof Error ? err.message : 'Failed to start GitHub connection');
    }
  };

  const handleSelectTemplate = (template: PodTemplate) => {
    setSelectedTemplate(template);
  };

  // Check if using a local pod (all local pods are native mode)
  const isNativeMode = () => {
    if (computeTarget === 'cloud') return false;
    // All local pods are native mode now
    return localPods.some((p) => p.id === computeTarget);
  };

  // Get total steps based on mode (native mode skips template)
  const getTotalSteps = () => (isNativeMode() ? 3 : 4);

  // Get current step number for display
  const getCurrentStepNumber = () => {
    if (step === 'compute') return 1;
    if (step === 'template') return 2;
    if (step === 'hardware') return isNativeMode() ? 2 : 3;
    if (step === 'workspace') return isNativeMode() ? 3 : 4;
    return 1;
  };

  const handleNext = () => {
    if (step === 'compute') {
      // Skip template for native mode, go straight to hardware
      if (isNativeMode()) {
        setSelectedTemplate(null); // Clear any previously selected template
        setStep('hardware');
      } else {
        setStep('template');
      }
    } else if (step === 'template') {
      setStep('hardware');
    } else if (step === 'hardware') {
      // Auto-generate session name if not set
      if (!sessionName && selectedTemplate) {
        setSessionName(`${selectedTemplate.name} Project`);
      } else if (!sessionName && isNativeMode()) {
        // For native mode, use mount path or generic name
        const mountName = selectedMountPath?.split('/').pop();
        setSessionName(mountName ? `${mountName} Workspace` : 'Native Workspace');
      }
      setStep('workspace');
    } else if (step === 'workspace') {
      handleCreate();
    }
  };

  const handleBack = () => {
    if (step === 'template') {
      setStep('compute');
    } else if (step === 'hardware') {
      // Go back to template or compute depending on mode
      if (isNativeMode()) {
        setStep('compute');
      } else {
        setStep('template');
      }
    } else if (step === 'workspace') {
      setStep('hardware');
    }
  };

  const handleCreate = async () => {
    setStep('creating');
    setCreating(true);
    setCreatingProgress(0);
    setCreatingStatus('Initializing pod...');
    setCreationError(null);

    // Simulate creation progress
    const progressSteps = [
      { progress: 15, status: 'Allocating resources...' },
      { progress: 30, status: 'Pulling container image...' },
      { progress: 50, status: 'Setting up environment...' },
      { progress: 70, status: 'Installing dependencies...' },
      { progress: 85, status: 'Syncing your configuration...' },
      { progress: 95, status: 'Almost ready...' },
    ];

    // Start progress animation
    let currentStep = 0;
    const progressInterval = setInterval(() => {
      const step = progressSteps[currentStep];
      if (step) {
        setCreatingProgress(step.progress);
        setCreatingStatus(step.status);
        currentStep++;
      }
    }, 800);

    try {
      const session = await createSession({
        name: sessionName || 'New Project',
        git_url: gitUrl || undefined,
        branch: branch || 'main',
        template_id: selectedTemplate?.id,
        // Pod configuration
        tier: selectedTier ?? undefined,
        python_version: selectedPythonVersion !== 'none' ? selectedPythonVersion : undefined,
        node_version: selectedNodeVersion !== 'none' ? selectedNodeVersion : undefined,
        os_version: selectedOsVersion,
        // Local pod (if selected)
        local_pod_id: computeTarget !== 'cloud' ? computeTarget : undefined,
        // Mount path for local pod workspace
        mount_path: computeTarget !== 'cloud' ? (selectedMountPath ?? undefined) : undefined,
        // Region preference for cloud workspaces
        region_preference: computeTarget === 'cloud' ? selectedRegion : undefined,
      });

      clearInterval(progressInterval);
      setCreatingProgress(100);
      setCreatingStatus('Pod is ready!');

      // Validate session response
      if (!session || !session.id) {
        throw new Error('Invalid session response: session ID is missing');
      }

      // Short delay to show completion
      setTimeout(() => {
        router.push(`/session/${session.id}`);
      }, 500);
    } catch (err) {
      clearInterval(progressInterval);
      setCreating(false);
      setStep('workspace');
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to create pod. Please try again.';
      setCreationError(errorMessage);
    }
  };

  const canProceed =
    step === 'compute'
      ? computeTarget !== '' // Must select a compute target
      : step === 'template'
        ? selectedTemplate !== null
        : step === 'hardware'
          ? selectedTier !== null || computeTarget !== 'cloud' // Local pods don't need tier selection
          : sessionName.trim() !== '';

  if (loading) {
    return (
      <div className="min-h-screen bg-void flex items-center justify-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex flex-col items-center gap-4"
        >
          <div className="relative">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-accent-primary to-accent-secondary flex items-center justify-center">
              <Zap className="w-8 h-8 text-white" />
            </div>
            <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-accent-primary to-accent-secondary blur-xl opacity-50" />
          </div>
          <p className="text-text-secondary">Loading templates...</p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-void">
      {/* Background effects */}
      <div className="fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute top-0 left-1/4 h-[500px] w-[500px] rounded-full bg-accent-primary/5 blur-3xl" />
        <div className="absolute bottom-0 right-1/4 h-[500px] w-[500px] rounded-full bg-accent-secondary/5 blur-3xl" />
      </div>

      {/* Header */}
      <header className="bg-void/80 backdrop-blur-lg border-b border-border-subtle sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <button
              onClick={() => router.push('/dashboard')}
              className="flex items-center gap-2 text-text-secondary hover:text-text-primary transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
              <span>Back</span>
            </button>
            <div className="flex items-center gap-2">
              <span className="text-sm text-text-muted">
                Step {getCurrentStepNumber()} of {getTotalSteps()}
              </span>
              <div className="flex items-center gap-1">
                {Array.from({ length: getTotalSteps() }).map((_, i) => (
                  <div
                    key={i}
                    className={`w-2 h-2 rounded-full transition-colors ${
                      getCurrentStepNumber() === i + 1
                        ? 'bg-accent-primary'
                        : getCurrentStepNumber() > i + 1
                          ? 'bg-accent-primary/50'
                          : 'bg-overlay'
                    }`}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-5xl mx-auto px-6 py-12 pb-32">
        <AnimatePresence mode="wait">
          {/* Step 1: Compute Target Selection */}
          {step === 'compute' && (
            <motion.div
              key="compute"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
            >
              <div className="text-center mb-10">
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                  className="inline-flex items-center gap-2 bg-accent-primary/10 text-accent-primary px-4 py-1.5 rounded-full text-sm mb-4"
                >
                  <Server className="w-4 h-4" />
                  Step {getCurrentStepNumber()} of {getTotalSteps()}
                </motion.div>
                <h1 className="text-3xl font-bold text-text-primary mb-2">Choose where to run</h1>
                <p className="text-text-secondary max-w-xl mx-auto">
                  Run on Podex Cloud for instant scaling, or use your own hardware with a Local Pod.
                </p>
              </div>

              {/* Compute Target Grid */}
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {/* Cloud option */}
                <motion.button
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.05 }}
                  onClick={() => {
                    setComputeTarget('cloud');
                    setSelectedMountPath(null);
                  }}
                  className={`relative p-5 rounded-xl border-2 text-left transition-all ${
                    computeTarget === 'cloud'
                      ? 'border-accent-primary bg-accent-primary/5 shadow-lg shadow-accent-primary/10'
                      : 'border-border-default hover:border-border-hover bg-surface'
                  }`}
                >
                  {computeTarget === 'cloud' && (
                    <div className="absolute top-3 right-3 w-6 h-6 rounded-full bg-accent-primary flex items-center justify-center">
                      <Check className="w-4 h-4 text-white" />
                    </div>
                  )}
                  <div
                    className={`p-3 rounded-lg w-fit mb-3 ${
                      computeTarget === 'cloud'
                        ? 'bg-accent-primary/20 text-accent-primary'
                        : 'bg-overlay text-text-muted'
                    }`}
                  >
                    <Cloud className="w-6 h-6" />
                  </div>
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-text-primary">Podex Cloud</h3>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent-primary/20 text-accent-primary">
                      Recommended
                    </span>
                  </div>
                  <p className="text-sm text-text-muted mb-3">
                    Managed infrastructure with instant scaling
                  </p>
                  <div className="flex items-center gap-4 text-xs text-text-muted">
                    <span>Docker containers</span>
                    <span>•</span>
                    <span>Templates available</span>
                  </div>
                </motion.button>

                {/* Local pods - online */}
                {localPods
                  .filter((p) => p.status === 'online')
                  .map((pod, index) => (
                    <motion.div
                      key={pod.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.1 + index * 0.05 }}
                      onClick={() => {
                        setComputeTarget(pod.id);
                        setSelectedMountPath(null);
                      }}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          setComputeTarget(pod.id);
                          setSelectedMountPath(null);
                        }
                      }}
                      className={`group relative p-5 rounded-xl border-2 text-left transition-all cursor-pointer ${
                        computeTarget === pod.id
                          ? 'border-success bg-success/5 shadow-lg shadow-success/10'
                          : 'border-border-default hover:border-border-hover bg-surface'
                      }`}
                    >
                      {/* Top right: OS badge, delete button, or checkmark */}
                      <div className="absolute top-3 right-3 flex items-center gap-2">
                        {/* OS Icon */}
                        {pod.os_info && getOsInfo(pod.os_info).icon && (
                          <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-overlay/50">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={getOsInfo(pod.os_info).icon}
                              alt={getOsInfo(pod.os_info).label}
                              width={14}
                              height={14}
                              className="opacity-80"
                            />
                            <span className="text-[10px] text-text-muted font-medium">
                              {getOsInfo(pod.os_info).label}
                              {getOsInfo(pod.os_info).arch && (
                                <span className="text-text-muted/60 ml-1">
                                  {getOsInfo(pod.os_info).arch}
                                </span>
                              )}
                            </span>
                          </div>
                        )}
                        {/* Delete button (hidden when selected) */}
                        {computeTarget !== pod.id && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setPodToDelete(pod);
                            }}
                            className="p-1.5 rounded-lg bg-overlay hover:bg-error/20 text-text-muted hover:text-error transition-colors opacity-0 group-hover:opacity-100"
                            title="Delete pod"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                        {computeTarget === pod.id && (
                          <div className="w-6 h-6 rounded-full bg-success flex items-center justify-center">
                            <Check className="w-4 h-4 text-white" />
                          </div>
                        )}
                      </div>
                      {/* Main icon */}
                      <div className="mb-3">
                        <div
                          className={`p-3 rounded-lg w-fit ${
                            computeTarget === pod.id
                              ? 'bg-success/20 text-success'
                              : 'bg-overlay text-text-muted'
                          }`}
                        >
                          <Laptop className="w-6 h-6" />
                        </div>
                      </div>
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold text-text-primary">{pod.name}</h3>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-success/20 text-success font-medium border border-success/30">
                          Online
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-text-muted mt-2">
                        {pod.total_cpu_cores && (
                          <span className="flex items-center gap-1">
                            <Cpu className="w-3 h-3" />
                            {pod.total_cpu_cores} cores
                          </span>
                        )}
                        {pod.total_memory_mb && (
                          <span className="flex items-center gap-1">
                            <MemoryStick className="w-3 h-3" />
                            {pod.total_memory_mb >= 1024
                              ? `${(pod.total_memory_mb / 1024).toFixed(0)} GB`
                              : `${pod.total_memory_mb} MB`}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center justify-between mt-2 text-xs">
                        <span className="text-text-muted">{pod.current_workspaces} workspaces</span>
                        {localPodPricing && (
                          <span className="font-medium text-success">
                            {localPodPricing.hourly_rate_cents === 0
                              ? 'Free'
                              : `$${(localPodPricing.hourly_rate_cents / 100).toFixed(2)}/hr`}
                          </span>
                        )}
                      </div>
                    </motion.div>
                  ))}

                {/* Offline pods */}
                {localPods
                  .filter((p) => p.status !== 'online')
                  .map((pod, index) => (
                    <motion.div
                      key={pod.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{
                        delay:
                          0.1 +
                          (localPods.filter((p) => p.status === 'online').length + index) * 0.05,
                      }}
                      className="relative p-5 rounded-xl border-2 border-border-subtle bg-surface/50 opacity-75"
                    >
                      {/* Top right: OS badge and delete button */}
                      <div className="absolute top-3 right-3 flex items-center gap-2">
                        {/* OS Icon */}
                        {pod.os_info && getOsInfo(pod.os_info).icon && (
                          <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-overlay/30">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={getOsInfo(pod.os_info).icon}
                              alt={getOsInfo(pod.os_info).label}
                              width={14}
                              height={14}
                              className="opacity-50"
                            />
                            <span className="text-[10px] text-text-muted/70 font-medium">
                              {getOsInfo(pod.os_info).label}
                            </span>
                          </div>
                        )}
                        {/* Delete button */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setPodToDelete(pod);
                          }}
                          className="p-1.5 rounded-lg bg-overlay hover:bg-error/20 text-text-muted hover:text-error transition-colors"
                          title="Delete pod"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                      {/* Main icon */}
                      <div className="mb-3">
                        <div className="p-3 rounded-lg w-fit bg-overlay text-text-muted">
                          <Laptop className="w-6 h-6" />
                        </div>
                      </div>
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold text-text-muted">{pod.name}</h3>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-text-muted/20 text-text-muted border border-text-muted/20">
                          Offline
                        </span>
                      </div>
                      <p className="text-sm text-text-muted">Start the agent to use this pod</p>
                    </motion.div>
                  ))}

                {/* Add Local Pod */}
                <motion.button
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 + localPods.length * 0.05 }}
                  onClick={() => setShowAddPodModal(true)}
                  className="p-5 rounded-xl border-2 border-dashed border-border-default hover:border-accent-primary/50 bg-surface/50 hover:bg-accent-primary/5 text-left transition-all group"
                >
                  <div className="p-3 rounded-lg w-fit mb-3 bg-overlay group-hover:bg-accent-primary/20 text-text-muted group-hover:text-accent-primary transition-colors">
                    <Plus className="w-6 h-6" />
                  </div>
                  <h3 className="font-semibold text-text-primary group-hover:text-accent-primary transition-colors mb-1">
                    Add Local Pod
                  </h3>
                  <p className="text-sm text-text-muted mb-2">Run on your own hardware</p>
                  <p className="text-xs text-text-muted">Free · Private · Yours</p>
                </motion.button>
              </div>

              {/* Native mode info banner */}
              {computeTarget !== 'cloud' && isNativeMode() && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-6 p-4 rounded-xl bg-warning/10 border border-warning/30"
                >
                  <div className="flex items-start gap-3">
                    <Terminal className="w-5 h-5 text-warning mt-0.5" />
                    <div>
                      <h4 className="text-sm font-semibold text-warning">Native Mode Selected</h4>
                      <p className="text-sm text-warning/80 mt-1">
                        This pod runs workspaces directly on your machine without Docker. Template
                        selection will be skipped — you&apos;ll select a mount path for your
                        workspace instead.
                      </p>
                    </div>
                  </div>
                </motion.div>
              )}
            </motion.div>
          )}

          {/* Step 2: Template Selection (skipped for native mode) */}
          {step === 'template' && (
            <motion.div
              key="template"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
            >
              <div className="text-center mb-10">
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                  className="inline-flex items-center gap-2 bg-accent-primary/10 text-accent-primary px-4 py-1.5 rounded-full text-sm mb-4"
                >
                  <Sparkles className="w-4 h-4" />
                  Step {getCurrentStepNumber()} of {getTotalSteps()}
                </motion.div>
                <h1 className="text-3xl font-bold text-text-primary mb-2">
                  Choose your Pod template
                </h1>
                <p className="text-text-secondary max-w-xl mx-auto">
                  Select a pre-configured environment or start from scratch. Each template comes
                  with the tools you need pre-installed.
                </p>
              </div>

              {/* Official Templates */}
              <div className="mb-8">
                <h2 className="text-sm font-medium text-text-muted uppercase tracking-wider mb-4">
                  Official Templates
                </h2>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {templates
                    .filter((t) => t.is_official)
                    .map((template, index) => (
                      <motion.button
                        key={template.id}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.05 }}
                        onClick={() => handleSelectTemplate(template)}
                        className={`relative text-left p-5 rounded-xl border-2 transition-all duration-200 ${
                          selectedTemplate?.id === template.id
                            ? 'border-accent-primary bg-accent-primary/5 shadow-lg shadow-accent-primary/10'
                            : 'border-border-default bg-surface hover:border-border-hover hover:bg-elevated'
                        }`}
                      >
                        {selectedTemplate?.id === template.id && (
                          <div className="absolute top-3 right-3 w-6 h-6 rounded-full bg-accent-primary flex items-center justify-center">
                            <Check className="w-4 h-4 text-white" />
                          </div>
                        )}
                        <div className="w-12 h-12 rounded-xl bg-overlay flex items-center justify-center mb-3">
                          <TemplateIcon icon={template.icon} iconUrl={template.icon_url} />
                        </div>
                        <h3 className="font-semibold text-text-primary mb-1">{template.name}</h3>
                        <p className="text-sm text-text-secondary line-clamp-2">
                          {template.description}
                        </p>
                        {template.language_versions &&
                          Object.keys(template.language_versions).length > 0 && (
                            <div className="flex flex-wrap gap-1.5 mt-3">
                              {Object.entries(template.language_versions).map(([lang, ver]) => (
                                <span
                                  key={lang}
                                  className="text-xs bg-overlay px-2 py-0.5 rounded text-text-muted"
                                >
                                  {lang} {ver}
                                </span>
                              ))}
                            </div>
                          )}
                      </motion.button>
                    ))}
                </div>
              </div>

              {/* Custom Templates */}
              {templates.filter((t) => !t.is_official).length > 0 && (
                <div>
                  <h2 className="text-sm font-medium text-text-muted uppercase tracking-wider mb-4">
                    Your Templates
                  </h2>
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {templates
                      .filter((t) => !t.is_official)
                      .map((template) => (
                        <button
                          key={template.id}
                          onClick={() => handleSelectTemplate(template)}
                          className={`text-left p-5 rounded-xl border-2 transition-all duration-200 ${
                            selectedTemplate?.id === template.id
                              ? 'border-accent-primary bg-accent-primary/5'
                              : 'border-border-default bg-surface hover:border-border-hover'
                          }`}
                        >
                          <div className="w-12 h-12 rounded-xl bg-overlay flex items-center justify-center mb-3">
                            <TemplateIcon icon={template.icon} iconUrl={template.icon_url} />
                          </div>
                          <h3 className="font-semibold text-text-primary mb-1">{template.name}</h3>
                          <p className="text-sm text-text-secondary line-clamp-2">
                            {template.description}
                          </p>
                        </button>
                      ))}
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {/* Step 3: Hardware Configuration (Step 2 for native mode) */}
          {step === 'hardware' && (
            <motion.div
              key="hardware"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
            >
              <div className="text-center mb-10">
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                  className="inline-flex items-center gap-2 bg-accent-primary/10 text-accent-primary px-4 py-1.5 rounded-full text-sm mb-4"
                >
                  <Cpu className="w-4 h-4" />
                  Step {getCurrentStepNumber()} of {getTotalSteps()}
                </motion.div>
                <h1 className="text-3xl font-bold text-text-primary mb-2">
                  {isNativeMode() ? 'Configure your workspace' : 'Configure your Pod'}
                </h1>
                <p className="text-text-secondary max-w-xl mx-auto">
                  {isNativeMode()
                    ? 'Select which folder to mount as your workspace directory.'
                    : 'Choose the hardware resources and software versions for your development environment.'}
                </p>
              </div>

              {/* Directory Selection for Local Pods */}
              {computeTarget !== 'cloud' &&
                (() => {
                  const selectedPod = localPods.find((p) => p.id === computeTarget);
                  if (!selectedPod) return null;

                  // All local pods are native mode - show directory browser
                  return (
                    <div className="mb-8">
                      <h2 className="text-sm font-medium text-text-muted uppercase tracking-wider mb-4">
                        Workspace Directory
                      </h2>
                      <DirectoryBrowser
                        podId={selectedPod.id}
                        selectedPath={selectedMountPath}
                        onSelect={setSelectedMountPath}
                      />
                    </div>
                  );
                })()}

              {/* Region Selection - Only for cloud pods */}
              {computeTarget === 'cloud' && (
                <div className="mb-8">
                  <h2 className="text-sm font-medium text-text-muted uppercase tracking-wider mb-4">
                    Region
                  </h2>
                  <div className="grid grid-cols-2 gap-4">
                    <button
                      onClick={() => setSelectedRegion('eu')}
                      className={cn(
                        'relative p-4 rounded-xl border-2 text-left transition-all',
                        selectedRegion === 'eu'
                          ? 'border-accent-primary bg-accent-primary/5'
                          : 'border-border-default hover:border-text-muted bg-surface'
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">🇪🇺</span>
                        <p className="font-medium text-text-primary">EU Germany</p>
                      </div>
                      {selectedRegion === 'eu' && (
                        <div className="absolute top-1/2 right-3 -translate-y-1/2 w-5 h-5 rounded-full bg-accent-primary flex items-center justify-center">
                          <Check className="w-3 h-3 text-white" />
                        </div>
                      )}
                    </button>
                    <button
                      onClick={() => setSelectedRegion('us')}
                      className={cn(
                        'relative p-4 rounded-xl border-2 text-left transition-all',
                        selectedRegion === 'us'
                          ? 'border-accent-primary bg-accent-primary/5'
                          : 'border-border-default hover:border-text-muted bg-surface'
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">🇺🇸</span>
                        <p className="font-medium text-text-primary">US Virginia</p>
                      </div>
                      {selectedRegion === 'us' && (
                        <div className="absolute top-1/2 right-3 -translate-y-1/2 w-5 h-5 rounded-full bg-accent-primary flex items-center justify-center">
                          <Check className="w-3 h-3 text-white" />
                        </div>
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* Hardware Tier Selection - Only for cloud pods */}
              {!isNativeMode() && (
                <div className="mb-8">
                  <h2 className="text-sm font-medium text-text-muted uppercase tracking-wider mb-4">
                    {computeTarget === 'cloud' ? 'Hardware Tier' : 'Resource Allocation'}
                  </h2>
                  {hardwareSpecs.length > 0 ? (
                    <HardwareSelector
                      specs={hardwareSpecs.map((spec) => ({
                        id: spec.id,
                        tier: spec.tier,
                        displayName: spec.display_name,
                        description: spec.description ?? undefined,
                        architecture: spec.architecture,
                        vcpu: spec.vcpu,
                        memoryMb: spec.memory_mb,
                        gpuType: spec.gpu_type ?? undefined,
                        gpuMemoryGb: spec.gpu_memory_gb ?? undefined,
                        storageGb: spec.storage_gb,
                        bandwidthMbps: spec.bandwidth_mbps ?? undefined,
                        hourlyRate: spec.hourly_rate,
                        isAvailable: spec.is_available,
                        requiresSubscription: spec.requires_subscription ?? undefined,
                      }))}
                      selectedTier={selectedTier}
                      onSelect={setSelectedTier}
                      regionCapacity={
                        computeTarget === 'cloud' && regionCapacity
                          ? regionCapacity.tiers
                          : undefined
                      }
                    />
                  ) : (
                    <div className="text-center py-8 border border-border-default rounded-xl bg-surface">
                      <Loader2 className="w-6 h-6 animate-spin mx-auto mb-3 text-text-muted" />
                      <p className="text-text-muted">Loading hardware options...</p>
                    </div>
                  )}
                </div>
              )}

              {/* Software Versions - Only for cloud/docker pods */}
              {!isNativeMode() && (
                <div className="mb-8">
                  <button
                    onClick={() => setShowAdvanced(!showAdvanced)}
                    className="flex items-center gap-2 text-sm font-medium text-text-muted uppercase tracking-wider mb-4 hover:text-text-secondary"
                  >
                    <span>Software Configuration</span>
                    <ArrowRight
                      className={`w-4 h-4 transition-transform ${showAdvanced ? 'rotate-90' : ''}`}
                    />
                  </button>

                  <AnimatePresence>
                    {showAdvanced && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 bg-surface border border-border-default rounded-xl p-6">
                          {/* OS Version */}
                          <div>
                            <label className="block text-sm font-medium text-text-primary mb-2">
                              Operating System
                            </label>
                            <select
                              value={selectedOsVersion}
                              onChange={(e) => setSelectedOsVersion(e.target.value)}
                              className="w-full px-3 py-2 bg-elevated border border-border-default rounded-lg text-text-primary focus:outline-none focus:border-accent-primary"
                            >
                              {osVersions.map((os) => (
                                <option key={os.value} value={os.value}>
                                  {os.label}
                                </option>
                              ))}
                            </select>
                          </div>

                          {/* Python Version */}
                          <div>
                            <label className="block text-sm font-medium text-text-primary mb-2">
                              Python Version
                            </label>
                            <select
                              value={selectedPythonVersion}
                              onChange={(e) => setSelectedPythonVersion(e.target.value)}
                              className="w-full px-3 py-2 bg-elevated border border-border-default rounded-lg text-text-primary focus:outline-none focus:border-accent-primary"
                            >
                              {pythonVersions.map((ver) => (
                                <option key={ver.value} value={ver.value}>
                                  {ver.label}
                                </option>
                              ))}
                            </select>
                          </div>

                          {/* Node Version */}
                          <div>
                            <label className="block text-sm font-medium text-text-primary mb-2">
                              Node.js Version
                            </label>
                            <select
                              value={selectedNodeVersion}
                              onChange={(e) => setSelectedNodeVersion(e.target.value)}
                              className="w-full px-3 py-2 bg-elevated border border-border-default rounded-lg text-text-primary focus:outline-none focus:border-accent-primary"
                            >
                              {nodeVersions.map((ver) => (
                                <option key={ver.value} value={ver.value}>
                                  {ver.label}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </motion.div>
          )}

          {/* Step 3: Workspace Configuration */}
          {step === 'workspace' && (
            <motion.div
              key="workspace"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
            >
              <div className="text-center mb-10">
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                  className="inline-flex items-center gap-2 bg-accent-primary/10 text-accent-primary px-4 py-1.5 rounded-full text-sm mb-4"
                >
                  <Code2 className="w-4 h-4" />
                  Step {getCurrentStepNumber()} of {getTotalSteps()}
                </motion.div>
                <h1 className="text-3xl font-bold text-text-primary mb-2">
                  Configure your workspace
                </h1>
                <p className="text-text-secondary max-w-xl mx-auto">
                  Give your project a name and optionally connect a Git repository.
                </p>
              </div>

              {/* Selected Configuration Summary */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-surface border border-border-default rounded-xl p-4 mb-8"
              >
                <div className="flex flex-wrap gap-4">
                  {/* Template or Native Mode */}
                  {selectedTemplate ? (
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-overlay flex items-center justify-center">
                        <TemplateIcon
                          icon={selectedTemplate.icon}
                          iconUrl={selectedTemplate.icon_url}
                          size="sm"
                        />
                      </div>
                      <div>
                        <p className="text-xs text-text-muted">Template</p>
                        <p className="text-sm font-medium text-text-primary">
                          {selectedTemplate.name}
                        </p>
                      </div>
                    </div>
                  ) : isNativeMode() ? (
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-warning/20 flex items-center justify-center">
                        <Terminal className="w-5 h-5 text-warning" />
                      </div>
                      <div>
                        <p className="text-xs text-text-muted">Mode</p>
                        <p className="text-sm font-medium text-warning">Native Execution</p>
                      </div>
                    </div>
                  ) : null}

                  {/* Divider */}
                  {(selectedTemplate || isNativeMode()) && (
                    <div className="w-px bg-border-default self-stretch" />
                  )}

                  {/* Compute Target */}
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                        computeTarget === 'cloud' ? 'bg-overlay' : 'bg-success/20'
                      }`}
                    >
                      {computeTarget === 'cloud' ? (
                        <Cloud className="w-5 h-5 text-text-muted" />
                      ) : (
                        <Laptop className="w-5 h-5 text-success" />
                      )}
                    </div>
                    <div>
                      <p className="text-xs text-text-muted">Compute</p>
                      <p className="text-sm font-medium text-text-primary">
                        {computeTarget === 'cloud'
                          ? 'Podex Cloud'
                          : localPods.find((p) => p.id === computeTarget)?.name || 'Local Pod'}
                      </p>
                      {computeTarget !== 'cloud' && selectedMountPath && (
                        <p
                          className="text-xs text-text-muted truncate max-w-[150px]"
                          title={selectedMountPath}
                        >
                          Mount: {selectedMountPath.split('/').pop()}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Divider */}
                  <div className="w-px bg-border-default self-stretch" />

                  {/* Hardware / Resources */}
                  {isNativeMode() ? (
                    // Native mode: show actual pod resources
                    (() => {
                      const pod = localPods.find((p) => p.id === computeTarget);
                      return (
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-lg bg-overlay flex items-center justify-center">
                            <Server className="w-5 h-5 text-text-muted" />
                          </div>
                          <div>
                            <p className="text-xs text-text-muted">Resources</p>
                            <div className="flex items-center gap-3 text-sm">
                              {pod?.total_cpu_cores && (
                                <span className="flex items-center gap-1 text-text-primary">
                                  <Cpu className="w-3.5 h-3.5 text-text-muted" />
                                  {pod.total_cpu_cores} cores
                                </span>
                              )}
                              {pod?.total_memory_mb && (
                                <span className="flex items-center gap-1 text-text-primary">
                                  <MemoryStick className="w-3.5 h-3.5 text-text-muted" />
                                  {Math.round(pod.total_memory_mb / 1024)} GB
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })()
                  ) : (
                    // Cloud mode: show selected tier
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-overlay flex items-center justify-center">
                        <Server className="w-5 h-5 text-text-muted" />
                      </div>
                      <div>
                        <p className="text-xs text-text-muted">Hardware Tier</p>
                        <p className="text-sm font-medium text-text-primary">
                          {selectedTier
                            ? hardwareSpecs.find((s) => s.tier === selectedTier)?.display_name ||
                              selectedTier
                            : 'Not selected'}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Stack info - only for cloud mode */}
                  {!isNativeMode() && (
                    <>
                      {/* Divider */}
                      <div className="w-px bg-border-default self-stretch" />

                      {/* Languages */}
                      <div className="flex-1">
                        <p className="text-xs text-text-muted mb-1">Stack</p>
                        <div className="flex flex-wrap gap-1.5">
                          {selectedPythonVersion !== 'none' && (
                            <span className="text-xs bg-overlay px-2 py-0.5 rounded text-text-muted">
                              Python {selectedPythonVersion}
                            </span>
                          )}
                          {selectedNodeVersion !== 'none' && (
                            <span className="text-xs bg-overlay px-2 py-0.5 rounded text-text-muted">
                              Node {selectedNodeVersion}
                            </span>
                          )}
                          <span className="text-xs bg-overlay px-2 py-0.5 rounded text-text-muted">
                            {selectedOsVersion}
                          </span>
                        </div>
                      </div>
                    </>
                  )}

                  {/* Change button */}
                  <button
                    onClick={() => setStep('hardware')}
                    className="text-sm text-accent-primary hover:underline self-center"
                  >
                    Change
                  </button>
                </div>
              </motion.div>

              {/* Error Message */}
              {creationError && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="max-w-lg mx-auto mb-6 p-4 bg-accent-error/10 border border-accent-error/20 rounded-xl"
                >
                  <div className="flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-accent-error flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-accent-error">Failed to create pod</p>
                      <p className="text-sm text-text-secondary mt-1">{creationError}</p>
                    </div>
                  </div>
                </motion.div>
              )}

              {/* Form */}
              <div className="max-w-lg mx-auto space-y-6">
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                >
                  <label className="block text-sm font-medium text-text-primary mb-2">
                    Project Name <span className="text-accent-error">*</span>
                  </label>
                  <Input
                    value={sessionName}
                    onChange={(e) => setSessionName(e.target.value)}
                    placeholder="My Awesome Project"
                    className="text-lg"
                    autoFocus
                  />
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                  className="border-t border-border-default pt-6"
                >
                  <div className="flex items-center gap-2 mb-4">
                    <GitBranch className="w-5 h-5 text-text-secondary" />
                    <span className="font-medium text-text-primary">
                      {isNativeMode() ? 'GitHub Integration' : 'Git Repository (Optional)'}
                    </span>
                  </div>

                  {isNativeMode() ? (
                    // Native mode: simplified GitHub status only
                    <div className="space-y-3">
                      {githubLoading ? (
                        <div className="flex items-center gap-2 text-sm text-text-muted">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Checking GitHub connection...
                        </div>
                      ) : githubStatus?.connected ? (
                        <div className="flex items-center justify-between gap-4 rounded-lg border border-success/30 bg-success/5 p-4">
                          <div className="flex items-center gap-3 text-sm">
                            <Github className="w-5 h-5 text-success" />
                            <div>
                              <p className="text-sm font-medium text-text-primary">
                                Connected as @{githubStatus.username}
                              </p>
                              <p className="text-xs text-text-muted">
                                Git operations will use your GitHub credentials
                              </p>
                            </div>
                          </div>
                          <Check className="w-5 h-5 text-success" />
                        </div>
                      ) : (
                        <div className="flex items-center justify-between gap-4 rounded-lg border border-border-default bg-surface p-4">
                          <div className="flex items-center gap-3 text-sm text-text-secondary">
                            <Github className="w-5 h-5 text-text-muted" />
                            <div>
                              <p className="text-sm font-medium text-text-primary">
                                Connect GitHub for private repos
                              </p>
                              <p className="text-xs text-text-tertiary">
                                Public repos work without connecting
                              </p>
                            </div>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={handleConnectGitHub}
                            disabled={githubConnecting}
                          >
                            {githubConnecting ? (
                              <>
                                <Loader2 className="w-3 h-3 animate-spin mr-1.5" />
                                Connecting...
                              </>
                            ) : (
                              'Connect'
                            )}
                          </Button>
                        </div>
                      )}
                      <p className="text-xs text-text-muted">
                        In native mode, you manage git locally. Use{' '}
                        <code className="px-1 py-0.5 rounded bg-overlay">git clone</code> in your
                        workspace directory.
                      </p>
                    </div>
                  ) : (
                    // Cloud mode: full git repo selection
                    <div className="space-y-4">
                      {githubLoading ? (
                        <div className="flex items-center gap-2 text-sm text-text-muted">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Checking GitHub connection...
                        </div>
                      ) : githubStatus?.connected ? (
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 text-sm text-text-secondary">
                              <Github className="w-4 h-4" />
                              <span>
                                Connected
                                {githubStatus.username ? ` as @${githubStatus.username}` : ''}
                              </span>
                            </div>
                            <button
                              onClick={fetchGitHubRepos}
                              disabled={githubReposLoading}
                              className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-overlay disabled:opacity-50"
                              title="Refresh repositories"
                            >
                              <RefreshCw
                                className={cn('w-4 h-4', githubReposLoading && 'animate-spin')}
                              />
                            </button>
                          </div>

                          <div>
                            <label className="block text-sm text-text-secondary mb-2">
                              Select Repository
                            </label>
                            <select
                              value={gitUrl}
                              onChange={(e) => {
                                const selectedUrl = e.target.value;
                                setGitUrl(selectedUrl);
                                setUseCustomBranch(false);
                                const repo = githubRepos.find((r) => r.html_url === selectedUrl);
                                if (repo) {
                                  if (repo.default_branch) {
                                    setBranch(repo.default_branch);
                                  }
                                  // Auto-update project name to repo name
                                  setSessionName(repo.name);
                                }
                              }}
                              className="w-full px-3 py-2 bg-elevated border border-border-default rounded-lg text-text-primary focus:outline-none focus:border-accent-primary"
                            >
                              <option value="">Select a repo (optional)</option>
                              {githubRepos.map((repo) => (
                                <option key={repo.id} value={repo.html_url}>
                                  {repo.full_name} {repo.private ? '(Private)' : ''}
                                </option>
                              ))}
                            </select>
                            {githubRepoError && (
                              <p className="text-xs text-accent-error mt-2">{githubRepoError}</p>
                            )}
                            {!githubRepoError &&
                              githubRepos.length === 0 &&
                              !githubReposLoading && (
                                <p className="text-xs text-text-tertiary mt-2">
                                  No repositories found for this account.
                                </p>
                              )}
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between gap-4 rounded-lg border border-border-default bg-surface p-4">
                          <div className="flex items-center gap-3 text-sm text-text-secondary">
                            <Github className="w-5 h-5 text-text-muted" />
                            <div>
                              <p className="text-sm font-medium text-text-primary">
                                Connect GitHub to choose a repo
                              </p>
                              <p className="text-xs text-text-tertiary">
                                Pull in your repositories and default branches.
                              </p>
                            </div>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={handleConnectGitHub}
                            disabled={githubConnecting}
                          >
                            {githubConnecting ? (
                              <>
                                <Loader2 className="w-3 h-3 animate-spin mr-1.5" />
                                Connecting...
                              </>
                            ) : (
                              'Connect GitHub'
                            )}
                          </Button>
                        </div>
                      )}
                      <div>
                        <label className="block text-sm text-text-secondary mb-2">
                          Repository URL
                        </label>
                        <Input
                          value={gitUrl}
                          onChange={(e) => setGitUrl(e.target.value)}
                          placeholder="https://github.com/username/repo"
                        />
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <label className="block text-sm text-text-secondary">Branch</label>
                          {githubStatus?.connected && gitUrl && (
                            <button
                              type="button"
                              onClick={() => fetchGitHubBranches(gitUrl)}
                              disabled={githubBranchesLoading}
                              className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-overlay disabled:opacity-50"
                              title="Refresh branches"
                            >
                              <RefreshCw
                                className={cn(
                                  'w-3.5 h-3.5',
                                  githubBranchesLoading && 'animate-spin'
                                )}
                              />
                            </button>
                          )}
                        </div>
                        {githubBranches.length > 0 && !useCustomBranch ? (
                          <select
                            value={branch}
                            onChange={(e) => {
                              const value = e.target.value;
                              if (value === '__custom__') {
                                setUseCustomBranch(true);
                                setBranch('');
                              } else {
                                setBranch(value);
                              }
                            }}
                            className="w-full px-3 py-2 bg-elevated border border-border-default rounded-lg text-text-primary focus:outline-none focus:border-accent-primary"
                          >
                            <option value="">Select a branch</option>
                            {githubBranches.map((gitBranch) => (
                              <option key={gitBranch.name} value={gitBranch.name}>
                                {gitBranch.name}
                              </option>
                            ))}
                            <option value="__custom__">Custom branch...</option>
                          </select>
                        ) : (
                          <div className="space-y-2">
                            <Input
                              value={branch}
                              onChange={(e) => setBranch(e.target.value)}
                              placeholder="main"
                            />
                            {githubBranches.length > 0 && (
                              <button
                                type="button"
                                onClick={() => setUseCustomBranch(false)}
                                className="text-xs text-accent-primary hover:underline"
                              >
                                Use branch list
                              </button>
                            )}
                          </div>
                        )}
                        {githubBranchesError && (
                          <p className="text-xs text-accent-error mt-2">{githubBranchesError}</p>
                        )}
                      </div>
                    </div>
                  )}
                </motion.div>
              </div>
            </motion.div>
          )}

          {/* Step 3: Creating */}
          {step === 'creating' && (
            <motion.div
              key="creating"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="min-h-[60vh] flex items-center justify-center"
            >
              <div className="text-center max-w-md">
                {/* Animated Logo */}
                <motion.div
                  initial={{ scale: 0.8 }}
                  animate={{ scale: 1 }}
                  className="relative mx-auto mb-8 w-40 h-40 flex items-center justify-center"
                >
                  <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-accent-primary to-accent-secondary flex items-center justify-center relative z-10">
                    {creatingProgress < 100 ? (
                      <Loader2 className="w-12 h-12 text-white animate-spin" />
                    ) : (
                      <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ type: 'spring', damping: 10 }}
                      >
                        <Check className="w-12 h-12 text-white" />
                      </motion.div>
                    )}
                  </div>
                  <motion.div
                    animate={{
                      scale: [1, 1.2, 1],
                      opacity: [0.5, 0.2, 0.5],
                    }}
                    transition={{
                      duration: 2,
                      repeat: Infinity,
                      ease: 'easeInOut',
                    }}
                    className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-24 h-24 rounded-3xl bg-gradient-to-br from-accent-primary to-accent-secondary blur-2xl"
                  />
                </motion.div>

                {/* Status */}
                <motion.h2
                  key={creatingStatus}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-xl font-semibold text-text-primary mb-2"
                >
                  {creatingStatus}
                </motion.h2>
                <p className="text-text-secondary mb-8">
                  {creatingProgress < 100
                    ? 'Setting up your development environment...'
                    : 'Redirecting to your workspace...'}
                </p>

                {/* Progress Bar */}
                <div className="w-full bg-overlay rounded-full h-2 overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${creatingProgress}%` }}
                    transition={{ duration: 0.5, ease: 'easeOut' }}
                    className="h-full bg-gradient-to-r from-accent-primary to-accent-secondary rounded-full"
                  />
                </div>
                <p className="text-sm text-text-muted mt-2">{creatingProgress}%</p>

                {/* Template/Mode info */}
                {(selectedTemplate || isNativeMode()) && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.5 }}
                    className="mt-8 flex items-center justify-center gap-3 text-text-muted"
                  >
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center ${isNativeMode() ? 'bg-warning/20' : 'bg-overlay'}`}
                    >
                      {selectedTemplate ? (
                        <TemplateIcon
                          icon={selectedTemplate.icon}
                          iconUrl={selectedTemplate.icon_url}
                          size="sm"
                        />
                      ) : (
                        <Terminal className="w-4 h-4 text-warning" />
                      )}
                    </div>
                    <span className="text-sm">
                      Creating <span className="text-text-secondary">{sessionName}</span>
                      {selectedTemplate ? (
                        <>
                          {' '}
                          with <span className="text-text-secondary">{selectedTemplate.name}</span>
                        </>
                      ) : isNativeMode() ? (
                        <>
                          {' '}
                          in <span className="text-warning">native mode</span>
                        </>
                      ) : null}
                    </span>
                  </motion.div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Sticky Footer Navigation */}
      {step !== 'creating' && (
        <footer className="fixed bottom-0 left-0 right-0 bg-void/80 backdrop-blur-lg border-t border-border-subtle z-50">
          <div className="max-w-5xl mx-auto px-6 py-4">
            <div className="flex items-center justify-between">
              {step === 'compute' ? (
                <div />
              ) : (
                <Button variant="ghost" onClick={handleBack}>
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back
                </Button>
              )}
              <Button onClick={handleNext} disabled={!canProceed} className="px-8">
                {step === 'workspace' ? (
                  <>
                    <Server className="w-4 h-4 mr-2" />
                    Create Pod
                  </>
                ) : (
                  <>
                    Continue
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </>
                )}
              </Button>
            </div>
          </div>
        </footer>
      )}

      {/* Add Local Pod Modal */}
      {showAddPodModal && (
        <AddLocalPodModal
          onClose={() => setShowAddPodModal(false)}
          onPodCreated={async () => {
            // Refresh local pods list
            const updatedPods = await listLocalPods().catch(() => []);
            setLocalPods(updatedPods);
          }}
        />
      )}

      {/* Delete Pod Confirmation Modal */}
      {podToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => !isDeleting && setPodToDelete(null)}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="relative bg-surface border border-border-default rounded-2xl p-6 max-w-md w-full mx-4 shadow-xl"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="p-3 rounded-full bg-error/20">
                <AlertCircle className="w-6 h-6 text-error" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-text-primary">Delete Local Pod</h3>
                <p className="text-sm text-text-muted">This action cannot be undone</p>
              </div>
            </div>

            <p className="text-text-secondary mb-2">
              Are you sure you want to delete{' '}
              <span className="font-semibold text-text-primary">{podToDelete.name}</span>?
            </p>
            <p className="text-sm text-text-muted mb-6">
              This will permanently remove the pod configuration. Any running workspaces will be
              terminated.
            </p>

            <div className="flex gap-3 justify-end">
              <Button
                variant="secondary"
                onClick={() => setPodToDelete(null)}
                disabled={isDeleting}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={async () => {
                  setIsDeleting(true);
                  try {
                    await deleteLocalPod(podToDelete.id);
                    // Refresh the local pods list
                    const updatedPods = await listLocalPods().catch(() => []);
                    setLocalPods(updatedPods);
                    // Clear selection if deleted pod was selected
                    if (computeTarget === podToDelete.id) {
                      setComputeTarget('cloud');
                    }
                    toast.success(`Pod "${podToDelete.name}" deleted`);
                    setPodToDelete(null);
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : 'Failed to delete pod');
                  } finally {
                    setIsDeleting(false);
                  }
                }}
                disabled={isDeleting}
              >
                {isDeleting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4 mr-2" />
                    Delete Pod
                  </>
                )}
              </Button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
