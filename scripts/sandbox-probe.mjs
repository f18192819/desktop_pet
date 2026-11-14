// Diagnostic only. Never grants the application Shell authority.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
const exe = process.argv[2];
if (!exe || process.platform !== 'win32') throw new Error('Pass the absolute codex.exe path on Windows');
mkdirSync('.test-build', { recursive: true });
const fixture = mkdtempSync(resolve('.test-build/sandbox-')); const root = join(fixture, 'workspace'); const outside = join(fixture, 'outside');
mkdirSync(root); mkdirSync(outside); writeFileSync(join(outside, 'existing.txt'), 'original');
const server = createServer((_req, res) => res.end('probe'));
await new Promise(r => server.listen(0, '127.0.0.1', r)); const port = server.address().port;
const script = `$ErrorActionPreference='Stop'
$r=@{}
try { Set-Content -LiteralPath '${root}\\inside.txt' -Value 'ok'; Set-Content -LiteralPath '${root}\\inside.txt' -Value 'edit'; Remove-Item -LiteralPath '${root}\\inside.txt'; $r.insideCRUD=$true } catch { $r.insideCRUD=$false }
try { Set-Content -LiteralPath '${outside}\\created.txt' -Value 'bad'; $r.outsideCreateBlocked=$false } catch { $r.outsideCreateBlocked=$true }
try { Set-Content -LiteralPath '${outside}\\existing.txt' -Value 'bad'; $r.outsideEditBlocked=$false } catch { $r.outsideEditBlocked=$true }
try { Remove-Item -LiteralPath '${outside}\\existing.txt'; $r.outsideDeleteBlocked=$false } catch { $r.outsideDeleteBlocked=$true }
try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 'http://127.0.0.1:${port}' | Out-Null; $r.loopbackBlocked=$false } catch { $r.loopbackBlocked=$true }
try { New-Item -Path 'HKCU:\\Software\\EmmaSandboxProbe' -Force | Out-Null; $r.registryBlocked=$false } catch { $r.registryBlocked=$true }
$r | ConvertTo-Json -Compress
`;
writeFileSync(join(root, 'probe.ps1'), script);
const env = Object.fromEntries(['SystemRoot', 'WINDIR', 'SystemDrive', 'COMSPEC', 'PATH', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'USERNAME'].filter(k => process.env[k]).map(k => [k, process.env[k]]));
env.TEMP = root; env.TMP = root;
const run = args => new Promise((resolveRun, reject) => {
  const child = spawn(exe, args, { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); let output = '';
  const timer = setTimeout(() => child.kill(), 20000);
  child.stdout.on('data', b => { output += b; }); child.stderr.on('data', b => { output += b; });
  child.on('error', reject); child.on('close', code => { clearTimeout(timer); resolveRun({ code, output }); });
});
try {
  const version = await run(['--version']); if (version.output.trim() !== 'codex-cli 0.128.0') throw new Error('CLI version mismatch');
  const result = await run(['sandbox', 'windows', '--permissions-profile', 'emma-stage3', '-C', root,
    '-c', 'service_tier=fast', '-c', 'permissions.emma-stage3.filesystem.:root=read',
    '-c', 'permissions.emma-stage3.filesystem.:project_roots=write', '-c', 'permissions.emma-stage3.network.enabled=false',
    '--', join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'probe.ps1')]);
  const report = { version: version.output.trim(), fixture, ...result, externalOriginal: (() => { try { return readFileSync(join(outside, 'existing.txt'), 'utf8') === 'original'; } catch { return false; } })(), certified: false, reason: 'Diagnostic subset only; no application enablement' };
  writeFileSync(join(fixture, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} finally { server.close(); }
