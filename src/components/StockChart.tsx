/**
 * StockChart — TradingView-grade stock chart using lightweight-charts v5
 *
 * Features:
 *   - Candlestick main chart
 *   - Volume sub-chart
 *   - MA5/MA10/MA20/MA60 overlays
 *   - EMA12/EMA26 overlays
 *   - MACD sub-chart (DIF/DEA lines + histogram)
 *   - RSI sub-chart (6/12/24 lines)
 *   - KDJ sub-chart (K/D/J lines)
 *   - BOLL overlay on main chart
 *   - Time period switching (day/week/month/60m/30m/15m/5m)
 *   - Crosshair, zoom, pan
 */

import React, { useEffect, useRef, useState, useMemo } from 'react';
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type CandlestickData,
  type HistogramData,
  type LineData,
  type Time,
  ColorType,
  CrosshairMode,
  type SeriesMarker,
} from 'lightweight-charts';
import type { KlineBar, KlineResult } from '../types/electron';
import {
  sma,
  ema,
  macd,
  rsi,
  kdj,
  boll,
  type OhlcvBar,
  type IndicatorLine,
  type MacdData,
  type BollData,
  type KdjData,
} from '../utils/indicators';
import { detectCandlePatterns } from '../lib/candlePatternAnalyzer';

// ─── Time validation / normalization ─────────────────────────

/** YYYY-MM-DD daily regex */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Intraday periods that need Unix timestamp */
const INTRADAY_PERIODS = new Set(['5min', '15min', '30min', '60min']);

/**
 * Normalize a raw time value to a format lightweight-charts accepts.
 *
 * Rules:
 *   - daily/weekly/monthly → "YYYY-MM-DD" string (BusinessDay)
 *   - 5min/15min/30min/60min → Unix timestamp in seconds (number)
 *   - Returns null if the value is unusable.
 */
function normalizeTime(raw: unknown, period: ChartPeriod): Time | null {
  if (raw == null) return null;
  const isIntraday = INTRADAY_PERIODS.has(period);

  // Already a number (UTC seconds) — pass through if reasonable
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return raw as Time;
  }

  // String cases
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed === '') return null;

    // "YYYY-MM-DD" → daily/weekly/monthly BusinessDay
    if (DATE_RE.test(trimmed)) {
      return trimmed as Time;
    }

    // "YYYY-MM-DD HH:MM" or "YYYY-MM-DD HH:MM:SS" → intraday
    if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(trimmed)) {
      if (isIntraday) {
        // Convert to Unix timestamp (seconds)
        const ms = Date.parse(trimmed.replace(' ', 'T') + 'Z');
        if (!Number.isFinite(ms)) return null;
        // Sina times are CST (UTC+8), adjust
        const cstMs = ms - 8 * 3600 * 1000;
        return Math.floor((cstMs + 8 * 3600 * 1000) / 1000) as Time;
      }
      // Daily/weekly/monthly: extract just the date part
      return trimmed.slice(0, 10) as Time;
    }

    // Try to interpret as numeric timestamp string
    const num = Number(trimmed);
    if (Number.isFinite(num) && num > 0) return num as Time;

    // Last resort: try Date.parse
    const ms = Date.parse(trimmed);
    if (Number.isFinite(ms)) return Math.floor(ms / 1000) as Time;
  }

  return null;
}

/** Check if a value is a usable Time for lightweight-charts */
function isValidTime(v: unknown): v is Time {
  if (v == null) return false;
  if (typeof v === 'number') return Number.isFinite(v) && v > 0;
  if (typeof v === 'string') {
    const t = v.trim();
    return t !== '' && (DATE_RE.test(t) || Number.isFinite(Number(t)));
  }
  return false;
}

// ─── Types ───────────────────────────────────────────────────

export type ChartPeriod = 'daily' | 'weekly' | 'monthly' | '60min' | '30min' | '15min' | '5min';

interface StockChartProps {
  stockCode: string;
  stockName?: string | null;
  period: ChartPeriod;
  klineResult: KlineResult | null;
  loading: boolean;
  error: string | null;
  onPeriodChange: (period: ChartPeriod) => void;
  /** When true, chart fills its parent container height instead of using minHeight */
  fillContainer?: boolean;
}

// ─── Series refs ─────────────────────────────────────────────

interface SeriesRefs {
  candle: ISeriesApi<'Candlestick'>;
  volume: ISeriesApi<'Histogram'>;
  maLines: ISeriesApi<'Line'>[];
  emaLines: ISeriesApi<'Line'>[];
  bollLines: ISeriesApi<'Line'>[];
  macdDif: ISeriesApi<'Line'> | null;
  macdDea: ISeriesApi<'Line'> | null;
  macdHist: ISeriesApi<'Histogram'> | null;
  rsiLines: ISeriesApi<'Line'>[];
  kdjK: ISeriesApi<'Line'> | null;
  kdjD: ISeriesApi<'Line'> | null;
  kdjJ: ISeriesApi<'Line'> | null;
  /** Candle pattern markers plugin */
  markers: ISeriesMarkersPluginApi<Time> | null;
}

// ─── Period labels ────────────────────────────────────────────

const PERIODS: { key: ChartPeriod; label: string }[] = [
  { key: '5min', label: '5分' },
  { key: '15min', label: '15分' },
  { key: '30min', label: '30分' },
  { key: '60min', label: '60分' },
  { key: 'daily', label: '日K' },
  { key: 'weekly', label: '周K' },
  { key: 'monthly', label: '月K' },
];

// ─── Colors ───────────────────────────────────────────────────

const COLORS = {
  bg: '#0F1115',
  text: '#636d7b',
  grid: '#2A313D18',
  border: '#2A313D',
  up: '#26A69A',
  down: '#EF5350',
  // MA
  ma5: '#4FC3F7',
  ma20: '#FFB74D',
  ma60: '#A5D6A7',
  // EMA
  ema12: '#4FC3F780',
  ema26: '#FFB74D80',
  // MACD
  macdLine: '#4FC3F7',
  macdSignal: '#FFB74D',
  // RSI
  rsi6: '#4FC3F7',
  rsi12: '#FFB74D',
  rsi24: '#A5D6A7',
  // KDJ
  kdjK: '#4FC3F7',
  kdjD: '#EF5350',
  kdjJ: '#FFB74D',
  // BOLL
  bollUpper: '#FF6B9D',
  bollMiddle: '#FFD700',
  bollLower: '#4FC3F7',
  volLow: '#1f242d',
};

// ══════════════════════════════════════════════════════════════
// StockChart Component
// ══════════════════════════════════════════════════════════════

export function StockChart({
  stockCode,
  stockName,
  period,
  klineResult,
  loading,
  error,
  onPeriodChange,
  fillContainer = false,
}: StockChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<SeriesRefs | null>(null);
  const [showMA, setShowMA] = useState(true);
  const [showEMA, setShowEMA] = useState(false);
  const [showBoll, setShowBoll] = useState(false);
  const initDoneRef = useRef(false);

  // ── Derived data ───────────────────────────────────────
  const bars: OhlcvBar[] = useMemo(() => {
    if (!klineResult?.bars || !Array.isArray(klineResult.bars)) return [];

    const normalized: OhlcvBar[] = [];
    for (const b of klineResult.bars) {
      const t = normalizeTime(b.time, period);
      if (t === null) continue;
      if (isNaN(b.open) || isNaN(b.high) || isNaN(b.low) || isNaN(b.close)) continue;
      const timeStr = typeof t === 'number' ? new Date(t * 1000).toISOString().slice(0, 10) : String(t);
      normalized.push({ time: timeStr, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume });
    }

    const seen = new Map<string, OhlcvBar>();
    for (const b of normalized) seen.set(b.time, b);
    const deduped = Array.from(seen.values());
    deduped.sort((a, b) => a.time.localeCompare(b.time));

    const strict: OhlcvBar[] = [];
    let prevTime = '';
    for (const b of deduped) {
      if (b.time > prevTime) { strict.push(b); prevTime = b.time; }
    }
    return strict;
  }, [klineResult]);

  const candlestickData: CandlestickData<Time>[] = useMemo(() => {
    const raw: CandlestickData<Time>[] = [];
    for (const b of bars) {
      const t = normalizeTime(b.time, period);
      if (t === null) continue;
      raw.push({ time: t, open: b.open, high: b.high, low: b.low, close: b.close });
    }
    return sortAndDedup(raw);
  }, [bars]);

  const volumeData: HistogramData<Time>[] = useMemo(() => {
    // 5-day rolling average for low-volume detection
    const volMa5: number[] = [];
    for (let i = 0; i < bars.length; i++) {
      if (i < 4) { volMa5.push(Infinity); continue; }
      let sum = 0;
      for (let j = i - 4; j <= i; j++) sum += bars[j].volume;
      volMa5.push(sum / 5);
    }
    const raw: HistogramData<Time>[] = [];
    for (let i = 0; i < bars.length; i++) {
      const b = bars[i];
      const t = normalizeTime(b.time, period);
      if (t === null) continue;
      const isUp = b.close >= b.open;
      const isLowVol = b.volume < volMa5[i];
      raw.push({
        time: t,
        value: b.volume,
        color: isLowVol
          ? COLORS.volLow
          : isUp
            ? COLORS.up + 'BF'
            : COLORS.down + 'BF',
      });
    }
    return sortAndDedup(raw);
  }, [bars, period]);

  const maLinesData = useMemo(() => {
    if (!showMA || bars.length < 5) return [];
    return [
      { data: sma(bars, 5), color: COLORS.ma5 },
      { data: sma(bars, 20), color: COLORS.ma20 },
      { data: sma(bars, 60), color: COLORS.ma60 },
    ].filter((l) => bars.length >= (l.data.length > 5 ? 5 : 999));
  }, [bars, showMA]);

  const emaLinesData = useMemo(() => {
    if (!showEMA || bars.length < 12) return [];
    return [
      { data: ema(bars, 12), color: COLORS.ema12 },
      { data: ema(bars, 26), color: COLORS.ema26 },
    ];
  }, [bars, showEMA]);

  const bollBandsData = useMemo(() => {
    if (!showBoll || bars.length < 20) return null;
    return boll(bars);
  }, [bars, showBoll]);

  const macdData = useMemo(() => {
    if (bars.length < 26) return null;
    return macd(bars);
  }, [bars]);

  const rsiLinesData = useMemo(() => {
    if (bars.length < 25) return [];
    return [
      { data: rsi(bars, 6), color: COLORS.rsi6 },
      { data: rsi(bars, 12), color: COLORS.rsi12 },
      { data: rsi(bars, 24), color: COLORS.rsi24 },
    ];
  }, [bars]);

  const kdjData = useMemo(() => {
    if (bars.length < 10) return null;
    return kdj(bars);
  }, [bars]);

  // ── Helper: sort ascending + deduplicate by time ───────
  function sortAndDedup<T extends { time: Time }>(data: T[]): T[] {
    // Sort ascending by time
    const sorted = [...data].sort((a, b) => {
      const ta = typeof a.time === 'number' ? a.time : new Date(a.time as string).getTime() / 1000;
      const tb = typeof b.time === 'number' ? b.time : new Date(b.time as string).getTime() / 1000;
      return ta - tb;
    });
    // Deduplicate by time (keep last occurrence)
    const deduped: T[] = [];
    const seen = new Set<string>();
    for (let i = sorted.length - 1; i >= 0; i--) {
      const key = String(sorted[i].time);
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(sorted[i]);
      }
    }
    deduped.reverse();
    return deduped;
  }

  // ── Helper: filter valid indicator data ─────────────────
  function toLineData(data: IndicatorLine[]): LineData<Time>[] {
    const result: LineData<Time>[] = [];
    for (const l of data) {
      if (isNaN(l.value)) continue;
      const t = normalizeTime(l.time, period);
      if (t === null) continue;
      result.push({ time: t, value: l.value });
    }
    return sortAndDedup(result);
  }

  // ═══════════════════════════════════════════════════════
  // 1. Create chart + series ONCE on mount
  // ═══════════════════════════════════════════════════════
  useEffect(() => {
    if (!containerRef.current || initDoneRef.current) return;
    initDoneRef.current = true;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: COLORS.bg },
        textColor: COLORS.text,
      },
      grid: {
        vertLines: { color: COLORS.grid },
        horzLines: { color: COLORS.grid },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: COLORS.border },
      timeScale: {
        borderColor: COLORS.border,
        timeVisible: true,
        secondsVisible: false,
      },
      autoSize: true,
    });

    chartRef.current = chart;

    // Candlestick
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: COLORS.up,
      downColor: COLORS.down,
      borderUpColor: COLORS.up,
      borderDownColor: COLORS.down,
      wickUpColor: COLORS.up,
      wickDownColor: COLORS.down,
    });

    // Volume
    const volSeries = chart.addSeries(HistogramSeries, {
      color: '#6b728040',
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });
    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.85, bottom: 0 },
    });

    // MA placeholders
    const maSeries: ISeriesApi<'Line'>[] = [];
    for (let i = 0; i < 3; i++) {
      maSeries.push(
        chart.addSeries(LineSeries, {
          color: [COLORS.ma5, COLORS.ma20, COLORS.ma60][i],
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
        }),
      );
    }

    // EMA placeholders
    const emaSeries: ISeriesApi<'Line'>[] = [];
    for (let i = 0; i < 2; i++) {
      emaSeries.push(
        chart.addSeries(LineSeries, {
          color: [COLORS.ema12, COLORS.ema26][i],
          lineWidth: 1,
          lineStyle: 2,
          priceLineVisible: false,
          lastValueVisible: false,
        }),
      );
    }

    // BOLL placeholders (3 lines): upper dashed, middle solid, lower dashed
    const bollColors = [COLORS.bollMiddle, COLORS.bollUpper, COLORS.bollLower];
    const bollStyles = [0, 2, 2];
    const bollSeries: ISeriesApi<'Line'>[] = [];
    for (let i = 0; i < 3; i++) {
      bollSeries.push(
        chart.addSeries(LineSeries, {
          color: bollColors[i],
          lineWidth: 1,
          lineStyle: bollStyles[i],
          priceLineVisible: false,
          lastValueVisible: false,
        }),
      );
    }

    // MACD placeholders
    const macdDif = chart.addSeries(LineSeries, {
      color: COLORS.macdLine, lineWidth: 1, priceScaleId: 'macd',
      priceLineVisible: false, lastValueVisible: false,
    });
    const macdDea = chart.addSeries(LineSeries, {
      color: COLORS.macdSignal, lineWidth: 1, priceScaleId: 'macd',
      priceLineVisible: false, lastValueVisible: false,
    });
    const macdHist = chart.addSeries(HistogramSeries, { priceScaleId: 'macd' });
    chart.priceScale('macd').applyOptions({ scaleMargins: { top: 0.1, bottom: 0.1 } });

    // RSI placeholders (3 lines)
    const rsiSeries: ISeriesApi<'Line'>[] = [];
    for (let i = 0; i < 3; i++) {
      rsiSeries.push(
        chart.addSeries(LineSeries, {
          color: [COLORS.rsi6, COLORS.rsi12, COLORS.rsi24][i],
          lineWidth: 1,
          priceScaleId: 'rsi',
          priceLineVisible: false,
          lastValueVisible: false,
        }),
      );
    }
    chart.priceScale('rsi').applyOptions({ scaleMargins: { top: 0.1, bottom: 0.1 } });

    // KDJ placeholders
    const kdjK = chart.addSeries(LineSeries, {
      color: COLORS.kdjK, lineWidth: 1, priceScaleId: 'kdj',
      priceLineVisible: false, lastValueVisible: false,
    });
    const kdjD = chart.addSeries(LineSeries, {
      color: COLORS.kdjD, lineWidth: 1, priceScaleId: 'kdj',
      priceLineVisible: false, lastValueVisible: false,
    });
    const kdjJ = chart.addSeries(LineSeries, {
      color: COLORS.kdjJ, lineWidth: 1, priceScaleId: 'kdj',
      priceLineVisible: false, lastValueVisible: false,
    });
    chart.priceScale('kdj').applyOptions({ scaleMargins: { top: 0.1, bottom: 0.1 } });

    seriesRef.current = {
      candle: candleSeries,
      volume: volSeries,
      maLines: maSeries,
      emaLines: emaSeries,
      bollLines: bollSeries,
      macdDif, macdDea, macdHist,
      rsiLines: rsiSeries,
      kdjK, kdjD, kdjJ,
      markers: createSeriesMarkers(candleSeries),
    };

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      initDoneRef.current = false;
    };
  }, []); // mount only

  // ═══════════════════════════════════════════════════════
  // 2. Update data whenever inputs change
  // ═══════════════════════════════════════════════════════
  useEffect(() => {
    const s = seriesRef.current;
    const chart = chartRef.current;
    if (!s || !chart) return;

    // Final safety: sort ascending, dedup, and validate
    function safeCandleData(data: CandlestickData<Time>[]): CandlestickData<Time>[] {
      let filtered = data.filter((d) => isValidTime(d.time));
      // Sort ascending
      filtered.sort((a, b) => {
        const ta = typeof a.time === 'number' ? a.time : new Date(a.time as string).getTime() / 1000;
        const tb = typeof b.time === 'number' ? b.time : new Date(b.time as string).getTime() / 1000;
        return ta - tb;
      });
      // Dedup (keep last)
      const deduped: CandlestickData<Time>[] = [];
      const seen = new Set<string>();
      for (let i = filtered.length - 1; i >= 0; i--) {
        const key = String(filtered[i].time);
        if (!seen.has(key)) { seen.add(key); deduped.push(filtered[i]); }
      }
      deduped.reverse();
      // Strict ascending check
      const strict: CandlestickData<Time>[] = [];
      let prev = '';
      for (const d of deduped) {
        const cur = String(d.time);
        if (cur > prev) { strict.push(d); prev = cur; }
      }
      return strict;
    }

    function safeVolumeData(data: HistogramData<Time>[]): HistogramData<Time>[] {
      let filtered = data.filter((d) => isValidTime(d.time));
      filtered.sort((a, b) => {
        const ta = typeof a.time === 'number' ? a.time : new Date(a.time as string).getTime() / 1000;
        const tb = typeof b.time === 'number' ? b.time : new Date(b.time as string).getTime() / 1000;
        return ta - tb;
      });
      const deduped: HistogramData<Time>[] = [];
      const seen = new Set<string>();
      for (let i = filtered.length - 1; i >= 0; i--) {
        const key = String(filtered[i].time);
        if (!seen.has(key)) { seen.add(key); deduped.push(filtered[i]); }
      }
      deduped.reverse();
      return deduped;
    }

    const safeCandle = safeCandleData(candlestickData);
    const safeVolume = safeVolumeData(volumeData);

    // Candlestick
    if (safeCandle.length > 0) {
      s.candle.setData(safeCandle);
    } else {
      s.candle.setData([]);
    }

    // Volume
    if (safeVolume.length > 0) {
      s.volume.setData(safeVolume);
    } else {
      s.volume.setData([]);
    }

    // MA
    for (let i = 0; i < s.maLines.length; i++) {
      const ld = i < maLinesData.length ? toLineData(maLinesData[i].data) : [];
      if (ld.length > 0) s.maLines[i].setData(ld);
      else s.maLines[i].setData([]);
    }

    // EMA
    for (let i = 0; i < s.emaLines.length; i++) {
      const ld = i < emaLinesData.length ? toLineData(emaLinesData[i].data) : [];
      if (ld.length > 0) s.emaLines[i].setData(ld);
      else s.emaLines[i].setData([]);
    }

    // BOLL
    if (bollBandsData) {
      s.bollLines[0].setData(toLineData(bollBandsData.middle));
      s.bollLines[1].setData(toLineData(bollBandsData.upper));
      s.bollLines[2].setData(toLineData(bollBandsData.lower));
    } else {
      for (const bl of s.bollLines) bl.setData([]);
    }

    // MACD
    if (macdData) {
      s.macdDif!.setData(toLineData(macdData.dif));
      s.macdDea!.setData(toLineData(macdData.dea));
      const histData: HistogramData<Time>[] = [];
      for (const l of macdData.histogram) {
        if (isNaN(l.value)) continue;
        const t = normalizeTime(l.time, period);
        if (t === null) continue;
        histData.push({
          time: t,
          value: l.value,
          color: l.value >= 0 ? COLORS.up + '80' : COLORS.down + '80',
        });
      }
      s.macdHist!.setData(histData);
    } else {
      s.macdDif!.setData([]);
      s.macdDea!.setData([]);
      s.macdHist!.setData([]);
    }

    // RSI
    for (let i = 0; i < s.rsiLines.length; i++) {
      const ld = i < rsiLinesData.length ? toLineData(rsiLinesData[i].data) : [];
      if (ld.length > 0) s.rsiLines[i].setData(ld);
      else s.rsiLines[i].setData([]);
    }

    // KDJ
    if (kdjData) {
      s.kdjK!.setData(toLineData(kdjData.k));
      s.kdjD!.setData(toLineData(kdjData.d));
      s.kdjJ!.setData(toLineData(kdjData.j));
    } else {
      s.kdjK!.setData([]);
      s.kdjD!.setData([]);
      s.kdjJ!.setData([]);
    }

    // ── Candle Pattern Markers ──────────────────────────
    const latestTime = safeCandle.length > 0 ? safeCandle[safeCandle.length - 1].time : null;
    if (latestTime && bars.length >= 3 && s.markers) {
      const patterns = detectCandlePatterns(bars);
      if (patterns.length > 0) {
        const markers: SeriesMarker<Time>[] = patterns.map((p) => ({
          time: latestTime,
          position: p.signal === 'bullish' ? 'belowBar' as const : 'aboveBar' as const,
          color: p.signal === 'bullish'
            ? '#26a69a'
            : p.signal === 'bearish'
              ? '#ef5350'
              : '#999',
          shape: p.signal === 'bullish'
            ? 'arrowUp' as const
            : p.signal === 'bearish'
              ? 'arrowDown' as const
              : 'circle' as const,
          text: p.name,
        }));
        s.markers.setMarkers(markers);
      } else {
        s.markers.setMarkers([]);
      }
    } else if (s.markers) {
      s.markers.setMarkers([]);
    }

    chart.timeScale().fitContent();
  }, [candlestickData, volumeData, maLinesData, emaLinesData, bollBandsData, macdData, rsiLinesData, kdjData]);

  // ── Render ──────────────────────────────────────────────
  const hasData = candlestickData.length > 0;

  return (
    <div className={fillContainer ? 'h-full flex flex-col' : 'space-y-2 p-3'}>
      {/* Period tabs + indicator toggles */}
      <div className="flex items-center flex-wrap px-3 py-1.5" style={{ borderBottom: '1px solid #2A313D' }}>
        <div className="flex items-center gap-0.5">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              onClick={() => onPeriodChange(p.key)}
              className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                period === p.key
                  ? 'text-accent bg-accent/10'
                  : 'text-dark-500 hover:text-dark-300'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1">
          <IndicatorToggle label="MA" active={showMA} onToggle={() => setShowMA(!showMA)} />
          <IndicatorToggle label="EMA" active={showEMA} onToggle={() => setShowEMA(!showEMA)} />
          <IndicatorToggle label="BOLL" active={showBoll} onToggle={() => setShowBoll(!showBoll)} />
        </div>
      </div>

      {/* Chart container */}
      <div className={`relative overflow-hidden ${fillContainer ? 'flex-1 min-h-0' : 'rounded-lg'}`} style={{ backgroundColor: '#0F1115' }}>
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center" style={{ backgroundColor: 'rgba(15, 17, 21, 0.7)' }}>
            <div className="flex items-center gap-2 text-dark-400 text-[11px]">
              <span className="inline-block w-3.5 h-3.5 border-2 rounded-full animate-spin" style={{ borderColor: '#343c4a', borderTopColor: '#3b82f6' }} />
              加载 K 线数据…
            </div>
          </div>
        )}
        {error && !loading && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2" style={{ backgroundColor: 'rgba(15, 17, 21, 0.7)' }}>
            <p className="text-red-400 text-[11px]">加载失败</p>
            <p className="text-dark-500 text-[10px] max-w-[240px] text-center break-all">{error}</p>
          </div>
        )}
        {!loading && !error && !hasData && (
          <div className="absolute inset-0 z-10 flex items-center justify-center">
            <p className="text-dark-600 text-[11px]">暂无图表数据</p>
          </div>
        )}
        <div ref={containerRef} className="w-full" style={fillContainer ? { height: '100%', width: '100%' } : { height: '100%', minHeight: 400 }} />
      </div>

      {/* Legend */}
      <ChartLegend showMA={showMA} showEMA={showEMA} showBoll={showBoll} />
    </div>
  );
}

// ─── Indicator Toggle ─────────────────────────────────────────

function IndicatorToggle({ label, active, onToggle }: { label: string; active: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-all duration-150 ${
        active
          ? 'text-accent'
          : 'text-dark-600 hover:text-dark-400'
      }`}
      style={active ? { backgroundColor: 'rgba(59, 130, 246, 0.08)' } : undefined}
    >
      {label}
    </button>
  );
}

// ─── Chart Legend ─────────────────────────────────────────────

function ChartLegend({ showMA, showEMA, showBoll }: { showMA: boolean; showEMA: boolean; showBoll: boolean }) {
  const items: { color: string; label: string }[] = [];

  if (showMA) {
    items.push({ color: COLORS.ma5, label: 'MA5' });
    items.push({ color: COLORS.ma20, label: 'MA20' });
    items.push({ color: COLORS.ma60, label: 'MA60' });
  }
  if (showEMA) {
    items.push({ color: COLORS.ema12, label: 'EMA12' });
    items.push({ color: COLORS.ema26, label: 'EMA26' });
  }
  if (showBoll) {
    items.push({ color: COLORS.bollUpper, label: 'BOLL上' });
    items.push({ color: COLORS.bollMiddle, label: 'BOLL中' });
    items.push({ color: COLORS.bollLower, label: 'BOLL下' });
  }

  if (items.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-x-3 gap-y-0.5 px-2 pb-1.5">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-1">
          <span className="w-2.5 h-[2px] rounded" style={{ backgroundColor: item.color }} />
          <span className="text-dark-600 text-[9px]">{item.label}</span>
        </div>
      ))}
    </div>
  );
}
