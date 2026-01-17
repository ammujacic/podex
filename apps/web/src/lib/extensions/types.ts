/**
 * Extension types for Open VSX marketplace integration.
 *
 * Note: The custom extension host (ExtensionHost.ts, ExtensionApi.ts) has been
 * replaced by @codingame/monaco-vscode-api which provides full VS Code API compatibility.
 *
 * For installed extension types, see @/lib/api/extensions.ts
 */

// ============================================================================
// Extension Categories (aligned with Open VSX)
// ============================================================================

export type ExtensionCategory =
  | 'Programming Languages'
  | 'Themes'
  | 'Snippets'
  | 'Linters'
  | 'Formatters'
  | 'Debuggers'
  | 'Testing'
  | 'SCM Providers'
  | 'Other'
  | 'Extension Packs'
  | 'Language Packs'
  | 'Data Science'
  | 'Machine Learning'
  | 'Visualization'
  | 'Notebooks'
  | 'Education'
  | 'Keymaps';

// ============================================================================
// Extension Installation Scope
// ============================================================================

export type ExtensionScope = 'user' | 'workspace';

// ============================================================================
// UI Types
// ============================================================================

export interface ExtensionSortOption {
  value: 'relevance' | 'downloadCount' | 'rating' | 'timestamp';
  label: string;
}

export const EXTENSION_SORT_OPTIONS: ExtensionSortOption[] = [
  { value: 'relevance', label: 'Relevance' },
  { value: 'downloadCount', label: 'Most Downloads' },
  { value: 'rating', label: 'Highest Rated' },
  { value: 'timestamp', label: 'Recently Updated' },
];

export interface ExtensionCategoryOption {
  value: ExtensionCategory | 'all';
  label: string;
}

export const EXTENSION_CATEGORY_OPTIONS: ExtensionCategoryOption[] = [
  { value: 'all', label: 'All' },
  { value: 'Programming Languages', label: 'Languages' },
  { value: 'Themes', label: 'Themes' },
  { value: 'Linters', label: 'Linters' },
  { value: 'Formatters', label: 'Formatters' },
  { value: 'Debuggers', label: 'Debuggers' },
  { value: 'Snippets', label: 'Snippets' },
  { value: 'Other', label: 'Other' },
];
