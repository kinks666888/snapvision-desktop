/**
 * UsStockMarketCard — 美股行情信息卡
 *
 * 展示: 现价、涨跌、交易时段 (盘前/盘中/盘后/休市)、52周区间条、
 *      成交量、PE/EPS、市值、VIX 恐慌贪婪情绪
 * 配色 (国内惯例): 涨 = 红 #EF5350, 跌 = 绿 #26A69A
 */

import React from 'react';
import type { UsStockQuoteResult, UsStockExtractInfo } from '../types/electron';

const COLOR_UP = '#EF5350';
const COLOR_DOWN = '#26A69A';

const STATE_COLORS: Record<string, string> = {
  pre: '#FFB74D',      // 盘前 琥珀
  regular: '#26A69A',  // 盘中 绿
  post: '#B39DDB',     // 盘后 紫
  closed: '#636d7b',   // 休市 灰
};

function fmtPrice(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return '--';
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtBig(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return '--';
  if (v >= 1e8) return (v / 1e8).toFixed(2) + '亿';
  if (v >= 1e4) return (v / 1e4).toFixed(2) + '万';
  return v.toFixed(2);
}

interface Props {
  quote: UsStockQuoteResult | null;
  extract?: UsStockExtractInfo | null;
  loading?: boolean;
}

export function UsStockMarketCard({ quote, extract, loading }: Props) {
  const symbol = quote?.symbol || extract?.symbol || '--';
  const name = quote?.name || extract?.name || '';
  const price = quote?.price ?? null;
  const changePct = quote?.change_pct ?? null;
  const upColor = changePct == null ? '#94A3B8' : changePct >= 0 ? COLOR_UP : COLOR_DOWN;
  const state = quote?.market_state;
  const stateColor = state ? (STATE_COLORS[state.state] ?? '#636d7b') : '#636d7b';

  // 52 周区间条位置
  const lo = quote?.low_52w ?? null;
  const hi = quote?.high_52w ?? null;
  const rangePos = price != null && lo != null && hi != null && hi > lo
    ? Math.min(100, Math.max(0, ((price - lo) / (hi - lo)) * 100))
    : null;

  return (
    <div className="card overflow-hidden animate-fade-in">
      <div className="panel-header">
        <div className="flex items-center gap-1.5">
          <span className="panel-title">美股行情</span>
          {quote?.exchange && (
            <span className="text-dark-600 text-[9px]">{quote.exchange}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {state && (
            <span className="badge" style={{ color: stateColor, backgroundColor: `${stateColor}1a`, fontSize: 8 }}>
              {state.label}
            </span>
          )}
          {quote?.source && (
            <span className="text-dark-600 text-[9px] font-mono">{quote.source}</span>
          )}
        </div>
      </div>

      <div className="p-3">
        {/* 代码 + 公司名 + 现价 */}
        <div className="flex items-end justify-between mb-2">
          <div>
            <p className="text-dark-200 text-[12px] font-semibold font-mono">{symbol}</p>
            {name && <p className="text-dark-500 text-[9px] truncate max-w-[120px]">{name}</p>}
            {extract?.platform && (
              <span className="badge mt-0.5" style={{ color: '#B39DDB', backgroundColor: 'rgba(179,157,219,0.1)', fontSize: 8 }}>
                {extract.platform}
              </span>
            )}
          </div>
          <div className="text-right">
            {loading ? (
              <div className="h-6 w-20 bg-dark-800 rounded animate-pulse ml-auto" />
            ) : (
              <>
                <p className="text-[18px] font-bold font-mono tabular-nums" style={{ color: '#E2E8F0' }}>
                  ${fmtPrice(price)}
                </p>
                {changePct != null && (
                  <p className="text-[11px] font-medium font-mono tabular-nums" style={{ color: upColor }}>
                    {changePct >= 0 ? '+' : ''}{changePct.toFixed(2)}%
                    {quote?.change_amt != null && (
                      <span className="text-[9px] ml-1">
                        {quote.change_amt >= 0 ? '+' : ''}{quote.change_amt.toFixed(2)}
                      </span>
                    )}
                  </p>
                )}
              </>
            )}
          </div>
        </div>

        {/* 52 周区间条 */}
        {rangePos != null && (
          <div className="mb-2">
            <div className="flex items-center justify-between text-dark-600 text-[8px] mb-0.5">
              <span>52周低 {fmtPrice(lo)}</span>
              <span>52周高 {fmtPrice(hi)}</span>
            </div>
            <div className="relative h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: '#222930' }}>
              <div
                className="absolute top-0 bottom-0 w-1 rounded-full"
                style={{ left: `calc(${rangePos}% - 2px)`, backgroundColor: upColor }}
              />
            </div>
          </div>
        )}

        {/* 数据行 */}
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 py-2" style={{ borderTop: '1px solid #222930', borderBottom: '1px solid #222930' }}>
          <Row label="今开" value={fmtPrice(quote?.prev_close ?? null)} />
          <Row label="成交量" value={fmtBig(quote?.volume ?? null)} />
          <Row label="市盈率" value={extract?.pe ?? '--'} />
          <Row label="每股收益" value={extract?.eps ? `$${extract.eps}` : '--'} />
          <Row label="市值" value={extract?.market_cap ? `$${extract.market_cap}` : '--'} />
          <Row label="美东时间" value={state?.et_time?.replace(' ET', '') ?? '--'} small />
        </div>

        {/* VIX 情绪 */}
        <div className="mt-2">
          <SentimentRow
            label="恐慌贪婪"
            value={quote?.fear_greed?.value != null ? String(quote.fear_greed.value) : '--'}
            hint={quote?.fear_greed
              ? `${translateFg(quote.fear_greed.label)}${quote.fear_greed.vix != null ? ` · VIX ${quote.fear_greed.vix}` : ''}`
              : undefined}
            color={fgColor(quote?.fear_greed?.value)}
          />
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-dark-600 text-[9px]">{label}</span>
      <span className={`font-mono tabular-nums ${small ? 'text-[9px]' : 'text-[10px]'} text-dark-300`}>{value}</span>
    </div>
  );
}

function SentimentRow({ label, value, hint, color }: {
  label: string; value: string; hint?: string; color: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-dark-500 text-[10px]">{label}</span>
      <div className="flex items-center gap-1.5">
        {hint && <span className="text-dark-600 text-[8px]">{hint}</span>}
        <span className="text-[11px] font-mono tabular-nums font-medium" style={{ color }}>{value}</span>
      </div>
    </div>
  );
}

function translateFg(label: string): string {
  const map: Record<string, string> = {
    'Extreme Fear': '极度恐慌', 'Fear': '恐慌', 'Neutral': '中性',
    'Greed': '贪婪', 'Extreme Greed': '极度贪婪',
  };
  return map[label] ?? label;
}

function fgColor(v: number | null | undefined): string {
  if (v == null) return '#94A3B8';
  if (v <= 25) return COLOR_DOWN;   // 极度恐慌 → 绿(反向机会)
  if (v >= 75) return COLOR_UP;     // 极度贪婪 → 红(反向风险)
  return '#94A3B8';
}
