/**
 * Extensions module for Open VSX marketplace integration.
 *
 * The custom extension host has been replaced by @codingame/monaco-vscode-api
 * which provides full VS Code extension API compatibility.
 */

// Extension Types
export type {
  ExtensionCategory,
  ExtensionScope,
  ExtensionSortOption,
  ExtensionCategoryOption,
} from './types';

export { EXTENSION_SORT_OPTIONS, EXTENSION_CATEGORY_OPTIONS } from './types';

// Re-export API client types and functions
export {
  // Types
  type OpenVSXExtension,
  type ExtensionSearchResult,
  type ExtensionDetail,
  type InstalledExtension,
  type InstallExtensionRequest,
  type ExtensionSearchParams,
  // API functions
  searchExtensions,
  getExtensionDetail,
  getExtensionDownloadUrl,
  getInstalledExtensions,
  installExtension,
  uninstallExtension,
  toggleExtension,
  updateExtensionSettings,
  // Helper functions
  parseExtensionId,
  createExtensionId,
  getExtensionDisplayName,
  formatDownloadCount,
  formatRating,
} from '@/lib/api/extensions';
