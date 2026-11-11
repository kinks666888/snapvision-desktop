/**
 * VolumePriceCard — Volume-price analysis card.
 */

import React from 'react';
import type {
  VolumePriceAnalysis,
  SignalStrength,
} from '../utils/volumePriceAnalysis';

interface VolumePriceCardProps {
  result: VolumePriceAnalysis;
}

export function VolumePriceCard({ result }: VolumePriceCardProps) {
  if (result.insufficientData) {
    return (
      <div className="card overflow-hidden animate-fade-in">
        <div className="panel-header">
          <span className="panel-title">量价关系</span>
        </div>
        <div className="p-3">
          <p className="text-dark-600 text-[10px] text-center py-2">数据不足，暂无法判断</p>
        </div>
      </div>
    );
  }

  return (
    <div className="card overflow-hidden animate-fade-in">
      <div className="panel-header">
        <span className="panel-title">量价关系</span>
      </div>
      <div className="p-3 space-y-2">
        <AnalysisRow label="量价趋势" signal={result.volumePriceTrend} />
        <AnalysisRow label="量价背离" signal={result.divergence} />
        <AnalysisRow
          label="OBV 能量潮"
          signal={{
            label: `OBV${result.obv.trend}`,
            description: result.obv.description,
            strength: result.obv.strength,
          }}
        />
        <AnalysisRow label="地量地价" signal={result.lowVolumePrice} />
        <AnalysisRow label="均量对比" signal={result.volVsAvg} />

        <div className="pt-2" style={{ borderTop: '1px solid #2A313D' }}>
          <p className="text-dark-400 text-[9px] leading-relaxed">{result.summary}</p>
        </div>
      </div>
    </div>
  );
}

// --- AnalysisRow ---

interface AnalysisRowProps {
  label: string;
  signal: {
    label: string;
    description: string;
    strength: SignalStrength;
  };
}

function AnalysisRow({ label, signal }: AnalysisRowProps) {
  const colorMap: Record<SignalStrength, { badge: React.CSSProperties; text: string }> = {
    bullish: {
      badge: { color: '#26A69A', backgroundColor: 'rgba(38, 166, 154, 0.1)' },
      text: 'text-[#26A69A]',
    },
    neutral: {
      badge: { color: '#636d7b', backgroundColor: 'rgba(52, 60, 74, 0.4)' },
      text: 'text-dark-400',
    },
    bearish: {
      badge: { color: '#EF5350', backgroundColor: 'rgba(239, 83, 80, 0.1)' },
      text: 'text-[#EF5350]',
    },
  };

  const colors = colorMap[signal.strength] ?? colorMap.neutral;

  return (
    <div>
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-dark-500 text-[9px]">{label}</span>
        <span className="badge" style={colors.badge}>{signal.label}</span>
      </div>
      <p className={`text-[9px] leading-relaxed ${colors.text}`}>{signal.description}</p>
    </div>
  );
}
