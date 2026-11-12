import { useEffect, useState } from 'react';
import type { ProviderConfig, ProviderState } from '../shared/chat';
import { useProvider } from './useAI';

export function ProviderStatus({ provider }: { provider: ProviderState }) {
  const connections = { untested: '未测试', checking: '连接中', connected: '连接成功', error: '连接失败' };
  const auth = { unverified: '尚未验证', verified: '认证通过', rejected: '认证被拒绝', 'not-required': '此次请求未使用 Key' };
  return <div className="provider-status">
    <span>Key：{provider.hasKey ? '已加密配置' : '未配置'}</span><span>{connections[provider.connection]}</span><span>认证：{auth[provider.authentication]}</span>
    {!provider.encryptionAvailable && <p role="alert">系统加密不可用，无法保存或读取 API Key。</p>}
    {provider.lastError && <p role="alert">最近错误：{provider.lastError}</p>}
  </div>;
}
export function Balance({ provider, refresh }: { provider: ProviderState; refresh: () => void }) {
  const balance = provider.balance;
  return <div className="balance">{balance.status === 'unsupported' ? '额度：当前通用适配器不支持查询，请到服务商控制台查看。' : <>
    额度：{balance.status === 'available' ? balance.items.map(item => `${item.currency} ${item.total}`).join(' / ') || '无余额项'
      : balance.status === 'loading' ? '查询中…' : balance.status === 'error' ? balance.error : '尚未查询'}
    <button disabled={balance.status === 'loading'} onClick={refresh}>刷新额度</button>
    {balance.checkedAt && <small>查询于 {new Date(balance.checkedAt).toLocaleString()}</small>}
  </>}</div>;
}
function ProviderForm({ provider }: { provider: ProviderState }) {
  const [config, setConfig] = useState<ProviderConfig>(provider.config);
  const [key, setKey] = useState(''); const [busy, setBusy] = useState(false); const [feedback, setFeedback] = useState('');
  useEffect(() => { setConfig(provider.config); }, [provider.config.name, provider.config.baseUrl, provider.config.model, provider.config.adapter, provider.config.includeUsage, provider.config.timeoutMs]);
  const dirty = JSON.stringify(config) !== JSON.stringify(provider.config) || key.length > 0;
  async function action(task: () => Promise<unknown>, message: string) {
    setBusy(true); setFeedback(''); try { await task(); setFeedback(message); } catch (error) { setFeedback(String(error)); } finally { setBusy(false); }
  }
  return <section className="settings-form ai-settings">
    <h2>AI 服务配置</h2>
    <label>Provider 名称<input value={config.name} maxLength={80} onChange={event => setConfig({ ...config, name: event.target.value })} /></label>
    <label>Base URL<input value={config.baseUrl} autoCapitalize="none" spellCheck={false} placeholder="https://服务地址/v1" onChange={event => setConfig({ ...config, baseUrl: event.target.value })} /><small>填写接口前缀，通常包含 /v1；只允许 HTTPS，本地 loopback 可使用 HTTP。更换地址后需重新填写 Key。</small></label>
    <label>API Key<input type="password" autoComplete="new-password" value={key} maxLength={4096} placeholder={provider.hasKey ? '已配置，留空保留现有 Key' : '输入 Key（本地无认证服务可留空）'} onChange={event => setKey(event.target.value)} /><small>保存后清空，不回显已保存的 Key。</small></label>
    <button className="secondary" disabled={busy || !provider.hasKey} onClick={() => void action(async () => { await window.desktopPet.clearApiKey(); setKey(''); }, 'API Key 已清除')}>清除已保存的 API Key</button>
    <label>Model ID<input list="provider-models" value={config.model} maxLength={200} placeholder="先保存地址，再获取模型；也可手动输入" onChange={event => setConfig({ ...config, model: event.target.value })} /></label>
    <datalist id="provider-models">{provider.models.map(model => <option key={model} value={model} />)}</datalist>
    <label>额度查询适配器<select value={config.adapter} onChange={event => setConfig({ ...config, adapter: event.target.value as ProviderConfig['adapter'] })}><option value="openai-compatible">通用 OpenAI-Compatible（无统一额度接口）</option><option value="deepseek">DeepSeek /user/balance</option></select><small>仅当服务商支持此接口时选用专用适配器。</small></label>
    <label>请求总超时（秒）<input type="number" min={1} max={600} value={config.timeoutMs / 1000} onChange={event => setConfig({ ...config, timeoutMs: Number(event.target.value) * 1000 })} /></label>
    <label className="check"><input type="checkbox" checked={config.includeUsage} onChange={event => setConfig({ ...config, includeUsage: event.target.checked })} />请求流式 Token 用量</label>
    <small>服务商不支持 stream_options 时关闭此项；缺失用量不会估算。</small>
    <button className="primary" disabled={busy} onClick={() => void action(async () => {
      try { await window.desktopPet.saveProvider({ ...config, ...(key ? { apiKey: key } : {}) }); } finally { setKey(''); }
    }, '配置已保存；请获取模型或测试连接')}>保存 AI 配置</button>
    <div className="button-row"><button disabled={busy || dirty} onClick={() => void action(() => window.desktopPet.listModels(), '模型列表已更新；选择后保存')}>获取模型列表</button>
      <button disabled={busy || dirty || !config.model} onClick={() => void action(() => window.desktopPet.testConnection(), '聊天接口连接成功')}>测试连接（少量 Token）</button></div>
    <small>获取模型和测试使用已保存配置。/models 不支持时手动填写。测试会发送最多 1 个输出 Token 的真实请求。</small>
    <ProviderStatus provider={provider} /><Balance provider={provider} refresh={() => void action(() => window.desktopPet.refreshBalance(), '额度已查询')} />
    <p className="feedback" role="status">{feedback}</p>
  </section>;
}
export function AISettings() {
  const { value: provider, error } = useProvider();
  return <>{error && <p role="alert">{error}</p>}{provider && <ProviderForm provider={provider} />}</>;
}
