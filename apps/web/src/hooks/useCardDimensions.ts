/**
 * Hook to get card dimensions from platform settings.
 *
 * Returns dimensions for draggable cards from the ConfigStore.
 * Config is guaranteed to be loaded by ConfigGate before these components render.
 */

import { useConfigStore } from '@/stores/config';
import type { CardDimensionConfig, CardDimensions } from '@/lib/api';

export type CardType = 'terminal' | 'editor' | 'agent' | 'preview';

/**
 * Get dimensions for a specific card type from platform settings.
 *
 * @param cardType - The type of card ('terminal', 'editor', 'agent', 'preview')
 * @returns Card dimensions (config is guaranteed to be loaded by ConfigGate)
 */
export function useCardDimensions(cardType: CardType): CardDimensionConfig {
  const allDimensions = useConfigStore((s) => s.getCardDimensions());

  if (!allDimensions) {
    throw new Error('ConfigStore not initialized - card_dimensions not available');
  }

  return allDimensions[cardType];
}

/**
 * Get all card dimensions from platform settings.
 *
 * @returns All card dimensions (config is guaranteed to be loaded by ConfigGate)
 */
export function useAllCardDimensions(): CardDimensions {
  const dimensions = useConfigStore((s) => s.getCardDimensions());
  if (!dimensions) {
    throw new Error('ConfigStore not initialized - card_dimensions not available');
  }
  return dimensions;
}
