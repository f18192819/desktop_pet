import { build } from 'esbuild';

try {
  const result = await build({
    entryPoints: ['src/main/agent/SandboxLauncher.ts'],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    target: 'node22',
  });
  const url = 'data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64');
  const { SandboxLauncher } = await import(url);
  const launcher = new SandboxLauncher();
  const diagnostic = await launcher.detect();
  console.log(JSON.stringify({ ...diagnostic, productionShell: launcher.status }, null, 2));
} catch (error) {
  console.error('诊断失败：' + (error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
}
