/**
 * Initialize VS Code services for Monaco editor.
 *
 * This module sets up the necessary services from @codingame/monaco-vscode-api
 * to enable full VS Code API compatibility in the browser.
 *
 * IMPORTANT: All Monaco VS Code extension imports are done dynamically inside
 * initializeVSCodeServices() to avoid SSR issues. These packages access browser
 * APIs like localStorage at import time, which causes warnings during Next.js
 * static page generation.
 */

let servicesInitialized = false;
let initializationPromise: Promise<void> | null = null;
let themeRegistered = false;

/**
 * Configure Monaco environment to suppress worker warnings.
 * Monaco will fall back to main thread execution, which is fine for our use case.
 */
function configureMonacoEnvironment() {
  if (typeof window === 'undefined') return;

  type MonacoEnv = {
    getWorker: (_workerId: string, _label: string) => Worker;
  };
  const win = window as Window & { MonacoEnvironment?: MonacoEnv };
  // Setting getWorker to a function that returns a stub prevents the warning
  // The stub worker won't be used - Monaco falls back to main thread
  win.MonacoEnvironment = {
    getWorker: () => {
      // Return a minimal worker that immediately posts back empty result
      const blob = new Blob(['self.onmessage = () => self.postMessage({});'], {
        type: 'application/javascript',
      });
      return new Worker(URL.createObjectURL(blob));
    },
  };
}

/**
 * Apply Terminal Noir theme via CSS overrides.
 * Since @codingame/monaco-vscode-api uses VS Code's theming service (not Monaco's
 * standalone defineTheme API), we apply customizations through CSS.
 *
 * The key insight: Monaco with TextMate grammars uses inline styles for token colors,
 * so we need to use CSS custom properties that VS Code respects, plus aggressive
 * overrides for the default foreground color.
 */
function applyTerminalNoirTheme() {
  if (themeRegistered) return;

  try {
    const style = document.createElement('style');
    style.id = 'terminal-noir-theme';
    style.textContent = `
      /* Terminal Noir Theme - CSS Overrides for Monaco + VS Code API */

      /* Editor background */
      .monaco-editor,
      .monaco-editor .overflow-guard,
      .monaco-editor-background {
        background-color: #0d0d12 !important;
      }

      /* Set default foreground via CSS variable - doesn't override token colors */
      .monaco-editor {
        --vscode-editor-foreground: #f4f4f5;
      }

      /* Line numbers - indigo theme */
      .monaco-editor .line-numbers { color: #818cf8 !important; }
      .monaco-editor .current-line-number { color: #c7d2fe !important; font-weight: 600; }
      .monaco-editor .margin-view-overlays .line-numbers { color: #818cf8 !important; }

      /* Current line highlight */
      .monaco-editor .current-line,
      .monaco-editor .view-overlays .current-line {
        background-color: #18181b !important;
        border-left: 2px solid #6366f1 !important;
      }

      /* Selection */
      .monaco-editor .selected-text { background-color: rgba(99, 102, 241, 0.35) !important; }
      .monaco-editor .selectionHighlight { background-color: rgba(99, 102, 241, 0.25) !important; }

      /* Bracket matching */
      .monaco-editor .bracket-match {
        background-color: rgba(99, 102, 241, 0.3) !important;
        border: 1px solid #6366f1 !important;
      }

      /* Cursor */
      .monaco-editor .cursor { background-color: #8B5CF6 !important; }

      /* Indent guides */
      .monaco-editor .lines-content .cigr { background: #27272a; }
      .monaco-editor .lines-content .cigra { background: #3f3f46; }

      /* Scrollbar */
      .monaco-editor .scrollbar .slider { background: rgba(99, 102, 241, 0.2) !important; }
      .monaco-editor .scrollbar .slider:hover { background: rgba(99, 102, 241, 0.3) !important; }

      /* Minimap */
      .monaco-editor .minimap { background-color: #0d0d12 !important; }
      .monaco-editor .minimap-slider { background: rgba(99, 102, 241, 0.2) !important; }
      .monaco-editor .minimap-slider:hover { background: rgba(99, 102, 241, 0.3) !important; }

      /* Widgets (autocomplete, hover, etc) */
      .monaco-editor .monaco-editor-hover { background-color: #18181b !important; border-color: #27272a !important; }
      .monaco-editor .suggest-widget { background-color: #18181b !important; border-color: #27272a !important; }
    `;

    document.head.appendChild(style);
    themeRegistered = true;
  } catch (error) {
    console.error('[VSCode] Failed to apply Terminal Noir theme:', error);
  }
}

/**
 * Load Monaco service overrides (but not extensions yet).
 */
async function loadServiceOverrides() {
  const [
    { initialize: initializeMonacoService },
    getTextmateServiceOverride,
    getThemeServiceOverride,
    getLanguagesServiceOverride,
  ] = await Promise.all([
    import('@codingame/monaco-vscode-api/services'),
    import('@codingame/monaco-vscode-textmate-service-override').then((m) => m.default),
    import('@codingame/monaco-vscode-theme-service-override').then((m) => m.default),
    import('@codingame/monaco-vscode-languages-service-override').then((m) => m.default),
  ]);

  return {
    initializeMonacoService,
    getTextmateServiceOverride,
    getThemeServiceOverride,
    getLanguagesServiceOverride,
  };
}

/**
 * Load language grammar extensions AFTER services are initialized.
 * These extensions register themselves with the service layer.
 */
async function loadGrammarExtensions() {
  // Theme extension (provides color themes like vs-dark)
  await import('@codingame/monaco-vscode-theme-defaults-default-extension');

  // Language grammar extensions (provide syntax highlighting via TextMate grammars)
  // Load these in parallel for faster initialization
  await Promise.all([
    // Web languages
    import('@codingame/monaco-vscode-typescript-basics-default-extension'), // TypeScript & JavaScript
    import('@codingame/monaco-vscode-json-default-extension'), // JSON & JSONC
    import('@codingame/monaco-vscode-css-default-extension'), // CSS, SCSS, Less
    import('@codingame/monaco-vscode-html-default-extension'), // HTML
    import('@codingame/monaco-vscode-markdown-basics-default-extension'), // Markdown
    import('@codingame/monaco-vscode-xml-default-extension'), // XML

    // Systems programming
    import('@codingame/monaco-vscode-cpp-default-extension'), // C & C++
    import('@codingame/monaco-vscode-rust-default-extension'), // Rust
    import('@codingame/monaco-vscode-go-default-extension'), // Go

    // JVM languages
    import('@codingame/monaco-vscode-java-default-extension'), // Java
    import('@codingame/monaco-vscode-groovy-default-extension'), // Groovy
    import('@codingame/monaco-vscode-clojure-default-extension'), // Clojure

    // .NET languages
    import('@codingame/monaco-vscode-csharp-default-extension'), // C#
    import('@codingame/monaco-vscode-fsharp-default-extension'), // F#

    // Scripting languages
    import('@codingame/monaco-vscode-python-default-extension'), // Python
    import('@codingame/monaco-vscode-ruby-default-extension'), // Ruby
    import('@codingame/monaco-vscode-php-default-extension'), // PHP
    import('@codingame/monaco-vscode-perl-default-extension'), // Perl
    import('@codingame/monaco-vscode-lua-default-extension'), // Lua
    import('@codingame/monaco-vscode-r-default-extension'), // R

    // Apple ecosystem
    import('@codingame/monaco-vscode-swift-default-extension'), // Swift
    import('@codingame/monaco-vscode-objective-c-default-extension'), // Objective-C

    // Shell & scripting
    import('@codingame/monaco-vscode-shellscript-default-extension'), // Bash, Shell
    import('@codingame/monaco-vscode-powershell-default-extension'), // PowerShell
    import('@codingame/monaco-vscode-bat-default-extension'), // Windows Batch

    // Config & data
    import('@codingame/monaco-vscode-yaml-default-extension'), // YAML
    import('@codingame/monaco-vscode-sql-default-extension'), // SQL
    import('@codingame/monaco-vscode-docker-default-extension'), // Dockerfile
    import('@codingame/monaco-vscode-make-default-extension'), // Makefile
  ]);
}

/**
 * Initialize Monaco VS Code services.
 * This should be called once at app startup before using the editor.
 *
 * Services are initialized lazily - calling this multiple times is safe.
 */
export async function initializeVSCodeServices(): Promise<void> {
  // Only run on client side
  if (typeof window === 'undefined') {
    return;
  }

  // Return early if already initialized
  if (servicesInitialized) {
    return;
  }

  // Return existing promise if initialization is in progress
  if (initializationPromise) {
    return initializationPromise;
  }

  initializationPromise = (async () => {
    try {
      // Configure Monaco environment first
      configureMonacoEnvironment();

      // Step 1: Load service overrides
      const {
        initializeMonacoService,
        getTextmateServiceOverride,
        getThemeServiceOverride,
        getLanguagesServiceOverride,
      } = await loadServiceOverrides();

      // Step 2: Initialize Monaco services with VS Code API compatibility
      // This MUST happen before loading grammar extensions
      await initializeMonacoService({
        ...getLanguagesServiceOverride(),
        ...getTextmateServiceOverride(),
        ...getThemeServiceOverride(),
      });

      // Step 3: Load grammar extensions AFTER services are initialized
      // Extensions register themselves with the service layer
      await loadGrammarExtensions();

      // Step 4: Apply custom theme
      applyTerminalNoirTheme();

      servicesInitialized = true;
    } catch (error) {
      console.error('[VSCode] Failed to initialize services:', error);
      initializationPromise = null;
      throw error;
    }
  })();

  return initializationPromise;
}

/**
 * Check if VS Code services have been initialized.
 */
export function areServicesInitialized(): boolean {
  return servicesInitialized;
}

/**
 * Get the initialization promise (for awaiting in components).
 */
export function getInitializationPromise(): Promise<void> | null {
  return initializationPromise;
}
