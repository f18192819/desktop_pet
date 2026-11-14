import { useEffect, useState } from 'react';
import type { AgentSnapshot, WorkspaceState } from '../shared/agent';
const api = window.desktopPet;
export function WorkspaceSettings() {
  const [value, setValue] = useState<WorkspaceState | null>(null); const [error, setError] = useState('');
  const refresh = () => api.getWorkspace().then(setValue).catch(e => setError(String(e)));
  useEffect(() => { void refresh(); }, []);
  const action = async (work: () => Promise<unknown>) => { try { await work(); await refresh(); setError(''); } catch (e) { setError(String(e)); } };
  return <section className="settings-form"><h2>Agent 工作区</h2><p>{value?.root ?? '尚未选择'} · {value?.valid ? '有效' : '不可用'}</p>
    <button onClick={() => void action(api.chooseWorkspace)}>选择 / 更换文件夹</button>
    <label className="check"><input type="checkbox" checked={value?.autoWrite ?? false} onChange={e => void action(() => api.setAutoWrite(e.target.checked))} />自动允许工作区内普通写入（删除仍需审批）</label>
    <p className="callout">Agent 可以读取工作区外的文件，读取结果可能发送给当前模型服务商。请勿要求读取密码、密钥或其他敏感文件。</p>
    <p>{value?.shell.reason}</p>{error && <p role="alert">{error}</p>}</section>;
}
export function AgentWork() {
  const [state, setState] = useState<AgentSnapshot | null>(null); const [workspace, setWorkspace] = useState<WorkspaceState | null>(null);
  const [selected, setSelected] = useState(''); const [prompt, setPrompt] = useState(''); const [error, setError] = useState('');
  useEffect(() => { let live = true; const update = (s: AgentSnapshot) => { if (live) { setState(s); void api.getWorkspace().then(w => { if (live) setWorkspace(w); }); } }; const off = api.onAgentSnapshot(update); void api.getAgentSnapshot().then(update).catch(e => setError(String(e))); return () => { live = false; off(); }; }, []);
  const task = state?.tasks.find(t => t.id === selected) ?? state?.tasks[0];
  const action = async (work: () => Promise<unknown>) => { try { setError(''); await work(); } catch (e) { setError(String(e)); } };
  return <section className="agent-work"><h2>本地 Agent</h2><p>{workspace?.root ?? '请在设置选择工作区'}</p><p className="callout">{workspace?.shell.reason}</p>
    <textarea aria-label="Agent 任务指令" value={prompt} maxLength={32000} rows={3} onChange={e => setPrompt(e.target.value)} placeholder="描述要在工作区完成的任务" />
    <button disabled={!!state?.activeId || !prompt.trim() || !workspace?.valid} onClick={() => void action(async () => { const id = await api.startAgent(prompt); setSelected(id); setPrompt(''); })}>新建并开始任务</button>
    <select aria-label="Agent 任务列表" value={task?.id ?? ''} onChange={e => setSelected(e.target.value)}>{!state?.tasks.length && <option value="">暂无任务</option>}{state?.tasks.map(t => <option key={t.id} value={t.id}>{t.title} · {t.status}</option>)}</select>
    {state?.activeId && <button onClick={() => void action(() => api.cancelAgent(state.activeId!))}>停止当前任务</button>}
    {task && <><p>绑定工作区：{task.root} · 状态：{task.status}</p><button disabled={!!state?.activeId} onClick={() => void action(() => api.resumeAgent(task.id))}>手动继续（先检查现状）</button>
      <h3>计划 / 执行进度</h3><pre>{task.plan || '等待模型制定计划'}</pre><p>已完成 {task.tools.filter(t => t.status === 'completed').length} / {task.tools.length} 次工具调用</p>
      {task.approvals.map(a => <div className="callout" key={a.id}><strong>{a.tool} · {a.status}</strong><pre>{a.description}</pre>{a.status === 'pending' && <><button onClick={() => void action(() => api.decideApproval({ id: a.id, approved: true }))}>仅允许本次</button><button onClick={() => void action(() => api.decideApproval({ id: a.id, approved: false }))}>拒绝</button></>}</div>)}
      <h3>模型回复 / 完成总结</h3><pre aria-live="polite">{task.output || '等待回复…'}</pre>{task.error && <p role="alert">{task.error}</p>}
      <h3>工具及命令记录</h3>{task.tools.map(t => <details key={t.id}><summary>{t.name} · {t.status}</summary><pre>{t.arguments}</pre><pre>{t.result}</pre></details>)}
      <h3>文件修改 / Diff</h3>{task.changes.map((c, i) => <details key={i}><summary>{c.operation} · {c.path}</summary><pre>{`--- before\n${c.before}\n+++ after\n${c.after}`}</pre></details>)}
      <p>已报告 Token：{task.usage.reduce((n, u) => n + u.total, 0)}（{task.usage.length} 轮有报告；缺失用量未估算）</p>
    </>}{(error || state?.notice) && <p role="alert">{error || state?.notice}</p>}</section>;
}
