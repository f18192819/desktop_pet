import type { ShellCommand } from '../../shared/agent';

export interface ShellExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

/**
 * Release gate for command execution. The native Job fixture tests process
 * containment only. It is deliberately separate from the application.
 */
export class SandboxLauncher {
  readonly status = {
    enabled: false as const,
    reason: 'Shell 已禁用：Windows 命令沙箱尚未通过完整安全验收。',
  };

  // On abort, a backend must terminate its entire process tree and wait for it
  // and its output streams to close before settling this promise.
  async launch(_command: Readonly<ShellCommand>, signal: AbortSignal): Promise<ShellExecutionResult> {
    signal.throwIfAborted();
    throw new Error(this.status.reason);
  }
}
