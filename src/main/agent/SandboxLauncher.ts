import { VirtualBoxSandboxProvider } from './sandbox/VirtualBoxSandboxProvider';
import type { SandboxOutput, SandboxProvider, ShellExecutionRequest, ShellExecutionResult } from './sandbox/SandboxProvider';

/**
 * Release gate for command execution. The native Job fixture tests process
 * containment only. It is deliberately separate from the application.
 */
export class SandboxLauncher {
  private readonly provider: SandboxProvider = new VirtualBoxSandboxProvider();
  readonly status = {
    enabled: false as const,
    reason: 'Shell 已禁用：Windows 命令沙箱尚未通过完整安全验收。',
  };
  detect(signal?: AbortSignal) { return this.provider.detect(signal); }

  // On abort, a backend must terminate its entire process tree and wait for it
  // and its output streams to close before settling this promise.
  async launch(_request: Readonly<ShellExecutionRequest>, signal: AbortSignal, _output?: SandboxOutput): Promise<ShellExecutionResult> {
    signal.throwIfAborted();
    throw new Error(this.status.reason);
  }
}
