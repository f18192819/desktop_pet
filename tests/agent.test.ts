import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, linkSync, symlinkSync, existsSync, renameSync, readdirSync, statSync, openSync, closeSync } from 'node:fs';
import { execFile, spawn, spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { promisify } from 'node:util';
import { WorkspaceSecurity } from '../src/main/agent/WorkspaceSecurity';
import { runProxy, WorkspaceOperationInterrupted } from '../src/main/agent/NativeWorkspaceProxy';
import { WorkspaceFS } from '../src/main/agent/WorkspaceFS';
import { ToolAccumulator, AgentProvider } from '../src/main/agent/AgentProvider';
import { validateShellTool, validateTool } from '../src/main/agent/ToolRegistry';
import { AgentService } from '../src/main/agent/AgentService';
import { ShellExecutor } from '../src/main/agent/ShellExecutor';
import { PermissionManager } from '../src/main/agent/PermissionManager';
import { defaultPermissions } from '../src/main/agent/WorkspaceConfig';
import { READ_TOOLS, WRITE_TOOLS } from '../src/shared/agent';
import type { AgentMessage, ToolCall } from '../src/shared/agent';
import type { ProviderConfig } from '../src/shared/chat';
mkdirSync('.test-build', { recursive: true });
const fixture = () => { const dir = mkdtempSync(resolve('.test-build/agent-')); const root = join(dir, 'work'); mkdirSync(root); return { dir, root }; };
const config: ProviderConfig = { name: 'test', baseUrl: 'https://example.invalid/v1', model: 'fixture', adapter: 'openai-compatible', timeoutMs: 1000, includeUsage: true };
const env = { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR };
async function until(predicate: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'Test condition timed out');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
test('原生文件 CRUD、二进制复制删除、目录复制及失败保留原文件', async () => {
  const { dir, root } = fixture(); const fs = new WorkspaceFS(await WorkspaceSecurity.open(root), () => {});
  const binary = Buffer.from([0, 255, 128, 1, 2, 3]); const outside = join(dir, 'binary.dat'); writeFileSync(outside, binary);
  await fs.execute('copy_path', { path: outside, destination: 'a.dat' }); assert.deepEqual(readFileSync(join(root, 'a.dat')), binary);
  await fs.execute('move_path', { path: 'a.dat', destination: 'b.dat' }); await assert.rejects(fs.execute('move_path', { path: 'b.dat', destination: outside }));
  await fs.execute('delete_path', { path: 'b.dat' }); assert.ok(!existsSync(join(root, 'b.dat'))); assert.deepEqual(readFileSync(outside), binary);
  await fs.execute('create_directory', { path: 'tree' }); await fs.write('tree/text.txt', 'before'); writeFileSync(join(root, 'tree/binary.dat'), binary);
  await fs.execute('copy_path', { path: 'tree', destination: 'copy' }); assert.deepEqual(readFileSync(join(root, 'copy/binary.dat')), binary);
  await assert.rejects(fs.execute('copy_path', { path: 'tree', destination: 'copy' })); assert.equal(await fs.read('copy/text.txt'), 'before');
  await fs.execute('delete_path', { path: 'copy' }); assert.ok(!existsSync(join(root, 'copy')));
  await fs.execute('move_path', { path: 'tree', destination: 'moved-tree' });
  await fs.execute('move_path', { path: 'moved-tree', destination: 'tree' });
  await assert.rejects(fs.execute('apply_patch', { path: 'tree/text.txt', oldText: 'absent', newText: 'bad' })); assert.equal(await fs.read('tree/text.txt'), 'before');
  assert.ok(!readdirSync(root).some(n => n.startsWith('.emma-')));
});
async function atCommit(root: string, op: string, args: Record<string,string>, attack: () => void, barrier = 'LOCKED') {
  const security = await WorkspaceSecurity.open(root);
  return await new Promise<{ ok: boolean; error?: string }>((resolveResult, reject) => {
    const child = spawn(resolve('.test-build/WorkspaceProxy.Test.exe'), [], { windowsHide: true, env: { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR } });
    let out = ''; let errors = ''; let fired = false;
    const timer = setTimeout(() => { child.kill(); reject(new Error('Race barrier timeout')); }, 10000);
    child.stdout.on('data', b => out += b);
    child.stderr.on('data', b => { errors += b; if (!fired && errors.includes('LOCKED')) { fired = true; try { attack(); child.stdin.end('GO\n'); } catch (e) { child.kill(); clearTimeout(timer); reject(e); } } });
    child.on('error', reject); child.on('exit', () => { clearTimeout(timer); try { assert.ok(fired, out); resolveResult(JSON.parse(out.replace(/^\uFEFF/, ''))); } catch (e) { reject(e); } });
    child.stdin.write(JSON.stringify({ root, identity: security.identity, protectedRoots: [], op, args, barrier }) + '\n');
  });
}
test('确定性并发：父目录、目标名称和硬链接攻击在写入前及提交前均被拒绝', async () => {
  const { dir, root } = fixture(); const parent = join(root, 'parent'); mkdirSync(parent); const outside = join(dir, 'outside'); mkdirSync(outside); writeFileSync(join(outside, 'sentinel'), 'external');
  const result = await atCommit(root, 'write_file', { path: 'parent/new.txt', content: 'inside' }, () => {
    assert.throws(() => renameSync(parent, join(root, 'parked')));
    assert.throws(() => renameSync(root, join(dir, 'parked-root')));
    const changed = spawnSync(resolve('.test-build/WorkspaceProxy.Test.exe'), ['--unknown-reparse', parent], { encoding: 'utf8', windowsHide: true });
    assert.equal(changed.status, 1); assert.match(changed.stderr, /fixture open.*32/);
  });
  assert.equal(result.ok, true); assert.equal(readFileSync(join(parent, 'new.txt'), 'utf8'), 'inside'); assert.deepEqual(readdirSync(outside), ['sentinel']);
  writeFileSync(join(parent, 'target'), 'original');
  const metadata = statSync(join(outside, 'sentinel'));
  for (const barrier of ['LOCKED', 'COMMIT']) {
    const leaf = await atCommit(root, 'write_file', { path: 'parent/target', content: 'replacement' }, () => {
      assert.throws(() => renameSync(join(parent, 'target'), join(parent, 'old')));
      assert.throws(() => linkSync(join(outside, 'sentinel'), join(parent, 'target')));
      assert.throws(() => linkSync(join(parent, 'target'), join(outside, 'new-link')));
    }, barrier);
    assert.equal(leaf.ok, true);
  }
  const after = statSync(join(outside, 'sentinel'));
  assert.deepEqual([after.ino, after.nlink, after.ctimeMs, after.mtimeMs], [metadata.ino, metadata.nlink, metadata.ctimeMs, metadata.mtimeMs]);
  assert.equal(readFileSync(join(outside, 'sentinel'), 'utf8'), 'external'); assert.ok(!existsSync(join(parent, 'old'))); assert.ok(!existsSync(join(outside, 'new-link')));
  assert.equal(readFileSync(join(parent, 'target'), 'utf8'), 'replacement');
});
test('空父目录的属性专用句柄不能在创建前或提交前改成 Reparse Point', async () => {
  const { root }=fixture();
  for(const op of ['write_file','create_directory']) {
    for(const barrier of ['PARENTS','COMMIT']) {
      const parent=join(root,`${op}-${barrier}`);mkdirSync(parent);
      const result=await atCommit(root,op,{path:join(parent,'new'),content:'inside'},()=>{
        const changed=spawnSync(resolve('.test-build/WorkspaceProxy.Test.exe'),['--unknown-reparse',parent,'256'],{encoding:'utf8',windowsHide:true});
        assert.equal(changed.status,1);assert.match(changed.stderr,/fixture open.*32/);
      },barrier);
      assert.equal(result.ok,true);assert.ok(existsSync(join(parent,'new')));
    }
  }
});
function treeSnapshot(root: string): unknown {
  const info = statSync(root);
  return { ino: info.ino, links: info.nlink, size: info.isDirectory() ? 0 : info.size, modified: info.mtimeMs,
    entries: info.isDirectory() ? Object.fromEntries(readdirSync(root).sort().map(name => [name, treeSnapshot(join(root, name))])) : readFileSync(root).toString('hex') };
}
async function inject(root: string, op: string, args: Record<string,string>, options: Record<string,unknown>) {
  const { identity } = await WorkspaceSecurity.open(root);
  const result = spawnSync(resolve('.test-build/WorkspaceProxy.Test.exe'), [], { windowsHide: true, encoding: 'utf8', timeout: 10000,
    env: { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR }, input: JSON.stringify({ root, identity, protectedRoots: [], op, args, barrier: 'NONE', ...options }) + '\n' });
  assert.ok(!result.error, String(result.error)); return JSON.parse(result.stdout.replace(/^\uFEFF/, '')) as {ok:boolean;error?:string};
}
test('事务故障注入：覆盖和递归删除每一步失败均完整回滚', async () => {
  const { root } = fixture(); mkdirSync(join(root, 'tree')); mkdirSync(join(root, 'tree/sub'));
  writeFileSync(join(root, 'tree/a'), 'original'); writeFileSync(join(root, 'tree/sub/b'), Buffer.from([0,255,128]));
  const before = treeSnapshot(join(root, 'tree'));
  const overwritten = await inject(root, 'write_file', { path: 'tree/a', content: 'replacement' }, { failAfter: 1 });
  assert.equal(overwritten.ok, false); assert.match(overwritten.error!, /Injected failure/); assert.deepEqual(treeSnapshot(join(root, 'tree')), before);
  // a, b, sub, tree: fail after each staged delete, including all deletes staged.
  for (let failAfter=1; failAfter<=4; failAfter++) {
    const result=await inject(root,'delete_path',{path:'tree'},{failAfter}); assert.equal(result.ok,false); assert.match(result.error!,/Injected failure/);
    assert.deepEqual(treeSnapshot(join(root,'tree')),before);
  }
});
test('递归删除拒绝已有的读取句柄，并在提交前保留对外可见的原目录', async () => {
  const { root } = fixture();
  const tree = join(root, 'tree'); mkdirSync(tree);
  const file = join(tree, 'a'); writeFileSync(file, 'original');
  const before = treeSnapshot(tree);
  const fs = new WorkspaceFS(await WorkspaceSecurity.open(root), () => {});
  const reader = openSync(file, 'r');
  try {
    await assert.rejects(fs.execute('delete_path', { path: 'tree' }), /Transactional open denied/);
    assert.deepEqual(treeSnapshot(tree), before);
  } finally { closeSync(reader); }
  const committed = await atCommit(root, 'delete_path', { path: 'tree' }, () => {
    assert.deepEqual(treeSnapshot(tree), before);
  }, 'COMMIT');
  assert.equal(committed.ok, true);
  assert.ok(!existsSync(tree));
});
test('事务故障注入：目录复制每一步失败都不留下部分目标，TxF 不可用时拒绝写入', async () => {
  const { root } = fixture(); mkdirSync(join(root,'source')); mkdirSync(join(root,'source/sub')); writeFileSync(join(root,'source/a'),'original'); writeFileSync(join(root,'source/sub/b'),Buffer.from([0,255]));
  const before=treeSnapshot(join(root,'source'));
  for(let failAfter=1;failAfter<=4;failAfter++) {
    const result=await inject(root,'copy_path',{path:'source',destination:'destination'},{failAfter}); assert.equal(result.ok,false); assert.match(result.error!,/Injected failure/);
    assert.ok(!existsSync(join(root,'destination'))); assert.deepEqual(treeSnapshot(join(root,'source')),before);
  }
  const unavailable=await inject(root,'write_file',{path:'source/a',content:'bad'},{transactionUnavailable:true});
  assert.equal(unavailable.ok,false);assert.match(unavailable.error!,/unavailable/);assert.deepEqual(treeSnapshot(join(root,'source')),before);
});
async function killAt(root:string,op:string,args:Record<string,string>,barrier:string) {
  const { identity } = await WorkspaceSecurity.open(root);
  await new Promise<void>((done,reject)=>{
    const child=spawn(resolve('.test-build/WorkspaceProxy.Test.exe'),[],{windowsHide:true,env:{SystemRoot:process.env.SystemRoot,WINDIR:process.env.WINDIR}});
    let stopped=false,err='',out='';const timer=setTimeout(()=>{child.kill();reject(new Error('Kill barrier timeout'));},10000);
    child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>{err+=b;if(!stopped&&err.includes('LOCKED')){stopped=true;child.kill();}});
    child.on('error',reject);child.on('exit',()=>{clearTimeout(timer);try{assert.ok(stopped,out);done();}catch(e){reject(e);}});
    child.stdin.write(JSON.stringify({root,identity,protectedRoots:[],op,args,barrier})+'\n');
  });
}
test('helper 强制终止：中途及关闭句柄后提交前，覆盖/复制/删除由系统回滚', async () => {
  const { root }=fixture();mkdirSync(join(root,'tree'));writeFileSync(join(root,'tree/a'),'original');writeFileSync(join(root,'tree/b'),Buffer.from([0,255]));
  const before=treeSnapshot(join(root,'tree'));
  for(const barrier of ['MUTATION','COMMIT']) {
    await killAt(root,'write_file',{path:'tree/a',content:'bad'},barrier);
    await killAt(root,'copy_path',{path:'tree',destination:'copy'},barrier);
    await killAt(root,'delete_path',{path:'tree'},barrier);
    assert.ok(!existsSync(join(root,'copy')));assert.deepEqual(treeSnapshot(join(root,'tree')),before);
  }
});
test('确定性并发：删除和移动源不能在句柄检查后被替换', async () => {
  const { root } = fixture(); writeFileSync(join(root, 'victim'), Buffer.from([0,255]));
  const deleted = await atCommit(root, 'delete_path', { path: 'victim' }, () => assert.throws(() => renameSync(join(root, 'victim'), join(root, 'parked'))));
  assert.equal(deleted.ok, true); assert.ok(!existsSync(join(root, 'victim')));
  writeFileSync(join(root, 'source'), 'original');
  const moved = await atCommit(root, 'move_path', { path: 'source', destination: 'destination' }, () => { assert.throws(() => renameSync(join(root, 'source'), join(root, 'parked'))); writeFileSync(join(root, 'destination'), 'concurrent'); });
  assert.equal(moved.ok, false); assert.equal(readFileSync(join(root, 'source'), 'utf8'), 'original'); assert.equal(readFileSync(join(root, 'destination'), 'utf8'), 'concurrent');
});
test('跨调用根目录身份替换拒绝', async () => {
  const { dir, root } = fixture(); const fs = new WorkspaceFS(await WorkspaceSecurity.open(root), () => {});
  renameSync(root, join(dir, 'old-root')); mkdirSync(root); await assert.rejects(fs.write('escape.txt', 'bad'), /identity/); assert.ok(!existsSync(join(root,'escape.txt')));
});
test('工作区包含构建目录时也不能写入文件代理目录', async () => {
  const fs = new WorkspaceFS(await WorkspaceSecurity.open(resolve('.')), () => {});
  await assert.rejects(fs.write('dist/native/workspace-protection-fixture.txt', 'denied'), /Protected application directory/);
  assert.ok(!existsSync('dist/native/workspace-protection-fixture.txt'));
});
test('未知 Reparse Tag：真实原生夹具拒绝读取、复制和删除', async t => {
  const { root } = fixture(); const tagged = join(root, 'unknown'); mkdirSync(tagged);
  const made = spawnSync(resolve('.test-build/WorkspaceProxy.Test.exe'), ['--unknown-reparse', tagged], { encoding: 'utf8', windowsHide: true });
  if (made.status !== 0) { t.skip(`系统不能创建未知 tag 夹具：${made.stderr}`); return; }
  const fs = new WorkspaceFS(await WorkspaceSecurity.open(root), () => {});
  for (const op of ['read_file','delete_path','copy_path']) await assert.rejects(fs.execute(op, { path: 'unknown', destination: 'copy' }));
  await assert.rejects(fs.write('unknown/escape', 'bad'));
});
test('文件边界：外部读取/复制，越界写入、ADS、设备路径、硬链接及 Junction 拒绝', async () => {
  const { dir, root } = fixture(); const outside = join(dir, 'outside.txt'); writeFileSync(outside, 'original');
  const fs = new WorkspaceFS(await WorkspaceSecurity.open(root), () => {});
  assert.equal(await fs.read(outside), 'original'); await fs.execute('copy_path', { path: outside, destination: 'copy.txt' });
  await fs.write('inside.txt', 'hello'); assert.equal(await fs.read('inside.txt'), 'hello');
  for (const path of [outside, '../escape.txt', 'a:ads', '\\\\?\\C:\\escape.txt', 'NUL', root]) await assert.rejects(fs.write(path, 'bad'));
  linkSync(outside, join(root, 'hard.txt')); const originalLink=statSync(outside);
  for(const op of ['write_file','delete_path','move_path']) await assert.rejects(fs.execute(op,{path:'hard.txt',content:'bad',destination:'moved'}));
  await assert.rejects(fs.execute('copy_path',{path:'inside.txt',destination:'hard.txt'}));
  const afterLink=statSync(outside);
  assert.deepEqual([afterLink.ino,afterLink.nlink,afterLink.ctimeMs,afterLink.mtimeMs],[originalLink.ino,originalLink.nlink,originalLink.ctimeMs,originalLink.mtimeMs]);
  assert.equal(readFileSync(outside, 'utf8'), 'original');
  const externalDir = join(dir, 'external'); mkdirSync(externalDir); symlinkSync(externalDir, join(root, 'junction'), 'junction');
  await assert.rejects(fs.write('junction/escape.txt', 'bad')); await assert.rejects(fs.execute('delete_path', { path: 'junction' })); assert.ok(existsSync(externalDir));
  await fs.execute('apply_patch', { path: 'inside.txt', oldText: 'hello', newText: 'world' }); assert.equal(await fs.read('inside.txt'), 'world');
  await assert.rejects(fs.execute('apply_patch', { path: 'inside.txt', oldText: 'missing', newText: 'bad' })); assert.equal(await fs.read('inside.txt'), 'world');
});
test('工具 JSON Schema 和 tool_calls 多 index 分片', () => {
  assert.throws(() => validateTool('write_file', '{bad')); assert.throws(() => validateTool('read_file', '{"path":"x","shell":true}'));
  const acc = new ToolAccumulator(); acc.feed([{ index: 1, id: 'b', function: { name: 'read_', arguments: '{"path":' } }, { index: 0, id: 'a', function: { name: 'update_plan', arguments: '{"plan":"ok"}' } }]);
  acc.feed([{ index: 1, function: { name: 'file', arguments: '"x"}' } }]);
  assert.deepEqual(acc.finish().map(c => c.function.name), ['update_plan', 'read_file']); assert.equal(validateTool('read_file', acc.finish()[1].function.arguments).path, 'x');
  assert.throws(() => acc.feed([{ index: -1 }]));
});
test('AgentProvider SSE 字节分片、usage、required 不支持和截断', async () => {
  const data = 'data: ' + JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call', function: { name: 'update_plan', arguments: '{"plan":"中文"}' } }] }, finish_reason: null }] }) + '\r\n\r\n' + 'data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } }) + '\n\ndata: [DONE]\n\n';
  const transport = (async () => new Response(new ReadableStream({ start(c) { for (const b of new TextEncoder().encode(data)) c.enqueue(new Uint8Array([b])); c.close(); } }), { headers: { 'content-type': 'text/event-stream' } })) as typeof fetch;
  const result = await new AgentProvider(config, '', transport).turn([], new AbortController().signal, () => {}, true);
  assert.equal(result.usage?.total, 5); assert.equal(result.calls[0].function.arguments, '{"plan":"中文"}');
  const noTools = (async () => new Response('data: {"choices":[{"delta":{"content":"hi"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })) as typeof fetch;
  await assert.rejects(new AgentProvider(config, '', noTools).turn([], new AbortController().signal, () => {}, true), /不.*Agent|不能作为 Agent/);
});
test('一次性审批、取消和 Shell fail closed', async () => {
  const p = new PermissionManager(); const c = new AbortController(); const result = p.request({ id: 'a', taskId: 't', tool: 'delete', description: '', scope: [] }, c.signal); p.decide('a', true); assert.equal(await result, 'approved'); assert.throws(() => p.decide('a', true));
  const cancelled = p.request({ id: 'b', taskId: 't', tool: 'delete', description: '', scope: [] }, c.signal);
  c.abort();
  assert.equal(await cancelled, 'denied');
  const command = { executable: 'git', args: ['status'], cwd: '.', readOnlyPaths: [], timeoutMs: 1000 };
  assert.throws(() => new ShellExecutor().execute(command, new AbortController().signal), /Shell 已禁用/);
  assert.throws(() => new ShellExecutor().execute(command, c.signal), { name: 'AbortError' });
});
test('Agent 持久化先于执行、审批取消、恢复不重放 pending 写入', async () => {
  const { dir, root } = fixture(); const data = join(dir, 'data');
  const fake = { turn: async () => ({ content: '', calls: [{ id: 'x', type: 'function' as const, function: { name: 'write_file', arguments: '{"path":"result.txt","content":"ok"}' } }] }) } as unknown as AgentProvider;
  const service = new AgentService(data, () => fake, () => {}); await service.setWorkspace(root); const id = await service.start('write');
  await until(() => service.snapshot().tasks[0].status === 'waitingApproval'); assert.ok(existsSync(join(data, 'agent-sessions.json')));
  const approvalId = service.snapshot().tasks[0].approvals[0].id;
  await assert.rejects(service.setWorkspace(root)); await service.cancel(id);
  assert.throws(() => service.permissions.decide(approvalId, true), /审批已过期/);
  assert.ok(!existsSync(join(root, 'result.txt'))); assert.equal(service.snapshot().tasks[0].tools[0].status, 'interrupted');
  const loaded = new AgentService(data, () => fake, () => {}); assert.equal(loaded.snapshot().activeId, null); assert.ok(!existsSync(join(root, 'result.txt'))); await service.dispose(); await loaded.dispose();
});
test('异步代理限制输入、两路输出和运行时间，拒绝启动错误、异常退出及无效结果', async () => {
  const run = (code: string, timeoutMs = 3000) => runProxy(process.execPath, ['-e', code], '{}', env, undefined, timeoutMs);
  assert.equal(await run('console.log(JSON.stringify({ok:true,result:"中文"}))'), '中文');
  await assert.rejects(run('console.log("bad")'), WorkspaceOperationInterrupted);
  await assert.rejects(run('console.log(JSON.stringify({ok:true,result:"x"})); process.exitCode = 2'), WorkspaceOperationInterrupted);
  await assert.rejects(run('process.stdout.write(Buffer.alloc(5 * 1024 * 1024)); setInterval(()=>{},1000)'), /标准输出超过限制/);
  await assert.rejects(run('process.stderr.write(Buffer.alloc(128 * 1024)); setInterval(()=>{},1000)'), /错误输出超过限制/);
  await assert.rejects(run('setInterval(()=>{},1000)', 100), /超时/);
  await assert.rejects(runProxy(resolve('.test-build/nonexistent-proxy.exe'), [], '{}', env), /无法启动/);
  await assert.rejects(runProxy(process.execPath, [], 'a'.repeat(2 * 1024 * 1024 + 1), env), /请求超过/);
  await assert.rejects(runProxy(process.execPath, [], '{}', env, AbortSignal.abort()), /已取消/);
});
test('工作区状态读取走缓存，目录替换和无身份历史均不能运行', async t => {
  const { dir, root } = fixture(); const data = join(dir, 'data'); mkdirSync(data);
  const workspaceFile = join(data, 'workspace.json'); const taskFile = join(data, 'agent-sessions.json');
  let providerCalls = 0;
  const provider = () => {
    providerCalls++;
    return { turn: async () => ({ content: '', calls: [] }) } as unknown as AgentProvider;
  };
  const opens = t.mock.method(WorkspaceSecurity, 'open');
  writeFileSync(workspaceFile, JSON.stringify({ root, autoWrite: false }));
  const legacy = new AgentService(data, provider, () => {});
  await assert.rejects(legacy.start('legacy'), /重新选择/);
  assert.equal(legacy.workspaceState().valid, false);
  assert.equal(JSON.parse(readFileSync(workspaceFile, 'utf8')).identity, null);
  await legacy.setWorkspace(root);
  const saved = JSON.parse(readFileSync(workspaceFile, 'utf8'));
  assert.match(saved.identity, /^[0-9A-F]{8}:[0-9A-F]{16}$/);
  const id = await legacy.start('bound');
  await until(() => legacy.snapshot().activeId === null);
  await legacy.dispose();
  const stored = JSON.parse(readFileSync(taskFile, 'utf8'));
  assert.equal(stored.tasks[0].rootIdentity, saved.identity);
  stored.tasks.push({ ...stored.tasks[0], id: 'legacy', rootIdentity: undefined });
  writeFileSync(taskFile, JSON.stringify(stored));

  renameSync(root, join(dir, 'old-root')); mkdirSync(root);
  const restarted = new AgentService(data, provider, () => {});
  await assert.rejects(restarted.start('replaced'), /Workspace identity changed/);
  await assert.rejects(restarted.resume(id), /Workspace identity changed/);
  assert.equal(restarted.workspaceState().valid, false);
  const checks = opens.mock.callCount();
  for (let i = 0; i < 20; i++) restarted.workspaceState();
  assert.equal(opens.mock.callCount(), checks);
  assert.equal(providerCalls, 1);
  assert.deepEqual(JSON.parse(readFileSync(workspaceFile, 'utf8')), saved);
  await restarted.setWorkspace(root);
  await assert.rejects(restarted.resume(id), /身份不一致/);
  assert.equal(restarted.snapshot().tasks.length, 2);
  await assert.rejects(restarted.resume('legacy'), /只能查看/);
  await restarted.dispose();
});
test('停止任务会等待代理退出，未知结果标记 interrupted 并结束任务轮次', async t => {
  const { dir, root } = fixture(); const data = join(dir, 'data'); const pidFile = join(dir, 'helper.pid');
  let turns = 0;
  const fake = { turn: async () => {
    turns++;
    return { content: '', calls: [{ id: 'x', type: 'function', function: { name: 'write_file', arguments: '{"path":"x","content":"test"}' } }] };
  } } as unknown as AgentProvider;
  let hang = true;
  t.mock.method(WorkspaceSecurity.prototype, 'call', (_op: string, _args: Record<string, string>, signal?: AbortSignal) => {
    if (!hang) return Promise.reject(new WorkspaceOperationInterrupted('测试响应丢失'));
    const script = `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(()=>{},1000)`;
    return runProxy(process.execPath, ['-e', script], '{}', env, signal, 5000);
  });
  const service = new AgentService(data, () => fake, () => {});
  try {
    await service.setWorkspace(root);
    service.setToolPermission('write_file', 'allow', service.workspaceState().identity);
    const id = await service.start('cancel');
    await until(() => existsSync(pidFile) && statSync(pidFile).size > 0);
    const pid = Number(readFileSync(pidFile, 'utf8'));
    const cancelled = service.cancel(id);
    await assert.rejects(service.start('too soon'), /等待当前 Agent/);
    await cancelled;
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    assert.equal(service.snapshot().tasks[0].tools[0].status, 'interrupted');
    assert.deepEqual(service.snapshot().tasks[0].changes, []);

    hang = false;
    await service.start('unknown');
    await until(() => service.snapshot().activeId === null);
    const [task] = service.snapshot().tasks;
    assert.equal(task.status, 'interrupted');
    assert.equal(task.tools[0].status, 'interrupted');
    assert.deepEqual(task.changes, []);
    assert.equal(turns, 2);
  } finally { await service.dispose(); }
});

function scriptedAgent(data: string) {
  let calls: ToolCall[] = [];
  let modelResults: string[] = [];
  const fake = { turn: async (messages: AgentMessage[]) => {
    modelResults = messages.filter(message => message.role === 'tool').map(message => message.content);
    return { content: '', calls: calls.splice(0) };
  } } as unknown as AgentProvider;
  const service = new AgentService(data, () => fake, () => {});
  function start(batch: [string, object][]) {
    calls = batch.map(([name, args], i) => ({ id: `call-${i}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }));
    return service.start('permission fixture');
  }
  async function approval(index: number) {
    await until(() => service.snapshot().tasks[0]?.approvals[index]?.status === 'pending');
    return service.snapshot().tasks[0].approvals[index];
  }
  async function done() {
    await until(() => service.snapshot().activeId === null);
    return service.snapshot().tasks[0];
  }
  return { service, start, approval, done, modelResults: () => modelResults };
}

test('权限执行：工具独立、逐次询问、重复拒绝及特殊工具禁用', async () => {
  const { dir, root } = fixture();
  const agent = scriptedAgent(join(dir, 'data'));
  const { service } = agent;
  try {
    await service.setWorkspace(root);
    const { identity } = service.workspaceState();
    service.setToolPermission('delete_path', 'deny', identity);
    service.setToolPermission('shell', 'allow', identity);
    assert.equal(service.workspaceState().shell.enabled, false);
    assert.throws(() => service.setToolPermission('request_network', 'allow', identity), /无效/);
    assert.throws(() => service.setToolPermission('read_file', { mode: 'allow' }, identity), /无效/);
    writeFileSync(join(root, 'input.txt'), 'input');
    await agent.start([
      ['update_plan', { plan: 'test' }],
      ['read_file', { path: 'input.txt' }],
      ['write_file', { path: 'first.txt', content: 'approved' }],
      ['write_file', { path: 'second.txt', content: 'denied' }],
      ['delete_path', { path: 'input.txt' }], ['delete_path', { path: 'input.txt' }],
      ['shell', { executable: 'node', args: ['--version'], cwd: '.', readOnlyPaths: [], timeoutMs: 1000 }],
      ['request_network', { reason: 'disabled' }],
    ]);
    const first = await agent.approval(0);
    assert.deepEqual(first.paths, [{ path: join(root, 'first.txt'), access: 'write', outsideWorkspace: false }]);
    assert.ok(!existsSync(join(root, 'first.txt')));
    service.permissions.decide(first.id, true);
    const second = await agent.approval(1);
    assert.notEqual(first.id, second.id);
    assert.throws(() => service.permissions.decide(first.id, true), /审批已过期/);
    service.permissions.decide(second.id, false);
    const task = await agent.done();
    assert.deepEqual(task.tools.map(tool => tool.status), ['completed', 'completed', 'completed', 'failed', 'failed', 'failed', 'failed', 'failed']);
    assert.deepEqual(agent.modelResults().slice(1), [
      'input', task.tools[2].result, '用户拒绝本次操作，请调整方案', '工具权限禁止：delete_path', '工具权限禁止：delete_path',
      task.tools[6].result, task.tools[7].result,
    ]);
    assert.match(task.tools[6].result!, /Shell 已禁用/);
    assert.deepEqual(task.tools[6].command, { executable: 'node', args: ['--version'], cwd: root, readOnlyPaths: [], timeoutMs: 1000 });
    assert.match(task.tools[7].result!, /网络工具已禁用/);
    assert.deepEqual(task.approvals.map(item => item.status), ['approved', 'denied']);
    assert.equal(readFileSync(join(root, 'first.txt'), 'utf8'), 'approved');
    assert.ok(!existsSync(join(root, 'second.txt')));
    assert.ok(existsSync(join(root, 'input.txt')));
    assert.equal(service.workspaceState().permissions.write_file, 'ask');
    service.setToolPermission('delete_path', 'allow', identity);
    await agent.start([['delete_path', { path: 'first.txt' }]]);
    const deleted = await agent.done();
    assert.equal(deleted.tools[0].status, 'completed');
    assert.equal(deleted.approvals.length, 0);
    assert.ok(!existsSync(join(root, 'first.txt')));
  } finally { await service.dispose(); }
});

test('权限执行：外部读取独立，复制检查源和目标，外部写入无法审批', async () => {
  const { dir, root } = fixture();
  const outside = join(dir, 'work-neighbor'); mkdirSync(outside);
  const source = join(outside, 'source.txt'); writeFileSync(source, 'external');
  writeFileSync(join(root, 'inside.txt'), 'internal');
  const agent = scriptedAgent(join(dir, 'data'));
  const { service } = agent;
  try {
    await service.setWorkspace(root);
    const { identity } = service.workspaceState();
    service.setToolPermission('copy_path', 'allow', identity);
    await agent.start([['copy_path', { path: '../work-neighbor/source.txt', destination: 'copy.txt' }]]);
    const copy = await agent.approval(0);
    assert.deepEqual(copy.paths, [
      { path: source, access: 'read', outsideWorkspace: true },
      { path: join(root, 'copy.txt'), access: 'write', outsideWorkspace: false },
    ]);
    service.permissions.decide(copy.id, true);
    assert.equal((await agent.done()).tools[0].status, 'completed');
    assert.equal(readFileSync(join(root, 'copy.txt'), 'utf8'), 'external');

    service.setToolPermission('external_read', 'deny', identity);
    await agent.start([
      ['read_file', { path: 'inside.txt' }], ['stat_path', { path: source }],
      ['copy_path', { path: source, destination: 'blocked.txt' }], ['copy_path', { path: 'inside.txt', destination: join(outside, 'out.txt') }],
    ]);
    const blocked = await agent.done();
    assert.equal(blocked.tools[0].result, 'internal');
    assert.match(blocked.tools[1].result!, /工作区外读取/);
    assert.match(blocked.tools[2].result!, /工作区外读取/);
    assert.match(blocked.tools[3].result!, /禁止写入工作区外/);
    assert.equal(blocked.approvals.length, 0);
    assert.ok(!existsSync(join(outside, 'out.txt')));
    assert.ok(!existsSync(join(root, 'blocked.txt')));

    service.setToolPermission('external_read', 'allow', identity);
    service.setToolPermission('read_file', 'deny', identity);
    await agent.start([['copy_path', { path: 'inside.txt', destination: 'blocked.txt' }]]);
    assert.match((await agent.done()).tools[0].result!, /工具权限禁止：read_file/);

    service.setToolPermission('read_file', 'allow', identity);
    service.setToolPermission('copy_path', 'ask', identity);
    await agent.start([['copy_path', { path: source, destination: 'blocked.txt' }]]);
    const pending = await agent.approval(0);
    service.setToolPermission('delete_path', 'deny', identity);
    assert.equal(service.snapshot().tasks[0].approvals[0].status, 'pending');
    const updates: string[] = [];
    const unsubscribe = service.subscribe(() => { updates.push(service.snapshot().tasks[0].approvals[0].status); });
    service.setToolPermission('external_read', 'deny', identity);
    unsubscribe();
    assert.deepEqual(updates, ['revoked']);
    assert.equal(service.snapshot().tasks[0].approvals[0].status, 'revoked');
    assert.throws(() => service.permissions.decide(pending.id, true), /审批已过期/);
    assert.match((await agent.done()).tools[0].result!, /工作区外读取/);
    assert.ok(!existsSync(join(root, 'blocked.txt')));
  } finally { await service.dispose(); }
});

test('权限配置：迁移旧开关、按身份恢复并安全处理损坏配置', async () => {
  const { dir, root } = fixture(); const data = join(dir, 'data'); mkdirSync(data);
  const other = join(dir, 'other'); mkdirSync(other);
  const file = join(data, 'workspace.json');
  const { identity } = await WorkspaceSecurity.open(root);
  const open = () => new AgentService(data, () => { throw new Error('此测试不启动模型'); }, () => {});
  for (const autoWrite of [false, true]) {
    writeFileSync(file, JSON.stringify({ root, identity, autoWrite }));
    const migrated = open();
    const { permissions } = migrated.workspaceState();
    for (const tool of READ_TOOLS) assert.equal(permissions[tool], 'allow');
    for (const tool of WRITE_TOOLS) assert.equal(permissions[tool], autoWrite && tool !== 'delete_path' ? 'allow' : 'ask');
    assert.equal(permissions.external_read, 'ask');
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(saved.version, 3);
    assert.ok(!('autoWrite' in saved));
    assert.deepEqual(saved.permissionsByIdentity[identity], permissions);
    await migrated.dispose();
  }
  const { identity: otherIdentity } = await WorkspaceSecurity.open(other);
  const { shell: _shell, ...v2Defaults } = defaultPermissions();
  writeFileSync(file, JSON.stringify({
    version: 2, root, identity,
    permissionsByIdentity: {
      [identity]: { ...v2Defaults, write_file: 'allow', external_read: 'deny' },
      [otherIdentity]: { ...v2Defaults, read_file: 'deny' },
    },
  }));
  const service = open();
  try {
    assert.equal(service.workspaceState().permissions.shell, 'ask');
    assert.equal(service.workspaceState().permissions.external_read, 'deny');
    await service.setWorkspace(other);
    assert.deepEqual(service.workspaceState().permissions, { ...defaultPermissions(), read_file: 'deny' });
    assert.throws(() => service.setToolPermission('write_file', 'allow', identity), /工作区已变更/);
    await service.setWorkspace(root);
    assert.equal(service.workspaceState().permissions.write_file, 'allow');
    service.setToolPermission('shell', 'allow', identity);
    service.setToolPermission('delete_path', 'deny', identity);
    await service.setWorkspace(root);
    assert.equal(service.workspaceState().permissions.delete_path, 'deny');
  } finally { await service.dispose(); }
  const saved = JSON.parse(readFileSync(file, 'utf8'));
  const restarted = open();
  assert.equal(restarted.workspaceState().permissions.delete_path, 'deny');
  assert.equal(restarted.workspaceState().permissions.write_file, 'allow');
  assert.equal(restarted.workspaceState().permissions.shell, 'allow');
  assert.equal(restarted.workspaceState().shell.enabled, false);
  await restarted.dispose();

  saved.permissionsByIdentity[identity].read_file = 'invalid';
  writeFileSync(file, JSON.stringify(saved));
  const corruptProfile = open();
  assert.deepEqual(corruptProfile.workspaceState().permissions, defaultPermissions());
  await corruptProfile.dispose();
  writeFileSync(file, '{invalid');
  const corruptFile = open();
  assert.equal(corruptFile.workspaceState().valid, false);
  assert.deepEqual(corruptFile.workspaceState().permissions, defaultPermissions());
  await corruptFile.dispose();
});

test('撤销审批只影响匹配的工作区和权限', async () => {
  const permissions = new PermissionManager();
  const controller = new AbortController();
  const requests = [
    permissions.request({ id: '1', taskId: 'a', tool: 'copy_path', description: '', scope: [] }, controller.signal,
      { identity: 'A', keys: ['copy_path', 'external_read'] }),
    permissions.request({ id: '2', taskId: 'b', tool: 'copy_path', description: '', scope: [] }, controller.signal,
      { identity: 'B', keys: ['copy_path', 'external_read'] }),
    permissions.request({ id: '3', taskId: 'a', tool: 'delete_path', description: '', scope: [] }, controller.signal,
      { identity: 'A', keys: ['delete_path'] }),
  ];
  assert.deepEqual(permissions.revokePermission('A', 'external_read'), ['1']);
  assert.throws(() => permissions.decide('1', true), /审批已过期/);
  permissions.decide('2', true);
  permissions.decide('3', true);
  assert.deepEqual(await Promise.all(requests), ['denied', 'approved', 'approved']);
});

test('结构化命令校验工作目录和外部读取权限，沙箱未认证时从不启动', async () => {
  const { dir, root } = fixture();
  const agent = scriptedAgent(join(dir, 'data'));
  const { service } = agent;
  const command = { executable: 'git', args: ['status', '--short'], cwd: '.', readOnlyPaths: [], timeoutMs: 3000 };
  assert.throws(() => validateShellTool(JSON.stringify({ ...command, shell: true })), /JSON Schema/);
  assert.throws(() => validateShellTool(JSON.stringify({ ...command, args: [String.fromCharCode(0)] })), /JSON Schema/);
  assert.throws(() => validateShellTool(JSON.stringify({ ...command, timeoutMs: -1 })), /JSON Schema/);
  try {
    await service.setWorkspace(root);
    const { identity } = service.workspaceState();
    service.setToolPermission('shell', 'allow', identity);
    service.setToolPermission('external_read', 'deny', identity);
    await agent.start([
      ['shell', { ...command, cwd: '..' }],
      ['shell', { ...command, readOnlyPaths: ['../external.txt'] }],
      ['shell', { ...command, readOnlyPaths: [join(dir, 'external.txt')] }],
      ['shell', command],
      ['shell', { ...command, executable: join(root, 'git.exe') }],
    ]);
    const task = await agent.done();
    assert.deepEqual(task.tools.map(tool => tool.status), ['failed', 'failed', 'failed', 'failed', 'failed']);
    assert.match(task.tools[0].result!, /工作目录必须在工作区内/);
    assert.match(task.tools[1].result!, /必须是绝对路径/);
    assert.match(task.tools[2].result!, /工具权限禁止：工作区外读取/);
    assert.match(task.tools[3].result!, /Shell 已禁用/);
    assert.match(task.tools[4].result!, /内置运行时名称/);
    assert.equal(task.approvals.length, 0);
    service.setToolPermission('shell', 'deny', identity);
    await agent.start([['shell', command]]);
    assert.match((await agent.done()).tools[0].result!, /工具权限禁止：shell/);
  } finally { await service.dispose(); }
});

test('Shell 审批：按次绑定命令和权限，批准后真实启动门禁仍拒绝执行', async () => {
  const { dir, root } = fixture();
  const cmd = { executable: 'git', args: ['status', '--short'], cwd: '.', readOnlyPaths: [], timeoutMs: 500 };
  const agent = scriptedAgent(join(dir, 'data'));
  const { service } = agent;
  const sentinel = join(dir, 'sentinel.txt');
  writeFileSync(sentinel, 'external data');
  const bytes = readFileSync(sentinel);
  const before = statSync(sentinel, { bigint: true });
  try {
    await service.setWorkspace(root);
    const { identity } = service.workspaceState();
    await agent.start([['shell', cmd], ['shell', cmd]]);
    const first = await agent.approval(0);
    assert.deepEqual(first.command, { ...cmd, cwd: root });
    assert.deepEqual(first.scope, [root]);
    assert.equal(first.workspaceIdentity, identity);
    assert.deepEqual(first.requiredPermissions, ['shell']);
    service.permissions.decide(first.id, true);
    const next = await agent.approval(1);
    assert.notEqual(first.id, next.id);
    assert.throws(() => service.permissions.decide(first.id, true), /审批已过期/);
    service.permissions.decide(next.id, false);
    const task = await agent.done();
    assert.equal(task.tools[0].status, 'failed');
    assert.match(task.tools[0].result!, /Shell 已禁用/);
    assert.match(task.tools[1].result!, /用户拒绝/);

    service.setToolPermission('shell', 'allow', identity);
    const external = { ...cmd, readOnlyPaths: [sentinel] };
    await agent.start([['shell', external]]);
    const approval = await agent.approval(0);
    assert.deepEqual(approval.command, { ...external, cwd: root });
    assert.deepEqual(approval.scope, [root, sentinel]);
    assert.deepEqual(approval.requiredPermissions, ['shell', 'external_read']);
    service.permissions.decide(approval.id, true);
    assert.match((await agent.done()).tools[0].result!, /Shell 已禁用/);

    await agent.start([['shell', external]]);
    const racing = await agent.approval(0);
    service.permissions.decide(racing.id, true);
    // The ID was consumed before the policy changed. The post-approval check still rejects.
    service.setToolPermission('external_read', 'deny', identity);
    assert.match((await agent.done()).tools[0].result!, /工具权限禁止：工作区外读取/);
    const after = statSync(sentinel, { bigint: true });
    assert.deepEqual([after.ino, after.nlink, after.size, after.birthtimeNs, after.mtimeNs, after.ctimeNs],
      [before.ino, before.nlink, before.size, before.birthtimeNs, before.mtimeNs, before.ctimeNs]);
    assert.deepEqual(readFileSync(sentinel), bytes);
    assert.equal(service.workspaceState().shell.enabled, false);
  } finally { await service.dispose(); }
});

test('Shell 审批：权限变更立即撤销，取消任务使原审批失效', async () => {
  const { dir, root } = fixture();
  const agent = scriptedAgent(join(dir, 'data'));
  const { service } = agent;
  const command = { executable: 'node', args: ['--version'], cwd: '.', readOnlyPaths: [join(dir, 'external.txt')], timeoutMs: 1000 };
  try {
    await service.setWorkspace(root);
    const { identity } = service.workspaceState();
    for (const key of ['shell', 'external_read'] as const) {
      await agent.start([['shell', command]]);
      const approval = await agent.approval(0);
      service.setToolPermission(key, 'deny', identity);
      assert.equal(service.snapshot().tasks[0].approvals[0].status, 'revoked');
      assert.throws(() => service.permissions.decide(approval.id, true), /审批已过期/);
      assert.equal((await agent.done()).tools[0].status, 'failed');
      service.setToolPermission(key, 'ask', identity);
    }
    const id = await agent.start([['shell', command]]);
    const pending = await agent.approval(0);
    const stopped = service.cancel(id);
    assert.throws(() => service.permissions.decide(pending.id, true), /审批已过期/);
    await stopped;
    const task = await agent.done();
    assert.equal(task.status, 'cancelled');
    assert.notEqual(task.approvals[0].status, 'pending');
    assert.equal(task.tools[0].status, 'interrupted');
  } finally { await service.dispose(); }
});

test('Windows 原生 Job 夹具：终止进程树、超时清理、关闭即清理、禁止 breakaway', async () => {
  const { root } = fixture();
  for (const mode of ['terminate', 'timeout', 'close', 'breakaway']) {
    const { stdout } = await promisify(execFile)(resolve('.test-build/JobProcess.Tests.exe'), [mode, join(root, mode)], {
      windowsHide: true, timeout: 20_000, maxBuffer: 64 * 1024,
      env: { ...env, EMMA_TEST_PARENT_SECRET: 'fixture-only' },
    });
    assert.equal(stdout.trim(), `${mode}: PASS`);
  }
});
