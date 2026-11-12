import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  root: 'src/renderer',
  base: './',
  publicDir: resolve('assets'),
  build: { outDir: resolve('dist/renderer'), emptyOutDir: true },
});
