# 桌宠动画素材包

每个状态包含 8 帧透明 PNG、4×2 PNG Sprite Sheet 和循环 GIF 预览。

- `frames/<状态>/frame_00.png` 至 `frame_07.png`：建议程序逐帧播放，透明边缘保留最好。
- `sprite_sheets/<状态>.png`：4 列 × 2 行，每格 443×443，顺序从左到右、从上到下。
- `previews/<状态>.gif`：循环动画预览。

| 状态 | 动作 | 建议帧间隔 |
|---|---|---:|
| idle / 待机 | 眨眼、轻微起伏、尾巴摆动 | 150 ms |
| thinking / 思考 | 托腮造型轻微点头与左右晃动 | 190 ms |
| angry / 生气 | 生气表情前倾、抖动与回弹 | 130 ms |
| working / 工作 | 笔记本前交替敲击键盘、专注眨眼 | 110 ms |
| question / 疑问 | 疑惑表情、眨眼与轻微摆动 | 180 ms |
| dragged / 拖动 | 悬空姿态左右摇摆、轻微晃动 | 120 ms |
| sleeping / 睡觉 | 蜷缩睡姿呼吸起伏、尾尖轻动 | 320 ms |
| happy / 开心互动 | 开心状态上下蹦跳与轻微摇摆 | 150 ms |

接入建议：运行时优先使用 PNG 帧序列；鼠标按下切换 dragged，释放后切回 idle；工作任务开始切换 working，任务结束切回 idle；空闲超时切换 sleeping。
