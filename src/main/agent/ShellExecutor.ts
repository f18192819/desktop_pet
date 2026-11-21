import { SandboxLauncher } from './SandboxLauncher';

export class ShellExecutor {
  private readonly launcher = new SandboxLauncher();
  get status() { return this.launcher.status; }
  execute(): never { return this.launcher.launch(); }
}
