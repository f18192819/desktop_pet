import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import type { Conversation, StoredMessage } from '../../shared/chat';
import { isRecord } from '../config';
import { atomicWrite, preserveBroken, readJSON } from './storage';
import { boundedText } from './validation';

interface Data { version: 1; selectedId: string | null; sessions: Conversation[] }
export function validateId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9-]{36}$/.test(value)) throw new Error('无效的会话或请求 ID');
  return value;
}
function timestamp(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error('无效时间');
  return value;
}
function parseMessage(value: unknown): StoredMessage {
  if (!isRecord(value) || (value.role !== 'user' && value.role !== 'assistant') || typeof value.text !== 'string'
    || value.text.length > 1_000_000 || !['complete', 'streaming', 'cancelled', 'error', 'interrupted'].includes(String(value.status))) throw new Error('无效消息');
  const message: StoredMessage = { id: validateId(value.id), role: value.role, text: value.text, createdAt: timestamp(value.createdAt), status: value.status === 'streaming' ? 'interrupted' : value.status as StoredMessage['status'] };
  for (const key of ['requestId', 'error', 'model', 'provider', 'finishReason'] as const) {
    if (typeof value[key] === 'string' && value[key].length <= 500) message[key] = value[key];
  }
  if (isRecord(value.usage) && ['prompt', 'completion', 'total'].every(k => Number.isSafeInteger((value.usage as Record<string, unknown>)[k]) && Number((value.usage as Record<string, unknown>)[k]) >= 0)) {
    message.usage = { prompt: Number(value.usage.prompt), completion: Number(value.usage.completion), total: Number(value.usage.total) };
  }
  return message;
}
export class ConversationStore {
  data: Data = { version: 1, selectedId: null, sessions: [] };
  notice: string | null = null;
  constructor(private file: string) {
    if (!existsSync(file)) return;
    try {
      const data = readJSON(file);
      if (!isRecord(data) || data.version !== 1 || !Array.isArray(data.sessions) || data.sessions.length > 100) throw new Error();
      const sessions = data.sessions.map((value: unknown): Conversation => {
        if (!isRecord(value) || !Array.isArray(value.messages) || value.messages.length > 2000) throw new Error();
        return { id: validateId(value.id), title: boundedText(value.title, 80, '会话名称'), createdAt: timestamp(value.createdAt), updatedAt: timestamp(value.updatedAt), messages: value.messages.map(parseMessage) };
      });
      if (new Set(sessions.map(s => s.id)).size !== sessions.length) throw new Error();
      this.data = { version: 1, sessions, selectedId: sessions.some(s => s.id === data.selectedId) ? String(data.selectedId) : sessions[0]?.id ?? null };
    } catch {
      preserveBroken(file);
      this.notice = '会话文件无法读取，已保留损坏文件并创建空会话库。';
    }
  }
  private write(data: Data): void {
    const text = JSON.stringify(data);
    if (Buffer.byteLength(text, 'utf8') > 50 * 1024 * 1024) throw new Error('会话库超过 50 MB，请删除不需要的会话');
    atomicWrite(this.file, text);
  }
  save(): void { this.write(this.data); }
  transaction(edit: (data: Data) => void): void {
    const next = structuredClone(this.data);
    edit(next);
    this.write(next);
    this.data = next;
  }
  get(id: string): Conversation {
    const session = this.data.sessions.find(s => s.id === id);
    if (!session) throw new Error('会话不存在');
    return session;
  }
  create(): void {
    if (this.data.sessions.length >= 100) throw new Error('会话已达到 100 个，请删除不需要的会话');
    const session: Conversation = { id: randomUUID(), title: '新会话', createdAt: Date.now(), updatedAt: Date.now(), messages: [] };
    this.transaction(data => { data.sessions.unshift(session); data.selectedId = session.id; });
  }
  select(id: string): void { this.get(id); this.transaction(data => { data.selectedId = id; }); }
  rename(id: string, title: string): void {
    this.get(id); this.transaction(data => { const s = data.sessions.find(s => s.id === id)!; s.title = title; s.updatedAt = Date.now(); });
  }
  delete(id: string): void {
    this.get(id); this.transaction(data => { data.sessions = data.sessions.filter(s => s.id !== id); if (data.selectedId === id) data.selectedId = data.sessions[0]?.id ?? null; });
  }
}
