/**
 * Utility functions for LLM model tier and capability mapping.
 */

export type ModelTier = 'flagship' | 'balanced' | 'fast';
export type ReasoningEffort = 'high' | 'medium' | 'low';

/**
 * Map a cost tier string to a display tier.
 *
 * @param costTier - Cost tier from backend (premium, high, medium, low, etc.)
 * @returns The display tier category
 */
export function mapCostTierToTier(costTier: string): ModelTier {
  return costTier === 'premium' || costTier === 'high'
    ? 'flagship'
    : costTier === 'medium'
      ? 'balanced'
      : 'fast';
}

/**
 * Map a cost tier string to a reasoning effort level.
 *
 * @param costTier - Cost tier from backend (premium, high, medium, low, etc.)
 * @returns The reasoning effort level
 */
export function mapCostTierToReasoningEffort(costTier: string): ReasoningEffort {
  return costTier === 'premium' || costTier === 'high'
    ? 'high'
    : costTier === 'medium'
      ? 'medium'
      : 'low';
}

/**
 * Create a short display name from a full model name.
 *
 * @param displayName - Full model display name
 * @returns Shortened name for UI display
 */
export function createShortModelName(displayName: string): string {
  return displayName.replace('Claude ', '').replace('Llama ', '').replace(' (Direct)', '');
}
