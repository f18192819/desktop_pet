import type { BalanceState, ProviderConfig, TokenUsage } from '../../shared/chat';
import type { ChatChunk, ChatMessage, ChatProvider } from '../integrations/contracts';
import { isRecord } from '../config';
import { normalizeBaseURL } from './validation';
import { SSEParser } from './sse';

export class ProviderError extends Error {
  constructor(readonly code: 'http' | 'network' | 'timeout' | 'cancelled' | 'protocol', message: string, readonly status?: number) { super(message); }
}
export function safeError(error: unknown): string {
  return error instanceof ProviderError ? error.message : '请求未完成，请检查网络、服务配置或本地存储权限';
}
export function parseUsage(value: unknown): TokenUsage | null {
  if (!isRecord(value)) return null;
  const fields = [value.prompt_tokens, value.completion_tokens, value.total_tokens];
  if (!fields.every(n => Number.isSafeInteger(n) && Number(n) >= 0)) return null;
  return { prompt: Number(fields[0]), completion: Number(fields[1]), total: Number(fields[2]) };
}
export class OpenAICompatibleProvider implements ChatProvider {
  private readonly base: string;
  constructor(private config: ProviderConfig, private key: string, private transport: typeof fetch = fetch) {
    this.base = normalizeBaseURL(config.baseUrl);
  }
  private async withDeadline<T>(signal: AbortSignal, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), this.config.timeoutMs);
    try { return await work(AbortSignal.any([signal, deadline.signal])); }
    catch (error) {
      if (signal.aborted) throw new ProviderError('cancelled', '已停止生成');
      if (deadline.signal.aborted) throw new ProviderError('timeout', '请求超时，请重试或调整超时设置');
      if (error instanceof ProviderError) throw error;
      throw new ProviderError('network', '网络连接失败，请检查 Base URL、代理或证书');
    } finally { clearTimeout(timer); }
  }
  private async request(path: string, signal: AbortSignal, body?: object): Promise<Response> {
    const response = await this.transport(`${this.base}/${path}`, {
      method: body ? 'POST' : 'GET', signal, redirect: 'error',
      headers: { Accept: body && 'stream' in body && body.stream ? 'text/event-stream' : 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}), ...(this.key ? { Authorization: `Bearer ${this.key}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) {
      await response.body?.cancel();
      const messages: Record<number, string> = {
        400: '请求参数或模型不受支持，请检查 Model ID 和流式用量选项',
        401: '认证失败，请检查 API Key', 403: '访问被拒绝，请检查 Key 或模型权限',
        402: '服务商拒绝请求，请检查账户额度', 404: '接口或模型不存在，请检查 Base URL（是否需要 /v1）和 Model ID',
        429: '请求频率或额度受限，请稍后重试并检查服务商控制台',
      };
      // 不反射服务端错误正文、请求头或底层异常，避免泄露 Key。
      throw new ProviderError('http', `HTTP ${response.status}：${messages[response.status] ?? '服务商请求失败'}`, response.status);
    }
    return response;
  }
  private async json(response: Response): Promise<unknown> {
    const reader = response.body?.getReader();
    if (!reader) throw new ProviderError('protocol', '服务商返回空响应');
    try {
      const decoder = new TextDecoder(); let text = ''; let bytes = 0;
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        bytes += value.byteLength;
        if (bytes > 2_097_152) throw new ProviderError('protocol', '服务商响应过大');
        text += decoder.decode(value, { stream: true });
      }
      try { return JSON.parse(text + decoder.decode()); }
      catch { throw new ProviderError('protocol', '服务商未返回有效 JSON'); }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
  async *send(messages: readonly ChatMessage[], signal: AbortSignal): AsyncGenerator<ChatChunk> {
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), this.config.timeoutMs);
    const combined = AbortSignal.any([signal, deadline.signal]);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await this.request('chat/completions', combined, {
        model: this.config.model, messages: messages.map(m => ({ role: m.role, content: m.text })), stream: true,
        ...(this.config.includeUsage ? { stream_options: { include_usage: true } } : {}),
      });
      if (!response.headers.get('content-type')?.includes('text/event-stream')) throw new ProviderError('protocol', '服务商未返回 SSE 流式响应');
      reader = response.body?.getReader();
      if (!reader) throw new ProviderError('protocol', '服务商返回空响应');
      const parser = new SSEParser(); const decoder = new TextDecoder();
      let finishReason: string | null = null; let finished = false;
      while (true) {
        combined.throwIfAborted();
        const { done, value } = await reader.read();
        const events = parser.feed(done ? decoder.decode() : decoder.decode(value, { stream: true }), done);
        for (const data of events) {
          if (data.trim() === '[DONE]') { yield { type: 'done', finishReason }; return; }
          let chunk: unknown;
          try { chunk = JSON.parse(data); } catch { throw new ProviderError('protocol', 'SSE 包含无效 JSON'); }
          if (!isRecord(chunk) || chunk.error) throw new ProviderError('protocol', '服务商返回流式错误');
          const usage = parseUsage(chunk.usage);
          if (usage) yield { type: 'usage', usage };
          if (!Array.isArray(chunk.choices)) throw new ProviderError('protocol', '无法识别的流式响应结构');
          const choice: unknown = chunk.choices[0];
          if (isRecord(choice)) {
            if (typeof choice.finish_reason === 'string') { finished = true; finishReason = choice.finish_reason; }
            if (isRecord(choice.delta)) {
              if (choice.delta.tool_calls) throw new ProviderError('protocol', '当前聊天不支持工具调用');
              const content = choice.delta.content ?? choice.delta.refusal;
              if (typeof content === 'string' && content) yield { type: 'text', text: content };
            }
          }
        }
        if (done) {
          if (!finished) throw new ProviderError('protocol', '连接提前结束，回复可能不完整');
          yield { type: 'done', finishReason }; return;
        }
      }
    } catch (error) {
      if (signal.aborted) throw new ProviderError('cancelled', '已停止生成');
      if (deadline.signal.aborted) throw new ProviderError('timeout', '请求超时，已保留收到的内容');
      if (error instanceof ProviderError) throw error;
      throw new ProviderError('network', '网络或流式响应异常，已保留收到的内容');
    } finally { clearTimeout(timer); await reader?.cancel().catch(() => {}); reader?.releaseLock(); }
  }
  listModels(signal: AbortSignal): Promise<string[]> {
    return this.withDeadline(signal, async combined => {
      const data = await this.json(await this.request('models', combined));
      if (!isRecord(data) || !Array.isArray(data.data)) throw new ProviderError('protocol', '模型列表格式不兼容，请手动填写 Model ID');
      const models = data.data.filter(isRecord).map(m => m.id).filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 200);
      return [...new Set(models)].sort().slice(0, 2000);
    });
  }
  testConnection(signal: AbortSignal): Promise<void> {
    return this.withDeadline(signal, async combined => {
      const data = await this.json(await this.request('chat/completions', combined, {
        model: this.config.model, messages: [{ role: 'user', content: 'Hi' }], stream: false, max_tokens: 1,
      }));
      if (!isRecord(data) || !Array.isArray(data.choices) || data.error || !data.choices.length) throw new ProviderError('protocol', '聊天接口未返回有效结果');
    });
  }
  async getBalance(_signal: AbortSignal): Promise<BalanceState> { return { status: 'unsupported', items: [] }; }
  protected balanceRequest(signal: AbortSignal): Promise<BalanceState> {
    return this.withDeadline(signal, async combined => {
      // DeepSeek 的余额接口在 origin 根目录，不跟随 Chat Completions 的 /v1 路径。
      const endpoint = new URL(this.base); endpoint.pathname = '';
      const balanceProvider = new OpenAICompatibleProvider({ ...this.config, baseUrl: endpoint.href }, this.key, this.transport);
      const data = await this.json(await balanceProvider.request('user/balance', combined));
      if (!isRecord(data) || !Array.isArray(data.balance_infos)) throw new ProviderError('protocol', '额度接口格式不兼容');
      const items = data.balance_infos.map((item: unknown) => {
        if (!isRecord(item) || typeof item.currency !== 'string' || !/^[A-Z]{3,10}$/.test(item.currency)
          || typeof item.total_balance !== 'string' || !/^-?\d{1,20}(\.\d{1,12})?$/.test(item.total_balance)) throw new ProviderError('protocol', '额度数据无效');
        return { currency: item.currency, total: item.total_balance };
      });
      return { status: 'available', items, checkedAt: Date.now() };
    });
  }
}
export class DeepSeekProvider extends OpenAICompatibleProvider {
  override getBalance(signal: AbortSignal): Promise<BalanceState> { return this.balanceRequest(signal); }
}
export function createProvider(config: ProviderConfig, key: string): ChatProvider {
  return config.adapter === 'deepseek' ? new DeepSeekProvider(config, key) : new OpenAICompatibleProvider(config, key);
}
