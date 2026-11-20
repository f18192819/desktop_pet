import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const MAX_REQUEST = 2 * 1024 * 1024; // C# reads this many UTF-16 code units before the newline.
const MAX_STDOUT = 4 * 1024 * 1024;
const MAX_STDERR = 64 * 1024;

export class WorkspaceOperationInterrupted extends Error {
  constructor(reason: string) {
    super(`${reason}。若是写操作，请检查文件现状再重试`);
  }
}

// Main-process transport. Production always supplies a fixed executable and no arguments.
export function runProxy(executable: string, args: string[], request: string, env: NodeJS.ProcessEnv,
  signal?: AbortSignal, timeoutMs = 30_000): Promise<unknown> {
  return new Promise((resolveResult, reject) => {
    const cancellation = () => new WorkspaceOperationInterrupted('原生文件操作已取消');
    if (signal?.aborted) return reject(cancellation());
    if (request.length > MAX_REQUEST) return reject(new Error('原生文件代理请求超过大小限制'));

    const child = spawn(executable, args, {
      cwd: dirname(executable), env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let failure: Error | undefined;
    const stop = (error: Error) => {
      if (failure) return;
      failure = error;
      // This executable creates no descendants. Force termination and wait for close below.
      if (child.pid && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
    };
    const abort = () => stop(cancellation());
    const timer = setTimeout(() => stop(new WorkspaceOperationInterrupted('原生文件操作超时')), timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_STDOUT) stop(new WorkspaceOperationInterrupted('原生文件代理标准输出超过限制'));
      else stdout.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes > MAX_STDERR) stop(new WorkspaceOperationInterrupted('原生文件代理错误输出超过限制'));
    });
    const pipeError = () => stop(new WorkspaceOperationInterrupted('原生文件代理通信中断'));
    for (const pipe of [child.stdin, child.stdout, child.stderr]) pipe.on('error', pipeError);
    child.on('error', error => {
      if (child.pid) pipeError();
      else stop(new Error('无法启动原生文件代理，请检查安装或重新构建', { cause: error }));
    });
    child.once('close', (code, exitSignal) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (failure) return reject(failure);

      let response: unknown;
      try { response = JSON.parse(Buffer.concat(stdout, stdoutBytes).toString('utf8').replace(/^\uFEFF/, '')); }
      catch { return reject(new WorkspaceOperationInterrupted('原生文件代理未返回有效 JSON')); }
      if (!exitSignal && response && typeof response === 'object' && 'ok' in response) {
        if (code === 0 && response.ok === true && 'result' in response) return resolveResult(response.result);
        if (code === 1 && response.ok === false && 'error' in response && typeof response.error === 'string') {
          const message = response.error;
          const uncertain = message.startsWith('Transaction rollback') || message === 'Native filesystem proxy failed';
          return reject(uncertain ? new WorkspaceOperationInterrupted(message) : new Error(message));
        }
      }
      reject(new WorkspaceOperationInterrupted('原生文件代理异常退出或返回了无效结果'));
    });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    else child.stdin.end(request + '\n');
  });
}

export async function nativeCall(root: string, identity: string, protectedRoots: readonly string[], op: string,
  args: Record<string, string>, signal?: AbortSignal): Promise<unknown> {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('文件代理仅支持 Windows x64；禁止退回 Node 文件操作');
  const packaged = resolve(__dirname, '../native/Emma.WorkspaceProxy.exe');
  const executable = await access(packaged).then(() => packaged, () => resolve(__dirname, '../dist/native/Emma.WorkspaceProxy.exe'));
  const env: NodeJS.ProcessEnv = {};
  for (const name of ['SystemRoot', 'WINDIR']) if (process.env[name]) env[name] = process.env[name];
  const request = JSON.stringify({ root, identity, protectedRoots: [...protectedRoots, dirname(executable)], op, args });
  return runProxy(executable, [], request, env, signal);
}
