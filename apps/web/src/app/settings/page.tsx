'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import {
  Settings,
  Terminal,
  GitBranch,
  Palette,
  FileCode,
  Save,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2,
  Check,
  Box,
  RotateCcw,
} from 'lucide-react';
import { Button, Input } from '@podex/ui';
import {
  getUserConfig,
  updateUserConfig,
  listTemplates,
  type UserConfig,
  type PodTemplate,
  type UpdateUserConfigRequest,
} from '@/lib/api';
import { useUser, useAuthStore } from '@/stores/auth';
import { useOnboardingTour } from '@/components/ui/OnboardingTour';
import { ExternalAgentSettings } from '@/components/settings/ExternalAgentSettings';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { cn } from '@/lib/utils';

type TabId = 'general' | 'dotfiles' | 'git' | 'appearance' | 'templates' | 'external-agents';

interface Tab {
  id: TabId;
  label: string;
  icon: React.ReactNode;
}

const tabs: Tab[] = [
  { id: 'general', label: 'General', icon: <Settings className="w-4 h-4" /> },
  { id: 'dotfiles', label: 'Shell & Dotfiles', icon: <Terminal className="w-4 h-4" /> },
  { id: 'git', label: 'Git Config', icon: <GitBranch className="w-4 h-4" /> },
  { id: 'appearance', label: 'Appearance', icon: <Palette className="w-4 h-4" /> },
  { id: 'templates', label: 'Pod Templates', icon: <FileCode className="w-4 h-4" /> },
  { id: 'external-agents', label: 'External Agents', icon: <Box className="w-4 h-4" /> },
];

const shellOptions = [
  { value: 'zsh', label: 'Zsh' },
  { value: 'bash', label: 'Bash' },
  { value: 'fish', label: 'Fish' },
];

const editorOptions = [
  { value: 'vscode', label: 'VS Code (Monaco)' },
  { value: 'vim', label: 'Vim' },
  { value: 'neovim', label: 'Neovim' },
];

const themeOptions = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'system', label: 'System' },
];

const editorThemeOptions = [
  { value: 'vs-dark', label: 'Visual Studio Dark' },
  { value: 'vs-light', label: 'Visual Studio Light' },
  { value: 'github-dark', label: 'GitHub Dark' },
  { value: 'monokai', label: 'Monokai' },
  { value: 'dracula', label: 'Dracula' },
];

// Template icon configuration with CDN URLs (Simple Icons)
const templateIconConfig: Record<string, { url: string }> = {
  nodejs: { url: 'https://cdn.simpleicons.org/nodedotjs/339933' },
  python: { url: 'https://cdn.simpleicons.org/python/3776AB' },
  go: { url: 'https://cdn.simpleicons.org/go/00ADD8' },
  rust: { url: 'https://cdn.simpleicons.org/rust/DEA584' },
  typescript: { url: 'https://cdn.simpleicons.org/typescript/3178C6' },
  javascript: { url: 'https://cdn.simpleicons.org/javascript/F7DF1E' },
  react: { url: 'https://cdn.simpleicons.org/react/61DAFB' },
  docker: { url: 'https://cdn.simpleicons.org/docker/2496ED' },
  layers: { url: 'https://cdn.simpleicons.org/stackblitz/1389FD' },
};

function TemplateIcon({ icon, iconUrl }: { icon: string | null; iconUrl?: string | null }) {
  // Use iconUrl from API if available, otherwise fall back to local mapping
  const url = iconUrl || (icon ? templateIconConfig[icon]?.url : null);
  if (url) {
    return <Image src={url} alt={icon || 'template'} width={20} height={20} unoptimized />;
  }
  return <Box className="w-5 h-5 text-text-muted" />;
}

const defaultDotfilePaths = [
  '.bashrc',
  '.zshrc',
  '.gitconfig',
  '.npmrc',
  '.vimrc',
  '.config/starship.toml',
  '.ssh/config',
];

export default function SettingsPage() {
  useDocumentTitle('Settings');
  const router = useRouter();
  const user = useUser();
  const isInitialized = useAuthStore((s) => s.isInitialized);
  const { resetAllTours } = useOnboardingTour();
  const [activeTab, setActiveTab] = useState<TabId | null>(null); // null = show tab list on mobile
  const [_config, setConfig] = useState<UserConfig | null>(null);
  const [templates, setTemplates] = useState<PodTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [tutorialReset, setTutorialReset] = useState(false);

  // Form state
  const [formData, setFormData] = useState<UpdateUserConfigRequest>({});

  // Get current tab for display
  const currentTab = tabs.find((t) => t.id === activeTab);

  useEffect(() => {
    // Wait for auth to initialize before checking user
    if (!isInitialized) {
      return;
    }

    if (!user) {
      router.push('/auth/login');
      return;
    }

    async function loadData() {
      try {
        const [configData, templatesData] = await Promise.all([
          getUserConfig(),
          listTemplates(true),
        ]);
        setConfig(configData);
        setTemplates(templatesData);
        setFormData({
          sync_dotfiles: configData.sync_dotfiles,
          dotfiles_repo: configData.dotfiles_repo,
          dotfiles_paths: configData.dotfiles_paths || defaultDotfilePaths,
          default_shell: configData.default_shell,
          default_editor: configData.default_editor,
          git_name: configData.git_name,
          git_email: configData.git_email,
          default_template_id: configData.default_template_id,
          theme: configData.theme,
          editor_theme: configData.editor_theme,
        });
      } catch {
        setError('Failed to load settings');
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [user, router, isInitialized]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const updated = await updateUserConfig(formData);
      setConfig(updated);
      setSuccessMessage('Settings saved successfully');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const updateFormData = (key: keyof UpdateUserConfigRequest, value: unknown) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  const addDotfilePath = () => {
    const paths = formData.dotfiles_paths || [];
    updateFormData('dotfiles_paths', [...paths, '']);
  };

  const removeDotfilePath = (index: number) => {
    const paths = formData.dotfiles_paths || [];
    updateFormData(
      'dotfiles_paths',
      paths.filter((_, i) => i !== index)
    );
  };

  const updateDotfilePath = (index: number, value: string) => {
    const paths = [...(formData.dotfiles_paths || [])];
    paths[index] = value;
    updateFormData('dotfiles_paths', paths);
  };

  const handleResetTutorial = () => {
    resetAllTours();
    setTutorialReset(true);
    setSuccessMessage('Tutorial reset! It will show again on your next session.');
    setTimeout(() => {
      setSuccessMessage(null);
      setTutorialReset(false);
    }, 3000);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-void flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-accent-primary" />
      </div>
    );
  }

  // For desktop, default to 'general' tab; for mobile, show tab list when null
  const effectiveTab = activeTab || 'general';

  return (
    <div className="min-h-screen bg-void">
      {/* Desktop Header - hidden on mobile (layout handles mobile header) */}
      <header className="hidden md:block bg-elevated border-b border-border-default">
        <div className="max-w-6xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => router.push('/')}
                className="text-text-secondary hover:text-text-primary"
              >
                <ChevronRight className="w-5 h-5 rotate-180" />
              </button>
              <h1 className="text-xl font-semibold text-text-primary">Settings</h1>
            </div>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <Save className="w-4 h-4 mr-2" />
              )}
              Save Changes
            </Button>
          </div>
        </div>
      </header>

      {/* Mobile Sub-Navigation Header - shown when viewing content on mobile */}
      <div
        className={cn(
          'md:hidden sticky top-0 z-30 bg-surface border-b border-border-subtle',
          activeTab === null && 'hidden'
        )}
      >
        <div className="flex items-center justify-between p-3">
          <button
            onClick={() => setActiveTab(null)}
            className="flex items-center gap-2 text-text-muted hover:text-text-primary"
          >
            <ChevronLeft className="h-5 w-5" />
            <span className="text-sm">Back</span>
          </button>
          <span className="text-sm font-medium text-text-primary">
            {currentTab?.label || 'General'}
          </span>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          </Button>
        </div>
      </div>

      {/* Messages */}
      {error && (
        <div className="max-w-6xl mx-auto px-4 md:px-6 py-2">
          <div className="bg-accent-error/10 border border-accent-error/20 rounded-md px-4 py-2 text-accent-error text-sm">
            {error}
          </div>
        </div>
      )}
      {successMessage && (
        <div className="max-w-6xl mx-auto px-4 md:px-6 py-2">
          <div className="bg-accent-success/10 border border-accent-success/20 rounded-md px-4 py-2 text-accent-success text-sm flex items-center gap-2">
            <Check className="w-4 h-4" />
            {successMessage}
          </div>
        </div>
      )}

      {/* Mobile Tab List - shown when no tab is selected on mobile */}
      <div className={cn('md:hidden', activeTab !== null && 'hidden')}>
        <nav className="p-2">
          <ul className="space-y-1">
            {tabs.map((tab) => (
              <li key={tab.id}>
                <button
                  onClick={() => setActiveTab(tab.id)}
                  className="w-full flex items-center justify-between px-4 py-3 rounded-lg text-sm transition-colors text-text-secondary hover:text-text-primary hover:bg-overlay"
                >
                  <div className="flex items-center gap-3">
                    {tab.icon}
                    <span className="text-base">{tab.label}</span>
                  </div>
                  <ChevronRight className="h-5 w-5 text-text-muted" />
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      {/* Content */}
      <div
        className={cn(
          'max-w-6xl mx-auto px-4 md:px-6 py-4 md:py-8',
          // On mobile, hide content area when showing tab list
          activeTab === null && 'hidden md:block'
        )}
      >
        <div className="flex gap-8">
          {/* Desktop Sidebar - hidden on mobile */}
          <nav className="hidden md:block w-56 flex-shrink-0">
            <ul className="space-y-1">
              {tabs.map((tab) => (
                <li key={tab.id}>
                  <button
                    onClick={() => setActiveTab(tab.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                      effectiveTab === tab.id
                        ? 'bg-accent-primary/10 text-accent-primary'
                        : 'text-text-secondary hover:text-text-primary hover:bg-overlay'
                    }`}
                  >
                    {tab.icon}
                    {tab.label}
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          {/* Main Content */}
          <div className="flex-1 max-w-2xl">
            {/* General Tab */}
            {effectiveTab === 'general' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-lg font-medium text-text-primary mb-1">General Settings</h2>
                  <p className="text-sm text-text-secondary">
                    Configure your default preferences for new pods.
                  </p>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-text-primary mb-1">
                      Default Pod Template
                    </label>
                    <select
                      value={formData.default_template_id || ''}
                      onChange={(e) =>
                        updateFormData('default_template_id', e.target.value || null)
                      }
                      className="w-full bg-surface border border-border-default rounded-md px-3 py-2 text-sm text-text-primary"
                    >
                      <option value="">None (choose each time)</option>
                      {templates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} {t.is_official && '(Official)'}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-text-muted mt-1">
                      Pre-select a template when creating new pods
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-text-primary mb-1">
                      Default Editor
                    </label>
                    <select
                      value={formData.default_editor || 'vscode'}
                      onChange={(e) => updateFormData('default_editor', e.target.value)}
                      className="w-full bg-surface border border-border-default rounded-md px-3 py-2 text-sm text-text-primary"
                    >
                      {editorOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Onboarding Tutorial */}
                  <div className="pt-4 border-t border-border-subtle">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-text-primary">Workspace Tutorial</p>
                        <p className="text-xs text-text-muted">
                          Re-watch the workspace tour to learn about features
                        </p>
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={handleResetTutorial}
                        disabled={tutorialReset}
                      >
                        {tutorialReset ? (
                          <>
                            <Check className="w-4 h-4 mr-1" />
                            Reset
                          </>
                        ) : (
                          <>
                            <RotateCcw className="w-4 h-4 mr-1" />
                            Restart Tutorial
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Dotfiles Tab */}
            {effectiveTab === 'dotfiles' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-lg font-medium text-text-primary mb-1">Shell & Dotfiles</h2>
                  <p className="text-sm text-text-secondary">
                    Configure your shell and sync dotfiles across pods.
                  </p>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-text-primary mb-1">
                      Default Shell
                    </label>
                    <select
                      value={formData.default_shell || 'zsh'}
                      onChange={(e) => updateFormData('default_shell', e.target.value)}
                      className="w-full bg-surface border border-border-default rounded-md px-3 py-2 text-sm text-text-primary"
                    >
                      {shellOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-text-primary">Sync Dotfiles</p>
                      <p className="text-xs text-text-muted">
                        Automatically sync shell configs between pods
                      </p>
                    </div>
                    <button
                      onClick={() => updateFormData('sync_dotfiles', !formData.sync_dotfiles)}
                      className={`relative w-11 h-6 rounded-full transition-colors ${
                        formData.sync_dotfiles ? 'bg-accent-primary' : 'bg-overlay'
                      }`}
                    >
                      <span
                        className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${
                          formData.sync_dotfiles ? 'left-6' : 'left-1'
                        }`}
                      />
                    </button>
                  </div>

                  {formData.sync_dotfiles && (
                    <>
                      <div>
                        <label className="block text-sm font-medium text-text-primary mb-1">
                          Dotfiles Repository (Optional)
                        </label>
                        <Input
                          value={formData.dotfiles_repo || ''}
                          onChange={(e) => updateFormData('dotfiles_repo', e.target.value || null)}
                          placeholder="https://github.com/username/dotfiles"
                        />
                        <p className="text-xs text-text-muted mt-1">
                          Clone dotfiles from a git repository on pod startup
                        </p>
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <label className="text-sm font-medium text-text-primary">
                            Files to Sync
                          </label>
                          <Button variant="ghost" size="sm" onClick={addDotfilePath}>
                            <Plus className="w-4 h-4 mr-1" />
                            Add
                          </Button>
                        </div>
                        <div className="space-y-2">
                          {(formData.dotfiles_paths || []).map((path, index) => (
                            <div key={index} className="flex gap-2">
                              <Input
                                value={path}
                                onChange={(e) => updateDotfilePath(index, e.target.value)}
                                placeholder=".bashrc"
                                className="flex-1"
                              />
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => removeDotfilePath(index)}
                              >
                                <Trash2 className="w-4 h-4 text-accent-error" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Git Tab */}
            {effectiveTab === 'git' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-lg font-medium text-text-primary mb-1">Git Configuration</h2>
                  <p className="text-sm text-text-secondary">
                    Set your git identity for commits in pods.
                  </p>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-text-primary mb-1">Name</label>
                    <Input
                      value={formData.git_name || ''}
                      onChange={(e) => updateFormData('git_name', e.target.value || null)}
                      placeholder="Your Name"
                    />
                    <p className="text-xs text-text-muted mt-1">Used for git commit author</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-text-primary mb-1">
                      Email
                    </label>
                    <Input
                      value={formData.git_email || ''}
                      onChange={(e) => updateFormData('git_email', e.target.value || null)}
                      placeholder="you@example.com"
                    />
                    <p className="text-xs text-text-muted mt-1">Used for git commit author email</p>
                  </div>
                </div>
              </div>
            )}

            {/* Appearance Tab */}
            {effectiveTab === 'appearance' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-lg font-medium text-text-primary mb-1">Appearance</h2>
                  <p className="text-sm text-text-secondary">Customize the look and feel.</p>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-text-primary mb-1">
                      Theme
                    </label>
                    <select
                      value={formData.theme || 'dark'}
                      onChange={(e) => updateFormData('theme', e.target.value)}
                      className="w-full bg-surface border border-border-default rounded-md px-3 py-2 text-sm text-text-primary"
                    >
                      {themeOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-text-primary mb-1">
                      Editor Theme
                    </label>
                    <select
                      value={formData.editor_theme || 'vs-dark'}
                      onChange={(e) => updateFormData('editor_theme', e.target.value)}
                      className="w-full bg-surface border border-border-default rounded-md px-3 py-2 text-sm text-text-primary"
                    >
                      {editorThemeOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* Templates Tab */}
            {effectiveTab === 'templates' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-lg font-medium text-text-primary mb-1">Pod Templates</h2>
                  <p className="text-sm text-text-secondary">
                    Browse and manage pod templates for quick setup.
                  </p>
                </div>

                <div className="space-y-3">
                  {templates.map((template) => (
                    <div
                      key={template.id}
                      className="bg-surface border border-border-default rounded-lg p-4"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-start gap-3">
                          <div className="w-10 h-10 bg-overlay rounded-md flex items-center justify-center">
                            <TemplateIcon icon={template.icon} iconUrl={template.icon_url} />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h3 className="font-medium text-text-primary">{template.name}</h3>
                              {template.is_official && (
                                <span className="text-xs bg-accent-primary/20 text-accent-primary px-2 py-0.5 rounded">
                                  Official
                                </span>
                              )}
                            </div>
                            <p className="text-sm text-text-secondary mt-0.5">
                              {template.description}
                            </p>
                            {template.language_versions &&
                              Object.keys(template.language_versions).length > 0 && (
                                <div className="flex gap-2 mt-2">
                                  {Object.entries(template.language_versions).map(([lang, ver]) => (
                                    <span
                                      key={lang}
                                      className="text-xs bg-overlay px-2 py-1 rounded text-text-muted"
                                    >
                                      {lang} {ver}
                                    </span>
                                  ))}
                                </div>
                              )}
                          </div>
                        </div>
                        <div className="text-xs text-text-muted">{template.usage_count} uses</div>
                      </div>
                    </div>
                  ))}
                </div>

                <Button variant="secondary" className="w-full">
                  <Plus className="w-4 h-4 mr-2" />
                  Create Custom Template
                </Button>
              </div>
            )}

            {/* External Agents Tab */}
            {effectiveTab === 'external-agents' && <ExternalAgentSettings />}
          </div>
        </div>
      </div>
    </div>
  );
}
