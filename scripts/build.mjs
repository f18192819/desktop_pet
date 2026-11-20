import { build as viteBuild } from 'vite';
import { build } from 'esbuild';
import { buildNative } from './native.mjs';
buildNative();

await viteBuild();
await build({
  entryPoints: { main: 'src/main/entry.ts', preload: 'src/preload/preload.ts' },
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  external: ['electron'],
  outdir: 'dist/electron',
  outExtension: { '.js': '.cjs' },
  sourcemap: true,
});
