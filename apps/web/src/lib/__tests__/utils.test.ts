/**
 * Tests for utils.ts utility functions
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  cn,
  getLanguageFromPath,
  generateId,
  getFriendlyToolName,
  formatTimestamp,
  cleanStreamingContent,
} from '../utils';

describe('cn (className utility)', () => {
  it('merges class names correctly', () => {
    expect(cn('foo', 'bar')).toBe('foo bar');
  });

  it('handles conditional classes', () => {
    expect(cn('base', true && 'active', false && 'hidden')).toBe('base active');
  });

  it('merges tailwind classes correctly', () => {
    expect(cn('px-4', 'px-2')).toBe('px-2');
    expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500');
  });

  it('handles arrays and objects', () => {
    expect(cn(['foo', 'bar'], { baz: true, qux: false })).toBe('foo bar baz');
  });

  it('handles empty inputs', () => {
    expect(cn()).toBe('');
    expect(cn('')).toBe('');
    expect(cn(null, undefined)).toBe('');
  });
});

describe('getLanguageFromPath', () => {
  it('returns typescript for .ts and .tsx files', () => {
    expect(getLanguageFromPath('file.ts')).toBe('typescript');
    expect(getLanguageFromPath('file.tsx')).toBe('typescript');
    expect(getLanguageFromPath('/src/component/Button.tsx')).toBe('typescript');
  });

  it('returns javascript for .js and .jsx files', () => {
    expect(getLanguageFromPath('file.js')).toBe('javascript');
    expect(getLanguageFromPath('file.jsx')).toBe('javascript');
  });

  it('returns python for .py files', () => {
    expect(getLanguageFromPath('main.py')).toBe('python');
    expect(getLanguageFromPath('/src/app.py')).toBe('python');
  });

  it('returns correct language for other extensions', () => {
    expect(getLanguageFromPath('file.go')).toBe('go');
    expect(getLanguageFromPath('file.rs')).toBe('rust');
    expect(getLanguageFromPath('config.json')).toBe('json');
    expect(getLanguageFromPath('config.yaml')).toBe('yaml');
    expect(getLanguageFromPath('config.yml')).toBe('yaml');
    expect(getLanguageFromPath('README.md')).toBe('markdown');
    expect(getLanguageFromPath('styles.css')).toBe('css');
    expect(getLanguageFromPath('styles.scss')).toBe('scss');
    expect(getLanguageFromPath('index.html')).toBe('html');
    expect(getLanguageFromPath('query.sql')).toBe('sql');
    expect(getLanguageFromPath('script.sh')).toBe('shell');
    expect(getLanguageFromPath('script.bash')).toBe('shell');
    expect(getLanguageFromPath('Dockerfile')).toBe('dockerfile');
  });

  it('returns plaintext for unknown extensions', () => {
    expect(getLanguageFromPath('file.unknown')).toBe('plaintext');
    expect(getLanguageFromPath('file.xyz')).toBe('plaintext');
    expect(getLanguageFromPath('noextension')).toBe('plaintext');
  });

  it('handles case insensitivity', () => {
    expect(getLanguageFromPath('file.TS')).toBe('typescript');
    expect(getLanguageFromPath('file.JSON')).toBe('json');
  });
});

describe('generateId', () => {
  it('returns a string', () => {
    expect(typeof generateId()).toBe('string');
  });

  it('returns a non-empty string', () => {
    expect(generateId().length).toBeGreaterThan(0);
  });

  it('returns different values on each call', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()));
    expect(ids.size).toBe(100);
  });

  it('returns alphanumeric characters', () => {
    const id = generateId();
    expect(id).toMatch(/^[a-z0-9]+$/);
  });
});

describe('getFriendlyToolName', () => {
  it('returns mapped name for known file tools', () => {
    expect(getFriendlyToolName('read_file')).toBe('Reading file');
    expect(getFriendlyToolName('write_file')).toBe('Writing file');
    expect(getFriendlyToolName('list_directory')).toBe('Listing directory');
    expect(getFriendlyToolName('search_code')).toBe('Searching code');
  });

  it('returns mapped name for known orchestrator tools', () => {
    expect(getFriendlyToolName('create_execution_plan')).toBe('Creating plan');
    expect(getFriendlyToolName('delegate_task')).toBe('Delegating task');
    expect(getFriendlyToolName('synthesize_results')).toBe('Synthesizing results');
  });

  it('returns mapped name for known git tools', () => {
    expect(getFriendlyToolName('git_status')).toBe('Checking git status');
    expect(getFriendlyToolName('git_commit')).toBe('Committing changes');
    expect(getFriendlyToolName('create_pr')).toBe('Creating pull request');
  });

  it('returns mapped name for known deploy tools', () => {
    expect(getFriendlyToolName('deploy_preview')).toBe('Deploying preview');
    expect(getFriendlyToolName('get_preview_status')).toBe('Checking preview status');
    expect(getFriendlyToolName('run_e2e_tests')).toBe('Running E2E tests');
  });

  it('returns mapped name for known memory tools', () => {
    expect(getFriendlyToolName('store_memory')).toBe('Storing memory');
    expect(getFriendlyToolName('recall_memory')).toBe('Recalling memory');
  });

  it('returns mapped name for known vision tools', () => {
    expect(getFriendlyToolName('analyze_screenshot')).toBe('Analyzing screenshot');
    expect(getFriendlyToolName('design_to_code')).toBe('Converting design to code');
  });

  it('converts snake_case to Title Case for unknown tools', () => {
    expect(getFriendlyToolName('some_unknown_tool')).toBe('Some Unknown Tool');
    expect(getFriendlyToolName('custom_action_name')).toBe('Custom Action Name');
  });

  it('handles single word tools', () => {
    expect(getFriendlyToolName('tool')).toBe('Tool');
  });
});

describe('formatTimestamp', () => {
  it('formats a Date object correctly', () => {
    const date = new Date('2024-01-15T10:30:00');
    const result = formatTimestamp(date);
    // Format may include AM/PM depending on locale
    expect(result).toMatch(/\d{1,2}:\d{2}/);
  });

  it('formats a string date correctly', () => {
    const result = formatTimestamp('2024-01-15T10:30:00');
    // Format may include AM/PM depending on locale
    expect(result).toMatch(/\d{1,2}:\d{2}/);
  });

  it('returns --:-- for null', () => {
    expect(formatTimestamp(null)).toBe('--:--');
  });

  it('returns --:-- for undefined', () => {
    expect(formatTimestamp(undefined)).toBe('--:--');
  });

  it('returns --:-- for invalid date string', () => {
    expect(formatTimestamp('invalid-date')).toBe('--:--');
  });
});

describe('cleanStreamingContent', () => {
  it('returns empty string for empty content', () => {
    const result = cleanStreamingContent('');
    expect(result).toEqual({ displayContent: '', isToolCallJson: false });
  });

  it('returns content as-is for normal text', () => {
    const result = cleanStreamingContent('Hello, this is a normal response.');
    expect(result).toEqual({
      displayContent: 'Hello, this is a normal response.',
      isToolCallJson: false,
    });
  });

  it('detects and replaces tool call JSON with friendly name', () => {
    const toolCallJson = '{ "name": "read_file", "arguments": { "path": "/src/file.ts" } }';
    const result = cleanStreamingContent(toolCallJson);
    expect(result.isToolCallJson).toBe(true);
    expect(result.toolName).toBe('read_file');
    expect(result.displayContent).toBe('Reading file...');
  });

  it('handles partial JSON with name', () => {
    const partialJson = '{ "name": "git_status"';
    const result = cleanStreamingContent(partialJson);
    expect(result.isToolCallJson).toBe(true);
    expect(result.toolName).toBe('git_status');
    expect(result.displayContent).toBe('Checking git status...');
  });

  it('handles JSON building without complete name', () => {
    const buildingJson = '{ "name"';
    const result = cleanStreamingContent(buildingJson);
    expect(result.isToolCallJson).toBe(true);
    expect(result.displayContent).toBe('Preparing tool call...');
  });

  it('does not treat JSON without name as tool call', () => {
    const regularJson = '{ "key": "value" }';
    const result = cleanStreamingContent(regularJson);
    expect(result.isToolCallJson).toBe(false);
  });

  it('handles whitespace around tool call JSON', () => {
    const toolCallJson = '   { "name": "write_file", "arguments": {} }   ';
    const result = cleanStreamingContent(toolCallJson);
    expect(result.isToolCallJson).toBe(true);
    expect(result.toolName).toBe('write_file');
    expect(result.displayContent).toBe('Writing file...');
  });
});
