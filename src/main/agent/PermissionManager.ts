import type { PermissionManager as Contract, PermissionRequest } from '../integrations/contracts';
import type { FileTool, OperationPath, PermissionKey, ToolPermissions } from '../../shared/agent';
export class PermissionManager implements Contract {
  private pending = new Map<string, { taskId: string; resolve: (value: 'approved' | 'denied') => void }>();
  needsApproval(permissions: ToolPermissions, tool: FileTool, paths: readonly OperationPath[]): boolean {
    const required: PermissionKey[] = [tool];
    if (tool === 'copy_path') required.push('read_file');
    if (paths.some(path => path.outsideWorkspace && path.access === 'read')) required.push('external_read');

    // Deny takes precedence over ask, so a blocked operation never reaches approval.
    const denied = required.find(key => permissions[key] !== 'allow' && permissions[key] !== 'ask');
    if (denied) throw new Error(`工具权限禁止：${denied === 'external_read' ? '工作区外读取' : denied}`);
    return required.some(key => permissions[key] === 'ask');
  }
  request(request: PermissionRequest, signal: AbortSignal): Promise<'approved' | 'denied'> {
    return new Promise(resolve => {
      const finish = (value: 'approved' | 'denied') => { this.pending.delete(request.id); signal.removeEventListener('abort', abort); resolve(value); };
      const abort = () => finish('denied');
      if (signal.aborted) return finish('denied');
      this.pending.set(request.id, { taskId: request.taskId, resolve: finish }); signal.addEventListener('abort', abort, { once: true });
    });
  }
  decide(id: string, approved: boolean) { const entry = this.pending.get(id); if (!entry) throw new Error('审批已过期'); entry.resolve(approved ? 'approved' : 'denied'); }
  revokeTask(taskId: string) { for (const entry of this.pending.values()) if (entry.taskId === taskId) entry.resolve('denied'); }
}
