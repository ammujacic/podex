/**
 * React hook for skill execution WebSocket events.
 * Handles real-time updates for skill execution progress.
 */

import { useEffect, useCallback, useRef } from 'react';
import { useSkillsStore, type SkillExecution } from '@/stores/skills';
import { onSocketEvent } from '@/lib/socket';
import { getAvailableSkills } from '@/lib/api';

// Socket event types for skills
interface SkillStartEvent {
  session_id: string;
  agent_id: string;
  message_id: string;
  skill_name: string;
  skill_slug: string;
  total_steps: number;
}

interface SkillStepEvent {
  session_id: string;
  agent_id: string;
  message_id: string;
  step_name: string;
  step_index: number;
  step_status: 'running' | 'success' | 'failed' | 'skipped' | 'error';
}

interface SkillCompleteEvent {
  session_id: string;
  agent_id: string;
  message_id: string;
  skill_name: string;
  skill_slug: string;
  success: boolean;
  duration_ms: number;
}

interface UseSkillSocketOptions {
  sessionId: string;
}

/**
 * Hook to handle skill execution WebSocket events.
 * Updates the skills store when skill events are received.
 */
export function useSkillSocket({ sessionId }: UseSkillSocketOptions) {
  const startExecution = useSkillsStore((state) => state.startExecution);
  const updateExecutionStep = useSkillsStore((state) => state.updateExecutionStep);
  const completeExecution = useSkillsStore((state) => state.completeExecution);

  // Track active executions by message_id to map events
  const executionMapRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    if (!sessionId) return;

    // Handle skill start events
    const unsubStart = onSocketEvent('skill_start', (data: SkillStartEvent) => {
      if (data.session_id !== sessionId) return;

      // Create a new execution ID
      const executionId = `exec-${data.skill_slug}-${Date.now()}`;
      executionMapRef.current.set(data.message_id, executionId);

      const execution: SkillExecution = {
        id: executionId,
        skillSlug: data.skill_slug,
        skillName: data.skill_name,
        sessionId: data.session_id,
        agentId: data.agent_id,
        status: 'running',
        currentStepIndex: 0,
        currentStepName: '',
        totalSteps: data.total_steps,
        stepsCompleted: 0,
        startedAt: new Date(),
        results: [],
      };

      startExecution(execution);
    });

    // Handle skill step events
    const unsubStep = onSocketEvent('skill_step', (data: SkillStepEvent) => {
      if (data.session_id !== sessionId) return;

      const executionId = executionMapRef.current.get(data.message_id);
      if (!executionId) return;

      updateExecutionStep(
        sessionId,
        executionId,
        data.step_name,
        data.step_index,
        data.step_status
      );
    });

    // Handle skill complete events
    const unsubComplete = onSocketEvent('skill_complete', (data: SkillCompleteEvent) => {
      if (data.session_id !== sessionId) return;

      const executionId = executionMapRef.current.get(data.message_id);
      if (!executionId) return;

      completeExecution(sessionId, executionId, data.success, data.duration_ms);

      // Clean up the mapping after a delay (keep for a bit for late events)
      setTimeout(() => {
        executionMapRef.current.delete(data.message_id);
      }, 5000);
    });

    return () => {
      unsubStart();
      unsubStep();
      unsubComplete();
    };
  }, [sessionId, startExecution, updateExecutionStep, completeExecution]);
}

/**
 * Hook to load available skills from the API.
 */
export function useLoadSkills() {
  const setSkills = useSkillsStore((state) => state.setSkills);
  const setSkillsLoading = useSkillsStore((state) => state.setSkillsLoading);
  const setSkillsError = useSkillsStore((state) => state.setSkillsError);

  const loadSkills = useCallback(async () => {
    setSkillsLoading(true);
    try {
      const data = await getAvailableSkills();

      // Transform API response to store format
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const skills = data.skills.map((s: any) => ({
        id: s.id,
        name: s.name,
        slug: s.slug,
        description: s.description,
        version: s.version || '1.0.0',
        author: s.author || 'system',
        skillType: s.skill_type,
        tags: s.tags || [],
        triggers: s.triggers || [],
        requiredTools: s.required_tools || [],
        requiredContext: s.required_context || [],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        steps: (s.steps || []).map((step: any) => ({
          name: step.name,
          description: step.description,
          tool: step.tool,
          skill: step.skill,
          parameters: step.parameters || {},
          condition: step.condition,
          onSuccess: step.on_success,
          onFailure: step.on_failure,
          parallelWith: step.parallel_with,
          required: step.required ?? true,
        })),
        systemPrompt: s.system_prompt,
        examples: s.examples,
        metadata: s.metadata,
        isActive: s.is_active ?? true,
        isDefault: s.is_default ?? true,
      }));

      setSkills(skills);
    } catch (err) {
      setSkillsError(err instanceof Error ? err.message : 'Failed to load skills');
    } finally {
      setSkillsLoading(false);
    }
  }, [setSkills, setSkillsLoading, setSkillsError]);

  return { loadSkills };
}
