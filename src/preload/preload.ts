import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/channels';
import type { AppSnapshot, DesktopPetAPI } from '../shared/types';
import type { ChatSnapshot, ProviderState } from '../shared/chat';

function subscribe<T>(channel: string, callback: (value: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, value: T) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api: DesktopPetAPI = {
  getWorkspace: () => ipcRenderer.invoke(IPC.workspace),
  onWorkspaceChanged: callback => subscribe(IPC.workspaceChanged, callback),
  chooseWorkspace: () => ipcRenderer.invoke(IPC.workspaceChoose),
  setToolPermission: update => ipcRenderer.invoke(IPC.toolPermission, update),
  getAgentSnapshot: () => ipcRenderer.invoke(IPC.agent),
  onAgentSnapshot: callback => subscribe(IPC.agentChanged, callback),
  startAgent: prompt => ipcRenderer.invoke(IPC.agentStart, prompt),
  resumeAgent: id => ipcRenderer.invoke(IPC.agentResume, id),
  cancelAgent: id => ipcRenderer.invoke(IPC.agentCancel, id),
  decideApproval: input => ipcRenderer.invoke(IPC.agentApproval, input),
  getSnapshot: () => ipcRenderer.invoke(IPC.snapshot),
  onSnapshot: callback => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: AppSnapshot) => callback(snapshot);
    ipcRenderer.on(IPC.changed, listener);
    return () => ipcRenderer.removeListener(IPC.changed, listener);
  },
  beginDrag: anchor => ipcRenderer.invoke(IPC.beginDrag, anchor),
  endDrag: () => ipcRenderer.invoke(IPC.endDrag),
  wake: () => ipcRenderer.invoke(IPC.wake),
  interact: emotion => ipcRenderer.invoke(IPC.interact, emotion),
  animationFinished: revision => ipcRenderer.invoke(IPC.finished, revision),
  openPanel: panel => ipcRenderer.invoke(IPC.openPanel, panel),
  closePanel: () => ipcRenderer.invoke(IPC.closePanel),
  showContextMenu: () => ipcRenderer.invoke(IPC.menu),
  updateSettings: patch => ipcRenderer.invoke(IPC.settings, patch),
  previewAnimation: animation => ipcRenderer.invoke(IPC.preview, animation),
  stopPreview: () => ipcRenderer.invoke(IPC.stopPreview),
  getProviderState: () => ipcRenderer.invoke(IPC.provider),
  onProviderState: callback => subscribe<ProviderState>(IPC.providerChanged, callback),
  saveProvider: input => ipcRenderer.invoke(IPC.providerSave, input),
  clearApiKey: () => ipcRenderer.invoke(IPC.keyClear),
  listModels: () => ipcRenderer.invoke(IPC.models),
  selectModel: model => ipcRenderer.invoke(IPC.modelSelect, model),
  testConnection: () => ipcRenderer.invoke(IPC.test),
  refreshBalance: () => ipcRenderer.invoke(IPC.balance),
  getChatSnapshot: () => ipcRenderer.invoke(IPC.chat),
  onChatSnapshot: callback => subscribe<ChatSnapshot>(IPC.chatChanged, callback),
  createConversation: () => ipcRenderer.invoke(IPC.chatCreate),
  selectConversation: id => ipcRenderer.invoke(IPC.chatSelect, id),
  renameConversation: input => ipcRenderer.invoke(IPC.chatRename, input),
  deleteConversation: id => ipcRenderer.invoke(IPC.chatDelete, id),
  sendChat: input => ipcRenderer.invoke(IPC.chatSend, input),
  cancelChat: requestId => ipcRenderer.invoke(IPC.chatCancel, requestId),
};
contextBridge.exposeInMainWorld('desktopPet', Object.freeze(api));
