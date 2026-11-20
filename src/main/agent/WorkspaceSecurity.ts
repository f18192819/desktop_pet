import { isAbsolute, parse, relative, resolve, sep } from 'node:path';
import { nativeCall } from './NativeWorkspaceProxy';
export class WorkspaceSecurity {
  readonly root: string;
  readonly identity: string;
  constructor(root: string, readonly protectedRoots: string[] = []) {
    this.root = resolve(root);
    this.identity = nativeCall(this.root, '', protectedRoots, 'identity', {}) as string;
  }
  contains(root: string, path: string) { const rel = relative(root, path); return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`)); }
  // Approval preflight only. Native policy is repeated under held handles.
  path(input: string, write = false, allowRoot = false) {
    if (!input || input.length > 240 || /[\x00-\x1f]/.test(input) || /^[\\/]/.test(input)) throw new Error('不支持的路径');
    const rest = input.replace(/^[a-z]:[\\/]/i, '');
    if (/[<>:"|?*]/.test(rest) || rest.split(/[\\/]/).some(p => p !== '..' && p !== '.' && (/[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)))) throw new Error('拒绝 ADS、设备名或歧义路径');
    const target = resolve(this.root, input);
    if (parse(target).root === target || this.protectedRoots.some(root => this.contains(root, target))) throw new Error('禁止访问根目录或应用数据');
    if (write && (!this.contains(this.root, target) || (!allowRoot && relative(this.root, target) === ''))) throw new Error('禁止写入工作区外或操作工作区根目录');
    return target;
  }
  call(op: string, args: Record<string, string>) { return nativeCall(this.root, this.identity, this.protectedRoots, op, args); }
}
