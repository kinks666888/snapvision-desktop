/**
 * StopLossPanel — ATR dynamic stop-loss suggestion card.
 */

import React, { useMemo } from 'react';
import type { RealtimeQuote, KlineResult } from '../types/electron';
import { calcStopLoss } from '../lib/atrAnalyzer';

interface StopLossPanelProps {
  stockCode: string | null | undefined;
  stockName: string | null | undefined;
  liveQuote: Partial<RealtimeQuote> | null | undefined;
  klineResult: KlineResult | null;
  currentPrice: string | null | undefined;
}

export function StopLossPanel({
  stockCode,
  stockName,
  liveQuote,
  klineResult,
  currentPrice,
}: StopLossPanelProps) {
  const result = useMemo(() => {
    if (!klineResult?.bars || klineResult.bars.length < 15) return null;
    const price = liveQuote?.price ?? (currentPrice ? parseFloat(currentPrice) : null);
    if (!price || isNaN(price)) return null;
    return calcStopLoss(klineResult.bars, price);
  }, [klineResult, liveQuote?.price, currentPrice]);

  if (!result) {
    const barCount = klineResult?.bars?.length ?? 0;
    return (
      <div className="card overflow-hidden">
        <div className="panel-header">
          <span className="panel-title">动态止损</span>
        </div>
        <div className="p-3">
          <p className="text-dark-600 text-[9px] leading-relaxed">
            K线数据不足（当前 {barCount} 根，需至少15根），ATR 无法计算。
          </p>
        </div>
      </div>
    );
  }

  const {
    atr, atrPct, volatilityLevel, volatilityDesc,
    currentPrice: price,
    stopLoss, stopPct,
    target, targetPct,
    rrRatio,
    stopWarning, summary,
  } = result;

  const volColor: Record<string, React.CSSProperties> = {
    low: { color: '#26A69A', backgroundColor: 'rgba(38, 166, 154, 0.1)' },
    medium: { color: '#26A69A', backgroundColor: 'rgba(38, 166, 154, 0.1)' },
    high: { color: '#FFB74D', backgroundColor: 'rgba(255, 183, 77, 0.1)' },
    extreme: { color: '#EF5350', backgroundColor: 'rgba(239, 83, 80, 0.1)' },
  };
  const volStyle = volColor[volatilityLevel] ?? { color: '#636d7b', backgroundColor: 'rgba(52, 60, 74, 0.4)' };

  const totalWidth = 2 + 3;
  const riskPct = (2 / totalWidth) * 100;
  const rewardPct = (3 / totalWidth) * 100;

  return (
    <div className="card overflow-hidden">
      <div className="panel-header">
        <span className="panel-title">动态止损</span>
        <span className="badge" style={volStyle}>{volatilityDesc}</span>
      </div>
      <div className="p-3 space-y-2.5">
        {/* Price grid */}
        <div className="grid grid-cols-3 gap-0">
          <div className="flex flex-col items-center">
            <span className="text-dark-500 text-[9px] mb-1">止损价</span>
            <span className="text-[#EF5350] text-[11px] font-bold font-mono tabular-nums">
              {stopLoss.toFixed(2)}
            </span>
            <span className="text-[#EF5350] text-[9px] font-mono tabular-nums">
              {stopPct > 0 ? '+' : ''}{stopPct.toFixed(2)}%
            </span>
          </div>

          <div className="flex flex-col items-center" style={{ borderLeft: '1px solid #2A313D', borderRight: '1px solid #2A313D' }}>
            <span className="text-dark-500 text-[9px] mb-1">当前价</span>
            <span className="text-dark-100 text-[11px] font-bold font-mono tabular-nums">
              {price.toFixed(2)}
            </span>
            <span className="text-dark-600 text-[9px]">——</span>
          </div>

          <div className="flex flex-col items-center">
            <span className="text-dark-500 text-[9px] mb-1">目标价</span>
            <span className="text-[#26A69A] text-[11px] font-bold font-mono tabular-nums">
              {target.toFixed(2)}
            </span>
            <span className="text-[#26A69A] text-[9px] font-mono tabular-nums">
              +{targetPct.toFixed(2)}%
            </span>
          </div>
        </div>

        {/* Risk-reward bar */}
        <div className="space-y-1">
          <div className="relative h-5 flex items-center">
            <div
              className="h-2 rounded-l-full"
              style={{ width: `${riskPct}%`, background: 'linear-gradient(90deg, rgba(239,83,80,0.5), rgba(239,83,80,0.25))' }}
            />
            <div className="relative flex items-center justify-center" style={{ width: '0px' }}>
              <div className="absolute z-10 w-0.5 h-4 rounded-full" style={{ background: 'rgba(255,255,255,0.5)' }} />
            </div>
            <div
              className="h-2 rounded-r-full"
              style={{ width: `${rewardPct}%`, background: 'linear-gradient(90deg, rgba(38,166,154,0.25), rgba(38,166,154,0.5))' }}
            />
            <div className="absolute -bottom-0.5 left-0 right-0 flex justify-between text-[7px] text-dark-600 px-0.5">
              <span>止损 {stopLoss.toFixed(2)}</span>
              <span>目标 {target.toFixed(2)}</span>
            </div>
          </div>

          <div className="flex justify-center pt-2">
            <span className="text-dark-400 text-[9px] font-medium">风险收益比 1 : {rrRatio.toFixed(2)}</span>
          </div>
        </div>

        <div className="text-dark-600 text-[9px] text-center font-mono">
          ATR(14) = {atr.toFixed(2)} | 约 {atrPct}% | {volatilityDesc}
        </div>

        <div className="px-2 py-1.5 rounded" style={{ background: 'rgba(42,49,61,0.3)', border: '1px solid rgba(42,49,61,0.4)' }}>
          <p className="text-dark-400 text-[9px] leading-relaxed">{summary}</p>
        </div>

        {stopWarning && (
          <div className="px-2 py-1.5 rounded" style={{ background: 'rgba(255,152,0,0.04)', border: '1px solid rgba(255,152,0,0.12)' }}>
            <p className="text-orange-400 text-[9px] leading-relaxed">{stopWarning}</p>
          </div>
        )}
      </div>
    </div>
  );
}
