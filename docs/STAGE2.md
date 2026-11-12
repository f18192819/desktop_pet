# 第二阶段交付记录

基线：main 的 d7a334c，版本 0.2.0，保留原窗口/素材/托盘架构，没有新增依赖。

## 文件清单

新增：

- `src/shared/chat.ts`：服务状态、消息、会话、用量类型。
- `src/main/chat/validation.ts`、`storage.ts`：配置/URL 校验与原子写入。
- `src/main/chat/CredentialStore.ts`：safeStorage 凭据及端点绑定。
- `src/main/chat/sse.ts`、`OpenAICompatibleProvider.ts`：流式协议、fetch、错误、模型与额度适配。
- `src/main/chat/ConversationStore.ts`、`ChatService.ts`：会话库、请求协调、取消与过期保护。
- `src/renderer/useAI.ts`、`AISettings.tsx`、`Chat.tsx`：非敏感状态订阅、服务配置、多会话聊天。
- `tests/chat.test.ts`、`docs/STAGE2.md`。

修改：

- `src/main/main.ts`：实例化 ChatService、安全 IPC、按窗口角色广播和退出清理。
- `src/main/PetStateManager.ts`：拖动后恢复进行中的聊天活动。
- `src/main/integrations/contracts.ts`：Provider 契约。
- `src/shared/types.ts`、`channels.ts`、`src/preload/preload.ts`：有限 API 和事件。
- `src/renderer/Panels.tsx`、`styles.css`：集成聊天/设置，延续原有风格。
- `scripts/test.mjs`、`package.mjs`：纳入新测试，便携版本号读取 package.json。
- `tests/core.test.ts`、`electron-smoke.ts`：聊天动画和新 IPC 权限检查。
- `package.json`、`package-lock.json`：版本更新，无新增依赖。
- `.gitignore`、`README.md`、`docs/ARCHITECTURE.md`、`ACCEPTANCE.md`、`VERIFICATION.md`：安全忽略与文档。

## 验证

- 严格 TypeScript 检查与 Vite/Electron 构建通过。
- 15 组核心测试通过：原有 5 组、新增 10 组。模拟逐字节 UTF-8、CRLF、多行 SSE、完成/截断、HTTP 401/403/429、超时/取消、模型列表、额度、凭据边界、会话恢复/隔离、旧请求保护和失败保留内容。
- 实际 Electron 窗口与进程重启测试通过，检查桌宠不能读取 Provider/会话、设置不能读取会话、非法远程 HTTP 拒绝。自动测试不请求真实服务。
- 用户后续明确授权后，独立内存联调 Paratera：Base URL `https://llmapi.paratera.com`，模型 `DeepSeek-V4.1-Flash-1017`，一次短 SSE 回复 `OK`，finish_reason=stop，实际 usage 输入 37、输出 11、总计 48 Token。该测试的传输层限制 max_tokens=32。真实 Key 未保存，未额外进行付费测试。

## 用户人工验证

1. 从托盘退出旧版，npm start。在设置输入自己的 Key 并保存，密码框清空，状态显示加密配置；重启可继续使用，清除后凭据文件消失。
2. 获取或手动填写模型、测试连接。验证真实服务的错误 Key、权限不足、429、断网、证书和代理提示。连接测试 max_tokens=1 并非所有模型支持，以服务商兼容情况为准。
3. 两个会话分别发送不同内容，切换/重命名/删除/重启恢复；上下文应隔离，失败后用户输入及部分回复应保留。
4. 长回复停止后立即发新请求，或切换/删除会话；旧片段不能影响新请求。生成中拖动桌宠、关闭/重新打开聊天，状态应正确。
5. 检查 thinking/responding、happy、错误/取消 idle，及原有托盘、八种动画、多屏/DPI 行为。
6. 检查实际 usage；无报告时单独计数，不显示伪造数值。仅支持 DeepSeek 余额协议的服务才选择专用适配器并刷新。Paratera 通用模式不查询额度；未做真实余额查询。
7. 当前聊天 UI 的完整交互、Windows safeStorage 真实保存/解密/清除、真实长流/错误/代理/余额和目标多屏设备仍需用户完整联调。加密测试替身验证边界，不能替代 Windows 系统保护实测。

本阶段未重新生成便携目录；普通 build 只更新 dist。便携版需退出旧进程后 npm run package:win。
