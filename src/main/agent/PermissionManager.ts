import type { PermissionManager as Contract, PermissionRequest } from '../integrations/contracts';
import type { FileTool, OperationPath, PermissionKey, ToolPermissions } from '../../shared/agent';

interface PermissionScope { identity: string; keys: readonly PermissionKey[] }
type Decision = 'approved' | 'denied';

export class PermissionManager implements Contract {
  private pending = new Map<string, { taskId: string; scope?: PermissionScope; resolve: (value: Decision) => void }>();
  requiredPermissions(tool: FileTool | 'shell', paths: readonly OperationPath[]): PermissionKey[] {
    const required: PermissionKey[] = [tool];
    if (tool === 'copy_path') required.push('read_file');
    if (paths.some(path => path.outsideWorkspace && path.access === 'read')) required.push('external_read');
    return required;
  }

  needsApproval(permissions: ToolPermissions, required: readonly PermissionKey[]): boolean {
    // Deny takes precedence over ask, so a blocked operation never reaches approval.
    const denied = required.find(key => permissions[key] !== 'allow' && permissions[key] !== 'ask');
    if (denied) throw new Error(`工具权限禁止：${denied === 'external_read' ? '工作区外读取' : denied}`);
    return required.some(key => permissions[key] === 'ask');
  }
  request(request: PermissionRequest, signal: AbortSignal, scope?: PermissionScope): Promise<Decision> {
    return new Promise(resolve => {
      const finish = (value: Decision) => { this.pending.delete(request.id); signal.removeEventListener('abort', abort); resolve(value); };
      const abort = () => finish('denied');
      if (signal.aborted) return finish('denied');
      this.pending.set(request.id, { taskId: request.taskId, scope, resolve: finish }); signal.addEventListener('abort', abort, { once: true });
    });
  }
  decide(id: string, approved: boolean) { const entry = this.pending.get(id); if (!entry) throw new Error('审批已过期'); entry.resolve(approved ? 'approved' : 'denied'); }
  revokeTask(taskId: string) { for (const entry of this.pending.values()) if (entry.taskId === taskId) entry.resolve('denied'); }
  revokePermission(identity: string, key: PermissionKey): string[] {
    const revoked: string[] = [];
    for (const [id, entry] of this.pending) {
      if (entry.scope?.identity !== identity || !entry.scope.keys.includes(key)) continue;
      entry.resolve('denied');
      revoked.push(id);
    }
    return revoked;
  }
}
