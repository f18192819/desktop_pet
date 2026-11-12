import { existsSync, readFileSync, renameSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { PetSettings, SettingsPatch } from '../shared/types';

export const DEFAULT_SETTINGS: PetSettings = {
  position: null, size: 240, alwaysOnTop: true, animationEnabled: true,
  sleepAfterMs: 300_000, skin: 'emma',
};
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function validatePatch(value: unknown): SettingsPatch {
  if (!isRecord(value)) throw new Error('设置必须为对象');
  const keys = ['size', 'alwaysOnTop', 'animationEnabled', 'sleepAfterMs', 'skin'];
  if (Object.keys(value).some(key => !keys.includes(key))) throw new Error('不支持的设置项');
  if ('size' in value && !(Number.isInteger(value.size) && Number(value.size) >= 120 && Number(value.size) <= 600)) throw new Error('大小应在 120–600 像素之间');
  for (const key of ['alwaysOnTop', 'animationEnabled']) {
    if (key in value && typeof value[key] !== 'boolean') throw new Error('开关必须为布尔值');
  }
  if ('sleepAfterMs' in value && !(Number.isInteger(value.sleepAfterMs) && (value.sleepAfterMs === 0 || (Number(value.sleepAfterMs) >= 1000 && Number(value.sleepAfterMs) <= 86_400_000)))) throw new Error('睡眠时间应为 0 或 1 秒至 24 小时');
  if ('skin' in value && value.skin !== 'emma') throw new Error('当前仅支持 Emma 皮肤');
  return value as SettingsPatch;
}
export class ConfigStore {
  value: PetSettings = structuredClone(DEFAULT_SETTINGS);
  notice: string | null = null;
  constructor(readonly file: string) {
    if (!existsSync(file)) return;
    try {
      const data: unknown = JSON.parse(readFileSync(file, 'utf8'));
      if (!isRecord(data)) throw new Error('配置格式错误');
      const { position, ...patch } = data;
      const validPatch = validatePatch(patch);
      let validPosition = null;
      if (position !== null && position !== undefined) {
        if (!isRecord(position) || !Number.isInteger(position.x) || !Number.isInteger(position.y)
          || Math.abs(Number(position.x)) > 1_000_000 || Math.abs(Number(position.y)) > 1_000_000) throw new Error('位置格式错误');
        validPosition = { x: Number(position.x), y: Number(position.y) };
      }
      this.value = { ...this.value, ...validPatch, position: validPosition };
    } catch {
      this.notice = '原配置无法读取，已恢复默认设置。';
      try { renameSync(file, `${file}.broken-${Date.now()}`); } catch { /* 保留原文件 */ }
    }
  }
  save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`;
    writeFileSync(temporary, JSON.stringify(this.value, null, 2), 'utf8');
    renameSync(temporary, this.file);
  }
}
