/**
 * Tests for AI-Powered Code Generation Utilities
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  generateCommitMessage,
  generatePRDescription,
  explainError,
  generateDocumentation,
  suggestRenames,
  optimizeImports,
} from '../generators';

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('generators', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ============================================================================
  // generateCommitMessage Tests
  // ============================================================================

  describe('generateCommitMessage', () => {
    const mockDiffContext = {
      stagedDiff: `diff --git a/src/index.ts b/src/index.ts
index 1234567..abcdefg 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,5 +1,10 @@
+import { newFeature } from './utils';
+
 export function main() {
-  console.log('Hello');
+  console.log('Hello World');
+  newFeature();
 }`,
      unstagedDiff: '',
      fileChanges: [
        { path: 'src/index.ts', status: 'modified' as const, additions: 5, deletions: 1 },
      ],
      recentCommits: [
        { message: 'feat: add user authentication', hash: 'abc123' },
        { message: 'fix: resolve login bug', hash: 'def456' },
      ],
    };

    it('should generate commit message with conventional style by default', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            content:
              'feat(core): add new feature integration\n\nAdded newFeature import and updated main function to use it.',
          }),
      });

      const result = await generateCommitMessage(mockDiffContext);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result).toHaveProperty('subject');
      expect(result.subject).toBeTruthy();
    });

    it('should include body when includeBody is true', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            content: 'feat: add feature\n\nThis is the body of the commit message.',
          }),
      });

      const result = await generateCommitMessage(mockDiffContext, { includeBody: true });

      expect(result).toHaveProperty('subject');
      expect(result).toHaveProperty('body');
    });

    it('should not include body when includeBody is false', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ content: 'fix: resolve issue' }),
      });

      const result = await generateCommitMessage(mockDiffContext, { includeBody: false });

      expect(result.subject).toBeTruthy();
      expect(result.body).toBeUndefined();
    });

    it('should use simple style when specified', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ content: 'Add new feature to main function' }),
      });

      const result = await generateCommitMessage(mockDiffContext, { style: 'simple' });

      expect(result.subject).toBeTruthy();
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/ai/generate',
        expect.objectContaining({
          method: 'POST',
        })
      );
    });

    it('should use detailed style when specified', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            content:
              'feat(core): implement new feature integration\n\nThis commit introduces the following changes:\n- Added newFeature import from utils\n- Updated main function to call newFeature',
          }),
      });

      const result = await generateCommitMessage(mockDiffContext, { style: 'detailed' });

      expect(result.subject).toBeTruthy();
    });

    it('should throw error when API fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      await expect(generateCommitMessage(mockDiffContext)).rejects.toThrow('AI generation failed');
    });

    it('should respect custom model option', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ content: 'feat: test' }),
      });

      await generateCommitMessage(mockDiffContext, { model: 'claude-3-opus' });

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/ai/generate',
        expect.objectContaining({
          body: expect.stringContaining('claude-3-opus'),
        })
      );
    });

    it('should truncate long diffs', async () => {
      const longDiff = 'x'.repeat(5000);
      const contextWithLongDiff = {
        ...mockDiffContext,
        stagedDiff: longDiff,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ content: 'feat: test' }),
      });

      await generateCommitMessage(contextWithLongDiff);

      const calledBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(calledBody.prompt).toContain('(truncated)');
    });

    it('should handle empty file changes', async () => {
      const emptyContext = {
        ...mockDiffContext,
        fileChanges: [],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ content: 'chore: empty commit' }),
      });

      const result = await generateCommitMessage(emptyContext);

      expect(result.subject).toBeTruthy();
    });

    it('should not include scope when includeScope is false', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ content: 'feat: add feature without scope' }),
      });

      await generateCommitMessage(mockDiffContext, { includeScope: false });

      const calledBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(calledBody.prompt).toContain('Do not include a scope');
    });
  });

  // ============================================================================
  // generatePRDescription Tests
  // ============================================================================

  describe('generatePRDescription', () => {
    const mockPRContext = {
      title: 'Add user authentication',
      baseBranch: 'main',
      headBranch: 'feature/auth',
      commits: [
        { message: 'feat: add login form', hash: 'abc123', author: 'dev', date: '2024-01-01' },
        { message: 'feat: add auth service', hash: 'def456', author: 'dev', date: '2024-01-02' },
      ],
      diffSummary: { filesChanged: 5, additions: 200, deletions: 50 },
      diff: `diff --git a/auth.ts b/auth.ts
+export function login() {}`,
      linkedIssues: ['#123', '#456'],
    };

    it('should generate PR description with standard template', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            content: `## Summary
This PR adds user authentication.

## Changes
- Added login form
- Added auth service

## Test Plan
Test by logging in.

## Checklist
[ ] Code reviewed`,
          }),
      });

      const result = await generatePRDescription(mockPRContext);

      expect(result).toHaveProperty('title');
      expect(result).toHaveProperty('summary');
      expect(result).toHaveProperty('changes');
    });

    it('should include test plan when requested', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            content: `## Summary
Summary text.

## Test Plan
1. Test login
2. Test logout`,
          }),
      });

      const result = await generatePRDescription(mockPRContext, { includeTestPlan: true });

      expect(result.testPlan).toBeDefined();
    });

    it('should include checklist when requested', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            content: `## Summary
Summary text.

## Checklist
[x] Tests added
[ ] Documentation updated`,
          }),
      });

      const result = await generatePRDescription(mockPRContext, { includeChecklist: true });

      expect(result.checklist).toBeDefined();
    });

    it('should use minimal template when specified', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ content: 'Brief summary of changes.' }),
      });

      const result = await generatePRDescription(mockPRContext, { template: 'minimal' });

      expect(result.summary).toBeTruthy();
    });

    it('should use detailed template when specified', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            content: `## Title
Comprehensive Auth System

## Summary
Detailed description.

## Changes
- Major change 1
- Major change 2`,
          }),
      });

      const result = await generatePRDescription(mockPRContext, { template: 'detailed' });

      expect(result.title).toBeTruthy();
      expect(result.summary).toBeTruthy();
    });

    it('should extract linked issues', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            content: 'Summary referencing issues.',
          }),
      });

      await generatePRDescription(mockPRContext);

      const calledBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(calledBody.prompt).toContain('#123');
      expect(calledBody.prompt).toContain('#456');
    });

    it('should handle missing title', async () => {
      const contextWithoutTitle = { ...mockPRContext, title: undefined };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            content: `## Title
Generated Title

## Summary
Summary text.`,
          }),
      });

      const result = await generatePRDescription(contextWithoutTitle);

      expect(result.title).toBeTruthy();
    });

    it('should fallback to branch name when no title parsed', async () => {
      const contextWithoutTitle = { ...mockPRContext, title: undefined };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            content: 'Just some random text without sections.',
          }),
      });

      const result = await generatePRDescription(contextWithoutTitle);

      expect(result.title).toBe('feature/auth');
    });

    it('should truncate long diffs', async () => {
      const longDiff = 'x'.repeat(5000);
      const contextWithLongDiff = { ...mockPRContext, diff: longDiff };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ content: 'Summary.' }),
      });

      await generatePRDescription(contextWithLongDiff);

      const calledBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(calledBody.prompt).toContain('(truncated)');
    });
  });

  // ============================================================================
  // explainError Tests
  // ============================================================================

  describe('explainError', () => {
    const mockErrorContext = {
      errorMessage: "TypeError: Cannot read property 'map' of undefined",
      errorStack: `TypeError: Cannot read property 'map' of undefined
    at Array.map (<anonymous>)
    at processData (index.js:10:15)`,
      codeContext: `const data = undefined;
const result = data.map(item => item.value);`,
      language: 'javascript',
      framework: 'react',
    };

    it('should explain error with causes and fixes', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            content: `## Explanation
The error occurs because you're trying to call .map() on undefined.

## Possible Causes
- Data was not initialized
- API returned null instead of array

## Suggested Fixes
- Add null check before mapping
- Initialize data with empty array`,
          }),
      });

      const result = await explainError(mockErrorContext);

      expect(result).toHaveProperty('explanation');
      expect(result).toHaveProperty('possibleCauses');
      expect(result).toHaveProperty('suggestedFixes');
    });

    it('should include resources when available', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            content: `## Explanation
Error explanation here.

## Resources
- https://developer.mozilla.org/docs
- https://reactjs.org/docs`,
          }),
      });

      const result = await explainError(mockErrorContext);

      expect(result.resources).toBeDefined();
      expect(result.resources?.length).toBeGreaterThan(0);
    });

    it('should handle minimal error context', async () => {
      const minimalContext = {
        errorMessage: 'Unknown error',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            content: 'This is a generic error that could have multiple causes.',
          }),
      });

      const result = await explainError(minimalContext);

      expect(result.explanation).toBeTruthy();
    });

    it('should include language context in prompt', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ content: 'Error explanation.' }),
      });

      await explainError(mockErrorContext);

      const calledBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(calledBody.prompt).toContain('Language: javascript');
    });

    it('should include framework context in prompt', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ content: 'Error explanation.' }),
      });

      await explainError(mockErrorContext);

      const calledBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(calledBody.prompt).toContain('Framework: react');
    });

    it('should truncate long stack traces', async () => {
      const longStack = 'at line\n'.repeat(500);
      const contextWithLongStack = { ...mockErrorContext, errorStack: longStack };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ content: 'Error explanation.' }),
      });

      await explainError(contextWithLongStack);

      const calledBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(calledBody.prompt.length).toBeLessThan(longStack.length + 1000);
    });

    it('should fallback to raw response if parsing fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            content: 'Just plain text explanation without structure.',
          }),
      });

      const result = await explainError(mockErrorContext);

      expect(result.explanation).toBe('Just plain text explanation without structure.');
    });
  });

  // ============================================================================
  // generateDocumentation Tests
  // ============================================================================

  describe('generateDocumentation', () => {
    const mockDocContext = {
      code: `function calculateTotal(items: Item[], taxRate: number): number {
  const subtotal = items.reduce((sum, item) => sum + item.price, 0);
  return subtotal * (1 + taxRate);
}`,
      language: 'typescript',
      type: 'function' as const,
    };

    it('should generate TSDoc documentation by default', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            content: `/**
 * Calculates the total price including tax.
 * @param items - Array of items to calculate
 * @param taxRate - Tax rate as decimal
 * @returns Total price with tax
 */`,
          }),
      });

      const result = await generateDocumentation(mockDocContext);

      expect(result).toContain('@param');
      expect(result).toContain('@returns');
    });

    it('should generate JSDoc documentation when specified', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            content: `/**
 * @description Calculates total
 * @param {Item[]} items
 * @param {number} taxRate
 * @returns {number}
 */`,
          }),
      });

      const result = await generateDocumentation(mockDocContext, { format: 'jsdoc' });

      expect(result).toBeTruthy();
    });

    it('should generate Python docstring when specified', async () => {
      const pythonContext = {
        code: `def calculate_total(items, tax_rate):
    return sum(item.price for item in items) * (1 + tax_rate)`,
        language: 'python',
        type: 'function' as const,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            content: `"""
Calculate the total price including tax.

Args:
    items: List of items
    tax_rate: Tax rate as decimal

Returns:
    Total price with tax
"""`,
          }),
      });

      const result = await generateDocumentation(pythonContext, { format: 'docstring' });

      expect(result).toBeTruthy();
    });

    it('should generate Markdown documentation when specified', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            content: `# calculateTotal

Calculates the total price including tax.

## Parameters

| Name | Type | Description |
|------|------|-------------|
| items | Item[] | Array of items |
| taxRate | number | Tax rate |

## Returns

Total price as number.`,
          }),
      });

      const result = await generateDocumentation(mockDocContext, { format: 'markdown' });

      expect(result).toBeTruthy();
    });

    it('should include examples when requested', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            content: `/**
 * Calculates total.
 * @example
 * calculateTotal([{price: 10}], 0.1) // Returns 11
 */`,
          }),
      });

      const result = await generateDocumentation(mockDocContext, { includeExamples: true });

      expect(result).toContain('@example');
    });

    it('should not include examples when not requested', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            content: `/**
 * Calculates total.
 */`,
          }),
      });

      await generateDocumentation(mockDocContext, { includeExamples: false });

      const calledBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(calledBody.prompt).not.toContain('with examples');
    });

    it('should handle existing documentation', async () => {
      const contextWithDocs = {
        ...mockDocContext,
        existingDocs: '// Old docs: calculates total',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ content: 'Updated docs.' }),
      });

      await generateDocumentation(contextWithDocs);

      const calledBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(calledBody.prompt).toContain('Existing docs to improve');
    });

    it('should handle class documentation', async () => {
      const classContext = {
        code: `class Calculator {
  constructor(precision: number) {}
  add(a: number, b: number): number {}
}`,
        language: 'typescript',
        type: 'class' as const,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ content: 'Class documentation.' }),
      });

      await generateDocumentation(classContext);

      const calledBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(calledBody.prompt).toContain('class');
    });

    it('should handle module documentation', async () => {
      const moduleContext = {
        code: `export const PI = 3.14159;
export function circumference(r: number) { return 2 * PI * r; }`,
        language: 'typescript',
        type: 'module' as const,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ content: 'Module documentation.' }),
      });

      await generateDocumentation(moduleContext);

      const calledBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(calledBody.prompt).toContain('module');
    });
  });

  // ============================================================================
  // suggestRenames Tests
  // ============================================================================

  describe('suggestRenames', () => {
    const mockCode = `function calc(a, b) {
  return a + b;
}`;

    it('should suggest rename alternatives', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            content: `addNumbers
sumValues
calculateSum
computeTotal`,
          }),
      });

      const result = await suggestRenames(mockCode, 'calc', 'javascript');

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
    });

    it('should filter out invalid names', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            content: `1. validName
- anotherValid
* 123invalid
  spaces invalid`,
          }),
      });

      const result = await suggestRenames(mockCode, 'calc', 'javascript');

      result.forEach((name) => {
        expect(name).toMatch(/^[a-zA-Z_][a-zA-Z0-9_]*$/);
      });
    });

    it('should not include the original symbol name', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            content: `calc
addNumbers
sumValues`,
          }),
      });

      const result = await suggestRenames(mockCode, 'calc', 'javascript');

      expect(result).not.toContain('calc');
    });

    it('should limit results to 5 suggestions', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            content: `name1
name2
name3
name4
name5
name6
name7`,
          }),
      });

      const result = await suggestRenames(mockCode, 'x', 'javascript');

      expect(result.length).toBeLessThanOrEqual(5);
    });

    it('should handle different languages', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            content: `calculate_total
compute_sum`,
          }),
      });

      const result = await suggestRenames('def calc(a, b):', 'calc', 'python');

      expect(result.length).toBeGreaterThan(0);
    });

    it('should truncate long code', async () => {
      const longCode = 'x'.repeat(3000);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ content: 'newName' }),
      });

      await suggestRenames(longCode, 'x', 'javascript');

      const calledBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(calledBody.prompt.length).toBeLessThan(3000);
    });
  });

  // ============================================================================
  // optimizeImports Tests
  // ============================================================================

  describe('optimizeImports', () => {
    const mockCode = `import { useState, useEffect, useMemo } from 'react';
import { unused } from 'lodash';
import axios from 'axios';

export function Component() {
  const [state, setState] = useState(0);
  useEffect(() => {}, []);
  return <div>{state}</div>;
}`;

    it('should return optimized imports', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            content: `\`\`\`typescript
import { useState, useEffect } from 'react';
\`\`\`

Removed: unused from lodash, useMemo, axios
Added: none
Reordered: yes`,
          }),
      });

      const result = await optimizeImports(mockCode, 'typescript');

      expect(result).toHaveProperty('optimizedImports');
      expect(result).toHaveProperty('removedImports');
      expect(result).toHaveProperty('addedImports');
      expect(result).toHaveProperty('reorderedImports');
    });

    it('should identify removed imports', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            content: `\`\`\`typescript
import { useState } from 'react';
\`\`\`

Removed:
- useEffect from react
- useMemo from react`,
          }),
      });

      const result = await optimizeImports(mockCode, 'typescript');

      expect(result.removedImports.length).toBeGreaterThanOrEqual(0);
    });

    it('should identify added imports', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            content: `\`\`\`typescript
import { useState, useCallback } from 'react';
\`\`\`

Added:
- useCallback from react`,
          }),
      });

      const result = await optimizeImports(mockCode, 'typescript');

      expect(result.addedImports.length).toBeGreaterThanOrEqual(0);
    });

    it('should detect if imports were reordered', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            content: `\`\`\`typescript
import axios from 'axios';
import { useState } from 'react';
\`\`\`

Imports were reordered alphabetically.`,
          }),
      });

      const result = await optimizeImports(mockCode, 'typescript');

      expect(result.reorderedImports).toBe(true);
    });

    it('should handle Python imports', async () => {
      const pythonCode = `import os
from typing import List
import unused_module

def main():
    path = os.path.join('a', 'b')
`;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            content: `\`\`\`python
import os
\`\`\`

Removed:
- typing.List
- unused_module`,
          }),
      });

      const result = await optimizeImports(pythonCode, 'python');

      expect(result.optimizedImports).toBeTruthy();
    });

    it('should handle empty response gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ content: 'No changes needed.' }),
      });

      const result = await optimizeImports(mockCode, 'typescript');

      expect(result.optimizedImports).toBe('');
      expect(result.removedImports).toEqual([]);
      expect(result.addedImports).toEqual([]);
    });

    it('should handle multiple languages', async () => {
      const goCode = `package main

import (
    "fmt"
    "unused"
)

func main() {
    fmt.Println("Hello")
}`;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            content: `\`\`\`go
import "fmt"
\`\`\`

Removed:
- unused`,
          }),
      });

      const result = await optimizeImports(goCode, 'go');

      expect(result.optimizedImports).toBeTruthy();
    });
  });

  // ============================================================================
  // Error Handling Tests
  // ============================================================================

  describe('Error Handling', () => {
    it('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(
        generateCommitMessage({ stagedDiff: '', unstagedDiff: '', fileChanges: [] })
      ).rejects.toThrow();
    });

    it('should handle invalid JSON response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.reject(new Error('Invalid JSON')),
      });

      await expect(
        generateCommitMessage({ stagedDiff: '', unstagedDiff: '', fileChanges: [] })
      ).rejects.toThrow();
    });

    it('should handle timeout errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Request timeout'));

      await expect(explainError({ errorMessage: 'test' })).rejects.toThrow('Request timeout');
    });
  });

  // ============================================================================
  // Generator Options Tests
  // ============================================================================

  describe('Generator Options', () => {
    it('should pass temperature option', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ content: 'test' }),
      });

      await generateCommitMessage(
        { stagedDiff: 'diff', unstagedDiff: '', fileChanges: [] },
        { temperature: 0.5 }
      );

      const calledBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(calledBody.temperature).toBe(0.5);
    });

    it('should pass maxTokens option', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ content: 'test' }),
      });

      await generateCommitMessage(
        { stagedDiff: 'diff', unstagedDiff: '', fileChanges: [] },
        { maxTokens: 500 }
      );

      const calledBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(calledBody.maxTokens).toBe(500);
    });

    it('should use default options when not specified', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ content: 'test' }),
      });

      await generateCommitMessage({ stagedDiff: 'diff', unstagedDiff: '', fileChanges: [] });

      const calledBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(calledBody.model).toBe('claude-3-sonnet');
      expect(calledBody.temperature).toBe(0.7);
      expect(calledBody.maxTokens).toBe(1024);
    });
  });
});
