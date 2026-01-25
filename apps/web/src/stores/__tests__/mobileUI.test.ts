import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useMobileUIStore } from '../mobileUI';

describe('mobileUIStore', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    act(() => {
      useMobileUIStore.setState({
        isMobileMenuOpen: false,
        mobileActiveWidget: null,
        mobileOpenFile: null,
        mobileFileActionsTarget: null,
      });
    });
  });

  // ========================================================================
  // Initial State
  // ========================================================================

  describe('Initial State', () => {
    it('has mobile menu closed', () => {
      const { result } = renderHook(() => useMobileUIStore());
      expect(result.current.isMobileMenuOpen).toBe(false);
    });

    it('has no active widget', () => {
      const { result } = renderHook(() => useMobileUIStore());
      expect(result.current.mobileActiveWidget).toBeNull();
    });

    it('has no open file', () => {
      const { result } = renderHook(() => useMobileUIStore());
      expect(result.current.mobileOpenFile).toBeNull();
    });

    it('has no file actions target', () => {
      const { result } = renderHook(() => useMobileUIStore());
      expect(result.current.mobileFileActionsTarget).toBeNull();
    });
  });

  // ========================================================================
  // Mobile Menu
  // ========================================================================

  describe('Mobile Menu', () => {
    describe('setMobileMenuOpen', () => {
      it('opens mobile menu', () => {
        const { result } = renderHook(() => useMobileUIStore());

        act(() => {
          result.current.setMobileMenuOpen(true);
        });

        expect(result.current.isMobileMenuOpen).toBe(true);
      });

      it('closes mobile menu', () => {
        const { result } = renderHook(() => useMobileUIStore());

        act(() => {
          result.current.setMobileMenuOpen(true);
          result.current.setMobileMenuOpen(false);
        });

        expect(result.current.isMobileMenuOpen).toBe(false);
      });

      it('can toggle between states', () => {
        const { result } = renderHook(() => useMobileUIStore());

        act(() => {
          result.current.setMobileMenuOpen(true);
        });
        expect(result.current.isMobileMenuOpen).toBe(true);

        act(() => {
          result.current.setMobileMenuOpen(false);
        });
        expect(result.current.isMobileMenuOpen).toBe(false);

        act(() => {
          result.current.setMobileMenuOpen(true);
        });
        expect(result.current.isMobileMenuOpen).toBe(true);
      });
    });

    describe('toggleMobileMenu', () => {
      it('toggles menu from closed to open', () => {
        const { result } = renderHook(() => useMobileUIStore());

        act(() => {
          result.current.toggleMobileMenu();
        });

        expect(result.current.isMobileMenuOpen).toBe(true);
      });

      it('toggles menu from open to closed', () => {
        const { result } = renderHook(() => useMobileUIStore());

        act(() => {
          result.current.setMobileMenuOpen(true);
          result.current.toggleMobileMenu();
        });

        expect(result.current.isMobileMenuOpen).toBe(false);
      });

      it('toggles multiple times', () => {
        const { result } = renderHook(() => useMobileUIStore());

        act(() => {
          result.current.toggleMobileMenu();
        });
        expect(result.current.isMobileMenuOpen).toBe(true);

        act(() => {
          result.current.toggleMobileMenu();
        });
        expect(result.current.isMobileMenuOpen).toBe(false);

        act(() => {
          result.current.toggleMobileMenu();
        });
        expect(result.current.isMobileMenuOpen).toBe(true);
      });
    });
  });

  // ========================================================================
  // Mobile Widgets (Bottom Sheets)
  // ========================================================================

  describe('Mobile Widgets', () => {
    describe('openMobileWidget', () => {
      it('opens widget by id', () => {
        const { result } = renderHook(() => useMobileUIStore());

        act(() => {
          result.current.openMobileWidget('terminal');
        });

        expect(result.current.mobileActiveWidget).toBe('terminal');
      });

      it('can switch between widgets', () => {
        const { result } = renderHook(() => useMobileUIStore());

        act(() => {
          result.current.openMobileWidget('terminal');
        });
        expect(result.current.mobileActiveWidget).toBe('terminal');

        act(() => {
          result.current.openMobileWidget('files');
        });
        expect(result.current.mobileActiveWidget).toBe('files');
      });

      it('can open different widget types', () => {
        const { result } = renderHook(() => useMobileUIStore());

        const widgets = ['terminal', 'files', 'git', 'search', 'preview'];

        widgets.forEach((widget) => {
          act(() => {
            result.current.openMobileWidget(widget);
          });
          expect(result.current.mobileActiveWidget).toBe(widget);
        });
      });
    });

    describe('closeMobileWidget', () => {
      it('closes active widget', () => {
        const { result } = renderHook(() => useMobileUIStore());

        act(() => {
          result.current.openMobileWidget('terminal');
          result.current.closeMobileWidget();
        });

        expect(result.current.mobileActiveWidget).toBeNull();
      });

      it('handles closing when no widget is open', () => {
        const { result } = renderHook(() => useMobileUIStore());

        expect(() => {
          act(() => {
            result.current.closeMobileWidget();
          });
        }).not.toThrow();

        expect(result.current.mobileActiveWidget).toBeNull();
      });
    });
  });

  // ========================================================================
  // Mobile File Viewer
  // ========================================================================

  describe('Mobile File Viewer', () => {
    describe('openMobileFile', () => {
      it('opens file with content', () => {
        const { result } = renderHook(() => useMobileUIStore());

        act(() => {
          result.current.openMobileFile('/src/App.tsx', 'const App = () => {}', 'typescript');
        });

        expect(result.current.mobileOpenFile).toEqual({
          path: '/src/App.tsx',
          content: 'const App = () => {}',
          language: 'typescript',
        });
      });

      it('can open different files', () => {
        const { result } = renderHook(() => useMobileUIStore());

        act(() => {
          result.current.openMobileFile('/src/App.tsx', 'tsx content', 'typescript');
        });
        expect(result.current.mobileOpenFile?.path).toBe('/src/App.tsx');

        act(() => {
          result.current.openMobileFile('/src/utils.ts', 'utils content', 'typescript');
        });
        expect(result.current.mobileOpenFile?.path).toBe('/src/utils.ts');
      });

      it('handles different file types', () => {
        const { result } = renderHook(() => useMobileUIStore());

        const files = [
          { path: '/index.html', content: '<html></html>', language: 'html' },
          { path: '/styles.css', content: 'body {}', language: 'css' },
          { path: '/script.js', content: 'console.log()', language: 'javascript' },
          { path: '/README.md', content: '# Title', language: 'markdown' },
        ];

        files.forEach((file) => {
          act(() => {
            result.current.openMobileFile(file.path, file.content, file.language);
          });
          expect(result.current.mobileOpenFile).toEqual(file);
        });
      });
    });

    describe('closeMobileFile', () => {
      it('closes open file', () => {
        const { result } = renderHook(() => useMobileUIStore());

        act(() => {
          result.current.openMobileFile('/src/App.tsx', 'content', 'typescript');
          result.current.closeMobileFile();
        });

        expect(result.current.mobileOpenFile).toBeNull();
      });

      it('handles closing when no file is open', () => {
        const { result } = renderHook(() => useMobileUIStore());

        expect(() => {
          act(() => {
            result.current.closeMobileFile();
          });
        }).not.toThrow();

        expect(result.current.mobileOpenFile).toBeNull();
      });
    });
  });

  // ========================================================================
  // Mobile File Actions
  // ========================================================================

  describe('Mobile File Actions', () => {
    describe('openMobileFileActions', () => {
      it('opens file actions for file', () => {
        const { result } = renderHook(() => useMobileUIStore());

        act(() => {
          result.current.openMobileFileActions('/src/App.tsx', 'App.tsx', 'file');
        });

        expect(result.current.mobileFileActionsTarget).toEqual({
          path: '/src/App.tsx',
          name: 'App.tsx',
          type: 'file',
        });
      });

      it('opens file actions for directory', () => {
        const { result } = renderHook(() => useMobileUIStore());

        act(() => {
          result.current.openMobileFileActions('/src/components', 'components', 'directory');
        });

        expect(result.current.mobileFileActionsTarget).toEqual({
          path: '/src/components',
          name: 'components',
          type: 'directory',
        });
      });

      it('can switch between different targets', () => {
        const { result } = renderHook(() => useMobileUIStore());

        act(() => {
          result.current.openMobileFileActions('/src/App.tsx', 'App.tsx', 'file');
        });
        expect(result.current.mobileFileActionsTarget?.type).toBe('file');

        act(() => {
          result.current.openMobileFileActions('/src', 'src', 'directory');
        });
        expect(result.current.mobileFileActionsTarget?.type).toBe('directory');
      });

      it('handles multiple file action requests', () => {
        const { result } = renderHook(() => useMobileUIStore());

        const targets = [
          { path: '/file1.ts', name: 'file1.ts', type: 'file' as const },
          { path: '/dir1', name: 'dir1', type: 'directory' as const },
          { path: '/file2.js', name: 'file2.js', type: 'file' as const },
        ];

        targets.forEach((target) => {
          act(() => {
            result.current.openMobileFileActions(target.path, target.name, target.type);
          });
          expect(result.current.mobileFileActionsTarget).toEqual(target);
        });
      });
    });

    describe('closeMobileFileActions', () => {
      it('closes file actions', () => {
        const { result } = renderHook(() => useMobileUIStore());

        act(() => {
          result.current.openMobileFileActions('/src/App.tsx', 'App.tsx', 'file');
          result.current.closeMobileFileActions();
        });

        expect(result.current.mobileFileActionsTarget).toBeNull();
      });

      it('handles closing when no actions are open', () => {
        const { result } = renderHook(() => useMobileUIStore());

        expect(() => {
          act(() => {
            result.current.closeMobileFileActions();
          });
        }).not.toThrow();

        expect(result.current.mobileFileActionsTarget).toBeNull();
      });
    });
  });

  // ========================================================================
  // Integration Workflows
  // ========================================================================

  describe('Mobile UI Workflows', () => {
    it('handles complete file viewing workflow', () => {
      const { result } = renderHook(() => useMobileUIStore());

      // Open file from file explorer
      act(() => {
        result.current.openMobileFile('/src/App.tsx', 'const App = () => {}', 'typescript');
      });
      expect(result.current.mobileOpenFile).not.toBeNull();

      // Open actions for the file
      act(() => {
        result.current.openMobileFileActions('/src/App.tsx', 'App.tsx', 'file');
      });
      expect(result.current.mobileFileActionsTarget).not.toBeNull();

      // Close actions
      act(() => {
        result.current.closeMobileFileActions();
      });
      expect(result.current.mobileFileActionsTarget).toBeNull();

      // Close file viewer
      act(() => {
        result.current.closeMobileFile();
      });
      expect(result.current.mobileOpenFile).toBeNull();
    });

    it('handles widget switching workflow', () => {
      const { result } = renderHook(() => useMobileUIStore());

      // Open terminal widget
      act(() => {
        result.current.openMobileWidget('terminal');
      });
      expect(result.current.mobileActiveWidget).toBe('terminal');

      // Switch to files widget
      act(() => {
        result.current.openMobileWidget('files');
      });
      expect(result.current.mobileActiveWidget).toBe('files');

      // Close widget
      act(() => {
        result.current.closeMobileWidget();
      });
      expect(result.current.mobileActiveWidget).toBeNull();
    });

    it('handles independent mobile UI components', () => {
      const { result } = renderHook(() => useMobileUIStore());

      // Open menu, widget, and file simultaneously
      act(() => {
        result.current.setMobileMenuOpen(true);
        result.current.openMobileWidget('terminal');
        result.current.openMobileFile('/src/App.tsx', 'content', 'typescript');
      });

      expect(result.current.isMobileMenuOpen).toBe(true);
      expect(result.current.mobileActiveWidget).toBe('terminal');
      expect(result.current.mobileOpenFile).not.toBeNull();

      // Close all
      act(() => {
        result.current.setMobileMenuOpen(false);
        result.current.closeMobileWidget();
        result.current.closeMobileFile();
      });

      expect(result.current.isMobileMenuOpen).toBe(false);
      expect(result.current.mobileActiveWidget).toBeNull();
      expect(result.current.mobileOpenFile).toBeNull();
    });
  });
});
