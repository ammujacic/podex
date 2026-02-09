/**
 * Language detection utilities for Monaco editor.
 * This file is kept separate from the editor components to avoid
 * importing Monaco packages during SSR.
 */

const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  // JavaScript/TypeScript
  js: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  mjs: 'javascript',
  cjs: 'javascript',
  mts: 'typescript',
  cts: 'typescript',

  // Web
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  sass: 'scss',
  less: 'less',
  vue: 'vue',
  svelte: 'svelte',

  // Data
  json: 'json',
  jsonc: 'jsonc',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  xml: 'xml',
  csv: 'plaintext',

  // Documentation
  md: 'markdown',
  mdx: 'markdown',
  txt: 'plaintext',
  rst: 'restructuredtext',

  // Programming languages
  py: 'python',
  pyw: 'python',
  pyi: 'python',
  rb: 'ruby',
  php: 'php',
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  scala: 'scala',
  go: 'go',
  rs: 'rust',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  hpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  cs: 'csharp',
  swift: 'swift',
  m: 'objective-c',
  mm: 'objective-cpp',

  // Shell
  sh: 'shellscript',
  bash: 'shellscript',
  zsh: 'shellscript',
  fish: 'shellscript',
  ps1: 'powershell',
  psm1: 'powershell',
  psd1: 'powershell',
  bat: 'bat',
  cmd: 'bat',

  // Config
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  cmake: 'cmake',
  env: 'dotenv',
  gitignore: 'ignore',
  editorconfig: 'ini',
  ini: 'ini',
  conf: 'ini',

  // Database
  sql: 'sql',
  graphql: 'graphql',
  gql: 'graphql',

  // Other
  lua: 'lua',
  r: 'r',
  R: 'r',
  pl: 'perl',
  pm: 'perl',
  groovy: 'groovy',
  gradle: 'groovy',
  ex: 'elixir',
  exs: 'elixir',
  erl: 'erlang',
  clj: 'clojure',
  cljs: 'clojure',
  hs: 'haskell',
  ml: 'ocaml',
  fs: 'fsharp',
  dart: 'dart',
  zig: 'zig',
  v: 'v',
  nim: 'nim',
  julia: 'julia',
  jl: 'julia',
};

/**
 * Get Monaco language ID from file path or extension.
 */
export function getLanguageFromPath(filePath: string): string {
  // Handle special filenames
  const filename = filePath.split('/').pop()?.toLowerCase() ?? '';

  if (filename === 'dockerfile' || filename.startsWith('dockerfile.')) {
    return 'dockerfile';
  }
  if (filename === 'makefile' || filename === 'gnumakefile') {
    return 'makefile';
  }
  if (filename === '.gitignore' || filename === '.dockerignore') {
    return 'ignore';
  }
  if (filename === '.env' || filename.startsWith('.env.')) {
    return 'dotenv';
  }

  // Get extension
  const ext = filename.includes('.') ? filename.split('.').pop()?.toLowerCase() : '';

  return ext ? (EXTENSION_LANGUAGE_MAP[ext] ?? 'plaintext') : 'plaintext';
}
