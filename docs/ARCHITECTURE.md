# 架构 · 第三阶段

沿用 Electron 主进程 / 沙箱 Preload / React Renderer，新增聊天模块，不迁移框架，不增加 SDK 或数据库依赖。

## 进程与 IPC

主进程拥有窗口、状态机、服务配置、凭据、API 请求、会话及请求生命周期。Preload 只暴露 DesktopPetAPI 命名方法，事件剥离 Electron Event 并返回取消订阅函数。Renderer 只负责 UI、动画和用户意图，无法直接访问 Node、文件系统、Shell 或已保存 Key。

所有窗口保留 contextIsolation、sandbox、webSecurity、禁用 nodeIntegration，CSP 保留 connect-src 'none'。emma://app/ 仅加载构建目录内资源，拒绝越界和未知 host。禁止导航、新窗口、webview 和权限请求，不开放网络端口。

既有 authorize 校验 webContents、主框架、本地 URL 和角色，新增方法校验白名单、类型、长度、UUID、URL。服务配置/清 Key/连接测试仅设置窗口可调用；模型/额度/非敏感状态允许聊天和设置调用；所有会话操作仅聊天可调用。广播按角色隔离，桌宠无 AI 数据，设置无聊天记录。

## Provider

integrations/contracts.ts 的 ChatProvider 接受完整 messages 与 AbortSignal，返回 text / usage / done，另提供 listModels、testConnection、getBalance。AgentRuntime、PermissionManager 在 agent 模块实现，独立于普通聊天。

OpenAICompatibleProvider 使用原生 fetch，向 `{baseUrl}/chat/completions` POST model/messages/stream。TextDecoder 流式解码 UTF-8；SSEParser 支持跨块 CR/LF/CRLF、多行 data、注释和尾块。处理 delta.content/refusal、finish_reason、usage、[DONE]；有 finish_reason 的 EOF 兼容完成，无结束信号视为截断。错误 JSON、流中 error、异常结构和工具调用报错，不执行工具。

取消和总超时共同覆盖响应头与整个响应体，finally 清理计时器、取消 reader 并释放锁。JSON 响应上限 2 MB、单 SSE 事件 1 MB。没有自动推理重试。HTTP 401/403/429 等转换为固定提示，不反射响应错误正文、底层 fetch 异常或请求头，避免 Key 泄露。

/models 不支持可手动输入，Model ID 允许暂空以获取列表。连接测试使用 stream=false、max_tokens=1，可能计费。接口可达与模型有权限不是同一结论，需实际测试。

通用额度方法直接返回 unsupported，不请求猜测端点。DeepSeekProvider 显式选择后查询同 origin 根目录 /user/balance，校验真实货币/余额并带时间；其他服务可扩展 ChatProvider 和 createProvider 工厂。参考 [Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)、[DeepSeek 余额](https://api-docs.deepseek.com/zh-cn/api/get-user-balance/)。

## 凭据与端点

配置写 ai-provider.json；safeStorage.encryptString 加密后的凭据写 ai-credentials.bin，密文中绑定规范化 Base URL。读取时端点必须一致，更换地址不沿用旧 Key，fetch 禁止重定向。只允许 HTTPS 或精确 loopback HTTP，拒绝 URL 内账号密码、查询、片段；Key 校验长度和控制字符。

系统加密不可用或 Linux basic_text 后端时禁止保存/解密，绝不明文后备。当前固定 Electron 45.3.1，使用其支持的同步 safeStorage；升级 46 前须迁移异步接口，见 [45.3.1 文档](https://github.com/electron/electron/blob/v45.3.1/docs/api/safe-storage.md)。

用户输入仅短暂存在密码框，单向交给主进程，保存尝试后清空；任何读接口、快照、localStorage、宠物设置、聊天文件和日志不返回原始 Key。清除删除凭据文件。两个文件独立原子替换，先凭据后配置；极端中途故障可能需要重新输入，端点绑定会阻止向错误地址发送 Key。

## 会话与请求

ChatService 管理普通聊天，最多一个活动生成或诊断请求。AgentService 使用独立 AbortController 和任务循环，可与聊天并行。先原子保存用户消息和 streaming 占位，再发请求。可以切换会话查看，但回复始终写入原 sessionId。Agent 任务启动时持有配置快照。

每个请求持有 requestId/messageId/sessionId/AbortController。取消先令 active 失效，标记 cancelled、保存并通知 idle，再 abort；所有 chunk、完成、错误比较 active 对象。旧请求即使不响应 abort，也不能改新消息、新 active 或动画；旧 finally 仅保存当前库。

ConversationStore 存版本、selectedId、会话标题/时间和消息状态/模型/Provider/实际 usage，读取重构白名单。创建/切换/重命名/删除/发送原子保存，流式输出最多 500ms 检查点、40ms UI 通知合并，终止立即保存。异常退出后 streaming 变 interrupted，不自动重试。存储失败有提示并保留内存；强退可能丢失最近检查点后的片段。上限见 README。

上下文只取当前会话用户消息与完整助手回复；部分助手输出仅供查看。删除活动会话先取消。Token 只累计实际 usage，未报告次数单列，余额独立展示，不把估计值当作实际账单。

## 动画与窗口

ChatService 经既有 handleActivityEvent({source:'chat',taskId,activity}) 驱动 PetStateManager：开始 thinking，首段 responding，成功 success/happy 一轮，失败/取消 idle。过期保护统一在 ChatService。拖动优先覆盖聊天，松开恢复进行中聊天，普通拖动回 idle，没有第二套状态机。

原有透明无边框、默认置顶、跳过任务栏、240 DIP 可调、多屏/负坐标/分数 DPI 修正不变。Windows pop-up-menu 层级保证 topmost；16ms 主进程采样，窗口内锚点校验与末尾补采样、失焦/隐藏/退出结束及超时兜底继续复用。全部 PNG 和统一 AnimationManager 复用，未改原始素材。

## 后续边界

第三阶段增加主进程文件 Agent。工作面板专有 IPC 管理任务、审批和停止；设置专有 IPC 调用原生目录选择器，不接收任意授权路径。工具先经过 Ajv JSON Schema，再进行 WorkspaceSecurity 业务校验，串行执行并记录状态。AgentProvider 复用配置工厂和 CredentialStore，拼接 SSE tool_calls，首轮 required 验证能力。完整架构图和边界见 [STAGE3](STAGE3.md)。

ShellExecutor 硬性禁用：CLI 0.128.0 实测允许删除外部夹具和访问 loopback。不存在普通进程 fallback，审批不能绕过此限制。文件工具尚未完成原生句柄竞态加固，不宣称完整安全认证。ChatGPT 登录、SIWC/OAuth、Codex App Server、MCP、浏览器自动化、SQLite、长期偏好、提醒和后台任务不在本阶段。
