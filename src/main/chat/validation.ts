import { isRecord } from '../config';
import type { ProviderInput } from '../../shared/chat';

export function boundedText(value: unknown, max: number, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\0')) throw new Error(`${label}为空或过长`);
  return value.trim();
}
export function normalizeBaseURL(value: unknown): string {
  const input = boundedText(value, 2048, 'Base URL');
  let url: URL;
  try { url = new URL(input); } catch { throw new Error('Base URL 格式无效'); }
  const local = url.hostname === 'localhost' || url.hostname === '[::1]' || /^127\.\d+\.\d+\.\d+$/.test(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local))
    || url.username || url.password || url.search || url.hash) throw new Error('仅允许 HTTPS 或 loopback HTTP，URL 不得包含凭据、查询或片段');
  return url.href.replace(/\/+$/, '');
}
export function validateProvider(value: unknown): ProviderInput {
  if (!isRecord(value) || Object.keys(value).some(key => !['name', 'baseUrl', 'model', 'adapter', 'includeUsage', 'timeoutMs', 'apiKey'].includes(key))) throw new Error('无效的服务配置');
  const name = boundedText(value.name, 80, 'Provider 名称');
  const baseUrl = normalizeBaseURL(value.baseUrl);
  if (typeof value.model !== 'string' || value.model.length > 200 || /[\x00-\x1f]/.test(value.model)) throw new Error('Model ID 格式无效');
  const model = value.model.trim();
  if (value.adapter !== 'openai-compatible' && value.adapter !== 'deepseek') throw new Error('不支持的适配器');
  if (typeof value.includeUsage !== 'boolean' || !Number.isInteger(value.timeoutMs) || Number(value.timeoutMs) < 1000 || Number(value.timeoutMs) > 600_000) throw new Error('无效的超时或用量选项');
  if (value.apiKey !== undefined && (typeof value.apiKey !== 'string' || value.apiKey.length > 4096 || /[\s\x00-\x1f\x7f]/.test(value.apiKey))) throw new Error('API Key 格式无效');
  return { name, baseUrl, model, adapter: value.adapter, includeUsage: value.includeUsage, timeoutMs: Number(value.timeoutMs), ...(value.apiKey !== undefined ? { apiKey: value.apiKey as string } : {}) };
}
