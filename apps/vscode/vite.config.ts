import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  root: 'webview',
  build: {
    outDir: '../dist/webview',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'webview/index.html'),
      output: {
        entryFileNames: 'index.js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name][extname]',
      },
    },
    sourcemap: true,
    minify: 'esbuild',
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
  },
});
