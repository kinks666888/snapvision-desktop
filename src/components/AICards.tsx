/**
 * AICards — Structured AI analysis cards for the right panel.
 */

import React from 'react';
import type { StockParseResult, RealtimeQuote, KlineResult } from '../types/electron';
import { analyse, type AnalysisResult } from '../utils/analysis';
import type { OhlcvBar } from '../utils/indicators';

import { analyseVolumePrice, type VolumePriceAnalysis } from '../utils/volumePriceAnalysis';
import { detectCandlePatterns, buildPatternSummary } from '../lib/candlePatternAnalyzer';
import type { CandlePattern } from '../types/electron';
import { VolumePriceCard } from './VolumePriceCard';
import { CandlePatternCard } from './CandlePatternCard';
import { LimitAnalysisPanel } from './LimitAnalysisPanel';
import { StopLossPanel } from './StopLossPanel';
import { AIConclusionPanel } from './AIConclusionPanel';

interface AICardsProps {
  data: StockParseResult;
  liveQuote?: RealtimeQuote | null;
  klineResult: KlineResult | null;
}

export function AICards({ data, liveQuote, klineResult }: AICardsProps) {
  const klineBars = klineResult?.bars ?? [];

  const techResult: AnalysisResult | null = klineBars.length >= 20
    ? analyse(klineBars as OhlcvBar[], liveQuote?.price)
    : null;

  const vpResult: VolumePriceAnalysis | null = klineBars.length >= 10
    ? analyseVolumePrice(klineBars as OhlcvBar[])
    : null;

  const candlePatterns: CandlePattern[] = klineBars.length >= 3
    ? detectCandlePatterns(klineBars)
    : [];
  const patternSummary: string = buildPatternSummary(candlePatterns);

  if (!techResult && klineBars.length < 5) {
    return (
      <div className="card p-4 text-center animate-fade-in">
        <p className="text-dark-600 text-[11px]">K 线数据不足，无法生成分析</p>
      </div>
    );
  }

  return (
    <div className="space-y-2 animate-fade-in">
      {techResult && <ScoreCard score={techResult.score} recommendation={techResult.recommendation} />}
      {techResult && <TrendCard trend={techResult.trend} />}
      {techResult && <AdviceCard techResult={techResult} />}
      {techResult && <RiskCard score={techResult.score} keyLevels={techResult.keyLevels} />}
      {techResult && <TechSummaryCard techResult={techResult} />}
      {vpResult && <VolumePriceCard result={vpResult} />}
      {klineBars.length >= 3 && (
        <CandlePatternCard patterns={candlePatterns} summary={patternSummary} />
      )}
      <LimitAnalysisPanel
        stockCode={data.stock_code}
        stockName={data.stock_name}
        liveQuote={liveQuote}
        klineResult={klineResult}
      />
      <StopLossPanel
        stockCode={data.stock_code}
        stockName={data.stock_name}
        liveQuote={liveQuote}
        klineResult={klineResult}
        currentPrice={data.current_price}
      />
      <AIConclusionPanel
        data={data}
        liveQuote={liveQuote}
        klineResult={klineResult}
      />
    </div>
  );
}

// ─── Score Card ────────────────────────────────────────────

function ScoreGauge({ score }: { score: number }) {
  const pct = Math.min(100, Math.max(0, score));
  const arcLength = 62.83;
  const dashLen = (pct / 100) * arcLength;
  const color = score >= 65 ? '#EF5350' : score >= 40 ? '#FFB74D' : '#26A69A';

  return (
    <svg width="40" height="24" viewBox="0 0 48 28">
      <path d="M4 24 A20 20 0 0 1 44 24" fill="none" stroke="#222930" strokeWidth="3" strokeLinecap="round" />
      <path
        d="M4 24 A20 20 0 0 1 44 24"
        fill="none" stroke={color} strokeWidth="3" strokeLinecap="round"
        strokeDasharray={`${dashLen} ${arcLength}`}
      />
    </svg>
  );
}

function ScoreCard({ score, recommendation }: { score: number; recommendation: string }) {
  const scoreColor = score >= 65 ? 'text-[#EF5350]' : score >= 40 ? 'text-[#FFB74D]' : 'text-[#26A69A]';
  const recStyle = recommendation === '信号较强'
    ? { color: '#EF5350', backgroundColor: 'rgba(239, 83, 80, 0.1)' }
    : recommendation === '可以关注'
      ? { color: '#FFB74D', backgroundColor: 'rgba(255, 183, 77, 0.1)' }
      : { color: '#636d7b', backgroundColor: 'rgba(52, 60, 74, 0.4)' };

  return (
    <div className="card overflow-hidden">
      <div className="panel-header">
        <span className="panel-title">综合评分</span>
        <span className="badge" style={recStyle}>{recommendation}</span>
      </div>
      <div className="p-3 flex items-center gap-2.5">
        <ScoreGauge score={score} />
        <div className="flex-1">
          <span className={`text-xl font-bold font-mono tabular-nums ${scoreColor}`}>{score}</span>
          <span className="text-dark-600 text-[10px] ml-0.5">/100</span>
          <div className="mt-1.5 h-[3px] rounded-full overflow-hidden" style={{ backgroundColor: '#222930' }}>
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${score}%`,
                background: `linear-gradient(90deg, #26A69A, #FFB74D 50%, #EF5350)`,
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Trend Card ────────────────────────────────────────────

function TrendCard({ trend }: { trend: AnalysisResult['trend'] }) {
  const dirColor = trend.direction === '上升'
    ? { color: '#26A69A', backgroundColor: 'rgba(38, 166, 154, 0.1)' }
    : trend.direction === '下降'
      ? { color: '#EF5350', backgroundColor: 'rgba(239, 83, 80, 0.1)' }
      : { color: '#636d7b', backgroundColor: 'rgba(52, 60, 74, 0.4)' };
  const strColor = trend.strength === '强势'
    ? { color: '#EF5350', backgroundColor: 'rgba(239, 83, 80, 0.1)' }
    : trend.strength === '弱势'
      ? { color: '#26A69A', backgroundColor: 'rgba(38, 166, 154, 0.1)' }
      : { color: '#636d7b', backgroundColor: 'rgba(52, 60, 74, 0.4)' };

  return (
    <div className="card overflow-hidden">
      <div className="panel-header">
        <span className="panel-title">趋势判断</span>
        <div className="flex items-center gap-1">
          <span className="badge" style={dirColor}>
            {trend.direction === '上升' ? '↑' : trend.direction === '下降' ? '↓' : '→'} {trend.direction}
          </span>
          <span className="badge" style={strColor}>{trend.strength}</span>
        </div>
      </div>
      <div className="p-3">
        <p className="text-dark-300 text-[10px] leading-relaxed">{trend.description}</p>
        {trend.ma20 != null && (
          <p className="text-dark-500 text-[9px] mt-1.5 font-mono">
            MA20: {trend.ma20.toFixed(2)}
            {trend.priceVsMa20 != null && (
              <span className={trend.priceVsMa20 >= 0 ? 'text-[#EF5350]' : 'text-[#26A69A]'}>
                {' '}(距均线 {trend.priceVsMa20 >= 0 ? '+' : ''}{trend.priceVsMa20.toFixed(2)})
              </span>
            )}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Advice Card ───────────────────────────────────────────

function AdviceCard({ techResult }: { techResult: AnalysisResult }) {
  const { maCross, macdSignal, volume } = techResult;

  return (
    <div className="card overflow-hidden">
      <div className="panel-header">
        <span className="panel-title">操作建议</span>
      </div>
      <div className="p-3 space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="text-dark-500 text-[10px] w-10 flex-shrink-0">均线</span>
          {maCross.goldCross && <span className="badge badge-green">金叉</span>}
          {maCross.deadCross && <span className="badge badge-red">死叉</span>}
          {!maCross.goldCross && !maCross.deadCross && (
            <span className="text-dark-300 text-[9px]">{maCross.description}</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-dark-500 text-[10px] w-10 flex-shrink-0">MACD</span>
          {macdSignal.goldCross && <span className="badge badge-green">金叉</span>}
          {macdSignal.deadCross && <span className="badge badge-red">死叉</span>}
          {!macdSignal.goldCross && !macdSignal.deadCross && (
            <span className="text-dark-300 text-[9px]">{macdSignal.description}</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-dark-500 text-[10px] w-10 flex-shrink-0">量能</span>
          <span className="badge" style={
            volume.status === '放量' ? { color: '#EF5350', backgroundColor: 'rgba(239, 83, 80, 0.1)' } :
            volume.status === '缩量' ? { color: '#26A69A', backgroundColor: 'rgba(38, 166, 154, 0.1)' } :
            { color: '#636d7b', backgroundColor: 'rgba(52, 60, 74, 0.4)' }
          }>
            {volume.status} ({volume.ratio.toFixed(2)}x)
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Risk Card ─────────────────────────────────────────────

function RiskCard({ score, keyLevels }: { score: number; keyLevels: AnalysisResult['keyLevels'] }) {
  const riskLevel = score >= 65 ? '偏高' : score >= 40 ? '中等' : '偏低';
  const riskColor = score >= 65 ? 'text-[#EF5350]' : score >= 40 ? 'text-[#FFB74D]' : 'text-[#26A69A]';

  return (
    <div className="card overflow-hidden">
      <div className="panel-header">
        <span className="panel-title">风险分析</span>
        <span className={`text-[11px] font-semibold ${riskColor}`}>{riskLevel}</span>
      </div>
      <div className="p-3">
        <div className="grid grid-cols-2 gap-1.5">
          <div className="flex flex-col gap-0.5 px-2 py-1.5 rounded" style={{ backgroundColor: 'rgba(34, 41, 48, 0.3)', border: '1px solid rgba(42, 49, 61, 0.5)' }}>
            <span className="text-dark-500 text-[9px]">压力位</span>
            <span className="text-[#EF5350] text-[11px] font-mono font-semibold">
              {keyLevels.resistance != null ? keyLevels.resistance.toFixed(2) : '--'}
            </span>
          </div>
          <div className="flex flex-col gap-0.5 px-2 py-1.5 rounded" style={{ backgroundColor: 'rgba(34, 41, 48, 0.3)', border: '1px solid rgba(42, 49, 61, 0.5)' }}>
            <span className="text-dark-500 text-[9px]">支撑位</span>
            <span className="text-[#26A69A] text-[11px] font-mono font-semibold">
              {keyLevels.support != null ? keyLevels.support.toFixed(2) : '--'}
            </span>
          </div>
          {keyLevels.atr != null && (
            <div className="col-span-2 flex items-center justify-between px-2 py-1.5 rounded" style={{ backgroundColor: 'rgba(34, 41, 48, 0.3)', border: '1px solid rgba(42, 49, 61, 0.5)' }}>
              <span className="text-dark-500 text-[9px]">ATR(14)</span>
              <span className="text-dark-200 text-[11px] font-mono font-semibold">{keyLevels.atr.toFixed(2)}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Tech Summary Card ─────────────────────────────────────

function TechSummaryCard({ techResult }: { techResult: AnalysisResult }) {
  const { trend, volume, maCross, macdSignal, keyLevels } = techResult;

  return (
    <div className="card overflow-hidden">
      <div className="panel-header">
        <span className="panel-title">技术面总结</span>
      </div>
      <div className="p-3">
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-dark-500 text-[10px]">趋势</span>
            <span className="text-dark-200 text-[10px]">{trend.direction} / {trend.strength}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-dark-500 text-[10px]">成交量</span>
            <span className="text-dark-200 text-[10px]">{volume.status} ({volume.ratio.toFixed(2)}x)</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-dark-500 text-[10px]">均线形态</span>
            <span className="text-dark-200 text-[10px]">
              {maCross.goldCross ? '金叉' : maCross.deadCross ? '死叉' : maCross.description}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-dark-500 text-[10px]">MACD</span>
            <span className="text-dark-200 text-[10px]">
              {macdSignal.goldCross ? '金叉' : macdSignal.deadCross ? '死叉' : macdSignal.description}
            </span>
          </div>
          {keyLevels.atr != null && (
            <div className="flex items-center justify-between">
              <span className="text-dark-500 text-[10px]">ATR(14)</span>
              <span className="text-dark-200 text-[10px] font-mono">{keyLevels.atr.toFixed(2)}</span>
            </div>
          )}
        </div>
        <p className="text-dark-400 text-[9px] leading-relaxed mt-2 pt-2" style={{ borderTop: '1px solid #2A313D' }}>
          {trend.description}
        </p>
      </div>
    </div>
  );
}
