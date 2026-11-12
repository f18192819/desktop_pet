import { useEffect, useRef, useState } from 'react';
import { useChat, useProvider } from './useAI';
import { Balance, ProviderStatus } from './AISettings';

export function Chat() {
  const { value: chat, error } = useChat(); const { value: provider, error: providerError } = useProvider();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState(''); const [busy, setBusy] = useState(false);
  const [rename, setRename] = useState(''); const [deleting, setDeleting] = useState<string | null>(null); const [model, setModel] = useState('');
  const list = useRef<HTMLDivElement>(null); const follow = useRef(true);
  const selected = chat?.sessions.find(s => s.id === chat.selectedId);
  useEffect(() => { setRename(selected?.title ?? ''); setDeleting(null); follow.current = true; }, [selected?.id, selected?.title]);
  useEffect(() => { setModel(provider?.config.model ?? ''); }, [provider?.config.model]);
  useEffect(() => { if (follow.current && list.current) list.current.scrollTop = list.current.scrollHeight; }, [chat?.selectedId, chat?.messages]);
  async function action(task: () => Promise<unknown>) {
    setBusy(true); setFeedback(''); try { await task(); } catch (error) { setFeedback(String(error)); } finally { setBusy(false); }
  }
  const draft = chat?.selectedId ? drafts[chat.selectedId] ?? '' : '';
  async function send() {
    if (!chat?.selectedId || !draft.trim() || busy) return;
    const id = chat.selectedId; const text = draft; follow.current = true;
    await action(async () => { await window.desktopPet.sendChat({ sessionId: id, text }); setDrafts(values => ({ ...values, [id]: '' })); });
  }
  if (!chat || !provider) return <p role="status">{error || providerError || '正在读取会话…'}</p>;
  return <div className="chat-content">
    <div className="conversation-toolbar"><select aria-label="会话列表" value={chat.selectedId ?? ''} disabled={busy} onChange={event => void action(() => window.desktopPet.selectConversation(event.target.value))}>
      {!chat.sessions.length && <option value="">暂无会话</option>}{chat.sessions.map(s => <option key={s.id} value={s.id}>{s.title}{chat.active?.sessionId === s.id ? ' · 生成中' : ''}</option>)}</select>
      <button disabled={busy} onClick={() => void action(() => window.desktopPet.createConversation())}>新会话</button></div>
    {selected && <div className="conversation-toolbar"><input aria-label="会话名称" value={rename} maxLength={80} onChange={event => setRename(event.target.value)} />
      <button disabled={busy || !rename.trim()} onClick={() => void action(() => window.desktopPet.renameConversation({ id: selected.id, title: rename }))}>重命名</button>
      <button className="danger" disabled={busy} onClick={() => {
        if (deleting !== selected.id) setDeleting(selected.id);
        else void action(async () => { await window.desktopPet.deleteConversation(selected.id); setDrafts(values => { const next = { ...values }; delete next[selected.id]; return next; }); });
      }}>{deleting === selected.id ? '确认删除' : '删除'}</button></div>}
    <div className="model-picker"><span>{provider.config.name}</span><input aria-label="聊天模型" list="chat-models" value={model} onChange={event => setModel(event.target.value)} placeholder="Model ID" />
      <datalist id="chat-models">{provider.models.map(m => <option key={m} value={m} />)}</datalist>
      <button disabled={busy || !!chat.active || !model.trim()} onClick={() => void action(() => window.desktopPet.selectModel(model))}>应用模型</button><button onClick={() => void window.desktopPet.openPanel('settings')}>服务设置</button></div>
    <ProviderStatus provider={provider} />
    {chat.notice && <p className="callout" role="alert">{chat.notice}</p>}
    <div className="message-list" ref={list} onScroll={() => { if (list.current) follow.current = list.current.scrollHeight - list.current.scrollTop - list.current.clientHeight < 60; }}>
      {!chat.messages.length && <div className="chat-empty"><img src="./characters/emma/frames/01_idle/frame_00.png" alt="艾玛" /><h2>和艾玛开始聊天</h2><p>{selected ? '配置 AI 服务后，写下第一条消息。' : '创建新会话后开始聊天。'}</p></div>}
      {chat.messages.map(message => <article key={message.id} className={`message message-${message.role}`}><div className="message-label">{message.role === 'user' ? '你' : `艾玛 · ${message.model ?? ''}`}</div>
        <div className="message-text">{message.text || (message.status === 'streaming' ? '正在思考…' : '未收到文本回复')}</div>
        {message.status === 'streaming' && <small role="status">生成中…</small>}{message.status === 'cancelled' && <small>已停止，保留部分回复</small>}
        {message.status === 'interrupted' && <small>上次退出时中断，保留部分回复</small>}{message.error && <p role="alert">{message.error}</p>}
        {message.finishReason === 'length' && <small>达到服务商输出上限，回复可能未完</small>}
        {message.usage && <small>Token：输入 {message.usage.prompt} / 输出 {message.usage.completion} / 总计 {message.usage.total}</small>}
      </article>)}
    </div>
    <div className="usage-summary">本会话已报告 Token：输入 {chat.usage.prompt} / 输出 {chat.usage.completion} / 总计 {chat.usage.total}{chat.unreportedReplies > 0 && <span>；{chat.unreportedReplies} 次回复未报告用量（含中断），未计入</span>}</div>
    <Balance provider={provider} refresh={() => void action(() => window.desktopPet.refreshBalance())} />
    <label className="draft-label" htmlFor="chat-draft">消息</label>
    <textarea id="chat-draft" disabled={!selected} value={draft} maxLength={32000} onChange={event => { if (chat.selectedId) setDrafts(values => ({ ...values, [chat.selectedId!]: event.target.value })); }} placeholder="输入消息，Ctrl+Enter 发送" rows={3}
      onKeyDown={event => { if (event.ctrlKey && event.key === 'Enter' && !event.nativeEvent.isComposing && !chat.active) { event.preventDefault(); void send(); } }} />
    <div className="composer-footer"><small>{chat.active ? `正在生成${chat.active.sessionId !== chat.selectedId ? '（其他会话）' : ''}` : '上下文按会话隔离 · 历史记录保存在本机'}</small>
      {chat.active ? <button disabled={busy} onClick={() => void action(() => window.desktopPet.cancelChat(chat.active!.requestId))}>停止生成</button> : <button disabled={busy || !selected || !draft.trim() || !provider.config.model || provider.connection === 'checking'} onClick={() => void send()}>发送</button>}</div>
    {feedback && <p className="feedback" role="alert">{feedback}</p>}
  </div>;
}
