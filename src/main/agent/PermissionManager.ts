import type { PermissionManager as Contract, PermissionRequest } from '../integrations/contracts';
export class PermissionManager implements Contract {
  private pending = new Map<string, { taskId: string; resolve: (value: 'approved' | 'denied') => void }>();
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
