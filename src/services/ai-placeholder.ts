/**
 * AI Analysis Placeholder — 预留 AI 分析接口位置
 *
 * 本阶段不实现具体逻辑。
 * 后续在此模块接入 AI 分析 API，分析 OCR 识别出的股票数据。
 *
 * 示例签名（后续实现）:
 *   analyzeStockData(ocrText: string): Promise<StockAnalysis>
 */

export interface StockAnalysis {
  stockName: string;
  stockCode: string;
  trend: 'up' | 'down' | 'sideways';
  confidence: number;
  summary: string;
}

/**
 * 占位实现 — 后续替换为真实 AI 调用
 */
export async function analyzeStockData(_ocrText: string): Promise<StockAnalysis> {
  // TODO: 接入 AI 分析接口
  throw new Error('AI 分析功能尚未实现 — 本阶段仅提供 OCR 识别');
}
