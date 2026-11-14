import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, net, protocol, safeStorage, screen, session, Tray } from 'electron';
import { AgentService } from './agent/AgentService';
import type { IpcMainInvokeEvent, MenuItemConstructorOptions } from 'electron';
import { join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { IPC } from '../shared/channels';
import { ANIMATIONS } from '../shared/types';
import type { AnimationName, AppSnapshot, Emotion, Panel, SettingsPatch } from '../shared/types';
import { ConfigStore, isRecord, validatePatch } from './config';
import { fitToDisplays } from './geometry';
import { PetStateManager } from './PetStateManager';
import { CredentialStore } from './chat/CredentialStore';
import { ChatService } from './chat/ChatService';
import { boundedText } from './chat/validation';
import { validateId } from './chat/ConversationStore';

protocol.registerSchemesAsPrivileged([{ scheme: 'emma', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const PAGE = 'emma://app/index.html';
const panelTitles: Record<Panel, string> = { chat: '聊天', work: '工作面板', settings: '设置' };
function isPanel(value: unknown): value is Panel { return value === 'chat' || value === 'work' || value === 'settings'; }
function isAnimation(value: unknown): value is AnimationName { return ANIMATIONS.includes(value as AnimationName); }

export async function startApp() {
  app.setName('Emma Desktop Companion');
  if (!app.requestSingleInstanceLock()) { app.quit(); return null; }
  app.setAppUserModelId('local.emma.desktop-companion');
  await app.whenReady();
  Menu.setApplicationMenu(null);
  const rendererRoot = resolve(__dirname, '../renderer');
  const preload = join(__dirname, 'preload.cjs');
  protocol.handle('emma', request => {
    const url = new URL(request.url);
    if (url.hostname !== 'app' || request.method !== 'GET') return new Response(null, { status: 403 });
    let path: string;
    try { path = resolve(rendererRoot, `.${decodeURIComponent(url.pathname)}`); }
    catch { return new Response(null, { status: 400 }); }
    const child = relative(rendererRoot, path);
    if (child.startsWith(`..${sep}`) || child === '..' || child.includes(':')) return new Response(null, { status: 403 });
    return net.fetch(pathToFileURL(path).href);
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  const store = new ConfigStore(join(app.getPath('userData'), 'pet-settings.json'));
  const state = new PetStateManager(store.value.sleepAfterMs);
  const chat = new ChatService(app.getPath('userData'), new CredentialStore(join(app.getPath('userData'), 'ai-credentials.bin'), safeStorage), event => state.handleActivityEvent(event));
  const agent = new AgentService(app.getPath('userData'), () => chat.createAgentProvider(), event => state.handleActivityEvent(event));
  state.setPaused(!store.value.animationEnabled);
  let quitting = false;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const panels = new Map<Panel, BrowserWindow>();
  agent.subscribe(() => { const window = panels.get('work'); if (window && !window.isDestroyed()) window.webContents.send(IPC.agentChanged, agent.snapshot()); });
  chat.subscribe(() => {
    // 聊天内容只发送给聊天面板；设置面板只接收非敏感服务状态，桌宠不接收聊天数据。
    for (const [role, window] of panels) {
      if (window.isDestroyed() || window.webContents.isDestroyed()) continue;
      if (role === 'chat') window.webContents.send(IPC.chatChanged, chat.snapshot());
      if (role === 'chat' || role === 'settings') window.webContents.send(IPC.providerChanged, chat.providerSnapshot());
    }
  });
  const areas = () => screen.getAllDisplays().map(display => display.workArea);
  const initialBounds = fitToDisplays(store.value.position, store.value.size, areas());
  const pet = new BrowserWindow({
    ...initialBounds, title: '艾玛 · 桌宠 MVP', transparent: true, frame: false,
    alwaysOnTop: store.value.alwaysOnTop, skipTaskbar: true, resizable: false,
    maximizable: false, minimizable: false, fullscreenable: false,
    thickFrame: false, hasShadow: false, roundedCorners: false,
    backgroundColor: '#00000000', show: false,
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, backgroundThrottling: false },
  });
  // 保持整个窗口的鼠标交互，绝不全局 setIgnoreMouseEvents(true)。
  const icon = nativeImage.createFromPath(join(rendererRoot, 'characters/emma/frames/01_idle/frame_00.png'));
  if (icon.isEmpty()) throw new Error('找不到 Emma PNG 素材，请先执行 npm run build。');
  pet.setIcon(icon);
  const tray = new Tray(icon.resize({ width: 32, height: 32 }));
  tray.setToolTip('艾玛 · Desktop Companion');
  const snapshot = (): AppSnapshot => ({ pet: state.snapshot(), settings: structuredClone(store.value), visible: pet.isVisible(), notice: store.notice });
  function broadcast() {
    const value = snapshot();
    for (const window of [pet, ...panels.values()]) {
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send(IPC.changed, value);
    }
  }
  function save() {
    clearTimeout(saveTimer);
    try { store.save(); store.notice = null; }
    catch (error) { store.notice = '设置保存失败，请检查用户配置目录的写入权限。'; console.error('保存配置失败', error); }
  }
  function recordPosition() {
    if (pet.isDestroyed()) return;
    const { x, y } = pet.getBounds();
    store.value.position = { x, y };
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 180);
  }
  function correctBounds() {
    if (pet.isDestroyed()) return;
    const current = pet.getBounds();
    pet.setBounds(fitToDisplays(current, store.value.size, areas()));
    recordPosition();
  }
  let drag: { start: Electron.Point; origin: Electron.Rectangle; moved: boolean; started: number } | null = null;
  let dragTimer: ReturnType<typeof setInterval> | undefined;
  function moveDrag() {
    if (!drag) return;
    const cursor = screen.getCursorScreenPoint();
    const dx = cursor.x - drag.start.x;
    const dy = cursor.y - drag.start.y;
    if (!drag.moved && Math.hypot(dx, dy) >= 5) { drag.moved = true; state.setDragging(true); }
    if (drag.moved) pet.setPosition(Math.round(drag.origin.x + dx), Math.round(drag.origin.y + dy));
    if (Date.now() - drag.started > 120_000) endDrag(false);
  }
  function beginDrag(anchor: unknown) {
    const [width, height] = pet.getContentSize();
    if (!isRecord(anchor) || typeof anchor.x !== 'number' || typeof anchor.y !== 'number'
      || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)
      || anchor.x < 0 || anchor.y < 0 || anchor.x > width || anchor.y > height
      || Object.keys(anchor).some(key => key !== 'x' && key !== 'y')) throw new Error('无效的拖动锚点');
    if (drag || !pet.isVisible()) return;
    state.wake();
    const origin = pet.getBounds();
    // 仅接收窗口内抓取点；避免主进程收到 IPC 时鼠标已移动，造成首段位移丢失。
    drag = { start: { x: origin.x + anchor.x, y: origin.y + anchor.y }, origin, moved: false, started: Date.now() };
    dragTimer = setInterval(moveDrag, 16);
  }
  function endDrag(sampleFinalPosition = true) {
    if (sampleFinalPosition && drag) moveDrag();
    const moved = drag?.moved ?? false;
    drag = null;
    clearInterval(dragTimer);
    dragTimer = undefined;
    if (moved) { state.setDragging(false); correctBounds(); save(); }
    return { dragged: moved };
  }
  function secureWindow(window: BrowserWindow) {
    window.setMenuBarVisibility(false);
    window.on('page-title-updated', event => event.preventDefault());
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.on('will-attach-webview', event => event.preventDefault());
    window.webContents.on('did-finish-load', broadcast);
    window.webContents.on('did-fail-load', (_event, code, description) => console.error('页面加载失败', code, description));
    window.webContents.on('render-process-gone', (_event, details) => console.error('Renderer 退出', details.reason));
  }
  function openPanel(panel: Panel) {
    state.wake();
    const existing = panels.get(panel);
    if (existing && !existing.isDestroyed()) { existing.restore(); existing.show(); existing.focus(); return; }
    const window = new BrowserWindow({
      title: `艾玛 · ${panelTitles[panel]}`, width: panel === 'settings' ? 520 : 660, height: 720,
      minWidth: 420, minHeight: 560, backgroundColor: '#f8f6f2', show: false, icon,
      webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true },
    });
    panels.set(panel, window);
    secureWindow(window);
    window.on('closed', () => { panels.delete(panel); });
    void window.loadURL(`${PAGE}?panel=${panel}`).then(() => {
      if (!window.isDestroyed()) window.show();
    }).catch(error => console.error('面板加载失败', error));
  }
  function setVisible(visible: boolean) {
    if (visible) { correctBounds(); pet.showInactive(); pet.setAlwaysOnTop(store.value.alwaysOnTop, 'pop-up-menu'); state.wake(); }
    else { endDrag(); pet.hide(); }
    updateTray(); broadcast();
  }
  function updateSettings(patch: SettingsPatch) {
    endDrag();
    const before = store.value;
    store.value = { ...store.value, ...patch };
    try { store.save(); store.notice = null; }
    catch (error) { store.value = before; throw error; }
    // Windows 使用稳定的 topmost 层级；窗口仍约束在工作区内，不覆盖任务栏。
    pet.setAlwaysOnTop(store.value.alwaysOnTop, 'pop-up-menu');
    correctBounds();
    state.setPaused(!store.value.animationEnabled);
    state.setSleepAfter(store.value.sleepAfterMs);
    updateTray(); broadcast();
  }
  function contextMenu(): Electron.Menu {
    const template: MenuItemConstructorOptions[] = [
      { label: '打开聊天', click: () => openPanel('chat') },
      { label: '打开工作面板', click: () => openPanel('work') },
      { type: 'separator' },
      { label: store.value.animationEnabled ? '暂停动画' : '恢复动画', click: () => updateSettings({ animationEnabled: !store.value.animationEnabled }) },
      { label: '设置', click: () => openPanel('settings') },
      { label: '隐藏桌宠', click: () => setVisible(false) },
      { type: 'separator' },
      { label: '退出程序', click: () => app.quit() },
    ];
    return Menu.buildFromTemplate(template);
  }
  function updateTray() {
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '显示桌宠', enabled: !pet.isVisible(), click: () => setVisible(true) },
      { label: '隐藏桌宠', enabled: pet.isVisible(), click: () => setVisible(false) },
      { type: 'separator' },
      { label: '打开聊天', click: () => openPanel('chat') },
      { label: '打开工作面板', click: () => openPanel('work') },
      { label: '打开设置', click: () => openPanel('settings') },
      { type: 'separator' },
      { label: '退出程序', click: () => app.quit() },
    ]));
  }
  type Role = 'pet' | Panel;
  function authorize(event: IpcMainInvokeEvent, roles: readonly Role[]) {
    const role = event.sender.id === pet.webContents.id ? 'pet'
      : [...panels.entries()].find(([, window]) => window.webContents.id === event.sender.id)?.[0];
    const frame = event.senderFrame;
    if (!role || !roles.includes(role) || !frame || frame !== event.sender.mainFrame
      || new URL(frame.url).protocol !== 'emma:' || new URL(frame.url).hostname !== 'app'
      || new URL(frame.url).pathname !== '/index.html') throw new Error('不允许的 IPC 来源');
  }
  const all: Role[] = ['pet', 'chat', 'work', 'settings'];
  function handle(channel: string, roles: readonly Role[], action: (event: IpcMainInvokeEvent, value: unknown) => unknown) {
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      authorize(event, roles);
      if (args.length > 1) throw new Error('无效的参数数量');
      return action(event, args[0]);
    });
  }
  handle(IPC.snapshot, all, () => snapshot());
  handle(IPC.workspace, ['settings', 'work'], () => agent.workspaceState());
  handle(IPC.workspaceChoose, ['settings'], async event => {
    agent.assertIdle(); const parent = BrowserWindow.fromWebContents(event.sender); if (!parent) throw new Error('窗口不存在');
    const result = await dialog.showOpenDialog(parent, { title: '选择 Agent 工作区', properties: ['openDirectory'] });
    if (!result.canceled && result.filePaths[0]) agent.setWorkspace(result.filePaths[0]);
  });
  handle(IPC.autoWrite, ['settings'], (_event, value) => { if (typeof value !== 'boolean') throw new Error('无效开关'); agent.setAutoWrite(value); });
  handle(IPC.agent, ['work'], () => agent.snapshot());
  handle(IPC.agentStart, ['work'], (_event, value) => agent.start(boundedText(value, 32000, '任务指令')));
  handle(IPC.agentResume, ['work'], (_event, value) => agent.resume(validateId(value)));
  handle(IPC.agentCancel, ['work'], (_event, value) => agent.cancel(validateId(value)));
  handle(IPC.agentApproval, ['work'], (_event, value) => { const input = object(value, ['id', 'approved']); if (typeof input.approved !== 'boolean') throw new Error('无效审批'); agent.permissions.decide(validateId(input.id), input.approved); });
  handle(IPC.beginDrag, ['pet'], (_event, anchor) => beginDrag(anchor));
  handle(IPC.endDrag, ['pet'], () => endDrag());
  handle(IPC.wake, all, () => state.wake());
  handle(IPC.interact, ['pet', 'work'], (_event, emotion) => {
    if (emotion !== 'happy' && emotion !== 'angry' && emotion !== 'question') throw new Error('无效互动');
    state.interact(emotion as Emotion);
  });
  handle(IPC.finished, ['pet'], (_event, revision) => {
    if (!Number.isSafeInteger(revision) || Number(revision) < 0) throw new Error('无效动画版本');
    state.animationFinished(Number(revision));
  });
  handle(IPC.openPanel, all, (_event, panel) => { if (!isPanel(panel)) throw new Error('无效面板'); openPanel(panel); });
  handle(IPC.closePanel, ['chat', 'work', 'settings'], event => BrowserWindow.fromWebContents(event.sender)?.close());
  handle(IPC.menu, ['pet'], () => { endDrag(); state.wake(); contextMenu().popup({ window: pet }); });
  handle(IPC.settings, ['settings'], (_event, patch) => updateSettings(validatePatch(patch)));
  handle(IPC.preview, ['work'], (_event, animation) => {
    if (!isAnimation(animation)) throw new Error('无效动画');
    if (!pet.isVisible()) setVisible(true);
    state.previewAnimation(animation);
  });
  handle(IPC.stopPreview, ['work'], () => state.stopPreview());
  function object(value: unknown, keys: string[]): Record<string, unknown> {
    if (!isRecord(value) || Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) throw new Error('无效参数');
    return value;
  }
  handle(IPC.provider, ['chat', 'settings'], () => chat.providerSnapshot());
  handle(IPC.providerSave, ['settings'], (_event, value) => chat.saveProvider(value));
  handle(IPC.keyClear, ['settings'], () => chat.clearKey());
  handle(IPC.models, ['chat', 'settings'], () => chat.inspect('models'));
  handle(IPC.modelSelect, ['chat', 'settings'], (_event, value) => chat.selectModel(boundedText(value, 200, 'Model ID')));
  handle(IPC.test, ['settings'], () => chat.inspect('test'));
  handle(IPC.balance, ['chat', 'settings'], () => chat.inspect('balance'));
  handle(IPC.chat, ['chat'], () => chat.snapshot());
  handle(IPC.chatCreate, ['chat'], () => chat.create());
  handle(IPC.chatSelect, ['chat'], (_event, value) => chat.select(validateId(value)));
  handle(IPC.chatDelete, ['chat'], (_event, value) => chat.delete(validateId(value)));
  handle(IPC.chatRename, ['chat'], (_event, value) => {
    const input = object(value, ['id', 'title']); chat.rename(validateId(input.id), boundedText(input.title, 80, '会话名称'));
  });
  handle(IPC.chatSend, ['chat'], (_event, value) => {
    const input = object(value, ['sessionId', 'text']);
    boundedText(input.text, 32_000, '消息');
    chat.send(validateId(input.sessionId), input.text as string); // 校验非空，但保留代码缩进和原始空白。
  });
  handle(IPC.chatCancel, ['chat'], (_event, value) => chat.cancel(validateId(value)));

  secureWindow(pet);
  pet.on('move', recordPosition);
  pet.on('blur', () => endDrag());
  pet.on('hide', () => endDrag());
  pet.on('close', event => { if (!quitting) { event.preventDefault(); setVisible(false); } });
  state.subscribe(broadcast);
  tray.on('double-click', () => setVisible(true));
  app.on('second-instance', () => setVisible(true));
  app.on('activate', () => setVisible(true));
  app.on('window-all-closed', () => { /* 托盘继续运行 */ });
  screen.on('display-added', correctBounds);
  screen.on('display-removed', correctBounds);
  screen.on('display-metrics-changed', correctBounds);
  app.on('before-quit', () => {
    quitting = true;
    endDrag(); recordPosition(); save(); agent.dispose(); chat.dispose(); state.dispose(); tray.destroy();
  });
  updateTray();
  await pet.loadURL(PAGE);
  pet.showInactive();
  pet.setAlwaysOnTop(store.value.alwaysOnTop, 'pop-up-menu');
  updateTray(); broadcast();
  recordPosition();
  return { pet, panels, state, store, tray, snapshot, openPanel, setVisible, updateSettings, correctBounds, contextMenu };
}
