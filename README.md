# SnapVision Desktop

macOS 桌面截图识别与市场推测工具 —— 拖入一张行情截图，自动识别**A股 / 加密货币 / 美股**，拉取实时行情并输出多因子多空研判。

> ⚠️ 本工具输出的技术面分析仅供参考，**不构成投资建议**。市场有风险，投资需谨慎。

## 核心能力

- **三市场自动分流识别**：A股（腾讯/新浪/东财行情）、加密货币（OKX/Binance/CoinGecko）、美股（Yahoo Finance），一张截图拖进来自动判断走哪条链路
- **截图字段提取**：现价、涨跌幅、52周高低、市值、PE、资金费率、合约特征等，OCR 噪声容错 + 侧栏干扰防护（空间锚点投票）
- **五因子市场推测**：趋势 30% / 动量 25% / 情绪 20% / 量能 15% / 波动 10%，输出方向、概率、支撑/压力、止损/目标位、风险评级
- **情绪数据**：加密（资金费率 · 多空比 · 恐慌贪婪指数）、美股（VIX · 盘前/盘中/盘后/休市状态）
- **桌面端体验**：全屏/窗口双布局自适应、K 线周期切换、历史记录、分析报告导出

## 快速开始

### 前置依赖

- Node.js 18+
- Python 3.8+
- 系统代理（可选）：行情数据（OKX/Yahoo）需要能访问外网，推荐设置 `SNAPVISION_PROXY`

### 安装与启动

```bash
# 一条命令: 启动后端 + 桌面应用
./start.sh

# 或分开启动
./start.sh backend   # 仅 OCR 后端 (127.0.0.1:5002)
./start.sh app       # 仅桌面应用
```

> 首次启动会自动下载 PaddleOCR 模型，耗时约 1-3 分钟。代理默认 `http://127.0.0.1:7890`，可用 `export SNAPVISION_PROXY=...` 覆盖。

### 构建发布

```bash
npm run electron:build   # 完整构建 + 打包 macOS DMG → release/
```

## 使用

1. 启动后，将 A股 / 交易所 / 雪球 / 富途 等行情截图拖入窗口
2. 自动识别市场类型与标的，拉取实时行情
3. 右侧查看多因子推测面板：方向概率、关键价位、风险评级

## 项目结构

```
snapvision-desktop/
├── electron/                     # Electron 主进程 + preload + OCR 客户端
├── src/                          # React 渲染进程 (双布局 UI + 服务层)
├── backend/
│   ├── ocr_server.py             # Flask 服务: 识别 + 行情 + 推测路由
│   ├── stock_extractor.py        # A股截图解析
│   ├── crypto_extractor.py       # 加密截图解析 (空间锚点投票)
│   ├── us_stock_extractor.py     # 美股截图解析
│   ├── crypto_speculation.py     # 五因子推测引擎
│   └── services/market_data/     # 多源行情适配 (腾讯/东财/OKX/Yahoo...)
├── start.sh                      # 一键启动脚本
└── vite.config.ts
```

## 开发命令

| 命令 | 说明 |
|------|------|
| `./start.sh` | 后端 + 桌面应用一键启动 |
| `npm run dev` | 开发模式（Vite HMR + Electron） |
| `npm run build` | 类型检查 + 构建 |
| `npm run electron:build` | 打包 macOS DMG |
| `backend/.venv/bin/python -m unittest` | 后端单测（175 项） |
| `npx vitest run` | 前端单测（36 项） |

## 更新日志

### v0.1.0（2026-11-11）— 首个正式版

**🎉 新增**
- **加密货币市场推测模式**：OKX/币安页面识别（永续/杠杆/资金费率特征），OKX→Binance→CoinGecko 多源行情，资金费率/多空比/恐慌贪婪情绪
- **美股市场推测模式**：雪球/富途/老虎等平台识别，Yahoo 主源行情，VIX 情绪映射，盘前/盘中/盘后/休市四态显示，52周区间条
- **五因子推测引擎**：方向/概率/支撑压力/止损目标/盈亏比/风险评级，与交易所实时数据交叉验证一致
- **A股/加密/美股三级自动分流**：拖图即判市场，无需手动切换
- 历史记录、分析报告导出、全屏/窗口双布局自适应

**🔧 修复（实测问题闭环）**
- 币种/代码识别：侧栏列表项不再抢占主图标的（空间锚点投票）；支持雪球 `(NASDAQ:SNDK)` 交易所标签格式与词典外代码
- 数值提取：现价不再误抓侧栏市值/盘口杂数；涨跌幅不再误抓资金费率/振幅
- 失败显式降级：识别/行情失败明确报错，不再"伪成功"输出猜测值
- 网络：OKX/Yahoo 行情支持 `SNAPVISION_PROXY` 代理配置
- UI：全屏模式设置面板可正常打开；全屏/窗口内容一致

**✅ 质量**：后端 175 项单测 + 前端 36 项 vitest + TypeScript 全通过；推测结果与 OKX/Yahoo 实时行情逐项交叉核对一致

> 完整变更明细见 [CHANGELOG.md](./CHANGELOG.md)

## License

MIT
