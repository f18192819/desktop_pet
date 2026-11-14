import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
await build({ entryPoints: ['tests/core.test.ts', 'tests/chat.test.ts', 'tests/agent.test.ts'], outdir: '.test-build', outExtension: { '.js': '.cjs' }, bundle: true, platform: 'node', format: 'cjs', target: 'node22' });
const result = spawnSync(process.execPath, ['--test', '.test-build/core.test.cjs', '.test-build/chat.test.cjs', '.test-build/agent.test.cjs'], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;
