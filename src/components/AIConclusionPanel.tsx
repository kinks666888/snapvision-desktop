/**
 * AIConclusionPanel — Structured AI conclusion panel.
 */

import React, { useMemo } from 'react';
import type { StockParseResult, RealtimeQuote, KlineResult } from '../types/electron';
import type { OhlcvBar } from '../utils/indicators';
import { analyse, type AnalysisResult } from '../utils/analysis';
import { analyseVolumePrice, type VolumePriceAnalysis } from '../utils/volumePriceAnalysis';
import { detectCandlePatterns } from '../lib/candlePatternAnalyzer';
import type { CandlePattern } from '../types/electron';
import { generateAIConclusion, type AIConclusionResult } from '../utils/aiConclusionGenerator';

interface AIConclusionPanelProps {
  data: StockParseResult;
  liveQuote?: RealtimeQuote | null;
  klineResult: KlineResult | null;
}

export function AIConclusionPanel({ data, liveQuote, klineResult }: AIConclusionPanelProps) {
  const klineBars = (klineResult?.bars ?? []) as OhlcvBar[];
  const n = klineBars.length;

  const techResult: AnalysisResult | null = n >= 20
    ? analyse(klineBars, liveQuote?.price)
    : null;

  const vpResult: VolumePriceAnalysis | null = n >= 10
    ? analyseVolumePrice(klineBars)
    : null;

  const candlePatterns: CandlePattern[] = n >= 3
    ? detectCandlePatterns(klineBars as any)
    : [];

  const conclusion = useMemo<AIConclusionResult>(() => {
    return generateAIConclusion({
      data,
      liveQuote: liveQuote ?? null,
      klineBars,
      techResult,
      vpResult,
      candlePatterns,
    });
  }, [data, liveQuote, klineBars, techResult, vpResult, candlePatterns]);

  if (n < 5) {
    return (
      <div className="card overflow-hidden">
        <div className="panel-header">
          <span className="panel-title">AI 结论</span>
        </div>
        <div className="p-3">
          <p className="text-dark-600 text-[10px]">K 线数据不足，无法生成分析结论。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      <div className="panel-header">
        <span className="panel-title">AI 结论</span>
        <span className="text-[9px] text-dark-600 font-mono">{data.stock_code ?? ''}</span>
      </div>
      <div className="p-3 space-y-2.5">
        <SummarySection summary={conclusion.summary} />
        <TrendSection trend={conclusion.trend} />
        <VolumePriceSection vp={conclusion.volumePrice} />
        <RiskSection risk={conclusion.risk} />
        <KeyLevelsSection levels={conclusion.keyLevels} />
        <ActionSection action={conclusion.action} />
        <ConfidenceSection confidence={conclusion.confidence} />
      </div>
    </div>
  );
}

// ─── Sub-Sections ──────────────────────────────────────────

function SummarySection({ summary }: { summary: string }) {
  return (
    <div className="px-2.5 py-2 rounded" style={{ backgroundColor: 'rgba(59, 130, 246, 0.04)', border: '1px solid rgba(59, 130, 246, 0.1)' }}>
      <p className="text-dark-200 text-[10px] leading-relaxed font-medium">{summary}</p>
    </div>
  );
}

function TrendSection({ trend }: { trend: AIConclusionResult['trend'] }) {
  const colors: Record<string, React.CSSProperties> = {
    '多头': { color: '#26A69A', backgroundColor: 'rgba(38, 166, 154, 0.1)' },
    '空头': { color: '#EF5350', backgroundColor: 'rgba(239, 83, 80, 0.1)' },
    '震荡': { color: '#FFB74D', backgroundColor: 'rgba(255, 183, 77, 0.1)' },
  };
  const icons: Record<string, string> = {
    '多头': '▲',
    '空头': '▼',
    '震荡': '◆',
  };

  return (
    <div>
      <SectionTitle title="趋势分析" />
      <div className="flex items-start gap-2">
        <span className="badge flex-shrink-0" style={colors[trend.direction]}>
          {icons[trend.direction]} {trend.direction}
        </span>
        <p className="text-dark-300 text-[9px] leading-relaxed">{trend.reason}</p>
      </div>
    </div>
  );
}

function VolumePriceSection({ vp }: { vp: AIConclusionResult['volumePrice'] }) {
  const labelColors: Record<string, React.CSSProperties> = {
    '放量上涨': { color: '#26A69A', backgroundColor: 'rgba(38, 166, 154, 0.1)' },
    '放量下跌': { color: '#EF5350', backgroundColor: 'rgba(239, 83, 80, 0.1)' },
    '缩量上涨': { color: '#FFB74D', backgroundColor: 'rgba(255, 183, 77, 0.1)' },
    '缩量下跌': { color: '#636d7b', backgroundColor: 'rgba(52, 60, 74, 0.4)' },
    '量价背离': { color: '#a855f7', backgroundColor: 'rgba(168, 85, 247, 0.1)' },
    '量价平稳': { color: '#636d7b', backgroundColor: 'rgba(52, 60, 74, 0.4)' },
  };

  return (
    <div>
      <SectionTitle title="量价分析" />
      <div className="flex items-start gap-2">
        <span className="badge flex-shrink-0" style={labelColors[vp.label]}>{vp.label}</span>
        <p className="text-dark-300 text-[9px] leading-relaxed">{vp.reason}</p>
      </div>
    </div>
  );
}

function RiskSection({ risk }: { risk: AIConclusionResult['risk'] }) {
  const levelColors: Record<string, React.CSSProperties> = {
    '低风险': { color: '#26A69A', backgroundColor: 'rgba(38, 166, 154, 0.1)' },
    '中风险': { color: '#FFB74D', backgroundColor: 'rgba(255, 183, 77, 0.1)' },
    '高风险': { color: '#EF5350', backgroundColor: 'rgba(239, 83, 80, 0.1)' },
  };

  return (
    <div>
      <SectionTitle title="风险提示" />
      <div className="flex items-start gap-2">
        <span className="badge flex-shrink-0" style={levelColors[risk.level]}>{risk.level}</span>
        <p className="text-dark-300 text-[9px] leading-relaxed">{risk.reason}</p>
      </div>
    </div>
  );
}

function KeyLevelsSection({ levels }: { levels: AIConclusionResult['keyLevels'] }) {
  return (
    <div>
      <SectionTitle title="关键位置" />
      <div className="grid grid-cols-2 gap-1.5">
        <div className="flex flex-col gap-0.5 px-2 py-1.5 rounded" style={{ backgroundColor: 'rgba(34, 41, 48, 0.3)', border: '1px solid rgba(42, 49, 61, 0.5)' }}>
          <span className="text-dark-500 text-[9px]">支撑位</span>
          <div className="flex items-baseline gap-1">
            <span className="text-[#26A69A] text-[11px] font-mono font-semibold">
              {levels.support != null ? levels.support.toFixed(2) : '--'}
            </span>
            {levels.distanceToSupport !== '--' && (
              <span className="text-[8px] text-dark-500">{levels.distanceToSupport}</span>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-0.5 px-2 py-1.5 rounded" style={{ backgroundColor: 'rgba(34, 41, 48, 0.3)', border: '1px solid rgba(42, 49, 61, 0.5)' }}>
          <span className="text-dark-500 text-[9px]">压力位</span>
          <div className="flex items-baseline gap-1">
            <span className="text-[#EF5350] text-[11px] font-mono font-semibold">
              {levels.resistance != null ? levels.resistance.toFixed(2) : '--'}
            </span>
            {levels.distanceToResistance !== '--' && (
              <span className="text-[8px] text-dark-500">{levels.distanceToResistance}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ActionSection({ action }: { action: AIConclusionResult['action'] }) {
  const labelColors: Record<string, React.CSSProperties> = {
    '建议关注': { color: '#26A69A', backgroundColor: 'rgba(38, 166, 154, 0.1)' },
    '谨慎持有': { color: '#FFB74D', backgroundColor: 'rgba(255, 183, 77, 0.1)' },
    '继续持有': { color: '#26A69A', backgroundColor: 'rgba(38, 166, 154, 0.1)' },
    '减仓观察': { color: '#EF5350', backgroundColor: 'rgba(239, 83, 80, 0.1)' },
    '逢高止盈': { color: '#fb923c', backgroundColor: 'rgba(251, 146, 60, 0.1)' },
    '观望等待': { color: '#636d7b', backgroundColor: 'rgba(52, 60, 74, 0.4)' },
    '风险较高': { color: '#EF5350', backgroundColor: 'rgba(239, 83, 80, 0.1)' },
  };

  return (
    <div>
      <SectionTitle title="操作建议" />
      <div className="flex items-start gap-2">
        <span className="badge flex-shrink-0" style={labelColors[action.label]}>{action.label}</span>
        <p className="text-dark-300 text-[9px] leading-relaxed">{action.reason}</p>
      </div>
    </div>
  );
}

function ConfidenceSection({ confidence }: { confidence: AIConclusionResult['confidence'] }) {
  const scoreColor = confidence.score >= 80
    ? 'text-[#26A69A]'
    : confidence.score >= 60
      ? 'text-[#FFB74D]'
      : 'text-[#EF5350]';

  const arcLength = 62.83;
  const dashLen = (confidence.score / 100) * arcLength;
  const gaugeColor = confidence.score >= 80 ? '#26A69A' : confidence.score >= 60 ? '#FFB74D' : '#EF5350';

  return (
    <div>
      <SectionTitle title="AI 可信度" />
      <div className="flex items-center gap-2.5">
        <svg width="40" height="24" viewBox="0 0 48 28">
          <path d="M4 24 A20 20 0 0 1 44 24" fill="none" stroke="#222930" strokeWidth="3" strokeLinecap="round" />
          <path
            d="M4 24 A20 20 0 0 1 44 24"
            fill="none" stroke={gaugeColor} strokeWidth="3" strokeLinecap="round"
            strokeDasharray={`${dashLen} ${arcLength}`}
          />
        </svg>
        <div className="flex-1">
          <span className={`text-base font-bold font-mono tabular-nums ${scoreColor}`}>{confidence.score}</span>
          <span className="text-dark-600 text-[9px] ml-0.5">分</span>
          <p className="text-dark-400 text-[8px] mt-0.5 leading-relaxed">{confidence.reason}</p>
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────

function SectionTitle({ title }: { title: string }) {
  return (
    <span className="text-dark-500 text-[9px] font-semibold uppercase block mb-1" style={{ letterSpacing: '0.06em' }}>{title}</span>
  );
}
