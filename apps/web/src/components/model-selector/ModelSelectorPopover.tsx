'use client';

import { useState, useCallback, useMemo } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { ChevronDown, ImageOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ModelSelector } from './ModelSelector';
import { ModelCapabilityBadges } from '../workspace/ModelTooltip';
import type { LLMModel, ModelTab } from './types';
import type { ModelInfo } from '@podex/shared';
import type { PublicModel, UserProviderModel } from '@/lib/api';

// Extended ModelInfo with user API flag
type ExtendedModelInfo = ModelInfo & { isUserKey?: boolean };

/**
 * Convert UserProviderModel to LLMModel format for the ModelSelector
 */
function userProviderModelToLLMModel(model: UserProviderModel): LLMModel {
  return {
    ...model,
    is_default: false,
    user_input_cost_per_million: model.input_cost_per_million,
    user_output_cost_per_million: model.output_cost_per_million,
    llm_margin_percent: 0,
  };
}

export interface ModelSelectorPopoverProps {
  /** All available models from API (Podex tab) */
  models: LLMModel[] | PublicModel[];
  /** User's BYOK models (Your Keys tab) */
  userKeyModels?: LLMModel[] | UserProviderModel[];
  /** Currently selected model ID */
  selectedModelId: string;
  /** Display name for the current model */
  selectedModelDisplayName: string;
  /** Current model info for capability badges */
  currentModelInfo?: ExtendedModelInfo;
  /** Callback when model is selected */
  onSelectModel: (modelId: string) => void;
  /** Loading state for models */
  isLoading?: boolean;
  /** Default tab */
  defaultTab?: ModelTab;
  /** Optional class name for the trigger button */
  triggerClassName?: string;
  /** Alignment of the popover content */
  align?: 'start' | 'center' | 'end';
}

/**
 * A popover-based model selector that wraps the ModelSelector component.
 * Use this in headers and toolbars where a dropdown-style UI is needed.
 */
export function ModelSelectorPopover({
  models,
  userKeyModels = [],
  selectedModelId,
  selectedModelDisplayName,
  currentModelInfo,
  onSelectModel,
  isLoading = false,
  defaultTab = 'podex',
  triggerClassName,
  align = 'start',
}: ModelSelectorPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);

  // Convert user provider models to LLMModel format if needed
  const normalizedUserKeyModels = useMemo(() => {
    return userKeyModels.map((model) => {
      // Check if model is UserProviderModel (has is_user_key but not is_default)
      if ('is_user_key' in model && !('is_default' in model)) {
        return userProviderModelToLLMModel(model as UserProviderModel);
      }
      return model as LLMModel;
    });
  }, [userKeyModels]);

  const handleSelectModel = useCallback(
    (modelId: string) => {
      onSelectModel(modelId);
      setIsOpen(false);
    },
    [onSelectModel]
  );

  return (
    <Popover.Root open={isOpen} onOpenChange={setIsOpen}>
      <Popover.Trigger asChild>
        <button
          className={cn(
            'flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors',
            'bg-elevated text-text-secondary hover:bg-overlay hover:text-text-primary',
            triggerClassName
          )}
        >
          <span>{selectedModelDisplayName}</span>
          {currentModelInfo && <ModelCapabilityBadges model={currentModelInfo} compact />}
          {currentModelInfo && !currentModelInfo.supportsVision && (
            <span
              className="text-yellow-500/70"
              title={`${currentModelInfo.displayName ?? 'This model'} does not support image input`}
            >
              <ImageOff className="h-3 w-3" />
            </span>
          )}
          <ChevronDown className="h-3 w-3 text-text-muted" />
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align={align}
          sideOffset={4}
          className={cn(
            'z-50 w-[380px] h-[500px] rounded-lg',
            'bg-surface border border-border-default',
            'shadow-[0_8px_32px_rgba(0,0,0,0.6)]',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
            'data-[side=bottom]:slide-in-from-top-2',
            'data-[side=top]:slide-in-from-bottom-2'
          )}
          onInteractOutside={(e) => {
            // Prevent closing when clicking inside nested elements
            const target = e.target as HTMLElement;
            if (target.closest('[data-radix-popover-content]')) {
              e.preventDefault();
            }
          }}
        >
          <ModelSelector
            models={models as LLMModel[]}
            userKeyModels={normalizedUserKeyModels}
            selectedModelId={selectedModelId}
            onSelectModel={handleSelectModel}
            isLoading={isLoading}
            defaultTab={defaultTab}
            className="h-full"
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
