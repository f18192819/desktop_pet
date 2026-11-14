import { app, BrowserWindow, screen } from 'electron';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { startApp } from '../src/main/main';
import { ANIMATIONS } from '../src/shared/types';
import type { Panel } from '../src/shared/types';

const profile = process.env.EMMA_TEST_PROFILE;
if (!profile) throw new Error('必须使用独立测试配置目录');
mkdirSync(profile, { recursive: true });
app.setPath('userData', profile);
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(check: () => Promise<boolean> | boolean, message: string) {
  for (let tries = 0; tries < 150; tries++) { if (await check()) return; await delay(30); }
  throw new Error(message);
}
async function run() {
  const started = await startApp();
  if (!started) throw new Error('无法取得测试实例锁');
  const runtime = started;
  const { pet, state, store, tray, openPanel } = runtime;
  await until(() => pet.webContents.executeJavaScript("document.querySelector('canvas')?.dataset.ready === 'true'"), '动画未完成预加载');
  assert.ok(pet.isVisible());
  await until(() => pet.isAlwaysOnTop() === store.value.alwaysOnTop, '启动时置顶标志应匹配设置');
  assert.equal(pet.isMenuBarVisible(), false);
  assert.equal(tray.isDestroyed(), false);
  assert.deepEqual(await pet.webContents.executeJavaScript('[typeof require, typeof process, typeof window.desktopPet.send, typeof window.desktopPet.invoke]'), ['undefined', 'undefined', 'undefined', 'undefined']);
  if (process.argv.includes('--resume')) {
    const expected = JSON.parse(readFileSync(resolve(profile!, 'expected-position.json'), 'utf8'));
    assert.deepEqual(pet.getPosition(), expected);
    assert.equal(store.value.size, 240);
    console.log('PASS 真实重启：位置和设置已恢复');
    return;
  }
  runtime.updateSettings({ sleepAfterMs: 0, animationEnabled: true, size: 240, alwaysOnTop: true });
  const alpha = await pet.webContents.executeJavaScript(`(() => {
    const canvas = document.querySelector('canvas'); const ctx = canvas.getContext('2d');
    const pixels = ctx.getImageData(0, 0, 443, 443).data;
    let transparent = 0, visible = 0;
    for (let i = 3; i < pixels.length; i += 4) { if (!pixels[i]) transparent++; else visible++; }
    return { transparent, visible, corner: pixels[3], background: getComputedStyle(document.body).backgroundColor };
  })()`);
  assert.equal(alpha.corner, 0);
  assert.ok(alpha.transparent > 1000 && alpha.visible > 1000);
  assert.equal(alpha.background, 'rgba(0, 0, 0, 0)');
  assert.equal(await pet.webContents.executeJavaScript("window.desktopPet.previewAnimation('working').then(() => false, () => true)"), true, '桌宠 Renderer 不应拥有预览权限');
  assert.equal(await pet.webContents.executeJavaScript("window.desktopPet.beginDrag({x:-10,y:0}).then(() => false, () => true)"), true, '抓取点必须位于本窗口内');
  assert.equal(await pet.webContents.executeJavaScript('window.desktopPet.getProviderState().then(() => false, () => true)'), true, '桌宠无服务配置权限');
  assert.equal(await pet.webContents.executeJavaScript('window.desktopPet.getChatSnapshot().then(() => false, () => true)'), true, '桌宠无聊天记录权限');
  async function panelWindow(panel: Panel): Promise<BrowserWindow> {
    openPanel(panel);
    await until(() => !!runtime.panels.get(panel)?.isVisible(), `${panel} 面板未显示`);
    const window = runtime.panels.get(panel)!;
    await until(() => window.webContents.executeJavaScript("!!document.querySelector('h1')"), `${panel} UI 未就绪`);
    return window;
  }
  const work = await panelWindow('work');
  assert.equal(await pet.webContents.executeJavaScript('window.desktopPet.getAgentSnapshot().then(() => false, () => true)'), true);
  assert.equal(await work.webContents.executeJavaScript('window.desktopPet.chooseWorkspace().then(() => false, () => true)'), true);
  assert.equal(await work.webContents.executeJavaScript('window.desktopPet.getWorkspace().then(s => s.shell.enabled)'), false);
  const hashes: string[] = [];
  for (const animation of ANIMATIONS) {
    await work.webContents.executeJavaScript(`window.desktopPet.previewAnimation(${JSON.stringify(animation)})`);
    await until(() => pet.webContents.executeJavaScript(`document.querySelector('canvas').dataset.animation === ${JSON.stringify(animation)}`), `未切换至 ${animation}`);
    const before = await pet.webContents.executeJavaScript("document.querySelector('canvas').toDataURL()");
    await delay(370);
    const after = await pet.webContents.executeJavaScript("document.querySelector('canvas').toDataURL()");
    assert.notEqual(after, before, `${animation} 帧没有推进`);
    hashes.push(animation);
  }
  await work.webContents.executeJavaScript("window.desktopPet.previewAnimation('happy')");
  await delay(1400);
  assert.equal(state.snapshot().animation, 'idle', 'happy 一轮后应返回 idle');
  await work.webContents.executeJavaScript("window.desktopPet.previewAnimation('working')");
  await delay(180);
  const settings = await panelWindow('settings');
  assert.equal(await settings.webContents.executeJavaScript('window.desktopPet.getAgentSnapshot().then(() => false, () => true)'), true);
  assert.equal(await settings.webContents.executeJavaScript("window.desktopPet.updateSettings({ size: -1 }).then(() => false, () => true)"), true);
  assert.equal(await settings.webContents.executeJavaScript("window.desktopPet.updateSettings({ shell: 'cmd' }).then(() => false, () => true)"), true);
  await settings.webContents.executeJavaScript('window.desktopPet.updateSettings({ animationEnabled: false })');
  await delay(80);
  const paused = await pet.webContents.executeJavaScript("document.querySelector('canvas').toDataURL()");
  await delay(260);
  assert.equal(await pet.webContents.executeJavaScript("document.querySelector('canvas').toDataURL()"), paused);
  await settings.webContents.executeJavaScript('window.desktopPet.updateSettings({ animationEnabled: true, size: 320, alwaysOnTop: false })');
  assert.ok(Math.abs(pet.getSize()[0] - 320) <= 1, 'Windows DPI 换算允许 1 DIP 舍入');
  assert.equal(pet.isAlwaysOnTop(), false);
  await work.webContents.executeJavaScript('window.desktopPet.stopPreview()');
  await settings.webContents.executeJavaScript('window.desktopPet.updateSettings({ sleepAfterMs: 1000 })');
  await delay(1200);
  assert.equal(state.snapshot().animation, 'sleeping');
  await pet.webContents.executeJavaScript('window.desktopPet.wake()');
  assert.equal(state.snapshot().animation, 'idle');
  state.setPetActivity('thinking'); assert.equal(state.snapshot().animation, 'thinking');
  state.setPetActivity('working'); assert.equal(state.snapshot().animation, 'working');
  state.setPetActivity('waitingApproval'); assert.equal(state.snapshot().animation, 'question');
  runtime.setVisible(false); assert.equal(pet.isVisible(), false);
  runtime.setVisible(true); assert.equal(pet.isVisible(), true);
  const chat = await panelWindow('chat');
  assert.equal(await settings.webContents.executeJavaScript('window.desktopPet.getChatSnapshot().then(() => false, () => true)'), true, '设置面板无聊天记录权限');
  assert.equal(await settings.webContents.executeJavaScript(`window.desktopPet.saveProvider({name:'Mock',baseUrl:'http://remote.invalid',model:'mock',adapter:'openai-compatible',includeUsage:true,timeoutMs:1000}).then(() => false, () => true)`), true);
  const provider = await settings.webContents.executeJavaScript('window.desktopPet.getProviderState()');
  assert.equal('apiKey' in provider, false);
  assert.equal('apiKey' in provider.config, false);
  await until(() => chat.webContents.executeJavaScript("document.querySelector('textarea') !== null && !!document.querySelector('.composer-footer button')"), '聊天数据加载未完成');
  assert.equal(await chat.webContents.executeJavaScript("document.querySelector('.composer-footer button').disabled"), true);
  assert.ok(runtime.contextMenu().items.some(item => item.label === '隐藏桌宠'));
  await delay(300); // 等待已显示的聊天面板完成首帧合成，再保存视觉检查截图。
  mkdirSync('artifacts', { recursive: true });
  await chat.webContents.capturePage().then(image => writeFileSync('artifacts/chat.png', image.toPNG()));
  await settings.webContents.capturePage().then(image => writeFileSync('artifacts/settings.png', image.toPNG()));
  await work.webContents.capturePage().then(image => writeFileSync('artifacts/work.png', image.toPNG()));
  runtime.updateSettings({ size: 240, alwaysOnTop: true, animationEnabled: true, sleepAfterMs: 300_000 });
  state.setPetActivity('idle');
  const area = screen.getPrimaryDisplay().workArea;
  pet.setPosition(area.x + 120, area.y + 100);
  await delay(250);
  writeFileSync(resolve(profile!, 'expected-position.json'), JSON.stringify(pet.getPosition()));
  assert.deepEqual(JSON.parse(readFileSync(store.file, 'utf8')).position, { x: pet.getPosition()[0], y: pet.getPosition()[1] });
  console.log(`PASS Electron：${hashes.join(', ')} 动画推进、透明像素、预加载、沙箱、IPC 限制、暂停恢复、缩放、置顶、睡眠唤醒、面板、菜单、托盘生命周期、持久化`);
}
run().then(() => app.quit()).catch(error => { console.error(error); app.exit(1); });
