'use client';

import React from 'react';
import { Brain, Eye, Key } from 'lucide-react';
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
      <p className={cn('text-xs font-medium mb-2', titleColor)}>{title}</p>
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

/**
 * Renders the user's API key models section.
 */
export function UserModelsSection({ models, currentModel, onSelect }: UserModelsSectionProps) {
  if (models.length === 0) return null;

  return (
    <div>
      <p className="text-xs font-medium text-purple-400 mb-2 flex items-center gap-1">
        <Key className="h-3 w-3" />
        Your API Keys
      </p>
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
            <span className="flex items-center gap-1">
              <Key className="h-3 w-3 text-purple-400" />
              {model.display_name}
            </span>
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
