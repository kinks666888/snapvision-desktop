/**
 * US Stock Service — 美股市场推测模式 渲染进程服务层
 *
 * 通过 IPC 调用主进程 usstock:* handlers, 纯转发, 无业务逻辑。
 */

import type {
  UsStockQuoteResult,
  UsStockSentimentResult,
  UsStockSpeculationResult,
  KlineResult,
} from '../types/electron';

/**
 * 美股实时行情 (含盘前/盘中/盘后状态、52周高低、VIX 情绪)
 *
 * @param symbol 股票代码: 'AAPL', '$TSLA', 'BRK.A' 均可
 */
export async function getUsStockQuote(symbol: string): Promise<UsStockQuoteResult> {
  return window.electronAPI.usStockQuote(symbol);
}

/**
 * 美股 K 线数据
 *
 * @param symbol 股票代码
 * @param period 周期: 5min | 15min | 30min | 60min | daily | weekly | monthly
 * @param count  条数, 默认 60
 */
export async function getUsStockKline(
  symbol: string,
  period: string = 'daily',
  count: number = 60,
): Promise<KlineResult> {
  return window.electronAPI.usStockKline(symbol, period, count);
}

/**
 * 美股市场情绪: VIX 恐慌指数 + 交易时段
 */
export async function getUsStockSentiment(symbol: string): Promise<UsStockSentimentResult> {
  return window.electronAPI.usStockSentiment(symbol);
}

/**
 * 美股市场推测 — 核心接口
 *
 * 后端拉取 K 线 + 行情, 多因子推测引擎输出多空研判 (与加密模式同引擎)。
 *
 * @param symbol 股票代码
 * @param period 周期, 默认 daily
 * @param count  K 线条数, 默认 60
 */
export async function getUsStockSpeculation(
  symbol: string,
  period: string = 'daily',
  count: number = 60,
): Promise<UsStockSpeculationResult> {
  return window.electronAPI.usStockSpeculate(symbol, period, count);
}

/**
 * 美股代码搜索
 */
export async function searchUsStock(keyword: string) {
  return window.electronAPI.usStockSearch(keyword);
}
