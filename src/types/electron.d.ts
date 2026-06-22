/**
 * Type declarations for SnapVision — flat stock result format
 */

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

/**
 * 结构化股票信息（扁平格式，无 {value, confidence} 嵌套）
 * 不存在的字段为 null
 *
 * v2 新增字段：raw_texts, filtered_texts, ignored_texts,
 *              matched_stock_code, matched_stock_name,
 *              overall_confidence, has_stock_data,
 *              low_confidence_warning, confidence_warnings,
 *              analysis_summary, debug_info
 */
export interface StockParseResult {
  success: boolean;
  error?: string;
  stock_name: string | null;
  stock_code: string | null;
  current_price: string | null;
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

  // ── v4.0 识别来源 + 价格增强字段 ──
  /** AI 增强分析是否已启用并成功 */
  ai_enhanced?: boolean;
  /** 识别来源: 'paddle_ocr' | 'ai_enhanced' | 'api_corrected' */
  recognition_source?: string;
  /** 价格数据来源: 'vision_ai' | 'api_corrected' | 'suspect' */
  price_source?: string;
  /** OCR 原始识别价格（未校正前） */
  price_original?: number | null;
  /** 校正后的价格（API校正后） */
  price_corrected?: number | null;
  /** 价格提示信息 */
  price_message?: string;
  /** 调试模式下的原始 OCR 文本（v1 兼容） */
  _raw_ocr_texts?: string[];
  _ocr_meta?: {
    line_count: number;
    ocr_ms: number;
    total_ms: number;
    /** v2 新增 */
    raw_line_count?: number;
    roi_kept_count?: number;
    roi_ignored_count?: number;
    roi_ms?: number;
    parse_ms?: number;
    filter_ms?: number;
  };

  // ── v2 增强字段 ──

  /** ROI 过滤前的全部 OCR 文本 */
  raw_texts?: string[];
  /** 过滤后保留的文本（用于解析） */
  filtered_texts?: string[];
  /** ROI 区域外被忽略的文本 */
  ignored_texts?: string[];
  /** 匹配到的股票代码 */
  matched_stock_code?: string | null;
  /** 匹配到的股票名称 */
  matched_stock_name?: string | null;
  /** 整体置信度 (0.0–1.0) */
  overall_confidence?: number;
  /** 是否提取到有效股票数据 */
  has_stock_data?: boolean;
  /** 是否触发低置信度警告 */
  low_confidence_warning?: boolean;
  /** 置信度警告详情 */
  confidence_warnings?: string[];
  /** AI 分析摘要 */
  analysis_summary?: string | null;

  /** filterStockInfo 简化输出（v3.0） */
  _filtered_result?: {
    error?: string;
    code?: string | null;
    market?: string | null;
    name?: string | null;
    price?: number;
    change_pct?: string;
    change_amt?: string;
    open?: number;
    prev_close?: number;
    high?: number;
    low?: number;
    volume?: number;
    turnover?: number;
    turnover_rate?: string;
    pe?: number;
    pb?: number;
    amplitude?: string;
    volume_ratio?: number;
    total_market_cap?: number;
    circulating_market_cap?: number;
  };

  /** 完整调试信息（仅在 debug=true 时返回） */
  debug_info?: {
    pipeline_version: string;
    total_elapsed_ms: number;
    raw_ocr: {
      texts: string[];
      line_count: number;
      confidence: number | null;
      line_confidences: number[];
    };
    screenshot_type: Record<string, unknown>;
    filter: {
      kept_texts: string[];
      kept_count: number;
      removed_count: number;
      removed_items: Array<{ text: string; reason: string; category: string }>;
      compression_ratio: number;
    };
    field_extractions: Array<{
      field: string;
      value: unknown;
      method: string;
      source_line_index: number | null;
      source_line_text: string | null;
      intermediate: unknown;
    }>;
    final_json: Record<string, unknown>;
    roi_lines?: Array<{
      text: string;
      y_center: number;
      y_ratio: number;
      confidence: number;
      kept: boolean;
      zone?: string;
    }>;
    _roi?: {
      top_pct: number;
      bottom_pct: number;
      kept_count: number;
      ignored_count: number;
    };
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

// ─── Limit Analysis Types ──────────────────────────────────

export interface STStatus {
  is_st: boolean;
  is_sst: boolean;
  st_type: 'ST' | '*ST' | null;
  limit_pct: number;
  risk_warning: string;
}

export interface LimitUpDown {
  change_pct: number | null;
  is_limit_up: boolean;
  is_limit_down: boolean;
  limit_up_price: number | null;
  limit_down_price: number | null;
  distance_to_limit_up: number | null;
  distance_to_limit_down: number | null;
  distance_to_limit_up_pct: number | null;
  limit_type_label: string;
}

export interface ConsecutiveBoards {
  count: number;
  label: string;
  can_confirm: boolean;
  message: string;
}

export interface BreakoutRisk {
  level: '极低' | '较低' | '中等' | '较高' | '极高';
  score: number;
  explanation: string;
}

export interface LimitAnalysisResult {
  st_status: STStatus;
  limit: LimitUpDown;
  consecutive: ConsecutiveBoards;
  breakout: BreakoutRisk;
  summary: string;
}

export interface HistoryListParams {
  search?: string;
  sort?: 'created_at_desc' | 'created_at_asc';
  page?: number;
  page_size?: number;
}

export interface HistoryListResult {
  success: boolean;
  items: HistoryRecord[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
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
  historyDetail: (id: number) => Promise<{ success: boolean; record: HistoryRecord }>;
  historyDelete: (id: number) => Promise<{ ok: boolean }>;
  historyClear: () => Promise<{ ok: boolean; deleted: number }>;
  historyExport: (id: number, format: string) => Promise<{ ok: boolean; path?: string; cancelled?: boolean; error?: string }>;
  historySave: (params: HistorySaveParams) => Promise<HistorySaveResult>;
  retryOcr: () => Promise<{ ok: boolean; error?: string }>;
  marketFetch: (stockCode: string) => Promise<MarketDataResult>;
  realtimeQuote: (code: string) => Promise<RealtimeQuote>;
  fetchQuote: (code: string) => Promise<RealtimeQuote>;
  klineData: (code: string, period: string, count: number) => Promise<KlineResult>;
  fetchKline: (code: string, period: string, count: number) => Promise<KlineResult>;
  searchStock: (keyword: string) => Promise<SearchResult>;
  aiAnalysis: (params: AiAnalysisRequest) => Promise<AiAnalysisResult>;
  limitAnalysis: (stockCode: string) => Promise<{ success: boolean } & Record<string, unknown>>;
  /** 导出分析报告到 Markdown 文件 */
  exportReport: (params: { stock_code: string; stock_name: string; content: string }) => Promise<{ ok: boolean; path?: string; error?: string }>;
}

// ─── Candle Pattern Types ──────────────────────────────────────

export interface CandlePattern {
  name: string;      // Chinese name, e.g. "十字星"
  type: string;      // English identifier, e.g. "doji"
  signal: 'bullish' | 'bearish' | 'neutral';
  desc: string;      // Chinese description
}

export interface CandlePatternAnalysis {
  patterns: CandlePattern[];
  summary: string;   // buildPatternSummary() output
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
