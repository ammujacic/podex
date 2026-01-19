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
 * Only removes prefixes that leave recognizable names (e.g., "Claude Sonnet" → "Sonnet").
 * Keeps prefixes where removal would be confusing (e.g., "Llama 3.1" stays as is).
 * Normalizes Claude model names to "{Variant} {Version}" format (e.g., "Haiku 3.5" not "3.5 Haiku").
 *
 * @param displayName - Full model display name
 * @returns Shortened name for UI display
 */
export function createShortModelName(displayName: string): string {
  const name = displayName.replace(' (Direct)', '');

  // Handle Claude models - normalize to "{Variant} {Version}" format
  // Matches: "Claude 3.5 Haiku", "Claude Haiku 3.5", "Claude Sonnet 4", etc.
  const claudeMatch = name.match(/^Claude\s+([\d.]+)?\s*(Opus|Sonnet|Haiku)\s*([\d.]+)?$/i);
  if (claudeMatch && claudeMatch[2]) {
    const version = claudeMatch[1] || claudeMatch[3] || '';
    const variant = claudeMatch[2];
    const capitalizedVariant = variant.charAt(0).toUpperCase() + variant.slice(1).toLowerCase();
    return version ? `${capitalizedVariant} ${version}` : capitalizedVariant;
  }

  // For non-Claude models, just strip "Claude " if present
  return name.replace('Claude ', '');
}

/**
 * Parse a raw model ID into a user-friendly display name.
 * Handles various provider formats:
 * - Google Vertex: claude-3-5-sonnet@20240620
 * - OpenAI: gpt-4o-2024-08-06
 * - Standard: claude-3-5-sonnet-latest
 *
 * @param modelId - Raw model identifier
 * @returns User-friendly display name
 */
export function parseModelIdToDisplayName(modelId: string): string {
  let name = modelId;

  // Remove provider prefixes (anthropic., google., openai., etc.)
  name = name.replace(/^(anthropic|google|openai|meta|mistral)\./i, '');

  // Remove version suffixes
  // AWS Bedrock: -v1:0, -v2:0, etc.
  name = name.replace(/-v\d+:\d+$/, '');
  // Google Vertex: @20240620
  name = name.replace(/@\d{8}$/, '');
  // Date suffixes: -20250929, -2024-08-06
  name = name.replace(/-\d{8}$/, '');
  name = name.replace(/-\d{4}-\d{2}-\d{2}$/, '');
  // Remove -latest suffix
  name = name.replace(/-latest$/, '');

  // Claude models: claude-sonnet-4-5, claude-3-5-sonnet, etc.
  const claudeMatch = name.match(/claude-?([\d.-]*)?-?(opus|sonnet|haiku)-?([\d.-]*)?/i);
  if (claudeMatch && claudeMatch[2]) {
    const variant = claudeMatch[2];
    const version = claudeMatch[1] || claudeMatch[3] || '';
    const formattedVersion = version.replace(/-/g, '.');
    const capitalizedVariant = variant.charAt(0).toUpperCase() + variant.slice(1).toLowerCase();
    return formattedVersion ? `${capitalizedVariant} ${formattedVersion}` : capitalizedVariant;
  }

  // GPT models: gpt-4o, gpt-4o-mini, gpt-4-turbo
  const gptMatch = name.match(/gpt-?([\d.]+o?)-?(mini|turbo)?/i);
  if (gptMatch) {
    const version = gptMatch[1];
    const variant = gptMatch[2];
    const base = `GPT-${version}`;
    return variant ? `${base} ${variant.charAt(0).toUpperCase() + variant.slice(1)}` : base;
  }

  // o1/o3 models: o1, o1-mini, o3-mini
  const oMatch = name.match(/^o(\d+)-?(mini|preview)?$/i);
  if (oMatch) {
    const version = oMatch[1];
    const variant = oMatch[2];
    return variant
      ? `o${version} ${variant.charAt(0).toUpperCase() + variant.slice(1)}`
      : `o${version}`;
  }

  // Gemini models: gemini-2.0-flash, gemini-1.5-pro
  const geminiMatch = name.match(/gemini-?([\d.]+)-?(pro|flash|ultra)?/i);
  if (geminiMatch) {
    const version = geminiMatch[1];
    const variant = geminiMatch[2];
    const base = `Gemini ${version}`;
    return variant ? `${base} ${variant.charAt(0).toUpperCase() + variant.slice(1)}` : base;
  }

  // Llama models: llama-3.1-70b-instruct
  const llamaMatch = name.match(/llama-?([\d.]+)/i);
  if (llamaMatch) {
    const version = llamaMatch[1];
    return `Llama ${version}`;
  }

  // Fallback: clean up and title case
  return name
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
