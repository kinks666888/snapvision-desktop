/**
 * stockAnalyzer — 纯本地股票技术分析库
 *
 * 零外部依赖，纯算法实现。所有指标函数供图表和分析共用。
 */

// ══════════════════════════════════════════════════════════════
// 一、技术指标计算函数
// ══════════════════════════════════════════════════════════════

/**
 * 计算移动平均线（MA）— 返回最新一条 MA 值
 * @param {number[]} closes  收盘价数组，从旧到新
 * @param {number}   period  周期
 * @returns {number} 最新 MA 值，数据不足时返回 NaN
 */
export function calcMA(closes, period) {
  if (closes.length < period) return NaN;
  let sum = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    sum += closes[i];
  }
  return sum / period;
}

/**
 * 计算指数移动平均线（EMA）— 返回完整 EMA 数组
 * 公式：EMA = 前一日EMA × (1 - 2/(period+1)) + 当日收盘 × 2/(period+1)
 * @param {number[]} closes  收盘价数组
 * @param {number}   period  周期
 * @returns {number[]} 与 closes 等长的 EMA 数组，前 period-1 项为 NaN
 */
export function calcEMA(closes, period) {
  const result = new Array(closes.length).fill(NaN);
  const k = 2 / (period + 1);

  // 用前 period 个值的 SMA 作为种子
  if (closes.length < period) return result;
  let seed = 0;
  for (let i = 0; i < period; i++) seed += closes[i];
  result[period - 1] = seed / period;

  for (let i = period; i < closes.length; i++) {
    result[i] = closes[i] * k + result[i - 1] * (1 - k);
  }
  return result;
}

/**
 * 计算 MACD（固定 12/26/9）
 * @param {number[]} closes  收盘价数组
 * @returns {{ dif: number, dea: number, histogram: number, trend: string }}
 */
export function calcMACD(closes) {
  const ema12 = calcEMA(closes, 12);
  const ema26 = calcEMA(closes, 26);

  // DIF 数组
  const difArr = closes.map((_, i) =>
    isNaN(ema12[i]) || isNaN(ema26[i]) ? NaN : ema12[i] - ema26[i]
  );

  // DEA = DIF 的 9 日 EMA
  const deaArr = new Array(closes.length).fill(NaN);
  const k = 2 / (9 + 1);
  let seed = null;
  let seedCount = 0;
  let seedSum = 0;
  for (let i = 0; i < difArr.length; i++) {
    if (isNaN(difArr[i])) continue;
    if (seed === null) {
      seedSum += difArr[i];
      seedCount++;
      if (seedCount === 9) {
        seed = seedSum / 9;
        deaArr[i] = seed;
      }
    } else {
      seed = difArr[i] * k + seed * (1 - k);
      deaArr[i] = seed;
    }
  }

  const n = closes.length;
  const dif = difArr[n - 1];
  const dea = deaArr[n - 1];
  const histogram = isNaN(dif) || isNaN(dea) ? NaN : (dif - dea) * 2;

  // 判断趋势
  let trend = 'bearish';
  const difPrev = n >= 2 ? difArr[n - 2] : NaN;
  const deaPrev = n >= 2 ? deaArr[n - 2] : NaN;

  if (!isNaN(dif) && !isNaN(dea) && !isNaN(difPrev) && !isNaN(deaPrev)) {
    const crossedAbove = difPrev <= deaPrev && dif > dea;
    const crossedBelow = difPrev >= deaPrev && dif < dea;
    if (crossedAbove) trend = 'golden_cross';
    else if (crossedBelow) trend = 'death_cross';
    else if (dif > dea) trend = 'bullish';
    else trend = 'bearish';
  }

  return { dif, dea, histogram, trend };
}

/**
 * 计算 RSI（相对强弱指数）
 * @param {number[]} closes   收盘价数组
 * @param {number}   period   周期，默认 14
 * @returns {number} 最新 RSI 值 (0-100)
 */
export function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return NaN;

  let avgGain = 0;
  let avgLoss = 0;

  // 初始平均
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) avgGain += diff;
    else avgLoss -= diff; // diff 是负数，取反
  }
  avgGain /= period;
  avgLoss /= period;

  // Wilder's smoothing
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/**
 * 计算 KDJ 指标
 * @param {number[]} highs   最高价数组
 * @param {number[]} lows    最低价数组
 * @param {number[]} closes  收盘价数组
 * @param {number}   period  RSV 周期，默认 9
 * @returns {{ k: number, d: number, j: number }}
 */
export function calcKDJ(highs, lows, closes, period = 9) {
  const n = closes.length;
  if (n < period) return { k: NaN, d: NaN, j: NaN };

  let prevK = 50;
  let prevD = 50;

  for (let i = period - 1; i < n; i++) {
    let highest = -Infinity;
    let lowest = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (highs[j] > highest) highest = highs[j];
      if (lows[j] < lowest) lowest = lows[j];
    }
    const range = highest - lowest;
    const rsv = range === 0 ? 50 : ((closes[i] - lowest) / range) * 100;
    prevK = (rsv + 2 * prevK) / 3;
    prevD = (prevK + 2 * prevD) / 3;
  }

  return { k: prevK, d: prevD, j: 3 * prevK - 2 * prevD };
}

/**
 * 计算布林带（BOLL）
 * @param {number[]} closes     收盘价数组
 * @param {number}   period     周期，默认 20
 * @param {number}   multiplier 标准差倍数，默认 2
 * @returns {{ upper: number, middle: number, lower: number, bandwidth: number }}
 */
export function calcBOLL(closes, period = 20, multiplier = 2) {
  if (closes.length < period) {
    return { upper: NaN, middle: NaN, lower: NaN, bandwidth: NaN };
  }

  const slice = closes.slice(-period);
  const middle = slice.reduce((s, v) => s + v, 0) / period;

  const variance = slice.reduce((s, v) => s + (v - middle) ** 2, 0) / period;
  const std = Math.sqrt(variance);

  const upper = middle + multiplier * std;
  const lower = middle - multiplier * std;
  const bandwidth = middle !== 0 ? (upper - lower) / middle : NaN;

  return { upper, middle, lower, bandwidth };
}

// ══════════════════════════════════════════════════════════════
// 二、综合分析函数
// ══════════════════════════════════════════════════════════════

/**
 * 综合技术分析
 * @param {Array}  klineData  K 线数据 [{ time, open, high, low, close, volume }]
 * @param {Object} stockInfo  { code, name, price, changePct, open, high, low, prevClose }
 * @returns {Object} 完整分析结果
 */
export function analyze(klineData, stockInfo) {
  if (!klineData || klineData.length < 20) {
    return emptyResult(stockInfo);
  }

  const closes = klineData.map(b => b.close);
  const highs  = klineData.map(b => b.high);
  const lows   = klineData.map(b => b.low);
  const volumes = klineData.map(b => b.volume);
  const n = closes.length;
  const price = stockInfo?.price != null ? Number(stockInfo.price) : closes[n - 1];

  // ── 指标计算 ────────────────────────────────────────
  const ma5  = calcMA(closes, 5);
  const ma10 = calcMA(closes, 10);
  const ma20 = calcMA(closes, 20);
  const ma60 = n >= 60 ? calcMA(closes, 60) : NaN;
  const macdResult = calcMACD(closes);
  const rsiValue   = calcRSI(closes, 14);
  const kdjResult  = calcKDJ(highs, lows, closes, 9);
  const bollResult = calcBOLL(closes, 20, 2);

  // ── 趋势判断 ────────────────────────────────────────
  const trend = buildTrend(price, closes, ma5, ma10, ma20, ma60, n);

  // ── 量能分析 ────────────────────────────────────────
  const volume = buildVolume(volumes, n);

  // ── 信号集合 ────────────────────────────────────────
  const signals = buildSignals(macdResult, rsiValue, ma5, ma10, ma20);

  // ── 支撑压力位 ──────────────────────────────────────
  const keyLevels = buildKeyLevels(highs, lows, price, n);

  // ── 综合评分 ────────────────────────────────────────
  const score = buildScore(price, ma20, ma60, ma5, ma10, macdResult, rsiValue, volume, keyLevels, trend);

  // ── 综合文字摘要 ────────────────────────────────────
  const summary = buildSummary(trend, macdResult, rsiValue, volume, score);

  return {
    trend,
    volume,
    signals,
    keyLevels,
    score,
    summary,
  };
}

// ══════════════════════════════════════════════════════════════
// 内部辅助函数
// ══════════════════════════════════════════════════════════════

function buildTrend(price, closes, ma5, ma10, ma20, ma60, n) {
  const priceVsMA20 = isNaN(ma20) ? null : ((price - ma20) / ma20) * 100;

  // 方向判断：MA20 斜率 + 价格相对位置
  let direction = 'sideways';
  if (!isNaN(ma20) && n >= 25) {
    const ma20_5ago = calcMA(closes.slice(0, n - 5), 20);
    if (!isNaN(ma20_5ago)) {
      const slope = (ma20 - ma20_5ago) / ma20_5ago;
      if (slope > 0.005 && price > ma20) direction = 'up';
      else if (slope < -0.005 && price < ma20) direction = 'down';
    }
  }

  // 强度判断
  let strength = 'weak';
  if (!isNaN(ma20)) {
    const deviation = Math.abs(priceVsMA20);
    if (deviation > 3) strength = 'strong';
  }
  // 多头排列加强
  if (!isNaN(ma5) && !isNaN(ma10) && !isNaN(ma20) && ma5 > ma10 && ma10 > ma20) {
    strength = 'strong';
  }

  // 描述
  let description = '';
  if (direction === 'up') {
    description = '当前呈上升趋势';
    if (!isNaN(ma20)) description += `，价格${price > ma20 ? '站上' : '回落至'}MA20`;
  } else if (direction === 'down') {
    description = '当前呈下降趋势';
    if (!isNaN(ma20)) description += `，价格${price < ma20 ? '跌破' : '反弹至'}MA20下方`;
  } else {
    description = '当前处于震荡整理';
    if (!isNaN(ma20)) description += `，价格围绕MA20波动`;
  }

  return {
    direction,
    strength,
    description,
    ma20: isNaN(ma20) ? null : Number(ma20.toFixed(2)),
    priceVsMA20: priceVsMA20 != null ? Number(priceVsMA20.toFixed(2)) : null,
  };
}

function buildVolume(volumes, n) {
  if (n < 6) {
    return { status: 'normal', ratio: 1, description: '数据不足' };
  }
  const todayVol = volumes[n - 1];
  const avg5 = volumes.slice(-6, -1).reduce((s, v) => s + v, 0) / 5;
  const ratio = avg5 > 0 ? todayVol / avg5 : 1;

  let status = 'normal';
  if (ratio > 1.5) status = 'increasing';
  else if (ratio < 0.8) status = 'decreasing';

  let description = '';
  const pctDiff = ((ratio - 1) * 100).toFixed(0);
  if (status === 'increasing') description = `成交量较5日均量放大${pctDiff}%`;
  else if (status === 'decreasing') description = `成交量较5日均量缩小${Math.abs(pctDiff)}%`;
  else description = '成交量与5日均量基本持平';

  return { status, ratio: Number(ratio.toFixed(2)), description };
}

function buildSignals(macdResult, rsiValue, ma5, ma10, ma20) {
  // MACD 信号
  const macd = macdResult.trend;

  // RSI 信号
  let rsiStatus = 'normal';
  if (rsiValue > 80) rsiStatus = 'overbought';
  else if (rsiValue < 20) rsiStatus = 'oversold';

  // 均线排列
  let ma = 'mixed';
  if (!isNaN(ma5) && !isNaN(ma10) && !isNaN(ma20)) {
    if (ma5 > ma10 && ma10 > ma20) ma = 'bullish_alignment';
    else if (ma5 < ma10 && ma10 < ma20) ma = 'bearish_alignment';
  }

  return {
    macd,
    rsi: { value: isNaN(rsiValue) ? null : Number(rsiValue.toFixed(1)), status: rsiStatus },
    ma,
  };
}

function buildKeyLevels(highs, lows, price, n) {
  const lookback = Math.min(20, n);
  const recentHighs = highs.slice(-lookback);
  const recentLows  = lows.slice(-lookback);

  // 取两个最高的高点作为压力位
  const sortedHighs = [...recentHighs].sort((a, b) => b - a);
  const resistance = [];
  if (sortedHighs.length > 0 && sortedHighs[0] > price) {
    resistance.push(Number(sortedHighs[0].toFixed(2)));
  }
  if (sortedHighs.length > 1 && sortedHighs[1] > price && Math.abs(sortedHighs[1] - sortedHighs[0]) / sortedHighs[0] > 0.01) {
    resistance.push(Number(sortedHighs[1].toFixed(2)));
  }

  // 取两个最低的低点作为支撑位
  const sortedLows = [...recentLows].sort((a, b) => a - b);
  const support = [];
  if (sortedLows.length > 0 && sortedLows[0] < price) {
    support.push(Number(sortedLows[0].toFixed(2)));
  }
  if (sortedLows.length > 1 && sortedLows[1] < price && Math.abs(sortedLows[1] - sortedLows[0]) / sortedLows[0] > 0.01) {
    support.push(Number(sortedLows[1].toFixed(2)));
  }

  // 判断当前位置
  let currentZone = 'middle';
  const nearThreshold = 0.03; // ±3%
  const nearSupport = support.some(s => Math.abs(price - s) / s <= nearThreshold);
  const nearResistance = resistance.some(r => Math.abs(price - r) / r <= nearThreshold);
  if (nearSupport) currentZone = 'near_support';
  else if (nearResistance) currentZone = 'near_resistance';

  return { resistance, support, currentZone };
}

function buildScore(price, ma20, ma60, ma5, ma10, macdResult, rsiValue, volume, keyLevels, trend) {
  let score = 0;

  // ── 趋势得分 (30 分) ──
  if (!isNaN(ma20) && price > ma20) {
    score += 15;
    if (!isNaN(ma60) && price > ma60) score += 10;
    if (!isNaN(ma5) && !isNaN(ma10) && !isNaN(ma20) && ma5 > ma10 && ma10 > ma20) {
      score += 5;
    }
  }
  // 价格在 MA20 之下：0 分（不加分）

  // ── MACD 得分 (25 分) ──
  if (macdResult.trend === 'golden_cross') score += 25;
  else if (macdResult.trend === 'bullish') score += 15;
  else if (macdResult.trend === 'death_cross') score += 0;
  else score += 5; // bearish DIF<DEA

  // ── RSI 得分 (15 分) ──
  if (!isNaN(rsiValue)) {
    if (rsiValue >= 30 && rsiValue <= 70) score += 5;
    else if (rsiValue > 80) score += 5;        // 超买
    else if (rsiValue >= 20 && rsiValue < 30) score += 15; // 偏低，有反弹预期
    else if (rsiValue < 20) score += 10;        // 超卖
    else score += 5; // 70-80 正常偏高
  }

  // ── 量能得分 (15 分) ──
  if (volume.ratio > 1.5) score += 15;
  else if (volume.ratio >= 0.8) score += 10;
  else score += 5;

  // ── 支撑压力位得分 (10 分) ──
  if (keyLevels.currentZone === 'near_support' && trend.direction === 'up') {
    score += 10;
  } else if (keyLevels.currentZone === 'near_resistance') {
    score += 5;
  }

  score = Math.min(100, Math.max(0, score));

  let grade, label;
  if (score >= 70) { grade = 'attention'; label = '可以关注'; }
  else if (score >= 40) { grade = 'watch'; label = '建议观望'; }
  else { grade = 'caution'; label = '注意风险'; }

  return { value: score, grade, label };
}

function buildSummary(trend, macdResult, rsiValue, volume, score) {
  const parts = [];

  // 趋势
  if (trend.direction === 'up') parts.push('技术面偏强');
  else if (trend.direction === 'down') parts.push('技术面偏弱');
  else parts.push('技术面中性');

  // MACD
  if (macdResult.trend === 'golden_cross') parts.push('MACD金叉');
  else if (macdResult.trend === 'death_cross') parts.push('MACD死叉');
  else if (macdResult.trend === 'bullish') parts.push('MACD多头运行');
  else parts.push('MACD处于空头区域');

  // RSI
  if (!isNaN(rsiValue)) {
    if (rsiValue > 80) parts.push('RSI超买需警惕回调');
    else if (rsiValue < 20) parts.push('RSI超卖存在反弹机会');
    else if (rsiValue < 30) parts.push('RSI偏低关注反弹');
  }

  // 建议
  if (score.grade === 'attention') parts.push('可以关注');
  else if (score.grade === 'caution') parts.push('注意风险');
  else parts.push('建议观望');

  return parts.join('，') + '。';
}

function emptyResult(stockInfo) {
  return {
    trend: {
      direction: 'sideways',
      strength: 'weak',
      description: 'K线数据不足，无法判断趋势',
      ma20: null,
      priceVsMA20: null,
    },
    volume: {
      status: 'normal',
      ratio: 1,
      description: '数据不足',
    },
    signals: {
      macd: 'bearish',
      rsi: { value: null, status: 'normal' },
      ma: 'mixed',
    },
    keyLevels: {
      resistance: [],
      support: [],
      currentZone: 'middle',
    },
    score: {
      value: 0,
      grade: 'watch',
      label: '建议观望',
    },
    summary: 'K线数据不足（需≥20根），暂无法进行技术分析。',
  };
}
