import type { ShellCommand } from '../../shared/agent';

/**
 * Release gate for command execution. The native Job fixture tests process
 * containment only. It is deliberately separate from the application.
 */
export class SandboxLauncher {
  readonly status = {
    enabled: false as const,
    reason: 'Shell 已禁用：Windows 命令沙箱尚未通过完整安全验收。',
  };

  launch(_command: Readonly<ShellCommand>, signal: AbortSignal): never {
    signal.throwIfAborted();
    throw new Error(this.status.reason);
  }
}
