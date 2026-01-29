/**
 * Shared types for the Model Selector component
 */

import type { PublicModel, ModelCapabilities } from '@/lib/api';

/**
 * Model category for filtering
 */
export type ModelCategory = 'fast' | 'reasoning' | 'code' | 'vision' | 'large_context' | 'budget';

/**
 * Extended model interface with additional display/filter properties
 */
export interface LLMModel extends PublicModel {
  /** Whether this model is featured (shown by default) */
  is_featured?: boolean;
  /** Display order for sorting */
  display_order?: number;
  /** Categories for filtering */
  categories?: ModelCategory[];
  /** Short description for display */
  short_description?: string;
}

/**
 * Local model discovered from Ollama
 */
export interface LocalModel {
  /** Unique identifier (e.g., "llama2:7b") */
  id: string;
  /** Display name */
  name: string;
  /** Model size in bytes */
  size: string;
  /** Quantization level (e.g., "Q4_0", "Q8_0") */
  quantization?: string;
  /** Last modified timestamp */
  modifiedAt: Date;
}

/**
 * Raw Ollama API response model
 */
export interface OllamaModel {
  name: string;
  model: string;
  modified_at: string;
  size: number;
  digest: string;
  details?: {
    parent_model?: string;
    format?: string;
    family?: string;
    families?: string[];
    parameter_size?: string;
    quantization_level?: string;
  };
}

/**
 * Raw Ollama API tags response
 */
export interface OllamaTagsResponse {
  models: OllamaModel[];
}

/**
 * Model tab types for the selector
 */
export type ModelTab = 'podex' | 'your-keys' | 'local';

/**
 * Category metadata for display
 */
export interface CategoryInfo {
  id: ModelCategory;
  label: string;
  icon: string;
  description: string;
}

/**
 * Category metadata mapping
 */
export const MODEL_CATEGORIES: CategoryInfo[] = [
  { id: 'fast', label: 'Fast', icon: '\u26A1', description: 'Low latency, quick responses' },
  {
    id: 'reasoning',
    label: 'Reasoning',
    icon: '\uD83E\uDDE0',
    description: 'Complex analysis, chain-of-thought',
  },
  {
    id: 'code',
    label: 'Code',
    icon: '\uD83D\uDCBB',
    description: 'Programming, debugging, code generation',
  },
  {
    id: 'vision',
    label: 'Vision',
    icon: '\uD83D\uDC41\uFE0F',
    description: 'Image understanding, multimodal',
  },
  {
    id: 'large_context',
    label: 'Large Context',
    icon: '\uD83D\uDCDA',
    description: '100K+ token windows',
  },
  {
    id: 'budget',
    label: 'Budget',
    icon: '\uD83D\uDCB0',
    description: 'Cost-effective for high volume',
  },
];

/**
 * Re-export commonly used types from api.ts
 */
export type { PublicModel, ModelCapabilities };
