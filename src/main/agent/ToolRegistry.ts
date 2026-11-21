import Ajv from 'ajv';
import { READ_TOOLS, WRITE_TOOLS } from '../../shared/agent';
import type { FileTool, ShellCommand } from '../../shared/agent';
import { commandOperation, shellParameters } from './CommandPolicy';
import type { WorkspaceSecurity } from './WorkspaceSecurity';
const definitions: Record<string, string[]> = {
  list_directory: ['path'], read_file: ['path'], search_files: ['path', 'query'], find_files: ['path', 'query'],
  write_file: ['path', 'content'], apply_patch: ['path', 'oldText', 'newText'], create_directory: ['path'],
  move_path: ['path', 'destination'], rename_path: ['path', 'destination'], delete_path: ['path'], stat_path: ['path'], copy_path: ['path', 'destination'],
  update_plan: ['plan'], shell: [], request_network: ['reason'],
};
const ajv = new Ajv({ allErrors: false });
export const tools = Object.entries(definitions).map(([name, fields]) => ({ type: 'function' as const, function: {
  name, description: name === 'apply_patch' ? 'Replace exactly one matching oldText with newText in a UTF-8 file.' : name === 'find_files' ? 'Find names with * glob. Bounded traversal.' : name === 'copy_path' ? 'Copy files or directories, including binary files, into workspace. Maximum total 8 MiB.' : name === 'shell' ? 'Unavailable: OS sandbox has not passed certification. Never pretend commands ran.' : name,
  parameters: name === 'shell' ? shellParameters : { type: 'object', properties: Object.fromEntries(fields.map(f => [f, { type: 'string', maxLength: f === 'content' || f === 'oldText' || f === 'newText' ? 524288 : 8000 }])), required: fields, additionalProperties: false },
} }));
const validators = new Map(tools.map(t => [t.function.name, ajv.compile(t.function.parameters)]));
function parseTool(name: string, args: string): unknown {
  if (args.length > 1_100_000) throw new Error('工具参数过大');
  let value: unknown; try { value = JSON.parse(args); } catch { throw new Error('工具参数不是合法 JSON'); }
  const validate = validators.get(name); if (!validate || !validate(value)) throw new Error('工具名或 JSON Schema 参数校验失败');
  return value;
}

export function validateShellTool(args: string): ShellCommand {
  return parseTool('shell', args) as ShellCommand;
}

export function validateTool(name: string, args: string): Record<string, string> {
  if (name === 'shell') throw new Error('Shell 需要结构化参数校验');
  return parseTool(name, args) as Record<string, string>;
}
const reads: ReadonlySet<string> = new Set(READ_TOOLS);
const writes: ReadonlySet<string> = new Set(WRITE_TOOLS);
const impacts: Record<FileTool, string> = {
  list_directory: '列出目录中的条目。',
  read_file: '读取文件内容。',
  search_files: '在文件内容中搜索并返回匹配项。',
  find_files: '按名称查找文件或目录。',
  stat_path: '查看文件或目录的属性。',
  write_file: '创建新文件或覆盖现有文件的内容。',
  apply_patch: '替换文件中匹配的文本。',
  create_directory: '创建目录。',
  copy_path: '读取源文件或目录，写入目标。复制单个文件可能覆盖目标文件。',
  move_path: '将源文件或目录移到目标路径。',
  rename_path: '将源文件或目录重命名为目标路径。',
  delete_path: '删除文件，或递归删除目录及其内容。',
};

export function fileOperation(name: string, args: Record<string, string>, security: WorkspaceSecurity) {
  if (!reads.has(name) && !writes.has(name)) throw new Error('此工具不可执行');
  const tool = name as FileTool;
  const source = security.operationPath(args.path, reads.has(name) || tool === 'copy_path' ? 'read' : 'write');
  const paths = [source];
  const normalized = { ...args, path: source.path };
  if (tool === 'copy_path' || tool === 'move_path' || tool === 'rename_path') {
    const destination = security.operationPath(args.destination, 'write');
    paths.push(destination);
    Object.assign(normalized, { destination: destination.path });
  }
  const description = impacts[tool] + (paths.some(path => path.outsideWorkspace) ? '读取结果可能发送给当前模型服务商。' : '');
  return { tool, args: normalized, paths, description };
}

export function prepareTool(name: string, json: string, security: WorkspaceSecurity) {
  if (name === 'shell') return {
    kind: 'shell' as const,
    tool: 'shell' as const,
    description: '仅授权这次命令和列出的外部只读路径。执行需要通过安全验收的沙箱。',
    ...commandOperation(validateShellTool(json), security),
  };
  const args = validateTool(name, json);
  if (name === 'request_network') throw new Error('网络工具已禁用：当前未实现网络执行');
  if (name === 'update_plan') return { kind: 'plan' as const, plan: args.plan };
  return { kind: 'file' as const, ...fileOperation(name, args, security) };
}
