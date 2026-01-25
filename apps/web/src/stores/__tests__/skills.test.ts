import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useSkillsStore } from '../skills';
import type { Skill, SkillExecution, SkillStep } from '../skills';

// Mock fixtures
const mockSkillStep: SkillStep = {
  name: 'analyze-code',
  description: 'Analyze the code structure',
  tool: 'code-analyzer',
  parameters: { depth: 2, includeTests: true },
  required: true,
};

const mockSystemSkill: Skill = {
  id: 'skill-1',
  name: 'Code Review',
  slug: 'code-review',
  description: 'Perform comprehensive code review',
  version: '1.0.0',
  author: 'system',
  skillType: 'system',
  tags: ['code', 'quality', 'review'],
  triggers: ['/review', 'review code'],
  requiredTools: ['grep', 'ast-parser'],
  requiredContext: ['workspace'],
  steps: [mockSkillStep],
  systemPrompt: 'You are a code reviewer. Analyze code for quality and best practices.',
  examples: [{ input: 'Review this file', output: 'Analyzing code structure...' }],
  metadata: {
    category: 'code-quality',
    estimatedDuration: 60000,
    requiresApproval: false,
  },
  isActive: true,
  isDefault: true,
};

const mockUserSkill: Skill = {
  id: 'skill-2',
  name: 'Deploy to Production',
  slug: 'deploy-production',
  description: 'Deploy application to production environment',
  version: '2.0.0',
  author: 'user-1',
  skillType: 'user',
  tags: ['deployment', 'production'],
  triggers: ['/deploy', 'deploy to prod'],
  requiredTools: ['docker', 'kubectl'],
  requiredContext: ['git', 'workspace'],
  steps: [
    {
      name: 'run-tests',
      description: 'Run test suite',
      tool: 'test-runner',
      parameters: { coverage: true },
      required: true,
    },
    {
      name: 'build-image',
      description: 'Build Docker image',
      tool: 'docker',
      parameters: { tag: 'latest' },
      required: true,
    },
    {
      name: 'deploy',
      description: 'Deploy to Kubernetes',
      tool: 'kubectl',
      parameters: { namespace: 'production' },
      required: true,
    },
  ],
  metadata: {
    category: 'deployment',
    estimatedDuration: 180000,
    requiresApproval: true,
  },
  isActive: true,
  isDefault: false,
};

const mockBuiltInSkill: Skill = {
  id: 'skill-3',
  name: 'Git Workflow',
  slug: 'git-workflow',
  description: 'Standard git workflow operations',
  version: '1.5.0',
  author: 'system',
  skillType: 'system',
  tags: ['git', 'version-control'],
  triggers: ['/git', 'git workflow'],
  requiredTools: ['git'],
  requiredContext: ['workspace'],
  steps: [
    {
      name: 'check-status',
      description: 'Check git status',
      tool: 'git',
      parameters: { command: 'status' },
      required: true,
    },
  ],
  isActive: true,
  isDefault: true,
};

const mockSkillExecution: SkillExecution = {
  id: 'exec-1',
  skillSlug: 'code-review',
  skillName: 'Code Review',
  sessionId: 'session-1',
  agentId: 'agent-1',
  status: 'pending',
  currentStepIndex: 0,
  currentStepName: 'analyze-code',
  totalSteps: 1,
  stepsCompleted: 0,
  startedAt: new Date('2024-01-15T10:00:00Z'),
  results: [],
};

const mockRunningExecution: SkillExecution = {
  id: 'exec-2',
  skillSlug: 'deploy-production',
  skillName: 'Deploy to Production',
  sessionId: 'session-1',
  agentId: 'agent-1',
  status: 'running',
  currentStepIndex: 1,
  currentStepName: 'build-image',
  totalSteps: 3,
  stepsCompleted: 1,
  startedAt: new Date('2024-01-15T10:05:00Z'),
  results: [
    {
      step: 'run-tests',
      status: 'success',
      tool: 'test-runner',
      result: { passed: 45, failed: 0 },
    },
    {
      step: 'build-image',
      status: 'running',
      tool: 'docker',
    },
  ],
};

describe('skillsStore', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    act(() => {
      useSkillsStore.setState({
        skills: [],
        skillsLoading: false,
        skillsError: null,
        executionsBySession: {},
        expandedExecutionId: null,
        tagFilter: null,
        typeFilter: 'all',
        searchQuery: '',
      });
    });
  });

  // ========================================================================
  // Initial State
  // ========================================================================

  describe('Initial State', () => {
    it('has empty skills array', () => {
      const { result } = renderHook(() => useSkillsStore());
      expect(result.current.skills).toEqual([]);
    });

    it('has loading set to false', () => {
      const { result } = renderHook(() => useSkillsStore());
      expect(result.current.skillsLoading).toBe(false);
    });

    it('has no error', () => {
      const { result } = renderHook(() => useSkillsStore());
      expect(result.current.skillsError).toBeNull();
    });

    it('has empty executions by session', () => {
      const { result } = renderHook(() => useSkillsStore());
      expect(result.current.executionsBySession).toEqual({});
    });

    it('has no expanded execution', () => {
      const { result } = renderHook(() => useSkillsStore());
      expect(result.current.expandedExecutionId).toBeNull();
    });

    it('has default filter state', () => {
      const { result } = renderHook(() => useSkillsStore());
      expect(result.current.tagFilter).toBeNull();
      expect(result.current.typeFilter).toBe('all');
      expect(result.current.searchQuery).toBe('');
    });
  });

  // ========================================================================
  // Skills Management
  // ========================================================================

  describe('Skills Management', () => {
    describe('setSkills', () => {
      it('sets skills array', () => {
        const { result } = renderHook(() => useSkillsStore());

        act(() => {
          result.current.setSkills([mockSystemSkill, mockUserSkill]);
        });

        expect(result.current.skills).toHaveLength(2);
        expect(result.current.skills).toContain(mockSystemSkill);
        expect(result.current.skills).toContain(mockUserSkill);
      });

      it('clears error when setting skills', () => {
        const { result } = renderHook(() => useSkillsStore());

        act(() => {
          result.current.setSkillsError('Previous error');
          result.current.setSkills([mockSystemSkill]);
        });

        expect(result.current.skillsError).toBeNull();
      });

      it('replaces existing skills', () => {
        const { result } = renderHook(() => useSkillsStore());

        act(() => {
          result.current.setSkills([mockSystemSkill]);
          result.current.setSkills([mockUserSkill]);
        });

        expect(result.current.skills).toHaveLength(1);
        expect(result.current.skills[0]).toEqual(mockUserSkill);
      });
    });

    describe('setSkillsLoading', () => {
      it('sets loading state to true', () => {
        const { result } = renderHook(() => useSkillsStore());

        act(() => {
          result.current.setSkillsLoading(true);
        });

        expect(result.current.skillsLoading).toBe(true);
      });

      it('sets loading state to false', () => {
        const { result } = renderHook(() => useSkillsStore());

        act(() => {
          result.current.setSkillsLoading(true);
          result.current.setSkillsLoading(false);
        });

        expect(result.current.skillsLoading).toBe(false);
      });
    });

    describe('setSkillsError', () => {
      it('sets error message', () => {
        const { result } = renderHook(() => useSkillsStore());

        act(() => {
          result.current.setSkillsError('Failed to load skills');
        });

        expect(result.current.skillsError).toBe('Failed to load skills');
      });

      it('clears error when set to null', () => {
        const { result } = renderHook(() => useSkillsStore());

        act(() => {
          result.current.setSkillsError('Error');
          result.current.setSkillsError(null);
        });

        expect(result.current.skillsError).toBeNull();
      });
    });

    describe('getSkillBySlug', () => {
      beforeEach(() => {
        const { result } = renderHook(() => useSkillsStore());
        act(() => {
          result.current.setSkills([mockSystemSkill, mockUserSkill, mockBuiltInSkill]);
        });
      });

      it('returns skill with matching slug', () => {
        const { result } = renderHook(() => useSkillsStore());
        const skill = result.current.getSkillBySlug('code-review');
        expect(skill).toEqual(mockSystemSkill);
      });

      it('returns undefined for non-existent slug', () => {
        const { result } = renderHook(() => useSkillsStore());
        const skill = result.current.getSkillBySlug('non-existent');
        expect(skill).toBeUndefined();
      });

      it('finds user skills', () => {
        const { result } = renderHook(() => useSkillsStore());
        const skill = result.current.getSkillBySlug('deploy-production');
        expect(skill).toEqual(mockUserSkill);
      });
    });

    describe('Skill Categories', () => {
      it('stores skills with different categories', () => {
        const { result } = renderHook(() => useSkillsStore());

        act(() => {
          result.current.setSkills([mockSystemSkill, mockUserSkill]);
        });

        const codeSkill = result.current.skills.find(
          (s) => s.metadata?.category === 'code-quality'
        );
        const deploySkill = result.current.skills.find(
          (s) => s.metadata?.category === 'deployment'
        );

        expect(codeSkill).toBeDefined();
        expect(deploySkill).toBeDefined();
      });
    });

    describe('Built-in vs Custom Skills', () => {
      beforeEach(() => {
        const { result } = renderHook(() => useSkillsStore());
        act(() => {
          result.current.setSkills([mockSystemSkill, mockUserSkill, mockBuiltInSkill]);
        });
      });

      it('distinguishes between system and user skills', () => {
        const { result } = renderHook(() => useSkillsStore());

        const systemSkills = result.current.skills.filter((s) => s.skillType === 'system');
        const userSkills = result.current.skills.filter((s) => s.skillType === 'user');

        expect(systemSkills).toHaveLength(2);
        expect(userSkills).toHaveLength(1);
      });

      it('identifies default skills', () => {
        const { result } = renderHook(() => useSkillsStore());

        const defaultSkills = result.current.skills.filter((s) => s.isDefault);
        expect(defaultSkills).toHaveLength(2);
      });
    });

    describe('Skill Tags', () => {
      beforeEach(() => {
        const { result } = renderHook(() => useSkillsStore());
        act(() => {
          result.current.setSkills([mockSystemSkill, mockUserSkill, mockBuiltInSkill]);
        });
      });

      it('stores skills with multiple tags', () => {
        const { result } = renderHook(() => useSkillsStore());

        const skill = result.current.skills.find((s) => s.slug === 'code-review');
        expect(skill?.tags).toContain('code');
        expect(skill?.tags).toContain('quality');
        expect(skill?.tags).toContain('review');
      });

      it('finds skills by tag', () => {
        const { result } = renderHook(() => useSkillsStore());

        const gitSkills = result.current.skills.filter((s) => s.tags.includes('git'));
        expect(gitSkills).toHaveLength(1);
        expect(gitSkills[0]?.slug).toBe('git-workflow');
      });
    });
  });

  // ========================================================================
  // Skill Filtering and Search
  // ========================================================================

  describe('Skill Filtering and Search', () => {
    beforeEach(() => {
      const { result } = renderHook(() => useSkillsStore());
      act(() => {
        result.current.setSkills([mockSystemSkill, mockUserSkill, mockBuiltInSkill]);
      });
    });

    describe('setTypeFilter', () => {
      it('sets type filter to system', () => {
        const { result } = renderHook(() => useSkillsStore());

        act(() => {
          result.current.setTypeFilter('system');
        });

        expect(result.current.typeFilter).toBe('system');
      });

      it('sets type filter to user', () => {
        const { result } = renderHook(() => useSkillsStore());

        act(() => {
          result.current.setTypeFilter('user');
        });

        expect(result.current.typeFilter).toBe('user');
      });

      it('sets type filter to all', () => {
        const { result } = renderHook(() => useSkillsStore());

        act(() => {
          result.current.setTypeFilter('system');
          result.current.setTypeFilter('all');
        });

        expect(result.current.typeFilter).toBe('all');
      });
    });

    describe('setTagFilter', () => {
      it('sets tag filter', () => {
        const { result } = renderHook(() => useSkillsStore());

        act(() => {
          result.current.setTagFilter('code');
        });

        expect(result.current.tagFilter).toBe('code');
      });

      it('clears tag filter when set to null', () => {
        const { result } = renderHook(() => useSkillsStore());

        act(() => {
          result.current.setTagFilter('code');
          result.current.setTagFilter(null);
        });

        expect(result.current.tagFilter).toBeNull();
      });
    });

    describe('setSearchQuery', () => {
      it('sets search query', () => {
        const { result } = renderHook(() => useSkillsStore());

        act(() => {
          result.current.setSearchQuery('review');
        });

        expect(result.current.searchQuery).toBe('review');
      });

      it('clears search query', () => {
        const { result } = renderHook(() => useSkillsStore());

        act(() => {
          result.current.setSearchQuery('test');
          result.current.setSearchQuery('');
        });

        expect(result.current.searchQuery).toBe('');
      });
    });

    describe('getFilteredSkills', () => {
      it('returns all skills when no filters applied', () => {
        const { result } = renderHook(() => useSkillsStore());
        const filtered = result.current.getFilteredSkills();
        expect(filtered).toHaveLength(3);
      });

      it('filters by skill type - system', () => {
        const { result } = renderHook(() => useSkillsStore());

        act(() => {
          result.current.setTypeFilter('system');
        });

        const filtered = result.current.getFilteredSkills();
        expect(filtered).toHaveLength(2);
        expect(filtered.every((s) => s.skillType === 'system')).toBe(true);
      });

      it('filters by skill type - user', () => {
        const { result } = renderHook(() => useSkillsStore());

        act(() => {
          result.current.setTypeFilter('user');
        });

        const filtered = result.current.getFilteredSkills();
        expect(filtered).toHaveLength(1);
        expect(filtered[0]?.skillType).toBe('user');
      });

      it('filters by tag', () => {
        const { result } = renderHook(() => useSkillsStore());

        act(() => {
          result.current.setTagFilter('deployment');
        });

        const filtered = result.current.getFilteredSkills();
        expect(filtered).toHaveLength(1);
        expect(filtered[0]?.slug).toBe('deploy-production');
      });

      it('searches by skill name', () => {
        const { result } = renderHook(() => useSkillsStore());

        act(() => {
          result.current.setSearchQuery('review');
        });

        const filtered = result.current.getFilteredSkills();
        expect(filtered).toHaveLength(1);
        expect(filtered[0]?.slug).toBe('code-review');
      });

      it('searches by description', () => {
        const { result } = renderHook(() => useSkillsStore());

        act(() => {
          result.current.setSearchQuery('git workflow');
        });

        const filtered = result.current.getFilteredSkills();
        expect(filtered).toHaveLength(1);
        expect(filtered[0]?.slug).toBe('git-workflow');
      });

      it('searches by tags', () => {
        const { result } = renderHook(() => useSkillsStore());

        act(() => {
          result.current.setSearchQuery('version-control');
        });

        const filtered = result.current.getFilteredSkills();
        expect(filtered).toHaveLength(1);
        expect(filtered[0]?.slug).toBe('git-workflow');
      });

      it('search is case insensitive', () => {
        const { result } = renderHook(() => useSkillsStore());

        act(() => {
          result.current.setSearchQuery('DEPLOY');
        });

        const filtered = result.current.getFilteredSkills();
        expect(filtered).toHaveLength(1);
        expect(filtered[0]?.slug).toBe('deploy-production');
      });

      it('combines multiple filters', () => {
        const { result } = renderHook(() => useSkillsStore());

        act(() => {
          result.current.setTypeFilter('system');
          result.current.setTagFilter('git');
        });

        const filtered = result.current.getFilteredSkills();
        expect(filtered).toHaveLength(1);
        expect(filtered[0]?.slug).toBe('git-workflow');
      });

      it('combines all filters', () => {
        const { result } = renderHook(() => useSkillsStore());

        act(() => {
          result.current.setTypeFilter('system');
          result.current.setTagFilter('code');
          result.current.setSearchQuery('review');
        });

        const filtered = result.current.getFilteredSkills();
        expect(filtered).toHaveLength(1);
        expect(filtered[0]?.slug).toBe('code-review');
      });

      it('returns empty array when no skills match filters', () => {
        const { result } = renderHook(() => useSkillsStore());

        act(() => {
          result.current.setSearchQuery('nonexistent');
        });

        const filtered = result.current.getFilteredSkills();
        expect(filtered).toHaveLength(0);
      });
    });
  });

  // ========================================================================
  // Skill Execution
  // ========================================================================

  describe('Skill Execution', () => {
    describe('startExecution', () => {
      it('starts new execution for session', () => {
        const { result } = renderHook(() => useSkillsStore());

        act(() => {
          result.current.startExecution(mockSkillExecution);
        });

        const executions = result.current.executionsBySession['session-1'];
        expect(executions).toHaveLength(1);
        expect(executions?.[0]).toEqual(mockSkillExecution);
      });

      it('adds execution to beginning of list', () => {
        const { result } = renderHook(() => useSkillsStore());
        const execution2: SkillExecution = {
          ...mockSkillExecution,
          id: 'exec-2',
          startedAt: new Date('2024-01-15T10:05:00Z'),
        };

        act(() => {
          result.current.startExecution(mockSkillExecution);
          result.current.startExecution(execution2);
        });

        const executions = result.current.executionsBySession['session-1'];
        expect(executions?.[0]?.id).toBe('exec-2');
        expect(executions?.[1]?.id).toBe('exec-1');
      });

      it('handles multiple sessions', () => {
        const { result } = renderHook(() => useSkillsStore());
        const session2Execution: SkillExecution = {
          ...mockSkillExecution,
          id: 'exec-session2',
          sessionId: 'session-2',
        };

        act(() => {
          result.current.startExecution(mockSkillExecution);
          result.current.startExecution(session2Execution);
        });

        expect(result.current.executionsBySession['session-1']).toHaveLength(1);
        expect(result.current.executionsBySession['session-2']).toHaveLength(1);
      });
    });

    describe('updateExecutionStep', () => {
      beforeEach(() => {
        const { result } = renderHook(() => useSkillsStore());
        act(() => {
          result.current.startExecution(mockSkillExecution);
        });
      });

      it('updates step status to running', () => {
        const { result } = renderHook(() => useSkillsStore());

        act(() => {
          result.current.updateExecutionStep('session-1', 'exec-1', 'analyze-code', 0, 'running');
        });

        const execution = result.current.executionsBySession['session-1']?.[0];
        expect(execution?.results).toHaveLength(1);
        expect(execution?.results[0]?.status).toBe('running');
      });

      it('updates step status to success', () => {
        const { result } = renderHook(() => useSkillsStore());

        act(() => {
          result.current.updateExecutionStep('session-1', 'exec-1', 'analyze-code', 0, 'success');
        });

        const execution = result.current.executionsBySession['session-1']?.[0];
        expect(execution?.results[0]?.status).toBe('success');
        expect(execution?.stepsCompleted).toBe(1);
      });

      it('updates current step index and name', () => {
        const { result } = renderHook(() => useSkillsStore());

        act(() => {
          result.current.updateExecutionStep('session-1', 'exec-1', 'next-step', 1, 'running');
        });

        const execution = result.current.executionsBySession['session-1']?.[0];
        expect(execution?.currentStepIndex).toBe(1);
        expect(execution?.currentStepName).toBe('next-step');
      });

      it('updates existing step result', () => {
        const { result } = renderHook(() => useSkillsStore());

        act(() => {
          result.current.updateExecutionStep('session-1', 'exec-1', 'analyze-code', 0, 'running');
          result.current.updateExecutionStep('session-1', 'exec-1', 'analyze-code', 0, 'success');
        });

        const execution = result.current.executionsBySession['session-1']?.[0];
        expect(execution?.results).toHaveLength(1);
        expect(execution?.results[0]?.status).toBe('success');
      });

      it('handles step failure', () => {
        const { result } = renderHook(() => useSkillsStore());

        act(() => {
          result.current.updateExecutionStep('session-1', 'exec-1', 'analyze-code', 0, 'failed');
        });

        const execution = result.current.executionsBySession['session-1']?.[0];
        expect(execution?.results[0]?.status).toBe('failed');
        expect(execution?.stepsCompleted).toBe(0);
      });

      it('handles non-existent session gracefully', () => {
        const { result } = renderHook(() => useSkillsStore());

        expect(() => {
          act(() => {
            result.current.updateExecutionStep('non-existent', 'exec-1', 'step', 0, 'running');
          });
        }).not.toThrow();
      });

      it('handles non-existent execution gracefully', () => {
        const { result } = renderHook(() => useSkillsStore());

        expect(() => {
          act(() => {
            result.current.updateExecutionStep('session-1', 'non-existent', 'step', 0, 'running');
          });
        }).not.toThrow();
      });
    });

    describe('completeExecution', () => {
      beforeEach(() => {
        const { result } = renderHook(() => useSkillsStore());
        act(() => {
          result.current.startExecution(mockSkillExecution);
        });
      });

      it('marks execution as completed on success', () => {
        const { result } = renderHook(() => useSkillsStore());

        act(() => {
          result.current.completeExecution('session-1', 'exec-1', true, 5000);
        });

        const execution = result.current.executionsBySession['session-1']?.[0];
        expect(execution?.status).toBe('completed');
        expect(execution?.durationMs).toBe(5000);
        expect(execution?.completedAt).toBeInstanceOf(Date);
      });

      it('marks execution as failed on failure', () => {
        const { result } = renderHook(() => useSkillsStore());

        act(() => {
          result.current.completeExecution('session-1', 'exec-1', false, 3000);
        });

        const execution = result.current.executionsBySession['session-1']?.[0];
        expect(execution?.status).toBe('failed');
        expect(execution?.durationMs).toBe(3000);
      });

      it('sets completion timestamp', () => {
        const { result } = renderHook(() => useSkillsStore());
        const beforeComplete = new Date();

        act(() => {
          result.current.completeExecution('session-1', 'exec-1', true, 1000);
        });

        const execution = result.current.executionsBySession['session-1']?.[0];
        expect(execution?.completedAt).toBeInstanceOf(Date);
        expect(execution?.completedAt!.getTime()).toBeGreaterThanOrEqual(beforeComplete.getTime());
      });

      it('handles non-existent session gracefully', () => {
        const { result } = renderHook(() => useSkillsStore());

        expect(() => {
          act(() => {
            result.current.completeExecution('non-existent', 'exec-1', true, 1000);
          });
        }).not.toThrow();
      });

      it('handles non-existent execution gracefully', () => {
        const { result } = renderHook(() => useSkillsStore());

        expect(() => {
          act(() => {
            result.current.completeExecution('session-1', 'non-existent', true, 1000);
          });
        }).not.toThrow();
      });
    });

    describe('Execution History', () => {
      it('maintains execution history for session', () => {
        const { result } = renderHook(() => useSkillsStore());
        const execution2: SkillExecution = {
          ...mockSkillExecution,
          id: 'exec-2',
          skillSlug: 'deploy-production',
        };
        const execution3: SkillExecution = {
          ...mockSkillExecution,
          id: 'exec-3',
          skillSlug: 'git-workflow',
        };

        act(() => {
          result.current.startExecution(mockSkillExecution);
          result.current.startExecution(execution2);
          result.current.startExecution(execution3);
        });

        const executions = result.current.executionsBySession['session-1'];
        expect(executions).toHaveLength(3);
      });

      it('preserves execution order', () => {
        const { result } = renderHook(() => useSkillsStore());
        const execution2: SkillExecution = {
          ...mockSkillExecution,
          id: 'exec-2',
        };

        act(() => {
          result.current.startExecution(mockSkillExecution);
          result.current.startExecution(execution2);
        });

        const executions = result.current.executionsBySession['session-1'];
        expect(executions?.[0]?.id).toBe('exec-2');
        expect(executions?.[1]?.id).toBe('exec-1');
      });
    });

    describe('getActiveExecutions', () => {
      beforeEach(() => {
        const { result } = renderHook(() => useSkillsStore());
        const pendingExec: SkillExecution = {
          ...mockSkillExecution,
          id: 'exec-pending',
          status: 'pending',
        };
        const runningExec: SkillExecution = {
          ...mockSkillExecution,
          id: 'exec-running',
          status: 'running',
        };
        const completedExec: SkillExecution = {
          ...mockSkillExecution,
          id: 'exec-completed',
          status: 'completed',
        };
        const failedExec: SkillExecution = {
          ...mockSkillExecution,
          id: 'exec-failed',
          status: 'failed',
        };

        act(() => {
          result.current.startExecution(pendingExec);
          result.current.startExecution(runningExec);
          result.current.startExecution(completedExec);
          result.current.startExecution(failedExec);
        });
      });

      it('returns only pending and running executions', () => {
        const { result } = renderHook(() => useSkillsStore());
        const active = result.current.getActiveExecutions('session-1');
        expect(active).toHaveLength(2);
      });

      it('excludes completed executions', () => {
        const { result } = renderHook(() => useSkillsStore());
        const active = result.current.getActiveExecutions('session-1');
        expect(active.some((e) => e.status === 'completed')).toBe(false);
      });

      it('excludes failed executions', () => {
        const { result } = renderHook(() => useSkillsStore());
        const active = result.current.getActiveExecutions('session-1');
        expect(active.some((e) => e.status === 'failed')).toBe(false);
      });

      it('returns empty array for session with no executions', () => {
        const { result } = renderHook(() => useSkillsStore());
        const active = result.current.getActiveExecutions('non-existent-session');
        expect(active).toEqual([]);
      });
    });

    describe('getExecution', () => {
      beforeEach(() => {
        const { result } = renderHook(() => useSkillsStore());
        act(() => {
          result.current.startExecution(mockSkillExecution);
          result.current.startExecution(mockRunningExecution);
        });
      });

      it('returns execution by ID', () => {
        const { result } = renderHook(() => useSkillsStore());
        const execution = result.current.getExecution('session-1', 'exec-1');
        expect(execution).toEqual(mockSkillExecution);
      });

      it('returns undefined for non-existent execution', () => {
        const { result } = renderHook(() => useSkillsStore());
        const execution = result.current.getExecution('session-1', 'non-existent');
        expect(execution).toBeUndefined();
      });

      it('returns undefined for non-existent session', () => {
        const { result } = renderHook(() => useSkillsStore());
        const execution = result.current.getExecution('non-existent', 'exec-1');
        expect(execution).toBeUndefined();
      });
    });

    describe('clearSessionExecutions', () => {
      beforeEach(() => {
        const { result } = renderHook(() => useSkillsStore());
        act(() => {
          result.current.startExecution(mockSkillExecution);
          result.current.startExecution({ ...mockSkillExecution, id: 'exec-2' });
        });
      });

      it('clears all executions for session', () => {
        const { result } = renderHook(() => useSkillsStore());

        act(() => {
          result.current.clearSessionExecutions('session-1');
        });

        expect(result.current.executionsBySession['session-1']).toBeUndefined();
      });

      it('does not affect other sessions', () => {
        const { result } = renderHook(() => useSkillsStore());
        const session2Execution: SkillExecution = {
          ...mockSkillExecution,
          id: 'exec-session2',
          sessionId: 'session-2',
        };

        act(() => {
          result.current.startExecution(session2Execution);
          result.current.clearSessionExecutions('session-1');
        });

        expect(result.current.executionsBySession['session-2']).toHaveLength(1);
      });

      it('handles clearing non-existent session gracefully', () => {
        const { result } = renderHook(() => useSkillsStore());

        expect(() => {
          act(() => {
            result.current.clearSessionExecutions('non-existent');
          });
        }).not.toThrow();
      });
    });
  });

  // ========================================================================
  // Skill Discovery and Metadata
  // ========================================================================

  describe('Skill Discovery and Metadata', () => {
    describe('Skill Metadata', () => {
      it('stores skill with metadata', () => {
        const { result } = renderHook(() => useSkillsStore());

        act(() => {
          result.current.setSkills([mockSystemSkill]);
        });

        const skill = result.current.skills[0];
        expect(skill?.metadata?.category).toBe('code-quality');
        expect(skill?.metadata?.estimatedDuration).toBe(60000);
        expect(skill?.metadata?.requiresApproval).toBe(false);
      });

      it('handles skills without metadata', () => {
        const { result } = renderHook(() => useSkillsStore());
        const skillWithoutMeta: Skill = {
          ...mockSystemSkill,
          metadata: undefined,
        };

        act(() => {
          result.current.setSkills([skillWithoutMeta]);
        });

        expect(result.current.skills[0]?.metadata).toBeUndefined();
      });
    });

    describe('Required Tools and Context', () => {
      it('stores required tools', () => {
        const { result } = renderHook(() => useSkillsStore());

        act(() => {
          result.current.setSkills([mockSystemSkill]);
        });

        const skill = result.current.skills[0];
        expect(skill?.requiredTools).toContain('grep');
        expect(skill?.requiredTools).toContain('ast-parser');
      });

      it('stores required context', () => {
        const { result } = renderHook(() => useSkillsStore());

        act(() => {
          result.current.setSkills([mockUserSkill]);
        });

        const skill = result.current.skills[0];
        expect(skill?.requiredContext).toContain('git');
        expect(skill?.requiredContext).toContain('workspace');
      });
    });

    describe('Skill Triggers', () => {
      it('stores skill triggers', () => {
        const { result } = renderHook(() => useSkillsStore());

        act(() => {
          result.current.setSkills([mockSystemSkill]);
        });

        const skill = result.current.skills[0];
        expect(skill?.triggers).toContain('/review');
        expect(skill?.triggers).toContain('review code');
      });

      it('finds skills by trigger', () => {
        const { result } = renderHook(() => useSkillsStore());

        act(() => {
          result.current.setSkills([mockSystemSkill, mockUserSkill]);
        });

        const skill = result.current.skills.find((s) => s.triggers.includes('/deploy'));
        expect(skill?.slug).toBe('deploy-production');
      });
    });

    describe('Skill Examples', () => {
      it('stores skill examples', () => {
        const { result } = renderHook(() => useSkillsStore());

        act(() => {
          result.current.setSkills([mockSystemSkill]);
        });

        const skill = result.current.skills[0];
        expect(skill?.examples).toHaveLength(1);
        expect(skill?.examples?.[0]?.input).toBe('Review this file');
        expect(skill?.examples?.[0]?.output).toBe('Analyzing code structure...');
      });
    });

    describe('Skill Steps', () => {
      it('stores skill steps', () => {
        const { result } = renderHook(() => useSkillsStore());

        act(() => {
          result.current.setSkills([mockUserSkill]);
        });

        const skill = result.current.skills[0];
        expect(skill?.steps).toHaveLength(3);
        expect(skill?.steps[0]?.name).toBe('run-tests');
        expect(skill?.steps[1]?.name).toBe('build-image');
        expect(skill?.steps[2]?.name).toBe('deploy');
      });

      it('stores step parameters', () => {
        const { result } = renderHook(() => useSkillsStore());

        act(() => {
          result.current.setSkills([mockUserSkill]);
        });

        const skill = result.current.skills[0];
        const testStep = skill?.steps[0];
        expect(testStep?.parameters).toEqual({ coverage: true });
      });
    });
  });

  // ========================================================================
  // Expanded Execution View
  // ========================================================================

  describe('Expanded Execution View', () => {
    describe('setExpandedExecution', () => {
      it('sets expanded execution ID', () => {
        const { result } = renderHook(() => useSkillsStore());

        act(() => {
          result.current.setExpandedExecution('exec-1');
        });

        expect(result.current.expandedExecutionId).toBe('exec-1');
      });

      it('clears expanded execution', () => {
        const { result } = renderHook(() => useSkillsStore());

        act(() => {
          result.current.setExpandedExecution('exec-1');
          result.current.setExpandedExecution(null);
        });

        expect(result.current.expandedExecutionId).toBeNull();
      });

      it('switches between expanded executions', () => {
        const { result } = renderHook(() => useSkillsStore());

        act(() => {
          result.current.setExpandedExecution('exec-1');
          result.current.setExpandedExecution('exec-2');
        });

        expect(result.current.expandedExecutionId).toBe('exec-2');
      });
    });
  });
});
