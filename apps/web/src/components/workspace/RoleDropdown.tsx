'use client';

import React, { useState, useMemo } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
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
  const [searchQuery, setSearchQuery] = useState('');
  const [open, setOpen] = useState(false);

  const CurrentIcon = roleIcons[currentRole as AgentRole];
  const currentLabel =
    roleOptions.find((r) => r.value === currentRole)?.label ||
    currentRole.charAt(0).toUpperCase() + currentRole.slice(1);

  // Filter roles based on search query
  const filteredRoles = useMemo(() => {
    if (!searchQuery.trim()) return roleOptions;
    const query = searchQuery.toLowerCase();
    return roleOptions.filter(
      (role) =>
        role.label.toLowerCase().includes(query) || role.description.toLowerCase().includes(query)
    );
  }, [searchQuery]);

  const developmentRoles = filteredRoles.filter((r) => r.category === 'development');
  const systemRoles = filteredRoles.filter((r) => r.category === 'system');
  const communicationRoles = filteredRoles.filter((r) => r.category === 'communication');

  const handleSelect = (role: AgentRoleType) => {
    onRoleChange(role);
    setOpen(false);
    setSearchQuery('');
  };

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (!isOpen) {
      setSearchQuery('');
    }
  };

  const renderRoleItem = (role: RoleOption) => {
    const Icon = roleIcons[role.value as AgentRole];
    const isSelected = currentRole === role.value;
    return (
      <DropdownMenuItem
        key={role.value}
        className={cn(
          'flex items-center gap-2 cursor-pointer',
          isSelected && 'bg-accent-primary/10'
        )}
        onClick={() => handleSelect(role.value)}
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
  };

  const hasResults =
    developmentRoles.length > 0 || systemRoles.length > 0 || communicationRoles.length > 0;

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
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

      <DropdownMenuContent align="start" className="w-56 flex flex-col">
        {/* Search input */}
        <div className="px-2 py-2 border-b border-border-subtle">
          <div className="flex items-center gap-2 px-2 py-1.5 rounded bg-elevated">
            <Search className="h-3.5 w-3.5 text-text-muted flex-shrink-0" />
            <input
              type="text"
              placeholder="Search roles..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted outline-none"
              autoFocus
            />
          </div>
        </div>

        {/* Scrollable role list */}
        <div className="max-h-64 overflow-y-auto">
          {!hasResults ? (
            <div className="px-2 py-4 text-center text-sm text-text-muted">No roles found</div>
          ) : (
            <>
              {/* Development roles */}
              {developmentRoles.length > 0 && (
                <>
                  <DropdownMenuLabel className="text-xs text-text-muted">
                    Development
                  </DropdownMenuLabel>
                  {developmentRoles.map(renderRoleItem)}
                </>
              )}

              {/* System roles */}
              {systemRoles.length > 0 && (
                <>
                  {developmentRoles.length > 0 && <DropdownMenuSeparator />}
                  <DropdownMenuLabel className="text-xs text-text-muted">System</DropdownMenuLabel>
                  {systemRoles.map(renderRoleItem)}
                </>
              )}

              {/* Communication roles */}
              {communicationRoles.length > 0 && (
                <>
                  {(developmentRoles.length > 0 || systemRoles.length > 0) && (
                    <DropdownMenuSeparator />
                  )}
                  <DropdownMenuLabel className="text-xs text-text-muted">
                    Communication
                  </DropdownMenuLabel>
                  {communicationRoles.map(renderRoleItem)}
                </>
              )}
            </>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
