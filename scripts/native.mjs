import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
export function buildNative(test = false) {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Workspace proxy requires Windows x64; no Node fallback');
  mkdirSync('dist/native', { recursive: true });
  const compiler = join(process.env.SystemRoot ?? 'C:/Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
  const result = spawnSync(compiler, ['/nologo', '/target:exe', '/platform:x64', '/optimize+', '/reference:System.Web.Extensions.dll', `/out:${resolve('dist/native/Emma.WorkspaceProxy.exe')}`, resolve('native/WorkspaceProxy.cs')], { stdio: 'inherit', windowsHide: true });
  if (result.status !== 0) throw new Error('Native workspace proxy compilation failed');
  if (test) {
    mkdirSync('.test-build', { recursive: true });
    const hooks = spawnSync(compiler, ['/nologo', '/target:exe', '/platform:x64', '/define:TEST_HOOKS', '/reference:System.Web.Extensions.dll', `/out:${resolve('.test-build/WorkspaceProxy.Test.exe')}`, resolve('native/WorkspaceProxy.cs')], { stdio: 'inherit', windowsHide: true });
    if (hooks.status !== 0) throw new Error('Native race fixture compilation failed');
  }
}
if (process.argv[1]?.endsWith('native.mjs')) buildNative();
