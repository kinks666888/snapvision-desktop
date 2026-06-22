/**
 * AnalysisDashboard — Adaptive layout for stock analysis.
 */

import React from 'react';
import type { StockParseResult, RealtimeQuote, KlineResult } from '../types/electron';
import type { ChartPeriod } from './StockChart';
import { StockInfoPanel } from './StockInfoPanel';
import { StockChart } from './StockChart';
import { MetricCards } from './MetricCards';
import { AICards } from './AICards';
import { BottomDrawer } from './BottomDrawer';
import { useResponsive, type LayoutMode } from '../hooks/useResponsive';

interface AnalysisDashboardProps {
  data: StockParseResult;
  liveQuote?: RealtimeQuote | null;
  quoteLoading?: boolean;
  chartPeriod: ChartPeriod;
  klineResult: KlineResult | null;
  klineLoading: boolean;
  klineError: string | null;
  onChartPeriodChange: (period: ChartPeriod) => void;
}

export function AnalysisDashboard({
  data,
  liveQuote,
  quoteLoading,
  chartPeriod,
  klineResult,
  klineLoading,
  klineError,
  onChartPeriodChange,
}: AnalysisDashboardProps) {
  const mode = useResponsive();

  if (mode === 'wide') {
    return (
      <WideLayout
        data={data} liveQuote={liveQuote} quoteLoading={quoteLoading}
        chartPeriod={chartPeriod} klineResult={klineResult}
        klineLoading={klineLoading} klineError={klineError}
        onChartPeriodChange={onChartPeriodChange}
      />
    );
  }

  if (mode === 'standard') {
    return (
      <StandardLayout
        data={data} liveQuote={liveQuote} quoteLoading={quoteLoading}
        chartPeriod={chartPeriod} klineResult={klineResult}
        klineLoading={klineLoading} klineError={klineError}
        onChartPeriodChange={onChartPeriodChange}
      />
    );
  }

  return (
    <CompactLayout
      data={data} liveQuote={liveQuote} quoteLoading={quoteLoading}
      chartPeriod={chartPeriod} klineResult={klineResult}
      klineLoading={klineLoading} klineError={klineError}
      onChartPeriodChange={onChartPeriodChange}
    />
  );
}

// ══════════════════════════════════════════════════════════════
// WIDE LAYOUT — 3 columns
// ══════════════════════════════════════════════════════════════

function WideLayout(props: AnalysisDashboardProps) {
  const { data, liveQuote, quoteLoading, chartPeriod, klineResult, klineLoading, klineError, onChartPeriodChange } = props;

  return (
    <div className="animate-slide-up space-y-3">
      <div className="grid grid-cols-[minmax(200px,1fr)_minmax(0,2.75fr)_minmax(200px,1.25fr)] gap-3"
           style={{ minHeight: 'calc(100vh - 140px)' }}>

        {/* Left Column */}
        <div className="space-y-2 overflow-y-auto no-scrollbar">
          <CompactStockHeader data={data} liveQuote={liveQuote} quoteLoading={quoteLoading} />
          <MetricCards data={data} liveQuote={liveQuote} columns={2} />
          {data.ai_enhanced != null && (
            <div className="flex items-center gap-2 px-2.5 py-1.5 rounded" style={{ backgroundColor: 'rgba(34, 41, 48, 0.3)', border: '1px solid rgba(42, 49, 61, 0.5)' }}>
              <span className={`inline-block w-1.5 h-1.5 rounded-full ${data.ai_enhanced ? 'bg-purple-400' : 'bg-dark-600'}`} />
              <span className="text-dark-400 text-[10px]">
                {data.ai_enhanced ? 'AI 增强识别' : '本地 OCR 识别'}
              </span>
              {data.recognition_source && (
                <span className="text-dark-600 text-[9px] ml-auto">{data.recognition_source}</span>
              )}
            </div>
          )}
          <StockInfoPanel data={data} liveQuote={liveQuote} quoteLoading={quoteLoading} compact />
        </div>

        {/* Center Column (Chart) */}
        <div className="card overflow-hidden flex flex-col">
          <div className="flex-1" style={{ minHeight: 'calc(100vh - 180px)' }}>
            <StockChart
              stockCode={data.stock_code ?? ''}
              stockName={data.stock_name}
              period={chartPeriod}
              klineResult={klineResult}
              loading={klineLoading}
              error={klineError}
              onPeriodChange={onChartPeriodChange}
              fillContainer
            />
          </div>
        </div>

        {/* Right Column (AI) */}
        <div className="space-y-2 overflow-y-auto no-scrollbar">
          <AICards data={data} liveQuote={liveQuote} klineResult={klineResult} />
        </div>
      </div>

      <BottomDrawer data={data} />
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// STANDARD LAYOUT — 2 columns
// ══════════════════════════════════════════════════════════════

function StandardLayout(props: AnalysisDashboardProps) {
  const { data, liveQuote, quoteLoading, chartPeriod, klineResult, klineLoading, klineError, onChartPeriodChange } = props;

  return (
    <div className="animate-slide-up space-y-3">
      <div className="grid grid-cols-[minmax(240px,2fr)_minmax(0,3fr)] gap-3">
        <div className="space-y-2">
          <StockInfoPanel data={data} liveQuote={liveQuote} quoteLoading={quoteLoading} />
          <MetricCards data={data} liveQuote={liveQuote} columns={2} />
        </div>

        <div className="card overflow-hidden flex flex-col">
          <div className="flex-1" style={{ minHeight: '500px' }}>
            <StockChart
              stockCode={data.stock_code ?? ''}
              stockName={data.stock_name}
              period={chartPeriod}
              klineResult={klineResult}
              loading={klineLoading}
              error={klineError}
              onPeriodChange={onChartPeriodChange}
              fillContainer
            />
          </div>
        </div>
      </div>

      <AICards data={data} liveQuote={liveQuote} klineResult={klineResult} />
      <BottomDrawer data={data} />
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// COMPACT LAYOUT — single column
// ══════════════════════════════════════════════════════════════

function CompactLayout(props: AnalysisDashboardProps) {
  const { data, liveQuote, quoteLoading, chartPeriod, klineResult, klineLoading, klineError, onChartPeriodChange } = props;

  return (
    <div className="animate-slide-up space-y-4">
      <StockInfoPanel data={data} liveQuote={liveQuote} quoteLoading={quoteLoading} />
      <MetricCards data={data} liveQuote={liveQuote} columns={2} />

      <div className="card overflow-hidden">
        <StockChart
          stockCode={data.stock_code ?? ''}
          stockName={data.stock_name}
          period={chartPeriod}
          klineResult={klineResult}
          loading={klineLoading}
          error={klineError}
          onPeriodChange={onChartPeriodChange}
        />
      </div>

      <AICards data={data} liveQuote={liveQuote} klineResult={klineResult} />
      <BottomDrawer data={data} />
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// CompactStockHeader — Price/Name/Code only
// ══════════════════════════════════════════════════════════════

function CompactStockHeader({
  data,
  liveQuote,
  quoteLoading,
}: {
  data: StockParseResult;
  liveQuote?: RealtimeQuote | null;
  quoteLoading?: boolean;
}) {
  const quote = liveQuote;
  const changePct = quote?.change_pct;
  const changeColor = changePct != null
    ? changePct > 0 ? 'text-[#26A69A]' : changePct < 0 ? 'text-[#EF5350]' : 'text-dark-200'
    : 'text-dark-400';
  const changeSign = changePct != null && changePct > 0 ? '+' : '';

  return (
    <div className="card p-3">
      <h2 className="text-dark-100 text-[13px] font-semibold truncate">
        {quote?.name ?? data.stock_name ?? '--'}
      </h2>
      <p className="text-dark-500 text-[10px] font-mono mt-0.5">
        {quote?.code ?? data.stock_code ?? ''}
      </p>

      {quoteLoading ? (
        <div className="mt-2 space-y-1">
          <div className="h-5 w-16 bg-dark-800 rounded animate-pulse" />
          <div className="h-3 w-12 bg-dark-800 rounded animate-pulse" />
        </div>
      ) : (
        <div className="mt-2">
          <p className="text-dark-100 text-lg font-semibold font-numeric tabular-nums">
            {quote?.price?.toFixed(2) ?? data.current_price ?? '--'}
          </p>
          <div className="flex items-center gap-1.5 mt-0.5">
            {quote?.change_amt != null && (
              <span className={`text-[11px] font-medium font-numeric tabular-nums ${changeColor}`}>
                {changeSign}{quote.change_amt.toFixed(2)}
              </span>
            )}
            {changePct != null && (
              <span className={`text-[11px] font-medium font-numeric tabular-nums ${changeColor}`}>
                {changeSign}{changePct.toFixed(2)}%
              </span>
            )}
            {!quote && data.change_percent && (
              <span className={`text-[11px] font-medium ${changeColor}`}>
                {data.change_percent}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
