// Preload 仅暴露有类型的方法；Renderer 无法指定 IPC 通道。
export const IPC = {
  snapshot: 'pet:snapshot', changed: 'pet:changed',
  beginDrag: 'pet:drag-begin', endDrag: 'pet:drag-end',
  wake: 'pet:wake', interact: 'pet:interact', finished: 'pet:animation-finished',
  openPanel: 'panel:open', closePanel: 'panel:close', menu: 'pet:menu',
  settings: 'settings:update', preview: 'pet:preview', stopPreview: 'pet:preview-stop',
} as const;
