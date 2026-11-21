import type { TokenUsage } from './chat';

export const READ_TOOLS = ['list_directory', 'read_file', 'search_files', 'find_files', 'stat_path'] as const;
export const WRITE_TOOLS = ['write_file', 'apply_patch', 'create_directory', 'copy_path', 'move_path', 'rename_path', 'delete_path'] as const;
export type FileTool = typeof READ_TOOLS[number] | typeof WRITE_TOOLS[number];
export const PERMISSION_KEYS = [...READ_TOOLS, 'external_read', ...WRITE_TOOLS] as const;
export type PermissionKey = typeof PERMISSION_KEYS[number];
export type PermissionMode = 'allow' | 'ask' | 'deny';
export type ToolPermissions = Record<PermissionKey, PermissionMode>;
export interface PermissionUpdate { identity: string; tool: PermissionKey; mode: PermissionMode }
export interface OperationPath { path: string; access: 'read' | 'write'; outsideWorkspace: boolean }

export interface ToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }
export interface AgentMessage { role: 'system' | 'user' | 'assistant' | 'tool'; content: string; tool_calls?: ToolCall[]; tool_call_id?: string }
export interface ToolRecord { id: string; name: string; arguments: string; status: 'pending' | 'running' | 'completed' | 'failed' | 'interrupted'; result?: string }
export interface FileChange { path: string; operation: string; before: string; after: string }
export interface Approval { id: string; taskId: string; tool: string; description: string; scope: readonly string[]; paths?: readonly OperationPath[]; status: 'pending' | 'approved' | 'denied' }
export interface AgentTask { id: string; title: string; root: string; rootIdentity?: string; status: 'running' | 'waitingApproval' | 'completed' | 'failed' | 'cancelled' | 'interrupted'; messages: AgentMessage[]; tools: ToolRecord[]; changes: FileChange[]; approvals: Approval[]; plan: string; usage: TokenUsage[]; output: string; error: string; createdAt: number }
export interface WorkspaceState { root: string | null; identity: string | null; valid: boolean; issue: string | null; permissions: ToolPermissions; shell: { enabled: false; reason: string } }
export interface AgentSnapshot { tasks: AgentTask[]; activeId: string | null; notice: string }
