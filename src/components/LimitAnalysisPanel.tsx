import React, { useMemo } from 'react';
import type { RealtimeQuote, KlineResult } from '../types/electron';
import { analyseLimit, type LimitAnalysisResult } from '../utils/limitAnalysis';

interface LimitAnalysisPanelProps {
  stockCode: string | null | undefined;
  stockName: string | null | undefined;
  liveQuote: Partial<RealtimeQuote> | null | undefined;
  klineResult: KlineResult | null;
}

export function LimitAnalysisPanel({
  stockCode,
  stockName,
  liveQuote,
  klineResult,
}: LimitAnalysisPanelProps) {
  const dailyBars = useMemo(() => {
    if (!klineResult?.bars) return [];
    return klineResult.bars.filter(b => b.time && b.time.length <= 10);
  }, [klineResult]);

  const result: LimitAnalysisResult | null = useMemo(() => {
    if (!stockCode) return null;
    return analyseLimit(stockCode, stockName, liveQuote, dailyBars);
  }, [stockCode, stockName, liveQuote, dailyBars]);

  if (!result) {
    return (
      <div className="card overflow-hidden">
        <div className="panel-header">
          <span className="panel-title">涨跌停分析</span>
        </div>
        <div className="p-3">
          <div className="text-dark-600 text-[10px]">暂无股票数据</div>
        </div>
      </div>
    );
  }

  const { limit, st_status, consecutive, breakout } = result;

  return (
    <div className="card overflow-hidden">
      <div className="panel-header">
        <span className="panel-title">涨跌停分析</span>
        {limit.is_limit_up && <span className="badge badge-red">涨停</span>}
        {limit.is_limit_down && <span className="badge badge-green">跌停</span>}
      </div>
      <div className="p-3 space-y-1.5">
        <DataRow
          label="涨跌幅"
          value={limit.change_pct != null ? `${limit.change_pct >= 0 ? '+' : ''}${limit.change_pct.toFixed(2)}%` : '暂无数据'}
          valueColor={limit.change_pct != null && limit.change_pct >= 0 ? 'text-[#EF5350]' : limit.change_pct != null ? 'text-[#26A69A]' : ''}
        />

        <DataRow label="涨跌停限制" value={limit.limit_type_label} valueColor="text-dark-300" />

        <DataRow
          label="连板数"
          value={consecutive.can_confirm ? consecutive.count > 0 ? consecutive.label : '无' : '暂无数据'}
        />

        <DataRow
          label="ST状态"
          value={st_status.st_type || '否'}
          valueColor={st_status.st_type ? 'text-yellow-400' : 'text-[#26A69A]'}
        />

        {st_status.st_type && (
          <div className="px-2 py-1.5 rounded" style={{ background: 'rgba(255,183,77,0.04)', border: '1px solid rgba(234, 179, 8, 0.12)' }}>
            <span className="text-yellow-400 text-[9px] leading-relaxed">{st_status.risk_warning}</span>
          </div>
        )}

        <DataRow
          label="炸板风险"
          value={breakout.level}
          valueColor={
            breakout.level === '极低' || breakout.level === '较低' ? 'text-[#26A69A]' :
            breakout.level === '中等' ? 'text-yellow-400' :
            'text-[#EF5350]'
          }
        />

        {!limit.is_limit_up && limit.distance_to_limit_up_pct != null && limit.distance_to_limit_up_pct > 0 && (
          <DataRow
            label="距涨停"
            value={`${limit.distance_to_limit_up != null ? limit.distance_to_limit_up.toFixed(2) : '--'} (${limit.distance_to_limit_up_pct.toFixed(2)}%)`}
            valueColor="text-dark-300"
          />
        )}

        {!limit.is_limit_down && limit.distance_to_limit_down != null && limit.distance_to_limit_down > 0 && (
          <DataRow label="距跌停" value={limit.distance_to_limit_down.toFixed(2)} valueColor="text-dark-300" />
        )}

        <div className="px-2 py-1.5 rounded mt-1" style={{ background: 'rgba(42,49,61,0.3)', border: '1px solid rgba(42,49,61,0.4)' }}>
          <p className="text-dark-400 text-[9px] leading-relaxed">{result.summary}</p>
        </div>

        {limit.is_limit_up && (
          <div className="px-2 py-1.5 rounded" style={{ background: 'rgba(42,49,61,0.3)', border: '1px solid rgba(42,49,61,0.4)' }}>
            <p className="text-dark-400 text-[9px] leading-relaxed">{breakout.explanation}</p>
          </div>
        )}

        {!consecutive.can_confirm && (
          <div className="px-2 py-1.5 rounded" style={{ background: 'rgba(42,49,61,0.3)', border: '1px solid rgba(42,49,61,0.4)' }}>
            <p className="text-dark-500 text-[9px]">{consecutive.message}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function DataRow({
  label,
  value,
  valueColor = 'text-dark-200',
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <div className="flex items-center justify-between" style={{ height: 24 }}>
      <span className="text-dark-500 text-[10px]">{label}</span>
      <span className={`text-[10px] font-medium font-mono tabular-nums ${valueColor}`}>{value}</span>
    </div>
  );
}
