export interface ProviderConfig {
  name: string; baseUrl: string; model: string;
  adapter: 'openai-compatible' | 'deepseek';
  includeUsage: boolean; timeoutMs: number;
}
export interface ProviderInput extends ProviderConfig { apiKey?: string }
export interface TokenUsage { prompt: number; completion: number; total: number }
export interface BalanceState {
  status: 'unsupported' | 'unknown' | 'loading' | 'available' | 'error';
  items: { currency: string; total: string }[];
  checkedAt?: number; error?: string;
}
export interface ProviderState {
  config: ProviderConfig; hasKey: boolean; encryptionAvailable: boolean;
  connection: 'untested' | 'checking' | 'connected' | 'error';
  authentication: 'unverified' | 'verified' | 'rejected' | 'not-required';
  lastError: string | null; checkedAt: number | null; balance: BalanceState;
  models: string[];
}
export interface StoredMessage {
  id: string; role: 'user' | 'assistant'; text: string; createdAt: number;
  status: 'complete' | 'streaming' | 'cancelled' | 'error' | 'interrupted';
  requestId?: string; error?: string; model?: string; provider?: string;
  usage?: TokenUsage; finishReason?: string;
}
export interface Conversation { id: string; title: string; createdAt: number; updatedAt: number; messages: StoredMessage[] }
export interface ChatSnapshot {
  sessions: Omit<Conversation, 'messages'>[]; selectedId: string | null; messages: StoredMessage[];
  active: { requestId: string; sessionId: string } | null;
  usage: TokenUsage; unreportedReplies: number; notice: string | null;
}
