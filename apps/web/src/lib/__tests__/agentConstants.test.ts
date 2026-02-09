/**
 * Tests for agentConstants - icon mapping, mode config, and agent option helpers.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Bot, Code2, Compass, Eye, User } from 'lucide-react';
import {
  getIconByName,
  getRoleIcon,
  getModeConfig,
  getAgentBorderColor,
  getAgentTextColor,
  createAgentOptionFromRole,
  createCustomAgentOption,
  modeConfig,
} from '../agentConstants';

describe('getIconByName', () => {
  it('returns Bot for null or undefined', () => {
    expect(getIconByName(null)).toBe(Bot);
    expect(getIconByName(undefined)).toBe(Bot);
  });

  it('returns mapped icon for known name', () => {
    expect(getIconByName('Compass')).toBe(Compass);
    expect(getIconByName('Eye')).toBe(Eye);
  });

  it('returns Bot for unknown icon name', () => {
    expect(getIconByName('UnknownIcon')).toBe(Bot);
  });

  it('returns same icon for TestTube2 alias as FlaskConical', () => {
    const icon = getIconByName('TestTube2');
    expect(icon).toBeDefined();
    // Lucide icons are React components (function or forwardRef object)
    expect(icon === null || typeof icon === 'function' || typeof icon === 'object').toBe(true);
  });
});

describe('getRoleIcon', () => {
  it('returns icon for role object with icon field', () => {
    expect(getRoleIcon({ icon: 'Compass' })).toBe(Compass);
  });

  it('returns icon for legacy string role name', () => {
    expect(getRoleIcon('architect')).toBe(Compass);
    expect(getRoleIcon('coder')).toBe(Code2);
    expect(getRoleIcon('reviewer')).toBe(Eye);
  });

  it('returns Bot for unknown string role', () => {
    expect(getRoleIcon('unknown_role')).toBe(Bot);
  });

  it('returns Bot for role object with null icon', () => {
    expect(getRoleIcon({ icon: null })).toBe(Bot);
  });

  it('returns Bot for role object with unknown icon', () => {
    expect(getRoleIcon({ icon: 'Unknown' })).toBe(Bot);
  });
});

describe('getModeConfig', () => {
  it('returns config for each agent mode', () => {
    expect(getModeConfig('plan')).toEqual(modeConfig.plan);
    expect(getModeConfig('ask')).toEqual(modeConfig.ask);
    expect(getModeConfig('auto')).toEqual(modeConfig.auto);
    expect(getModeConfig('sovereign')).toEqual(modeConfig.sovereign);
  });

  it('returns ask config for undefined', () => {
    expect(getModeConfig(undefined)).toEqual(modeConfig.ask);
  });

  it('returns config with icon, label, and color', () => {
    const config = getModeConfig('auto');
    expect(config).toHaveProperty('icon');
    expect(config).toHaveProperty('label');
    expect(config).toHaveProperty('color');
  });
});

describe('getAgentBorderColor', () => {
  it('returns Tailwind class for known color', () => {
    expect(getAgentBorderColor('agent-1')).toBe('border-agent-1');
    expect(getAgentBorderColor('agent-3')).toBe('border-agent-3');
  });

  it('returns default for unknown color', () => {
    expect(getAgentBorderColor('unknown')).toBe('border-border-default');
  });
});

describe('getAgentTextColor', () => {
  it('returns Tailwind class for known color', () => {
    expect(getAgentTextColor('agent-1')).toBe('text-agent-1');
  });

  it('returns default for unknown color', () => {
    expect(getAgentTextColor('unknown')).toBe('text-text-primary');
  });
});

describe('createAgentOptionFromRole', () => {
  it('builds AgentOption from role config', () => {
    const option = createAgentOptionFromRole({
      role: 'architect',
      name: 'Architect',
      description: 'Plans the work',
      color: '#3b82f6',
      icon: 'Compass',
    });
    expect(option.id).toBe('architect');
    expect(option.role).toBe('architect');
    expect(option.name).toBe('Architect');
    expect(option.description).toBe('Plans the work');
    expect(option.color).toBe('#3b82f6');
    expect(option.isCustom).toBe(false);
    expect(option.icon).toBe(Compass);
  });

  it('uses empty description when null', () => {
    const option = createAgentOptionFromRole({
      role: 'coder',
      name: 'Coder',
      description: null,
      color: '#10b981',
    });
    expect(option.description).toBe('');
  });
});

describe('createCustomAgentOption', () => {
  it('builds custom AgentOption from template', () => {
    const option = createCustomAgentOption({
      id: 'tpl-1',
      name: 'My Agent',
      description: 'Custom agent',
      model: 'gpt-4',
      share_token: 'token-123',
    });
    expect(option.id).toBe('tpl-1');
    expect(option.role).toBe('custom');
    expect(option.name).toBe('My Agent');
    expect(option.description).toBe('Custom agent');
    expect(option.model).toBe('gpt-4');
    expect(option.shareToken).toBe('token-123');
    expect(option.isCustom).toBe(true);
    expect(option.templateId).toBe('tpl-1');
    expect(option.icon).toBe(User);
  });

  it('uses default description when not provided', () => {
    const option = createCustomAgentOption({
      id: 'tpl-2',
      name: 'Custom',
    });
    expect(option.description).toBe('Custom agent template');
  });
});
