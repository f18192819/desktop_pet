import { useEffect, useState } from 'react';
import { ANIMATIONS } from '../shared/types';
import type { AnimationName, PetSettings, SettingsPatch } from '../shared/types';
import { useSnapshot } from './useSnapshot';
import { AISettings } from './AISettings';
import { Chat } from './Chat';

const names: Record<AnimationName, string> = {
  idle: '待机', thinking: '思考', angry: '生气', working: '工作',
  question: '疑问', dragged: '拖动', sleeping: '睡觉', happy: '开心',
};
function Settings({ settings }: { settings: PetSettings }) {
  const [size, setSize] = useState(settings.size);
  const [sleepSeconds, setSleepSeconds] = useState(settings.sleepAfterMs / 1000);
  const [top, setTop] = useState(settings.alwaysOnTop);
  const [animation, setAnimation] = useState(settings.animationEnabled);
  const [feedback, setFeedback] = useState('');
  useEffect(() => {
    setSize(settings.size); setSleepSeconds(settings.sleepAfterMs / 1000);
    setTop(settings.alwaysOnTop); setAnimation(settings.animationEnabled);
  }, [settings.size, settings.sleepAfterMs, settings.alwaysOnTop, settings.animationEnabled]);
  async function save() {
    const patch: SettingsPatch = { size, sleepAfterMs: sleepSeconds * 1000, alwaysOnTop: top, animationEnabled: animation, skin: 'emma' };
    try { await window.desktopPet.updateSettings(patch); setFeedback('设置已保存'); }
    catch (error) { setFeedback(`保存失败：${String(error)}`); }
  }
  return <section className="settings-form">
    <label>桌宠大小 <span>{size} px</span><input aria-label="桌宠大小" type="range" min="120" max="600" step="10" value={size} onChange={event => setSize(Number(event.target.value))} /></label>
    <label>自动睡眠（秒）<input aria-label="自动睡眠秒数" type="number" min="0" max="86400" step="1" value={sleepSeconds} onChange={event => setSleepSeconds(Number(event.target.value))} /><small>默认 300 秒；设为 0 关闭。点击或拖动可立即唤醒。</small></label>
    <label className="check"><input type="checkbox" checked={top} onChange={event => setTop(event.target.checked)} />始终置顶</label>
    <label className="check"><input type="checkbox" checked={animation} onChange={event => setAnimation(event.target.checked)} />播放动画</label>
    <label>角色皮肤<select value="emma" aria-label="角色皮肤" disabled><option value="emma">Emma / 艾玛</option></select></label>
    <button className="primary" onClick={() => void save()}>保存设置</button>
    <p className="feedback" role="status">{feedback}</p>
  </section>;
}
function Work({ current }: { current: AnimationName }) {
  const [error, setError] = useState('');
  return <>
    <div className="callout"><strong>本地动画预览</strong><p>这些按钮仅用于验证素材。当前没有 Agent 任务，也不会执行本地工具。</p></div>
    <div className="animation-grid">{ANIMATIONS.map(animation => <button key={animation} aria-pressed={current === animation} onClick={() => {
      void window.desktopPet.previewAnimation(animation).catch(error => setError(String(error)));
    }}><span>{names[animation]}</span><small>{animation}</small></button>)}</div>
    <button className="secondary" onClick={() => void window.desktopPet.stopPreview().catch(error => setError(String(error)))}>结束预览，恢复待机</button>
    <p className="muted">开心和生气播放一轮后回到待机。真实拖动始终优先于预览。</p>
    {error && <p role="alert">{error}</p>}
  </>;
}
export function Panels({ panel }: { panel: 'chat' | 'work' | 'settings' }) {
  const { snapshot, error } = useSnapshot();
  const title = panel === 'chat' ? '和艾玛聊聊' : panel === 'work' ? '工作面板' : '陪伴设置';
  return <main className={`panel panel-${panel}`}>
    <header><div className="brand"><span className="brand-mark">E</span><span>EMMA<small>DESKTOP COMPANION</small></span></div><span className="version">0.2 · CHAT</span></header>
    <nav aria-label="面板导航">{(['chat', 'work', 'settings'] as const).map(target => <button key={target} aria-current={panel === target ? 'page' : undefined} onClick={() => void window.desktopPet.openPanel(target)}>{target === 'chat' ? '聊天' : target === 'work' ? '工作' : '设置'}</button>)}</nav>
    <div className="panel-heading"><h1>{title}</h1><span className="status-dot">{snapshot ? names[snapshot.pet.animation] : '连接中'}{snapshot?.pet.paused ? ' · 已暂停' : ''}</span></div>
    {snapshot?.notice && <p className="callout" role="alert">{snapshot.notice}</p>}
    {error && <p role="alert">{error}</p>}
    {panel === 'chat' && <Chat />}
    {panel === 'work' && snapshot && <Work current={snapshot.pet.animation} />}
    {panel === 'settings' && snapshot && <><Settings settings={snapshot.settings} /><AISettings /></>}
    <footer><span>艾玛 · 本地桌面陪伴</span><button onClick={() => void window.desktopPet.closePanel()}>关闭面板</button></footer>
  </main>;
}
