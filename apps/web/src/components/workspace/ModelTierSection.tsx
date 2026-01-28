'use client';

import React from 'react';
import { Brain, Eye } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PublicModel, UserProviderModel } from '@/lib/api';

interface ModelTierSectionProps {
  title: string;
  titleColor: string;
  models: PublicModel[];
  currentModel: string;
  onSelect: (modelId: string) => void;
}

/**
 * Renders a tier section of models (Flagship, Balanced, Fast).
 * Used in model selection sheets/dropdowns.
 */
export function ModelTierSection({
  title,
  titleColor,
  models,
  currentModel,
  onSelect,
}: ModelTierSectionProps) {
  if (models.length === 0) return null;

  return (
    <div>
      <p className={cn('text-xs font-medium mb-2 text-text-primary', titleColor)}>{title}</p>
      <div className="space-y-1">
        {models.map((model) => (
          <button
            key={model.model_id}
            onClick={() => onSelect(model.model_id)}
            className={cn(
              'w-full flex items-center justify-between px-3 py-2 rounded-lg transition-colors min-h-[44px]',
              currentModel === model.model_id
                ? 'bg-accent-primary/20 text-accent-primary'
                : 'bg-surface-hover text-text-primary hover:bg-surface-active'
            )}
          >
            <span>{model.display_name}</span>
            <div className="flex items-center gap-1 text-xs text-text-tertiary">
              {model.capabilities?.vision && (
                <Eye className="h-3 w-3 text-green-400" aria-label="Supports vision" />
              )}
              {model.capabilities?.thinking && (
                <Brain className="h-3 w-3 text-purple-400" aria-label="Supports thinking" />
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

interface UserModelsSectionProps {
  models: UserProviderModel[];
  currentModel: string;
  onSelect: (modelId: string) => void;
}

export interface LocalModelItem {
  model_id: string;
  display_name: string;
}

interface LocalModelsSectionProps {
  models: LocalModelItem[];
  currentModel: string;
  onSelect: (modelId: string) => void;
}

/**
 * Renders local (Ollama / LM Studio) models section.
 */
export function LocalModelsSection({ models, currentModel, onSelect }: LocalModelsSectionProps) {
  if (models.length === 0) return null;

  return (
    <div>
      <p className="text-xs font-medium text-accent-success mb-2">Local</p>
      <div className="space-y-1">
        {models.map((model) => (
          <button
            key={model.model_id}
            onClick={() => onSelect(model.model_id)}
            className={cn(
              'w-full flex items-center justify-between px-3 py-2 rounded-lg transition-colors min-h-[44px]',
              currentModel === model.model_id
                ? 'bg-green-500/20 text-accent-success'
                : 'bg-surface-hover text-text-primary hover:bg-surface-active'
            )}
          >
            <span>{model.display_name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Renders the user's API key models section.
 */
export function UserModelsSection({ models, currentModel, onSelect }: UserModelsSectionProps) {
  if (models.length === 0) return null;

  return (
    <div>
      <p className="text-xs font-medium text-accent-primary mb-2">Your API Keys</p>
      <div className="space-y-1">
        {models.map((model) => (
          <button
            key={model.model_id}
            onClick={() => onSelect(model.model_id)}
            className={cn(
              'w-full flex items-center justify-between px-3 py-2 rounded-lg transition-colors min-h-[44px]',
              currentModel === model.model_id
                ? 'bg-accent-primary/20 text-accent-primary'
                : 'bg-surface-hover text-text-primary hover:bg-surface-active'
            )}
          >
            <span>{model.display_name}</span>
            <div className="flex items-center gap-1 text-xs text-text-tertiary">
              {model.capabilities?.vision && (
                <Eye className="h-3 w-3 text-green-400" aria-label="Supports vision" />
              )}
              {model.capabilities?.thinking && (
                <Brain className="h-3 w-3 text-purple-400" aria-label="Supports thinking" />
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
