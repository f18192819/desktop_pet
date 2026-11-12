import { createRequire } from 'node:module';
// Node 24 的内置 fetch 可使用环境代理，供 Electron 首次下载运行时。
if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY) {
  process.env.ELECTRON_GET_USE_PROXY ??= 'true';
  if (Number(process.versions.node.split('.')[0]) >= 24) process.env.NODE_USE_ENV_PROXY ??= '1';
}
export const electronPath = createRequire(import.meta.url)('electron');
export function electronEnvironment(extra = {}) {
  const env = { ...process.env, ...extra };
  // 某些开发宿主设置此变量；不得让它把 Electron 当成普通 Node 启动。
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}
