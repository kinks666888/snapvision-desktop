import React, { useState } from 'react';
import type { StockParseResult, RealtimeQuote, KlineResult } from '../types/electron';
import { StockChart, type ChartPeriod } from './StockChart';
import { AnalysisPanel } from './AnalysisPanel';
import { DeepSeekAnalysisPanel } from './DeepSeekAnalysisPanel';
import { ErrorBoundary } from './ErrorBoundary';

interface StockCardProps {
  data: StockParseResult;
  liveQuote?: RealtimeQuote | null;
  quoteLoading?: boolean;
  /** K-line chart data + period */
  chartPeriod: ChartPeriod;
  klineResult: KlineResult | null;
  klineLoading: boolean;
  klineError: string | null;
  onChartPeriodChange: (period: ChartPeriod) => void;
}

type Tab = 'info' | 'chart' | 'analysis';

// ─── Value helper ───────────────────────────────────────────

function getChangeColor(val: string | null): string {
  if (!val || val === '--') return 'text-dark-400';
  if (val.startsWith('+')) return 'text-red-400';
  if (val.startsWith('-')) return 'text-green-400';
  return 'text-dark-400';
}

// ══════════════════════════════════════════════════════════════
// StockCard
// ══════════════════════════════════════════════════════════════

export function StockCard({
  data,
  liveQuote,
  quoteLoading,
  chartPeriod,
  klineResult,
  klineLoading,
  klineError,
  onChartPeriodChange,
}: StockCardProps) {
  const s = data;
  const [tab, setTab] = useState<Tab>('info');
  console.log('[StockCard] tab =', tab);

  if (s.error) {
    return (
      <div className="glass-card p-5 animate-fade-in border-yellow-500/20">
        <div className="flex items-start gap-3">
          <span className="text-xl flex-shrink-0">⚠️</span>
          <div>
            <h3 className="text-yellow-300 text-sm font-semibold">未识别到股票信息</h3>
            <p className="text-dark-400 text-xs mt-1">{s.error}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-slide-up">
      {/* ═══════════ Tab Navigation ═══════════ */}
      <div className="flex border-b border-dark-700/30">
        {(['info', 'chart', 'analysis'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => { console.log('[StockCard] tab click:', t); setTab(t); }}
            className={`px-4 py-2.5 text-xs font-medium transition-all duration-150 border-b-2 -mb-px ${
              tab === t
                ? 'text-blue-400 border-blue-400'
                : 'text-dark-500 border-transparent hover:text-dark-300'
            }`}
          >
            {t === 'info' && '📈 概览'}
            {t === 'chart' && '📊 图表'}
            {t === 'analysis' && '🤖 分析'}
          </button>
        ))}
      </div>

      {/* ═══════════ Tab: Info ═══════════ */}
      {tab === 'info' && (
        <div className="space-y-4">
          {/* AI 增强状态提示 */}
          {data.ai_enhanced === false && (
            <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-dark-800/40 border border-dark-700/20">
              <span className="text-xs">🖥️</span>
              <span className="text-dark-400 text-[10px]">本地识别</span>
              <span className="text-dark-600 text-[10px]">·</span>
              <span className="text-dark-500 text-[10px]">未启用 AI 增强分析</span>
              <span
                className="ml-auto text-dark-600 text-[10px] cursor-help"
                title="在环境变量中配置 DEEPSEEK_API_KEY 可启用 AI 视觉模型增强识别"
              >
                ⓘ
              </span>
            </div>
          )}
          {data.ai_enhanced === true && (
            <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-500/5 border border-purple-500/15">
              <span className="text-xs">🤖</span>
              <span className="text-purple-400 text-[10px]">AI 增强识别</span>
            </div>
          )}
          <LiveMarketPanel quote={liveQuote} loading={quoteLoading} />
        </div>
      )}

      {/* ═══════════ Tab: Chart ═══════════ */}
      {tab === 'chart' && (
        <ErrorBoundary name="StockChart">
          <StockChart
            stockCode={s.stock_code ?? ''}
            stockName={s.stock_name}
            period={chartPeriod}
            klineResult={klineResult}
            loading={klineLoading}
            error={klineError}
            onPeriodChange={onChartPeriodChange}
          />
        </ErrorBoundary>
      )}

      {/* ═══════════ Tab: Analysis ═══════════ */}
      {tab === 'analysis' && (
        <div className="space-y-4">
          <DeepSeekAnalysisPanel
            stockName={s.stock_name}
            stockCode={s.stock_code}
            currentPrice={s.current_price}
            changePercent={s.change_percent}
            klineResult={klineResult}
            liveQuote={liveQuote ?? null}
          />
          <AnalysisPanel
            stockCode={s.stock_code ?? ''}
            stockName={s.stock_name}
            klineBars={klineResult?.bars ?? []}
            livePrice={liveQuote?.price}
          />
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// Live Market Panel — 实时行情面板
// ══════════════════════════════════════════════════════════════

function SourceIcon({ source }: { source: string }) {
  const icons: Record<string, string> = {
    sina: '📰',
    tencent: '💬',
    eastmoney: '🏦',
  };
  const labels: Record<string, string> = {
    sina: '新浪财经',
    tencent: '腾讯财经',
    eastmoney: '东方财富',
  };
  return (
    <span className="text-dark-600 text-[10px] inline-flex items-center gap-1" title={labels[source] || source}>
      <span>{icons[source] || '📡'}</span>
      <span>{labels[source] || source}</span>
    </span>
  );
}

function LiveMarketPanel({ quote, loading }: { quote?: RealtimeQuote | null; loading?: boolean }) {
  if (loading) {
    return (
      <div className="glass-card overflow-hidden animate-fade-in border-blue-500/10">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-dark-700/20">
          <span className="text-sm">📡</span>
          <span className="text-dark-300 text-xs font-semibold tracking-wide">实时行情</span>
          <span className="inline-block w-3 h-3 border-2 border-dark-500 border-t-blue-400 rounded-full animate-spin" />
        </div>
        <div className="px-5 py-4">
          <p className="text-dark-500 text-xs text-center">正在获取实时行情数据…</p>
        </div>
      </div>
    );
  }

  if (!quote || quote.error) {
    return null;
  }

  const changePct = quote.change_pct;
  const changeColor = changePct != null
    ? (changePct > 0 ? 'text-red-400' : changePct < 0 ? 'text-green-400' : 'text-dark-400')
    : 'text-dark-400';
  const changeSign = changePct != null && changePct > 0 ? '+' : '';

  // 2-column grid data
  const gridItems = [
    { label: '今开', value: quote.open != null ? quote.open.toFixed(2) : '--', mono: true },
    { label: '昨收', value: quote.prev_close != null ? quote.prev_close.toFixed(2) : '--', mono: true },
    { label: '最高', value: quote.high != null ? quote.high.toFixed(2) : '--', mono: true },
    { label: '最低', value: quote.low != null ? quote.low.toFixed(2) : '--', mono: true },
    { label: '成交量', value: quote.volume ?? '--' },
    { label: '成交额', value: quote.turnover ?? '--' },
    { label: '换手率', value: quote.turnover_rate != null ? `${quote.turnover_rate.toFixed(2)}%` : '--' },
    { label: '市盈率', value: quote.pe != null ? quote.pe.toFixed(2) : '--', mono: true },
    { label: '市净率', value: quote.pb != null ? quote.pb.toFixed(4) : '--', mono: true },
  ];

  return (
    <div className="glass-card overflow-hidden animate-fade-in border-blue-500/10">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-dark-700/20">
        <div className="flex items-center gap-2">
          <span className="text-sm">📡</span>
          <span className="text-dark-200 text-xs font-semibold tracking-wide">实时行情</span>
        </div>
        <div className="flex items-center gap-2">
          {!quote.trading && (
            <span className="text-[10px] px-2 py-0.5 rounded-md bg-dark-500/10 text-dark-500 font-medium">已收盘</span>
          )}
          {quote.trading && (
            <span className="text-[10px] px-2 py-0.5 rounded-md bg-red-500/10 text-red-400 font-medium">交易中</span>
          )}
        </div>
      </div>

      {/* Name + Code + Price */}
      <div className="px-5 pt-4 pb-2">
        <div className="flex items-baseline gap-3">
          <h2 className="text-dark-100 text-lg font-bold">{quote.name ?? '--'}</h2>
          <span className="text-dark-500 text-sm font-mono">{quote.code}</span>
        </div>
      </div>

      <div className="px-5 pb-4">
        <div className="flex items-baseline gap-3">
          <span className="text-dark-100 text-3xl font-bold tabular-nums font-mono">
            {quote.price != null ? quote.price.toFixed(2) : '--'}
          </span>
          <div className="flex items-center gap-2">
            {quote.change_amt != null && (
              <span className={`text-sm font-semibold tabular-nums font-mono ${changeColor}`}>
                {changeSign}{quote.change_amt.toFixed(2)}
              </span>
            )}
            {quote.change_pct != null && (
              <span className={`text-sm font-semibold tabular-nums font-mono ${changeColor}`}>
                {changeSign}{quote.change_pct.toFixed(2)}%
              </span>
            )}
          </div>
        </div>
      </div>

      {/* 2-column grid */}
      <div className="px-5 pb-4">
        <div className="grid grid-cols-2 gap-1">
          {gridItems.map((item) => (
            <div key={item.label} className="flex items-center justify-between px-3 py-2 rounded-lg bg-dark-800/30 border border-dark-700/15">
              <span className="text-dark-500 text-[11px]">{item.label}</span>
              <span className={`text-dark-200 text-xs font-medium tabular-nums ${item.mono ? 'font-mono' : ''}`}>
                {item.value}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Footer: source icon + update time */}
      <div className="px-5 py-2 border-t border-dark-700/15 flex items-center justify-between">
        <SourceIcon source={quote.source} />
        {quote.update_time && (
          <span className="text-dark-600 text-[10px]">{quote.update_time}</span>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// Debug Section — 显示过滤效果和置信度
// ══════════════════════════════════════════════════════════════

function DebugSection({ data }: { data: StockParseResult }) {
  const [expanded, setExpanded] = useState(false);

  const hasDebug =
    data.raw_texts != null ||
    data.filtered_texts != null ||
    data.ignored_texts != null ||
    data.overall_confidence != null ||
    data.debug_info != null;

  if (!hasDebug) return null;

  const rawCount = data.raw_texts?.length ?? 0;
  const filteredCount = data.filtered_texts?.length ?? 0;
  const ignoredCount = data.ignored_texts?.length ?? 0;
  const roiKept = data._ocr_meta?.roi_kept_count ?? filteredCount;
  const roiIgnored = data._ocr_meta?.roi_ignored_count ?? 0;
  const confidence = data.overall_confidence;
  const confPct = confidence != null ? `${(confidence * 100).toFixed(0)}%` : '--';

  return (
    <div className="glass-card overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 border-b border-dark-700/30 hover:bg-dark-800/20 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm">🔍</span>
          <span className="text-dark-300 text-xs font-semibold tracking-wide">调试信息</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-dark-500 text-[10px]">
            置信度 {confPct}
          </span>
          <span className={`text-dark-500 text-xs transition-transform ${expanded ? 'rotate-180' : ''}`}>
            ▼
          </span>
        </div>
      </button>

      {expanded && (
        <div className="px-5 py-4 space-y-4 text-xs">
          {/* ── 过滤统计 ── */}
          <div>
            <h4 className="text-dark-400 font-semibold mb-2">📊 过滤统计</h4>
            <div className="grid grid-cols-2 gap-2">
              <Stat label="OCR 原始行数" value={rawCount} />
              <Stat label="ROI 保留" value={roiKept} />
              <Stat label="ROI 忽略" value={roiIgnored} color="text-dark-500" />
              <Stat label="最终解析" value={filteredCount} />
              <Stat
                label="整体置信度"
                value={confPct}
                color={confidence != null && confidence >= 0.7 ? 'text-green-400' : confidence != null && confidence >= 0.4 ? 'text-yellow-400' : 'text-red-400'}
              />
              <Stat
                label="低置信度警告"
                value={data.low_confidence_warning ? '⚠️ 是' : '✅ 否'}
                color={data.low_confidence_warning ? 'text-yellow-400' : 'text-green-400'}
              />
            </div>
            {data.confidence_warnings && data.confidence_warnings.length > 0 && (
              <div className="mt-2 p-2 rounded bg-yellow-500/5 border border-yellow-500/20">
                {data.confidence_warnings.map((w, i) => (
                  <div key={i} className="text-yellow-400/80 text-[10px]">⚠ {w}</div>
                ))}
              </div>
            )}
          </div>

          {/* ── ROI 时间线 ── */}
          {data._ocr_meta && (
            <div>
              <h4 className="text-dark-400 font-semibold mb-2">⏱ 处理耗时</h4>
              <div className="grid grid-cols-4 gap-2">
                <Stat label="OCR" value={`${data._ocr_meta.ocr_ms}ms`} />
                <Stat label="ROI" value={`${data._ocr_meta.roi_ms ?? '--'}ms`} />
                <Stat label="解析" value={`${data._ocr_meta.parse_ms ?? '--'}ms`} />
                <Stat label="总计" value={`${data._ocr_meta.total_ms}ms`} />
              </div>
            </div>
          )}

          {/* ── 忽略的文本 ── */}
          {data.ignored_texts && data.ignored_texts.length > 0 && (
            <div>
              <h4 className="text-dark-400 font-semibold mb-2">
                🗑 被忽略的文本 ({data.ignored_texts.length})
              </h4>
              <div className="max-h-32 overflow-y-auto rounded bg-dark-800/60 border border-dark-700/30 p-2">
                {data.ignored_texts.map((t, i) => (
                  <div key={i} className="text-dark-500 text-[10px] py-0.5 font-mono">
                    {t || '(空)'}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── 保留的文本 ── */}
          {data.filtered_texts && data.filtered_texts.length > 0 && (
            <div>
              <h4 className="text-dark-400 font-semibold mb-2">
                ✅ 用于解析的文本 ({data.filtered_texts.length})
              </h4>
              <div className="max-h-32 overflow-y-auto rounded bg-dark-800/60 border border-dark-700/30 p-2">
                {data.filtered_texts.map((t, i) => (
                  <div key={i} className="text-dark-300 text-[10px] py-0.5 font-mono">
                    {t || '(空)'}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── 完整 debug_info (JSON) ── */}
          {data.debug_info && (
            <div>
              <h4 className="text-dark-400 font-semibold mb-2">📋 完整调试 JSON</h4>
              <div className="max-h-64 overflow-y-auto rounded bg-dark-800/60 border border-dark-700/30 p-2">
                <pre className="text-dark-400 text-[9px] font-mono whitespace-pre-wrap break-all">
                  {JSON.stringify(data.debug_info, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: string | number;
  color?: string;
}) {
  return (
    <div className="flex flex-col p-2 rounded bg-dark-800/40 border border-dark-700/20">
      <span className="text-dark-500 text-[10px]">{label}</span>
      <span className={`text-sm font-mono font-semibold ${color ?? 'text-dark-200'}`}>
        {value}
      </span>
    </div>
  );
}
