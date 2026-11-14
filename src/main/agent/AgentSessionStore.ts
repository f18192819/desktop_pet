import { existsSync } from 'node:fs';
import type { AgentTask } from '../../shared/agent';
import { atomicWrite, preserveBroken, readJSON } from '../chat/storage';
export class AgentSessionStore {
  tasks: AgentTask[] = []; notice = '';
  constructor(private file: string) {
    if (!existsSync(file)) return;
    try {
      const data = readJSON(file) as { version: number; tasks: AgentTask[] };
      if (data.version !== 1 || !Array.isArray(data.tasks) || data.tasks.length > 100) throw new Error();
      for (const task of data.tasks) {
        if (typeof task.id !== 'string' || typeof task.root !== 'string' || !Array.isArray(task.messages) || !Array.isArray(task.tools) || !Array.isArray(task.approvals) || !Array.isArray(task.changes) || !Array.isArray(task.usage)) throw new Error();
        if (task.status === 'running' || task.status === 'waitingApproval') task.status = 'interrupted';
        for (const tool of task.tools) if (tool.status === 'running' || tool.status === 'pending') tool.status = 'interrupted';
        for (const approval of task.approvals) if (approval.status === 'pending') approval.status = 'denied';
      } this.tasks = data.tasks;
    } catch { preserveBroken(file); this.notice = '任务库损坏，已保留原文件'; }
  }
  save() { const data = JSON.stringify({ version: 1, tasks: this.tasks }); if (Buffer.byteLength(data) > 50 * 1024 * 1024) throw new Error('任务库超过 50 MiB'); atomicWrite(this.file, data); }
}
