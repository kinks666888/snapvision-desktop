# SnapVision Desktop

macOS 桌面截图 OCR 工具 — 识别财经/股票截图文字，后续支持 AI 分析。

## 技术栈

- **前端：** Electron + React 18 + TypeScript + Vite + Tailwind CSS
- **OCR 引擎：** Python Flask + PaddleOCR (中英文)
- **打包：** electron-builder → DMG/ZIP

## 快速开始

### 前置依赖

- Node.js 18+
- Python 3.8+
- PaddleOCR 依赖（首次需要下载模型 ~15MB）

### 安装

```bash
# Node 依赖
npm install

# Python 依赖
cd backend
pip install flask paddleocr paddlepaddle
```

### 启动

**1. 启动 OCR 后端服务：**

```bash
cd backend && python3 ocr_server.py
```

默认监听 `http://127.0.0.1:5002`。可通过 `OCR_PORT` 环境变量自定义端口。

> 首次启动会自动下载 PaddleOCR 模型，耗时约 1-3 分钟。

**2. 启动桌面应用（另一个终端）：**

```bash
npm run dev
```

### 构建

```bash
# 完整构建 + 打包 DMG
npm run electron:build
```

产物输出到 `release/` 目录。

## 使用

1. 启动 OCR 服务后，打开 SnapVision
2. 拖拽或点击上传包含股票信息的截图（PNG / JPG / WEBP）
3. 自动识别图中的文字内容
4. 支持逐行查看、复制全文

## 项目结构

```
snapvision-desktop/
├── electron/              # Electron 主进程 + preload
│   ├── main.ts            # 窗口管理、OCR 生命周期、IPC
│   ├── preload.ts         # contextBridge 安全桥接
│   └── ocr-client.ts      # OCR HTTP 客户端（可独立测试）
├── src/                   # React 渲染进程
│   ├── App.tsx            # 根组件 + 状态机
│   ├── components/        # UI 组件
│   ├── services/          # IPC 封装 + AI 占位
│   └── types/             # TypeScript 类型
├── backend/               # OCR 后端服务
│   └── ocr_server.py      # Flask + PaddleOCR
├── package.json
└── vite.config.ts
```

## 开发命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动开发模式（Vite HMR + Electron） |
| `npm run build` | TypeScript 类型检查 + Vite 构建 |
| `npm run electron:build` | 完整构建 + 打包 macOS DMG |
| `npx tsc --noEmit` | 仅类型检查 |

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `OCR_PORT` | `5002` | OCR 服务端口 |
| `PYTHON_BIN` | `python3` | Python 可执行文件路径 |
| `NODE_ENV` | — | 设为 `production` 禁用开发模式 |

## License

MIT
