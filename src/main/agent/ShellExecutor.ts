import type { ShellCommand } from '../../shared/agent';
import { SandboxLauncher } from './SandboxLauncher';

export class ShellExecutor {
  private readonly launcher = new SandboxLauncher();
  get status() { return this.launcher.status; }
  execute(command: Readonly<ShellCommand>, signal: AbortSignal): never {
    return this.launcher.launch(command, signal);
  }
}
