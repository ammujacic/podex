/**
 * Custom test assertions for CLI testing.
 */

import { expect } from 'vitest';

/**
 * Assert that output contains text (ignoring ANSI codes).
 */
export function assertContainsText(output: string, expected: string): void {
  const stripped = output.replace(/\x1b\[[0-9;]*m/g, '');
  expect(stripped).toContain(expected);
}

/**
 * Assert that output matches patterns.
 */
export function assertOutputMatches(output: string, patterns: (string | RegExp)[]): void {
  for (const pattern of patterns) {
    if (typeof pattern === 'string') {
      expect(output).toContain(pattern);
    } else {
      expect(output).toMatch(pattern);
    }
  }
}

/**
 * Assert exit code.
 */
export function assertExitCode(actual: number | null, expected: number): void {
  expect(actual).toBe(expected);
}

/**
 * Assert no error patterns in output.
 */
export function assertNoErrors(output: string): void {
  const errorPatterns = [/unhandled/i, /exception/i, /stack trace/i];

  for (const pattern of errorPatterns) {
    expect(output).not.toMatch(pattern);
  }
}
