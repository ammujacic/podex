/**
 * Tests for useKeybindingsSync hook and getKeybindingInfo.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  useKeybindingsSync,
  getKeybindingInfo,
  EDITOR_COMMANDS,
  APP_COMMANDS,
} from '../useKeybindingsSync';
import { useKeybindingsStore } from '@/stores/keybindings';

const mockClearAllKeybindings = vi.hoisted(() => vi.fn());
const mockRegisterKeybinding = vi.hoisted(() => vi.fn());

vi.mock('@/lib/keybindings', () => ({
  keybindingManager: {
    clearAllKeybindings: mockClearAllKeybindings,
    registerKeybinding: mockRegisterKeybinding,
  },
}));

const mockKeybindings = [
  {
    id: 'search.find',
    keys: ['Cmd+F'],
    command: 'search.find',
    label: 'Find',
    category: 'Search',
    when: undefined,
  },
  {
    id: 'file.save',
    keys: ['Cmd+S'],
    command: 'file.save',
    label: 'Save',
    category: 'File',
    when: undefined,
  },
];

const defaultKeybindingsState = { keybindings: mockKeybindings };

vi.mock('@/stores/keybindings', () => ({
  useKeybindingsStore: vi.fn((selector: (s: { keybindings: typeof mockKeybindings }) => unknown) =>
    selector(defaultKeybindingsState)
  ),
}));

describe('useKeybindingsSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useKeybindingsStore).mockImplementation((selector) =>
      selector(defaultKeybindingsState)
    );
  });

  it('calls clearAllKeybindings and registerKeybinding on mount', () => {
    renderHook(() => useKeybindingsSync());

    expect(mockClearAllKeybindings).toHaveBeenCalled();
    expect(mockRegisterKeybinding).toHaveBeenCalledTimes(mockKeybindings.length);
    expect(mockRegisterKeybinding).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'search.find',
        key: 'mod+f',
        command: 'editor.find',
        description: 'Find',
        category: 'Search',
      })
    );
    expect(mockRegisterKeybinding).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'file.save',
        key: 'mod+s',
        command: 'file.save',
        description: 'Save',
        category: 'File',
      })
    );
  });

  it('converts Cmd to mod and preserves category', () => {
    vi.mocked(useKeybindingsStore).mockImplementation(
      (selector: (s: { keybindings: typeof mockKeybindings }) => unknown) =>
        selector({
          keybindings: [
            {
              id: 'editor.selectAll',
              keys: ['Meta+A'],
              command: 'editor.selectAll',
              label: 'Select All',
              category: 'Editor',
              when: 'editorFocus',
            },
          ],
        })
    );

    renderHook(() => useKeybindingsSync());

    expect(mockRegisterKeybinding).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'editor.selectAll',
        key: 'mod+a',
        command: 'editor.selectAll',
        when: 'editorFocus',
        category: 'Editor',
      })
    );
  });
});

describe('getKeybindingInfo', () => {
  it('returns isEditorCommand true for editor command', () => {
    const binding = {
      id: 'editor.undo',
      keys: ['Cmd+Z'],
      command: 'editor.undo',
      label: 'Undo',
      category: 'Editor',
      when: undefined,
    };
    const info = getKeybindingInfo(binding);
    expect(info.isEditorCommand).toBe(true);
    expect(EDITOR_COMMANDS.has('editor.undo')).toBe(true);
    expect(info.badgeLabel).toBe('Editor');
  });

  it('returns isAppCommand true for app command', () => {
    const binding = {
      id: 'file.save',
      keys: ['Cmd+S'],
      command: 'file.save',
      label: 'Save',
      category: 'File',
      when: undefined,
    };
    const info = getKeybindingInfo(binding);
    expect(info.isAppCommand).toBe(true);
    expect(APP_COMMANDS.has('file.save')).toBe(true);
    expect(info.badgeLabel).toBe('App');
  });

  it('returns Editor for search.find (editor command only)', () => {
    const binding = {
      id: 'search.find',
      keys: ['Cmd+F'],
      command: 'search.find',
      label: 'Find',
      category: 'Search',
      when: undefined,
    };
    const info = getKeybindingInfo(binding);
    expect(info.isEditorCommand).toBe(true);
    expect(info.isAppCommand).toBe(false);
    expect(info.badgeLabel).toBe('Editor');
  });

  it('returns App for unknown command id', () => {
    const binding = {
      id: 'custom.myCommand',
      keys: ['Ctrl+K'],
      command: 'custom.myCommand',
      label: 'Custom',
      category: 'Custom',
      when: undefined,
    };
    const info = getKeybindingInfo(binding);
    expect(info.isEditorCommand).toBe(false);
    expect(info.isAppCommand).toBe(false);
    expect(info.badgeLabel).toBe('App');
  });
});
