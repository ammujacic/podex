import * as esbuild from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const config = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  sourcemap: !production,
  minify: production,
  // Bundle workspace packages
  packages: 'bundle',
  // Tree shaking
  treeShaking: true,
  // Define constants
  define: {
    'process.env.NODE_ENV': production ? '"production"' : '"development"',
  },
  // Logging
  logLevel: 'info',
};

async function main() {
  if (watch) {
    const ctx = await esbuild.context(config);
    await ctx.watch();
    console.log('Watching for changes...');
  } else {
    const result = await esbuild.build(config);
    if (result.errors.length > 0) {
      console.error('Build failed:', result.errors);
      process.exit(1);
    }
    console.log('Build complete!');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
