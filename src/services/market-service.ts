/**
 * Market Data Service — 渲染进程侧实时行情 API 封装
 *
 * 通过 IPC 调用主进程的 market:fetch / stockapi:* handlers。
 * 纯转发层，无业务逻辑。
 */

import type {
  MarketDataResult,
  RealtimeQuote,
  KlineResult,
  SearchResult,
  AiAnalysisRequest,
  AiAnalysisResult,
} from '../types/electron';

/**
 * 获取股票实时行情数据 (旧版 /market-data 接口)
 *
 * @param stockCode 带市场前缀的股票代码，例如 'SZ002851'、'SH600036'
 * @returns 统一结构化行情数据。检查 `available` 字段判断是否成功。
 */
export async function fetchMarketData(stockCode: string): Promise<MarketDataResult> {
  return window.electronAPI.marketFetch(stockCode);
}

/**
 * 获取实时报价 (新版 StockAPI)
 * 自动判断沪深前缀，支持新浪/腾讯/东方财富三级 fallback
 *
 * @param code 股票代码，如 '600519' 或 'SH600519'
 */
export async function getRealtimeQuote(code: string): Promise<RealtimeQuote> {
  return window.electronAPI.realtimeQuote(code);
}

/**
 * 通过腾讯接口获取实时报价（绕过新浪 Forbidden 问题）
 * 由 Electron 主进程直接请求 qt.gtimg.cn，解析 ~ 分隔的完整字段。
 *
 * 相比 getRealtimeQuote，此方法：
 *   1. 不走 Flask 后端，响应更快
 *   2. 包含完整的换手率/市盈率/市净率字段
 *   3. 不受新浪 API 封禁影响
 *
 * @param code 股票代码，支持 '600519'、'SZ002241'、'sh600519' 等格式
 */
export async function getTencentQuote(code: string): Promise<RealtimeQuote> {
  return window.electronAPI.fetchQuote(code);
}

/**
 * 获取 K 线数据
 *
 * @param code 股票代码
 * @param period K线周期: daily | weekly | monthly | 5min | 15min | 30min | 60min
 * @param count 获取条数，默认 30
 */
export async function getKlineData(
  code: string,
  period: string = 'daily',
  count: number = 30,
): Promise<KlineResult> {
  return window.electronAPI.fetchKline(code, period, count);
}

/**
 * 获取 K 线数据（支持 klt 数字周期码 + 字符串周期名）
 *
 * klt 对照：101=日K, 102=周K, 103=月K, 5=5分, 15=15分, 30=30分, 60=60分
 *
 * @param code   股票代码
 * @param klt    周期码（数字或字符串），默认 101（日K）
 * @param count  获取条数，默认 120
 */
export async function fetchKlineData(
  code: string,
  klt: number | string = 101,
  count: number = 120,
): Promise<KlineResult> {
  const kltMap: Record<number, string> = {
    101: 'daily', 102: 'weekly', 103: 'monthly',
    5: '5min', 15: '15min', 30: '30min', 60: '60min',
  };
  const period = typeof klt === 'number' ? (kltMap[klt] || 'daily') : klt;
  return window.electronAPI.fetchKline(code, period, count);
}

/**
 * 模糊搜索股票
 *
 * @param keyword 搜索关键词（代码或名称），如 '茅台'、'600519'
 */
export async function searchStock(keyword: string): Promise<SearchResult> {
  return window.electronAPI.searchStock(keyword);
}

/**
 * AI 行情分析 — 调用 DeepSeek API 生成中文分析报告
 *
 * @param params 股票信息 + K线数据
 * @returns AI 分析结果
 */
export async function getAiAnalysis(params: AiAnalysisRequest): Promise<AiAnalysisResult> {
  return window.electronAPI.aiAnalysis(params);
}
