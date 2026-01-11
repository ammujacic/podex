// ============================================================================
// AI-Powered Code Generation Utilities
// ============================================================================

interface GeneratorOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

interface DiffContext {
  stagedDiff: string;
  unstagedDiff: string;
  fileChanges: Array<{
    path: string;
    status: 'added' | 'modified' | 'deleted' | 'renamed';
    additions: number;
    deletions: number;
  }>;
  recentCommits?: Array<{
    message: string;
    hash: string;
  }>;
}

interface PRContext {
  title?: string;
  baseBranch: string;
  headBranch: string;
  commits: Array<{
    message: string;
    hash: string;
    author: string;
    date: string;
  }>;
  diffSummary: {
    filesChanged: number;
    additions: number;
    deletions: number;
  };
  diff: string;
  linkedIssues?: string[];
}

interface ErrorContext {
  errorMessage: string;
  errorStack?: string;
  codeContext?: string;
  language?: string;
  framework?: string;
}

interface DocumentationContext {
  code: string;
  language: string;
  type: 'function' | 'class' | 'module' | 'file';
  existingDocs?: string;
}

// ============================================================================
// API Client (placeholder - integrates with your backend)
// ============================================================================

async function callAI(
  prompt: string,
  systemPrompt: string,
  options?: GeneratorOptions
): Promise<string> {
  const response = await fetch('/api/ai/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      systemPrompt,
      model: options?.model || 'claude-3-sonnet',
      temperature: options?.temperature || 0.7,
      maxTokens: options?.maxTokens || 1024,
    }),
  });

  if (!response.ok) {
    throw new Error('AI generation failed');
  }

  const data = await response.json();
  return data.content;
}

// ============================================================================
// Commit Message Generator
// ============================================================================

export async function generateCommitMessage(
  context: DiffContext,
  options?: GeneratorOptions & {
    style?: 'conventional' | 'simple' | 'detailed';
    includeScope?: boolean;
    includeBody?: boolean;
  }
): Promise<{ subject: string; body?: string }> {
  const { style = 'conventional', includeScope = true, includeBody = true } = options || {};

  const systemPrompt = `You are an expert at writing clear, concise git commit messages.
Follow these guidelines:
- Use the imperative mood ("Add feature" not "Added feature")
- Keep the subject line under 50 characters if possible, max 72
- Capitalize the subject line
- Do not end the subject line with a period
${style === 'conventional' ? '- Follow Conventional Commits format: type(scope): description' : ''}
${includeBody ? '- Include a body that explains what and why (not how)' : ''}

Types for conventional commits: feat, fix, docs, style, refactor, test, chore, perf, ci, build, revert`;

  const prompt = `Generate a commit message for the following changes:

File changes:
${context.fileChanges.map((f) => `- ${f.path}: ${f.status} (+${f.additions}, -${f.deletions})`).join('\n')}

Diff summary:
${context.stagedDiff.slice(0, 3000)}${context.stagedDiff.length > 3000 ? '\n... (truncated)' : ''}

${context.recentCommits ? `Recent commit style examples:\n${context.recentCommits.map((c) => `- ${c.message}`).join('\n')}` : ''}

${includeBody ? 'Include both a subject line and body.' : 'Only provide the subject line.'}
${!includeScope ? 'Do not include a scope in parentheses.' : ''}`;

  const response = await callAI(prompt, systemPrompt, options);

  // Parse response
  const lines = response.trim().split('\n');
  const firstLine = lines[0] ?? '';
  const subject = firstLine.replace(
    /^(feat|fix|docs|style|refactor|test|chore|perf|ci|build|revert)(\([^)]+\))?:\s*/i,
    (match) => match
  );
  const body = includeBody && lines.length > 2 ? lines.slice(2).join('\n').trim() : undefined;

  return { subject, body };
}

// ============================================================================
// PR Description Generator
// ============================================================================

export async function generatePRDescription(
  context: PRContext,
  options?: GeneratorOptions & {
    template?: 'standard' | 'detailed' | 'minimal';
    includeTestPlan?: boolean;
    includeChecklist?: boolean;
  }
): Promise<{
  title: string;
  summary: string;
  changes: string[];
  testPlan?: string;
  checklist?: string[];
}> {
  const { template = 'standard', includeTestPlan = true, includeChecklist = true } = options || {};

  const systemPrompt = `You are an expert at writing clear, informative pull request descriptions.
Your descriptions should:
- Start with a brief summary of what the PR does
- List the key changes made
- Explain the motivation/context
- Include relevant technical details
${includeTestPlan ? '- Include a test plan section' : ''}
${includeChecklist ? '- Include a checklist for reviewers' : ''}

Be concise but thorough. Focus on the "why" not just the "what".`;

  const prompt = `Generate a PR description for the following:

Branch: ${context.headBranch} → ${context.baseBranch}
${context.title ? `Proposed title: ${context.title}` : ''}

Commits (${context.commits.length}):
${context.commits.map((c) => `- ${c.message}`).join('\n')}

Summary: ${context.diffSummary.filesChanged} files changed, +${context.diffSummary.additions}, -${context.diffSummary.deletions}

${context.linkedIssues?.length ? `Linked issues: ${context.linkedIssues.join(', ')}` : ''}

Diff (truncated):
${context.diff.slice(0, 4000)}${context.diff.length > 4000 ? '\n... (truncated)' : ''}

Generate a ${template} PR description with:
1. A concise title (if not provided)
2. A summary paragraph
3. A bullet list of key changes
${includeTestPlan ? '4. A test plan section' : ''}
${includeChecklist ? '5. A reviewer checklist' : ''}`;

  const response = await callAI(prompt, systemPrompt, options);

  // Parse the response (this is a simplified parser)
  const sections = response.split(/(?=^##?\s)/m);

  let title = context.title || context.headBranch;
  let summary = '';
  const changes: string[] = [];
  let testPlan = '';
  const checklist: string[] = [];

  for (const section of sections) {
    const lower = section.toLowerCase();
    if (lower.includes('title')) {
      title = (section.replace(/^##?\s*title:?\s*/i, '').split('\n')[0] ?? '').trim();
    } else if (lower.includes('summary') || lower.includes('description')) {
      summary = section.replace(/^##?\s*(summary|description):?\s*/i, '').trim();
    } else if (lower.includes('changes') || lower.includes('what')) {
      const bullets = section.match(/[-*]\s+.+/g);
      if (bullets) changes.push(...bullets.map((b) => b.replace(/^[-*]\s+/, '')));
    } else if (lower.includes('test')) {
      testPlan = section.replace(/^##?\s*test.*:?\s*/i, '').trim();
    } else if (lower.includes('checklist') || lower.includes('review')) {
      const items = section.match(/\[[\sx]\]\s+.+/gi);
      if (items) checklist.push(...items.map((i) => i.replace(/^\[[\sx]\]\s+/, '')));
    }
  }

  // Fallback parsing if structured parsing failed
  if (!summary && !changes.length) {
    summary = response.slice(0, 500);
  }

  return {
    title,
    summary,
    changes,
    testPlan: includeTestPlan ? testPlan : undefined,
    checklist: includeChecklist ? checklist : undefined,
  };
}

// ============================================================================
// Error Explanation Generator
// ============================================================================

export async function explainError(
  context: ErrorContext,
  options?: GeneratorOptions
): Promise<{
  explanation: string;
  possibleCauses: string[];
  suggestedFixes: string[];
  resources?: string[];
}> {
  const systemPrompt = `You are an expert developer who helps explain errors clearly.
Your explanations should:
- Be clear and concise
- Explain what the error means in plain language
- List possible causes
- Provide actionable fix suggestions
- Reference relevant documentation when helpful

Consider the language, framework, and context provided.`;

  const prompt = `Explain this error and help fix it:

Error: ${context.errorMessage}
${context.errorStack ? `Stack trace:\n${context.errorStack.slice(0, 1500)}` : ''}
${context.language ? `Language: ${context.language}` : ''}
${context.framework ? `Framework: ${context.framework}` : ''}
${context.codeContext ? `Code context:\n${context.codeContext.slice(0, 1000)}` : ''}

Provide:
1. A clear explanation of what this error means
2. 2-4 possible causes
3. 2-4 suggested fixes (with code if helpful)
4. Any useful documentation links`;

  const response = await callAI(prompt, systemPrompt, options);

  // Parse response
  const sections = response.split(/(?=^##?\s|\d+\.\s*\*\*)/m);

  let explanation = '';
  const possibleCauses: string[] = [];
  const suggestedFixes: string[] = [];
  const resources: string[] = [];

  for (const section of sections) {
    const lower = section.toLowerCase();
    if (lower.includes('explanation') || lower.includes('what')) {
      explanation = section.replace(/^##?\s*explanation:?\s*/i, '').trim();
    } else if (lower.includes('cause') || lower.includes('why')) {
      const bullets = section.match(/[-*]\s+.+/g);
      if (bullets) possibleCauses.push(...bullets.map((b) => b.replace(/^[-*]\s+/, '')));
    } else if (lower.includes('fix') || lower.includes('solution')) {
      const bullets = section.match(/[-*]\s+.+/g);
      if (bullets) suggestedFixes.push(...bullets.map((b) => b.replace(/^[-*]\s+/, '')));
    } else if (
      lower.includes('resource') ||
      lower.includes('link') ||
      lower.includes('documentation')
    ) {
      const urls = section.match(/https?:\/\/[^\s]+/g);
      if (urls) resources.push(...urls);
    }
  }

  // Fallback
  if (!explanation) {
    explanation = response.slice(0, 500);
  }

  return {
    explanation,
    possibleCauses,
    suggestedFixes,
    resources: resources.length > 0 ? resources : undefined,
  };
}

// ============================================================================
// Documentation Generator
// ============================================================================

export async function generateDocumentation(
  context: DocumentationContext,
  options?: GeneratorOptions & {
    format?: 'jsdoc' | 'tsdoc' | 'docstring' | 'markdown';
    includeExamples?: boolean;
  }
): Promise<string> {
  const { format = 'tsdoc', includeExamples = true } = options || {};

  const formatInstructions = {
    jsdoc: 'Use JSDoc format with @param, @returns, @throws, @example tags',
    tsdoc: 'Use TSDoc format with @param, @returns, @throws, @example tags',
    docstring: 'Use Python docstring format (Google style)',
    markdown: 'Use Markdown format suitable for README or docs',
  };

  const systemPrompt = `You are an expert at writing clear, useful code documentation.
${formatInstructions[format]}

Your documentation should:
- Start with a brief description of what the code does
- Document all parameters with types and descriptions
- Document return values
- Document any exceptions/errors that can be thrown
${includeExamples ? '- Include usage examples' : ''}
- Be concise but complete`;

  const prompt = `Generate documentation for this ${context.type}:

Language: ${context.language}
${context.existingDocs ? `Existing docs to improve:\n${context.existingDocs}\n` : ''}

Code:
\`\`\`${context.language}
${context.code}
\`\`\`

Generate ${format} documentation${includeExamples ? ' with examples' : ''}.`;

  return await callAI(prompt, systemPrompt, options);
}

// ============================================================================
// Smart Rename Suggestions
// ============================================================================

export async function suggestRenames(
  code: string,
  symbolName: string,
  language: string,
  options?: GeneratorOptions
): Promise<string[]> {
  const systemPrompt = `You are an expert at naming things in code.
Good names should:
- Be descriptive and self-documenting
- Follow the language's naming conventions
- Be concise but not cryptic
- Reflect the purpose/behavior of the code`;

  const prompt = `Suggest better names for "${symbolName}" in this ${language} code:

\`\`\`${language}
${code.slice(0, 2000)}
\`\`\`

Consider the context and purpose. Provide 3-5 suggestions, best first.
Format: one name per line, no explanations.`;

  const response = await callAI(prompt, systemPrompt, options);

  return response
    .split('\n')
    .map((line) => line.trim().replace(/^[-*\d.)\s]+/, ''))
    .filter((name) => name && name !== symbolName && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name))
    .slice(0, 5);
}

// ============================================================================
// Import Optimization
// ============================================================================

export async function optimizeImports(
  code: string,
  language: string,
  options?: GeneratorOptions
): Promise<{
  optimizedImports: string;
  removedImports: string[];
  addedImports: string[];
  reorderedImports: boolean;
}> {
  const systemPrompt = `You are an expert at organizing and optimizing imports in code.
You should:
- Remove unused imports
- Add missing imports for referenced symbols
- Group and sort imports according to conventions
- Use the most appropriate import style for the language`;

  const prompt = `Optimize the imports in this ${language} code:

\`\`\`${language}
${code}
\`\`\`

Return:
1. The optimized import section
2. List of removed imports
3. List of added imports
4. Whether imports were reordered`;

  const response = await callAI(prompt, systemPrompt, options);

  // Parse response (simplified)
  const importMatch = response.match(/```[\w]*\n([\s\S]*?)```/);
  const optimizedImports = importMatch?.[1]?.trim() ?? '';

  const removed = response.match(/removed:?\s*([\s\S]*?)(?=added|reorder|$)/i);
  const added = response.match(/added:?\s*([\s\S]*?)(?=removed|reorder|$)/i);

  return {
    optimizedImports,
    removedImports: removed?.[1]?.match(/[-*]\s+.+/g)?.map((l) => l.replace(/^[-*]\s+/, '')) ?? [],
    addedImports: added?.[1]?.match(/[-*]\s+.+/g)?.map((l) => l.replace(/^[-*]\s+/, '')) ?? [],
    reorderedImports: /reorder/i.test(response),
  };
}
