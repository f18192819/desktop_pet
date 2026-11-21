# 艾玛 Desktop Companion · 0.3

第三阶段新增本地文件 Agent。设置中选择工作区，在工作面板输入任务，沿用已有 API 配置。设置可为每种文件工具选择始终允许、每次询问或禁止。默认允许工作区内读取，工作区外读取及文件修改逐次审批。文件工具通过 Windows x64 原生代理运行，事务写入需要支持 TxF 的本地 NTFS 卷。Shell、网络和命令执行保持禁用。获准读取的内容可能发送给模型服务商。权限和迁移说明见 [第三阶段交付记录](docs/STAGE3.md#32-工具权限中心)。

Windows Electron + React + TypeScript 桌宠，第二阶段增加 OpenAI-Compatible 实时聊天。用户自行配置 API Key、Base URL、Model ID，保留原有八种动画、窗口、拖动、多屏、托盘和偏好设置。没有新增 SDK 或数据库依赖。

## 启动

Windows 10/11 x64，Node.js >=22.12.0（推荐 Node 24 x64）。构建原生代理需要 Windows 自带的 .NET Framework 4.x x64 C# 编译器。先从托盘退出旧版，然后执行：

```powershell
npm ci
npm start
```

首次运行可能下载 Electron。npm start 构建并启动，npm run dev 与其相同，无开发服务器。修改源码后退出并重新启动。

```powershell
npm run typecheck
npm run build
npm run start:built
npm test
```

`npm run package:win` 生成 `release/emma-desktop-pet-win32-x64/Emma.exe`（架构取决于 Node）。须先退出运行中的便携版，保留整个输出目录。普通 build 不更新已有便携目录。没有安装器、签名或自动更新。

## 配置 AI

1. 右键桌宠 → 设置，在原有桌宠偏好下方找到 AI 服务配置。
2. 填写名称、Base URL、Key 并保存。Base URL 是接口前缀，程序追加 `/models`、`/chat/completions`；通常包含 `/v1`，以服务商文档为准，不要填完整聊天端点。
3. Model ID 可以先留空，保存后获取模型列表，选择或手动填写模型后再次保存。服务不支持 `/models` 时直接手动输入。
4. 测试连接使用已保存配置，发起真实聊天请求，设置 max_tokens=1，可能计费；并非所有模型都支持此参数。
5. 不支持 stream_options 的服务商可关闭“请求流式 Token 用量”。程序不会自动重试推理请求。

已根据用户授权联调的配置：

| 项目 | 值 |
|---|---|
| 名称 | Paratera（可自定义） |
| Base URL | `https://llmapi.paratera.com`（无需追加 /v1） |
| Model ID | `DeepSeek-V4.1-Flash-1017` |
| 适配器 | 通用 OpenAI-Compatible |
| 请求流式用量 | 开启 |

真实 Key 只用于联调进程内请求，未保存到仓库或应用配置。使用时请在设置中自行输入。

只允许 HTTPS 或 loopback HTTP（localhost、127.*、::1），拒绝 URL 内凭据、查询、片段及请求重定向。同一 Base URL 下 Key 留空表示保留；更换地址不沿用旧 Key，需重新输入。“清除已保存的 API Key”删除凭据文件。本地无认证服务可以不填 Key。保存尝试后密码框清空，不回显已有 Key。系统加密不可用时禁止保存/读取，绝不退化为明文。

## 聊天、会话和使用量

双击桌宠打开聊天，创建、选择、重命名或删除会话（删除需二次点击）。历史与当前会话重启后恢复。用户消息在请求前保存，回复逐块显示；支持停止、Ctrl+Enter 发送和向上翻阅历史。消息以纯文本显示，不执行 HTML 或加载远程图片。

普通聊天同时最多一个生成请求，Agent 使用独立协调器。可切换到其他会话查看；停止按钮仍作用于原请求。删除生成中的会话会先取消。失败、取消或退出保留已收到的部分内容；上次 streaming 的消息重启显示 interrupted，不自动重发。草稿仅在聊天窗口内存中，关闭面板后清除。

上下文按会话隔离。后续请求使用该会话用户消息和完整助手回复，错误/取消/中断的部分助手回复仅供查看。切换服务/模型不自动发送历史，只有再次发送时才将当前会话上下文发往所选服务。

Key 已配置与认证通过是不同状态。状态来自最近一次 API 操作，重启后重新验证；模型列表可访问不保证选中模型可推理，需测试连接或实际聊天。取消不保证服务商停止计费。

Token 仅展示服务商返回的输入/输出/总量，按当前会话累计；未报告的回复单独计数，不估算。连接测试不计入会话 Token。余额独立展示：

- 通用协议没有统一余额接口，明确显示不支持，不猜测控制台接口。
- 选择 DeepSeek 适配器后可手动查询同一 origin 的 `/user/balance`，显示真实货币、余额和查询时间。使用 DeepSeek 模型的第三方平台不自动支持该接口；Paratera 默认选择通用适配器。

## 桌宠操作

单击开心互动，双击聊天；左键移动超过 5 DIP 拖动并播放 dragged，普通拖动松开 idle，进行中的聊天则恢复聊天动画。单击延迟 450ms 识别双击，拖动不误触点击。右键提供聊天、工作预览、暂停/恢复、设置、隐藏、退出；托盘可显示/隐藏、打开面板和退出，双击显示桌宠。

默认空闲五分钟睡眠，点击/拖动唤醒；可设置大小 120–600、置顶、动画开关、睡眠和皮肤。工作面板新增 Agent，保留八种动画预览。原包 `Emma_Desktop_Pet_Animation_Pack/` 保留，运行素材在 `assets/characters/emma/`，64 张 443×443 RGBA PNG 预加载后按 manifest 播放。没有修改原图、重新生成动画或使用 GIF 播放。

## 本地数据与安全

Electron userData 通常是 `%APPDATA%/Emma Desktop Companion/`：

| 文件 | 内容 |
|---|---|
| pet-settings.json | 原有桌宠偏好及位置 |
| ai-provider.json | 非敏感服务配置，无 Key |
| ai-credentials.bin | safeStorage 加密后的端点绑定凭据 |
| workspace.json | 选中的工作区及按目录身份保存的工具权限 |
| agent-sessions.json | Agent 任务、工具结果、计划、审批及修改记录 |
| conversations.json | 版本化会话、消息、状态、模型、实际 usage，无凭据 |

同目录临时文件替换原子写入。用户消息请求前保存，流式输出最多每 500ms 保存，终止/退出立即保存；强制结束进程可能丢失最近一个间隔的片段。损坏 JSON 保留 `.broken-时间戳`；保存失败提示并保留内存内容。聊天记录本身是本地明文，凭据独立加密。

上限：100 会话，每会话 2000 条消息，输入 32000 字符，回复 100 万字符，上下文 20 万字符，历史文件 50 MB。达到限制提示新建/删除会话，不静默裁剪上下文。

API 请求只在主进程发起。Renderer 保留 `connect-src 'none'`、contextIsolation、sandbox、禁用 Node，调用命名 IPC，主进程验证来源、角色和参数。聊天数据只向聊天面板推送；设置只接收非敏感状态，桌宠不接收聊天或服务配置。

## 文件与验证

新增 `src/main/chat/`（Provider、SSE、凭据、会话、ChatService）、`src/shared/chat.ts`，以及 Renderer 的 `Chat.tsx`、`AISettings.tsx`、`useAI.ts`。扩展原 contracts、DesktopPetAPI、Preload 和现有 IPC；窗口/托盘仍在 main.ts，动画仍由 PetStateManager / AnimationManager 统一管理。

`npm test` 包含素材、状态机、几何、Provider/SSE、凭据、会话恢复、取消和过期保护，使用模拟网络与测试凭据。`npm run test:electron` 使用 `.test-build/profile/` 独立配置检查真实窗口、IPC 权限和重启，不发送真实 API 请求。

完整文件清单和人工验证见 [第二阶段交付记录](docs/STAGE2.md)、[架构](docs/ARCHITECTURE.md)、[验收](docs/ACCEPTANCE.md)。

## 后续范围

当前不接入 ChatGPT 登录、SIWC、OAuth。Codex App Server、MCP、浏览器自动化、SQLite 长期记忆、长期偏好、提醒和后台任务留待后续。AgentRuntime / PermissionManager 已实现文件工具循环和审批；Shell/Git 因安全探测失败而禁用。walking、talking、error、waiting 如需独立表现仍需补素材，失败恢复 idle，不播放 angry。
