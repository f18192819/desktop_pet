import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export function atomicWrite(file: string, data: string | Buffer): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, data, { mode: 0o600 });
  renameSync(`${file}.tmp`, file);
}
export function readJSON(file: string): unknown {
  if (statSync(file).size > 50 * 1024 * 1024) throw new Error('数据文件过大');
  return JSON.parse(readFileSync(file, 'utf8'));
}
export function preserveBroken(file: string): void {
  if (existsSync(file)) {
    try { renameSync(file, `${file}.broken-${Date.now()}`); }
    catch { throw new Error('无法备份损坏的数据文件，已停止写入'); }
  }
}
