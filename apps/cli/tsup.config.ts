import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'bin/podex': 'bin/podex.ts',
    'src/index': 'src/index.ts',
  },
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node20',
  shims: true,
  // Bundle workspace dependencies so they're included in the CLI
  noExternal: ['@podex/api-client', '@podex/shared', '@podex/state', '@podex/local-pod-discovery'],
  banner: {
    js: '#!/usr/bin/env node',
  },
  esbuildOptions(options) {
    // Only add banner to the CLI entry point
    options.banner = {
      js: options.entryPoints?.toString().includes('podex') ? '#!/usr/bin/env node' : '',
    };
  },
});
