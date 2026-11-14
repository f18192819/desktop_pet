import { closeSync, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import { WorkspaceSecurity } from './WorkspaceSecurity';
import type { FileChange } from '../../shared/agent';
const MAX = 512 * 1024;
export class WorkspaceFS {
  constructor(readonly security: WorkspaceSecurity, private changed: (change: FileChange) => void) {}
  read(path: string) {
    const target = this.security.path(path); const fd = openSync(target, 'r');
    try { const st = fstatSync(fd); if (!st.isFile() || st.size > MAX) throw new Error('只读取不超过 512 KiB 的普通文本文件'); const text = readFileSync(fd, 'utf8'); if (text.includes('\0')) throw new Error('不支持二进制文件'); return text; } finally { closeSync(fd); }
  }
  write(path: string, text: string) {
    if (Buffer.byteLength(text) > MAX) throw new Error('写入内容超过 512 KiB');
    const target = this.security.path(path, true); const before = existsSync(target) ? this.read(target) : '';
    if (existsSync(target) && lstatSync(target).nlink > 1) throw new Error('拒绝覆盖硬链接文件');
    const temp = join(dirname(target), `.emma-${randomUUID()}.tmp`); let fd: number | undefined;
    try { fd = openSync(temp, 'wx', 0o600); writeFileSync(fd, text); fsyncSync(fd); closeSync(fd); fd = undefined; this.security.path(target, true); renameSync(temp, target); }
    finally { if (fd !== undefined) closeSync(fd); if (existsSync(temp)) unlinkSync(temp); }
    this.changed({ path: target, operation: 'write', before, after: text }); return '文件已写入';
  }
  walk(path: string, depth = 0, entries: string[] = []) {
    const target = this.security.path(path); if (depth > 12) throw new Error('目录深度超过 12');
    for (const entry of readdirSync(target, { withFileTypes: true })) {
      if (entries.length >= 2000) throw new Error('目录遍历超过 2000 项');
      const child = join(target, entry.name); this.security.path(child); entries.push(child);
      if (entry.isDirectory()) this.walk(child, depth + 1, entries);
    } return entries;
  }
  execute(name: string, a: Record<string, string>) {
    const path = a.path;
    if (name === 'read_file') return this.read(path);
    if (name === 'stat_path') { const p = this.security.path(path); const s = lstatSync(p); return { path: p, size: s.size, directory: s.isDirectory(), links: s.nlink }; }
    if (name === 'list_directory') { const names = readdirSync(this.security.path(path)); if (names.length > 2000) throw new Error('目录超过 2000 项'); return names; }
    if (name === 'find_files' || name === 'search_files') {
      const files = this.walk(path); const results: string[] = []; let bytes = 0;
      const glob = new RegExp('^' + a.query.split('*').map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 'i');
      for (const file of files) {
        if (results.length >= 100) break;
        if (name === 'find_files') { if (glob.test(basename(file)) || glob.test(relative(this.security.path(path), file).replaceAll('\\', '/'))) results.push(file); }
        else if (lstatSync(file).isFile()) { bytes += lstatSync(file).size; if (bytes > 8 * 1024 * 1024) throw new Error('搜索读取超过 8 MiB'); try { this.read(file).split('\n').forEach((line, i) => { if (line.includes(a.query) && results.length < 100) results.push(`${file}:${i + 1}: ${line.slice(0, 500)}`); }); } catch { /* skip large or binary files */ } }
      } return results;
    }
    if (name === 'write_file') return this.write(path, a.content);
    if (name === 'apply_patch') { const text = this.read(path); if (!a.oldText || text.split(a.oldText).length !== 2) throw new Error('补丁旧文本必须唯一匹配'); return this.write(path, text.replace(a.oldText, () => a.newText)); }
    if (name === 'copy_path') {
      const source = this.security.path(path); const dest = this.security.path(a.destination, true);
      if (!lstatSync(source).isDirectory()) return this.write(dest, this.read(source));
      if (existsSync(dest) || this.security.contains(source, dest)) throw new Error('复制目录目标必须不存在且不能位于源内');
      const files = this.walk(source); let bytes = 0;
      const contents = files.map(p => { if (lstatSync(p).isDirectory()) return { p, text: null }; const text = this.read(p); bytes += Buffer.byteLength(text); if (bytes > 8 * 1024 * 1024) throw new Error('复制内容超过 8 MiB'); return { p, text }; });
      mkdirSync(dest);
      for (const item of contents) { const output = this.security.path(join(dest, relative(source, item.p)), true); if (item.text === null) mkdirSync(output); else this.write(output, item.text); }
      return '文本目录已复制';
    }
    const target = this.security.path(path, true);
    if (name === 'create_directory') { mkdirSync(target); this.changed({ path: target, operation: name, before: '', after: '[directory]' }); return '目录已创建'; }
    if (name === 'move_path' || name === 'rename_path') {
      const dest = this.security.path(a.destination, true); if (existsSync(dest)) throw new Error('目标已存在');
      if (lstatSync(target).isDirectory()) this.walk(target); else if (lstatSync(target).nlink > 1) throw new Error('拒绝移动硬链接');
      renameSync(target, dest); this.changed({ path: target, operation: name, before: target, after: dest }); return '已移动';
    }
    if (name === 'delete_path') {
      const before = lstatSync(target).isDirectory() ? '[directory tree]' : this.read(target);
      const paths = lstatSync(target).isDirectory() ? this.walk(target).reverse().concat(target) : [target];
      for (const p of paths) { this.security.path(p, true); if (lstatSync(p).nlink > 1 && lstatSync(p).isFile()) throw new Error('拒绝删除硬链接'); }
      for (const p of paths) { this.security.path(p, true); if (lstatSync(p).isDirectory()) rmdirSync(p); else unlinkSync(p); }
      this.changed({ path: target, operation: name, before, after: '' }); return '已删除';
    }
    throw new Error('未知文件工具');
  }
}
