/**
 * Limit Analysis — 涨跌停检测 / 连板统计 / ST 风险识别 / 炸板风险预测
 *
 * 所有判断基于已有行情字段，缺失数据明确提示"暂无数据"。
 * 模块化设计，暴露统一接口 analyseLimit()。
 */

import type { KlineBar, RealtimeQuote } from '../types/electron';

// ─── Types ─────────────────────────────────────────────────────

export type MarketType = 'main_board' | 'gem' | 'kcb' | 'bj' | 'unknown';

export interface LimitRules {
  limit_pct: number;
  label: string;
}

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

// ─── Market Detection ──────────────────────────────────────────

export function identifyMarket(code: string): MarketType {
  const c = code.toUpperCase().replace(/^(SH|SZ|BJ)/, '');
  const num = parseInt(c, 10);
  if (isNaN(num)) return 'unknown';

  // 创业板 300000-301999
  if (num >= 300000 && num <= 301999) return 'gem';

  // 科创板 688000-689999
  if (num >= 688000 && num <= 689999) return 'kcb';

  // 北交所
  if (
    (num >= 400000 && num <= 439999) ||
    (num >= 830000 && num <= 839999) ||
    (num >= 870000 && num <= 879999) ||
    (num >= 920000 && num <= 929999)
  ) return 'bj';

  // SH 主板
  if (
    (num >= 600000 && num <= 609999) ||
    (num >= 601000 && num <= 603999) ||
    (num >= 605000 && num <= 605999)
  ) return 'main_board';

  // SZ 主板
  if (num >= 1 && num <= 4999) return 'main_board';
  if (num >= 200000 && num <= 200999) return 'main_board';

  return 'main_board';
}

export function getLimitRules(market: MarketType, stType: STStatus['st_type']): LimitRules {
  switch (market) {
    case 'gem':
    case 'kcb':
      return { limit_pct: 20, label: '±20%' };
    case 'bj':
      return { limit_pct: 30, label: '±30%' };
    case 'main_board':
      if (stType === 'ST' || stType === '*ST') {
        return { limit_pct: 5, label: '±5%' };
      }
      return { limit_pct: 10, label: '±10%' };
    default:
      return { limit_pct: 10, label: '±10%（默认）' };
  }
}

// ─── ST Detection ──────────────────────────────────────────────

export function detectST(stockName: string | null | undefined): STStatus {
  if (!stockName) {
    return {
      is_st: false,
      is_sst: false,
      st_type: null,
      limit_pct: 10,
      risk_warning: '未检测到ST标识。',
    };
  }

  const name = stockName.toUpperCase();
  const is_sst = name.includes('*ST');
  const is_st = name.includes('ST') && !is_sst;

  const st_type: STStatus['st_type'] = is_sst ? '*ST' : is_st ? 'ST' : null;

  return {
    is_st,
    is_sst,
    st_type,
    limit_pct: st_type ? 5 : 10,
    risk_warning: st_type
      ? 'ST股票波动限制较严格，请注意退市及经营风险。'
      : '未检测到ST标识。',
  };
}

// ─── Limit Up / Down Detection ─────────────────────────────────

export function analyseLimitUpDown(
  price: number | null | undefined,
  prevClose: number | null | undefined,
  stStatus: STStatus,
  market: MarketType,
): LimitUpDown {
  if (price == null || prevClose == null || prevClose === 0) {
    return {
      change_pct: null,
      is_limit_up: false,
      is_limit_down: false,
      limit_up_price: null,
      limit_down_price: null,
      distance_to_limit_up: null,
      distance_to_limit_down: null,
      distance_to_limit_up_pct: null,
      limit_type_label: '暂无数据',
    };
  }

  const { limit_pct } = getLimitRules(market, stStatus.st_type);
  const pct = (price - prevClose) / prevClose * 100;
  const limitUpPrice = prevClose * (1 + limit_pct / 100);
  const limitDownPrice = prevClose * (1 - limit_pct / 100);
  const epsilon = 0.15;

  const isLimitUp = pct >= limit_pct - epsilon;
  const isLimitDown = pct <= -(limit_pct - epsilon);

  const distToUp = limitUpPrice - price;
  const distToDown = price - limitDownPrice;
  const distToUpPct = prevClose > 0 ? (distToUp / prevClose) * 100 : null;

  let limitTypeLabel = '';
  if (isLimitUp) {
    limitTypeLabel = `已触及涨停（${limit_pct.toFixed(0)}.00%）`;
  } else if (isLimitDown) {
    limitTypeLabel = `已触及跌停（${limit_pct.toFixed(0)}.00%）`;
  } else if (distToUpPct != null && distToUpPct > 0 && distToUpPct < limit_pct) {
    limitTypeLabel = `距离涨停还有${distToUpPct.toFixed(2)}%`;
  } else {
    limitTypeLabel = `当前未触及涨跌停`;
  }

  return {
    change_pct: pct,
    is_limit_up: isLimitUp,
    is_limit_down: isLimitDown,
    limit_up_price: limitUpPrice,
    limit_down_price: limitDownPrice,
    distance_to_limit_up: distToUp,
    distance_to_limit_down: distToDown,
    distance_to_limit_up_pct: distToUpPct,
    limit_type_label: limitTypeLabel,
  };
}

// ─── Consecutive Boards ────────────────────────────────────────

export function analyseConsecutiveBoards(
  dailyBars: KlineBar[],
  limitPct: number,
  limitUpPrice: number | null,
): ConsecutiveBoards {
  if (!dailyBars || dailyBars.length < 3) {
    return {
      count: 0,
      label: '数据不足',
      can_confirm: false,
      message: '当前数据不足，无法确认连板数量。',
    };
  }

  // Sort by time ascending
  const sorted = [...dailyBars].sort((a, b) => a.time.localeCompare(b.time));
  if (sorted.length < 3) {
    return {
      count: 0,
      label: '数据不足',
      can_confirm: false,
      message: '当前数据不足，无法确认连板数量。',
    };
  }

  const epsilon = 0.2;
  // Check most recent bars for consecutive limit-up
  // A "limit-up day" is when close >= open * (1 + limitPct - epsilon) and close == high
  // or more precisely, when the day's change >= limitPct
  let count = 0;
  for (let i = sorted.length - 1; i >= 1; i--) {
    const bar = sorted[i];
    const prevBar = sorted[i - 1];
    if (bar.close === 0 || prevBar.close === 0) break;

    const dayChange = (bar.close - prevBar.close) / prevBar.close * 100;
    const closedAtHigh = bar.close >= bar.high * 0.998;

    if (dayChange >= limitPct - epsilon && closedAtHigh) {
      count++;
    } else {
      break;
    }
  }

  if (count === 0) {
    return {
      count: 0,
      label: '无连板',
      can_confirm: true,
      message: '当前未检测到连续涨停。',
    };
  }

  const label = count === 1 ? '首板' : `${count}连板`;

  return {
    count,
    label,
    can_confirm: true,
    message: `当前属于${label}。历史连续涨停次数：${count}天。`,
  };
}

// ─── Breakout Risk Prediction ─────────────────────────────────

export function predictBreakoutRisk(
  quote: Partial<RealtimeQuote> | null | undefined,
  dailyBars: KlineBar[],
  isLimitUp: boolean,
): BreakoutRisk {
  if (!isLimitUp) {
    return {
      level: '极低',
      score: 0,
      explanation: '当前未触及涨停，无需关注炸板风险。',
    };
  }

  // Score from 0-100, higher = more risk
  let score = 0;
  const factors: string[] = [];

  // Factor 1: Turnover rate
  if (quote?.turnover_rate != null) {
    const tr = quote.turnover_rate;
    if (tr > 20) { score += 30; factors.push('换手率极高'); }
    else if (tr > 10) { score += 20; factors.push('换手率偏高'); }
    else if (tr > 5) { score += 10; factors.push('换手率较高'); }
    else { score -= 5; factors.push('换手率较低'); }
  } else {
    factors.push('换手率暂无数据');
  }

  // Factor 2: Amplitude
  if (quote?.amplitude != null) {
    const amp = quote.amplitude;
    if (amp > 10) { score += 20; factors.push('振幅较大'); }
    else if (amp > 5) { score += 10; factors.push('振幅偏高'); }
    else { score -= 5; factors.push('振幅较小'); }
  }

  // Factor 3: Volume analysis (compare with 5-day average)
  if (dailyBars && dailyBars.length >= 6) {
    const sorted = [...dailyBars].sort((a, b) => a.time.localeCompare(b.time));
    const latestVol = sorted[sorted.length - 1].volume;
    if (latestVol > 0) {
      const avg5Vol = sorted.slice(-6, -1).reduce((s, b) => s + b.volume, 0) / 5;
      const volRatio = latestVol / avg5Vol;
      if (volRatio > 2.0) { score += 20; factors.push('尾盘成交量异常放大'); }
      else if (volRatio > 1.5) { score += 10; factors.push('成交量偏高'); }
      else if (volRatio < 0.8) { score -= 5; factors.push('成交量相对萎缩'); }
    }
  }

  // Factor 4: Whether the stock is fully sealed (close == high)
  if (dailyBars && dailyBars.length > 0) {
    const lastBar = dailyBars[dailyBars.length - 1];
    if (lastBar.close < lastBar.high * 0.998) {
      score += 25;
      factors.push('封板不坚决（未封死涨停价）');
    } else {
      score -= 10;
      factors.push('涨停封单稳定');
    }
  }

  // Factor 5: Change percentage vs limit
  if (quote?.change_pct != null) {
    const { limit_pct } = getLimitRules(
      identifyMarket(quote.code || ''),
      null,
    );
    const pctToLimit = quote.change_pct - (limit_pct - 0.15);
    if (pctToLimit < -0.5) {
      score += 15;
      factors.push('距离涨停价位较远');
    }
  }

  // Clamp and map
  score = Math.max(0, Math.min(100, score));

  let level: BreakoutRisk['level'];
  let explanation: string;

  if (score >= 70) {
    level = '极高';
    explanation = '封单不足且多次开板，建议关注盘中资金承接情况。';
  } else if (score >= 50) {
    level = '较高';
    explanation = '尾盘放量明显，换手率偏高，存在资金分歧，炸板风险较高。';
  } else if (score >= 30) {
    level = '中等';
    explanation = '封板质量一般，成交量有所放大，需关注后续资金动向。';
  } else if (score >= 10) {
    level = '较低';
    explanation = '涨停封单稳定，成交量未明显放大，炸板风险较低。';
  } else {
    level = '极低';
    explanation = '封板质量良好，量价配合正常，炸板风险极低。';
  }

  if (factors.length > 0) {
    explanation += `（参考：${factors.join('；')}）`;
  }

  return { level, score, explanation };
}

// ─── Main Entry Point ──────────────────────────────────────────

export function analyseLimit(
  stockCode: string | null | undefined,
  stockName: string | null | undefined,
  quote: Partial<RealtimeQuote> | null | undefined,
  dailyBars: KlineBar[],
  limitTypeLabel?: string,
): LimitAnalysisResult {
  const market = identifyMarket(stockCode || '');
  const stStatus = detectST(stockName);

  const price = quote?.price;
  const prevClose = quote?.prev_close;

  const limit = analyseLimitUpDown(price, prevClose, stStatus, market);

  const { limit_pct } = getLimitRules(market, stStatus.st_type);
  const consecutive = analyseConsecutiveBoards(dailyBars, limit_pct, limit.limit_up_price);

  const breakout = predictBreakoutRisk(quote, dailyBars, limit.is_limit_up);

  // Build summary
  const parts: string[] = [];
  if (limit.is_limit_up) {
    parts.push('当前个股已封涨停');
  } else if (limit.is_limit_down) {
    parts.push('当前个股已封跌停');
  } else {
    parts.push('当前个股未触及涨跌停');
  }

  if (consecutive.can_confirm && consecutive.count > 0) {
    parts.push(`属于${consecutive.label}走势`);
  }

  if (stStatus.st_type) {
    parts.push(`${stStatus.st_type}风险股，涨跌停限制±5%`);
  }

  if (limit.is_limit_up) {
    parts.push(breakout.explanation.split('（')[0].toLowerCase());
  }

  const summary = parts.join('，') + '。';

  return {
    st_status: stStatus,
    limit,
    consecutive,
    breakout,
    summary,
  };
}
