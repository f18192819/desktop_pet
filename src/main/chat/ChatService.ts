import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { ChatSnapshot, ProviderConfig, ProviderState, StoredMessage } from '../../shared/chat';
import type { PetActivityEvent } from '../../shared/types';
import type { ChatProvider } from '../integrations/contracts';
import { CredentialStore } from './CredentialStore';
import { ConversationStore } from './ConversationStore';
import { atomicWrite, preserveBroken, readJSON } from './storage';
import { validateProvider } from './validation';
import { createProvider, ProviderError, safeError } from './OpenAICompatibleProvider';
import { AgentProvider } from '../agent/AgentProvider';

const defaults: ProviderConfig = { name: 'OpenAI-Compatible', baseUrl: 'https://api.openai.com/v1', model: '', adapter: 'openai-compatible', includeUsage: true, timeoutMs: 120_000 };
interface Active { requestId: string; sessionId: string; messageId: string; controller: AbortController }
export class ChatService {
  readonly conversations: ConversationStore;
  private config: ProviderConfig = { ...defaults };
  private providerState: Omit<ProviderState, 'config' | 'hasKey' | 'encryptionAvailable'> = {
    connection: 'untested', authentication: 'unverified', lastError: null, checkedAt: null, balance: { status: 'unsupported', items: [] }, models: [],
  };
  private active: Active | null = null;
  private operation: AbortController | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private notifyTimer: ReturnType<typeof setTimeout> | undefined;
  private listeners = new Set<() => void>();
  constructor(private dir: string, private credentials: CredentialStore, private activity: (event: PetActivityEvent) => void,
    private factory: (config: ProviderConfig, key: string) => ChatProvider = createProvider) {
    this.conversations = new ConversationStore(join(dir, 'conversations.json'));
    const file = join(dir, 'ai-provider.json');
    if (existsSync(file)) {
      try { const { apiKey: _, ...config } = validateProvider(readJSON(file)); this.config = config; }
      catch { preserveBroken(file); this.providerState.lastError = '服务配置损坏，已保留原文件，请重新配置'; }
    }
    this.providerState.balance = { status: this.config.adapter === 'deepseek' ? 'unknown' : 'unsupported', items: [] };
  }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private changed(): void { for (const listener of this.listeners) listener(); }
  providerSnapshot(): ProviderState {
    return structuredClone({ config: this.config, hasKey: this.credentials.hasKey(), encryptionAvailable: this.credentials.available(), ...this.providerState });
  }
  snapshot(): ChatSnapshot {
    const { sessions, selectedId } = this.conversations.data;
    const messages = sessions.find(s => s.id === selectedId)?.messages ?? [];
    const usage = { prompt: 0, completion: 0, total: 0 }; let unreportedReplies = 0;
    for (const m of messages) {
      if (m.usage) { usage.prompt += m.usage.prompt; usage.completion += m.usage.completion; usage.total += m.usage.total; }
      else if (m.role === 'assistant' && m.status !== 'streaming') unreportedReplies++;
    }
    return structuredClone({ sessions: sessions.map(({ messages: _, ...s }) => s), selectedId, messages, active: this.active ? { requestId: this.active.requestId, sessionId: this.active.sessionId } : null, usage, unreportedReplies, notice: this.conversations.notice });
  }
  private requireIdle(): void { if (this.active || this.operation) throw new Error('请求进行中，请先停止或等待完成'); }
  createAgentProvider(): AgentProvider {
    if (!this.config.model) throw new Error('请先配置 Model ID');
    return new AgentProvider({ ...this.config }, this.credentials.get(this.config.baseUrl));
  }
  saveProvider(input: unknown): void {
    this.requireIdle();
    const { apiKey, ...config } = validateProvider(input);
    const key = apiKey ?? (config.baseUrl === this.config.baseUrl ? this.credentials.get(this.config.baseUrl) : '');
    this.credentials.set(config.baseUrl, key);
    atomicWrite(join(this.dir, 'ai-provider.json'), JSON.stringify(config, null, 2));
    this.config = config;
    this.providerState = { connection: 'untested', authentication: 'unverified', lastError: null, checkedAt: null,
      balance: { status: config.adapter === 'deepseek' ? 'unknown' : 'unsupported', items: [] }, models: [] };
    this.changed();
  }
  clearKey(): void {
    this.requireIdle(); this.credentials.clear();
    this.providerState.connection = 'untested'; this.providerState.authentication = 'unverified';
    this.providerState.lastError = null; this.providerState.balance = { status: this.config.adapter === 'deepseek' ? 'unknown' : 'unsupported', items: [] };
    this.changed();
  }
  selectModel(model: string): void {
    this.requireIdle();
    const { apiKey: _, ...config } = validateProvider({ ...this.config, model });
    atomicWrite(join(this.dir, 'ai-provider.json'), JSON.stringify(config, null, 2));
    this.config = config; this.providerState.connection = 'untested'; this.changed();
  }
  private provider(requireModel = true): ChatProvider {
    if (requireModel && !this.config.model) throw new Error('请先在设置中填写 Model ID 并保存');
    return this.factory({ ...this.config }, this.credentials.get(this.config.baseUrl));
  }
  private success(): void {
    this.providerState.connection = 'connected';
    this.providerState.authentication = this.credentials.hasKey() ? 'verified' : 'not-required';
    this.providerState.lastError = null; this.providerState.checkedAt = Date.now();
  }
  private failure(error: unknown): void {
    this.providerState.connection = 'error'; this.providerState.lastError = safeError(error); this.providerState.checkedAt = Date.now();
    if (error instanceof ProviderError && (error.status === 401 || error.status === 403)) this.providerState.authentication = 'rejected';
  }
  async inspect(kind: 'models' | 'test' | 'balance'): Promise<string[] | void> {
    this.requireIdle(); const provider = this.provider(kind === 'test'); const controller = new AbortController(); this.operation = controller;
    this.providerState.connection = 'checking';
    if (kind === 'balance') this.providerState.balance = { status: 'loading', items: [] };
    this.changed();
    try {
      if (kind === 'models') { const models = await provider.listModels(controller.signal); this.providerState.models = models; this.success(); return models; }
      if (kind === 'test') { await provider.testConnection(controller.signal); this.success(); }
      if (kind === 'balance') {
        const balance = await provider.getBalance(controller.signal); this.providerState.balance = balance;
        if (balance.status === 'available') this.success(); else this.providerState.connection = 'untested';
      }
    } catch (error) {
      this.failure(error);
      if (kind === 'balance') this.providerState.balance = { status: 'error', items: [], error: safeError(error) };
      throw new Error(safeError(error));
    } finally { this.operation = null; this.changed(); }
  }
  create(): void { this.conversations.create(); this.changed(); }
  select(id: string): void { this.conversations.select(id); this.changed(); }
  rename(id: string, title: string): void { this.conversations.rename(id, title); this.changed(); }
  delete(id: string): void { if (this.active?.sessionId === id) this.cancel(this.active.requestId); this.conversations.delete(id); this.changed(); }
  send(sessionId: string, text: string): void {
    this.requireIdle(); const provider = this.provider(); const session = this.conversations.get(sessionId);
    if (session.messages.length >= 1998) throw new Error('本会话消息较多，请创建新会话');
    const context = session.messages.filter(m => m.role === 'user' || m.status === 'complete').map(m => ({ role: m.role, text: m.text }));
    if (context.reduce((total, m) => total + m.text.length, text.length) > 200_000) throw new Error('本会话上下文过长，请创建新会话');
    const requestId = randomUUID();
    const user: StoredMessage = { id: randomUUID(), role: 'user', text, status: 'complete', createdAt: Date.now() };
    const assistant: StoredMessage = { id: randomUUID(), role: 'assistant', text: '', status: 'streaming', createdAt: Date.now(), requestId, model: this.config.model, provider: this.config.name };
    // 网络请求前先原子保存用户消息；写入失败则不发送请求。
    this.conversations.transaction(data => {
      const s = data.sessions.find(s => s.id === sessionId)!;
      s.messages.push(user, assistant); s.updatedAt = Date.now();
      if (s.messages.length === 2 && s.title === '新会话') s.title = text.replace(/\s+/g, ' ').slice(0, 30);
    });
    const active: Active = { requestId, sessionId, messageId: assistant.id, controller: new AbortController() };
    this.active = active; this.activity({ source: 'chat', activity: 'thinking', taskId: requestId }); this.changed();
    void this.run(active, provider, [...context, { role: 'user', text }]);
  }
  private checkpoint(): void {
    if (!this.flushTimer) this.flushTimer = setTimeout(() => { this.flushTimer = undefined; this.persist(); }, 500);
    if (!this.notifyTimer) this.notifyTimer = setTimeout(() => { this.notifyTimer = undefined; this.changed(); }, 40);
  }
  private persist(): void {
    clearTimeout(this.flushTimer); this.flushTimer = undefined;
    try { this.conversations.save(); this.conversations.notice = null; }
    catch { this.conversations.notice = '聊天记录暂时无法保存，请检查磁盘空间或目录权限；当前内容仍保留在内存。'; }
  }
  private async run(active: Active, provider: ChatProvider, messages: { role: 'user' | 'assistant'; text: string }[]) {
    try {
      for await (const chunk of provider.send(messages, active.controller.signal)) {
        if (this.active !== active) return;
        const reply = this.conversations.get(active.sessionId).messages.find(m => m.id === active.messageId)!;
        if (chunk.type === 'text') {
          if (reply.text.length + chunk.text.length > 1_000_000) throw new ProviderError('protocol', '回复超过本地大小限制，已保留部分内容');
          reply.text += chunk.text;
          if (this.providerState.connection !== 'connected') this.success();
          if (reply.text.length === chunk.text.length) this.activity({ source: 'chat', activity: 'responding', taskId: active.requestId });
        } else if (chunk.type === 'usage') reply.usage = chunk.usage;
        else { reply.finishReason = chunk.finishReason ?? undefined; }
        this.checkpoint();
      }
      if (this.active !== active) return;
      const reply = this.conversations.get(active.sessionId).messages.find(m => m.id === active.messageId)!;
      reply.status = 'complete'; this.success(); this.active = null;
      this.activity({ source: 'chat', activity: 'success', taskId: active.requestId });
    } catch (error) {
      if (this.active !== active) return;
      const reply = this.conversations.get(active.sessionId).messages.find(m => m.id === active.messageId)!;
      reply.status = 'error'; reply.error = safeError(error); this.failure(error); this.active = null;
      this.activity({ source: 'chat', activity: 'idle', taskId: active.requestId });
    } finally {
      // 旧请求的 finally 不改变新请求的动画或 active。
      this.persist(); this.changed();
    }
  }
  cancel(requestId: string): void {
    const active = this.active;
    if (!active || active.requestId !== requestId) return;
    this.active = null; active.controller.abort();
    const reply = this.conversations.get(active.sessionId).messages.find(m => m.id === active.messageId)!;
    reply.status = 'cancelled'; this.activity({ source: 'chat', activity: 'idle', taskId: active.requestId });
    this.persist(); this.changed();
  }
  dispose(): void {
    if (this.active) this.cancel(this.active.requestId);
    this.operation?.abort(); clearTimeout(this.flushTimer); clearTimeout(this.notifyTimer);
    this.persist(); this.listeners.clear();
  }
}
