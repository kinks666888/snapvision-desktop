/**
 * CryptoMarketCard — 加密货币行情信息卡
 *
 * 展示: 现价、24h 涨跌/高低、成交量、资金费率、多空比、恐慌贪婪指数
 * 配色 (国内惯例): 涨 = 红 #EF5350, 跌 = 绿 #26A69A
 */

import React from 'react';
import type { CryptoQuoteResult, CryptoExtractInfo } from '../types/electron';

const COLOR_UP = '#EF5350';
const COLOR_DOWN = '#26A69A';

function fmtPrice(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return '--';
  if (Math.abs(v) >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (Math.abs(v) >= 1) return v.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  return v.toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
}

function fmtBig(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return '--';
  if (v >= 1e8) return (v / 1e8).toFixed(2) + '亿';
  if (v >= 1e4) return (v / 1e4).toFixed(2) + '万';
  return v.toFixed(2);
}

interface Props {
  quote: CryptoQuoteResult | null;
  extract?: CryptoExtractInfo | null;
  loading?: boolean;
}

export function CryptoMarketCard({ quote, extract, loading }: Props) {
  const symbol = quote?.symbol || extract?.pair || '--';
  const price = quote?.price ?? null;
  const changePct = quote?.change_pct ?? null;
  const upColor = changePct == null ? '#94A3B8' : changePct >= 0 ? COLOR_UP : COLOR_DOWN;

  return (
    <div className="card overflow-hidden animate-fade-in">
      <div className="panel-header">
        <div className="flex items-center gap-1.5">
          <span className="panel-title">加密行情</span>
          {extract?.exchange && (
            <span className="text-dark-600 text-[9px]">{extract.exchange}</span>
          )}
        </div>
        {quote?.source && (
          <span className="text-dark-600 text-[9px] font-mono">{quote.source}</span>
        )}
      </div>

      <div className="p-3">
        {/* 交易对 + 现价 */}
        <div className="flex items-end justify-between mb-2">
          <div>
            <p className="text-dark-200 text-[12px] font-semibold">{symbol}</p>
            {extract?.contract_features?.is_perpetual && (
              <span className="badge mt-0.5" style={{ color: '#B39DDB', backgroundColor: 'rgba(179,157,219,0.1)', fontSize: 8 }}>
                永续合约
              </span>
            )}
          </div>
          <div className="text-right">
            {loading ? (
              <div className="h-6 w-20 bg-dark-800 rounded animate-pulse ml-auto" />
            ) : (
              <>
                <p className="text-[18px] font-bold font-mono tabular-nums" style={{ color: '#E2E8F0' }}>
                  {fmtPrice(price)}
                </p>
                {changePct != null && (
                  <p className="text-[11px] font-medium font-mono tabular-nums" style={{ color: upColor }}>
                    {changePct >= 0 ? '+' : ''}{changePct.toFixed(2)}%
                    <span className="text-[9px] ml-1">24h</span>
                  </p>
                )}
              </>
            )}
          </div>
        </div>

        {/* 24h 高低 */}
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 py-2" style={{ borderTop: '1px solid #222930', borderBottom: '1px solid #222930' }}>
          <Row label="24h 最高" value={fmtPrice(quote?.high ?? null)} />
          <Row label="24h 最低" value={fmtPrice(quote?.low ?? null)} />
          <Row label="24h 量" value={fmtBig(quote?.volume ?? null)} />
          <Row label="24h 额" value={fmtBig(quote?.turnover ?? null)} />
        </div>

        {/* 情绪指标 */}
        <div className="mt-2 space-y-1">
          <SentimentRow
            label="资金费率"
            value={quote?.funding_rate != null ? `${quote.funding_rate.toFixed(4)}%` : '--'}
            hint={
              quote?.funding_rate == null ? undefined
                : quote.funding_rate > 0.05 ? '偏高 · 多头拥挤'
                : quote.funding_rate < -0.05 ? '为负 · 空头拥挤'
                : '正常区间'
            }
            color={
              quote?.funding_rate == null ? '#94A3B8'
                : quote.funding_rate > 0.05 ? COLOR_UP
                : quote.funding_rate < -0.05 ? COLOR_DOWN
                : '#94A3B8'
            }
          />
          <SentimentRow
            label="多空比"
            value={quote?.long_short?.ratio != null ? quote.long_short.ratio.toFixed(3) : '--'}
            hint={quote?.long_short?.long_pct != null
              ? `多 ${quote.long_short.long_pct.toFixed(0)}% / 空 ${quote.long_short.short_pct.toFixed(0)}%`
              : undefined}
            color="#94A3B8"
          />
          <SentimentRow
            label="恐慌贪婪"
            value={quote?.fear_greed?.value != null ? String(quote.fear_greed.value) : '--'}
            hint={quote?.fear_greed?.label ? translateFg(quote.fear_greed.label) : undefined}
            color={fgColor(quote?.fear_greed?.value)}
          />
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-dark-600 text-[9px]">{label}</span>
      <span className="text-dark-300 text-[10px] font-mono tabular-nums">{value}</span>
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
