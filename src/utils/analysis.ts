/**
 * AI Analysis Engine — 智能行情分析
 *
 * Pure analysis functions. Input: OHLCV bars + live price.
 * Output: structured analysis object for the AnalysisPanel.
 */

import type { OhlcvBar } from './indicators';
import { sma, ema, macd, rsi, boll } from './indicators';
import { detectCandlePatterns } from '../lib/candlePatternAnalyzer';

export interface AnalysisResult {
  trend: {
    direction: '上升' | '下降' | '震荡';
    strength: '强势' | '弱势' | '中性';
    description: string;
    ma20: number | null;
    priceVsMa20: number | null; // + above, - below
  };
  volume: {
    current: number;
    avg5: number;
    ratio: number; // current / avg5
    status: '放量' | '缩量' | '平量';
    description: string;
  };
  keyLevels: {
    support: number | null;  // recent 20-bar low
    resistance: number | null; // recent 20-bar high
    atr: number | null;       // average true range (14)
  };
  maCross: {
    goldCross: boolean;  // MA5 cross above MA20 recently
    deadCross: boolean;  // MA5 cross below MA20 recently
    description: string;
  };
  macdSignal: {
    goldCross: boolean;
    deadCross: boolean;
    description: string;
  };
  score: number;  // 0-100
  recommendation: '建议观望' | '可以关注' | '信号较强';
  timestamp: string;
  disclaimer: string;
}

export function analyse(
  bars: OhlcvBar[],
  livePrice?: number | null,
): AnalysisResult {
  const n = bars.length;
  if (n < 20) {
    return emptyAnalysis();
  }

  const recent = bars.slice(-20);
  const latest = bars[n - 1];
  const close = livePrice ?? latest.close;

  // ── Trend ───────────────────────────────────────────
  const ma20Line = sma(bars, 20);
  const ma20 = ma20Line[n - 1].value;
  const ma20Prev5 = ma20Line[n - 6].value;

  let direction: '上升' | '下降' | '震荡' = '震荡';
  let strength: '强势' | '弱势' | '中性' = '中性';

  if (!isNaN(ma20)) {
    const slope = (ma20 - (ma20Line[n - 6]?.value ?? ma20)) / 5;
    if (slope > 0.001 * ma20) direction = '上升';
    else if (slope < -0.001 * ma20) direction = '下降';
    else direction = '震荡';

    const deviation = close / ma20 - 1;
    if (deviation > 0.02) strength = '强势';
    else if (deviation < -0.02) strength = '弱势';
  }

  const priceVsMa20 = isNaN(ma20) ? null : close - ma20;

  // Trend description
  const trendDesc = (() => {
    const base = `当前${direction === '震荡' ? '处于' : '呈'}${direction}${direction !== '震荡' ? '趋势' : ''}`;
    if (!isNaN(ma20)) {
      const pct = ((close / ma20 - 1) * 100).toFixed(2);
      const pos = close > ma20 ? '上方' : '下方';
      return `${base}，价格位于 MA20 ${pos} ${Math.abs(Number(pct))}%`;
    }
    return base;
  })();

  // ── Volume ──────────────────────────────────────────
  const vol5 = bars.slice(-5).reduce((s, b) => s + b.volume, 0) / 5;
  const currentVol = latest.volume;
  const volRatio = vol5 > 0 ? currentVol / vol5 : 1;
  let volStatus: '放量' | '缩量' | '平量' = '平量';
  if (volRatio > 1.3) volStatus = '放量';
  else if (volRatio < 0.7) volStatus = '缩量';

  const volDesc = `近5日均量 ${fmtVol(vol5)}，今日成交量 ${fmtVol(currentVol)}，${volStatus === '放量' ? '明显放大' : volStatus === '缩量' ? '显著缩小' : '与均量持平'}`;

  // ── Key Levels ──────────────────────────────────────
  let support = Infinity;
  let resistance = -Infinity;
  for (const b of recent) {
    if (b.low < support) support = b.low;
    if (b.high > resistance) resistance = b.high;
  }
  if (support === Infinity) support = NaN;
  if (resistance === -Infinity) resistance = NaN;

  // ATR (14)
  let atr = NaN;
  if (n >= 15) {
    let sumTr = 0;
    for (let i = n - 14; i < n; i++) {
      const tr = Math.max(
        bars[i].high - bars[i].low,
        Math.abs(bars[i].high - bars[i - 1].close),
        Math.abs(bars[i].low - bars[i - 1].close),
      );
      sumTr += tr;
    }
    atr = sumTr / 14;
  }

  // ── MA Cross ────────────────────────────────────────
  const ma5 = sma(bars, 5);
  const ma5Last = ma5[n - 1]?.value;
  const ma5Prev = ma5[n - 2]?.value;
  const ma20Last = ma20;
  const ma20Prev = ma20Line[n - 2]?.value;

  const goldCross = !isNaN(ma5Last) && !isNaN(ma20Last) &&
    !isNaN(ma5Prev) && !isNaN(ma20Prev) &&
    ma5Prev <= ma20Prev && ma5Last > ma20Last;

  const deadCross = !isNaN(ma5Last) && !isNaN(ma20Last) &&
    !isNaN(ma5Prev) && !isNaN(ma20Prev) &&
    ma5Prev >= ma20Prev && ma5Last < ma20Last;

  let maCrossDesc = '';
  if (goldCross) maCrossDesc = 'MA5 上穿 MA20，形成金叉信号';
  else if (deadCross) maCrossDesc = 'MA5 下穿 MA20，形成死叉信号';
  else if (!isNaN(ma5Last) && !isNaN(ma20Last))
    maCrossDesc = ma5Last > ma20Last
      ? 'MA5 在 MA20 之上，维持多头排列'
      : 'MA5 在 MA20 之下，维持空头排列';
  else maCrossDesc = '均线数据不足';

  // ── MACD Signal ─────────────────────────────────────
  const macdData = macd(bars);
  const difLast = macdData.dif[n - 1]?.value;
  const deaLast = macdData.dea[n - 1]?.value;
  const difPrev = macdData.dif[n - 2]?.value;
  const deaPrev = macdData.dea[n - 2]?.value;

  const macdGold = !isNaN(difLast) && !isNaN(deaLast) &&
    !isNaN(difPrev) && !isNaN(deaPrev) &&
    difPrev <= deaPrev && difLast > deaLast;

  const macdDead = !isNaN(difLast) && !isNaN(deaLast) &&
    !isNaN(difPrev) && !isNaN(deaPrev) &&
    difPrev >= deaPrev && difLast < deaLast;

  let macdDesc = '';
  if (macdGold) macdDesc = 'MACD DIF 上穿 DEA，出现金叉';
  else if (macdDead) macdDesc = 'MACD DIF 下穿 DEA，出现死叉';
  else if (!isNaN(difLast) && !isNaN(deaLast))
    macdDesc = difLast > deaLast
      ? 'MACD 处于多头区域 (DIF > DEA)'
      : 'MACD 处于空头区域 (DIF < DEA)';
  else macdDesc = 'MACD 数据不足';

  // ── Score (0-100) ───────────────────────────────────
  let score = 50;

  // Trend bonus/penalty
  if (direction === '上升') score += 15;
  else if (direction === '下降') score -= 15;

  // Price vs MA20
  if (!isNaN(ma20)) {
    const pct = (close / ma20 - 1) * 100;
    if (pct > 5) score -= 10;         // overbought
    else if (pct > 0) score += 10;     // above MA — bullish
    else if (pct > -5) score -= 5;     // below MA — bearish
    else score -= 15;                  // deep below MA
  }

  // Volume signal
  if (volStatus === '放量' && direction === '上升') score += 10;
  if (volStatus === '放量' && direction === '下降') score -= 10;
  if (volStatus === '缩量') score -= 5;

  // MA cross
  if (goldCross) score += 20;
  if (deadCross) score -= 20;

  // MACD
  if (macdGold) score += 15;
  if (macdDead) score -= 15;

  // RSI
  if (n >= 15) {
    const rsi14 = rsi(bars, 14);
    const rsiVal = rsi14[n - 1]?.value;
    if (!isNaN(rsiVal)) {
      if (rsiVal < 30) score += 10;     // oversold — bounce possible
      else if (rsiVal > 70) score -= 10; // overbought — correction risk
      else if (rsiVal > 50) score += 5;
      else score -= 5;
    }
  }

  // Bollinger position
  if (n >= 20) {
    const bollData = boll(bars);
    const upperVal = bollData.upper[n - 1]?.value;
    const lowerVal = bollData.lower[n - 1]?.value;
    if (!isNaN(upperVal) && close > upperVal) score -= 10;  // above upper band
    if (!isNaN(lowerVal) && close < lowerVal) score += 10;  // below lower band (oversold)
  }

  // Candle pattern bonus/penalty (max ±10)
  if (n >= 3) {
    const patterns = detectCandlePatterns(bars);
    const bullishCount = patterns.filter(p => p.signal === 'bullish').length;
    const bearishCount = patterns.filter(p => p.signal === 'bearish').length;
    const patternScore = Math.min(10, bullishCount * 4) - Math.min(10, bearishCount * 4);
    score += patternScore;
  }

  // Clamp
  score = Math.max(0, Math.min(100, Math.round(score)));

  let recommendation: '建议观望' | '可以关注' | '信号较强' = '建议观望';
  if (score >= 65) recommendation = '信号较强';
  else if (score >= 40) recommendation = '可以关注';

  const now = new Date();
  const ts = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

  return {
    trend: {
      direction,
      strength,
      description: trendDesc,
      ma20: isNaN(ma20) ? null : ma20,
      priceVsMa20,
    },
    volume: {
      current: currentVol,
      avg5: vol5,
      ratio: volRatio,
      status: volStatus,
      description: volDesc,
    },
    keyLevels: {
      support: isNaN(support) ? null : support,
      resistance: isNaN(resistance) ? null : resistance,
      atr: isNaN(atr) ? null : atr,
    },
    maCross: {
      goldCross,
      deadCross,
      description: maCrossDesc,
    },
    macdSignal: {
      goldCross: macdGold,
      deadCross: macdDead,
      description: macdDesc,
    },
    score,
    recommendation,
    timestamp: ts,
    disclaimer: '本分析仅基于图表数据和技术指标生成，不构成投资建议。股市有风险，投资需谨慎。',
  };
}

// ─── Helpers ─────────────────────────────────────────────────

function fmtVol(v: number): string {
  if (v >= 1_0000_0000) return `${(v / 1_0000_0000).toFixed(2)}亿`;
  if (v >= 1_0000) return `${(v / 1_0000).toFixed(2)}万`;
  return `${v.toFixed(0)}`;
}

function emptyAnalysis(): AnalysisResult {
  return {
    trend: { direction: '震荡', strength: '中性', description: '数据不足，无法判断', ma20: null, priceVsMa20: null },
    volume: { current: 0, avg5: 0, ratio: 1, status: '平量', description: '数据不足' },
    keyLevels: { support: null, resistance: null, atr: null },
    maCross: { goldCross: false, deadCross: false, description: '数据不足' },
    macdSignal: { goldCross: false, deadCross: false, description: '数据不足' },
    score: 50,
    recommendation: '建议观望',
    timestamp: new Date().toISOString(),
    disclaimer: '本分析仅供参考，不构成投资建议。',
  };
}
