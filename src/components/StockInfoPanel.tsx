import React, { useRef, useState, useEffect } from 'react';
import type { StockParseResult, RealtimeQuote } from '../types/electron';

interface StockInfoPanelProps {
  data: StockParseResult;
  liveQuote?: RealtimeQuote | null;
  quoteLoading?: boolean;
  compact?: boolean;
}

export function StockInfoPanel({ data, liveQuote, quoteLoading, compact = false }: StockInfoPanelProps) {
  const quote = liveQuote;
  const changePct = quote?.change_pct;
  const changeColor = changePct != null
    ? (changePct > 0 ? 'text-[#26A69A]' : changePct < 0 ? 'text-[#EF5350]' : 'text-dark-300')
    : 'text-dark-400';
  const changeSign = changePct != null && changePct > 0 ? '+' : '';

  const prevPriceRef = useRef<number | null>(null);
  const [flashClass, setFlashClass] = useState('');

  useEffect(() => {
    if (quote?.price != null && prevPriceRef.current != null && quote.price !== prevPriceRef.current) {
      const cls = quote.price > prevPriceRef.current ? 'animate-price-flash-up' : 'animate-price-flash-down';
      setFlashClass(cls);
      const timer = setTimeout(() => setFlashClass(''), 150);
      prevPriceRef.current = quote.price;
      return () => clearTimeout(timer);
    }
    if (quote?.price != null) prevPriceRef.current = quote.price;
  }, [quote?.price]);

  const items = [
    { label: '今开', value: quote?.open?.toFixed(2) ?? data.open ?? '--' },
    { label: '昨收', value: quote?.prev_close?.toFixed(2) ?? '--' },
    { label: '最高', value: quote?.high?.toFixed(2) ?? data.high ?? '--' },
    { label: '最低', value: quote?.low?.toFixed(2) ?? data.low ?? '--' },
    { label: '成交量', value: quote?.volume ?? data.volume ?? '--' },
    { label: '成交额', value: quote?.turnover ?? data.turnover ?? '--' },
    { label: '换手率', value: quote?.turnover_rate != null ? `${quote.turnover_rate.toFixed(2)}%` : data.turnover_rate ?? '--' },
    { label: '市盈率', value: quote?.pe?.toFixed(2) ?? data.pe ?? '--' },
    { label: '市净率', value: quote?.pb?.toFixed(4) ?? data.pb ?? '--' },
  ];

  if (compact) {
    return (
      <div className="card overflow-hidden animate-fade-in">
        {/* Header */}
        <div className="panel-header">
          <span className="panel-title">股票信息</span>
          {data.ai_enhanced != null && (
            <span className={`badge ${data.ai_enhanced ? 'text-purple-400' : 'text-dark-500'}`}
              style={{ backgroundColor: data.ai_enhanced ? 'rgba(168, 85, 247, 0.08)' : 'rgba(52, 60, 74, 0.4)' }}>
              {data.ai_enhanced ? 'AI' : 'OCR'}
            </span>
          )}
        </div>

        <div className="p-3 space-y-2">
          {/* Name + Code */}
          <div className="flex items-baseline gap-1.5">
            <span className="text-dark-100 text-[13px] font-semibold truncate">
              {quote?.name ?? data.stock_name ?? '--'}
            </span>
            <span className="text-dark-500 text-[10px] font-mono flex-shrink-0">
              {quote?.code ?? data.stock_code ?? ''}
            </span>
          </div>

          {/* Price */}
          {quoteLoading ? (
            <div className="space-y-1">
              <div className="h-6 w-20 bg-dark-800 rounded animate-pulse" />
              <div className="h-3 w-14 bg-dark-800 rounded animate-pulse" />
            </div>
          ) : (
            <div>
              <p className={`text-dark-100 text-[20px] font-bold font-mono tabular-nums tracking-tight leading-none ${flashClass}`}>
                {quote?.price?.toFixed(2) ?? data.current_price ?? '--'}
              </p>
              <div className="flex items-center gap-2 mt-1">
                {quote?.change_amt != null && (
                  <span className={`text-[11px] font-medium font-mono tabular-nums ${changeColor}`}>
                    {changeSign}{quote.change_amt.toFixed(2)}
                  </span>
                )}
                {changePct != null && (
                  <span className={`text-[11px] font-medium font-mono tabular-nums ${changeColor}`}>
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

          <div className="divider-h" />

          {/* Data Grid */}
          <div className="grid grid-cols-1 gap-0">
            {items.map((item) => (
              <div key={item.label} className="data-row">
                <span className="data-label">{item.label}</span>
                <span className="data-value">{item.value}</span>
              </div>
            ))}
          </div>

          {/* Confidence */}
          {data.overall_confidence != null && (
            <>
              <div className="divider-h" />
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="data-label">OCR 可信度</span>
                  <span className="data-value">{(data.overall_confidence * 100).toFixed(0)}%</span>
                </div>
                <div className="w-full h-[3px] rounded-full overflow-hidden" style={{ backgroundColor: '#222930' }}>
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{
                      width: `${Math.min(100, data.overall_confidence * 100)}%`,
                      backgroundColor: data.overall_confidence >= 0.7 ? '#26A69A' : data.overall_confidence >= 0.4 ? '#FFB74D' : '#EF5350',
                    }}
                  />
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // ── Normal mode ──────────────────────────────────────────
  return (
    <div className="card overflow-hidden animate-fade-in">
      <div className="panel-header">
        <span className="panel-title">股票信息</span>
        {data.ai_enhanced != null && (
          <span className={`badge ${data.ai_enhanced ? 'text-purple-400' : 'text-dark-500'}`}
            style={{ backgroundColor: data.ai_enhanced ? 'rgba(168, 85, 247, 0.08)' : 'rgba(52, 60, 74, 0.4)' }}>
            {data.ai_enhanced ? 'AI 增强' : '本地识别'}
          </span>
        )}
      </div>

      <div className="p-3 space-y-2.5">
        <div>
          <h2 className="text-dark-100 text-sm font-semibold">
            {quote?.name ?? data.stock_name ?? '--'}
          </h2>
          <p className="text-dark-500 text-[10px] font-mono mt-0.5">
            {quote?.code ?? data.stock_code ?? ''}
          </p>
        </div>

        {/* Price */}
        {quoteLoading ? (
          <div className="space-y-1.5">
            <div className="h-7 w-20 bg-dark-800 rounded animate-pulse" />
            <div className="h-3 w-14 bg-dark-800 rounded animate-pulse" />
          </div>
        ) : (
          <>
            <p className={`text-dark-100 text-price-main font-numeric font-semibold tabular-nums ${flashClass}`}>
              {quote?.price?.toFixed(2) ?? data.current_price ?? '--'}
            </p>
            <div className="flex items-center gap-2 mt-0.5">
              {quote?.change_amt != null && (
                <span className={`text-price-change font-numeric font-medium tabular-nums ${changeColor}`}>
                  {changeSign}{quote.change_amt.toFixed(2)}
                </span>
              )}
              {changePct != null && (
                <span className={`text-price-change font-numeric font-medium tabular-nums ${changeColor}`}>
                  {changeSign}{changePct.toFixed(2)}%
                </span>
              )}
              {!quote && data.change_percent && (
                <span className={`text-price-change font-medium ${changeColor}`}>
                  {data.change_percent}
                </span>
              )}
            </div>
          </>
        )}

        <div className="divider-h" />

        {/* Grid */}
        <div className="grid grid-cols-2 gap-x-2.5 gap-y-0">
          {items.map((item) => (
            <div key={item.label} className="data-row">
              <span className="data-label w-[44px] flex-shrink-0">{item.label}</span>
              <span className="data-value text-right">{item.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
