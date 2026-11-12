import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProviderConfig } from '../src/shared/chat';
import type { ChatChunk, ChatMessage, ChatProvider } from '../src/main/integrations/contracts';
import type { PetActivityEvent } from '../src/shared/types';
import { PetStateManager } from '../src/main/PetStateManager';
import { CredentialStore, type Encryption } from '../src/main/chat/CredentialStore';
import { ConversationStore } from '../src/main/chat/ConversationStore';
import { ChatService } from '../src/main/chat/ChatService';
import { OpenAICompatibleProvider, DeepSeekProvider, ProviderError } from '../src/main/chat/OpenAICompatibleProvider';
import { normalizeBaseURL, validateProvider } from '../src/main/chat/validation';
import { SSEParser } from '../src/main/chat/sse';

const config: ProviderConfig = { name: 'Mock', baseUrl: 'https://mock.invalid/v1', model: 'mock-model', adapter: 'openai-compatible', includeUsage: true, timeoutMs: 1000 };
// 仅测试边界的可逆替身，不代表操作系统加密实现，不使用真实凭据。
const encryption: Encryption = {
  isEncryptionAvailable: () => true,
  encryptString: text => Buffer.from(Buffer.from(text).map(n => n ^ 0xaa)),
  decryptString: bytes => Buffer.from(bytes.map(n => n ^ 0xaa)).toString(),
};
const tick = () => new Promise(resolve => setTimeout(resolve, 5));
async function settled(service: ChatService) { for (let i = 0; i < 100 && service.snapshot().active; i++) await tick(); assert.equal(service.snapshot().active, null); }

test('Base URL / 配置白名单：HTTPS 或 loopback HTTP，拒绝凭据与非本地 HTTP', () => {
  for (const url of ['http://localhost:3000/v1/', 'http://127.0.0.1:8080', 'http://[::1]:1234/v1', 'https://mock.invalid/api']) assert.ok(normalizeBaseURL(url));
  for (const url of ['http://example.com', 'http://localhost.evil.test', 'file:///etc', 'https://user:secret@mock.invalid', 'https://mock.invalid/?key=secret', 'https://mock.invalid/#secret']) assert.throws(() => normalizeBaseURL(url));
  assert.throws(() => validateProvider({ ...config, apiKey: 'bad\r\nheader' }));
  assert.throws(() => validateProvider({ ...config, command: 'cmd' }));
  assert.equal(validateProvider({ ...config, model: '' }).model, '');
});

test('SSE：跨 CRLF、注释、多行 data、结尾无换行、事件大小上限', () => {
  const parser = new SSEParser();
  assert.deepEqual(parser.feed(': hello\r'), []);
  assert.deepEqual(parser.feed('\ndata: first\r'), []);
  assert.deepEqual(parser.feed('\ndata: second\r\n\r'), []);
  assert.deepEqual(parser.feed('\n'), ['first\nsecond']);
  assert.deepEqual(parser.feed('data: [DONE]', true), ['[DONE]']);
  assert.throws(() => new SSEParser().feed('a'.repeat(1_048_577)));
});

test('Provider：逐字节 UTF-8、真实请求结构、usage、DONE 和正常取消 reader', async () => {
  const sse = 'data: {"choices":[{"delta":{"content":"你好🌸"},"finish_reason":null}]}\r\n\r\n'
    + 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n'
    + 'data: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":3,"total_tokens":8}}\n\n'
    + 'data: [DONE]\n\n';
  let urlSeen = ''; let body: Record<string, unknown> = {}; let redirect: unknown; let stream: ReadableStream<Uint8Array> | undefined;
  const transport: typeof fetch = async (url, init) => {
    urlSeen = String(url); body = JSON.parse(String(init?.body)); redirect = init?.redirect;
    const bytes = new TextEncoder().encode(sse); let offset = 0;
    stream = new ReadableStream({ pull(controller) { if (offset < bytes.length) controller.enqueue(bytes.slice(offset, ++offset)); else controller.close(); } });
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
  };
  const chunks: ChatChunk[] = [];
  for await (const chunk of new OpenAICompatibleProvider(config, 'mock-secret', transport).send([{ role: 'user', text: 'hello' }], new AbortController().signal)) chunks.push(chunk);
  assert.equal(urlSeen, 'https://mock.invalid/v1/chat/completions'); assert.equal(redirect, 'error');
  assert.deepEqual(body.messages, [{ role: 'user', content: 'hello' }]); assert.deepEqual(body.stream_options, { include_usage: true });
  assert.deepEqual(chunks, [{ type: 'text', text: '你好🌸' }, { type: 'usage', usage: { prompt: 5, completion: 3, total: 8 } }, { type: 'done', finishReason: 'stop' }]);
  assert.equal(stream?.locked, false);
});

test('Provider：401/403/429 不反射响应正文；坏 JSON 和截断流明确报错', async () => {
  for (const status of [401, 403, 429]) {
    const provider = new OpenAICompatibleProvider(config, 'mock-secret', async () => new Response('mock-secret sensitive error', { status }));
    await assert.rejects(provider.testConnection(new AbortController().signal), error => error instanceof ProviderError && error.status === status && !error.message.includes('mock-secret'));
  }
  for (const sse of ['data: bad-json\n\n', 'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n']) {
    const provider = new OpenAICompatibleProvider(config, '', async () => new Response(sse, { headers: { 'Content-Type': 'text/event-stream' } }));
    await assert.rejects(async () => { for await (const _ of provider.send([], new AbortController().signal)) { /* 消费流 */ } }, ProviderError);
  }
});

test('Provider：总超时和显式取消可打断等待中的 SSE 读取', async () => {
  const transport: typeof fetch = async (_url, init) => new Response(new ReadableStream({ start(controller) {
    init?.signal?.addEventListener('abort', () => controller.error(new Error('aborted')), { once: true });
  } }), { headers: { 'Content-Type': 'text/event-stream' } });
  const collect = async (provider: OpenAICompatibleProvider, signal: AbortSignal) => { for await (const _ of provider.send([], signal)) { /* 消费流 */ } };
  await assert.rejects(collect(new OpenAICompatibleProvider({ ...config, timeoutMs: 20 }, '', transport), new AbortController().signal), e => e instanceof ProviderError && e.code === 'timeout');
  const controller = new AbortController(); const promise = collect(new OpenAICompatibleProvider(config, '', transport), controller.signal);
  await tick(); controller.abort();
  await assert.rejects(promise, e => e instanceof ProviderError && e.code === 'cancelled');
});

test('模型列表和真实余额适配；通用模式不发出猜测额度请求', async () => {
  let calls = 0;
  const provider = new OpenAICompatibleProvider(config, '', async () => { calls++; return Response.json({ data: [{ id: 'b' }, { id: 'a' }, { id: 'a' }] }); });
  assert.deepEqual(await provider.listModels(new AbortController().signal), ['a', 'b']);
  assert.equal((await provider.getBalance(new AbortController().signal)).status, 'unsupported'); assert.equal(calls, 1);
  const deepseek = new DeepSeekProvider(config, '', async url => { assert.equal(String(url), 'https://mock.invalid/user/balance'); return Response.json({ balance_infos: [{ currency: 'CNY', total_balance: '12.34' }] }); });
  assert.deepEqual((await deepseek.getBalance(new AbortController().signal)).items, [{ currency: 'CNY', total: '12.34' }]);
});

test('凭据：磁盘无明文、端点绑定、加密不可用拒绝保存、清除', () => {
  const dir = mkdtempSync(join(tmpdir(), 'emma-credentials-'));
  try {
    const file = join(dir, 'credentials.bin'); const store = new CredentialStore(file, encryption);
    store.set(config.baseUrl, 'mock-secret'); assert.equal(store.get(config.baseUrl), 'mock-secret');
    assert.equal(readFileSync(file).includes(Buffer.from('mock-secret')), false);
    assert.throws(() => store.get('https://other.invalid'));
    assert.throws(() => new CredentialStore(file, { ...encryption, isEncryptionAvailable: () => false }).set(config.baseUrl, 'another-secret'));
    assert.throws(() => new CredentialStore(file, { ...encryption, getSelectedStorageBackend: () => 'basic_text' }).get(config.baseUrl));
    store.clear(); assert.equal(store.hasKey(), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('会话：创建/切换/重命名/删除持久化，重启 streaming 变 interrupted，损坏文件保留', () => {
  const dir = mkdtempSync(join(tmpdir(), 'emma-conversations-')); const file = join(dir, 'conversations.json');
  try {
    const store = new ConversationStore(file); store.create(); const first = store.data.selectedId!; store.rename(first, '会话 A'); store.create();
    store.select(first); store.get(first).messages.push({ id: first, role: 'assistant', text: '部分内容', status: 'streaming', createdAt: Date.now() }); store.save();
    const restored = new ConversationStore(file); assert.equal(restored.data.selectedId, first); assert.equal(restored.get(first).messages[0].status, 'interrupted');
    restored.delete(first); assert.equal(new ConversationStore(file).data.sessions.length, 1);
    writeFileSync(file, '{broken'); const broken = new ConversationStore(file); assert.ok(broken.notice); assert.ok(readdirSync(dir).some(file => file.includes('.broken-')));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('ChatService：上下文隔离、立即保存用户消息、旧请求取消后不覆盖新状态、无 Key 回传', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'emma-chat-')); const events: PetActivityEvent[] = []; const contexts: readonly ChatMessage[][] = [];
  let release!: () => void; let calls = 0;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const factory = (): ChatProvider => ({
    async *send(messages) {
      (contexts as ChatMessage[][]).push([...messages]); const call = ++calls;
      yield { type: 'text', text: call === 1 ? 'partial' : 'complete' };
      if (call === 1) await blocked; // 故意忽略 abort，验证服务层自己的过期保护。
      yield { type: 'done', finishReason: 'stop' };
    }, listModels: async () => [], testConnection: async () => {}, getBalance: async () => ({ status: 'unsupported', items: [] }),
  });
  const service = new ChatService(dir, new CredentialStore(join(dir, 'credentials.bin'), encryption), e => events.push(e), factory);
  try {
    service.saveProvider({ ...config, apiKey: 'mock-secret' });
    assert.equal(JSON.stringify(service.providerSnapshot()).includes('mock-secret'), false);
    service.create(); const a = service.snapshot().selectedId!; service.send(a, 'A message'); await tick();
    assert.equal(new ConversationStore(join(dir, 'conversations.json')).get(a).messages[0].text, 'A message');
    const old = service.snapshot().active!.requestId; service.cancel(old);
    service.create(); const b = service.snapshot().selectedId!; service.send(b, 'B message'); await settled(service);
    const last = events.at(-1); release(); await tick();
    assert.equal(events.at(-1), last); assert.equal(last?.activity, 'success');
    assert.deepEqual(contexts[1], [{ role: 'user', text: 'B message' }]);
    assert.equal(service.conversations.get(a).messages[1].status, 'cancelled');
    assert.equal(service.conversations.get(b).messages[1].status, 'complete');
    for (const file of ['ai-provider.json', 'conversations.json']) assert.equal(readFileSync(join(dir, file), 'utf8').includes('mock-secret'), false);
    const state = new PetStateManager(0); state.handleActivityEvent({ source: 'chat', activity: 'responding' }); state.setDragging(true); state.setDragging(false); assert.equal(state.snapshot().activity, 'responding'); state.dispose();
  } finally { release(); service.dispose(); rmSync(dir, { recursive: true, force: true }); }
});

test('ChatService：失败保留用户消息及部分输出，并恢复 idle', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'emma-chat-fail-')); const events: PetActivityEvent[] = [];
  const factory = (): ChatProvider => ({ async *send() { yield { type: 'text', text: 'partial' }; throw new ProviderError('http', 'HTTP 429：请求频率受限', 429); }, listModels: async () => [], testConnection: async () => {}, getBalance: async () => ({ status: 'unsupported', items: [] }) });
  const service = new ChatService(dir, new CredentialStore(join(dir, 'key.bin'), encryption), e => events.push(e), factory);
  try {
    service.saveProvider(config); service.create(); service.send(service.snapshot().selectedId!, '保留我的消息'); await settled(service);
    assert.equal(service.snapshot().messages[0].text, '保留我的消息'); assert.equal(service.snapshot().messages[1].text, 'partial');
    assert.equal(service.snapshot().messages[1].status, 'error'); assert.equal(events.at(-1)?.activity, 'idle');
  } finally { service.dispose(); rmSync(dir, { recursive: true, force: true }); }
});
