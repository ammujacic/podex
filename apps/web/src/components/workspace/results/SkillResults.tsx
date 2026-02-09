/**
 * Result displays for skill tools.
 */

import React from 'react';
import { Sparkles } from 'lucide-react';
import type { ResultComponentProps } from './types';

export const ExecuteSkillResult = React.memo<ResultComponentProps>(function ExecuteSkillResult({
  result,
}) {
  const execution = result.execution as Record<string, unknown>;
  const skillName = execution?.skill_name as string;

  return (
    <div className="mt-2 p-2 rounded-md bg-accent-success/10 border border-accent-success/20">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-accent-success" />
        <span className="text-sm font-medium text-text-primary">Skill Executed</span>
        <span className="text-xs text-accent-primary ml-auto">{skillName}</span>
      </div>
    </div>
  );
});

export const ListSkillsResult = React.memo<ResultComponentProps>(function ListSkillsResult({
  result,
}) {
  const skills = (result.skills as Array<Record<string, unknown>>) || [];
  const count = result.count as number;

  return (
    <div className="mt-2 p-2 rounded-md bg-elevated border border-border-subtle">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-accent-primary" />
        <span className="text-sm font-medium text-text-primary">Available Skills</span>
        <span className="text-xs text-text-muted ml-auto">{count} skills</span>
      </div>
      {skills.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {skills.slice(0, 5).map((skill, i) => (
            <span key={i} className="px-1.5 py-0.5 rounded bg-elevated text-xs text-text-secondary">
              {skill.name as string}
            </span>
          ))}
          {skills.length > 5 && (
            <span className="text-xs text-text-muted">+{skills.length - 5}</span>
          )}
        </div>
      )}
    </div>
  );
});
