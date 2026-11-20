import { WorkspaceSecurity } from './WorkspaceSecurity';
import type { FileChange } from '../../shared/agent';
export class WorkspaceFS {
  constructor(readonly security: WorkspaceSecurity, private changed: (change: FileChange) => void) {}
  read(path: string): string { return this.security.call('read_file', { path }) as string; }
  write(path: string, content: string): string { return this.execute('write_file', { path, content }) as string; }
  walk(path: string): string[] { return this.security.call('walk', { path }) as string[]; }
  execute(name: string, args: Record<string, string>): unknown {
    const result = this.security.call(name, args);
    if (result && typeof result === 'object' && 'change' in result && 'message' in result) {
      this.changed({ ...(result.change as FileChange), operation: name }); return result.message;
    }
    return result;
  }
}
