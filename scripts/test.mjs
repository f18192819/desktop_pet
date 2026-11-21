import { build } from 'esbuild';
import { execFile, spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { buildNative } from './native.mjs';
buildNative(true);
const compiler = join(process.env.SystemRoot ?? 'C:/Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
await promisify(execFile)(compiler, ['/nologo', '/target:exe', '/platform:x64',
  `/out:${resolve('.test-build/JobProcess.Tests.exe')}`, resolve('native/JobProcess.Tests.cs')], { windowsHide: true, timeout: 30_000 });
const tests = ['core', 'chat', 'agent', 'sandbox-protocol'];
await build({ entryPoints: tests.map(name => 'tests/' + name + '.test.ts'), outdir: '.test-build', outExtension: { '.js': '.cjs' }, bundle: true, platform: 'node', format: 'cjs', target: 'node22' });
const result = spawnSync(process.execPath, ['--test', ...tests.map(name => '.test-build/' + name + '.test.cjs')], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;
