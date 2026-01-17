'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  GitBranch,
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
  Activity,
} from 'lucide-react';
import { Button, Input } from '@podex/ui';
import Image from 'next/image';
import {
  listTemplates,
  createSession,
  getUserConfig,
  listHardwareSpecs,
  listLocalPods,
  type PodTemplate,
  type UserConfig,
  type HardwareSpecResponse,
  type LocalPod,
} from '@/lib/api';
import { useUser } from '@/stores/auth';
import { HardwareSelector } from '@/components/billing/HardwareSelector';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

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

// Step type
type Step = 'template' | 'hardware' | 'workspace' | 'creating';

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
  { value: 'amazon-linux-2023', label: 'Amazon Linux 2023' },
];

// Compute target type
type ComputeTarget = 'cloud' | string; // 'cloud' or local_pod_id

export default function NewSessionPage() {
  useDocumentTitle('New Pod');
  const router = useRouter();
  const user = useUser();
  const [step, setStep] = useState<Step>('template');
  const [templates, setTemplates] = useState<PodTemplate[]>([]);
  const [hardwareSpecs, setHardwareSpecs] = useState<HardwareSpecResponse[]>([]);
  const [localPods, setLocalPods] = useState<LocalPod[]>([]);
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

  // Pod configuration state
  const [selectedTier, setSelectedTier] = useState<string>('small');
  const [selectedPythonVersion, setSelectedPythonVersion] = useState<string>('3.12');
  const [selectedNodeVersion, setSelectedNodeVersion] = useState<string>('20');
  const [selectedOsVersion, setSelectedOsVersion] = useState<string>('ubuntu-22.04');
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Compute target (cloud or local pod)
  const [computeTarget, setComputeTarget] = useState<ComputeTarget>('cloud');

  useEffect(() => {
    if (!user) {
      router.push('/auth/login');
      return;
    }

    async function loadData() {
      try {
        const [templatesData, configData, hardwareData, localPodsData] = await Promise.all([
          listTemplates(true),
          getUserConfig().catch(() => null),
          listHardwareSpecs().catch(() => []),
          listLocalPods().catch(() => []),
        ]);
        setTemplates(templatesData);
        setUserConfig(configData);
        setHardwareSpecs(hardwareData);
        setLocalPods(localPodsData);

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

  const handleSelectTemplate = (template: PodTemplate) => {
    setSelectedTemplate(template);
  };

  const handleNext = () => {
    if (step === 'template') {
      setStep('hardware');
    } else if (step === 'hardware') {
      // Auto-generate session name if not set
      if (!sessionName && selectedTemplate) {
        setSessionName(`${selectedTemplate.name} Project`);
      }
      setStep('workspace');
    } else if (step === 'workspace') {
      handleCreate();
    }
  };

  const handleBack = () => {
    if (step === 'hardware') {
      setStep('template');
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
        tier: selectedTier,
        python_version: selectedPythonVersion !== 'none' ? selectedPythonVersion : undefined,
        node_version: selectedNodeVersion !== 'none' ? selectedNodeVersion : undefined,
        os_version: selectedOsVersion,
        // Local pod (if selected)
        local_pod_id: computeTarget !== 'cloud' ? computeTarget : undefined,
      });

      clearInterval(progressInterval);
      setCreatingProgress(100);
      setCreatingStatus('Pod is ready!');

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
    step === 'template'
      ? selectedTemplate !== null
      : step === 'hardware'
        ? selectedTier !== ''
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
              <div className="flex items-center gap-1">
                {['template', 'hardware', 'workspace', 'creating'].map((s, i) => (
                  <div
                    key={s}
                    className={`w-2 h-2 rounded-full transition-colors ${
                      step === s
                        ? 'bg-accent-primary'
                        : ['template', 'hardware', 'workspace', 'creating'].indexOf(step) > i
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
      <main className="max-w-5xl mx-auto px-6 py-12">
        <AnimatePresence mode="wait">
          {/* Step 1: Template Selection */}
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
                  Step 1 of 3
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

              {/* Footer */}
              <div className="mt-10 flex justify-end">
                <Button onClick={handleNext} disabled={!canProceed} className="px-8">
                  Continue
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </motion.div>
          )}

          {/* Step 2: Hardware Configuration */}
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
                  <Server className="w-4 h-4" />
                  Step 2 of 3
                </motion.div>
                <h1 className="text-3xl font-bold text-text-primary mb-2">Configure your Pod</h1>
                <p className="text-text-secondary max-w-xl mx-auto">
                  Choose the hardware resources and software versions for your development
                  environment.
                </p>
              </div>

              {/* Compute Target Selection */}
              {localPods.length > 0 && (
                <div className="mb-8">
                  <h2 className="text-sm font-medium text-text-muted uppercase tracking-wider mb-4">
                    Compute Target
                  </h2>
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {/* Cloud option */}
                    <button
                      onClick={() => setComputeTarget('cloud')}
                      className={`p-4 rounded-xl border-2 text-left transition-all ${
                        computeTarget === 'cloud'
                          ? 'border-accent-primary bg-accent-primary/5 shadow-lg shadow-accent-primary/10'
                          : 'border-border-default hover:border-border-hover bg-surface'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className={`p-2 rounded-lg ${
                            computeTarget === 'cloud'
                              ? 'bg-accent-primary/20 text-accent-primary'
                              : 'bg-overlay text-text-muted'
                          }`}
                        >
                          <Cloud className="w-5 h-5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold text-text-primary">Podex Cloud</h3>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent-primary/20 text-accent-primary">
                              Recommended
                            </span>
                          </div>
                          <p className="text-sm text-text-muted mt-1">
                            Managed infrastructure, instant scaling
                          </p>
                        </div>
                        {computeTarget === 'cloud' && (
                          <div className="w-5 h-5 rounded-full bg-accent-primary flex items-center justify-center">
                            <Check className="w-3 h-3 text-white" />
                          </div>
                        )}
                      </div>
                    </button>

                    {/* Local pods */}
                    {localPods
                      .filter((p) => p.status === 'online')
                      .map((pod) => (
                        <button
                          key={pod.id}
                          onClick={() => setComputeTarget(pod.id)}
                          className={`p-4 rounded-xl border-2 text-left transition-all ${
                            computeTarget === pod.id
                              ? 'border-success bg-success/5 shadow-lg shadow-success/10'
                              : 'border-border-default hover:border-border-hover bg-surface'
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <div
                              className={`p-2 rounded-lg ${
                                computeTarget === pod.id
                                  ? 'bg-success/20 text-success'
                                  : 'bg-overlay text-text-muted'
                              }`}
                            >
                              <Laptop className="w-5 h-5" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <h3 className="font-semibold text-text-primary">{pod.name}</h3>
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-success/20 text-success">
                                  Online
                                </span>
                              </div>
                              <div className="flex items-center gap-3 mt-1 text-xs text-text-muted">
                                {pod.total_cpu_cores && (
                                  <span className="flex items-center gap-1">
                                    <Cpu className="w-3 h-3" />
                                    {pod.total_cpu_cores} cores
                                  </span>
                                )}
                                {pod.total_memory_mb && (
                                  <span className="flex items-center gap-1">
                                    <Activity className="w-3 h-3" />
                                    {pod.total_memory_mb >= 1024
                                      ? `${(pod.total_memory_mb / 1024).toFixed(0)} GB`
                                      : `${pod.total_memory_mb} MB`}
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-text-muted mt-1">
                                {pod.current_workspaces}/{pod.max_workspaces} workspaces
                              </p>
                            </div>
                            {computeTarget === pod.id && (
                              <div className="w-5 h-5 rounded-full bg-success flex items-center justify-center">
                                <Check className="w-3 h-3 text-white" />
                              </div>
                            )}
                          </div>
                        </button>
                      ))}

                    {/* Offline pods (disabled) */}
                    {localPods
                      .filter((p) => p.status !== 'online')
                      .map((pod) => (
                        <div
                          key={pod.id}
                          className="p-4 rounded-xl border-2 border-border-subtle bg-surface/50 opacity-60 cursor-not-allowed"
                        >
                          <div className="flex items-start gap-3">
                            <div className="p-2 rounded-lg bg-overlay text-text-muted">
                              <Laptop className="w-5 h-5" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <h3 className="font-semibold text-text-muted">{pod.name}</h3>
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-text-muted/20 text-text-muted">
                                  Offline
                                </span>
                              </div>
                              <p className="text-xs text-text-muted mt-1">
                                Start the agent to use this pod
                              </p>
                            </div>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* Hardware Tier Selection */}
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
                      storageGbDefault: spec.storage_gb_default,
                      storageGbMax: spec.storage_gb_max,
                      hourlyRate: spec.hourly_rate,
                      isAvailable: spec.is_available,
                      requiresSubscription: spec.requires_subscription ?? undefined,
                    }))}
                    selectedTier={selectedTier}
                    onSelect={setSelectedTier}
                  />
                ) : (
                  <div className="text-center py-8 border border-border-default rounded-xl bg-surface">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto mb-3 text-text-muted" />
                    <p className="text-text-muted">Loading hardware options...</p>
                  </div>
                )}
              </div>

              {/* Software Versions */}
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

              {/* Footer */}
              <div className="mt-10 flex justify-between">
                <Button variant="ghost" onClick={handleBack}>
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back
                </Button>
                <Button onClick={handleNext} disabled={!canProceed} className="px-8">
                  Continue
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
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
                  Step 3 of 3
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
                  {/* Template */}
                  {selectedTemplate && (
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
                  )}

                  {/* Divider */}
                  <div className="w-px bg-border-default self-stretch" />

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
                    </div>
                  </div>

                  {/* Divider */}
                  <div className="w-px bg-border-default self-stretch" />

                  {/* Hardware */}
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-overlay flex items-center justify-center">
                      <Server className="w-5 h-5 text-text-muted" />
                    </div>
                    <div>
                      <p className="text-xs text-text-muted">
                        {computeTarget === 'cloud' ? 'Hardware Tier' : 'Resources'}
                      </p>
                      <p className="text-sm font-medium text-text-primary capitalize">
                        {selectedTier}
                      </p>
                    </div>
                  </div>

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
                    <span className="font-medium text-text-primary">Git Repository (Optional)</span>
                  </div>
                  <div className="space-y-4">
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
                      <label className="block text-sm text-text-secondary mb-2">Branch</label>
                      <Input
                        value={branch}
                        onChange={(e) => setBranch(e.target.value)}
                        placeholder="main"
                      />
                    </div>
                  </div>
                </motion.div>
              </div>

              {/* Footer */}
              <div className="mt-10 flex justify-between max-w-lg mx-auto">
                <Button variant="ghost" onClick={handleBack}>
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back
                </Button>
                <Button onClick={handleNext} disabled={!canProceed} className="px-8">
                  <Server className="w-4 h-4 mr-2" />
                  Create Pod
                </Button>
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
                  className="relative mx-auto mb-8"
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
                    className="absolute inset-0 rounded-3xl bg-gradient-to-br from-accent-primary to-accent-secondary blur-2xl"
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

                {/* Template info */}
                {selectedTemplate && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.5 }}
                    className="mt-8 flex items-center justify-center gap-3 text-text-muted"
                  >
                    <div className="w-8 h-8 rounded-lg bg-overlay flex items-center justify-center">
                      <TemplateIcon
                        icon={selectedTemplate.icon}
                        iconUrl={selectedTemplate.icon_url}
                        size="sm"
                      />
                    </div>
                    <span className="text-sm">
                      Creating <span className="text-text-secondary">{sessionName}</span> with{' '}
                      <span className="text-text-secondary">{selectedTemplate.name}</span>
                    </span>
                  </motion.div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
