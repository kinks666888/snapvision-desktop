import { describe, it, expect } from 'vitest';
import {
  identifyMarket,
  detectST,
  analyseLimitUpDown,
  analyseConsecutiveBoards,
  predictBreakoutRisk,
  analyseLimit,
} from './limitAnalysis';
import type { KlineBar, RealtimeQuote } from '../types/electron';

describe('identifyMarket', () => {
  it('detects main board SH stocks', () => {
    expect(identifyMarket('SH600519')).toBe('main_board');
    expect(identifyMarket('SH601318')).toBe('main_board');
    expect(identifyMarket('SH603259')).toBe('main_board');
  });

  it('detects main board SZ stocks', () => {
    expect(identifyMarket('SZ000001')).toBe('main_board');
    expect(identifyMarket('SZ000858')).toBe('main_board');
    expect(identifyMarket('SZ002415')).toBe('main_board');
  });

  it('detects GEM (创业板) stocks', () => {
    expect(identifyMarket('SZ300750')).toBe('gem');
    expect(identifyMarket('SZ300059')).toBe('gem');
    expect(identifyMarket('SZ301123')).toBe('gem');
  });

  it('detects KCB (科创板) stocks', () => {
    expect(identifyMarket('SH688981')).toBe('kcb');
    expect(identifyMarket('SH688001')).toBe('kcb');
  });

  it('detects BJ (北交所) stocks', () => {
    expect(identifyMarket('BJ830799')).toBe('bj');
    expect(identifyMarket('BJ400001')).toBe('bj');
    expect(identifyMarket('BJ920000')).toBe('bj');
  });

  it('handles codes without prefix', () => {
    expect(identifyMarket('600519')).toBe('main_board');
    expect(identifyMarket('300750')).toBe('gem');
    expect(identifyMarket('688981')).toBe('kcb');
  });

  it('returns unknown for invalid codes', () => {
    expect(identifyMarket('')).toBe('unknown');
    expect(identifyMarket('abc')).toBe('unknown');
  });
});

describe('detectST', () => {
  it('detects normal stocks', () => {
    const r = detectST('贵州茅台');
    expect(r.is_st).toBe(false);
    expect(r.is_sst).toBe(false);
    expect(r.st_type).toBeNull();
    expect(r.limit_pct).toBe(10);
    expect(r.risk_warning).toContain('未检测到ST标识');
  });

  it('detects ST stocks', () => {
    const r = detectST('ST康美');
    expect(r.is_st).toBe(true);
    expect(r.is_sst).toBe(false);
    expect(r.st_type).toBe('ST');
    expect(r.limit_pct).toBe(5);
    expect(r.risk_warning).toContain('退市');
  });

  it('detects *ST stocks', () => {
    const r = detectST('*ST贵人');
    expect(r.is_st).toBe(false);
    expect(r.is_sst).toBe(true);
    expect(r.st_type).toBe('*ST');
    expect(r.limit_pct).toBe(5);
  });

  it('handles null name', () => {
    const r = detectST(null);
    expect(r.is_st).toBe(false);
    expect(r.st_type).toBeNull();
  });

  it('handles undefined name', () => {
    const r = detectST(undefined);
    expect(r.is_st).toBe(false);
  });
});

describe('analyseLimitUpDown', () => {
  it('detects limit-up for main board', () => {
    const r = analyseLimitUpDown(11.0, 10.0, { is_st: false, is_sst: false, st_type: null, limit_pct: 10, risk_warning: '' }, 'main_board');
    expect(r.is_limit_up).toBe(true);
    expect(r.is_limit_down).toBe(false);
    expect(r.change_pct).toBeCloseTo(10.0);
    expect(r.limit_up_price).toBeCloseTo(11.0);
  });

  it('detects limit-down for main board', () => {
    const r = analyseLimitUpDown(9.0, 10.0, { is_st: false, is_sst: false, st_type: null, limit_pct: 10, risk_warning: '' }, 'main_board');
    expect(r.is_limit_up).toBe(false);
    expect(r.is_limit_down).toBe(true);
    expect(r.change_pct).toBeCloseTo(-10.0);
  });

  it('detects ST 5% limit', () => {
    const r = analyseLimitUpDown(10.4, 10.0, { is_st: true, is_sst: false, st_type: 'ST', limit_pct: 5, risk_warning: '' }, 'main_board');
    expect(r.is_limit_up).toBe(false);
    expect(r.is_limit_down).toBe(false);
    // 5% limit: limit up = 10.5
    expect(r.limit_up_price).toBeCloseTo(10.5);
    expect(r.distance_to_limit_up_pct).toBeCloseTo(1.0);
  });

  it('detects GEM 20% limit', () => {
    const r = analyseLimitUpDown(23.99, 20.0, { is_st: false, is_sst: false, st_type: null, limit_pct: 20, risk_warning: '' }, 'gem');
    expect(r.is_limit_up).toBe(true);
    expect(r.limit_up_price).toBeCloseTo(24.0);
  });

  it('returns null data when price unavailable', () => {
    const r = analyseLimitUpDown(null, 10.0, { is_st: false, is_sst: false, st_type: null, limit_pct: 10, risk_warning: '' }, 'main_board');
    expect(r.change_pct).toBeNull();
    expect(r.limit_type_label).toBe('暂无数据');
  });
});

describe('analyseConsecutiveBoards', () => {
  function makeBars(closePrices: number[]): KlineBar[] {
    return closePrices.map((close, i) => ({
      time: `2025-06-${String(i + 1).padStart(2, '0')}`,
      open: close * 0.99,
      high: close,
      low: close * 0.98,
      close,
      volume: 100_000,
      turnover: 0,
    }));
  }

  it('detects consecutive limit-ups', () => {
    // Simulate 3 consecutive limit-up days (10% each), last bar also limit-up
    const bars = makeBars([100, 110, 121, 133.1, 146.41]);
    const r = analyseConsecutiveBoards(bars, 10, 146.41);
    expect(r.can_confirm).toBe(true);
    expect(r.count).toBeGreaterThanOrEqual(3);
    expect(r.message).toContain('连板');
  });

  it('returns no boards for normal fluctuations', () => {
    const bars = makeBars([100, 101, 99, 102, 100]);
    const r = analyseConsecutiveBoards(bars, 10, null);
    expect(r.count).toBe(0);
    expect(r.message).toContain('未检测到连续涨停');
  });

  it('returns insufficient data when too few bars', () => {
    const r = analyseConsecutiveBoards([], 10, null);
    expect(r.can_confirm).toBe(false);
    expect(r.message).toContain('数据不足');
  });

  it('returns insufficient data with 2 bars', () => {
    const bars = makeBars([100, 110]);
    const r = analyseConsecutiveBoards(bars, 10, 110);
    expect(r.can_confirm).toBe(false);
    expect(r.message).toContain('数据不足');
  });
});

describe('predictBreakoutRisk', () => {
  const defaultQuote: Partial<RealtimeQuote> = {
    turnover_rate: 3,
    amplitude: 2,
    change_pct: 10,
  };

  it('returns low risk when not at limit', () => {
    const r = predictBreakoutRisk(defaultQuote, [], false);
    expect(r.level).toBe('极低');
    expect(r.score).toBe(0);
    expect(r.explanation).toContain('未触及涨停');
  });

  it('scores higher with high turnover and large amplitude', () => {
    const bars: KlineBar[] = [
      { time: '2025-06-01', open: 100, high: 100, low: 100, close: 100, volume: 5000, turnover: 0 },
      { time: '2025-06-02', open: 100, high: 100, low: 100, close: 100, volume: 5000, turnover: 0 },
      { time: '2025-06-03', open: 100, high: 100, low: 100, close: 100, volume: 5000, turnover: 0 },
      { time: '2025-06-04', open: 100, high: 100, low: 100, close: 100, volume: 5000, turnover: 0 },
      { time: '2025-06-05', open: 100, high: 100, low: 100, close: 100, volume: 5000, turnover: 0 },
      { time: '2025-06-06', open: 110, high: 110, low: 109, close: 110, volume: 20000, turnover: 0 },
    ];
    const quote: Partial<RealtimeQuote> = { turnover_rate: 25, amplitude: 12, change_pct: 10 };
    const r = predictBreakoutRisk(quote, bars, true);
    expect(r.score).toBeGreaterThanOrEqual(50);
    expect(['较高', '极高']).toContain(r.level);
  });

  it('produces explanation with factors', () => {
    const bars: KlineBar[] = [
      { time: '2025-06-01', open: 100, high: 100, low: 100, close: 100, volume: 5000, turnover: 0 },
      { time: '2025-06-02', open: 110, high: 110, low: 110, close: 110, volume: 5000, turnover: 0 },
    ];
    const r = predictBreakoutRisk(defaultQuote, bars, true);
    expect(r.explanation).toBeTruthy();
    expect(r.score).toBeDefined();
  });
});

describe('analyseLimit (main entry)', () => {
  it('returns complete result for normal stock', () => {
    const quote: Partial<RealtimeQuote> = {
      price: 100,
      prev_close: 95,
      turnover_rate: 2,
      amplitude: 1.5,
      code: 'SH600519',
    };
    const r = analyseLimit('SH600519', '贵州茅台', quote, []);
    expect(r.st_status.st_type).toBeNull();
    expect(r.limit.change_pct).toBeCloseTo(5.26, 1);
    expect(r.limit.is_limit_up).toBe(false);
    expect(r.summary).toContain('未触及涨跌停');
  });

  it('handles null inputs gracefully', () => {
    const r = analyseLimit(null, null, null, []);
    expect(r.st_status.is_st).toBe(false);
    expect(r.limit.change_pct).toBeNull();
    expect(r.consecutive.can_confirm).toBe(false);
  });

  it('detects ST stock', () => {
    const r = analyseLimit('SH600123', '*ST贵人', {}, []);
    expect(r.st_status.st_type).toBe('*ST');
    expect(r.st_status.limit_pct).toBe(5);
  });

  it('detects limit-up', () => {
    const quote: Partial<RealtimeQuote> = {
      price: 110,
      prev_close: 100,
      turnover_rate: 5,
      amplitude: 2,
      code: 'SH600519',
    };
    const r = analyseLimit('SH600519', '贵州茅台', quote, []);
    expect(r.limit.is_limit_up).toBe(true);
    expect(r.summary).toContain('已封涨停');
  });
});
