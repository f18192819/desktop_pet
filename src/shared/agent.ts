import type { TokenUsage } from './chat';
export interface ToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }
export interface AgentMessage { role: 'system' | 'user' | 'assistant' | 'tool'; content: string; tool_calls?: ToolCall[]; tool_call_id?: string }
export interface ToolRecord { id: string; name: string; arguments: string; status: 'pending' | 'running' | 'completed' | 'failed' | 'interrupted'; result?: string }
export interface FileChange { path: string; operation: string; before: string; after: string }
export interface Approval { id: string; taskId: string; tool: string; description: string; scope: readonly string[]; status: 'pending' | 'approved' | 'denied' }
export interface AgentTask { id: string; title: string; root: string; status: 'running' | 'waitingApproval' | 'completed' | 'failed' | 'cancelled' | 'interrupted'; messages: AgentMessage[]; tools: ToolRecord[]; changes: FileChange[]; approvals: Approval[]; plan: string; usage: TokenUsage[]; output: string; error: string; createdAt: number }
export interface WorkspaceState { root: string | null; valid: boolean; autoWrite: boolean; shell: { enabled: false; reason: string } }
export interface AgentSnapshot { tasks: AgentTask[]; activeId: string | null; notice: string }
