/** No unsandboxed fallback. Version 0.128.0 was inspected; certification is absent. */
export class ShellExecutor {
  static readonly evaluatedVersion = '0.128.0';
  readonly status = { enabled: false as const, reason: 'Shell 已禁用：Codex CLI 0.128.0 安全探测失败，工作区外夹具文件可被删除，loopback 网络仍可访问。Git、构建和代码执行暂不可用；不会退回普通进程。' };
  execute(): never { throw new Error(this.status.reason); }
}
