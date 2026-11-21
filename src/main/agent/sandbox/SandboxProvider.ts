import type { ShellCommand } from '../../../shared/agent';
import type { GuestChange, GuestRun, HostInput } from './SandboxProtocol';

export interface ShellExecutionRequest {
  id: string;
  command: Readonly<ShellCommand>;
  workspaceRoot: string;
  workspaceIdentity: string;
  approvedReadOnlyPaths: readonly string[];
  /** Host-only guard. Run it again immediately before any native file submission. */
  beforeCommit(): Promise<void>;
}

export interface ShellExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export type SandboxOutput = (stream: 'stdout' | 'stderr', text: string) => void;
export type FeatureState = 'enabled' | 'disabled' | 'absent';
export interface SandboxDetection {
  provider: string;
  state: 'missing' | 'unverified';
  platform: string;
  host: {
    edition: string;
    build: string;
    hypervisorPresent: boolean;
    virtualMachinePlatform: FeatureState;
    windowsHypervisorPlatform: FeatureState;
    hyperV: FeatureState;
    hyperVModulePresent: boolean;
    virtualBoxPresent: boolean;
    qemuPresent: boolean;
    wslPresent: boolean;
  } | null;
  reason: string;
}

export interface SandboxInstance { readonly id: string }
export interface SandboxProvider {
  detect(signal?: AbortSignal): Promise<SandboxDetection>;
  create(input: HostInput, signal: AbortSignal): Promise<SandboxInstance>;
  start(instance: SandboxInstance, signal: AbortSignal): Promise<void>;
  execute(instance: SandboxInstance, command: GuestRun, signal: AbortSignal, output: SandboxOutput): Promise<void>;
  /** Only settles after the isolated instance and its command processes have stopped. */
  cancel(instance: SandboxInstance): Promise<void>;
  collect(instance: SandboxInstance, signal: AbortSignal): Promise<ShellExecutionResult & { changes: readonly GuestChange[] }>;
  destroy(instance: SandboxInstance): Promise<void>;
}
