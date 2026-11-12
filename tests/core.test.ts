import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { ConfigStore, DEFAULT_SETTINGS, validatePatch } from '../src/main/config';
import { PetStateManager } from '../src/main/PetStateManager';
import { fitToDisplays } from '../src/main/geometry';
import { ANIMATIONS } from '../src/shared/types';
import { framePaths, manifest } from '../src/shared/manifest';

test('素材：64 帧顺序、尺寸、RGBA；原包所有文件 SHA-256 保持一致', () => {
  for (const animation of ANIMATIONS) {
    const paths = framePaths(animation);
    assert.equal(paths.length, 8);
    paths.forEach((path, index) => {
      assert.ok(path.endsWith(`frame_${String(index).padStart(2, '0')}.png`));
      const png = readFileSync(join('assets', path));
      assert.equal(png.readUInt32BE(16), 443);
      assert.equal(png.readUInt32BE(20), 443);
      assert.equal(png[25], 6, 'PNG 必须为 RGBA');
    });
  }
  const source = 'Emma_Desktop_Pet_Animation_Pack';
  const files = readdirSync(source, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile());
  assert.equal(files.length, 82);
  for (const entry of files) {
    const original = join(entry.parentPath, entry.name);
    const imported = join('assets/characters/emma', relative(source, original));
    const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
    assert.equal(hash(imported), hash(original), original);
  }
});

test('状态优先级、拖动唤醒、松开回 idle、过期完成事件不影响新状态', () => {
  const state = new PetStateManager(0);
  try {
    assert.equal(state.snapshot().animation, 'idle');
    state.setPetActivity('responding');
    assert.equal(state.snapshot().animation, 'thinking');
    state.handleActivityEvent({ activity: 'working', source: 'agent' });
    state.handleActivityEvent({ activity: 'thinking', source: 'chat' });
    assert.equal(state.snapshot().animation, 'working');
    state.handleActivityEvent({ activity: 'waitingApproval', source: 'agent' });
    assert.equal(state.snapshot().animation, 'question');
    state.interact('angry');
    assert.equal(state.snapshot().animation, 'question');
    state.setDragging(true);
    assert.equal(state.snapshot().animation, 'dragged');
    state.setDragging(false);
    assert.equal(state.snapshot().animation, 'idle');
    state.setPetActivity('success');
    const old = state.snapshot().revision;
    state.setPetActivity('working');
    state.animationFinished(old);
    assert.equal(state.snapshot().animation, 'working');
    state.setPetActivity('success');
    assert.equal(state.snapshot().animation, 'happy');
    state.animationFinished(state.snapshot().revision);
    assert.equal(state.snapshot().animation, 'idle');
    state.interact('angry');
    state.animationFinished(state.snapshot().revision);
    assert.equal(state.snapshot().animation, 'idle');
    for (const name of ANIMATIONS) {
      state.previewAnimation(name);
      assert.equal(state.snapshot().animation, name);
      assert.equal(manifest.animations[name].frameCount, 8);
    }
  } finally { state.dispose(); }
});

test('睡眠仅在空闲时触发；点击立即唤醒；禁用睡眠和暂停均可恢复', async () => {
  const state = new PetStateManager(15);
  try {
    await new Promise(resolve => setTimeout(resolve, 35));
    assert.equal(state.snapshot().animation, 'sleeping');
    state.wake();
    assert.equal(state.snapshot().animation, 'idle');
    state.setPetActivity('working');
    await new Promise(resolve => setTimeout(resolve, 35));
    assert.equal(state.snapshot().animation, 'working');
    state.setPetActivity('idle'); state.setSleepAfter(0);
    await new Promise(resolve => setTimeout(resolve, 35));
    assert.equal(state.snapshot().animation, 'idle');
    state.setPaused(true); assert.equal(state.snapshot().paused, true);
    state.setPaused(false); assert.equal(state.snapshot().paused, false);
  } finally { state.dispose(); }
});

test('位置支持负坐标、多显示器、断屏修正和小屏幕', () => {
  const areas = [{ x: 0, y: 0, width: 1920, height: 1040 }, { x: -1280, y: 0, width: 1280, height: 984 }];
  assert.deepEqual(fitToDisplays({ x: -900, y: 200 }, 240, areas), { x: -900, y: 200, width: 240, height: 240 });
  assert.deepEqual(fitToDisplays({ x: -900, y: 200 }, 240, [areas[0]]), { x: 0, y: 200, width: 240, height: 240 });
  assert.deepEqual(fitToDisplays({ x: 9900, y: 9900 }, 240, areas), { x: 1680, y: 800, width: 240, height: 240 });
  assert.deepEqual(fitToDisplays(null, 600, [{ x: 20, y: 40, width: 320, height: 200 }]), { x: 20, y: 40, width: 200, height: 200 });
});

test('配置参数白名单、原子保存、重读以及损坏配置恢复', () => {
  const dir = mkdtempSync(join(tmpdir(), 'emma-config-'));
  try {
    for (const invalid of [{ size: 1 }, { size: 241.5 }, { position: { x: 0, y: 0 } }, { sleepAfterMs: -1 }, { alwaysOnTop: 'yes' }, { skin: 'unknown' }, { shell: 'cmd' }, null]) {
      assert.throws(() => validatePatch(invalid));
    }
    const file = join(dir, 'settings.json');
    const store = new ConfigStore(file);
    store.value = { ...DEFAULT_SETTINGS, size: 320, position: { x: -800, y: 120 } };
    store.save();
    assert.deepEqual(new ConfigStore(file).value, store.value);
    writeFileSync(file, '{broken');
    const recovered = new ConfigStore(file);
    assert.deepEqual(recovered.value, DEFAULT_SETTINGS);
    assert.ok(recovered.notice);
    assert.ok(readdirSync(dir).some(name => name.includes('.broken-')));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
