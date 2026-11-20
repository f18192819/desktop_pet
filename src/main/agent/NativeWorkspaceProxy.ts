import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export function nativeCall(root: string, identity: string, protectedRoots: readonly string[], op: string, args: Record<string, string>): unknown {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('文件代理仅支持 Windows x64；禁止退回 Node 文件操作');
  const packaged = resolve(__dirname, '../native/Emma.WorkspaceProxy.exe');
  const executable = existsSync(packaged) ? packaged : resolve(__dirname, '../dist/native/Emma.WorkspaceProxy.exe');
  const executableDirectory = dirname(executable);
  const excluded = [...protectedRoots, executableDirectory];
  const env: NodeJS.ProcessEnv = {};
  for (const name of ['SystemRoot', 'WINDIR']) if (process.env[name]) env[name] = process.env[name];
  const result = spawnSync(executable, [], {
    input: JSON.stringify({ root, identity, protectedRoots: excluded, op, args }) + '\n',
    cwd: executableDirectory, encoding: 'utf8', env, windowsHide: true,
    timeout: 30_000, maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error && 'code' in result.error && result.error.code === 'ENOENT') throw new Error('找不到原生文件代理，请重新构建或安装应用');
  if (result.error || result.signal || !result.stdout) throw new Error('未收到原生文件代理的结果。若是写操作，请检查文件现状再重试');
  let response: { ok: boolean; result: unknown; error?: string };
  try { response = JSON.parse(result.stdout.replace(/^\uFEFF/, '')); } catch { throw new Error('原生文件代理响应无效。若是写操作，请检查文件现状再重试'); }
  if (result.status !== 0 || !response.ok) throw new Error(response.error ?? '原生文件操作被拒绝');
  return response.result;
}
