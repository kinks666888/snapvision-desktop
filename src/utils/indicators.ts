/**
 * Technical Indicator Calculation Engine
 *
 * Pure functions — no side effects, no DOM, no chart library dependency.
 * Input: OHLCV bar arrays. Output: indicator arrays aligned to input length.
 */

export interface OhlcvBar {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IndicatorLine {
  time: string;
  value: number;
}

export interface MacdData {
  dif: IndicatorLine[];
  dea: IndicatorLine[];
  histogram: IndicatorLine[]; // (DIF - DEA) * 2
}

export interface BollData {
  upper: IndicatorLine[];
  middle: IndicatorLine[];
  lower: IndicatorLine[];
}

export interface KdjData {
  k: IndicatorLine[];
  d: IndicatorLine[];
  j: IndicatorLine[];
}

// ─── SMA / MA ────────────────────────────────────────────────

/** Simple Moving Average */
export function sma(bars: OhlcvBar[], period: number): IndicatorLine[] {
  const result: IndicatorLine[] = [];
  for (let i = 0; i < bars.length; i++) {
    if (i < period - 1) {
      result.push({ time: bars[i].time, value: NaN });
      continue;
    }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sum += bars[j].close;
    }
    result.push({ time: bars[i].time, value: sum / period });
  }
  return result;
}

// ─── EMA ─────────────────────────────────────────────────────

/** Exponential Moving Average */
export function ema(bars: OhlcvBar[], period: number): IndicatorLine[] {
  const result: IndicatorLine[] = [];
  const k = 2 / (period + 1);
  let prev: number | null = null;
  for (let i = 0; i < bars.length; i++) {
    if (prev === null) {
      // Seed with SMA for the first period
      if (i < period - 1) {
        result.push({ time: bars[i].time, value: NaN });
        continue;
      }
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += bars[j].close;
      prev = sum / period;
    } else {
      prev = bars[i].close * k + prev * (1 - k);
    }
    result.push({ time: bars[i].time, value: prev });
  }
  return result;
}

// ─── MACD ────────────────────────────────────────────────────

/** MACD (12, 26, 9) — standard parameters */
export function macd(
  bars: OhlcvBar[],
  fast = 12,
  slow = 26,
  signal = 9,
): MacdData {
  const emaFast = ema(bars, fast);
  const emaSlow = ema(bars, slow);

  const dif: IndicatorLine[] = [];
  for (let i = 0; i < bars.length; i++) {
    const f = emaFast[i].value;
    const s = emaSlow[i].value;
    dif.push({ time: bars[i].time, value: isNaN(f) || isNaN(s) ? NaN : f - s });
  }

  // DEA = EMA of DIF
  const dea: IndicatorLine[] = [];
  const k = 2 / (signal + 1);
  let prevDea: number | null = null;
  for (let i = 0; i < dif.length; i++) {
    if (isNaN(dif[i].value)) {
      dea.push({ time: bars[i].time, value: NaN });
      continue;
    }
    if (prevDea === null) {
      let sum = 0;
      let count = 0;
      for (let j = Math.max(0, i - signal + 1); j <= i; j++) {
        if (!isNaN(dif[j].value)) { sum += dif[j].value; count++; }
      }
      prevDea = count > 0 ? sum / count : NaN;
    } else {
      prevDea = dif[i].value * k + prevDea * (1 - k);
    }
    dea.push({ time: bars[i].time, value: prevDea });
  }

  // Histogram = (DIF - DEA) * 2
  const histogram: IndicatorLine[] = [];
  for (let i = 0; i < bars.length; i++) {
    const d = dif[i].value;
    const e = dea[i].value;
    histogram.push({
      time: bars[i].time,
      value: isNaN(d) || isNaN(e) ? NaN : (d - e) * 2,
    });
  }

  return { dif, dea, histogram };
}

// ─── RSI ─────────────────────────────────────────────────────

/** RSI (Relative Strength Index) */
export function rsi(bars: OhlcvBar[], period: number): IndicatorLine[] {
  const result: IndicatorLine[] = [];
  const gains: number[] = [];
  const losses: number[] = [];

  for (let i = 1; i < bars.length; i++) {
    const diff = bars[i].close - bars[i - 1].close;
    gains.push(diff > 0 ? diff : 0);
    losses.push(diff < 0 ? -diff : 0);
  }

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < bars.length; i++) {
    if (i === 0) {
      result.push({ time: bars[i].time, value: NaN });
      continue;
    }
    const idx = i - 1;
    if (i < period + 1) {
      // Accumulate
      avgGain += gains[idx];
      avgLoss += losses[idx];
      if (i < period) {
        result.push({ time: bars[i].time, value: NaN });
        continue;
      }
      avgGain /= period;
      avgLoss /= period;
    } else {
      // Wilder's smoothing
      avgGain = (avgGain * (period - 1) + gains[idx]) / period;
      avgLoss = (avgLoss * (period - 1) + losses[idx]) / period;
    }
    if (avgLoss === 0) {
      result.push({ time: bars[i].time, value: 100 });
    } else {
      const rs = avgGain / avgLoss;
      result.push({ time: bars[i].time, value: 100 - 100 / (1 + rs) });
    }
  }
  return result;
}

// ─── KDJ ─────────────────────────────────────────────────────

/** KDJ (9, 3, 3) — standard parameters */
export function kdj(bars: OhlcvBar[], period = 9, kPeriod = 3, dPeriod = 3): KdjData {
  const rsv: number[] = [];
  for (let i = 0; i < bars.length; i++) {
    if (i < period - 1) {
      rsv.push(NaN);
      continue;
    }
    let highest = bars[i].high;
    let lowest = bars[i].low;
    for (let j = i - period + 1; j <= i; j++) {
      if (bars[j].high > highest) highest = bars[j].high;
      if (bars[j].low < lowest) lowest = bars[j].low;
    }
    const range = highest - lowest;
    rsv.push(range === 0 ? 50 : ((bars[i].close - lowest) / range) * 100);
  }

  const k: IndicatorLine[] = [];
  const d: IndicatorLine[] = [];
  const j: IndicatorLine[] = [];
  let prevK = 50;
  let prevD = 50;

  for (let i = 0; i < bars.length; i++) {
    if (isNaN(rsv[i])) {
      k.push({ time: bars[i].time, value: NaN });
      d.push({ time: bars[i].time, value: NaN });
      j.push({ time: bars[i].time, value: NaN });
      continue;
    }
    prevK = (rsv[i] + (kPeriod - 1) * prevK) / kPeriod;
    prevD = (prevK + (dPeriod - 1) * prevD) / dPeriod;
    const jVal = 3 * prevK - 2 * prevD;
    k.push({ time: bars[i].time, value: prevK });
    d.push({ time: bars[i].time, value: prevD });
    j.push({ time: bars[i].time, value: jVal });
  }

  return { k, d, j };
}

// ─── BOLL (Bollinger Bands) ──────────────────────────────────

/** Bollinger Bands (20, 2) */
export function boll(bars: OhlcvBar[], period = 20, multiplier = 2): BollData {
  const middle = sma(bars, period);
  const upper: IndicatorLine[] = [];
  const lower: IndicatorLine[] = [];

  for (let i = 0; i < bars.length; i++) {
    if (i < period - 1 || isNaN(middle[i].value)) {
      upper.push({ time: bars[i].time, value: NaN });
      lower.push({ time: bars[i].time, value: NaN });
      continue;
    }
    let sumSq = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sumSq += (bars[j].close - middle[i].value) ** 2;
    }
    const std = Math.sqrt(sumSq / period);
    upper.push({ time: bars[i].time, value: middle[i].value + multiplier * std });
    lower.push({ time: bars[i].time, value: middle[i].value - multiplier * std });
  }

  return { upper, middle, lower };
}

// ─── Avg Volume ──────────────────────────────────────────────

/** Rolling average volume */
export function avgVolume(bars: OhlcvBar[], period: number): IndicatorLine[] {
  const result: IndicatorLine[] = [];
  for (let i = 0; i < bars.length; i++) {
    if (i < period - 1) {
      result.push({ time: bars[i].time, value: NaN });
      continue;
    }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += bars[j].volume;
    result.push({ time: bars[i].time, value: sum / period });
  }
  return result;
}
