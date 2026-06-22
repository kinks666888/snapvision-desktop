/**
 * OCR Client — 独立的 OCR 服务调用模块
 *
 * 职责：与本地 OCR Flask 服务 (ocr_server.py :5002) 通信
 */

import http from 'node:http';

// ─── Helpers ───────────────────────────────────────────────────

function getBaseUrl(): string {
  const host = process.env.OCR_HOST || '127.0.0.1';
  const port = process.env.OCR_PORT || '5002';
  return `http://${host}:${port}`;
}

// ─── Types ────────────────────────────────────────────────────

export interface OcrResult {
  success: boolean;
  text: string;
  texts: string[];
  confidence: number;
  elapsed_ms: number;
}

export interface OcrError {
  success: false;
  error: string;
}

export interface HealthStatus {
  status: 'ok' | 'loading' | 'error';
  ocr_loaded: boolean;
  ready: boolean;
  uptime_sec?: number;
}

/** 扁平结构化股票结果 */
export interface StockParseResult {
  success: boolean;
  error?: string;
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

export interface StockParseError {
  success: false;
  error: string;
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

// ─── HTTP helpers ─────────────────────────────────────────────

function jsonGet<T>(url: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: 3000 }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(body) as T); }
        catch { reject(new Error(`Invalid JSON from ${url}: ${body.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error(`Request timeout: ${url}`)); });
  });
}

function jsonPost<T>(url: string, data: unknown, timeoutMs: number = 180000, label: string = 'request'): Promise<T> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const req = http.request(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': String(Buffer.byteLength(body)),
        },
        timeout: timeoutMs,
      },
      (res) => {
        let respBody = '';
        res.on('data', (chunk) => (respBody += chunk));
        res.on('end', () => {
          try { resolve(JSON.parse(respBody) as T); }
          catch { reject(new Error(`Invalid JSON response: ${respBody.slice(0, 200)}`)); }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`OCR ${label} timeout (${timeoutMs / 1000}s)`));
    });
    req.write(body);
    req.end();
  });
}

function jsonDelete<T>(url: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      url,
      {
        method: 'DELETE',
        timeout: 5000,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try { resolve(JSON.parse(body) as T); }
          catch { reject(new Error(`Invalid JSON from ${url}: ${body.slice(0, 200)}`)); }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error(`Request timeout: ${url}`)); });
    req.end();
  });
}

function jsonGetRaw(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: 10000 }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error(`Request timeout: ${url}`)); });
  });
}

// ─── Public API ───────────────────────────────────────────────

export async function checkHealth(): Promise<HealthStatus> {
  return jsonGet<HealthStatus>(`${getBaseUrl()}/health`);
}

/**
 * Wait for OCR model to be loaded (old behavior — checks model===loaded).
 * @deprecated Use waitForReady() which checks both service reachability and ready flag.
 */
export function waitForModel(maxAttempts = 60, intervalMs = 1000): Promise<void> {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const poll = () => {
      attempts++;
      checkHealth()
        .then((status) => {
          if (status.ready) resolve();
          else if (attempts < maxAttempts) setTimeout(poll, intervalMs);
          else reject(new Error(`OCR model not loaded after ${maxAttempts}s`));
        })
        .catch(() => {
          if (attempts < maxAttempts) setTimeout(poll, intervalMs);
          else reject(new Error(`OCR service unreachable after ${maxAttempts}s`));
        });
    };
    poll();
  });
}

/**
 * Wait for OCR service to be fully ready (model loaded + HTTP accepting requests).
 * Polls GET /health until ready===true.
 *
 * @param maxAttempts  Max number of poll attempts (default 600 = 10 min at 1s interval)
 * @param intervalMs   Poll interval in ms (default 1000)
 */
export function waitForReady(maxAttempts = 600, intervalMs = 1000): Promise<void> {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const poll = () => {
      attempts++;
      checkHealth()
        .then((status) => {
          if (status.ready) {
            console.log(`[OCR Client] Service ready after ~${attempts}s (uptime=${status.uptime_sec}s)`);
            resolve();
          } else if (attempts < maxAttempts) {
            setTimeout(poll, intervalMs);
          } else {
            reject(new Error(`OCR service not ready after ${round(maxAttempts * intervalMs / 1000)}s (last status: ${JSON.stringify(status)})`));
          }
        })
        .catch((err) => {
          if (attempts < maxAttempts) {
            if (attempts % 10 === 0) {
              console.log(`[OCR Client] Waiting for service... (attempt ${attempts}/${maxAttempts})`);
            }
            setTimeout(poll, intervalMs);
          } else {
            reject(new Error(`OCR service unreachable after ${round(maxAttempts * intervalMs / 1000)}s: ${(err as Error).message}`));
          }
        });
    };
    poll();
  });
}

function round(n: number): number {
  return Math.round(n);
}

export async function recognizeImage(imagePath: string): Promise<OcrResult> {
  const t0 = Date.now();
  const url = `${getBaseUrl()}/ocr`;
  console.log(`[OCR Client] → POST ${url} image_path=${imagePath} start=${new Date().toISOString()}`);

  const result = await jsonPost<OcrResult | OcrError>(url, {
    image_path: imagePath,
  }, 180_000, 'ocr');

  const elapsed = Date.now() - t0;
  console.log(`[OCR Client] ← POST ${url} elapsed=${elapsed}ms size=${JSON.stringify(result).length}bytes`);

  if (!result.success) throw new Error((result as OcrError).error || 'OCR recognition failed');
  return result as OcrResult;
}

/**
 * 调用股票提取接口 — OCR + 结构化解析
 * @param imagePath 图片文件绝对路径
 * @returns 扁平结构化股票数据
 */
export async function extractStock(imagePath: string): Promise<StockParseResult> {
  const t0 = Date.now();
  const url = `${getBaseUrl()}/stock-extract`;
  console.log(`[OCR Client] → POST ${url} image_path=${imagePath} start=${new Date().toISOString()}`);

  const result = await jsonPost<StockParseResult | StockParseError>(url, {
    image_path: imagePath,
  }, 180_000, 'stock-extract');

  const elapsed = Date.now() - t0;

  if (!result.success) {
    throw new Error((result as StockParseError).error || 'Stock extraction failed');
  }

  const r = result as StockParseResult;
  console.log(`[OCR Client] ← name=${r.stock_name} code=${r.stock_code} price=${r.current_price} elapsed=${elapsed}ms`);
  return r;
}

/**
 * 传入压缩后的 base64 图片数据（不含 data: URL 前缀）进行股票提取
 */
export async function extractStockBase64(base64: string): Promise<StockParseResult> {
  const t0 = Date.now();
  const url = `${getBaseUrl()}/stock-extract`;
  console.log(`[OCR Client] → POST ${url} image_base64=<base64> start=${new Date().toISOString()}`);

  const result = await jsonPost<StockParseResult | StockParseError>(url, {
    image_base64: base64,
  }, 180_000, 'stock-extract');

  const elapsed = Date.now() - t0;

  if (!result.success) {
    throw new Error((result as StockParseError).error || 'Stock extraction failed');
  }

  const r = result as StockParseResult;
  console.log(`[OCR Client] ← name=${r.stock_name} code=${r.stock_code} price=${r.current_price} elapsed=${elapsed}ms`);
  return r;
}

export async function isServiceRunning(): Promise<boolean> {
  try {
    const status = await checkHealth();
    return status.status === 'ok' || status.status === 'loading';
  } catch { return false; }
}

// ─── History API ──────────────────────────────────────────────

export async function getHistoryList(params: HistoryListParams = {}): Promise<HistoryListResult> {
  const qs = new URLSearchParams();
  if (params.search) qs.set('search', params.search);
  if (params.sort) qs.set('sort', params.sort);
  if (params.page) qs.set('page', String(params.page));
  if (params.page_size) qs.set('page_size', String(params.page_size));
  const query = qs.toString();
  const url = `${getBaseUrl()}/history${query ? '?' + query : ''}`;
  const result = await jsonGet<HistoryListResult>(url);
  if (!result.success) throw new Error('Failed to fetch history list');
  return result;
}

export async function getHistoryDetail(id: number): Promise<HistoryDetailResult> {
  const result = await jsonGet<HistoryDetailResult>(`${getBaseUrl()}/history/${id}`);
  if (!result.success) throw new Error('Failed to fetch history detail');
  return result;
}

export async function deleteHistory(id: number): Promise<void> {
  const result = await jsonDelete<{ success: boolean; error?: string }>(
    `${getBaseUrl()}/history/${id}`
  );
  if (!result.success) throw new Error(result.error || 'Failed to delete history record');
}

export async function clearHistory(): Promise<number> {
  const result = await jsonDelete<{ success: boolean; deleted: number; error?: string }>(
    `${getBaseUrl()}/history`
  );
  if (!result.success) throw new Error(result.error || 'Failed to clear history');
  return result.deleted;
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

/**
 * 前端识别完成后保存历史记录（通过 Python 后端 SQLite）
 */
export async function saveHistory(params: HistorySaveParams): Promise<HistorySaveResult> {
  const result = await jsonPost<HistorySaveResult>(
    `${getBaseUrl()}/history/save`,
    params,
    10_000,
    'history-save',
  );
  if (!result.success) throw new Error(result.error || 'Failed to save history');
  return result;
}

// ─── Market Data Types ──────────────────────────────────────────

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

export async function fetchMarketData(stockCode: string): Promise<MarketDataResult> {
  const t0 = Date.now();
  const url = `${getBaseUrl()}/market-data`;
  console.log(`[OCR Client] → POST ${url} stock_code=${stockCode} start=${new Date().toISOString()}`);

  const result = await jsonPost<MarketDataResult>(url, {
    stock_code: stockCode,
  }, 15_000, 'market-data');

  const elapsed = Date.now() - t0;
  console.log(
    `[OCR Client] ← market-data source=${result.source} available=${result.available} elapsed=${elapsed}ms`,
  );
  return result;
}

// ─── StockAPI Types ────────────────────────────────────────────

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

// ─── StockAPI Functions ────────────────────────────────────────

export async function fetchRealtimeQuote(code: string): Promise<RealtimeQuote> {
  const t0 = Date.now();
  const url = `${getBaseUrl()}/stock-api/realtime`;
  console.log(`[OCR Client] → POST ${url} code=${code}`);

  const result = await jsonPost<RealtimeQuote>(url, { code }, 8_000, 'realtime-quote');

  const elapsed = Date.now() - t0;
  console.log(
    `[OCR Client] ← realtime source=${result.source} price=${result.price} elapsed=${elapsed}ms`,
  );
  return result;
}

export async function fetchKlineData(
  code: string,
  period: string = 'daily',
  count: number = 30,
): Promise<KlineResult> {
  const t0 = Date.now();
  const url = `${getBaseUrl()}/stock-api/kline`;
  console.log(`[OCR Client] → POST ${url} code=${code} period=${period} count=${count}`);

  const result = await jsonPost<KlineResult>(url, {
    code, period, count,
  }, 10_000, 'kline');

  const elapsed = Date.now() - t0;
  console.log(
    `[OCR Client] ← kline bars=${result.bars?.length ?? 0} elapsed=${elapsed}ms`,
  );
  return result;
}

export async function searchStock(keyword: string): Promise<SearchResult> {
  const t0 = Date.now();
  const url = `${getBaseUrl()}/stock-api/search`;
  console.log(`[OCR Client] → POST ${url} keyword=${keyword}`);

  const result = await jsonPost<SearchResult>(url, { keyword }, 8_000, 'stock-search');

  const elapsed = Date.now() - t0;
  console.log(
    `[OCR Client] ← search results=${result.results?.length ?? 0} elapsed=${elapsed}ms`,
  );
  return result;
}

export async function exportHistory(id: number, format: 'md' | 'json' | 'txt' = 'md'): Promise<string> {
  const content = await jsonGetRaw(`${getBaseUrl()}/history/${id}/export?format=${format}`);
  return content;
}

// ─── AI Analysis Types ─────────────────────────────────────────

export interface AiAnalysisRequest {
  stock_name: string;
  stock_code: string;
  price: number | string;
  change_pct: string;
  kline_bars: Array<{
    time: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
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

// ─── Limit Analysis Types ─────────────────────────────────────

export interface LimitAnalysisResponse {
  success: boolean;
  error?: string;
  st_status?: {
    is_st: boolean;
    is_sst: boolean;
    st_type: string | null;
    limit_pct: number;
    risk_warning: string;
  };
  limit?: {
    change_pct: number | null;
    is_limit_up: boolean;
    is_limit_down: boolean;
    limit_up_price: number | null;
    limit_down_price: number | null;
    distance_to_limit_up: number | null;
    distance_to_limit_down: number | null;
    distance_to_limit_up_pct: number | null;
    limit_type_label: string;
  };
  consecutive?: {
    count: number;
    label: string;
    can_confirm: boolean;
    message: string;
  };
  breakout?: {
    level: string;
    score: number;
    explanation: string;
  };
  summary?: string;
}

export async function fetchLimitAnalysis(stockCode: string): Promise<LimitAnalysisResponse> {
  const t0 = Date.now();
  const url = `${getBaseUrl()}/stock-analysis`;
  console.log(`[OCR Client] → POST ${url} stock_code=${stockCode}`);

  const result = await jsonPost<LimitAnalysisResponse>(url, {
    stock_code: stockCode,
  }, 10_000, 'limit-analysis');

  const elapsed = Date.now() - t0;
  console.log(`[OCR Client] ← limit-analysis elapsed=${elapsed}ms`);
  return result;
}

export async function fetchAiAnalysis(params: AiAnalysisRequest): Promise<AiAnalysisResult> {
  const t0 = Date.now();
  const url = `${getBaseUrl()}/stock-api/ai-analysis`;
  console.log(`[OCR Client] → POST ${url} stock=${params.stock_code}`);

  const result = await jsonPost<AiAnalysisResult>(url, params, 45_000, 'ai-analysis');

  const elapsed = Date.now() - t0;
  console.log(`[OCR Client] ← ai-analysis elapsed=${elapsed}ms`);
  return result;
}
