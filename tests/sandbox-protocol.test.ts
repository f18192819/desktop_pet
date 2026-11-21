import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { encodeFrame, GuestFrameReader, MAX_FRAME_BYTES } from '../src/main/agent/sandbox/SandboxProtocol';
import type { GuestMessage, GuestRun, HostInput } from '../src/main/agent/sandbox/SandboxProtocol';
import { VirtualBoxSandboxProvider } from '../src/main/agent/sandbox/VirtualBoxSandboxProvider';
import type { SandboxProvider } from '../src/main/agent/sandbox/SandboxProvider';

const runId = '0123456789abcdef0123456789abcdef';
const envelope = { version: 1 as const, runId };
const content = Buffer.from([0, 1, 255]);
const file = { size: content.length, sha256: createHash('sha256').update(content).digest('hex'), data: content.toString('base64') };
const output: GuestMessage = { ...envelope, type: 'output', stream: 'stdout', text: '输出' };
const result: GuestMessage = { ...envelope, type: 'result', exitCode: 0, changes: [{ kind: 'write', path: 'src/a.bin', baseSha256: null, ...file }] };
const input: HostInput = {
  ...envelope, type: 'input',
  workspace: [{ kind: 'directory', path: 'src' }, { kind: 'file', path: 'src/a.bin', ...file }],
  readOnly: [{ kind: 'file', path: 'external-1.bin', ...file }],
};
const run: GuestRun = { ...envelope, type: 'run', executable: 'node', args: ['--version'], cwd: '.', timeoutMs: 1000 };

function frame(body: Buffer | object) {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length);
  return Buffer.concat([header, payload]);
}

test('VM 协议：工作区与外部输入分离，分片传输及二进制输出', () => {
  assert.deepEqual(encodeFrame(input), frame(input));
  assert.deepEqual(encodeFrame(run), frame(run));
  const bytes = Buffer.concat([encodeFrame(output), encodeFrame(result)]);
  const reader = new GuestFrameReader(runId);
  const messages: GuestMessage[] = [];
  for (const byte of bytes) messages.push(...reader.push(Buffer.from([byte])));
  assert.deepEqual(messages, [output]);
  assert.deepEqual(reader.finish(), result);
});

test('VM 协议：拒绝未限制的帧、伪造执行 ID、异常顺序和截断', () => {
  assert.throws(() => new GuestFrameReader(runId).push(Buffer.alloc(4)), /帧长度/);
  const oversized = Buffer.alloc(4);
  oversized.writeUInt32LE(MAX_FRAME_BYTES + 1);
  assert.throws(() => new GuestFrameReader(runId).push(oversized), /帧长度/);
  assert.throws(() => new GuestFrameReader(runId).push(frame(Buffer.from([0xff]))), /utf-8/i);
  assert.throws(() => new GuestFrameReader(runId).push(frame({ ...output, runId: 'a'.repeat(32) })), /执行 ID/);
  assert.throws(() => new GuestFrameReader(runId).push(frame({ ...result, version: 2 })), /协议版本/);
  assert.throws(() => new GuestFrameReader(runId).push(encodeFrame(run)), /方向/);
  assert.throws(() => new GuestFrameReader(runId).push(Buffer.concat([encodeFrame(result), encodeFrame(output)])), /额外数据/);
  const trailing = new GuestFrameReader(runId);
  assert.deepEqual(trailing.push(encodeFrame(result)), []);
  assert.throws(() => trailing.push(encodeFrame(output)), /额外数据/);
  assert.throws(() => trailing.finish(), /缺少终态/);
  const truncated = new GuestFrameReader(runId);
  truncated.push(encodeFrame(result).subarray(0, -1));
  assert.throws(() => truncated.finish(), /截断/);
  assert.throws(() => truncated.push(encodeFrame(result)), /已关闭/);
  const noisy = new GuestFrameReader(runId);
  const chunk = encodeFrame({ ...output, text: 'x'.repeat(16 * 1024) });
  for (let i = 0; i < 8; i++) noisy.push(chunk);
  assert.throws(() => noisy.push(chunk), /输出总量/);
});

test('VM 协议：拒绝路径逃逸、特殊对象、重复路径及伪造文件哈希', () => {
  const item = { kind: 'write', path: 'safe.bin', baseSha256: null, ...file };
  const expectReject = (changes: object[], message: RegExp) => {
    assert.throws(() => new GuestFrameReader(runId).push(frame({ ...result, changes })), message);
  };
  for (const path of ['../out', '/tmp/a', 'C:/x', 'C:relative', '\\\\host\\share', 'a\\b', 'a/b:stream',
    'a/./b', 'a//b', 'a/NUL.txt', 'con .txt', 'LPT9', 'COM¹.txt', 'A~1.txt', 'a/file. ', 'a/\nfile', 'foo\n']) {
    expectReject([{ ...item, path }], /相对路径/);
  }
  for (const kind of ['symlink', 'junction', 'hardlink', 'reparse', 'device']) {
    expectReject([{ kind, path: 'a.txt' }], /特殊文件/);
  }
  expectReject([{ ...item, links: 2 }], /未知字段/);
  expectReject([{ ...item, sha256: 'a'.repeat(64) }], /SHA-256/);
  expectReject([{ ...item, data: '====' }], /Base64/);
  expectReject([{ ...item, size: 4 }], /长度/);
  expectReject([item, { ...item, path: 'SAFE.BIN' }], /大小写冲突/);
  expectReject([item, { ...item, path: 'safe.bin/child' }], /父路径/);
  expectReject([{ ...item, path: 'src/a' }, { ...item, path: 'SRC/b' }], /父路径大小写/);
});

test('虚拟机原型：未部署的 Provider 拒绝所有生命周期操作', async () => {
  const provider: SandboxProvider = new VirtualBoxSandboxProvider();
  const instance = { id: runId };
  const signal = new AbortController().signal;
  for (const operation of [
    provider.create(input, signal), provider.start(instance, signal), provider.execute(instance, run, signal, () => {}),
    provider.cancel(instance), provider.collect(instance, signal), provider.destroy(instance),
  ]) await assert.rejects(operation, /禁止操作虚拟机/);
});
