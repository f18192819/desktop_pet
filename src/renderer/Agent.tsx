import { useEffect, useState } from 'react';
import { READ_TOOLS, WRITE_TOOLS } from '../shared/agent';
import type { AgentSnapshot, PermissionKey, PermissionMode, WorkspaceState } from '../shared/agent';
const api = window.desktopPet;
const permissionLabels: Record<PermissionKey, string> = {
  list_directory: '列出目录', read_file: '读取文件', search_files: '搜索文件', find_files: '查找文件', stat_path: '查看文件信息',
  external_read: '工作区外读取', write_file: '创建或修改文件', apply_patch: '应用补丁', create_directory: '创建目录',
  copy_path: '复制文件或目录', move_path: '移动文件或目录', rename_path: '重命名文件或目录', delete_path: '删除文件或目录',
};
const permissionModes: Record<PermissionMode, string> = { allow: '始终允许', ask: '每次询问', deny: '禁止' };
const permissionGroups: { label: string; tools: readonly PermissionKey[] }[] = [
  { label: '文件读取', tools: [...READ_TOOLS, 'external_read'] },
  { label: '文件修改', tools: WRITE_TOOLS },
];

function useWorkspace() {
  const [value, setValue] = useState<WorkspaceState | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    let receivedChange = false;
    const off = api.onWorkspaceChanged(workspace => {
      receivedChange = true;
      if (live) setValue(workspace);
    });
    void api.getWorkspace().then(workspace => {
      if (live && !receivedChange) setValue(workspace);
    }).catch(e => { if (live && !receivedChange) setError(String(e)); });
    return () => { live = false; off(); };
  }, []);
  return { value, error };
}
export function WorkspaceSettings() {
  const { value, error: loadError } = useWorkspace();
  const [error, setError] = useState('');
  const action = async (work: () => Promise<unknown>) => { try { await work(); setError(''); } catch (e) { setError(String(e)); } };
  const update = (tool: PermissionKey, mode: PermissionMode) => {
    const identity = value?.identity;
    if (identity) void action(() => api.setToolPermission({ tool, mode, identity }));
  };
  return <section className="settings-form"><h2>Agent 工作区</h2><p>{value?.root ?? '尚未选择'} · {value?.valid ? '有效' : '不可用'}</p>
    <button onClick={() => void action(api.chooseWorkspace)}>选择 / 更换文件夹</button>
    {value && <section className="permission-list" aria-label="工具权限">
      {permissionGroups.map(group => <div key={group.label}>
        <h3>{group.label}</h3>
        {group.tools.map(tool => <label className="permission-row" key={tool}>
          {permissionLabels[tool]}
          <select value={value.permissions[tool]} disabled={!value.valid} onChange={e => update(tool, e.target.value as PermissionMode)}>
            {Object.entries(permissionModes).map(([mode, label]) => <option key={mode} value={mode}>{label}</option>)}
          </select>
        </label>)}
      </div>)}
      <div><h3>特殊工具</h3><p>{value.shell.reason}</p><p>网络执行尚未实现，当前已禁用。</p></div>
    </section>}
    <p className="callout">获准读取的工作区外内容可能发送给当前模型服务商。请勿要求读取密码或密钥。</p>
    {(error || loadError || value?.issue) && <p role="alert">{error || loadError || value?.issue}</p>}</section>;
}
export function AgentWork() {
  const [state, setState] = useState<AgentSnapshot | null>(null);
  const { value: workspace, error: workspaceError } = useWorkspace();
  const [selected, setSelected] = useState(''); const [prompt, setPrompt] = useState(''); const [error, setError] = useState('');
  useEffect(() => { let live = true; const update = (s: AgentSnapshot) => { if (live) setState(s); }; const off = api.onAgentSnapshot(update); void api.getAgentSnapshot().then(update).catch(e => { if (live) setError(String(e)); }); return () => { live = false; off(); }; }, []);
  const task = state?.tasks.find(t => t.id === selected) ?? state?.tasks[0];
  const action = async (work: () => Promise<unknown>) => { try { setError(''); await work(); } catch (e) { setError(String(e)); } };
  return <section className="agent-work"><h2>本地 Agent</h2><p>{workspace?.root ?? '请在设置选择工作区'}</p>{(workspace?.issue || workspaceError) && <p role="alert">{workspace?.issue || workspaceError}</p>}<p className="callout">{workspace?.shell.reason}</p>
    {workspace && <details><summary>当前工作区工具权限</summary>
      {permissionGroups.map(group => <p key={group.label}>{group.tools.map(tool => `${permissionLabels[tool]}：${permissionModes[workspace.permissions[tool]]}`).join(' · ')}</p>)}
    </details>}
    <textarea aria-label="Agent 任务指令" value={prompt} maxLength={32000} rows={3} onChange={e => setPrompt(e.target.value)} placeholder="描述要在工作区完成的任务" />
    <button disabled={!!state?.activeId || !prompt.trim() || !workspace?.valid} onClick={() => void action(async () => { const id = await api.startAgent(prompt); setSelected(id); setPrompt(''); })}>新建并开始任务</button>
    <select aria-label="Agent 任务列表" value={task?.id ?? ''} onChange={e => setSelected(e.target.value)}>{!state?.tasks.length && <option value="">暂无任务</option>}{state?.tasks.map(t => <option key={t.id} value={t.id}>{t.title} · {t.status}</option>)}</select>
    {state?.activeId && <button onClick={() => void action(() => api.cancelAgent(state.activeId!))}>停止当前任务</button>}
    {task && <><p>绑定工作区：{task.root} · 状态：{task.status}</p><button disabled={!!state?.activeId || !task.rootIdentity} onClick={() => void action(() => api.resumeAgent(task.id))}>手动继续（先检查现状）</button>
      {!task.rootIdentity && <p>此历史任务没有绑定工作区身份，只能查看。</p>}
      <h3>计划 / 执行进度</h3><pre>{task.plan || '等待模型制定计划'}</pre><p>已完成 {task.tools.filter(t => t.status === 'completed').length} / {task.tools.length} 次工具调用</p>
      {task.approvals.map(a => <div className="callout" key={a.id}>
        <strong>{a.tool} · {a.status}</strong>
        {Array.isArray(a.paths) && a.paths.map((path, i, paths) => <div key={i}>
          <p>{path.access === 'read' ? '读取' : '修改'}{path.outsideWorkspace ? ' · 工作区外' : ' · 工作区内'}{paths.length > 1 ? (i === 0 ? ' · 源' : ' · 目标') : ''}</p>
          <pre>{path.path}</pre>
        </div>)}
        <pre>{a.description}</pre>
        {a.status === 'pending' && <><button onClick={() => void action(() => api.decideApproval({ id: a.id, approved: true }))}>仅允许本次</button><button onClick={() => void action(() => api.decideApproval({ id: a.id, approved: false }))}>拒绝</button></>}
      </div>)}
      <h3>模型回复 / 完成总结</h3><pre aria-live="polite">{task.output || '等待回复…'}</pre>{task.error && <p role="alert">{task.error}</p>}
      <h3>工具及命令记录</h3>{task.tools.map(t => <details key={t.id}><summary>{t.name} · {t.status}</summary><pre>{t.arguments}</pre><pre>{t.result}</pre></details>)}
      <h3>文件修改 / Diff</h3>{task.changes.map((c, i) => <details key={i}><summary>{c.operation} · {c.path}</summary><pre>{`--- before\n${c.before}\n+++ after\n${c.after}`}</pre></details>)}
      <p>已报告 Token：{task.usage.reduce((n, u) => n + u.total, 0)}（{task.usage.length} 轮有报告；缺失用量未估算）</p>
    </>}{(error || state?.notice) && <p role="alert">{error || state?.notice}</p>}</section>;
}
