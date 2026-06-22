/**
 * Export Service — 生成分析报告 Markdown 并导出到本地文件
 *
 * 职责：
 *   1. 从分析数据生成结构化 Markdown 内容
 *   2. 通过 IPC 调用主进程写入文件
 */

import type { StockParseResult, RealtimeQuote, KlineResult } from '../types/electron';

interface ExportParams {
  stockResult: StockParseResult;
  liveQuote: RealtimeQuote | null;
  klineResult: KlineResult | null;
}

/**
 * 生成 Markdown 格式的分析报告
 */
function generateMarkdown(params: ExportParams): string {
  const { stockResult, liveQuote, klineResult } = params;
  const now = new Date();
  const dateStr = now.toLocaleString('zh-CN');

  const stockCode = stockResult.stock_code ?? '未知';
  const stockName = liveQuote?.name ?? stockResult.stock_name ?? '未知';
  const price = liveQuote?.price?.toFixed(2) ?? stockResult.current_price ?? '未知';
  const changePct = liveQuote?.change_pct != null
    ? `${liveQuote.change_pct > 0 ? '+' : ''}${liveQuote.change_pct.toFixed(2)}%`
    : stockResult.change_percent ?? '未知';
  const changeAmt = liveQuote?.change_amt != null
    ? `${liveQuote.change_amt > 0 ? '+' : ''}${liveQuote.change_amt.toFixed(2)}`
    : stockResult.change_amount ?? '未知';

  const lines: string[] = [];

  // Title
  lines.push(`# ${stockName}（${stockCode}）技术分析报告`);
  lines.push('');
  lines.push(`> 生成时间：${dateStr}`);
  lines.push(`> 数据来源：SnapVision Desktop`);
  lines.push('');

  // Stock Info
  lines.push('## 股票信息');
  lines.push('');
  lines.push(`| 项目 | 数值 |`);
  lines.push(`|------|------|`);
  lines.push(`| 股票名称 | ${stockName} |`);
  lines.push(`| 股票代码 | ${stockCode} |`);
  lines.push(`| 当前价格 | ${price} |`);
  lines.push(`| 涨跌幅 | ${changePct} |`);
  lines.push(`| 涨跌额 | ${changeAmt} |`);
  lines.push('');

  // Current Price
  lines.push('## 当前价格');
  lines.push('');
  lines.push(`- **最新价**: ${price}`);
  lines.push(`- **涨跌幅**: ${changePct}`);
  lines.push(`- **涨跌额**: ${changeAmt}`);
  if (liveQuote) {
    lines.push(`- **今开**: ${liveQuote.open?.toFixed(2) ?? '--'}`);
    lines.push(`- **昨收**: ${liveQuote.prev_close?.toFixed(2) ?? '--'}`);
    lines.push(`- **最高**: ${liveQuote.high?.toFixed(2) ?? '--'}`);
    lines.push(`- **最低**: ${liveQuote.low?.toFixed(2) ?? '--'}`);
    lines.push(`- **成交量**: ${liveQuote.volume ?? '--'}`);
    lines.push(`- **成交额**: ${liveQuote.turnover ?? '--'}`);
    lines.push(`- **换手率**: ${liveQuote.turnover_rate != null ? `${liveQuote.turnover_rate.toFixed(2)}%` : '--'}`);
    lines.push(`- **市盈率**: ${liveQuote.pe?.toFixed(2) ?? '--'}`);
    lines.push(`- **市净率**: ${liveQuote.pb?.toFixed(4) ?? '--'}`);
  }
  lines.push('');

  // OCR Results
  lines.push('## OCR 识别结果');
  lines.push('');
  if (stockResult._raw_ocr_texts && stockResult._raw_ocr_texts.length > 0) {
    lines.push('原始 OCR 文本：');
    lines.push('');
    lines.push('```');
    stockResult._raw_ocr_texts.forEach(t => lines.push(t));
    lines.push('```');
  } else {
    lines.push('无原始 OCR 文本数据。');
  }
  lines.push('');
  if (stockResult._ocr_meta) {
    lines.push(`- 识别行数：${stockResult._ocr_meta.line_count}`);
    lines.push(`- OCR 耗时：${stockResult._ocr_meta.ocr_ms}ms`);
    lines.push(`- 总耗时：${stockResult._ocr_meta.total_ms}ms`);
  }
  if (stockResult.overall_confidence != null) {
    lines.push(`- 识别可信度：${(stockResult.overall_confidence * 100).toFixed(0)}%`);
  }
  lines.push('');

  // Technical Analysis
  lines.push('## 技术分析');
  lines.push('');
  if (klineResult && klineResult.bars.length > 0) {
    const bars = klineResult.bars;
    const latest = bars[bars.length - 1];
    const ma20 = bars.length >= 20 ? calculateSMA(bars.map(b => b.close), 20) : null;
    const ma5 = bars.length >= 5 ? calculateSMA(bars.map(b => b.close), 5) : null;

    lines.push(`- **K线周期**: ${klineResult.period}`);
    lines.push(`- **数据条数**: ${bars.length}`);
    lines.push(`- **最新收盘**: ${latest.close.toFixed(2)}`);
    if (ma5 != null) lines.push(`- **MA5**: ${ma5.toFixed(2)}`);
    if (ma20 != null) lines.push(`- **MA20**: ${ma20.toFixed(2)}`);

    if (bars.length >= 14) {
      const rsi = calculateRSI(bars.map(b => b.close), 14);
      if (rsi != null) lines.push(`- **RSI(14)**: ${rsi.toFixed(2)}`);
    }

    if (bars.length >= 20) {
      const upper = calculateSMA(bars.map(b => b.close), 20) ?? 0;
      const std = calculateStd(bars.slice(-20).map(b => b.close));
      lines.push(`- **布林带上轨**: ${(upper + 2 * std).toFixed(2)}`);
      lines.push(`- **布林带中轨**: ${upper.toFixed(2)}`);
      lines.push(`- **布林带下轨**: ${(upper - 2 * std).toFixed(2)}`);
    }
  } else {
    lines.push('K线数据不足，无法进行技术分析。');
  }
  lines.push('');

  // Volume-Price Analysis
  lines.push('## 量价分析');
  lines.push('');
  if (klineResult && klineResult.bars.length >= 5) {
    const bars = klineResult.bars;
    const latest = bars[bars.length - 1];
    const avgVol5 = bars.slice(-5).reduce((s, b) => s + b.volume, 0) / 5;
    const volRatio = avgVol5 > 0 ? (latest.volume / avgVol5) : 1;

    lines.push(`- **最新成交量**: ${latest.volume}`);
    lines.push(`- **5日均量**: ${Math.round(avgVol5)}`);
    lines.push(`- **量比**: ${volRatio.toFixed(2)}`);

    if (volRatio > 1.3) {
      lines.push(`- **量能状态**: 放量 (量比 > 1.3)`);
    } else if (volRatio < 0.7) {
      lines.push(`- **量能状态**: 缩量 (量比 < 0.7)`);
    } else {
      lines.push(`- **量能状态**: 平量`);
    }
  } else {
    lines.push('K线数据不足，无法进行量价分析。');
  }
  lines.push('');

  // Risk Warning
  lines.push('## 风险提示');
  lines.push('');
  lines.push('> 本分析仅基于图表数据和技术指标生成，不构成投资建议。');
  lines.push('> 股市有风险，投资需谨慎。');
  lines.push('> 技术分析存在局限性，请结合基本面、消息面等多维度因素综合判断。');
  lines.push('');

  // Operation Advice
  lines.push('## 操作建议');
  lines.push('');
  if (klineResult && klineResult.bars.length >= 20) {
    const bars = klineResult.bars;
    const close = liveQuote?.price ?? bars[bars.length - 1].close;
    const ma20 = calculateSMA(bars.map(b => b.close), 20);
    const ma5 = calculateSMA(bars.map(b => b.close), 5);

    if (ma5 != null && ma20 != null) {
      if (ma5 > ma20) {
        lines.push('- **均线形态**: MA5 在 MA20 上方，短期趋势偏多');
      } else {
        lines.push('- **均线形态**: MA5 在 MA20 下方，短期趋势偏弱');
      }
    }

    if (ma20 != null && close != null) {
      const pct = ((close / ma20 - 1) * 100).toFixed(2);
      if (close > ma20) {
        lines.push(`- **价格位置**: 当前价格在 MA20 上方 ${pct}%`);
      } else {
        lines.push(`- **价格位置**: 当前价格在 MA20 下方 ${Math.abs(Number(pct))}%`);
      }
    }

    // Support and Resistance
    const recent20 = bars.slice(-20);
    const support = Math.min(...recent20.map(b => b.low));
    const resistance = Math.max(...recent20.map(b => b.high));
    lines.push(`- **支撑位**: ${support.toFixed(2)}`);
    lines.push(`- **压力位**: ${resistance.toFixed(2)}`);
  } else {
    lines.push('数据不足，暂无法给出操作建议。');
  }
  lines.push('');

  // AI Conclusion Summary
  lines.push('## AI 结论摘要');
  lines.push('');
  if (stockResult.analysis_summary) {
    lines.push(stockResult.analysis_summary);
  } else {
    lines.push('暂无 AI 分析结论。');
  }
  lines.push('');

  // Footer
  lines.push('---');
  lines.push('');
  lines.push(`*由 SnapVision Desktop 自动生成 | ${dateStr}*`);

  return lines.join('\n');
}

// ─── Technical Indicator Helpers ────────────────────────────

function calculateSMA(data: number[], period: number): number | null {
  if (data.length < period) return null;
  const slice = data.slice(-period);
  return slice.reduce((s, v) => s + v, 0) / period;
}

function calculateRSI(closes: number[], period: number): number | null {
  if (closes.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - (100 / (1 + rs));
}

function calculateStd(data: number[]): number {
  const mean = data.reduce((s, v) => s + v, 0) / data.length;
  const variance = data.reduce((s, v) => s + (v - mean) ** 2, 0) / data.length;
  return Math.sqrt(variance);
}

/**
 * 保存分析报告到本地
 */
export async function saveAnalysisReport(params: ExportParams): Promise<{ ok: boolean; path?: string; error?: string }> {
  const content = generateMarkdown(params);

  return window.electronAPI.exportReport({
    stock_code: params.stockResult.stock_code ?? 'unknown',
    stock_name: params.liveQuote?.name ?? params.stockResult.stock_name ?? 'unknown',
    content,
  });
}
