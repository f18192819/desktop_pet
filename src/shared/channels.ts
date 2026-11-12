// Preload 仅暴露有类型的方法；Renderer 无法指定 IPC 通道。
export const IPC = {
  snapshot: 'pet:snapshot', changed: 'pet:changed',
  beginDrag: 'pet:drag-begin', endDrag: 'pet:drag-end',
  wake: 'pet:wake', interact: 'pet:interact', finished: 'pet:animation-finished',
  openPanel: 'panel:open', closePanel: 'panel:close', menu: 'pet:menu',
  settings: 'settings:update', preview: 'pet:preview', stopPreview: 'pet:preview-stop',
  provider: 'ai:provider', providerChanged: 'ai:provider-changed', providerSave: 'ai:save',
  keyClear: 'ai:key-clear', models: 'ai:models', test: 'ai:test', balance: 'ai:balance',
  modelSelect: 'ai:model-select',
  chat: 'chat:snapshot', chatChanged: 'chat:changed', chatCreate: 'chat:create',
  chatSelect: 'chat:select', chatRename: 'chat:rename', chatDelete: 'chat:delete',
  chatSend: 'chat:send', chatCancel: 'chat:cancel',
} as const;
