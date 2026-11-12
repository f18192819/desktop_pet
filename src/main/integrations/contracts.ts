import type { PetActivityEvent } from '../../shared/types';

// 以下接口仅属于主进程；认证令牌、文件系统和工具能力不进入 Renderer。
export interface ChatMessage { role: 'user' | 'assistant'; text: string }
export interface ChatProvider {
  readonly connected: boolean;
  send(message: string, signal: AbortSignal): AsyncIterable<{ type: 'text'; text: string } | PetActivityEvent>;
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
// MVP 没有 Provider/Runtime 实现，不发送请求、不启动 Shell，也不制造模型回复。
