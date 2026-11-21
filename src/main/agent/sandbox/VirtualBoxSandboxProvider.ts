import { execFile } from 'node:child_process';
import { win32 } from 'node:path';
import { promisify } from 'node:util';
import type { SandboxDetection, SandboxProvider } from './SandboxProvider';

// Fixed, read-only inventory. No VM command, workspace input, configuration
// mutation, or invocation of a detected executable.
const inventory = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new()
$os = Get-CimInstance Win32_OperatingSystem
$computer = Get-CimInstance Win32_ComputerSystem
$features = Get-CimInstance Win32_OptionalFeature -Filter "Name='VirtualMachinePlatform' OR Name='HypervisorPlatform' OR Name='Microsoft-Hyper-V-All'"
function FeatureState([string]$name) {
  $item = $features | Where-Object Name -EQ $name | Select-Object -First 1
  if ($item.InstallState -eq 1) { return 'enabled' }
  if ($item.InstallState -eq 2) { return 'disabled' }
  return 'absent'
}
function HasProgram([string]$name, [string]$relativePath) {
  if (Get-Command $name -CommandType Application -ErrorAction SilentlyContinue) { return $true }
  return Test-Path -LiteralPath (Join-Path $env:ProgramFiles $relativePath) -PathType Leaf
}
[ordered]@{
  edition = $os.Caption
  build = $os.BuildNumber
  hypervisorPresent = [bool]$computer.HypervisorPresent
  virtualMachinePlatform = FeatureState 'VirtualMachinePlatform'
  windowsHypervisorPlatform = FeatureState 'HypervisorPlatform'
  hyperV = FeatureState 'Microsoft-Hyper-V-All'
  hyperVModulePresent = [bool](Get-Module -ListAvailable -Name Hyper-V)
  virtualBoxPresent = HasProgram 'VBoxManage.exe' 'Oracle\VirtualBox\VBoxManage.exe'
  qemuPresent = HasProgram 'qemu-system-x86_64.exe' 'qemu\qemu-system-x86_64.exe'
  wslPresent = Test-Path -LiteralPath (Join-Path $env:SystemRoot 'System32\wsl.exe') -PathType Leaf
} | ConvertTo-Json -Compress
`;

export class VirtualBoxSandboxProvider implements SandboxProvider {
  async detect(signal?: AbortSignal): Promise<SandboxDetection> {
    signal?.throwIfAborted();
    const platform = [process.platform, process.arch].join('/');
    const base = { provider: 'virtualbox' as const, platform };
    if (process.platform !== 'win32' || process.arch !== 'x64') {
      return { ...base, state: 'missing', host: null, reason: '诊断仅支持 Windows x64' };
    }
    const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
    const executable = win32.join(systemRoot, 'System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    const { stdout } = await promisify(execFile)(executable, [
      '-NoProfile', '-NoLogo', '-NonInteractive', '-EncodedCommand', Buffer.from(inventory, 'utf16le').toString('base64'),
    ], { cwd: win32.dirname(executable), signal, windowsHide: true, timeout: 30_000, maxBuffer: 64 * 1024 });
    const host = JSON.parse(stdout) as NonNullable<SandboxDetection['host']>;
    return {
      ...base, host, state: host.virtualBoxPresent ? 'unverified' : 'missing',
      reason: host.virtualBoxPresent ? '检测到 VirtualBox，来宾及隔离配置仍待验收' : '未检测到 VirtualBox，独立 Windows 来宾尚未部署',
    };
  }

  // No lifecycle operation is offered until the isolated VM can be exercised.
  private async unavailable(): Promise<never> { throw new Error('VirtualBox 原型未部署，禁止操作虚拟机'); }
  create() { return this.unavailable(); }
  start() { return this.unavailable(); }
  execute() { return this.unavailable(); }
  cancel() { return this.unavailable(); }
  collect() { return this.unavailable(); }
  destroy() { return this.unavailable(); }
}
