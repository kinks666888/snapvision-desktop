/**
 * AI Conclusion Generator — 模板化结论引擎
 *
 * 基于 OCR 结果、实时行情、K 线、技术指标计算结果自动生成结构化结论。
 * 不调用 LLM，不虚构内容，不依赖 API_KEY。同一输入保证同一输出。
 */

import type { StockParseResult, RealtimeQuote } from '../types/electron';
import type { OhlcvBar, IndicatorLine } from './indicators';
import { sma, ema, macd, rsi, boll, kdj } from './indicators';
import type { AnalysisResult } from './analysis';
import type { VolumePriceAnalysis } from './volumePriceAnalysis';
import type { CandlePattern } from '../types/electron';
import { calcATR } from '../lib/atrAnalyzer';

// ─── Types ─────────────────────────────────────────────────

export interface TrendAnalysis {
  direction: '多头' | '空头' | '震荡';
  reason: string;
}

export interface VolumePriceAnalysis_ {
  label: '放量上涨' | '放量下跌' | '缩量上涨' | '缩量下跌' | '量价背离' | '量价平稳';
  reason: string;
}

export interface RiskAnalysis {
  level: '低风险' | '中风险' | '高风险';
  reason: string;
}

export interface KeyLevels {
  support: number | null;
  resistance: number | null;
  distanceToSupport: string;
  distanceToResistance: string;
  supportPct: number | null;
  resistancePct: number | null;
}

export interface ActionAdvice {
  label: '建议关注' | '谨慎持有' | '继续持有' | '减仓观察' | '逢高止盈' | '观望等待' | '风险较高';
  reason: string;
}

export interface ConfidenceScore {
  score: number;
  reason: string;
}

export interface AIConclusionResult {
  summary: string;
  trend: TrendAnalysis;
  volumePrice: VolumePriceAnalysis_;
  risk: RiskAnalysis;
  keyLevels: KeyLevels;
  action: ActionAdvice;
  confidence: ConfidenceScore;
}

// ─── Main Entry ────────────────────────────────────────────

export function generateAIConclusion(params: {
  data: StockParseResult;
  liveQuote: RealtimeQuote | null | undefined;
  klineBars: OhlcvBar[];
  techResult: AnalysisResult | null;
  vpResult: VolumePriceAnalysis | null;
  candlePatterns: CandlePattern[];
}): AIConclusionResult {
  const { data, liveQuote, klineBars, techResult, vpResult, candlePatterns } = params;

  const n = klineBars.length;
  const close = liveQuote?.price ?? (data.current_price ? parseFloat(data.current_price) : null);
  const prevClose = liveQuote?.prev_close ?? null;

  // Compute indicators we need that may not be in techResult
  const ma5Line = n >= 5 ? sma(klineBars, 5) : [];
  const ma10Line = n >= 10 ? sma(klineBars, 10) : [];
  const ma20Line = n >= 20 ? sma(klineBars, 20) : [];
  const ma60Line = n >= 60 ? sma(klineBars, 60) : [];
  const ema12Line = n >= 12 ? ema(klineBars, 12) : [];
  const ema26Line = n >= 26 ? ema(klineBars, 26) : [];
  const macdData = n >= 26 ? macd(klineBars) : null;
  const bollData = n >= 20 ? boll(klineBars) : null;
  const atr = n >= 15 ? calcATR(klineBars) : null;
  const rsiLine = n >= 15 ? rsi(klineBars, 14) : [];

  // Latest values
  const ma5 = lastVal(ma5Line);
  const ma10 = lastVal(ma10Line);
  const ma20 = lastVal(ma20Line);
  const ma60 = lastVal(ma60Line);
  const ema12 = lastVal(ema12Line);
  const ema26 = lastVal(ema26Line);
  const dif = macdData ? lastVal(macdData.dif) : null;
  const dea = macdData ? lastVal(macdData.dea) : null;
  const hist = macdData ? lastVal(macdData.histogram) : null;
  const bollUpper = bollData ? lastVal(bollData.upper) : null;
  const bollMiddle = bollData ? lastVal(bollData.middle) : null;
  const bollLower = bollData ? lastVal(bollData.lower) : null;
  const rsiVal = rsiLine.length > 0 ? lastVal(rsiLine) : null;

  const trend = analyzeTrend({ close, ma5, ma10, ma20, ma60, ema12, ema26, dif, dea, techResult });
  const volumePrice = analyzeVolumePrice({ klineBars, vpResult });
  const risk = analyzeRisk({ close, atr, bollUpper, bollLower, bollMiddle, techResult });
  const keyLevels = computeKeyLevels({ close, techResult, klineBars, atr });
  const action = determineAction({ trend, volumePrice, risk, techResult, close, ma20, rsiVal, candlePatterns });
  const confidence = computeConfidence({ data, liveQuote, n, techResult, vpResult, candlePatterns, atr, rsiVal });
  const summary = buildSummary({ trend, volumePrice, risk, keyLevels, action });

  return { summary, trend, volumePrice, risk, keyLevels, action, confidence };
}

// ─── Trend Analysis ────────────────────────────────────────

function analyzeTrend(params: {
  close: number | null;
  ma5: number | null;
  ma10: number | null;
  ma20: number | null;
  ma60: number | null;
  ema12: number | null;
  ema26: number | null;
  dif: number | null;
  dea: number | null;
  techResult: AnalysisResult | null;
}): TrendAnalysis {
  const { close, ma5, ma10, ma20, ma60, ema12, ema26, dif, dea, techResult } = params;

  if (close == null) {
    return { direction: '震荡', reason: '当前价格数据缺失，无法判断趋势方向。' };
  }

  let bullishScore = 0;
  let bearishScore = 0;
  const reasons: string[] = [];

  // MA alignment
  const maValues = [ma5, ma10, ma20, ma60].filter(v => v != null) as number[];
  if (maValues.length >= 3) {
    const sorted = [...maValues].sort((a, b) => b - a);
    const isBullish = sorted[0] === ma5 && sorted[1] === ma10 && ma5 > ma20!; // MA5 > MA10 > MA20
    const isBearish = sorted[0] === ma60 && sorted[1] === ma20 && ma20! > ma5; // MA60 > MA20 > MA5
    if (ma5 != null && ma10 != null && ma20 != null) {
      if (ma5 > ma10 && ma10 > ma20) {
        bullishScore += 2;
        reasons.push('MA5>MA10>MA20多头排列');
      } else if (ma5 < ma10 && ma10 < ma20) {
        bearishScore += 2;
        reasons.push('MA5<MA10<MA20空头排列');
      }
    }
  }

  // Price vs MA20
  if (ma20 != null) {
    if (close > ma20) {
      bullishScore += 1;
      const pct = ((close / ma20 - 1) * 100).toFixed(1);
      reasons.push(`价格在MA20上方${pct}%`);
    } else {
      bearishScore += 1;
      const pct = ((1 - close / ma20) * 100).toFixed(1);
      reasons.push(`价格在MA20下方${pct}%`);
    }
  }

  // EMA alignment
  if (ema12 != null && ema26 != null) {
    if (ema12 > ema26) {
      bullishScore += 1;
      reasons.push('EMA12>EMA26短期趋势偏强');
    } else {
      bearishScore += 1;
      reasons.push('EMA12<EMA26短期趋势偏弱');
    }
  }

  // MACD
  if (dif != null && dea != null) {
    if (dif > dea) {
      bullishScore += 1;
      reasons.push('MACD金叉区域(DIF>DEA)');
    } else {
      bearishScore += 1;
      reasons.push('MACD死叉区域(DIF<DEA)');
    }
  }

  // Use techResult trend as tiebreaker
  if (techResult) {
    if (techResult.trend.direction === '上升') bullishScore += 1;
    else if (techResult.trend.direction === '下降') bearishScore += 1;
  }

  let direction: '多头' | '空头' | '震荡';
  if (bullishScore >= bearishScore + 2) {
    direction = '多头';
  } else if (bearishScore >= bullishScore + 2) {
    direction = '空头';
  } else {
    direction = '震荡';
  }

  const reason = reasons.length > 0
    ? reasons.slice(0, 3).join('；') + '。'
    : '技术指标信号不一致，趋势不明朗。';

  return { direction, reason };
}

// ─── Volume-Price Analysis ─────────────────────────────────

function analyzeVolumePrice(params: {
  klineBars: OhlcvBar[];
  vpResult: VolumePriceAnalysis | null;
}): VolumePriceAnalysis_ {
  const { klineBars, vpResult } = params;
  const n = klineBars.length;

  if (n < 5) {
    return { label: '量价平稳', reason: 'K线数据不足，无法分析量价关系。' };
  }

  const latest = klineBars[n - 1];
  const priceChange = latest.close - (klineBars[n - 2]?.close ?? latest.close);

  // 5-day avg volume
  const vol5Bars = klineBars.slice(-5);
  const avgVol5 = vol5Bars.reduce((s, b) => s + b.volume, 0) / vol5Bars.length;
  const volRatio = avgVol5 > 0 ? latest.volume / avgVol5 : 1;
  const isVolumeUp = volRatio > 1.2;
  const isVolumeDown = volRatio < 0.8;
  const isPriceUp = priceChange > 0;
  const isPriceDown = priceChange < 0;

  // OBV trend from vpResult
  const obvTrend = vpResult?.obv?.trend ?? '走平';

  // Divergence from vpResult
  const hasDivergence = vpResult?.divergence?.label === '顶背离' || vpResult?.divergence?.label === '底背离';
  const isTopDivergence = vpResult?.divergence?.label === '顶背离';

  if (hasDivergence) {
    const label = isTopDivergence ? '量价背离' : '量价背离';
    return {
      label,
      reason: vpResult!.divergence.description,
    };
  }

  if (isPriceUp && isVolumeUp) {
    return {
      label: '放量上涨',
      reason: `成交量为5日均量的${volRatio.toFixed(1)}倍，配合价格上涨，量价齐升趋势健康。OBV${obvTrend}。`,
    };
  }
  if (isPriceDown && isVolumeUp) {
    return {
      label: '放量下跌',
      reason: `成交量为5日均量的${volRatio.toFixed(1)}倍，但价格下跌，抛压较重，需警惕。`,
    };
  }
  if (isPriceUp && isVolumeDown) {
    return {
      label: '缩量上涨',
      reason: `成交量仅为5日均量的${(volRatio * 100).toFixed(0)}%，上涨缺乏量能配合，持续性存疑。`,
    };
  }
  if (isPriceDown && isVolumeDown) {
    return {
      label: '缩量下跌',
      reason: `成交量萎缩至5日均量的${(volRatio * 100).toFixed(0)}%，卖盘衰竭，可能接近阶段性底部。`,
    };
  }

  return {
    label: '量价平稳',
    reason: `成交量与5日均量基本持平（${volRatio.toFixed(1)}倍），价格波动有限，量价关系中性。`,
  };
}

// ─── Risk Analysis ─────────────────────────────────────────

function analyzeRisk(params: {
  close: number | null;
  atr: number | null;
  bollUpper: number | null;
  bollLower: number | null;
  bollMiddle: number | null;
  techResult: AnalysisResult | null;
}): RiskAnalysis {
  const { close, atr, bollUpper, bollLower, bollMiddle, techResult } = params;

  let riskScore = 0;
  const reasons: string[] = [];

  // ATR volatility
  if (atr != null && close != null && close > 0) {
    const atrPct = atr / close * 100;
    if (atrPct > 4) {
      riskScore += 3;
      reasons.push(`ATR波动率${atrPct.toFixed(1)}%偏高`);
    } else if (atrPct > 2.5) {
      riskScore += 1;
      reasons.push(`ATR波动率${atrPct.toFixed(1)}%中等`);
    } else {
      reasons.push(`ATR波动率${atrPct.toFixed(1)}%较低`);
    }
  } else {
    reasons.push('ATR数据不足');
  }

  // BOLL position
  if (close != null && bollUpper != null && bollLower != null) {
    if (close > bollUpper) {
      riskScore += 2;
      reasons.push('价格突破布林带上轨，短期超买');
    } else if (close < bollLower) {
      riskScore += 1;
      reasons.push('价格跌破布林带下轨，短期超卖');
    } else if (bollMiddle != null && close > bollMiddle) {
      reasons.push('价格在布林带中轨上方');
    } else {
      reasons.push('价格在布林带中轨下方');
    }
  } else {
    reasons.push('布林带数据不足');
  }

  // RSI
  if (techResult) {
    // Use score as a proxy
    if (techResult.score >= 70) {
      riskScore += 1;
      reasons.push('综合评分偏高，注意回调风险');
    } else if (techResult.score <= 30) {
      reasons.push('综合评分偏低，可能存在超卖机会');
    }
  }

  let level: '低风险' | '中风险' | '高风险';
  if (riskScore >= 4) {
    level = '高风险';
  } else if (riskScore >= 2) {
    level = '中风险';
  } else {
    level = '低风险';
  }

  const reason = reasons.slice(0, 3).join('；') + '。';
  return { level, reason };
}

// ─── Key Levels ────────────────────────────────────────────

function computeKeyLevels(params: {
  close: number | null;
  techResult: AnalysisResult | null;
  klineBars: OhlcvBar[];
  atr: number | null;
}): KeyLevels {
  const { close, techResult, klineBars, atr } = params;

  const support = techResult?.keyLevels.support ?? null;
  const resistance = techResult?.keyLevels.resistance ?? null;

  let supportPct: number | null = null;
  let resistancePct: number | null = null;
  let distanceToSupport = '--';
  let distanceToResistance = '--';

  if (close != null && support != null && support > 0) {
    supportPct = parseFloat(((close - support) / close * 100).toFixed(1));
    distanceToSupport = supportPct >= 0 ? `+${supportPct}%` : `${supportPct}%`;
  }

  if (close != null && resistance != null && resistance > 0) {
    resistancePct = parseFloat(((resistance - close) / close * 100).toFixed(1));
    distanceToResistance = resistancePct >= 0 ? `+${resistancePct}%` : `${resistancePct}%`;
  }

  return { support, resistance, distanceToSupport, distanceToResistance, supportPct, resistancePct };
}

// ─── Action Advice ─────────────────────────────────────────

function determineAction(params: {
  trend: TrendAnalysis;
  volumePrice: VolumePriceAnalysis_;
  risk: RiskAnalysis;
  techResult: AnalysisResult | null;
  close: number | null;
  ma20: number | null;
  rsiVal: number | null;
  candlePatterns: CandlePattern[];
}): ActionAdvice {
  const { trend, volumePrice, risk, techResult, close, ma20, rsiVal, candlePatterns } = params;

  // High risk → risk较高
  if (risk.level === '高风险') {
    return {
      label: '风险较高',
      reason: `${risk.reason}建议控制仓位，降低风险敞口。`,
    };
  }

  // RSI overbought
  if (rsiVal != null && rsiVal > 75) {
    return {
      label: '逢高止盈',
      reason: `RSI达${rsiVal.toFixed(0)}进入超买区域，短期获利盘较多，建议逢高逐步止盈。`,
    };
  }

  // RSI oversold
  if (rsiVal != null && rsiVal < 25) {
    return {
      label: '建议关注',
      reason: `RSI仅${rsiVal.toFixed(0)}处于超卖区域，可能存在技术性反弹机会，可关注但需控制仓位。`,
    };
  }

  // Strong bullish
  if (trend.direction === '多头' && volumePrice.label === '放量上涨') {
    return {
      label: '继续持有',
      reason: '均线多头排列且量价齐升，趋势健康，可继续持有。',
    };
  }

  // Bullish
  if (trend.direction === '多头' && risk.level === '低风险') {
    return {
      label: '谨慎持有',
      reason: '趋势偏多且风险较低，可谨慎持有，关注量能配合情况。',
    };
  }

  // Bearish trend
  if (trend.direction === '空头' && volumePrice.label === '放量下跌') {
    return {
      label: '减仓观察',
      reason: '空头趋势且放量下跌，市场抛压较重，建议减仓观望。',
    };
  }

  // Bearish
  if (trend.direction === '空头') {
    return {
      label: '减仓观察',
      reason: '均线空头排列，趋势偏弱，建议减仓或等待企稳信号。',
    };
  }

  // Neutral with bearish volume
  if (volumePrice.label === '缩量上涨' || volumePrice.label === '量价背离') {
    return {
      label: '谨慎持有',
      reason: '上涨缺乏量能支撑，需观察后续量价配合情况。',
    };
  }

  // Neutral default
  if (trend.direction === '震荡') {
    return {
      label: '观望等待',
      reason: '趋势不明朗，建议等待方向明确后再做决策。',
    };
  }

  return {
    label: '建议关注',
    reason: '综合技术面信号，可适当关注，但需结合基本面判断。',
  };
}

// ─── Confidence Score ──────────────────────────────────────

function computeConfidence(params: {
  data: StockParseResult;
  liveQuote: RealtimeQuote | null | undefined;
  n: number;
  techResult: AnalysisResult | null;
  vpResult: VolumePriceAnalysis | null;
  candlePatterns: CandlePattern[];
  atr: number | null;
  rsiVal: number | null;
}): ConfidenceScore {
  const { data, liveQuote, n, techResult, vpResult, candlePatterns, atr, rsiVal } = params;

  let score = 0;
  const factors: string[] = [];

  // OCR confidence (max 25 points)
  const ocrConf = data.overall_confidence ?? 0.8;
  const ocrScore = Math.round(ocrConf * 25);
  score += ocrScore;
  if (ocrConf >= 0.85) {
    factors.push('OCR识别准确');
  } else if (ocrConf >= 0.6) {
    factors.push('OCR识别可信');
  } else {
    factors.push('OCR识别精度偏低');
  }

  // Live quote completeness (max 20 points)
  let quoteFields = 0;
  if (liveQuote?.price != null) quoteFields++;
  if (liveQuote?.change_pct != null) quoteFields++;
  if (liveQuote?.volume != null) quoteFields++;
  if (liveQuote?.turnover_rate != null) quoteFields++;
  if (liveQuote?.total_market_cap != null) quoteFields++;
  const quoteScore = Math.round((quoteFields / 5) * 20);
  score += quoteScore;
  if (quoteFields >= 4) {
    factors.push('行情数据完整');
  } else if (quoteFields >= 2) {
    factors.push('行情数据部分缺失');
  } else {
    factors.push('行情数据不足');
  }

  // K-line data completeness (max 20 points)
  let klineScore = 0;
  if (n >= 60) klineScore = 20;
  else if (n >= 26) klineScore = 15;
  else if (n >= 20) klineScore = 12;
  else if (n >= 10) klineScore = 8;
  else if (n >= 5) klineScore = 4;
  score += klineScore;

  // Technical indicators available (max 25 points)
  let indicatorCount = 0;
  if (techResult) indicatorCount++;
  if (atr != null) indicatorCount++;
  if (rsiVal != null) indicatorCount++;
  if (vpResult && !vpResult.insufficientData) indicatorCount++;
  if (candlePatterns.length > 0) indicatorCount++;
  const indicatorScore = Math.round((indicatorCount / 5) * 25);
  score += indicatorScore;
  if (indicatorCount >= 4) {
    factors.push('技术指标齐全');
  } else if (indicatorCount >= 2) {
    factors.push('部分指标缺失');
  } else {
    factors.push('技术指标不足');
  }

  // Clamp
  score = Math.max(0, Math.min(100, score));

  const reason = `${score}分（${factors.join('，')}）`;
  return { score, reason };
}

// ─── Summary Builder ───────────────────────────────────────

function buildSummary(params: {
  trend: TrendAnalysis;
  volumePrice: VolumePriceAnalysis_;
  risk: RiskAnalysis;
  keyLevels: KeyLevels;
  action: ActionAdvice;
}): string {
  const { trend, volumePrice, risk, action } = params;

  if (trend.direction === '多头' && volumePrice.label === '放量上涨') {
    return '均线多头排列，量价齐升，中期走势偏强。';
  }
  if (trend.direction === '多头') {
    return '均线多头排列，中期走势偏强，关注量能持续性。';
  }
  if (trend.direction === '空头' && volumePrice.label === '放量下跌') {
    return '空头趋势明确，放量下跌，建议回避风险。';
  }
  if (trend.direction === '空头') {
    return '当前处于空头趋势，建议观望。';
  }
  if (volumePrice.label === '量价背离') {
    return '成交量放大但价格未突破压力位，需等待确认。';
  }
  if (volumePrice.label === '缩量上涨') {
    return '缩量上涨，量能不足支撑突破，需观察后续放量情况。';
  }
  if (volumePrice.label === '放量下跌') {
    return '放量下跌，抛压较重，短期偏弱。';
  }
  if (volumePrice.label === '缩量下跌') {
    return '缩量下跌，卖盘衰竭，可能接近底部区域。';
  }
  if (risk.level === '高风险') {
    return '波动率偏高，风险较大，建议控制仓位。';
  }

  return '趋势不明朗，建议等待方向明确后再操作。';
}

// ─── Helpers ───────────────────────────────────────────────

function lastVal(line: IndicatorLine[]): number | null {
  if (line.length === 0) return null;
  const v = line[line.length - 1].value;
  return isNaN(v) ? null : v;
}
