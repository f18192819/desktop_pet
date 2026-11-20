import { WorkspaceSecurity } from './WorkspaceSecurity';
import type { FileChange } from '../../shared/agent';
export class WorkspaceFS {
  constructor(readonly security: WorkspaceSecurity, private changed: (change: FileChange) => void) {}
  async read(path: string, signal?: AbortSignal): Promise<string> { return await this.security.call('read_file', { path }, signal) as string; }
  async write(path: string, content: string, signal?: AbortSignal): Promise<string> { return await this.execute('write_file', { path, content }, signal) as string; }
  async walk(path: string, signal?: AbortSignal): Promise<string[]> { return await this.security.call('walk', { path }, signal) as string[]; }
  async execute(name: string, args: Record<string, string>, signal?: AbortSignal): Promise<unknown> {
    const result = await this.security.call(name, args, signal);
    if (result && typeof result === 'object' && 'change' in result && 'message' in result) {
      this.changed({ ...(result.change as FileChange), operation: name });
      signal?.throwIfAborted();
      return result.message;
    }
    signal?.throwIfAborted();
    return result;
  }
}
