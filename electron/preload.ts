/**
 * Preload — 通过 contextBridge 暴露安全的 IPC 接口给渲染进程
 */

import { contextBridge, ipcRenderer } from 'electron';

export interface OcrResult {
  success: boolean;
  text: string;
  texts: string[];
  confidence: number;
  elapsed_ms: number;
}

export interface OcrStatus {
  status: 'ok' | 'loading' | 'error' | 'stopped';
  ready: boolean;
  message: string;
}

export interface StockParseResult {
  success: boolean;
  stock_name: string | null;
  stock_code: string | null;
  current_price: string | null;
  ai_enhanced?: boolean;
  change_percent: string | null;
  change_amount: string | null;
  open: string | null;
  high: string | null;
  low: string | null;
  volume: string | null;
  turnover: string | null;
  turnover_rate: string | null;
  pe: string | null;
  pb: string | null;
  _raw_ocr_texts?: string[];
  _ocr_meta?: {
    line_count: number;
    ocr_ms: number;
    total_ms: number;
  };
}

// ─── History Types ────────────────────────────────────────────

export interface HistoryRecord {
  id: number;
  created_at: string;
  updated_at: string;
  image_path: string;
  image_hash: string;
  analysis_type: string;
  stock_name: string | null;
  stock_code: string | null;
  structured_json: string;
  ai_summary: string | null;
  raw_ocr_text: string | null;
  app_version: string;
  summary_preview?: string;
}

export interface HistoryListParams {
  search?: string;
  sort?: 'created_at_desc' | 'created_at_asc';
  page?: number;
  page_size?: number;
}

export interface HistorySaveParams {
  image_path: string;
  stock_code: string;
  stock_name: string;
  current_price?: string | null;
  change_percent?: string | null;
  change_amount?: string | null;
  open?: string | null;
  high?: string | null;
  low?: string | null;
  volume?: string | null;
  turnover?: string | null;
  ai_score?: number | null;
  risk_level?: string | null;
  analysis_summary?: string | null;
  raw_ocr_text?: string | null;
  source?: string | null;
}

export interface HistorySaveResult {
  success: boolean;
  id: number;
  is_new: boolean;
  error?: string;
}

export interface MarketDataResult {
  success: boolean;
  stock_name: string | null;
  stock_code: string | null;
  current_price: number | null;
  change_percent: number | null;
  change_amount: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: string | null;
  turnover: string | null;
  turnover_rate: number | null;
  source: string;
  available: boolean;
  message?: string;
}

// ─── StockAPI Types ───────────────────────────────────────────

export interface RealtimeQuote {
  success: boolean;
  error?: string;
  code: string;
  name: string | null;
  price: number | null;
  change_pct: number | null;
  change_amt: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  prev_close: number | null;
  volume: string | null;
  turnover: string | null;
  turnover_rate: number | null;
  pe: number | null;
  pb: number | null;
  amplitude: number | null;
  total_market_cap: string | null;
  circulating_market_cap: string | null;
  source: string;
  trading: boolean;
  update_time: string;
}

export interface KlineBar {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  turnover: number;
}

export interface KlineResult {
  success: boolean;
  error?: string;
  code: string;
  period: string;
  count: number;
  bars: KlineBar[];
}

export interface SearchResultItem {
  code: string;
  name: string;
  market: string;
}

export interface SearchResult {
  success: boolean;
  error?: string;
  keyword: string;
  results: SearchResultItem[];
}

// ─── AI Analysis Types ──────────────────────────────────────

export interface AiAnalysisRequest {
  stock_name: string;
  stock_code: string;
  price: number | string;
  change_pct: string;
  kline_bars: Array<{
    time: string; open: number; high: number; low: number; close: number; volume: number;
  }>;
}

export interface AiAnalysisResult {
  success: boolean;
  error?: string;
  stock_code: string;
  stock_name: string;
  analysis: string;
  elapsed_ms?: number;
}

export interface HistoryListResult {
  success: boolean;
  items: HistoryRecord[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface HistoryDetailResult {
  success: boolean;
  record: HistoryRecord;
}

// ─── Crypto Types (加密货币推测模式) ─────────────────────────

export interface CryptoQuoteResult {
  success: boolean;
  error?: string;
  symbol: string;
  price: number | null;
  change_pct: number | null;
  change_amt: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  turnover: number | null;
  funding_rate?: number | null;
  long_short?: { long_pct: number; short_pct: number; ratio: number | null } | null;
  open_interest?: number | null;
  fear_greed?: { value: number; label: string } | null;
  source: string;
  update_time?: string;
}

export interface CryptoKlineResult {
  success: boolean;
  error?: string;
  symbol: string;
  period: string;
  count: number;
  bars: KlineBar[];
}

export interface CryptoSentimentResult {
  success: boolean;
  error?: string;
  symbol: string;
  funding_rate: number | null;
  long_short: { long_pct: number; short_pct: number; ratio: number | null } | null;
  fear_greed: { value: number; label: string } | null;
}

export interface CryptoFactor {
  key: string;
  name: string;
  weight: number;
  score: number;
  detail: string;
}

// ─── US Stock Types (美股推测模式) ────────────────────────────

export interface UsMarketState {
  state: 'pre' | 'regular' | 'post' | 'closed';
  label: string;
  et_time: string;
}

export interface UsStockQuoteResult {
  success: boolean;
  error?: string;
  symbol: string;
  name: string | null;
  exchange: string | null;
  price: number | null;
  change_pct: number | null;
  change_amt: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  prev_close: number | null;
  volume: number | null;
  turnover: number | null;
  high_52w: number | null;
  low_52w: number | null;
  fear_greed?: { value: number; label: string; vix?: number } | null;
  market_state?: UsMarketState;
  source: string;
}

export interface UsStockSentimentResult {
  success: boolean;
  error?: string;
  symbol: string;
  fear_greed: { value: number; label: string; vix?: number } | null;
  vix: number | null;
  market_state: UsMarketState;
}

export interface UsStockSpeculationResult {
  success: boolean;
  error?: string;
  market?: string;
  symbol: string;
  direction: 'bullish' | 'bearish' | 'neutral';
  direction_label: string;
  score: number;
  confidence: number;
  probabilities: { up: number; down: number; range: number };
  factors: CryptoFactor[];
  key_levels: {
    support: number;
    resistance: number;
    stop_loss: number;
    target1: number;
    target2: number;
    risk_reward: number | null;
  };
  risk: { level: string; volatility_pct: number | null; warnings: string[] };
  summary: string;
  disclaimer: string;
}

export interface CryptoSpeculationResult {
  success: boolean;
  error?: string;
  symbol: string;
  direction: 'bullish' | 'bearish' | 'neutral';
  direction_label: string;
  score: number;
  confidence: number;
  probabilities: { up: number; down: number; range: number };
  factors: CryptoFactor[];
  key_levels: {
    support: number;
    resistance: number;
    stop_loss: number;
    target1: number;
    target2: number;
    risk_reward: number | null;
  };
  risk: { level: string; volatility_pct: number | null; warnings: string[] };
  summary: string;
  disclaimer: string;
}

export interface ElectronAPI {
  ocrRecognize: (imagePath: string) => Promise<OcrResult>;
  ocrHealth: () => Promise<OcrStatus>;
  onOcrStatusChange: (callback: (status: OcrStatus) => void) => () => void;
  stockExtract: (imagePath: string) => Promise<StockParseResult>;
  stockExtractBase64: (base64: string) => Promise<StockParseResult>;
  selectImageFile: () => Promise<string | null>;
  readImageFile: (imagePath: string) => Promise<string>;
  getOcrServerPath: () => Promise<string>;
  historyList: (params: HistoryListParams) => Promise<HistoryListResult>;
  historyDetail: (id: number) => Promise<HistoryDetailResult>;
  historyDelete: (id: number) => Promise<{ ok: boolean }>;
  historyClear: () => Promise<{ ok: boolean; deleted: number }>;
  historyExport: (id: number, format: string) => Promise<{ ok: boolean; path?: string; cancelled?: boolean; error?: string }>;
  historySave: (params: HistorySaveParams) => Promise<HistorySaveResult>;
  retryOcr: () => Promise<{ ok: boolean; error?: string }>;
  marketFetch: (stockCode: string) => Promise<MarketDataResult>;
  /** StockAPI: 获取实时行情 */
  realtimeQuote: (code: string) => Promise<RealtimeQuote>;
  /** 通过腾讯接口获取实时行情（绕过新浪 Forbidden） */
  fetchQuote: (code: string) => Promise<RealtimeQuote>;
  /** StockAPI: 获取 K 线数据 */
  klineData: (code: string, period: string, count: number) => Promise<KlineResult>;
  /** K线数据（绕过 CORS，通过主进程直接请求新浪 API） */
  fetchKline: (code: string, period: string, count: number) => Promise<KlineResult>;
  /** StockAPI: 模糊搜索股票 */
  searchStock: (keyword: string) => Promise<SearchResult>;
  /** StockAPI: AI 行情分析 */
  aiAnalysis: (params: AiAnalysisRequest) => Promise<AiAnalysisResult>;
  /** Limit Analysis: 涨跌停检测 / 连板统计 / ST 风险 / 炸板风险 */
  limitAnalysis: (stockCode: string) => Promise<{ success: boolean } & Record<string, unknown>>;
  /** 导出分析报告到 Markdown 文件 */
  exportReport: (params: { stock_code: string; stock_name: string; content: string }) => Promise<{ ok: boolean; path?: string; error?: string }>;

  // ─── Crypto (加密货币推测模式) ────────────────────────────
  cryptoQuote: (symbol: string) => Promise<CryptoQuoteResult>;
  cryptoKline: (symbol: string, period?: string, count?: number) => Promise<CryptoKlineResult>;
  cryptoSentiment: (symbol: string) => Promise<CryptoSentimentResult>;
  cryptoSpeculate: (symbol: string, period?: string, count?: number) => Promise<CryptoSpeculationResult>;
  cryptoSearch: (keyword: string) => Promise<{ success: boolean; results: Array<{ symbol: string; base: string; quote: string; name?: string }> }>;

  // ─── US Stock (美股推测模式) ──────────────────────────────
  usStockQuote: (symbol: string) => Promise<UsStockQuoteResult>;
  usStockKline: (symbol: string, period?: string, count?: number) => Promise<CryptoKlineResult>;
  usStockSentiment: (symbol: string) => Promise<UsStockSentimentResult>;
  usStockSpeculate: (symbol: string, period?: string, count?: number) => Promise<UsStockSpeculationResult>;
  usStockSearch: (keyword: string) => Promise<{ success: boolean; results: Array<{ symbol: string; name?: string | null; exchange?: string | null }> }>;
}

contextBridge.exposeInMainWorld('electronAPI', {
  ocrRecognize: (imagePath: string) =>
    ipcRenderer.invoke('ocr:recognize', imagePath),

  stockExtract: (imagePath: string) =>
    ipcRenderer.invoke('stock:extract', imagePath),

  stockExtractBase64: (base64: string) =>
    ipcRenderer.invoke('stock:extract-base64', base64),

  ocrHealth: () => ipcRenderer.invoke('ocr:health'),

  onOcrStatusChange: (callback: (status: OcrStatus) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: OcrStatus) =>
      callback(status);
    ipcRenderer.on('ocr:status-change', handler);
    return () => ipcRenderer.removeListener('ocr:status-change', handler);
  },

  selectImageFile: () => ipcRenderer.invoke('dialog:select-image'),
  readImageFile: (imagePath: string) => ipcRenderer.invoke('app:read-image', imagePath),
  getOcrServerPath: () => ipcRenderer.invoke('app:ocr-server-path'),

  // History
  historyList: (params) => ipcRenderer.invoke('history:list', params),
  historyDetail: (id: number) => ipcRenderer.invoke('history:detail', id),
  historyDelete: (id: number) => ipcRenderer.invoke('history:delete', id),
  historyClear: () => ipcRenderer.invoke('history:clear'),
  historyExport: (id: number, format: string) => ipcRenderer.invoke('history:export', id, format),
  historySave: (params) => ipcRenderer.invoke('history:save', params),

  retryOcr: () => ipcRenderer.invoke('ocr:retry'),

  marketFetch: (stockCode: string) => ipcRenderer.invoke('market:fetch', stockCode),

  // StockAPI
  realtimeQuote: (code: string) => ipcRenderer.invoke('stockapi:realtime', code),
  fetchQuote: (code: string) => ipcRenderer.invoke('fetch-quote', code),
  klineData: (code: string, period: string, count: number) =>
    ipcRenderer.invoke('stockapi:kline', code, period, count),
  fetchKline: (code: string, period: string, count: number) =>
    ipcRenderer.invoke('fetch-kline', code, period, count),
  searchStock: (keyword: string) => ipcRenderer.invoke('stockapi:search', keyword),

  // AI Analysis
  aiAnalysis: (params: AiAnalysisRequest) => ipcRenderer.invoke('stockapi:ai-analysis', params),

  // Limit Analysis
  limitAnalysis: (stockCode: string) => ipcRenderer.invoke('stock:limit-analysis', stockCode),

  // Export
  exportReport: (params: { stock_code: string; stock_name: string; content: string }) =>
    ipcRenderer.invoke('app:export-report', params),

  // Crypto (加密货币推测模式)
  cryptoQuote: (symbol: string) => ipcRenderer.invoke('crypto:quote', symbol),
  cryptoKline: (symbol: string, period?: string, count?: number) =>
    ipcRenderer.invoke('crypto:kline', symbol, period, count),
  cryptoSentiment: (symbol: string) => ipcRenderer.invoke('crypto:sentiment', symbol),
  cryptoSpeculate: (symbol: string, period?: string, count?: number) =>
    ipcRenderer.invoke('crypto:speculate', symbol, period, count),
  cryptoSearch: (keyword: string) => ipcRenderer.invoke('crypto:search', keyword),

  // US Stock (美股推测模式)
  usStockQuote: (symbol: string) => ipcRenderer.invoke('usstock:quote', symbol),
  usStockKline: (symbol: string, period?: string, count?: number) =>
    ipcRenderer.invoke('usstock:kline', symbol, period, count),
  usStockSentiment: (symbol: string) => ipcRenderer.invoke('usstock:sentiment', symbol),
  usStockSpeculate: (symbol: string, period?: string, count?: number) =>
    ipcRenderer.invoke('usstock:speculate', symbol, period, count),
  usStockSearch: (keyword: string) => ipcRenderer.invoke('usstock:search', keyword),
} satisfies ElectronAPI);
