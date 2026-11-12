import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/channels';
import type { AppSnapshot, DesktopPetAPI } from '../shared/types';

const api: DesktopPetAPI = {
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
};
contextBridge.exposeInMainWorld('desktopPet', Object.freeze(api));
