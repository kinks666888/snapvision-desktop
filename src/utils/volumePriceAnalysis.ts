/**
 * Volume-Price Analysis Module (量价关系分析)
 *
 * Pure analysis functions — no side effects, no DOM dependency.
 * Input: OhlcvBar[] (K-line data with close, volume, optional open/high/low).
 * Output: structured VolumePriceAnalysis result.
 *
 * Designed to be fully decoupled from UI, OCR, AI, and chart rendering.
 * Re-runs cleanly when period or kline data changes.
 */

import type { OhlcvBar } from './indicators';

// ─── Types ─────────────────────────────────────────────────

export type SignalStrength = 'bullish' | 'neutral' | 'bearish';

export interface VpTrendResult {
  label: string;          // e.g. "量价齐升" | "量价不配合" | ...
  description: string;    // natural language explanation
  strength: SignalStrength;
}

export interface DivergenceResult {
  label: string;          // e.g. "顶背离" | "底背离" | "无背离"
  description: string;
  strength: SignalStrength;
}

export interface ObvResult {
  trend: '上行' | '走平' | '下行';
  description: string;
  strength: SignalStrength;
}

export interface LowVolumePriceResult {
  label: string;          // e.g. "地量地价" | "缩量止跌" | ...
  description: string;
  strength: SignalStrength;
}

export interface VolVsAvgResult {
  label: string;          // e.g. "高于5日均量" | ...
  ratio: number;          // current / avg5
  diffPercent: number;    // (current - avg5) / avg5 * 100
  description: string;
  strength: SignalStrength;
}

export interface VolumePriceAnalysis {
  volumePriceTrend: VpTrendResult;
  divergence: DivergenceResult;
  obv: ObvResult;
  lowVolumePrice: LowVolumePriceResult;
  volVsAvg: VolVsAvgResult;
  summary: string;
  timestamp: string;
  insufficientData: boolean;
}

// ─── Main Entry ────────────────────────────────────────────

const MIN_BARS = 10;

/**
 * Analyse volume-price relationships from OHLCV bars.
 * Returns a fully populated result, or a default "insufficient data" result
 * when fewer than MIN_BARS bars are provided.
 */
export function analyseVolumePrice(bars: OhlcvBar[]): VolumePriceAnalysis {
  if (!bars || bars.length < MIN_BARS) {
    return insufficientResult();
  }

  const vpTrend = detectVolumePriceTrend(bars);
  const divergence = detectDivergence(bars);
  const obv = calculateOBV(bars);
  const lowVp = detectLowVolumePrice(bars);
  const volVsAvg = compareVolVs5DayAvg(bars);

  const summary = buildSummary(vpTrend, divergence, obv, lowVp, volVsAvg);

  return {
    volumePriceTrend: vpTrend,
    divergence,
    obv,
    lowVolumePrice: lowVp,
    volVsAvg,
    summary,
    timestamp: new Date().toISOString(),
    insufficientData: false,
  };
}

// ─── 1. Volume-Price Trend Detection ──────────────────────

function detectVolumePriceTrend(bars: OhlcvBar[]): VpTrendResult {
  // Use last 5 bars for short-term comparison
  const window = bars.slice(-5);
  const priceSlope = linearSlope(window.map(b => b.close));
  const volSlope = linearSlope(window.map(b => b.volume));

  const priceUp = priceSlope > 0;
  const priceDown = priceSlope < 0;
  const volUp = volSlope > 0;
  const volDown = volSlope < 0;

  if (priceUp && volUp) {
    return {
      label: '量价齐升',
      description: '当前价格上涨且成交量同步放大，属于量价齐升，短期趋势偏强。',
      strength: 'bullish',
    };
  }
  if (priceUp && volDown) {
    return {
      label: '量价不配合',
      description: '价格上涨但成交量逐步萎缩，量价配合不佳，上涨持续性存疑。',
      strength: 'bearish',
    };
  }
  if (priceDown && volUp) {
    return {
      label: '放量下跌',
      description: '价格下跌伴随成交量放大，市场抛压较重，短期偏弱。',
      strength: 'bearish',
    };
  }
  if (priceDown && volDown) {
    return {
      label: '缩量下跌',
      description: '价格下跌但成交量萎缩，卖盘逐步衰竭，可能接近阶段底部。',
      strength: 'neutral',
    };
  }

  return {
    label: '量价平稳',
    description: '近5日价格和成交量均无明显方向，量价关系中性。',
    strength: 'neutral',
  };
}

// ─── 2. Divergence Detection ──────────────────────────────

function detectDivergence(bars: OhlcvBar[]): DivergenceResult {
  // Compare two windows: recent 5 vs previous 5
  if (bars.length < 10) {
    return { label: '数据不足', description: 'K线数量不足，无法判断量价背离。', strength: 'neutral' };
  }

  const prev5 = bars.slice(-10, -5);
  const last5 = bars.slice(-5);

  const prevPriceAvg = avg(prev5.map(b => b.close));
  const lastPriceAvg = avg(last5.map(b => b.close));
  const prevVolAvg = avg(prev5.map(b => b.volume));
  const lastVolAvg = avg(last5.map(b => b.volume));

  const priceChange = (lastPriceAvg - prevPriceAvg) / prevPriceAvg;
  const volChange = prevVolAvg > 0 ? (lastVolAvg - prevVolAvg) / prevVolAvg : 0;

  const priceUp = priceChange > 0.005;   // >0.5% threshold
  const priceDown = priceChange < -0.005;
  const volUp = volChange > 0.1;         // >10% threshold
  const volDown = volChange < -0.1;

  // Top divergence: price rises, volume falls
  if (priceUp && volDown) {
    return {
      label: '顶背离',
      description: `价格近5日上涨${(priceChange * 100).toFixed(1)}%但成交量下降${(Math.abs(volChange) * 100).toFixed(1)}%，出现量价顶背离，需警惕回调。`,
      strength: 'bearish',
    };
  }

  // Bottom divergence: price falls, volume rises (could mean capitulation then reversal)
  if (priceDown && volUp) {
    return {
      label: '底背离',
      description: `价格近5日下跌${(Math.abs(priceChange) * 100).toFixed(1)}%但成交量放大${(volChange * 100).toFixed(1)}%，出现量价底背离，可能有资金承接。`,
      strength: 'bullish',
    };
  }

  return {
    label: '无背离',
    description: '近期价格与成交量方向一致，未发现明显量价背离信号。',
    strength: 'neutral',
  };
}

// ─── 3. OBV Calculation ───────────────────────────────────

function calculateOBV(bars: OhlcvBar[]): ObvResult {
  if (bars.length < 10) {
    return { trend: '走平', description: 'K线数量不足，无法计算OBV。', strength: 'neutral' };
  }

  // Build OBV series
  const obvSeries: number[] = [0];
  for (let i = 1; i < bars.length; i++) {
    const prev = obvSeries[i - 1];
    if (bars[i].close > bars[i - 1].close) {
      obvSeries.push(prev + bars[i].volume);
    } else if (bars[i].close < bars[i - 1].close) {
      obvSeries.push(prev - bars[i].volume);
    } else {
      obvSeries.push(prev);
    }
  }

  // OBV trend: slope of last 10 OBV values
  const recentObv = obvSeries.slice(-10);
  const obvSlope = linearSlope(recentObv);

  // Price trend: slope of last 10 closes
  const recentClose = bars.slice(-10).map(b => b.close);
  const priceSlope = linearSlope(recentClose);

  // Normalise slopes by their means for fair comparison
  const obvMean = avg(recentObv.map(Math.abs));
  const priceMean = avg(recentClose);

  const obvRelSlope = obvMean > 0 ? obvSlope / obvMean : 0;
  const priceRelSlope = priceMean > 0 ? priceSlope / priceMean : 0;

  const obvDirection = obvRelSlope > 0.01 ? '上行' : obvRelSlope < -0.01 ? '下行' : '走平';
  const priceDirection = priceRelSlope > 0 ? '上升' : priceRelSlope < 0 ? '下降' : '持平';

  const consistent =
    (obvDirection === '上行' && priceRelSlope >= 0) ||
    (obvDirection === '下行' && priceRelSlope <= 0) ||
    obvDirection === '走平';

  let strength: SignalStrength;
  let description: string;

  if (obvDirection === '上行') {
    strength = consistent ? 'bullish' : 'bearish';
    description = consistent
      ? `OBV持续上行，说明资金流入与价格${priceDirection}方向一致，趋势健康。`
      : `OBV上行但价格${priceDirection}，资金面与价格走势出现分歧，需关注。`;
  } else if (obvDirection === '下行') {
    strength = consistent ? 'bearish' : 'bullish';
    description = consistent
      ? `OBV持续下行，资金流出与价格${priceDirection}同步，短期偏弱。`
      : `OBV下行但价格${priceDirection}，价格上涨缺乏资金支撑，持续性存疑。`;
  } else {
    strength = 'neutral';
    description = `OBV走平，成交量无明显方向，资金观望为主。`;
  }

  return { trend: obvDirection, description, strength };
}

// ─── 4. Low Volume + Low Price Detection ──────────────────

function detectLowVolumePrice(bars: OhlcvBar[]): LowVolumePriceResult {
  if (bars.length < 20) {
    return { label: '数据不足', description: 'K线数量不足，无法判断地量地价。', strength: 'neutral' };
  }

  const avgVol20 = avg(bars.slice(-20).map(b => b.volume));
  const recent3 = bars.slice(-3);
  const recent3AvgVol = avg(recent3.map(b => b.volume));
  const recent3AvgClose = avg(recent3.map(b => b.close));

  // Find the 20-bar low and high
  const closes20 = bars.slice(-20).map(b => b.close);
  const low20 = Math.min(...closes20);
  const high20 = Math.max(...closes20);
  const range20 = high20 - low20;

  // "地量" condition: recent 3-day avg volume < 50% of 20-day avg
  const isLowVolume = avgVol20 > 0 && recent3AvgVol / avgVol20 < 0.5;

  // "地价" condition: recent close within bottom 25% of 20-bar range
  const isLowPrice = range20 > 0 && (recent3AvgClose - low20) / range20 < 0.25;

  // Check for price stabilization: recent close > lowest of last 3
  const recentCloses = recent3.map(b => b.close);
  const recentLow = Math.min(...recentCloses);
  const latestClose = bars[bars.length - 1].close;
  const isStabilizing = latestClose > recentLow * 1.005; // >0.5% above recent low

  // Check if there was a bounce: last close higher than 3-bar ago close
  const isBouncing = bars.length >= 4 && latestClose > bars[bars.length - 4].close * 1.01;

  if (isLowVolume && isLowPrice && isBouncing) {
    return {
      label: '缩量反弹前兆',
      description: `近3日成交量仅为20日均量的${((recent3AvgVol / avgVol20) * 100).toFixed(0)}%，价格处于近期低位后出现小幅反弹，可能为缩量反弹前兆。`,
      strength: 'bullish',
    };
  }

  if (isLowVolume && isLowPrice && isStabilizing) {
    return {
      label: '缩量止跌',
      description: `近期成交量明显萎缩，价格在低位逐步企稳，出现缩量止跌信号。`,
      strength: 'neutral',
    };
  }

  if (isLowVolume && isLowPrice) {
    return {
      label: '地量地价',
      description: `成交量萎缩至20日均量的${((recent3AvgVol / avgVol20) * 100).toFixed(0)}%，且价格处于近期低位，呈现地量地价特征。`,
      strength: 'neutral',
    };
  }

  return {
    label: '未见明显地量地价',
    description: '近期成交量和价格均未出现明显的地量地价特征。',
    strength: 'neutral',
  };
}

// ─── 5. Volume vs 5-Day Average ───────────────────────────

function compareVolVs5DayAvg(bars: OhlcvBar[]): VolVsAvgResult {
  if (bars.length < 6) {
    return {
      label: '数据不足',
      ratio: 1,
      diffPercent: 0,
      description: 'K线数量不足，无法对比5日均量。',
      strength: 'neutral',
    };
  }

  const currentVol = bars[bars.length - 1].volume;
  const avgVol5 = avg(bars.slice(-6, -1).map(b => b.volume));

  if (avgVol5 === 0) {
    return {
      label: '数据异常',
      ratio: 0,
      diffPercent: 0,
      description: '5日均量为0，无法计算对比。',
      strength: 'neutral',
    };
  }

  const ratio = currentVol / avgVol5;
  const diffPercent = (ratio - 1) * 100;

  let label: string;
  let strength: SignalStrength;
  let description: string;

  if (ratio > 1.3) {
    label = '高于5日均量';
    strength = 'bullish';
    description = `当前成交量是近5日均量的${ratio.toFixed(2)}倍，较均量高出${diffPercent.toFixed(1)}%，市场参与度提升。`;
  } else if (ratio < 0.7) {
    label = '低于5日均量';
    strength = 'bearish';
    description = `当前成交量仅为近5日均量的${(ratio * 100).toFixed(0)}%，较均量低${Math.abs(diffPercent).toFixed(1)}%，市场交投清淡。`;
  } else {
    label = '接近5日均量';
    strength = 'neutral';
    description = `当前成交量与近5日均量基本持平（${ratio.toFixed(2)}倍），交投正常。`;
  }

  return { label, ratio, diffPercent, description, strength };
}

// ─── Summary Builder ──────────────────────────────────────

function buildSummary(
  vp: VpTrendResult,
  div: DivergenceResult,
  obv: ObvResult,
  lowVp: LowVolumePriceResult,
  volAvg: VolVsAvgResult,
): string {
  const parts: string[] = [];

  parts.push(vp.description);

  if (div.label !== '无背离' && div.label !== '数据不足') {
    parts.push(div.description);
  }

  parts.push(obv.description);

  if (lowVp.label !== '未见明显地量地价' && lowVp.label !== '数据不足') {
    parts.push(lowVp.description);
  }

  parts.push(volAvg.description);

  return parts.join(' ');
}

// ─── Utility Functions ────────────────────────────────────

/** Simple linear regression slope (x = 0, 1, 2, ...) */
function linearSlope(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += values[i];
    sumXY += i * values[i];
    sumX2 += i * i;
  }

  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return 0;

  return (n * sumXY - sumX * sumY) / denom;
}

/** Arithmetic mean */
function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/** Default result when data is insufficient */
function insufficientResult(): VolumePriceAnalysis {
  const empty: VpTrendResult = {
    label: '数据不足',
    description: '数据不足，无法判断量价关系。',
    strength: 'neutral',
  };
  const emptyDiv: DivergenceResult = {
    label: '数据不足',
    description: '数据不足，无法判断量价背离。',
    strength: 'neutral',
  };
  const emptyObv: ObvResult = {
    trend: '走平',
    description: '数据不足，无法计算OBV。',
    strength: 'neutral',
  };
  const emptyLow: LowVolumePriceResult = {
    label: '数据不足',
    description: '数据不足，无法判断地量地价。',
    strength: 'neutral',
  };
  const emptyAvg: VolVsAvgResult = {
    label: '数据不足',
    ratio: 1,
    diffPercent: 0,
    description: '数据不足，无法对比5日均量。',
    strength: 'neutral',
  };

  return {
    volumePriceTrend: empty,
    divergence: emptyDiv,
    obv: emptyObv,
    lowVolumePrice: emptyLow,
    volVsAvg: emptyAvg,
    summary: '数据不足，暂无法进行量价关系分析。',
    timestamp: new Date().toISOString(),
    insufficientData: true,
  };
}
