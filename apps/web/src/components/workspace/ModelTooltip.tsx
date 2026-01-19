'use client';

import type { ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@podex/ui';
import { Brain, DollarSign, Eye, EyeOff, Zap, Clock, ImageIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ModelInfo } from '@podex/shared';

interface ModelTooltipProps {
  model: ModelInfo;
  children: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
}

/**
 * Rich tooltip component showing detailed model information
 */
export function ModelTooltip({
  model,
  children,
  side = 'right',
  align = 'start',
}: ModelTooltipProps) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent
          side={side}
          align={align}
          sideOffset={8}
          className="w-72 p-0 bg-surface border-border-default"
        >
          <div className="p-3 space-y-3">
            {/* Header */}
            <div className="flex items-center justify-between">
              <span className="font-medium text-text-primary">{model.displayName}</span>
              <TierBadge tier={model.tier} />
            </div>

            {/* Capabilities */}
            <div className="space-y-2">
              {/* Context Window */}
              <div className="flex items-center gap-2 text-xs">
                <Clock className="h-3.5 w-3.5 text-text-muted" />
                <span className="text-text-secondary">Context:</span>
                <span className="text-text-primary font-medium">
                  {(model.contextWindow / 1000).toFixed(0)}K tokens
                </span>
              </div>

              {/* Vision Support */}
              <div className="flex items-center gap-2 text-xs">
                {model.supportsVision ? (
                  <>
                    <Eye className="h-3.5 w-3.5 text-purple-400" />
                    <span className="text-purple-400">Vision supported</span>
                    <span className="text-text-muted">(images, screenshots)</span>
                  </>
                ) : (
                  <>
                    <EyeOff className="h-3.5 w-3.5 text-text-muted" />
                    <span className="text-text-muted">No vision support</span>
                  </>
                )}
              </div>

              {/* Thinking Support */}
              <div className="flex items-center gap-2 text-xs">
                {model.supportsThinking ? (
                  <>
                    <Brain className="h-3.5 w-3.5 text-blue-400" />
                    <span className="text-blue-400">Extended Thinking</span>
                    <span className="text-text-muted">(1K-32K tokens)</span>
                  </>
                ) : model.thinkingStatus === 'coming_soon' ? (
                  <>
                    <Brain className="h-3.5 w-3.5 text-yellow-400" />
                    <span className="text-yellow-400">Thinking coming soon</span>
                  </>
                ) : (
                  <>
                    <Brain className="h-3.5 w-3.5 text-text-muted" />
                    <span className="text-text-muted">No extended thinking</span>
                  </>
                )}
              </div>

              {/* Reasoning Effort */}
              <div className="flex items-center gap-2 text-xs">
                <Zap className="h-3.5 w-3.5 text-text-muted" />
                <span className="text-text-secondary">Reasoning:</span>
                <ReasoningBadge level={model.reasoningEffort} />
              </div>

              {/* Pricing */}
              {(model.inputPricePerMillion || model.outputPricePerMillion) && (
                <div className="flex items-center gap-2 text-xs">
                  <DollarSign className="h-3.5 w-3.5 text-text-muted" />
                  <span className="text-text-secondary">Price:</span>
                  <span className="text-text-primary font-medium">
                    ${model.inputPricePerMillion?.toFixed(2) ?? '?'} / $
                    {model.outputPricePerMillion?.toFixed(2) ?? '?'}
                  </span>
                  <span className="text-text-muted">/M tokens</span>
                </div>
              )}
            </div>

            {/* Divider */}
            <div className="border-t border-border-subtle" />

            {/* Good For */}
            <div className="space-y-1.5">
              <span className="text-xs text-text-muted">Good for:</span>
              <div className="flex flex-wrap gap-1.5">
                {model.goodFor.map((tag) => (
                  <span
                    key={tag}
                    className="px-2 py-0.5 rounded-full text-xs bg-elevated text-text-secondary"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>

            {/* Description */}
            <p className="text-xs text-text-muted leading-relaxed">{model.description}</p>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * Tier badge component
 */
function TierBadge({ tier }: { tier: ModelInfo['tier'] }) {
  const config = {
    flagship: {
      label: 'Flagship',
      className: 'bg-amber-500/20 text-amber-400',
    },
    balanced: {
      label: 'Balanced',
      className: 'bg-blue-500/20 text-blue-400',
    },
    fast: {
      label: 'Fast',
      className: 'bg-green-500/20 text-green-400',
    },
  };

  const { label, className } = config[tier];

  return (
    <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', className)}>{label}</span>
  );
}

/**
 * Reasoning effort badge
 */
function ReasoningBadge({ level }: { level: ModelInfo['reasoningEffort'] }) {
  const config = {
    low: { label: 'Low', className: 'text-green-400' },
    medium: { label: 'Medium', className: 'text-yellow-400' },
    high: { label: 'High', className: 'text-orange-400' },
  };

  const { label, className } = config[level];

  return <span className={cn('font-medium', className)}>{label}</span>;
}

/**
 * Compact capability badges for inline display
 */
export function ModelCapabilityBadges({
  model,
  compact = false,
}: {
  model: ModelInfo;
  compact?: boolean;
}) {
  return (
    <div className="flex items-center gap-1">
      {model.supportsVision && (
        <span
          className={cn(
            'flex items-center gap-1 rounded-full font-medium',
            compact ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs',
            'bg-purple-500/20 text-purple-400'
          )}
          title="Supports image/vision input"
        >
          <ImageIcon className={cn(compact ? 'h-2.5 w-2.5' : 'h-3 w-3')} />
          {!compact && 'Vision'}
        </span>
      )}

      {model.supportsThinking && (
        <span
          className={cn(
            'flex items-center gap-1 rounded-full font-medium',
            compact ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs',
            'bg-blue-500/20 text-blue-400'
          )}
          title="Supports extended thinking"
        >
          <Brain className={cn(compact ? 'h-2.5 w-2.5' : 'h-3 w-3')} />
          {!compact && 'Thinking'}
        </span>
      )}

      {model.thinkingStatus === 'coming_soon' && (
        <span
          className={cn(
            'flex items-center gap-1 rounded-full font-medium',
            compact ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs',
            'bg-gray-500/20 text-gray-400'
          )}
          title="Extended thinking coming soon"
        >
          <Brain className={cn(compact ? 'h-2.5 w-2.5' : 'h-3 w-3')} />
          {!compact && 'Soon'}
        </span>
      )}
    </div>
  );
}

/**
 * Vision warning banner for models that don't support images
 */
export function VisionNotSupportedWarning({ modelName }: { modelName: string }) {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-yellow-500/10 border border-yellow-500/20 text-xs text-yellow-400">
      <EyeOff className="h-3.5 w-3.5 shrink-0" />
      <span>{modelName} does not support image input</span>
    </div>
  );
}
