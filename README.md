# 艾玛 Windows 桌宠 MVP

Electron + React + TypeScript，当前只实现本地桌宠。没有 AI 请求、ChatGPT 登录、工具执行或模拟回复。

## 检查结论

本目录最初只有 `Emma_Desktop_Pet_Animation_Pack/`（82 个文件）。未发现 `package.json`、依赖、Electron 主进程、Preload、React Renderer、窗口管理、IPC、配置系统或托盘实现，因此本次是在该目录补齐最小应用，而不是替换已有代码。父仓库其他项目没有修改。

素材原包继续保留，原样复制到 `assets/characters/emma/`。仅新增 `animation-manifest.json`；原始 PNG、Sprite Sheet、GIF 和 README 均未改写。测试逐文件比较 SHA-256，并检查 64 张帧图的 443×443 / RGBA 格式。

## 启动

环境：Windows 10/11，Node.js >= 22.12.0（推荐 Node 24）。

```powershell
npm ci
npm start
```

首次运行 Electron 可能需要下载官方运行时。`npm start` 会构建后启动；修改源码后退出托盘程序并重新运行。`npm run dev` 是同一命令，不启动开发服务器。

```powershell
npm run typecheck
npm run build
npm run start:built
```

生成可双击的 Windows 便携目录：

```powershell
npm run package:win
```

输出 `release/emma-desktop-pet-win32-x64/Emma.exe`（架构随当前 Node 进程变化）。**请保留并分发整个目录**。该 MVP 不包含安装器、签名、自动更新或开机自启。

## 使用

- 单击：开心互动。正在思考、工作或等待审批时保持业务状态。
- 双击：打开聊天面板；支持键盘 Enter 打开、空格互动。
- 按住左键移动超过 5 DIP：拖动并播放 dragged；松开恢复 idle。单击延迟 450ms，以便识别双击；拖动结束不触发开心或聊天。
- 右键：聊天、工作面板、暂停/恢复动画、设置、隐藏、退出。
- Windows 托盘：显示/隐藏桌宠、打开聊天/工作/设置、退出；双击托盘显示桌宠。
- 工作面板：**仅本地动画预览**，可检查八种动作，没有真实任务。
- 默认 300 秒无交互进入睡眠；点击/拖动立即唤醒。设置中以秒调整，0 表示禁用。
- 聊天只有基础 UI，可写临时草稿，发送按钮明确禁用；关闭面板不会退出桌宠。

桌宠默认 240×240 CSS 像素，可设置为 120–600；443×443 画布等比例缩放，透明像素保留。整个桌宠窗口保留鼠标交互，透明边缘也会接收鼠标事件。

设置保存在 `app.getPath('userData')/pet-settings.json`，通常是 `%APPDATA%/Emma Desktop Companion/pet-settings.json`。保存位置、大小、置顶、动画开关、睡眠时间、皮肤。文件通过临时文件替换写入；损坏配置保留为 `.broken-时间戳` 后恢复默认。位置移动时防抖保存，拖动结束和退出时立即保存。

应用为单实例。开发运行与便携版共用同一个用户配置位置。

## 文件结构

```text
assets/characters/emma/      原样导入素材 + animation-manifest.json
Emma_Desktop_Pet_Animation_Pack/  原包，保留
src/main/
  entry.ts                  启动与启动错误提示
  main.ts                   窗口、主进程拖动、托盘、菜单、安全 IPC
  PetStateManager.ts        统一状态机与睡眠计时
  config.ts                 设置校验与原子写入
  geometry.ts               多屏幕工作区位置修正
  integrations/contracts.ts ChatProvider / AgentRuntime / PermissionManager
src/preload/preload.ts      有限 contextBridge API
src/shared/                类型、IPC 通道、动画清单访问
src/renderer/
  AnimationManager.ts       预加载与序列帧播放器
  Pet.tsx                   透明画布与鼠标交互
  Panels.tsx                聊天、工作预览、设置
  useSnapshot.ts            主进程快照订阅与清理
scripts/                   构建、便携打包、测试
tests/                     素材/状态/配置/位置、真实 Electron 冒烟测试
docs/                      架构和人工验收说明
```

## 动画与状态机

唯一状态入口是主进程 `PetStateManager`。Renderer 无法通过通用 IPC 任意发事件。未来业务代码在主进程调用：

```ts
state.setPetActivity('thinking');
state.setPetActivity('responding');        // 同样使用 thinking
state.setPetActivity('working');
state.setPetActivity('waitingApproval');  // question
state.setPetActivity('success');          // happy，一轮后 idle
state.setPetActivity('idle');

// Chat 与 Agent 并行发事件时按优先级仲裁：
state.handleActivityEvent({ source: 'agent', activity: 'working', taskId: 'task-1' });
state.handleActivityEvent({ source: 'chat', activity: 'thinking' });
```

优先级：拖动 100 > 人工预览 90 > 审批 80 > 工作 70 > 思考/回复 60 > 情绪/成功 40 > 睡眠 10 > 待机 0。同一业务来源后到的活动替换前一个活动；不同来源选择较高优先级。`setPetActivity` 是直接设置当前活动的入口，清除并行来源；真实接入推荐统一通过带来源的事件适配器。

每次状态变化携带 revision。旧动画的完成回调不能结束新动画。happy、主动 angry 播放一轮后回 idle，其余素材循环。angry 仅供主动互动，不映射失败。停止拖动按本次 MVP 的交互约定清空活动回 idle；后续实际任务的新事件可再次驱动状态。

`AnimationManager` 在显示角色前并行载入并 decode 全部 64 帧，用同一透明 Canvas 按清单顺序绘制。每次切换先取消上一个定时器，播放器销毁时释放定时器和缓存；暂停冻结当前帧、恢复继续。GIF 和 Sprite Sheet 仅保留供查看，运行时不用作播放器。

## 验证

```powershell
npm test
npm run test:electron
```

Electron 测试使用 `.test-build/profile/` 独立配置，不覆盖实际用户设置。检查八种动作确实推进、透明像素、无 Node 暴露、跨面板 IPC 限制、非法参数拒绝、暂停、缩放、置顶、睡眠、面板、托盘对象和真实进程重启后的恢复。截图输出到 `artifacts/`。

完整人工操作步骤见 [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md)，安全边界和未来接入见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 素材缺口

现有八种动作完整，MVP 无缺失。未来 walking、talking、error、waiting 若需要独立表现，应追加新素材；当前没有伪造这些动作。等待审批复用 question；AI 回复复用 thinking；失败不播放 angry。
