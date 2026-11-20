import Ajv from 'ajv';
const definitions: Record<string, string[]> = {
  list_directory: ['path'], read_file: ['path'], search_files: ['path', 'query'], find_files: ['path', 'query'],
  write_file: ['path', 'content'], apply_patch: ['path', 'oldText', 'newText'], create_directory: ['path'],
  move_path: ['path', 'destination'], rename_path: ['path', 'destination'], delete_path: ['path'], stat_path: ['path'], copy_path: ['path', 'destination'],
  update_plan: ['plan'], shell: ['command'], request_network: ['reason'],
};
const ajv = new Ajv({ allErrors: false });
export const tools = Object.entries(definitions).map(([name, fields]) => ({ type: 'function' as const, function: {
  name, description: name === 'apply_patch' ? 'Replace exactly one matching oldText with newText in a UTF-8 file.' : name === 'find_files' ? 'Find names with * glob. Bounded traversal.' : name === 'copy_path' ? 'Copy files or directories, including binary files, into workspace. Maximum total 8 MiB.' : name === 'shell' ? 'Unavailable: OS sandbox has not passed certification. Never pretend commands ran.' : name,
  parameters: { type: 'object', properties: Object.fromEntries(fields.map(f => [f, { type: 'string', maxLength: f === 'content' || f === 'oldText' || f === 'newText' ? 524288 : 8000 }])), required: fields, additionalProperties: false },
} }));
const validators = new Map(tools.map(t => [t.function.name, ajv.compile(t.function.parameters)]));
export function validateTool(name: string, args: string): Record<string, string> {
  if (args.length > 1_100_000) throw new Error('工具参数过大');
  let value: unknown; try { value = JSON.parse(args); } catch { throw new Error('工具参数不是合法 JSON'); }
  const validate = validators.get(name); if (!validate || !validate(value)) throw new Error('工具名或 JSON Schema 参数校验失败');
  return value as Record<string, string>;
}
export const writes = new Set(['write_file', 'apply_patch', 'create_directory', 'move_path', 'rename_path', 'delete_path', 'copy_path']);
