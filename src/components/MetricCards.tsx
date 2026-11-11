/**
 * MetricCards — Grid of metric tiles for the left panel.
 */

import React from 'react';
import type { StockParseResult, RealtimeQuote } from '../types/electron';

interface MetricCardsProps {
  data: StockParseResult;
  liveQuote?: RealtimeQuote | null;
  columns?: 2 | 3;
}

function fmtNum(val: number | null | undefined, decimals = 2): string {
  if (val == null) return '--';
  return val.toFixed(decimals);
}

export function MetricCards({ data, liveQuote, columns = 3 }: MetricCardsProps) {
  const q = liveQuote;

  const cards = [
    {
      label: '最新价',
      value: q?.price != null ? fmtNum(q.price) : data.current_price ?? '--',
      color: 'text-dark-100',
      highlight: true,
    },
    {
      label: '涨跌幅',
      value: q?.change_pct != null
        ? `${q.change_pct > 0 ? '+' : ''}${q.change_pct.toFixed(2)}%`
        : data.change_percent ?? '--',
      color: q?.change_pct != null
        ? q.change_pct > 0 ? 'text-[#26A69A]' : q.change_pct < 0 ? 'text-[#EF5350]' : 'text-dark-200'
        : (data.change_percent?.startsWith('+') ? 'text-[#26A69A]' : data.change_percent?.startsWith('-') ? 'text-[#EF5350]' : 'text-dark-200'),
    },
    {
      label: '成交额',
      value: q?.turnover ?? data.turnover ?? '--',
      color: 'text-dark-200',
    },
    {
      label: '成交量',
      value: q?.volume ?? data.volume ?? '--',
      color: 'text-dark-200',
    },
    {
      label: '换手率',
      value: q?.turnover_rate != null ? `${q.turnover_rate.toFixed(2)}%` : data.turnover_rate ?? '--',
      color: 'text-dark-200',
    },
    {
      label: '市盈率',
      value: q?.pe != null ? fmtNum(q.pe) : data.pe ?? '--',
      color: 'text-dark-200',
    },
    {
      label: '市净率',
      value: q?.pb != null ? fmtNum(q.pb, 4) : data.pb ?? '--',
      color: 'text-dark-200',
    },
    {
      label: 'AI 置信度',
      value: data.ai_enhanced != null ? (data.ai_enhanced ? '已启用' : '未启用') : '--',
      color: data.ai_enhanced ? 'text-purple-400' : 'text-dark-500',
    },
    {
      label: 'OCR 置信度',
      value: data.overall_confidence != null ? `${(data.overall_confidence * 100).toFixed(0)}%` : '--',
      color: data.overall_confidence != null
        ? data.overall_confidence >= 0.7 ? 'text-[#26A69A]' : data.overall_confidence >= 0.4 ? 'text-yellow-400' : 'text-[#EF5350]'
        : 'text-dark-400',
    },
  ];

  const gridCols = columns === 3 ? 'grid-cols-3' : 'grid-cols-2';

  return (
    <div className="card overflow-hidden animate-fade-in">
      <div className="panel-header">
        <span className="panel-title">核心指标</span>
      </div>
      <div className="p-2.5">
        <div className={`grid ${gridCols} gap-1.5`}>
          {cards.map((card) => (
            <div
              key={card.label}
              className="flex flex-col gap-0.5 px-2 py-1.5 rounded"
              style={{
                backgroundColor: card.highlight ? 'rgba(34, 41, 48, 0.5)' : 'rgba(34, 41, 48, 0.25)',
                border: `1px solid ${card.highlight ? '#2A313D' : 'rgba(42, 49, 61, 0.5)'}`,
              }}
            >
              <span className="text-dark-500 text-[9px] leading-none">{card.label}</span>
              <span className={`text-[11px] font-semibold font-mono tabular-nums leading-tight ${card.color}`}>
                {card.value}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
