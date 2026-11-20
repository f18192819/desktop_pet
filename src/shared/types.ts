import type { ChatSnapshot, ProviderInput, ProviderState } from './chat';
import type { AgentSnapshot, WorkspaceState } from './agent';
export const ANIMATIONS = ['idle', 'thinking', 'angry', 'working', 'question', 'dragged', 'sleeping', 'happy'] as const;
export type AnimationName = typeof ANIMATIONS[number];
export const ACTIVITIES = ['idle', 'thinking', 'responding', 'working', 'waitingApproval', 'success'] as const;
export type PetActivity = typeof ACTIVITIES[number];
export type Emotion = 'happy' | 'angry' | 'question';
export type Panel = 'chat' | 'work' | 'settings';
export interface PetSettings {
  position: { x: number; y: number } | null;
  size: number;
  alwaysOnTop: boolean;
  animationEnabled: boolean;
  sleepAfterMs: number;
  skin: 'emma';
}
export type SettingsPatch = Partial<Omit<PetSettings, 'position'>>;
export interface PetSnapshot {
  animation: AnimationName;
  activity: PetActivity;
  revision: number;
  paused: boolean;
  priority: number;
}
export interface AppSnapshot {
  pet: PetSnapshot;
  settings: PetSettings;
  visible: boolean;
  notice: string | null;
}
export interface PetActivityEvent {
  activity: PetActivity;
  source: 'chat' | 'agent';
  taskId?: string;
}
export interface DesktopPetAPI {
  getWorkspace(): Promise<WorkspaceState>;
  onWorkspaceChanged(callback: (state: WorkspaceState) => void): () => void;
  chooseWorkspace(): Promise<void>;
  setAutoWrite(value: boolean): Promise<void>;
  getAgentSnapshot(): Promise<AgentSnapshot>;
  onAgentSnapshot(callback: (state: AgentSnapshot) => void): () => void;
  startAgent(prompt: string): Promise<string>;
  resumeAgent(id: string): Promise<void>;
  cancelAgent(id: string): Promise<void>;
  decideApproval(input: { id: string; approved: boolean }): Promise<void>;
  getSnapshot(): Promise<AppSnapshot>;
  onSnapshot(callback: (snapshot: AppSnapshot) => void): () => void;
  beginDrag(anchor: { x: number; y: number }): Promise<void>;
  endDrag(): Promise<{ dragged: boolean }>;
  wake(): Promise<void>;
  interact(emotion: Emotion): Promise<void>;
  animationFinished(revision: number): Promise<void>;
  openPanel(panel: Panel): Promise<void>;
  closePanel(): Promise<void>;
  showContextMenu(): Promise<void>;
  updateSettings(patch: SettingsPatch): Promise<void>;
  previewAnimation(animation: AnimationName): Promise<void>;
  stopPreview(): Promise<void>;
  getProviderState(): Promise<ProviderState>;
  onProviderState(callback: (state: ProviderState) => void): () => void;
  saveProvider(input: ProviderInput): Promise<void>;
  clearApiKey(): Promise<void>;
  listModels(): Promise<string[]>;
  selectModel(model: string): Promise<void>;
  testConnection(): Promise<void>;
  refreshBalance(): Promise<void>;
  getChatSnapshot(): Promise<ChatSnapshot>;
  onChatSnapshot(callback: (state: ChatSnapshot) => void): () => void;
  createConversation(): Promise<void>;
  selectConversation(id: string): Promise<void>;
  renameConversation(input: { id: string; title: string }): Promise<void>;
  deleteConversation(id: string): Promise<void>;
  sendChat(input: { sessionId: string; text: string }): Promise<void>;
  cancelChat(requestId: string): Promise<void>;
}
