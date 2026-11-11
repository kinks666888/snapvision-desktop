/**
 * Crypto Service — 加密货币市场推测模式 渲染进程服务层
 *
 * 通过 IPC 调用主进程 crypto:* handlers, 纯转发, 无业务逻辑。
 */

import type {
  CryptoQuoteResult,
  CryptoSentimentResult,
  CryptoSpeculationResult,
  KlineResult,
} from '../types/electron';

/**
 * 加密货币实时行情 (含资金费率 / 多空比 / 恐慌贪婪指数)
 *
 * @param symbol 币种或交易对: 'BTC', 'ETH', 'BTCUSDT', 'btc-usdt' 均可
 */
export async function getCryptoQuote(symbol: string): Promise<CryptoQuoteResult> {
  return window.electronAPI.cryptoQuote(symbol);
}

/**
 * 加密货币 K 线数据
 *
 * @param symbol 币种或交易对
 * @param period 周期: 1min | 5min | 15min | 30min | 60min | 4hour | daily | weekly
 * @param count  条数, 默认 60
 */
export async function getCryptoKline(
  symbol: string,
  period: string = 'daily',
  count: number = 60,
): Promise<KlineResult> {
  return window.electronAPI.cryptoKline(symbol, period, count);
}

/**
 * 加密市场情绪: 资金费率 + 多空比 + 恐慌贪婪指数
 */
export async function getCryptoSentiment(symbol: string): Promise<CryptoSentimentResult> {
  return window.electronAPI.cryptoSentiment(symbol);
}

/**
 * 加密货币市场推测 — 核心接口
 *
 * 后端拉取 K 线 + 行情, 多因子推测引擎输出多空研判。
 *
 * @param symbol 币种或交易对
 * @param period 周期, 默认 daily
 * @param count  K 线条数, 默认 60
 */
export async function getCryptoSpeculation(
  symbol: string,
  period: string = 'daily',
  count: number = 60,
): Promise<CryptoSpeculationResult> {
  return window.electronAPI.cryptoSpeculate(symbol, period, count);
}

/**
 * 币种搜索
 */
export async function searchCrypto(keyword: string) {
  return window.electronAPI.cryptoSearch(keyword);
}
