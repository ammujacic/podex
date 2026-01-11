'use client';

import { useState, useCallback, useMemo } from 'react';
import {
  Search,
  X,
  Download,
  Check,
  Trash2,
  Power,
  PowerOff,
  Star,
  Box,
  AlertCircle,
  ExternalLink,
  ChevronRight,
  Puzzle,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useExtensionHost } from '@/lib/extensions/ExtensionHost';
import type { ExtensionManifest, ExtensionInfo, ExtensionCategory } from '@/lib/extensions/types';

// ============================================================================
// Types
// ============================================================================

interface MarketplaceExtension {
  manifest: ExtensionManifest;
  downloads: number;
  rating: number;
  ratingCount: number;
  lastUpdated: string;
  verified: boolean;
}

type TabType = 'marketplace' | 'installed';
type SortType = 'relevance' | 'downloads' | 'rating' | 'recent';

// ============================================================================
// Mock Marketplace Data
// ============================================================================

const MOCK_EXTENSIONS: MarketplaceExtension[] = [
  {
    manifest: {
      id: 'podex.prettier',
      name: 'prettier',
      displayName: 'Prettier - Code Formatter',
      version: '10.1.0',
      description: 'Code formatter using prettier',
      author: 'Podex Team',
      publisher: 'podex',
      license: 'MIT',
      icon: '✨',
      main: 'dist/extension.js',
      categories: ['formatters'],
      keywords: ['format', 'prettier', 'beautify'],
      engines: { podex: '^1.0.0' },
      activationEvents: ['onLanguage:javascript', 'onLanguage:typescript'],
      contributes: {
        commands: [{ command: 'prettier.format', title: 'Format Document with Prettier' }],
      },
      permissions: ['filesystem.read', 'filesystem.write'],
    },
    downloads: 1250000,
    rating: 4.8,
    ratingCount: 15420,
    lastUpdated: '2024-01-05',
    verified: true,
  },
  {
    manifest: {
      id: 'podex.eslint',
      name: 'eslint',
      displayName: 'ESLint',
      version: '2.4.4',
      description: 'Integrates ESLint JavaScript into Podex',
      author: 'Podex Team',
      publisher: 'podex',
      license: 'MIT',
      icon: '🔍',
      main: 'dist/extension.js',
      categories: ['linters'],
      keywords: ['lint', 'eslint', 'javascript'],
      engines: { podex: '^1.0.0' },
      activationEvents: ['onLanguage:javascript', 'onLanguage:typescript'],
      contributes: {
        commands: [{ command: 'eslint.fix', title: 'Fix all auto-fixable Problems' }],
      },
      permissions: ['filesystem.read', 'editor.decorations'],
    },
    downloads: 980000,
    rating: 4.7,
    ratingCount: 12350,
    lastUpdated: '2024-01-03',
    verified: true,
  },
  {
    manifest: {
      id: 'podex.git-lens',
      name: 'gitlens',
      displayName: 'GitLens — Git supercharged',
      version: '14.5.0',
      description: 'Supercharge Git with rich visualizations and insights',
      author: 'GitKraken',
      publisher: 'eamodio',
      license: 'MIT',
      icon: '🔀',
      main: 'dist/extension.js',
      categories: ['productivity'],
      keywords: ['git', 'blame', 'history', 'annotations'],
      engines: { podex: '^1.0.0' },
      activationEvents: ['*'],
      contributes: {
        views: [{ id: 'gitlens.views.commits', name: 'Commits' }],
      },
      permissions: ['filesystem.read', 'terminal.execute'],
    },
    downloads: 750000,
    rating: 4.9,
    ratingCount: 9870,
    lastUpdated: '2024-01-02',
    verified: true,
  },
  {
    manifest: {
      id: 'podex.python',
      name: 'python',
      displayName: 'Python',
      version: '2024.0.1',
      description: 'IntelliSense, linting, debugging, and more for Python',
      author: 'Podex Team',
      publisher: 'podex',
      license: 'MIT',
      icon: '🐍',
      main: 'dist/extension.js',
      categories: ['languages'],
      keywords: ['python', 'pylance', 'pyright'],
      engines: { podex: '^1.0.0' },
      activationEvents: ['onLanguage:python'],
      contributes: {
        languages: [{ id: 'python', extensions: ['.py', '.pyw'] }],
      },
      permissions: ['filesystem.read', 'terminal.execute'],
    },
    downloads: 650000,
    rating: 4.6,
    ratingCount: 8540,
    lastUpdated: '2024-01-04',
    verified: true,
  },
  {
    manifest: {
      id: 'podex.copilot',
      name: 'copilot',
      displayName: 'GitHub Copilot',
      version: '1.150.0',
      description: 'AI pair programmer',
      author: 'GitHub',
      publisher: 'github',
      license: 'Proprietary',
      icon: '🤖',
      main: 'dist/extension.js',
      categories: ['productivity'],
      keywords: ['ai', 'copilot', 'autocomplete', 'intellisense'],
      engines: { podex: '^1.0.0' },
      activationEvents: ['*'],
      contributes: {},
      permissions: ['network', 'editor.decorations'],
    },
    downloads: 2100000,
    rating: 4.5,
    ratingCount: 25600,
    lastUpdated: '2024-01-06',
    verified: true,
  },
  {
    manifest: {
      id: 'dracula.theme',
      name: 'dracula',
      displayName: 'Dracula Theme',
      version: '2.24.3',
      description: 'A dark theme for Podex',
      author: 'Dracula Theme',
      publisher: 'dracula-theme',
      license: 'MIT',
      icon: '🧛',
      main: 'dist/extension.js',
      categories: ['themes'],
      keywords: ['theme', 'dark', 'dracula'],
      engines: { podex: '^1.0.0' },
      activationEvents: ['*'],
      contributes: {
        themes: [
          { id: 'dracula', label: 'Dracula', uiTheme: 'vs-dark', path: './themes/dracula.json' },
        ],
      },
      permissions: [],
    },
    downloads: 890000,
    rating: 4.9,
    ratingCount: 11200,
    lastUpdated: '2023-12-15',
    verified: true,
  },
];

// ============================================================================
// Extension Card Component
// ============================================================================

interface ExtensionCardProps {
  extension: MarketplaceExtension;
  installedInfo?: ExtensionInfo;
  onInstall: (manifest: ExtensionManifest) => void;
  onUninstall: (extensionId: string) => void;
  onEnable: (extensionId: string) => void;
  onDisable: (extensionId: string) => void;
  onClick: () => void;
}

function ExtensionCard({
  extension,
  installedInfo,
  onInstall,
  onUninstall,
  onEnable,
  onDisable,
  onClick,
}: ExtensionCardProps) {
  const { manifest, downloads, rating, ratingCount, verified } = extension;
  const isInstalled = !!installedInfo;
  const isEnabled = installedInfo?.state === 'enabled' || installedInfo?.state === 'active';
  const hasError = installedInfo?.state === 'error';
  void isEnabled; // Used for styling

  const formatDownloads = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(0)}K`;
    return num.toString();
  };

  return (
    <div
      className="group flex cursor-pointer gap-3 rounded-lg border border-border-subtle bg-surface p-4 transition-colors hover:border-border-default"
      onClick={onClick}
    >
      {/* Icon */}
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-overlay text-2xl">
        {manifest.icon || <Puzzle className="h-6 w-6 text-text-muted" />}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium text-text-primary truncate">{manifest.displayName}</h3>
          {verified && (
            <Check className="h-3.5 w-3.5 text-accent-success" aria-label="Verified publisher" />
          )}
          {hasError && (
            <AlertCircle
              className="h-3.5 w-3.5 text-accent-error"
              aria-label={installedInfo?.error ?? 'Error'}
            />
          )}
        </div>

        <p className="mt-0.5 text-xs text-text-secondary truncate">{manifest.description}</p>

        <div className="mt-2 flex items-center gap-3 text-xs text-text-muted">
          <span>{manifest.publisher}</span>
          <span className="flex items-center gap-1">
            <Star className="h-3 w-3 text-accent-warning" />
            {rating.toFixed(1)} ({formatDownloads(ratingCount)})
          </span>
          <span className="flex items-center gap-1">
            <Download className="h-3 w-3" />
            {formatDownloads(downloads)}
          </span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-2" onClick={(e) => e.stopPropagation()}>
        {!isInstalled ? (
          <button
            onClick={() => onInstall(manifest)}
            className="rounded bg-accent-primary px-3 py-1.5 text-xs font-medium text-text-inverse hover:bg-accent-primary/90"
          >
            Install
          </button>
        ) : (
          <>
            {isEnabled ? (
              <button
                onClick={() => onDisable(manifest.id)}
                className="rounded p-1.5 text-text-muted hover:bg-overlay hover:text-text-secondary"
                title="Disable"
              >
                <PowerOff className="h-4 w-4" />
              </button>
            ) : (
              <button
                onClick={() => onEnable(manifest.id)}
                className="rounded p-1.5 text-text-muted hover:bg-overlay hover:text-accent-success"
                title="Enable"
              >
                <Power className="h-4 w-4" />
              </button>
            )}
            <button
              onClick={() => onUninstall(manifest.id)}
              className="rounded p-1.5 text-text-muted hover:bg-overlay hover:text-accent-error"
              title="Uninstall"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Extension Detail Panel
// ============================================================================

interface ExtensionDetailProps {
  extension: MarketplaceExtension;
  installedInfo?: ExtensionInfo;
  onClose: () => void;
  onInstall: (manifest: ExtensionManifest) => void;
  onUninstall: (extensionId: string) => void;
  onEnable: (extensionId: string) => void;
  onDisable: (extensionId: string) => void;
}

function ExtensionDetail({
  extension,
  installedInfo,
  onClose,
  onInstall,
  onUninstall,
  onEnable,
  onDisable,
}: ExtensionDetailProps) {
  const { manifest, downloads, rating, ratingCount, lastUpdated, verified } = extension;
  const isInstalled = !!installedInfo;
  const isEnabled = installedInfo?.state === 'enabled' || installedInfo?.state === 'active';

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className="flex h-full w-96 flex-col border-l border-border-default bg-elevated"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
        <h2 className="text-sm font-medium text-text-primary">Extension Details</h2>
        <button
          onClick={onClose}
          className="rounded p-1 text-text-muted hover:bg-overlay hover:text-text-secondary"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Hero */}
        <div className="p-6">
          <div className="flex items-start gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-overlay text-3xl">
              {manifest.icon || <Puzzle className="h-8 w-8 text-text-muted" />}
            </div>
            <div>
              <h3 className="text-lg font-semibold text-text-primary">{manifest.displayName}</h3>
              <p className="text-sm text-text-secondary">
                {manifest.publisher}
                {verified && <Check className="ml-1 inline h-4 w-4 text-accent-success" />}
              </p>
              <p className="mt-1 text-xs text-text-muted">v{manifest.version}</p>
            </div>
          </div>

          {/* Stats */}
          <div className="mt-4 flex gap-6 text-sm">
            <div>
              <div className="flex items-center gap-1 text-text-primary">
                <Star className="h-4 w-4 text-accent-warning" />
                {rating.toFixed(1)}
              </div>
              <div className="text-xs text-text-muted">{ratingCount.toLocaleString()} ratings</div>
            </div>
            <div>
              <div className="flex items-center gap-1 text-text-primary">
                <Download className="h-4 w-4" />
                {downloads.toLocaleString()}
              </div>
              <div className="text-xs text-text-muted">downloads</div>
            </div>
          </div>

          {/* Actions */}
          <div className="mt-4 flex gap-2">
            {!isInstalled ? (
              <button
                onClick={() => onInstall(manifest)}
                className="flex-1 rounded bg-accent-primary py-2 text-sm font-medium text-text-inverse hover:bg-accent-primary/90"
              >
                Install
              </button>
            ) : (
              <>
                {isEnabled ? (
                  <button
                    onClick={() => onDisable(manifest.id)}
                    className="flex-1 rounded border border-border-default py-2 text-sm text-text-secondary hover:bg-overlay"
                  >
                    Disable
                  </button>
                ) : (
                  <button
                    onClick={() => onEnable(manifest.id)}
                    className="flex-1 rounded bg-accent-primary py-2 text-sm font-medium text-text-inverse hover:bg-accent-primary/90"
                  >
                    Enable
                  </button>
                )}
                <button
                  onClick={() => onUninstall(manifest.id)}
                  className="rounded border border-accent-error/50 px-4 py-2 text-sm text-accent-error hover:bg-accent-error/10"
                >
                  Uninstall
                </button>
              </>
            )}
          </div>
        </div>

        {/* Description */}
        <div className="border-t border-border-subtle px-6 py-4">
          <h4 className="mb-2 text-sm font-medium text-text-primary">Description</h4>
          <p className="text-sm text-text-secondary">{manifest.description}</p>
        </div>

        {/* Categories */}
        <div className="border-t border-border-subtle px-6 py-4">
          <h4 className="mb-2 text-sm font-medium text-text-primary">Categories</h4>
          <div className="flex flex-wrap gap-2">
            {manifest.categories.map((cat) => (
              <span
                key={cat}
                className="rounded-full bg-overlay px-3 py-1 text-xs text-text-secondary"
              >
                {cat}
              </span>
            ))}
          </div>
        </div>

        {/* Permissions */}
        {manifest.permissions.length > 0 && (
          <div className="border-t border-border-subtle px-6 py-4">
            <h4 className="mb-2 text-sm font-medium text-text-primary">Permissions</h4>
            <ul className="space-y-1">
              {manifest.permissions.map((perm) => (
                <li key={perm} className="flex items-center gap-2 text-xs text-text-secondary">
                  <ChevronRight className="h-3 w-3 text-text-muted" />
                  {perm}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* More Info */}
        <div className="border-t border-border-subtle px-6 py-4">
          <h4 className="mb-2 text-sm font-medium text-text-primary">More Info</h4>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-text-muted">Last updated</span>
              <span className="text-text-secondary">{lastUpdated}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">License</span>
              <span className="text-text-secondary">{manifest.license}</span>
            </div>
            {manifest.repository && (
              <div className="flex justify-between">
                <span className="text-text-muted">Repository</span>
                <a
                  href={manifest.repository}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-accent-primary hover:underline"
                >
                  GitHub <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ============================================================================
// Main Marketplace Component
// ============================================================================

interface ExtensionMarketplaceProps {
  onClose?: () => void;
  className?: string;
}

export function ExtensionMarketplace({ onClose, className }: ExtensionMarketplaceProps) {
  const {
    extensions: installedExtensions,
    installExtension,
    uninstallExtension,
    enableExtension,
    disableExtension,
  } = useExtensionHost();

  const [tab, setTab] = useState<TabType>('marketplace');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortType>('relevance');
  const [categoryFilter, setCategoryFilter] = useState<ExtensionCategory | 'all'>('all');
  const [selectedExtension, setSelectedExtension] = useState<MarketplaceExtension | null>(null);
  const [_installing, setInstalling] = useState<string | null>(null);

  // Create installed map for quick lookup
  const installedMap = useMemo(() => {
    const map = new Map<string, ExtensionInfo>();
    installedExtensions.forEach((ext) => map.set(ext.manifest.id, ext));
    return map;
  }, [installedExtensions]);

  // Filter and sort marketplace extensions
  const filteredExtensions = useMemo(() => {
    let filtered =
      tab === 'installed'
        ? installedExtensions.map(
            (info) =>
              MOCK_EXTENSIONS.find((e) => e.manifest.id === info.manifest.id) || {
                manifest: info.manifest,
                downloads: 0,
                rating: 0,
                ratingCount: 0,
                lastUpdated: '',
                verified: false,
              }
          )
        : MOCK_EXTENSIONS;

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (ext) =>
          ext.manifest.displayName.toLowerCase().includes(query) ||
          ext.manifest.description.toLowerCase().includes(query) ||
          ext.manifest.keywords.some((k) => k.toLowerCase().includes(query))
      );
    }

    // Apply category filter
    if (categoryFilter !== 'all') {
      filtered = filtered.filter((ext) => ext.manifest.categories.includes(categoryFilter));
    }

    // Apply sorting
    switch (sortBy) {
      case 'downloads':
        filtered = [...filtered].sort((a, b) => b.downloads - a.downloads);
        break;
      case 'rating':
        filtered = [...filtered].sort((a, b) => b.rating - a.rating);
        break;
      case 'recent':
        filtered = [...filtered].sort(
          (a, b) => new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime()
        );
        break;
      default:
        // relevance - keep original order for now
        break;
    }

    return filtered;
  }, [tab, searchQuery, sortBy, categoryFilter, installedExtensions]);

  // Handlers
  const handleInstall = useCallback(
    async (manifest: ExtensionManifest) => {
      setInstalling(manifest.id);
      try {
        // In a real implementation, we'd fetch the extension code from a server
        const mockCode = `
          return {
            activate: function(context) {
              console.log('Extension ${manifest.displayName} activated');
              return {};
            },
            deactivate: function() {
              console.log('Extension ${manifest.displayName} deactivated');
            }
          };
        `;
        await installExtension(manifest, mockCode);
      } finally {
        setInstalling(null);
      }
    },
    [installExtension]
  );

  const handleUninstall = useCallback(
    async (extensionId: string) => {
      await uninstallExtension(extensionId);
      if (selectedExtension?.manifest.id === extensionId) {
        setSelectedExtension(null);
      }
    },
    [uninstallExtension, selectedExtension]
  );

  const categories: { value: ExtensionCategory | 'all'; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'themes', label: 'Themes' },
    { value: 'languages', label: 'Languages' },
    { value: 'linters', label: 'Linters' },
    { value: 'formatters', label: 'Formatters' },
    { value: 'productivity', label: 'Productivity' },
    { value: 'snippets', label: 'Snippets' },
    { value: 'other', label: 'Other' },
  ];

  return (
    <div className={cn('flex h-full bg-elevated', className)}>
      {/* Main Panel */}
      <div className="flex flex-1 flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border-default px-4 py-3">
          <div className="flex items-center gap-2">
            <Box className="h-5 w-5 text-accent-primary" />
            <h1 className="text-sm font-medium text-text-primary">Extensions</h1>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="rounded p-1 text-text-muted hover:bg-overlay hover:text-text-secondary"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border-subtle px-4">
          <button
            onClick={() => setTab('marketplace')}
            className={cn(
              'border-b-2 px-4 py-2 text-sm',
              tab === 'marketplace'
                ? 'border-accent-primary text-accent-primary'
                : 'border-transparent text-text-muted hover:text-text-secondary'
            )}
          >
            Marketplace
          </button>
          <button
            onClick={() => setTab('installed')}
            className={cn(
              'border-b-2 px-4 py-2 text-sm',
              tab === 'installed'
                ? 'border-accent-primary text-accent-primary'
                : 'border-transparent text-text-muted hover:text-text-secondary'
            )}
          >
            Installed ({installedExtensions.length})
          </button>
        </div>

        {/* Search and Filters */}
        <div className="space-y-2 border-b border-border-subtle p-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search extensions..."
              className="w-full rounded-md border border-border-default bg-surface py-2 pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-primary focus:outline-none"
            />
          </div>

          {/* Filters */}
          <div className="flex items-center gap-2">
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value as ExtensionCategory | 'all')}
              className="rounded border border-border-default bg-surface px-2 py-1 text-xs text-text-secondary focus:outline-none"
            >
              {categories.map((cat) => (
                <option key={cat.value} value={cat.value}>
                  {cat.label}
                </option>
              ))}
            </select>

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortType)}
              className="rounded border border-border-default bg-surface px-2 py-1 text-xs text-text-secondary focus:outline-none"
            >
              <option value="relevance">Relevance</option>
              <option value="downloads">Most Downloads</option>
              <option value="rating">Highest Rated</option>
              <option value="recent">Recently Updated</option>
            </select>
          </div>
        </div>

        {/* Extension List */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="space-y-3">
            {filteredExtensions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Box className="h-12 w-12 text-text-muted" />
                <p className="mt-4 text-sm text-text-muted">
                  {searchQuery
                    ? 'No extensions found matching your search'
                    : tab === 'installed'
                      ? 'No extensions installed yet'
                      : 'No extensions available'}
                </p>
              </div>
            ) : (
              filteredExtensions.map((ext) => (
                <ExtensionCard
                  key={ext.manifest.id}
                  extension={ext}
                  installedInfo={installedMap.get(ext.manifest.id)}
                  onInstall={handleInstall}
                  onUninstall={handleUninstall}
                  onEnable={enableExtension}
                  onDisable={disableExtension}
                  onClick={() => setSelectedExtension(ext)}
                />
              ))
            )}
          </div>
        </div>
      </div>

      {/* Detail Panel */}
      <AnimatePresence>
        {selectedExtension && (
          <ExtensionDetail
            extension={selectedExtension}
            installedInfo={installedMap.get(selectedExtension.manifest.id)}
            onClose={() => setSelectedExtension(null)}
            onInstall={handleInstall}
            onUninstall={handleUninstall}
            onEnable={enableExtension}
            onDisable={disableExtension}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================================================
// Extension Icon Button (for sidebar)
// ============================================================================

interface ExtensionIconButtonProps {
  onClick: () => void;
  className?: string;
}

export function ExtensionIconButton({ onClick, className }: ExtensionIconButtonProps) {
  const { extensions } = useExtensionHost();
  const activeCount = extensions.filter((e) => e.state === 'active').length;

  return (
    <button
      onClick={onClick}
      className={cn(
        'relative flex h-10 w-10 items-center justify-center rounded-lg text-text-muted hover:bg-overlay hover:text-text-secondary',
        className
      )}
      title="Extensions"
    >
      <Box className="h-5 w-5" />
      {activeCount > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-accent-primary text-[10px] font-medium text-text-inverse">
          {activeCount}
        </span>
      )}
    </button>
  );
}
