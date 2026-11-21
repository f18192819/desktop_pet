import { SandboxLauncher } from './SandboxLauncher';
import type { SandboxOutput, ShellExecutionRequest, ShellExecutionResult } from './sandbox/SandboxProvider';

export class ShellExecutor {
  private readonly launcher = new SandboxLauncher();
  get status() { return this.launcher.status; }
  async execute(request: Readonly<ShellExecutionRequest>, signal: AbortSignal, output?: SandboxOutput): Promise<ShellExecutionResult> {
    return this.launcher.launch(request, signal, output);
  }
}
