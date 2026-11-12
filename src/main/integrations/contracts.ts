import type { PetActivityEvent } from '../../shared/types';
import type { BalanceState, TokenUsage } from '../../shared/chat';

// 以下接口仅属于主进程；认证令牌、文件系统和工具能力不进入 Renderer。
export interface ChatMessage { role: 'user' | 'assistant'; text: string }
export type ChatChunk = { type: 'text'; text: string } | { type: 'usage'; usage: TokenUsage } | { type: 'done'; finishReason: string | null };
export interface ChatProvider {
  send(messages: readonly ChatMessage[], signal: AbortSignal): AsyncIterable<ChatChunk>;
  listModels(signal: AbortSignal): Promise<string[]>;
  testConnection(signal: AbortSignal): Promise<void>;
  getBalance(signal: AbortSignal): Promise<BalanceState>;
}
export interface AgentRuntime {
  startTask(prompt: string, signal: AbortSignal): AsyncIterable<PetActivityEvent>;
  cancelTask(taskId: string): Promise<void>;
}
export interface PermissionRequest {
  id: string;
  taskId: string;
  tool: string;
  description: string;
  scope: readonly string[];
}
export interface PermissionManager {
  request(request: PermissionRequest, signal: AbortSignal): Promise<'approved' | 'denied'>;
  revokeTask(taskId: string): void;
}
// AgentRuntime / PermissionManager 仅保留接口，第二阶段不执行工具。
