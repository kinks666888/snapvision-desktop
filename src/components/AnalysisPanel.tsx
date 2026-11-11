/**
 * AnalysisPanel — AI 行情分析面板
 *
 * Displays: trend, volume, support/resistance, MA cross, MACD signal, score, recommendation.
 * Auto-refreshes when stock code or period changes.
 */

import React, { useEffect, useState, useCallback } from 'react';
import type { KlineBar } from '../types/electron';
import { analyse, type AnalysisResult } from '../utils/analysis';
import type { OhlcvBar } from '../utils/indicators';

interface AnalysisPanelProps {
  stockCode: string;
  stockName?: string | null;
  klineBars: KlineBar[];
  livePrice?: number | null;
}

export function AnalysisPanel({ stockCode, stockName, klineBars, livePrice }: AnalysisPanelProps) {
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);

  const runAnalysis = useCallback(() => {
    if (klineBars.length < 20) {
      setAnalysis(null);
      return;
    }
    const bars: OhlcvBar[] = klineBars.map((b) => ({ ...b }));
    const result = analyse(bars, livePrice);
    setAnalysis(result);
  }, [klineBars, livePrice]);

  useEffect(() => {
    runAnalysis();
  }, [runAnalysis]);

  if (!analysis || klineBars.length < 20) {
    return (
      <div className="glass-card p-4 animate-fade-in">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-sm">🤖</span>
          <span className="text-dark-200 text-xs font-semibold tracking-wide">AI 行情分析</span>
        </div>
        <p className="text-dark-500 text-xs text-center py-4">
          {klineBars.length < 20 ? 'K 线数据不足（需 ≥20 根），无法生成分析' : '正在分析…'}
        </p>
      </div>
    );
  }

  const { trend, volume, keyLevels, maCross, macdSignal, score, recommendation, timestamp, disclaimer } = analysis;

  const scoreColor =
    score >= 65 ? 'text-red-400' :
    score >= 40 ? 'text-yellow-400' :
    'text-dark-400';

  const recBg =
    recommendation === '信号较强' ? 'bg-red-500/10 border-red-500/20 text-red-400' :
    recommendation === '可以关注' ? 'bg-yellow-500/10 border-yellow-500/20 text-yellow-400' :
    'bg-dark-500/10 border-dark-700/20 text-dark-400';

  return (
    <div className="glass-card overflow-hidden animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-dark-700/30">
        <div className="flex items-center gap-2">
          <span className="text-sm">🤖</span>
          <span className="text-dark-200 text-xs font-semibold tracking-wide">AI 行情分析</span>
          {stockName && (
            <span className="text-dark-500 text-[11px]">{stockName}</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border ${recBg}`}>
            {recommendation}
          </span>
          <span className={`text-lg font-bold font-mono ${scoreColor}`}>{score}</span>
          <span className="text-dark-600 text-[10px]">分</span>
        </div>
      </div>

      <div className="px-5 py-4 space-y-4">
        {/* Score bar */}
        <div>
          <div className="flex justify-between text-[10px] text-dark-500 mb-1">
            <span>卖出信号</span>
            <span>综合评分</span>
            <span>买入信号</span>
          </div>
          <div className="h-2 rounded-full bg-dark-800/60 overflow-hidden">
            <div className="h-full rounded-full bg-gradient-to-r from-green-500 via-yellow-500 to-red-500" style={{ width: `${score}%` }} />
          </div>
        </div>

        {/* Trend */}
        <Section title="📈 趋势判断">
          <div className="flex items-center gap-2 mb-1">
            <TrendBadge direction={trend.direction} />
            <StrengthBadge strength={trend.strength} />
          </div>
          <p className="text-dark-500 text-[11px]">{trend.description}</p>
          {trend.ma20 != null && (
            <p className="text-dark-600 text-[10px] mt-1">
              MA20: {trend.ma20.toFixed(2)}
              {trend.priceVsMa20 != null && (
                <span className={trend.priceVsMa20 >= 0 ? ' text-red-400' : ' text-green-400'}>
                  {' '}(距均线 {trend.priceVsMa20 >= 0 ? '+' : ''}{trend.priceVsMa20.toFixed(2)})
                </span>
              )}
            </p>
          )}
        </Section>

        {/* Volume */}
        <Section title="📊 量能分析">
          <div className="flex items-center gap-2 mb-1">
            <VolBadge status={volume.status} />
          </div>
          <p className="text-dark-500 text-[11px]">{volume.description}</p>
          <p className="text-dark-600 text-[10px] mt-1">
            量比: {volume.ratio.toFixed(2)}x
          </p>
        </Section>

        {/* Key levels */}
        <Section title="🎯 关键价位">
          <div className="grid grid-cols-2 gap-3">
            <div className="p-2 rounded bg-dark-800/40 border border-dark-700/30">
              <span className="text-dark-600 text-[10px]">压力位</span>
              <p className="text-red-400 text-xs font-mono font-semibold">
                {keyLevels.resistance != null ? keyLevels.resistance.toFixed(2) : '--'}
              </p>
            </div>
            <div className="p-2 rounded bg-dark-800/40 border border-dark-700/30">
              <span className="text-dark-600 text-[10px]">支撑位</span>
              <p className="text-green-400 text-xs font-mono font-semibold">
                {keyLevels.support != null ? keyLevels.support.toFixed(2) : '--'}
              </p>
            </div>
            {keyLevels.atr != null && (
              <div className="p-2 rounded bg-dark-800/40 border border-dark-700/30 col-span-2">
                <span className="text-dark-600 text-[10px]">ATR(14) 平均真实波幅</span>
                <p className="text-dark-300 text-xs font-mono font-semibold">
                  {keyLevels.atr.toFixed(2)}
                </p>
              </div>
            )}
          </div>
        </Section>

        {/* MA Cross */}
        <Section title="📐 均线形态">
          <div className="flex items-center gap-2 mb-1">
            {maCross.goldCross && <span className="text-[10px] px-2 py-0.5 rounded bg-red-500/10 text-red-400 font-medium">金叉 ✨</span>}
            {maCross.deadCross && <span className="text-[10px] px-2 py-0.5 rounded bg-green-500/10 text-green-400 font-medium">死叉</span>}
          </div>
          <p className="text-dark-500 text-[11px]">{maCross.description}</p>
        </Section>

        {/* MACD */}
        <Section title="🔮 MACD 信号">
          <div className="flex items-center gap-2 mb-1">
            {macdSignal.goldCross && <span className="text-[10px] px-2 py-0.5 rounded bg-red-500/10 text-red-400 font-medium">金叉 ✨</span>}
            {macdSignal.deadCross && <span className="text-[10px] px-2 py-0.5 rounded bg-green-500/10 text-green-400 font-medium">死叉</span>}
          </div>
          <p className="text-dark-500 text-[11px]">{macdSignal.description}</p>
        </Section>

        {/* Timestamp & disclaimer */}
        <div className="pt-2 border-t border-dark-700/20">
          <p className="text-dark-600 text-[10px]">
            分析时间: {timestamp}
          </p>
          <p className="text-dark-600 text-[10px] mt-0.5 italic">
            {disclaimer}
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="p-3 rounded-lg bg-dark-800/30 border border-dark-700/20">
      <h4 className="text-dark-400 text-[11px] font-semibold mb-2">{title}</h4>
      {children}
    </div>
  );
}

function TrendBadge({ direction }: { direction: string }) {
  const color = direction === '上升' ? 'text-red-400 bg-red-500/10' : direction === '下降' ? 'text-green-400 bg-green-500/10' : 'text-dark-400 bg-dark-500/10';
  return <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${color}`}>{direction}</span>;
}

function StrengthBadge({ strength }: { strength: string }) {
  const color = strength === '强势' ? 'text-red-400 bg-red-500/10' : strength === '弱势' ? 'text-green-400 bg-green-500/10' : 'text-dark-400 bg-dark-500/10';
  return <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${color}`}>{strength}</span>;
}

function VolBadge({ status }: { status: string }) {
  const color = status === '放量' ? 'text-red-400 bg-red-500/10' : status === '缩量' ? 'text-green-400 bg-green-500/10' : 'text-dark-400 bg-dark-500/10';
  return <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${color}`}>{status}</span>;
}
