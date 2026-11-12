# 架构与后续接入

## 进程边界

- 主进程：唯一设置存储、窗口位置、多显示器、托盘、菜单、状态机、未来认证与 Agent 运行时。
- 沙箱 Preload：只暴露 `DesktopPetAPI` 的命名方法。通道白名单固定，事件回调剥离 Electron Event，订阅返回取消函数。
- Renderer：React UI、PNG decode、Canvas 绘制、鼠标意图。不能直接访问 Node、文件系统、Shell 或令牌。

桌宠和各面板使用 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`、`webSecurity: true`。主进程同时校验 webContents、主框架、本地页面 URL、功能对应的窗口角色和参数。

通过安全 `emma://app/` 协议加载构建目录内资源，拒绝路径越界、未知 host 与非 GET 请求。CSP 仅允许本应用脚本、样式和图片，`connect-src 'none'`。禁止导航、新窗口和 webview，拒绝所有权限请求。不使用 dev server，不开放网络端口。

设置 IPC 只接受指定键和范围，不接受路径、命令、位置或任意通道。拖动只发送开始/结束，坐标由主进程读取 Electron `screen.getCursorScreenPoint()`；Renderer 无权移动任意窗口。

## 桌宠窗口

无边框、透明、默认置顶、不在任务栏显示、无菜单和窗口阴影。240×240 DIP 与显示器缩放保持一致。不将鼠标全局穿透，保留 Canvas 完整交互区。

拖动由主进程 16ms 采样；Renderer 仅提供鼠标按下时的窗口内抓取点，主进程校验其在窗口范围内，结合真实窗口位置计算锚点；松开时再补采样一次，避免快速拖动丢失首尾位移。达到 5 DIP 阈值后进入 dragged。指针捕获确保窗口移动后仍可接收抬起事件；取消、失去捕获、窗口失焦、隐藏及退出均结束拖动，并有 2 分钟兜底。松开才约束到目标显示器，允许跨屏移动。窗口位置与大小在屏幕增加、移除、分辨率/缩放改变时重新约束到可见工作区，支持负坐标。

Windows 显式使用 `pop-up-menu` 置顶层级，避免 `floating` 的“排到任务栏后方”逻辑清除原生 topmost 状态。角色停留范围仍被限制在显示器工作区内。启动器会移除开发宿主可能设置的 `ELECTRON_RUN_AS_NODE`，并以可见 GUI 方式启动 Electron；不能给 GUI 进程传隐藏启动标志，否则首次 ShowWindow 可能被 Windows 忽略。

## 第一阶段范围

聊天和工作面板为独立原生窗口，关闭不影响托盘。聊天发送禁用、不显示登录按钮、不返回模型回复。工作面板明确为本地素材预览。未增加 OpenAI SDK、数据库、MCP SDK、语音或 Shell 执行代码。

`src/main/integrations/contracts.ts` 只定义主进程侧 `ChatProvider`、`AgentRuntime`、`PermissionManager` 与权限请求结构。`PetActivityEvent` 位于共享类型，承载经过适配后的可公开活动信息，不携带 OAuth 数据。

## 下一阶段建议（2026-11-12 官方文档核对）

1. 根据应用分发形式完成 SIWC 注册与支持的登录流程。身份登录与获准使用 ChatGPT 计划额度分别处理；是否可用、范围、限额以申请及官方指南为准。系统浏览器中的官方认证由用户完成；令牌由主进程管理，以 Windows 凭据保护机制保存，绝不放入 localStorage、Renderer、日志或 `pet-settings.json`。参见 [Sign in with ChatGPT](https://developers.openai.com/siwc)。
2. 固定 Codex 版本，依据该版本生成协议类型，在主进程实现 `AgentRuntime` 子进程适配器，优先使用 `codex app-server --listen stdio://` 的 JSONL 双向通道，发送 initialize / initialized，再处理 thread、turn、流式通知、取消、退出和断线。参见 [Codex App Server](https://learn.chatgpt.com/docs/app-server)。
3. SIWC 与 App Server 的令牌交接、provider 配置和续期应按当前官方集成指南实施，不能假设读取现有 ChatGPT 客户端凭据即可授权。参见 [SIWC + Codex app-server](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server)。
4. 将聊天流式开始/回复映射为 thinking；执行工具映射 working；审批请求映射 question；成功完成映射 happy；失败回 idle 并在任务面板显示真实错误。统一调用 `handleActivityEvent`，在适配器层过滤过期 taskId，禁止旧任务完成事件覆盖新任务。当前类型已预留 taskId，MVP 尚不执行任务。
5. 实现 PermissionManager，按任务 ID、工具和明确作用范围记录批准/拒绝；收到审批后暂停实际执行，用户批准后才继续。再接入 MCP，所有工具仍通过主进程权限门，不给 Renderer 通用 invoke 或 Shell。
6. 在主进程加入 SQLite 仓储，用于显式保存的会话和长期记忆，定义迁移、删除、保留策略。位置等少量偏好可继续使用 JSON。UI 只接受裁剪后的会话视图。

本阶段没有真实身份、推理或 App Server 请求；以上为下一阶段实现边界。
