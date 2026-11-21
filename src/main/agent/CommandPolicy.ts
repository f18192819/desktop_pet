import { isAbsolute } from 'node:path';
import type { ShellCommand } from '../../shared/agent';
import type { WorkspaceSecurity } from './WorkspaceSecurity';

const aliases = new Set(['powershell', 'pwsh', 'cmd', 'python', 'python3', 'node', 'git', 'npm', 'pnpm', 'yarn', 'pip', 'uv']);
export function isRuntimeAlias(value: unknown): value is string { return typeof value === 'string' && aliases.has(value); }
const pathSchema = { type: 'string', minLength: 1, maxLength: 240 };

export const shellParameters = {
  type: 'object',
  properties: {
    executable: pathSchema,
    args: { type: 'array', maxItems: 64, items: { type: 'string', maxLength: 4096, pattern: '^[^\\u0000]*$' } },
    cwd: pathSchema,
    readOnlyPaths: { type: 'array', maxItems: 16, uniqueItems: true, items: pathSchema },
    timeoutMs: { type: 'integer', minimum: 100, maximum: 120_000 },
  },
  required: ['executable', 'args', 'cwd', 'readOnlyPaths', 'timeoutMs'],
  additionalProperties: false,
};

export function commandOperation(input: ShellCommand, security: WorkspaceSecurity) {
  const cwd = security.operationPath(input.cwd, 'read');
  if (cwd.outsideWorkspace) throw new Error('命令工作目录必须在工作区内');

  const executable = input.executable.toLowerCase().replace(/\.exe$/, '');
  if (!isRuntimeAlias(executable)) throw new Error('请使用受支持的内置运行时名称');

  const paths = input.readOnlyPaths.map(path => {
    if (!isAbsolute(path)) throw new Error('外部只读路径必须是绝对路径');
    const target = security.operationPath(path, 'read');
    if (!target.outsideWorkspace) throw new Error('readOnlyPaths 只接受工作区外的路径');
    return target;
  });
  if (new Set(paths.map(path => path.path)).size !== paths.length) throw new Error('外部只读路径重复');
  if (input.args.reduce((total, arg) => total + arg.length + 1, 0) > 12_000) throw new Error('命令参数总长度超过限制');
  const command = { ...input, executable, cwd: cwd.path, readOnlyPaths: paths.map(path => path.path) };
  return { command, paths };
}
