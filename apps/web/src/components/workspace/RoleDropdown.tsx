'use client';

import React from 'react';
import { Check, ChevronDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@podex/ui';
import { cn } from '@/lib/utils';
import { roleIcons, type AgentRole } from '@/lib/agentConstants';
import type { AgentRole as AgentRoleType } from '@/stores/session';

interface RoleOption {
  value: AgentRoleType;
  label: string;
  description: string;
  category: 'development' | 'system' | 'communication';
}

const roleOptions: RoleOption[] = [
  // Development workflow
  {
    value: 'architect',
    label: 'Architect',
    description: 'Design systems and plan implementations',
    category: 'development',
  },
  {
    value: 'coder',
    label: 'Coder',
    description: 'Write and modify code',
    category: 'development',
  },
  {
    value: 'reviewer',
    label: 'Reviewer',
    description: 'Review code and suggest improvements',
    category: 'development',
  },
  {
    value: 'tester',
    label: 'Tester',
    description: 'Write and run tests',
    category: 'development',
  },
  // System / orchestration
  {
    value: 'agent_builder',
    label: 'Agent Builder',
    description: 'Create and configure custom agents',
    category: 'system',
  },
  {
    value: 'orchestrator',
    label: 'Orchestrator',
    description: 'Coordinate multiple agents',
    category: 'system',
  },
  // Communication / meta
  {
    value: 'chat',
    label: 'Chat',
    description: 'General conversation and assistance',
    category: 'communication',
  },
  {
    value: 'security',
    label: 'Security',
    description: 'Security analysis and recommendations',
    category: 'communication',
  },
  {
    value: 'devops',
    label: 'DevOps',
    description: 'Infrastructure and deployment',
    category: 'communication',
  },
  {
    value: 'documentator',
    label: 'Documentator',
    description: 'Write documentation and comments',
    category: 'communication',
  },
];

interface RoleDropdownProps {
  /** Current agent role */
  currentRole: AgentRoleType;
  /** Callback when role changes */
  onRoleChange: (role: AgentRoleType) => void;
  /** Additional CSS classes */
  className?: string;
  /** Whether the dropdown is disabled */
  disabled?: boolean;
}

/**
 * Dropdown for changing the agent's role.
 * Groups roles by category (Development, System, Communication).
 */
export function RoleDropdown({
  currentRole,
  onRoleChange,
  className,
  disabled,
}: RoleDropdownProps) {
  const CurrentIcon = roleIcons[currentRole as AgentRole];
  const currentLabel =
    roleOptions.find((r) => r.value === currentRole)?.label ||
    currentRole.charAt(0).toUpperCase() + currentRole.slice(1);

  const developmentRoles = roleOptions.filter((r) => r.category === 'development');
  const systemRoles = roleOptions.filter((r) => r.category === 'system');
  const communicationRoles = roleOptions.filter((r) => r.category === 'communication');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          className={cn(
            'flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors',
            'bg-elevated text-text-secondary hover:bg-overlay hover:text-text-primary',
            disabled && 'opacity-50 cursor-not-allowed',
            className
          )}
        >
          {CurrentIcon && <CurrentIcon className="h-3 w-3" />}
          <span>{currentLabel}</span>
          <ChevronDown className="h-3 w-3 text-text-muted" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-56">
        {/* Development roles */}
        <DropdownMenuLabel className="text-xs text-text-muted">Development</DropdownMenuLabel>
        {developmentRoles.map((role) => {
          const Icon = roleIcons[role.value as AgentRole];
          const isSelected = currentRole === role.value;
          return (
            <DropdownMenuItem
              key={role.value}
              className={cn(
                'flex items-center gap-2 cursor-pointer',
                isSelected && 'bg-accent-primary/10'
              )}
              onClick={() => onRoleChange(role.value)}
            >
              <div className="flex items-center gap-2 flex-1">
                {Icon && <Icon className="h-4 w-4" />}
                <div className="flex flex-col">
                  <span className="text-sm">{role.label}</span>
                  <span className="text-xs text-text-muted">{role.description}</span>
                </div>
              </div>
              {isSelected && <Check className="h-4 w-4 text-accent-primary" />}
            </DropdownMenuItem>
          );
        })}

        <DropdownMenuSeparator />

        {/* System roles */}
        <DropdownMenuLabel className="text-xs text-text-muted">System</DropdownMenuLabel>
        {systemRoles.map((role) => {
          const Icon = roleIcons[role.value as AgentRole];
          const isSelected = currentRole === role.value;
          return (
            <DropdownMenuItem
              key={role.value}
              className={cn(
                'flex items-center gap-2 cursor-pointer',
                isSelected && 'bg-accent-primary/10'
              )}
              onClick={() => onRoleChange(role.value)}
            >
              <div className="flex items-center gap-2 flex-1">
                {Icon && <Icon className="h-4 w-4" />}
                <div className="flex flex-col">
                  <span className="text-sm">{role.label}</span>
                  <span className="text-xs text-text-muted">{role.description}</span>
                </div>
              </div>
              {isSelected && <Check className="h-4 w-4 text-accent-primary" />}
            </DropdownMenuItem>
          );
        })}

        <DropdownMenuSeparator />

        {/* Communication roles */}
        <DropdownMenuLabel className="text-xs text-text-muted">Communication</DropdownMenuLabel>
        {communicationRoles.map((role) => {
          const Icon = roleIcons[role.value as AgentRole];
          const isSelected = currentRole === role.value;
          return (
            <DropdownMenuItem
              key={role.value}
              className={cn(
                'flex items-center gap-2 cursor-pointer',
                isSelected && 'bg-accent-primary/10'
              )}
              onClick={() => onRoleChange(role.value)}
            >
              <div className="flex items-center gap-2 flex-1">
                {Icon && <Icon className="h-4 w-4" />}
                <div className="flex flex-col">
                  <span className="text-sm">{role.label}</span>
                  <span className="text-xs text-text-muted">{role.description}</span>
                </div>
              </div>
              {isSelected && <Check className="h-4 w-4 text-accent-primary" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
