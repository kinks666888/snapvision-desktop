# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 规范，版本号遵循语义化版本。

## [v0.1.0] - 2026-11-11

首个正式版 —— 截图识别与市场推测全链路。

### Added（新增）

- **加密货币市场推测模式**
  - 识别 OKX/币安等交易所截图（永续合约、杠杆、资金费率、多空比特征）
  - 多源行情 fallback：OKX → Binance → CoinGecko
  - 情绪数据：资金费率、多空比、恐慌贪婪指数（alternative.me）
- **美股市场推测模式**
  - 识别雪球/富途/moomoo/老虎/TradingView 等平台截图，支持 `(NASDAQ:CODE)` 交易所标签格式
  - Yahoo Finance 主源 + Stooq 兜底；VIX 恐慌指数映射恐慌贪婪 0-100
  - 盘前/盘中/盘后/休市四态显示（美东时间），52周区间可视化
- **五因子市场推测引擎**（三市场共用）
  - 趋势 30%（MA20/MA50 排列）/ 动量 25%（RSI、MACD）/ 情绪 20% / 量能 15% / 波动 10%（ATR）
  - 输出：方向、多空概率、支撑/压力位、止损/目标价、盈亏比、风险评级
- **A股/加密/美股三级自动分流**：`/stock-extract` 一条链路自动判定市场类型
- 历史记录（三市场统一入库）、分析报告导出
- 全屏/窗口双布局自适应（≥1280px 三栏布局）
- 一键启动脚本 `start.sh`（内置行情代理配置）

### Fixed（修复，实测问题闭环）

- 识别精度：侧栏列表项抢占主图标的 → 空间锚点投票（bbox 距离加权）
- 数值提取：现价误抓侧栏市值/盘口杂数 → `$` 大字现价与"最新"标签优先
- 涨跌幅误抓资金费率/振幅 → 涨跌额连排格式与现价同行优先
- 平票排序误选 → 稳定排序 + 数值合理性校验
- 伪成功问题：识别/行情失败时显式报错，禁止空值伪装成功
- 网络连通：OKX/Yahoo 行情支持 `SNAPVISION_PROXY` 环境变量走系统代理
- UI：全屏模式设置面板无法打开；全屏/窗口内容不一致
- OCR 噪声容错（"52周"误识为"52□"仍可解析）

### Security（安全）

- 标的代码归一化：先校验原始形态再转换，防 URL 参数注入
- `.gitignore` 全面覆盖：venv/node_modules/缓存/数据库/密钥文件不入库
- 清理历史遗留的 `__pycache__` 编译产物与运行时数据库

### Quality（质量）

- 后端 175 项单测（含真实用户截图回归用例）
- 前端 36 项 vitest + TypeScript 严格检查
- 推测结果与 OKX/Yahoo 实时行情逐项交叉核对一致（价格偏差 <0.05%，支撑压力与30日高低点分毫不差）

[Unreleased]: https://github.com/kinks666888/snapvision-desktop/compare/v0.1.0...HEAD
[v0.1.0]: https://github.com/kinks666888/snapvision-desktop/releases/tag/v0.1.0
