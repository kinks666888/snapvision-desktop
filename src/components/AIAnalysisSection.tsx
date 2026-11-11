import React, { useState, useEffect, useCallback } from 'react';
import type { StockParseResult, RealtimeQuote, KlineResult, KlineBar } from '../types/electron';
import { getAiAnalysis } from '../services/market-service';
import { analyse } from '../utils/analysis';

interface AIAnalysisSectionProps {
  data: StockParseResult;
  liveQuote?: RealtimeQuote | null;
  klineResult: KlineResult | null;
  klineBars: KlineBar[];
}

// ─── Score Gauge (semicircle 0–100) ─────────────────────

function ScoreGauge({ score }: { score: number }) {
  const pct = Math.min(100, Math.max(0, score));
  const arcLength = 62.83; // π * 20 (radius)
  const dashLen = (pct / 100) * arcLength;
  const color = score >= 65 ? '#EF5350' : score >= 40 ? '#FFB74D' : '#26A69A';

  return (
    <div className="flex items-center gap-2">
      <svg width="48" height="28" viewBox="0 0 48 28">
        <path d="M4 24 A20 20 0 0 1 44 24" fill="none" stroke="#1C2333" strokeWidth="3" strokeLinecap="round" />
        <path
          d="M4 24 A20 20 0 0 1 44 24"
          fill="none" stroke={color} strokeWidth="3" strokeLinecap="round"
          strokeDasharray={`${dashLen} ${arcLength}`}
        />
      </svg>
      <div className="text-right">
        <span className="text-sm font-bold font-numeric tabular-nums" style={{ color }}>{score}</span>
        <span className="text-dark-500 text-[10px] ml-0.5">/100</span>
      </div>
    </div>
  );
}

export function AIAnalysisSection({ data, liveQuote, klineResult, klineBars }: AIAnalysisSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Technical analysis
  const techResult = klineBars.length >= 20 ? analyse(klineBars, liveQuote?.price) : null;

  // DeepSeek AI analysis
  const runAiAnalysis = useCallback(async () => {
    if (!data.stock_code || !klineResult?.bars || klineResult.bars.length < 5) return;
    setLoading(true);
    setError(null);
    try {
      const price = liveQuote?.price ?? data.current_price ?? '--';
      const change = liveQuote?.change_pct != null
        ? `${liveQuote.change_pct > 0 ? '+' : ''}${liveQuote.change_pct.toFixed(2)}%`
        : data.change_percent ?? '--';

      const result = await getAiAnalysis({
        stock_name: data.stock_name ?? '',
        stock_code: data.stock_code,
        price,
        change_pct: change,
        kline_bars: klineResult.bars.slice(-30),
      });

      if (result.success && result.analysis) {
        setAnalysis(result.analysis);
      } else {
        setError(result.error || '分析生成失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI 分析请求失败');
    } finally {
      setLoading(false);
    }
  }, [data.stock_code, data.stock_name, data.current_price, data.change_percent, klineResult, liveQuote]);

  useEffect(() => {
    setAnalysis(null);
    setError(null);
    if (klineResult?.bars && klineResult.bars.length >= 5) {
      runAiAnalysis();
    }
  }, [klineResult, runAiAnalysis]);

  // Summary cards — trend uses pill tag, others use text
  const summaryItems = techResult ? [
    {
      label: '趋势',
      value: techResult.trend.direction,
      pill: true,
      direction: techResult.trend.direction === '上升' ? 'up' as const : techResult.trend.direction === '下降' ? 'down' as const : 'flat' as const,
    },
    { label: '支撑位', value: techResult.keyLevels.support?.toFixed(2) ?? '--', color: 'text-[#26A69A]' },
    { label: '压力位', value: techResult.keyLevels.resistance?.toFixed(2) ?? '--', color: 'text-[#EF5350]' },
    {
      label: '风险',
      value: techResult.score >= 65 ? '偏高' : techResult.score >= 40 ? '中等' : '偏低',
      color: techResult.score >= 65 ? 'text-[#EF5350]' : techResult.score >= 40 ? 'text-yellow-400' : 'text-[#26A69A]',
    },
  ] : [];

  // One-line summary from AI
  const oneLineSummary = analysis ? extractSummary(analysis) : null;

  return (
    <div className="card overflow-hidden animate-slide-up">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-dark-700/20">
        <span className="text-dark-200 text-xs font-semibold">AI 分析</span>
        {techResult && <ScoreGauge score={techResult.score} />}
      </div>

      {/* Content */}
      <div className="p-4 space-y-4">
        {/* Summary cards — 2×2 grid */}
        {summaryItems.length > 0 && (
          <div className="grid grid-cols-2 gap-2">
            {summaryItems.map((item) => (
              <div key={item.label} className="p-2.5 rounded-lg bg-dark-800/30 border border-dark-700/15 text-center">
                <p className="text-dark-500 text-[11px] mb-1">{item.label}</p>
                {item.pill ? (
                  <span className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs font-medium ${
                    item.direction === 'up' ? 'bg-[#26A69A]/10 text-[#26A69A]' :
                    item.direction === 'down' ? 'bg-[#EF5350]/10 text-[#EF5350]' :
                    'bg-dark-700/50 text-dark-400'
                  }`}>
                    {item.direction === 'up' ? '↑' : item.direction === 'down' ? '↓' : '→'} {item.value}
                  </span>
                ) : (
                  <p className={`text-sm font-semibold font-mono ${item.color}`}>{item.value}</p>
                )}
              </div>
            ))}
          </div>
        )}

        {/* AI one-line summary */}
        {loading ? (
          <div className="flex items-center gap-2 py-2">
            <span className="inline-block w-3.5 h-3.5 border-2 border-dark-600 border-t-accent rounded-full animate-spin" />
            <span className="text-dark-400 text-xs">AI 分析中…</span>
          </div>
        ) : error ? (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-dark-500">{error}</span>
            <button onClick={runAiAnalysis} className="btn-ghost text-accent">重试</button>
          </div>
        ) : oneLineSummary ? (
          <p className="text-dark-200 text-sm leading-relaxed">{oneLineSummary}</p>
        ) : null}

        {/* Expand full analysis */}
        {(analysis || techResult) && (
          <>
            <button
              onClick={() => setExpanded(!expanded)}
              className="btn-ghost w-full text-center"
            >
              {expanded ? '收起详细分析' : '查看详细分析'}
            </button>

            {expanded && (
              <div className="space-y-3 animate-fade-in">
                {analysis && (
                  <div className="p-3 rounded-lg bg-dark-800/20 border border-dark-700/10">
                    <p className="text-dark-500 text-[11px] font-medium mb-2">AI 分析</p>
                    <p className="text-dark-300 text-xs leading-relaxed whitespace-pre-wrap">{analysis}</p>
                  </div>
                )}

                {techResult && (
                  <div className="p-3 rounded-lg bg-dark-800/20 border border-dark-700/10 space-y-2">
                    <p className="text-dark-500 text-[11px] font-medium">技术分析</p>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-dark-500">趋势强度</span>
                        <span className="ml-2 text-dark-300">{techResult.trend.strength}</span>
                      </div>
                      <div>
                        <span className="text-dark-500">成交量</span>
                        <span className="ml-2 text-dark-300">{techResult.volume.status}</span>
                      </div>
                      {techResult.maCross.goldCross && (
                        <div>
                          <span className="text-dark-500">均线</span>
                          <span className="ml-2 text-[#26A69A]">金叉</span>
                        </div>
                      )}
                      {techResult.maCross.deadCross && (
                        <div>
                          <span className="text-dark-500">均线</span>
                          <span className="ml-2 text-[#EF5350]">死叉</span>
                        </div>
                      )}
                      {techResult.macdSignal.goldCross && (
                        <div>
                          <span className="text-dark-500">MACD</span>
                          <span className="ml-2 text-[#26A69A]">金叉</span>
                        </div>
                      )}
                      {techResult.macdSignal.deadCross && (
                        <div>
                          <span className="text-dark-500">MACD</span>
                          <span className="ml-2 text-[#EF5350]">死叉</span>
                        </div>
                      )}
                    </div>
                    <p className="text-dark-400 text-[11px] leading-relaxed">{techResult.trend.description}</p>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* Empty state */}
        {!loading && !error && !analysis && !techResult && (
          <p className="text-dark-500 text-xs text-center py-2">
            {klineResult?.bars && klineResult.bars.length >= 5
              ? '正在加载分析…'
              : 'K 线数据不足，无法生成分析'}
          </p>
        )}
      </div>
    </div>
  );
}

/** Extract first meaningful sentence from AI analysis as one-line summary */
function extractSummary(text: string): string {
  const lines = text.split('\n').filter(l => l.trim());
  for (const line of lines) {
    const cleaned = line.replace(/^[#\-*>\s]+/, '').trim();
    if (cleaned.length > 4 && cleaned.length < 100) {
      return cleaned;
    }
  }
  return lines[0]?.slice(0, 80) ?? '';
}
