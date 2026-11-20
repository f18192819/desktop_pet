import { isAbsolute, parse, relative, resolve, sep } from 'node:path';
import { nativeCall } from './NativeWorkspaceProxy';

export function isWorkspaceIdentity(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9A-F]{8}:[0-9A-F]{16}$/.test(value);
}

export class WorkspaceSecurity {
  private constructor(readonly root: string, readonly identity: string, private readonly protectedRoots: readonly string[]) {}

  static async open(root: string, protectedRoots: readonly string[] = [], expectedIdentity?: string, signal?: AbortSignal) {
    const path = resolve(root);
    const identity = await nativeCall(path, expectedIdentity ?? '', protectedRoots, 'identity', {}, signal);
    if (!isWorkspaceIdentity(identity) || (expectedIdentity !== undefined && identity !== expectedIdentity)) {
      throw new Error('工作区身份无效或已变化，请在设置中重新选择');
    }
    return new WorkspaceSecurity(path, identity, protectedRoots);
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
  call(op: string, args: Record<string, string>, signal?: AbortSignal) {
    return nativeCall(this.root, this.identity, this.protectedRoots, op, args, signal);
  }
}
