import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, linkSync, symlinkSync, existsSync, renameSync, readdirSync, statSync, openSync, closeSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { WorkspaceSecurity } from '../src/main/agent/WorkspaceSecurity';
import { WorkspaceFS } from '../src/main/agent/WorkspaceFS';
import { ToolAccumulator, AgentProvider } from '../src/main/agent/AgentProvider';
import { validateTool } from '../src/main/agent/ToolRegistry';
import { AgentService } from '../src/main/agent/AgentService';
import { ShellExecutor } from '../src/main/agent/ShellExecutor';
import { PermissionManager } from '../src/main/agent/PermissionManager';
import type { ProviderConfig } from '../src/shared/chat';
mkdirSync('.test-build', { recursive: true });
const fixture = () => { const dir = mkdtempSync(resolve('.test-build/agent-')); const root = join(dir, 'work'); mkdirSync(root); return { dir, root }; };
const config: ProviderConfig = { name: 'test', baseUrl: 'https://example.invalid/v1', model: 'fixture', adapter: 'openai-compatible', timeoutMs: 1000, includeUsage: true };
test('原生文件 CRUD、二进制复制删除、目录复制及失败保留原文件', () => {
  const { dir, root } = fixture(); const fs = new WorkspaceFS(new WorkspaceSecurity(root), () => {});
  const binary = Buffer.from([0, 255, 128, 1, 2, 3]); const outside = join(dir, 'binary.dat'); writeFileSync(outside, binary);
  fs.execute('copy_path', { path: outside, destination: 'a.dat' }); assert.deepEqual(readFileSync(join(root, 'a.dat')), binary);
  fs.execute('move_path', { path: 'a.dat', destination: 'b.dat' }); assert.throws(() => fs.execute('move_path', { path: 'b.dat', destination: outside }));
  fs.execute('delete_path', { path: 'b.dat' }); assert.ok(!existsSync(join(root, 'b.dat'))); assert.deepEqual(readFileSync(outside), binary);
  fs.execute('create_directory', { path: 'tree' }); fs.write('tree/text.txt', 'before'); writeFileSync(join(root, 'tree/binary.dat'), binary);
  fs.execute('copy_path', { path: 'tree', destination: 'copy' }); assert.deepEqual(readFileSync(join(root, 'copy/binary.dat')), binary);
  assert.throws(() => fs.execute('copy_path', { path: 'tree', destination: 'copy' })); assert.equal(fs.read('copy/text.txt'), 'before');
  fs.execute('delete_path', { path: 'copy' }); assert.ok(!existsSync(join(root, 'copy')));
  fs.execute('move_path', { path: 'tree', destination: 'moved-tree' });
  fs.execute('move_path', { path: 'moved-tree', destination: 'tree' });
  assert.throws(() => fs.execute('apply_patch', { path: 'tree/text.txt', oldText: 'absent', newText: 'bad' })); assert.equal(fs.read('tree/text.txt'), 'before');
  assert.ok(!readdirSync(root).some(n => n.startsWith('.emma-')));
});
async function atCommit(root: string, op: string, args: Record<string,string>, attack: () => void, barrier = 'LOCKED') {
  const security = new WorkspaceSecurity(root);
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
function inject(root: string, op: string, args: Record<string,string>, options: Record<string,unknown>) {
  const identity = new WorkspaceSecurity(root).identity;
  const result = spawnSync(resolve('.test-build/WorkspaceProxy.Test.exe'), [], { windowsHide: true, encoding: 'utf8', timeout: 10000,
    env: { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR }, input: JSON.stringify({ root, identity, protectedRoots: [], op, args, barrier: 'NONE', ...options }) + '\n' });
  assert.ok(!result.error, String(result.error)); return JSON.parse(result.stdout.replace(/^\uFEFF/, '')) as {ok:boolean;error?:string};
}
test('事务故障注入：覆盖和递归删除每一步失败均完整回滚', () => {
  const { root } = fixture(); mkdirSync(join(root, 'tree')); mkdirSync(join(root, 'tree/sub'));
  writeFileSync(join(root, 'tree/a'), 'original'); writeFileSync(join(root, 'tree/sub/b'), Buffer.from([0,255,128]));
  const before = treeSnapshot(join(root, 'tree'));
  const overwritten = inject(root, 'write_file', { path: 'tree/a', content: 'replacement' }, { failAfter: 1 });
  assert.equal(overwritten.ok, false); assert.match(overwritten.error!, /Injected failure/); assert.deepEqual(treeSnapshot(join(root, 'tree')), before);
  // a, b, sub, tree: fail after each staged delete, including all deletes staged.
  for (let failAfter=1; failAfter<=4; failAfter++) {
    const result=inject(root,'delete_path',{path:'tree'},{failAfter}); assert.equal(result.ok,false); assert.match(result.error!,/Injected failure/);
    assert.deepEqual(treeSnapshot(join(root,'tree')),before);
  }
});
test('递归删除拒绝已有的读取句柄，并在提交前保留对外可见的原目录', async () => {
  const { root } = fixture();
  const tree = join(root, 'tree'); mkdirSync(tree);
  const file = join(tree, 'a'); writeFileSync(file, 'original');
  const before = treeSnapshot(tree);
  const fs = new WorkspaceFS(new WorkspaceSecurity(root), () => {});
  const reader = openSync(file, 'r');
  try {
    assert.throws(() => fs.execute('delete_path', { path: 'tree' }), /Transactional open denied/);
    assert.deepEqual(treeSnapshot(tree), before);
  } finally { closeSync(reader); }
  const committed = await atCommit(root, 'delete_path', { path: 'tree' }, () => {
    assert.deepEqual(treeSnapshot(tree), before);
  }, 'COMMIT');
  assert.equal(committed.ok, true);
  assert.ok(!existsSync(tree));
});
test('事务故障注入：目录复制每一步失败都不留下部分目标，TxF 不可用时拒绝写入', () => {
  const { root } = fixture(); mkdirSync(join(root,'source')); mkdirSync(join(root,'source/sub')); writeFileSync(join(root,'source/a'),'original'); writeFileSync(join(root,'source/sub/b'),Buffer.from([0,255]));
  const before=treeSnapshot(join(root,'source'));
  for(let failAfter=1;failAfter<=4;failAfter++) {
    const result=inject(root,'copy_path',{path:'source',destination:'destination'},{failAfter}); assert.equal(result.ok,false); assert.match(result.error!,/Injected failure/);
    assert.ok(!existsSync(join(root,'destination'))); assert.deepEqual(treeSnapshot(join(root,'source')),before);
  }
  const unavailable=inject(root,'write_file',{path:'source/a',content:'bad'},{transactionUnavailable:true});
  assert.equal(unavailable.ok,false);assert.match(unavailable.error!,/unavailable/);assert.deepEqual(treeSnapshot(join(root,'source')),before);
});
async function killAt(root:string,op:string,args:Record<string,string>,barrier:string) {
  const identity=new WorkspaceSecurity(root).identity;
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
test('跨调用根目录身份替换拒绝', () => {
  const { dir, root } = fixture(); const fs = new WorkspaceFS(new WorkspaceSecurity(root), () => {});
  renameSync(root, join(dir, 'old-root')); mkdirSync(root); assert.throws(() => fs.write('escape.txt', 'bad'), /identity/); assert.ok(!existsSync(join(root,'escape.txt')));
});
test('工作区包含构建目录时也不能写入文件代理目录', () => {
  const fs = new WorkspaceFS(new WorkspaceSecurity(resolve('.')), () => {});
  assert.throws(() => fs.write('dist/native/workspace-protection-fixture.txt', 'denied'), /Protected application directory/);
  assert.ok(!existsSync('dist/native/workspace-protection-fixture.txt'));
});
test('未知 Reparse Tag：真实原生夹具拒绝读取、复制和删除', t => {
  const { root } = fixture(); const tagged = join(root, 'unknown'); mkdirSync(tagged);
  const made = spawnSync(resolve('.test-build/WorkspaceProxy.Test.exe'), ['--unknown-reparse', tagged], { encoding: 'utf8', windowsHide: true });
  if (made.status !== 0) { t.skip(`系统不能创建未知 tag 夹具：${made.stderr}`); return; }
  const fs = new WorkspaceFS(new WorkspaceSecurity(root), () => {});
  for (const op of ['read_file','delete_path','copy_path']) assert.throws(() => fs.execute(op, { path: 'unknown', destination: 'copy' }));
  assert.throws(() => fs.write('unknown/escape', 'bad'));
});
test('文件边界：外部读取/复制，越界写入、ADS、设备路径、硬链接及 Junction 拒绝', () => {
  const { dir, root } = fixture(); const outside = join(dir, 'outside.txt'); writeFileSync(outside, 'original');
  const fs = new WorkspaceFS(new WorkspaceSecurity(root), () => {});
  assert.equal(fs.read(outside), 'original'); fs.execute('copy_path', { path: outside, destination: 'copy.txt' });
  fs.write('inside.txt', 'hello'); assert.equal(fs.read('inside.txt'), 'hello');
  for (const path of [outside, '../escape.txt', 'a:ads', '\\\\?\\C:\\escape.txt', 'NUL', root]) assert.throws(() => fs.write(path, 'bad'));
  linkSync(outside, join(root, 'hard.txt')); const originalLink=statSync(outside);
  for(const op of ['write_file','delete_path','move_path']) assert.throws(()=>fs.execute(op,{path:'hard.txt',content:'bad',destination:'moved'}));
  assert.throws(()=>fs.execute('copy_path',{path:'inside.txt',destination:'hard.txt'}));
  const afterLink=statSync(outside);
  assert.deepEqual([afterLink.ino,afterLink.nlink,afterLink.ctimeMs,afterLink.mtimeMs],[originalLink.ino,originalLink.nlink,originalLink.ctimeMs,originalLink.mtimeMs]);
  assert.equal(readFileSync(outside, 'utf8'), 'original');
  const externalDir = join(dir, 'external'); mkdirSync(externalDir); symlinkSync(externalDir, join(root, 'junction'), 'junction');
  assert.throws(() => fs.write('junction/escape.txt', 'bad')); assert.throws(() => fs.execute('delete_path', { path: 'junction' })); assert.ok(existsSync(externalDir));
  fs.execute('apply_patch', { path: 'inside.txt', oldText: 'hello', newText: 'world' }); assert.equal(fs.read('inside.txt'), 'world');
  assert.throws(() => fs.execute('apply_patch', { path: 'inside.txt', oldText: 'missing', newText: 'bad' })); assert.equal(fs.read('inside.txt'), 'world');
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
  const cancelled = p.request({ id: 'b', taskId: 't', tool: 'delete', description: '', scope: [] }, c.signal); c.abort(); assert.equal(await cancelled, 'denied'); assert.throws(() => new ShellExecutor().execute(), /Shell 已禁用/);
});
test('Agent 持久化先于执行、审批取消、恢复不重放 pending 写入', async () => {
  const { dir, root } = fixture(); const data = join(dir, 'data');
  const fake = { turn: async () => ({ content: '', calls: [{ id: 'x', type: 'function' as const, function: { name: 'write_file', arguments: '{"path":"result.txt","content":"ok"}' } }] }) } as unknown as AgentProvider;
  const service = new AgentService(data, () => fake, () => {}); service.setWorkspace(root); const id = service.start('write');
  await new Promise(r => setTimeout(r, 20)); assert.equal(service.snapshot().tasks[0].status, 'waitingApproval'); assert.ok(existsSync(join(data, 'agent-sessions.json')));
  assert.throws(() => service.setWorkspace(root)); service.cancel(id); await new Promise(r => setTimeout(r, 20));
  assert.ok(!existsSync(join(root, 'result.txt'))); assert.equal(service.snapshot().tasks[0].tools[0].status, 'interrupted');
  const loaded = new AgentService(data, () => fake, () => {}); assert.equal(loaded.snapshot().activeId, null); assert.ok(!existsSync(join(root, 'result.txt'))); service.dispose(); loaded.dispose();
});
