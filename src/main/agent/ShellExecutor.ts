import type { ShellCommand } from '../../shared/agent';
import { SandboxLauncher } from './SandboxLauncher';
import type { ShellExecutionResult } from './SandboxLauncher';

export class ShellExecutor {
  private readonly launcher = new SandboxLauncher();
  get status() { return this.launcher.status; }
  async execute(command: Readonly<ShellCommand>, signal: AbortSignal): Promise<ShellExecutionResult> {
    return this.launcher.launch(command, signal);
  }
}
