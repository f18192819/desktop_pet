import { build } from 'esbuild';
import { cp, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { electronEnvironment, electronPath } from './electron.mjs';
await mkdir('.test-build/electron', { recursive: true });
await cp('dist/renderer', '.test-build/renderer', { recursive: true });
await cp('dist/electron/preload.cjs', '.test-build/electron/preload.cjs');
await build({ entryPoints: ['tests/electron-smoke.ts'], outfile: '.test-build/electron/smoke.cjs', bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'] });
const env = electronEnvironment({ EMMA_TEST_PROFILE: resolve('.test-build/profile') });
for (const args of [[], ['--resume']]) {
  const status = await new Promise((resolveExit, reject) => {
    const child = spawn(electronPath, [resolve('.test-build/electron/smoke.cjs'), ...args], { env, stdio: 'inherit' });
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Electron 冒烟测试超时')); }, 45_000);
    child.on('error', error => { clearTimeout(timeout); reject(error); });
    child.on('exit', code => { clearTimeout(timeout); resolveExit(code); });
  });
  if (status !== 0) { process.exitCode = status ?? 1; break; }
}
