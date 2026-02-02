/**
 * Tests for model-utils (tier mapping, short names, parse model ID).
 */
import { describe, it, expect } from 'vitest';
import {
  mapCostTierToTier,
  mapCostTierToReasoningEffort,
  createShortModelName,
  parseModelIdToDisplayName,
} from '../model-utils';

describe('mapCostTierToTier', () => {
  it('maps premium and high to flagship', () => {
    expect(mapCostTierToTier('premium')).toBe('flagship');
    expect(mapCostTierToTier('high')).toBe('flagship');
  });

  it('maps medium to balanced', () => {
    expect(mapCostTierToTier('medium')).toBe('balanced');
  });

  it('maps low and others to fast', () => {
    expect(mapCostTierToTier('low')).toBe('fast');
    expect(mapCostTierToTier('budget')).toBe('fast');
    expect(mapCostTierToTier('')).toBe('fast');
  });
});

describe('mapCostTierToReasoningEffort', () => {
  it('maps premium and high to high', () => {
    expect(mapCostTierToReasoningEffort('premium')).toBe('high');
    expect(mapCostTierToReasoningEffort('high')).toBe('high');
  });

  it('maps medium to medium', () => {
    expect(mapCostTierToReasoningEffort('medium')).toBe('medium');
  });

  it('maps low and others to low', () => {
    expect(mapCostTierToReasoningEffort('low')).toBe('low');
    expect(mapCostTierToReasoningEffort('')).toBe('low');
  });
});

describe('createShortModelName', () => {
  it('strips (Direct) suffix', () => {
    expect(createShortModelName('Claude Sonnet 4 (Direct)')).toBe('Sonnet 4');
  });

  it('normalizes Claude 4.5 Haiku / Claude Haiku 4.5 to Variant Version', () => {
    expect(createShortModelName('Claude 4.5 Haiku')).toBe('Haiku 4.5');
    expect(createShortModelName('Claude Haiku 4.5')).toBe('Haiku 4.5');
    expect(createShortModelName('Claude Sonnet 4')).toBe('Sonnet 4');
    expect(createShortModelName('Claude Opus 4')).toBe('Opus 4');
  });

  it('returns only variant when no version', () => {
    expect(createShortModelName('Claude Haiku')).toBe('Haiku');
  });

  it('strips Claude prefix for non-Claude names', () => {
    expect(createShortModelName('GPT-4 Turbo')).toBe('GPT-4 Turbo');
    expect(createShortModelName('Claude Other')).toBe('Other');
  });
});

describe('parseModelIdToDisplayName', () => {
  it('removes provider prefixes', () => {
    expect(parseModelIdToDisplayName('anthropic.claude-3-5-sonnet')).toContain('Sonnet');
    expect(parseModelIdToDisplayName('openai.gpt-4o')).toContain('GPT');
    expect(parseModelIdToDisplayName('google.gemini-1.5-pro')).toContain('Gemini');
  });

  it('formats Claude model IDs', () => {
    expect(parseModelIdToDisplayName('claude-3-5-sonnet')).toMatch(/^Sonnet 3\.5\.?$/);
    expect(parseModelIdToDisplayName('claude-sonnet-4')).toBe('Sonnet 4');
    expect(parseModelIdToDisplayName('claude-opus-4')).toBe('Opus 4');
  });

  it('formats GPT model IDs', () => {
    expect(parseModelIdToDisplayName('gpt-4o')).toBe('GPT-4o');
    expect(parseModelIdToDisplayName('gpt-4o-mini')).toBe('GPT-4o Mini');
    expect(parseModelIdToDisplayName('gpt-4-turbo')).toContain('GPT');
  });

  it('formats o1/o3 models', () => {
    expect(parseModelIdToDisplayName('o1')).toBe('o1');
    expect(parseModelIdToDisplayName('o1-mini')).toBe('o1 Mini');
    expect(parseModelIdToDisplayName('o3-mini')).toBe('o3 Mini');
  });

  it('formats Gemini model IDs', () => {
    expect(parseModelIdToDisplayName('gemini-2.0-flash')).toBe('Gemini 2.0 Flash');
    expect(parseModelIdToDisplayName('gemini-1.5-pro')).toBe('Gemini 1.5 Pro');
  });

  it('formats Llama model IDs', () => {
    expect(parseModelIdToDisplayName('llama-3.1-70b-instruct')).toContain('Llama');
    expect(parseModelIdToDisplayName('llama-3.1')).toBe('Llama 3.1');
  });

  it('removes version suffixes (-latest, -v1:0, @20240620, -2024-08-06)', () => {
    expect(parseModelIdToDisplayName('claude-3-5-sonnet-latest')).toMatch(/^Sonnet 3\.5\.?$/);
    expect(parseModelIdToDisplayName('model-v1:0')).not.toContain('v1:0');
  });

  it('fallback title-cases unknown models', () => {
    const result = parseModelIdToDisplayName('some-custom-model');
    expect(result).toBe('Some Custom Model');
  });
});
