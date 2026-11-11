/**
 * CandlePatternCard — K-line pattern recognition card.
 */

import React from 'react';
import type { CandlePattern } from '../types/electron';

interface CandlePatternCardProps {
  patterns: CandlePattern[];
  summary: string;
}

export function CandlePatternCard({ patterns, summary }: CandlePatternCardProps) {
  return (
    <div className="card overflow-hidden animate-fade-in">
      <div className="panel-header">
        <span className="panel-title">K线形态</span>
        {patterns.length > 0 && (
          <span className="text-dark-500 text-[9px] font-mono">{patterns.length}</span>
        )}
      </div>
      <div className="p-3">
        {patterns.length === 0 ? (
          <p className="text-dark-600 text-[10px] text-center py-2">暂无明显形态</p>
        ) : (
          <>
            <div className="space-y-2">
              {patterns.map((p, idx) => (
                <PatternRow key={`${p.type}-${idx}`} pattern={p} />
              ))}
            </div>
            <div className="mt-2 pt-2" style={{ borderTop: '1px solid #2A313D' }}>
              <p className="text-dark-400 text-[9px] leading-relaxed">{summary}</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function PatternRow({ pattern }: { pattern: CandlePattern }) {
  const badgeStyle: Record<string, React.CSSProperties> = {
    bullish: { color: '#26A69A', backgroundColor: 'rgba(38, 166, 154, 0.1)' },
    bearish: { color: '#EF5350', backgroundColor: 'rgba(239, 83, 80, 0.1)' },
    neutral: { color: '#636d7b', backgroundColor: 'rgba(52, 60, 74, 0.4)' },
  };
  const labelMap: Record<string, string> = {
    bullish: '看涨',
    bearish: '看跌',
    neutral: '中性',
  };

  const badge = badgeStyle[pattern.signal] ?? badgeStyle.neutral;
  const label = labelMap[pattern.signal] ?? '中性';

  return (
    <div>
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-dark-200 text-[10px] font-medium">{pattern.name}</span>
        <span className="badge" style={badge}>{label}</span>
      </div>
      <p className="text-dark-500 text-[9px] leading-relaxed">{pattern.desc}</p>
    </div>
  );
}
