import type { ProviderConfig, TokenUsage } from '../../shared/chat';
import type { AgentMessage, ToolCall } from '../../shared/agent';
import { SSEParser } from '../chat/sse';
import { normalizeBaseURL } from '../chat/validation';
import { parseUsage } from '../chat/OpenAICompatibleProvider';
import { tools } from './ToolRegistry';
export class ToolAccumulator {
  calls = new Map<number, ToolCall>();
  feed(parts: unknown) {
    if (!Array.isArray(parts)) throw new Error('tool_calls 格式错误');
    for (const p of parts) {
      if (!Number.isInteger(p.index) || p.index < 0 || p.index >= 16) throw new Error('工具调用 index 无效');
      const call = this.calls.get(p.index) ?? { id: '', type: 'function', function: { name: '', arguments: '' } };
      if (p.type !== undefined && p.type !== 'function') throw new Error('不支持的工具类型');
      for (const [value, limit] of [[p.id, 200], [p.function?.name, 200], [p.function?.arguments, 1_100_000]] as const) if (value !== undefined && (typeof value !== 'string' || value.length > limit)) throw new Error('工具片段无效');
      call.id += p.id ?? ''; call.function.name += p.function?.name ?? ''; call.function.arguments += p.function?.arguments ?? '';
      if (call.id.length > 200 || call.function.name.length > 200 || call.function.arguments.length > 1_100_000) throw new Error('工具参数超限');
      this.calls.set(p.index, call);
    }
  }
  finish() { const calls = [...this.calls].sort(([a], [b]) => a - b).map(([, c]) => c); if (calls.some(c => !c.id || !c.function.name) || new Set(calls.map(c => c.id)).size !== calls.length) throw new Error('工具调用不完整'); return calls; }
}
export class AgentProvider {
  constructor(private config: ProviderConfig, private key: string, private transport: typeof fetch = fetch) {}
  async turn(messages: AgentMessage[], signal: AbortSignal, text: (delta: string) => void, required: boolean): Promise<{ content: string; calls: ToolCall[]; usage?: TokenUsage }> {
    const deadline = AbortSignal.timeout(this.config.timeoutMs); const combined = AbortSignal.any([signal, deadline]);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await this.transport(`${normalizeBaseURL(this.config.baseUrl)}/chat/completions`, { method: 'POST', redirect: 'error', signal: combined,
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...(this.key ? { Authorization: `Bearer ${this.key}` } : {}) },
        body: JSON.stringify({ model: this.config.model, messages, tools, tool_choice: required ? 'required' : 'auto', stream: true, ...(this.config.includeUsage ? { stream_options: { include_usage: true } } : {}) }) });
      if (!response.ok) { await response.body?.cancel(); throw new Error(`Agent HTTP ${response.status}：检查认证、额度和模型 tool calling 支持`); }
      if (!response.headers.get('content-type')?.includes('text/event-stream')) { await response.body?.cancel(); throw new Error('Agent 模型未返回 SSE'); }
      reader = response.body?.getReader(); if (!reader) throw new Error('空响应');
      const parser = new SSEParser(); const decoder = new TextDecoder(); const accumulator = new ToolAccumulator();
      let content = ''; let finish = ''; let doneMarker = false; let usage: TokenUsage | undefined;
      while (!doneMarker) {
        combined.throwIfAborted(); const next = await reader.read();
        for (const event of parser.feed(next.done ? decoder.decode() : decoder.decode(next.value, { stream: true }), next.done)) {
          if (event.trim() === '[DONE]') { doneMarker = true; break; }
          const chunk = JSON.parse(event); if (chunk.error || !Array.isArray(chunk.choices)) throw new Error('Agent 流格式错误');
          usage = parseUsage(chunk.usage) ?? usage; const choice = chunk.choices[0];
          if (choice?.finish_reason) finish = choice.finish_reason;
          const delta = choice?.delta;
          if (delta?.tool_calls) accumulator.feed(delta.tool_calls);
          if (typeof delta?.content === 'string') { content += delta.content; if (content.length > 200_000) throw new Error('回复过大'); text(delta.content); }
        }
        if (next.done) break;
      }
      if (!['stop', 'tool_calls'].includes(finish)) throw new Error('Agent 响应截断或不支持工具调用');
      const calls = accumulator.finish();
      if (required && !calls.length) throw new Error('模型未遵循 required tool calling，不能作为 Agent 使用');
      if (calls.length && finish !== 'tool_calls') throw new Error('工具调用未完整结束');
      return { content, calls, usage };
    } catch (error) {
      if (combined.aborted) throw new Error(signal.aborted ? '任务已停止' : 'Agent 请求超时');
      // Do not reflect remote bodies or transport errors containing credentials.
      const message = error instanceof Error ? error.message : '';
      if (/^(Agent HTTP|Agent 模型|模型未遵循|工具调用|Agent 响应)/.test(message)) throw error;
      throw new Error('Agent 网络或流式工具响应无效');
    } finally { await reader?.cancel().catch(() => {}); reader?.releaseLock(); }
  }
}
