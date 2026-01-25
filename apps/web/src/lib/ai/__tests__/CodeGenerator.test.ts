/**
 * Tests for AI Code Generator
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  CodeGenerator,
  getCodeGenerator,
  generatorStyles,
  type GenerationMarker,
} from '../CodeGenerator';

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock React hooks
vi.mock('react', () => ({
  useEffect: vi.fn((fn) => fn()),
  useRef: vi.fn(() => ({ current: null })),
}));

describe('CodeGenerator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ============================================================================
  // CodeGenerator Class Tests
  // ============================================================================

  describe('CodeGenerator', () => {
    describe('constructor', () => {
      it('should create instance with default config', () => {
        const generator = new CodeGenerator();
        expect(generator).toBeInstanceOf(CodeGenerator);
      });

      it('should create instance with custom config', () => {
        const generator = new CodeGenerator({
          apiUrl: 'https://custom.api.com',
          enabled: false,
        });
        expect(generator).toBeInstanceOf(CodeGenerator);
      });

      it('should create instance with custom patterns', () => {
        const customPatterns = [/\/\/\s*CUSTOM:\s*(.+)$/i];
        const generator = new CodeGenerator({ patterns: customPatterns });
        expect(generator).toBeInstanceOf(CodeGenerator);
      });
    });

    describe('updateConfig', () => {
      it('should update configuration', () => {
        const generator = new CodeGenerator();
        generator.updateConfig({ enabled: false });
        expect(generator).toBeInstanceOf(CodeGenerator);
      });

      it('should partially update configuration', () => {
        const generator = new CodeGenerator({ enabled: true });
        generator.updateConfig({ apiUrl: 'https://new.api.com' });
        expect(generator).toBeInstanceOf(CodeGenerator);
      });
    });

    describe('findMarkers', () => {
      it('should find TODO markers', () => {
        const generator = new CodeGenerator();
        const mockModel = createMockModel([
          'function test() {',
          '  // TODO: some validation task',
          '  return true;',
          '}',
        ]);

        const markers = generator.findMarkers(mockModel as any);

        expect(markers).toHaveLength(1);
        expect(markers[0].type).toBe('todo');
        expect(markers[0].description).toBe('some validation task');
        expect(markers[0].line).toBe(2);
      });

      it('should find GENERATE markers', () => {
        const generator = new CodeGenerator();
        const mockModel = createMockModel([
          'function test() {',
          '  // GENERATE: create user authentication logic',
          '  return true;',
          '}',
        ]);

        const markers = generator.findMarkers(mockModel as any);

        expect(markers).toHaveLength(1);
        expect(markers[0].type).toBe('generate');
        expect(markers[0].description).toBe('create user authentication logic');
      });

      it('should find IMPLEMENT markers', () => {
        const generator = new CodeGenerator();
        const mockModel = createMockModel([
          'function test() {',
          '  // IMPLEMENT: sorting algorithm',
          '  return [];',
          '}',
        ]);

        const markers = generator.findMarkers(mockModel as any);

        expect(markers).toHaveLength(1);
        expect(markers[0].type).toBe('implement');
        expect(markers[0].description).toBe('sorting algorithm');
      });

      it('should find Python-style TODO markers', () => {
        const generator = new CodeGenerator();
        const mockModel = createMockModel([
          'def test():',
          '    # TODO: add error handling',
          '    pass',
        ]);

        const markers = generator.findMarkers(mockModel as any);

        expect(markers).toHaveLength(1);
        expect(markers[0].type).toBe('todo');
        expect(markers[0].description).toBe('add error handling');
      });

      it('should find Python-style GENERATE markers', () => {
        const generator = new CodeGenerator();
        const mockModel = createMockModel([
          'def test():',
          '    # GENERATE: create data processing function',
          '    pass',
        ]);

        const markers = generator.findMarkers(mockModel as any);

        expect(markers).toHaveLength(1);
        expect(markers[0].type).toBe('generate');
      });

      it('should find block comment TODO markers', () => {
        const generator = new CodeGenerator();
        const mockModel = createMockModel([
          'function test() {',
          '  /* TODO: handle edge cases */',
          '  return true;',
          '}',
        ]);

        const markers = generator.findMarkers(mockModel as any);

        expect(markers).toHaveLength(1);
        expect(markers[0].type).toBe('todo');
        expect(markers[0].description).toBe('handle edge cases');
      });

      it('should find block comment GENERATE markers', () => {
        const generator = new CodeGenerator();
        const mockModel = createMockModel([
          'function test() {',
          '  /* GENERATE: create utility function */',
          '  return true;',
          '}',
        ]);

        const markers = generator.findMarkers(mockModel as any);

        expect(markers).toHaveLength(1);
        expect(markers[0].type).toBe('generate');
      });

      it('should find multiple markers', () => {
        const generator = new CodeGenerator();
        const mockModel = createMockModel([
          'function test() {',
          '  // TODO: first task',
          '  // GENERATE: second task',
          '  // IMPLEMENT: third task',
          '  return true;',
          '}',
        ]);

        const markers = generator.findMarkers(mockModel as any);

        expect(markers).toHaveLength(3);
      });

      it('should return empty array when no markers found', () => {
        const generator = new CodeGenerator();
        const mockModel = createMockModel(['function test() {', '  return true;', '}']);

        const markers = generator.findMarkers(mockModel as any);

        expect(markers).toHaveLength(0);
      });

      it('should handle empty model', () => {
        const generator = new CodeGenerator();
        const mockModel = createMockModel([]);

        const markers = generator.findMarkers(mockModel as any);

        expect(markers).toHaveLength(0);
      });

      it('should only match first pattern per line', () => {
        const generator = new CodeGenerator();
        const mockModel = createMockModel(['// TODO: task // GENERATE: another task']);

        const markers = generator.findMarkers(mockModel as any);

        expect(markers).toHaveLength(1);
        // The type is determined by scanning the line content for keywords
        // Since 'generate' appears later in the line, it may set type to 'generate'
        // but we still only get one marker
        expect(markers[0].description).toBeTruthy();
      });

      it('should capture correct column positions', () => {
        const generator = new CodeGenerator();
        const mockModel = createMockModel(['    // TODO: indented task']);

        const markers = generator.findMarkers(mockModel as any);

        expect(markers).toHaveLength(1);
        expect(markers[0].column).toBeGreaterThan(1);
      });

      it('should handle case-insensitive patterns', () => {
        const generator = new CodeGenerator();
        const mockModel = createMockModel([
          '// todo: lowercase',
          '// TODO: uppercase',
          '// Todo: mixed case',
        ]);

        const markers = generator.findMarkers(mockModel as any);

        expect(markers).toHaveLength(3);
      });
    });

    describe('generate', () => {
      it('should generate code from description', async () => {
        const generator = new CodeGenerator();

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              completion: 'function add(a, b) { return a + b; }',
            }),
        });

        const result = await generator.generate({
          prefix: 'const math = {',
          description: 'add two numbers',
          suffix: '}',
          language: 'javascript',
        });

        expect(result.code).toBe('function add(a, b) { return a + b; }');
      });

      it('should return empty result on API error', async () => {
        const generator = new CodeGenerator();

        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 500,
        });

        const result = await generator.generate({
          prefix: 'const x = ',
          description: 'create array',
          suffix: '',
          language: 'javascript',
        });

        expect(result.code).toBe('');
        expect(result.explanation).toBe('');
      });

      it('should return empty result on network error', async () => {
        const generator = new CodeGenerator();

        mockFetch.mockRejectedValueOnce(new Error('Network error'));

        const result = await generator.generate({
          prefix: 'const x = ',
          description: 'create array',
          suffix: '',
          language: 'javascript',
        });

        expect(result.code).toBe('');
        expect(result.explanation).toBe('');
      });

      it('should include description in request', async () => {
        const generator = new CodeGenerator();

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ completion: 'test' }),
        });

        await generator.generate({
          prefix: 'const x = ',
          description: 'specific task description',
          suffix: '',
          language: 'javascript',
        });

        const calledBody = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(calledBody.prefix).toContain('specific task description');
      });

      it('should send correct max_tokens for generation', async () => {
        const generator = new CodeGenerator();

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ completion: 'test' }),
        });

        await generator.generate({
          prefix: 'const x = ',
          description: 'task',
          suffix: '',
          language: 'javascript',
        });

        const calledBody = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(calledBody.max_tokens).toBe(512);
      });
    });

    describe('createCodeActionProvider', () => {
      it('should return CodeActionProvider interface', () => {
        const generator = new CodeGenerator();
        const provider = generator.createCodeActionProvider();

        expect(provider).toHaveProperty('provideCodeActions');
        expect(typeof provider.provideCodeActions).toBe('function');
      });

      it('should return actions for markers on current line', () => {
        const generator = new CodeGenerator();
        const provider = generator.createCodeActionProvider();

        const mockModel = createMockModel([
          'function test() {',
          '  // TODO: add validation',
          '  return true;',
          '}',
        ]);

        const range = {
          startLineNumber: 2,
          startColumn: 1,
          endLineNumber: 2,
          endColumn: 1,
        };

        const result = provider.provideCodeActions(
          mockModel as any,
          range as any,
          {} as any,
          {} as any
        );

        expect(result).toHaveProperty('actions');
        expect((result as any).actions).toHaveLength(1);
      });

      it('should return empty actions for lines without markers', () => {
        const generator = new CodeGenerator();
        const provider = generator.createCodeActionProvider();

        const mockModel = createMockModel(['function test() {', '  return true;', '}']);

        const range = {
          startLineNumber: 2,
          startColumn: 1,
          endLineNumber: 2,
          endColumn: 1,
        };

        const result = provider.provideCodeActions(
          mockModel as any,
          range as any,
          {} as any,
          {} as any
        );

        expect((result as any).actions).toHaveLength(0);
      });

      it('should truncate long descriptions in action title', () => {
        const generator = new CodeGenerator();
        const provider = generator.createCodeActionProvider();

        const longDescription = 'A'.repeat(100);
        const mockModel = createMockModel([`// TODO: ${longDescription}`]);

        const range = {
          startLineNumber: 1,
          startColumn: 1,
          endLineNumber: 1,
          endColumn: 1,
        };

        const result = provider.provideCodeActions(
          mockModel as any,
          range as any,
          {} as any,
          {} as any
        );

        expect((result as any).actions[0].title).toContain('...');
        expect((result as any).actions[0].title.length).toBeLessThan(100);
      });

      it('should include command with marker info', () => {
        const generator = new CodeGenerator();
        const provider = generator.createCodeActionProvider();

        const mockModel = createMockModel(['// TODO: test task']);

        const range = {
          startLineNumber: 1,
          startColumn: 1,
          endLineNumber: 1,
          endColumn: 1,
        };

        const result = provider.provideCodeActions(
          mockModel as any,
          range as any,
          {} as any,
          {} as any
        );

        const action = (result as any).actions[0];
        expect(action.command.id).toBe('ai.generateFromComment');
        expect(action.command.arguments[0]).toHaveProperty('line');
        expect(action.command.arguments[0]).toHaveProperty('description');
      });

      it('should handle range spanning multiple lines', () => {
        const generator = new CodeGenerator();
        const provider = generator.createCodeActionProvider();

        const mockModel = createMockModel([
          '// TODO: first task',
          '// TODO: second task',
          '// TODO: third task',
        ]);

        const range = {
          startLineNumber: 1,
          startColumn: 1,
          endLineNumber: 2,
          endColumn: 1,
        };

        const result = provider.provideCodeActions(
          mockModel as any,
          range as any,
          {} as any,
          {} as any
        );

        expect((result as any).actions).toHaveLength(2);
      });
    });

    describe('createDecorations', () => {
      it('should create decorations for markers', () => {
        const generator = new CodeGenerator();
        const markers: GenerationMarker[] = [
          { line: 1, column: 1, endColumn: 20, type: 'todo', description: 'test' },
        ];

        const mockEditor = {
          createDecorationsCollection: vi.fn(() => ({ dispose: vi.fn() })),
        };

        const decorations = generator.createDecorations(markers, mockEditor as any);

        expect(mockEditor.createDecorationsCollection).toHaveBeenCalled();
        expect(decorations).toHaveProperty('dispose');
      });

      it('should create decorations with correct range', () => {
        const generator = new CodeGenerator();
        const markers: GenerationMarker[] = [
          { line: 5, column: 3, endColumn: 25, type: 'generate', description: 'test' },
        ];

        let passedDecorations: any[] = [];
        const mockEditor = {
          createDecorationsCollection: vi.fn((decorations) => {
            passedDecorations = decorations;
            return { dispose: vi.fn() };
          }),
        };

        generator.createDecorations(markers, mockEditor as any);

        expect(passedDecorations[0].range.startLineNumber).toBe(5);
        expect(passedDecorations[0].range.startColumn).toBe(3);
        expect(passedDecorations[0].range.endColumn).toBe(25);
      });

      it('should include hover message with description', () => {
        const generator = new CodeGenerator();
        const markers: GenerationMarker[] = [
          { line: 1, column: 1, endColumn: 20, type: 'todo', description: 'my task description' },
        ];

        let passedDecorations: any[] = [];
        const mockEditor = {
          createDecorationsCollection: vi.fn((decorations) => {
            passedDecorations = decorations;
            return { dispose: vi.fn() };
          }),
        };

        generator.createDecorations(markers, mockEditor as any);

        expect(passedDecorations[0].options.glyphMarginHoverMessage.value).toContain(
          'my task description'
        );
      });

      it('should handle empty markers array', () => {
        const generator = new CodeGenerator();
        const markers: GenerationMarker[] = [];

        const mockEditor = {
          createDecorationsCollection: vi.fn(() => ({ dispose: vi.fn() })),
        };

        const decorations = generator.createDecorations(markers, mockEditor as any);

        expect(mockEditor.createDecorationsCollection).toHaveBeenCalledWith([]);
        expect(decorations).toBeDefined();
      });
    });

    describe('register', () => {
      it('should register code action provider for default languages', () => {
        const generator = new CodeGenerator();
        const mockMonaco = createMockMonaco();

        const disposable = generator.register(mockMonaco as any);

        expect(mockMonaco.languages.registerCodeActionProvider).toHaveBeenCalled();
        expect(disposable).toHaveProperty('dispose');
      });

      it('should register for specific languages when provided', () => {
        const generator = new CodeGenerator();
        const mockMonaco = createMockMonaco();

        generator.register(mockMonaco as any, ['typescript', 'python']);

        expect(mockMonaco.languages.registerCodeActionProvider).toHaveBeenCalledWith(
          'typescript',
          expect.any(Object)
        );
        expect(mockMonaco.languages.registerCodeActionProvider).toHaveBeenCalledWith(
          'python',
          expect.any(Object)
        );
      });

      it('should register command for generation', () => {
        const generator = new CodeGenerator();
        const mockMonaco = createMockMonaco();

        generator.register(mockMonaco as any);

        expect(mockMonaco.editor.registerCommand).toHaveBeenCalledWith(
          'ai.generateFromComment',
          expect.any(Function)
        );
      });

      it('should dispose all providers on dispose', () => {
        const generator = new CodeGenerator();
        const mockDispose = vi.fn();
        const mockMonaco = createMockMonaco();
        mockMonaco.languages.registerCodeActionProvider.mockReturnValue({ dispose: mockDispose });
        mockMonaco.editor.registerCommand.mockReturnValue({ dispose: mockDispose });

        const disposable = generator.register(mockMonaco as any);
        disposable.dispose();

        expect(mockDispose).toHaveBeenCalled();
      });
    });
  });

  // ============================================================================
  // Singleton Instance Tests
  // ============================================================================

  describe('getCodeGenerator', () => {
    it('should return singleton instance', () => {
      const instance1 = getCodeGenerator();
      const instance2 = getCodeGenerator();

      expect(instance1).toBe(instance2);
    });

    it('should return CodeGenerator instance', () => {
      const instance = getCodeGenerator();
      expect(instance).toBeInstanceOf(CodeGenerator);
    });
  });

  // ============================================================================
  // CSS Styles Tests
  // ============================================================================

  describe('generatorStyles', () => {
    it('should export CSS styles', () => {
      expect(typeof generatorStyles).toBe('string');
    });

    it('should include generate-marker class', () => {
      expect(generatorStyles).toContain('.generate-marker');
    });

    it('should include generate-glyph class', () => {
      expect(generatorStyles).toContain('.generate-glyph');
    });

    it('should include generate-indicator class', () => {
      expect(generatorStyles).toContain('.generate-indicator');
    });
  });

  // ============================================================================
  // Command Handler Tests
  // ============================================================================

  describe('Command Handler', () => {
    it('should handle generate command with valid editor', async () => {
      const generator = new CodeGenerator();
      const mockMonaco = createMockMonaco();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ completion: 'generated code' }),
      });

      generator.register(mockMonaco as any);

      const commandHandler = mockMonaco.editor.registerCommand.mock.calls[0][1];

      const mockModel = createMockModel(['// TODO: test', 'const x = 1;']);
      const mockEditor = {
        getId: () => 'editor-1',
        getModel: () => mockModel,
        executeEdits: vi.fn(),
      };
      mockMonaco.editor.getEditors.mockReturnValue([mockEditor]);

      await commandHandler(null, { line: 1, description: 'test' });

      expect(mockFetch).toHaveBeenCalled();
    });

    it('should not execute if no editor available', async () => {
      const generator = new CodeGenerator();
      const mockMonaco = createMockMonaco();

      generator.register(mockMonaco as any);

      const commandHandler = mockMonaco.editor.registerCommand.mock.calls[0][1];
      mockMonaco.editor.getEditors.mockReturnValue([]);

      await commandHandler(null, { line: 1, description: 'test' });

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should not execute if no model available', async () => {
      const generator = new CodeGenerator();
      const mockMonaco = createMockMonaco();

      generator.register(mockMonaco as any);

      const commandHandler = mockMonaco.editor.registerCommand.mock.calls[0][1];
      const mockEditor = {
        getId: () => 'editor-1',
        getModel: () => null,
      };
      mockMonaco.editor.getEditors.mockReturnValue([mockEditor]);

      await commandHandler(null, { line: 1, description: 'test' });

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should insert generated code at correct position', async () => {
      const generator = new CodeGenerator();
      const mockMonaco = createMockMonaco();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ completion: 'new code' }),
      });

      generator.register(mockMonaco as any);

      const commandHandler = mockMonaco.editor.registerCommand.mock.calls[0][1];

      const mockModel = createMockModel(['// TODO: test', 'const x = 1;']);
      const mockEditor = {
        getId: () => 'editor-1',
        getModel: () => mockModel,
        executeEdits: vi.fn(),
      };
      mockMonaco.editor.getEditors.mockReturnValue([mockEditor]);

      await commandHandler(null, { line: 1, description: 'test' });

      expect(mockEditor.executeEdits).toHaveBeenCalledWith(
        'ai-generator',
        expect.arrayContaining([
          expect.objectContaining({
            range: expect.objectContaining({
              startLineNumber: 2,
            }),
            text: 'new code\n',
          }),
        ])
      );
    });
  });
});

// ============================================================================
// Helper Functions
// ============================================================================

function createMockModel(lines: string[]) {
  return {
    getLineCount: () => lines.length,
    getLineContent: (lineNum: number) => lines[lineNum - 1] || '',
    getLineMaxColumn: (lineNum: number) => (lines[lineNum - 1]?.length || 0) + 1,
    getValueInRange: (range: {
      startLineNumber: number;
      startColumn: number;
      endLineNumber: number;
      endColumn: number;
    }) => {
      const result: string[] = [];
      for (let i = range.startLineNumber; i <= range.endLineNumber; i++) {
        const line = lines[i - 1] || '';
        if (i === range.startLineNumber && i === range.endLineNumber) {
          result.push(line.substring(range.startColumn - 1, range.endColumn - 1));
        } else if (i === range.startLineNumber) {
          result.push(line.substring(range.startColumn - 1));
        } else if (i === range.endLineNumber) {
          result.push(line.substring(0, range.endColumn - 1));
        } else {
          result.push(line);
        }
      }
      return result.join('\n');
    },
    getLanguageId: () => 'typescript',
    getValue: () => lines.join('\n'),
    uri: { path: '/test/file.ts' },
  };
}

function createMockMonaco() {
  return {
    languages: {
      registerCodeActionProvider: vi.fn(() => ({ dispose: vi.fn() })),
    },
    editor: {
      registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
      getEditors: vi.fn(() => []),
    },
  };
}
