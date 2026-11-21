import { createHash } from 'node:crypto';
import { isRuntimeAlias } from '../CommandPolicy';

export const MAX_FRAME_BYTES = 3 * 1024 * 1024;
const MAX_WIRE_BYTES = 8 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 128 * 1024;
const MAX_CHUNK_BYTES = 16 * 1024;
const MAX_FILES = 512;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_CONTENT_BYTES = 2 * 1024 * 1024;
const MAX_MESSAGES = 2048;

interface FileContent { size: number; sha256: string; data: string }
export type InputEntry = { kind: 'directory'; path: string } | ({ kind: 'file'; path: string } & FileContent);
export type GuestChange =
  | ({ kind: 'write'; path: string; baseSha256: string | null } & FileContent)
  | { kind: 'delete'; path: string; baseSha256: string }
  | { kind: 'mkdir' | 'rmdir'; path: string };

interface Envelope { version: 1; runId: string }
export interface HostInput extends Envelope { type: 'input'; workspace: readonly InputEntry[]; readOnly: readonly (InputEntry & { kind: 'file' })[] }
export interface GuestRun extends Envelope { type: 'run'; executable: string; args: readonly string[]; cwd: string; timeoutMs: number }
type GuestOutputFrame = Envelope & { type: 'output'; stream: 'stdout' | 'stderr'; text: string };
type GuestResultFrame = Envelope & { type: 'result'; exitCode: number | null; changes: readonly GuestChange[] };
export type GuestMessage = GuestOutputFrame | GuestResultFrame;
type WireMessage = HostInput | GuestRun | GuestMessage;
type Dict = Record<string, unknown>;

function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error('VM 协议：' + message);
}
function record(value: unknown): Dict {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value), '预期 JSON 对象');
  return value as Dict;
}
function exact(value: Dict, fields: readonly string[]) {
  requireValue(Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field)), '字段缺失或包含未知字段');
}
function integer(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}
function hash(value: unknown): value is string {
  return typeof value === 'string' && value.length === 64 && !/[^0-9a-f]/.test(value);
}
function guestPath(value: unknown): string {
  requireValue(typeof value === 'string' && value.length <= 200, '路径过长或类型无效');
  const segments = value.split('/');
  requireValue(segments.length <= 16 && segments.every(part => {
    const stem = part.split('.')[0].trimEnd();
    return part.length >= 1 && part.length <= 100 && !/[^a-z0-9._ @()+-]/i.test(part) && !/[. ]$/.test(part)
      && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(stem);
  }), '拒绝绝对、特殊或非规范相对路径');
  return value;
}
function fileContent(value: Dict): number {
  requireValue(integer(value.size, 0, MAX_FILE_BYTES) && hash(value.sha256) && typeof value.data === 'string', '文件大小、哈希或数据无效');
  requireValue(value.data.length === 4 * Math.ceil(value.size / 3), 'Base64 长度与文件声明不符');
  const content = Buffer.from(value.data, 'base64');
  requireValue(content.length === value.size && content.toString('base64') === value.data, '文件内容不是规范 Base64');
  requireValue(createHash('sha256').update(content).digest('hex') === value.sha256, '文件 SHA-256 不匹配');
  return value.size;
}
function validatePaths(paths: Map<string, { path: string; file: boolean }>, path: string, file: boolean) {
  const key = path.toLowerCase();
  requireValue(!paths.has(key), '重复或大小写冲突的路径');
  paths.set(key, { path, file });
}
function validateParents(paths: Map<string, { path: string; file: boolean }>) {
  const spelling = new Map<string, string>();
  for (const { path } of paths.values()) {
    let prefix = '';
    for (const part of path.split('/').slice(0, -1)) {
      prefix = prefix ? prefix + '/' + part : part;
      const key = prefix.toLowerCase();
      const registered = paths.get(key);
      requireValue(!registered?.file && (!registered || registered.path === prefix), '父路径指向文件或大小写冲突');
      requireValue(!spelling.has(key) || spelling.get(key) === prefix, '父路径大小写冲突');
      spelling.set(key, prefix);
    }
  }
}
function validateInput(value: Dict) {
  requireValue(Array.isArray(value.workspace) && value.workspace.length <= MAX_FILES
    && Array.isArray(value.readOnly) && value.readOnly.length <= 16, '导入清单超过限制');
  let bytes = 0;
  for (const [scope, entries] of [['workspace', value.workspace], ['readOnly', value.readOnly]] as const) {
    const paths = new Map<string, { path: string; file: boolean }>();
    for (const raw of entries) {
      const item = record(raw);
      const path = guestPath(item.path);
      if (item.kind === 'file') {
        exact(item, ['kind', 'path', 'size', 'sha256', 'data']);
        bytes += fileContent(item);
        requireValue(bytes <= MAX_CONTENT_BYTES, '导入内容总量超过限制');
      } else {
        requireValue(scope === 'workspace' && item.kind === 'directory', '只读区只接收普通文件，拒绝特殊对象');
        exact(item, ['kind', 'path']);
      }
      validatePaths(paths, path, item.kind === 'file');
    }
    validateParents(paths);
  }
}
function validateChanges(raw: unknown) {
  requireValue(Array.isArray(raw) && raw.length <= MAX_FILES, '变更清单超过限制');
  const paths = new Map<string, { path: string; file: boolean }>();
  let bytes = 0;
  for (const entry of raw) {
    const item = record(entry);
    const path = guestPath(item.path);
    if (item.kind === 'write') {
      exact(item, ['kind', 'path', 'baseSha256', 'size', 'sha256', 'data']);
      requireValue(item.baseSha256 === null || hash(item.baseSha256), '基础哈希无效');
      bytes += fileContent(item);
      requireValue(bytes <= MAX_CONTENT_BYTES, '导出内容总量超过限制');
    } else if (item.kind === 'delete') {
      exact(item, ['kind', 'path', 'baseSha256']);
      requireValue(hash(item.baseSha256), '删除需要基础哈希');
    } else {
      requireValue(item.kind === 'mkdir' || item.kind === 'rmdir', '拒绝链接、重解析点和特殊文件');
      exact(item, ['kind', 'path']);
    }
    validatePaths(paths, path, item.kind === 'write' || item.kind === 'delete');
  }
  validateParents(paths);
}

function validateMessage(raw: unknown, direction: 'host' | 'guest', runId?: string): WireMessage {
  const message = record(raw);
  const fields = ['version', 'runId', 'type'];
  requireValue(message.version === 1 && typeof message.runId === 'string' && message.runId.length === 32 && !/[^0-9a-f]/.test(message.runId)
    && (runId === undefined || message.runId === runId), '协议版本或执行 ID 不匹配');
  if (direction === 'host' && message.type === 'input') {
    exact(message, [...fields, 'workspace', 'readOnly']);
    validateInput(message);
  } else if (direction === 'host' && message.type === 'run') {
    exact(message, [...fields, 'executable', 'args', 'cwd', 'timeoutMs']);
    requireValue(isRuntimeAlias(message.executable), '运行时名称无效');
    requireValue(Array.isArray(message.args) && message.args.length <= 64
      && message.args.every(arg => typeof arg === 'string' && arg.length <= 4096 && !arg.includes('\0'))
      && message.args.reduce((total, arg: string) => total + arg.length + 1, 0) <= 12_000, '命令参数无效');
    requireValue(integer(message.timeoutMs, 100, 120_000), '超时值无效');
    if (message.cwd !== '.') guestPath(message.cwd);
  } else if (direction === 'guest' && message.type === 'output') {
    exact(message, [...fields, 'stream', 'text']);
    requireValue((message.stream === 'stdout' || message.stream === 'stderr') && typeof message.text === 'string'
      && Buffer.byteLength(message.text) <= MAX_CHUNK_BYTES, '输出块无效或超过限制');
  } else if (direction === 'guest' && message.type === 'result') {
    exact(message, [...fields, 'exitCode', 'changes']);
    requireValue(message.exitCode === null || integer(message.exitCode, -0x80000000, 0xffffffff), '退出码无效');
    validateChanges(message.changes);
  } else throw new Error('VM 协议：消息类型或方向错误');
  return message as unknown as WireMessage;
}

/** A single frame is uint32 LE byte length followed by strict UTF-8 JSON. */
export function encodeFrame(message: WireMessage): Buffer {
  validateMessage(message, message.type === 'input' || message.type === 'run' ? 'host' : 'guest');
  const body = Buffer.from(JSON.stringify(message));
  requireValue(body.length <= MAX_FRAME_BYTES, '帧过长');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length);
  return Buffer.concat([header, body]);
}

export class GuestFrameReader {
  private readonly header = Buffer.alloc(4);
  private readonly utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  private headerBytes = 0;
  private body: Buffer | undefined;
  private bodyBytes = 0;
  private wireBytes = 0;
  private messages = 0;
  private output = { stdout: 0, stderr: 0 };
  private result: GuestResultFrame | undefined;
  private closed = false;
  private failed = false;

  constructor(private readonly runId: string) {}

  push(bytes: Buffer): GuestOutputFrame[] {
    requireValue(!this.failed && !this.closed, '协议读取器已关闭');
    try {
      this.wireBytes += bytes.length;
      requireValue(this.wireBytes <= MAX_WIRE_BYTES, '执行传输量超过限制');
      const messages: GuestOutputFrame[] = [];
      let offset = 0;
      while (offset < bytes.length) {
        requireValue(!this.result, '终态后收到额外数据');
        if (!this.body) {
          const copied = bytes.copy(this.header, this.headerBytes, offset);
          this.headerBytes += copied;
          offset += copied;
          if (this.headerBytes < 4) break;
          const length = this.header.readUInt32LE();
          requireValue(length > 0 && length <= MAX_FRAME_BYTES, '帧长度无效');
          this.body = Buffer.alloc(length);
        }
        const copied = bytes.copy(this.body, this.bodyBytes, offset);
        offset += copied;
        this.bodyBytes += copied;
        if (this.bodyBytes < this.body.length) break;
        requireValue(++this.messages <= MAX_MESSAGES, '消息数超过限制');
        const message = validateMessage(JSON.parse(this.utf8.decode(this.body)), 'guest', this.runId) as GuestMessage;
        this.body = undefined;
        this.headerBytes = this.bodyBytes = 0;
        if (message.type === 'output') {
          this.output[message.stream] += Buffer.byteLength(message.text);
          requireValue(this.output[message.stream] <= MAX_OUTPUT_BYTES, '输出总量超过限制');
          messages.push(message);
        } else this.result = message;
      }
      return messages;
    } catch (error) {
      this.failed = true;
      this.body = undefined;
      this.result = undefined;
      throw error;
    }
  }

  finish(): GuestResultFrame {
    requireValue(!this.closed, '协议读取器已关闭');
    this.closed = true;
    this.body = undefined;
    const result = this.result;
    this.result = undefined;
    requireValue(!this.failed && result && this.headerBytes === 0, '数据截断或缺少终态');
    return result;
  }
}
