import { lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, parse, relative, resolve, sep } from 'node:path';
export class WorkspaceSecurity {
  readonly root: string;
  constructor(root: string, private protectedRoots: string[] = []) {
    this.root = this.check(root);
    if (!lstatSync(this.root).isDirectory()) throw new Error('工作区必须是目录');
    if (parse(this.root).root === this.root) throw new Error('不能选择整个磁盘作为工作区');
  }
  private syntax(value: string) {
    if (!value || value.length > 240 || /[\x00-\x1f]/.test(value) || value.startsWith('\\\\') || value.startsWith('//')) throw new Error('拒绝 UNC、设备路径或过长路径');
    const rest = value.replace(/^[a-z]:[\\/]/i, '');
    if (rest.includes(':') || rest.split(/[\\/]/).some(p => /[. ]$/.test(p) && p !== '..' && p !== '.' || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) throw new Error('拒绝 ADS、盘符相对路径或特殊设备名');
  }
  contains(root: string, path: string) { const rel = relative(root, path); return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`)); }
  private check(path: string): string {
    this.syntax(path); const absolute = resolve(path); const parts = relative(parse(absolute).root, absolute).split(sep); let current = parse(absolute).root;
    for (const part of parts) {
      current = resolve(current, part);
      try {
        const st = lstatSync(current);
        if (st.isSymbolicLink() || (!st.isDirectory() && !st.isFile())) throw new Error('拒绝链接或特殊文件');
        const actual = realpathSync.native(current);
        if (relative(actual, current) !== '') throw new Error('路径重定向被拒绝');
      } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') break; throw error; }
    }
    return absolute;
  }
  path(input: string, write = false, allowRoot = false) {
    this.syntax(input); this.check(this.root);
    const target = this.check(isAbsolute(input) ? input : resolve(this.root, input));
    if (this.protectedRoots.some(root => this.contains(root, target))) throw new Error('应用数据和凭据目录禁止访问');
    if (write && (!this.contains(this.root, target) || (!allowRoot && relative(this.root, target) === ''))) throw new Error('禁止写入工作区外或操作工作区根目录');
    return target;
  }
}
