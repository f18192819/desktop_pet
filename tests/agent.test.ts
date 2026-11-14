import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, linkSync, symlinkSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { WorkspaceSecurity } from '../src/main/agent/WorkspaceSecurity';
import { WorkspaceFS } from '../src/main/agent/WorkspaceFS';
import { ToolAccumulator, AgentProvider } from '../src/main/agent/AgentProvider';
import { validateTool } from '../src/main/agent/ToolRegistry';
import { AgentService } from '../src/main/agent/AgentService';
import { ShellExecutor } from '../src/main/agent/ShellExecutor';
import { PermissionManager } from '../src/main/agent/PermissionManager';
import type { ProviderConfig } from '../src/shared/chat';
mkdirSync('.test-build', { recursive: true });
const fixture = () => { const dir = mkdtempSync(resolve('.test-build/agent-')); const root = join(dir, 'work'); mkdirSync(root); return { dir, root }; };
const config: ProviderConfig = { name: 'test', baseUrl: 'https://example.invalid/v1', model: 'fixture', adapter: 'openai-compatible', timeoutMs: 1000, includeUsage: true };
test('文件边界：外部读取/复制，越界写入、ADS、设备路径、硬链接及 Junction 拒绝', () => {
  const { dir, root } = fixture(); const outside = join(dir, 'outside.txt'); writeFileSync(outside, 'original');
  const fs = new WorkspaceFS(new WorkspaceSecurity(root), () => {});
  assert.equal(fs.read(outside), 'original'); fs.execute('copy_path', { path: outside, destination: 'copy.txt' });
  fs.write('inside.txt', 'hello'); assert.equal(fs.read('inside.txt'), 'hello');
  for (const path of [outside, '../escape.txt', 'a:ads', '\\\\?\\C:\\escape.txt', 'NUL', root]) assert.throws(() => fs.write(path, 'bad'));
  linkSync(outside, join(root, 'hard.txt')); assert.throws(() => fs.write('hard.txt', 'bad')); assert.equal(readFileSync(outside, 'utf8'), 'original');
  const externalDir = join(dir, 'external'); mkdirSync(externalDir); symlinkSync(externalDir, join(root, 'junction'), 'junction');
  assert.throws(() => fs.write('junction/escape.txt', 'bad')); assert.throws(() => fs.execute('delete_path', { path: 'junction' })); assert.ok(existsSync(externalDir));
  fs.execute('apply_patch', { path: 'inside.txt', oldText: 'hello', newText: 'world' }); assert.equal(fs.read('inside.txt'), 'world');
  assert.throws(() => fs.execute('apply_patch', { path: 'inside.txt', oldText: 'missing', newText: 'bad' })); assert.equal(fs.read('inside.txt'), 'world');
});
test('工具 JSON Schema 和 tool_calls 多 index 分片', () => {
  assert.throws(() => validateTool('write_file', '{bad')); assert.throws(() => validateTool('read_file', '{"path":"x","shell":true}'));
  const acc = new ToolAccumulator(); acc.feed([{ index: 1, id: 'b', function: { name: 'read_', arguments: '{"path":' } }, { index: 0, id: 'a', function: { name: 'update_plan', arguments: '{"plan":"ok"}' } }]);
  acc.feed([{ index: 1, function: { name: 'file', arguments: '"x"}' } }]);
  assert.deepEqual(acc.finish().map(c => c.function.name), ['update_plan', 'read_file']); assert.equal(validateTool('read_file', acc.finish()[1].function.arguments).path, 'x');
  assert.throws(() => acc.feed([{ index: -1 }]));
});
test('AgentProvider SSE 字节分片、usage、required 不支持和截断', async () => {
  const data = 'data: ' + JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call', function: { name: 'update_plan', arguments: '{"plan":"中文"}' } }] }, finish_reason: null }] }) + '\r\n\r\n' + 'data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } }) + '\n\ndata: [DONE]\n\n';
  const transport = (async () => new Response(new ReadableStream({ start(c) { for (const b of new TextEncoder().encode(data)) c.enqueue(new Uint8Array([b])); c.close(); } }), { headers: { 'content-type': 'text/event-stream' } })) as typeof fetch;
  const result = await new AgentProvider(config, '', transport).turn([], new AbortController().signal, () => {}, true);
  assert.equal(result.usage?.total, 5); assert.equal(result.calls[0].function.arguments, '{"plan":"中文"}');
  const noTools = (async () => new Response('data: {"choices":[{"delta":{"content":"hi"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })) as typeof fetch;
  await assert.rejects(new AgentProvider(config, '', noTools).turn([], new AbortController().signal, () => {}, true), /不.*Agent|不能作为 Agent/);
});
test('一次性审批、取消和 Shell fail closed', async () => {
  const p = new PermissionManager(); const c = new AbortController(); const result = p.request({ id: 'a', taskId: 't', tool: 'delete', description: '', scope: [] }, c.signal); p.decide('a', true); assert.equal(await result, 'approved'); assert.throws(() => p.decide('a', true));
  const cancelled = p.request({ id: 'b', taskId: 't', tool: 'delete', description: '', scope: [] }, c.signal); c.abort(); assert.equal(await cancelled, 'denied'); assert.throws(() => new ShellExecutor().execute(), /Shell 已禁用/);
});
test('Agent 持久化先于执行、审批取消、恢复不重放 pending 写入', async () => {
  const { dir, root } = fixture(); const data = join(dir, 'data');
  const fake = { turn: async () => ({ content: '', calls: [{ id: 'x', type: 'function' as const, function: { name: 'write_file', arguments: '{"path":"result.txt","content":"ok"}' } }] }) } as unknown as AgentProvider;
  const service = new AgentService(data, () => fake, () => {}); service.setWorkspace(root); const id = service.start('write');
  await new Promise(r => setTimeout(r, 20)); assert.equal(service.snapshot().tasks[0].status, 'waitingApproval'); assert.ok(existsSync(join(data, 'agent-sessions.json')));
  assert.throws(() => service.setWorkspace(root)); service.cancel(id); await new Promise(r => setTimeout(r, 20));
  assert.ok(!existsSync(join(root, 'result.txt'))); assert.equal(service.snapshot().tasks[0].tools[0].status, 'interrupted');
  const loaded = new AgentService(data, () => fake, () => {}); assert.equal(loaded.snapshot().activeId, null); assert.ok(!existsSync(join(root, 'result.txt'))); service.dispose(); loaded.dispose();
});
