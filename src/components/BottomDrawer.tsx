/**
 * BottomDrawer — Collapsible bottom panel with tabs.
 * Professional financial terminal style.
 */

import React, { useState } from 'react';
import type { StockParseResult } from '../types/electron';

interface BottomDrawerProps {
  data: StockParseResult;
  aiAnalysis?: string | null;
}

type TabKey = 'ocr' | 'fields' | 'debug' | 'ai-log';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'ocr', label: 'OCR 原文' },
  { key: 'fields', label: '提取字段' },
  { key: 'debug', label: '调试信息' },
  { key: 'ai-log', label: 'AI 日志' },
];

export function BottomDrawer({ data, aiAnalysis }: BottomDrawerProps) {
  const [expanded, setExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>('ocr');

  return (
    <div className="card overflow-hidden animate-fade-in">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full panel-header hover:opacity-80 transition-opacity cursor-pointer"
      >
        <div className="flex items-center gap-1.5">
          <svg className={`w-2.5 h-2.5 text-dark-500 transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`} fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
          </svg>
          <span className="panel-title">详细数据</span>
        </div>
        <div className="flex items-center gap-2 text-dark-600 text-[9px] font-mono">
          {data.raw_texts && <span>{data.raw_texts.length} 行</span>}
          {data.overall_confidence != null && (
            <span>{(data.overall_confidence * 100).toFixed(0)}%</span>
          )}
        </div>
      </button>

      {expanded && (
        <div style={{ borderTop: '1px solid #2A313D' }}>
          <div className="flex gap-0 px-0">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-2.5 py-1.5 text-[10px] font-medium transition-colors border-b-2 -mb-px ${
                  activeTab === tab.key
                    ? 'text-accent border-accent'
                    : 'text-dark-500 border-transparent hover:text-dark-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="p-2.5 max-h-[280px] overflow-y-auto custom-scrollbar">
            {activeTab === 'ocr' && <OcrTab data={data} />}
            {activeTab === 'fields' && <FieldsTab data={data} />}
            {activeTab === 'debug' && <DebugTab data={data} />}
            {activeTab === 'ai-log' && <AiLogTab analysis={aiAnalysis} />}
          </div>
        </div>
      )}
    </div>
  );
}

function OcrTab({ data }: { data: StockParseResult }) {
  const lines = data.raw_texts ?? data._raw_ocr_texts ?? data.filtered_texts ?? [];

  if (lines.length === 0) {
    return <p className="text-dark-600 text-[11px] text-center py-4">无 OCR 数据</p>;
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-3 text-[10px] text-dark-600 mb-2">
        <span>{lines.length} 行</span>
        {data._ocr_meta?.ocr_ms && <span>耗时 {data._ocr_meta.ocr_ms}ms</span>}
      </div>
      {lines.map((line, i) => (
        <div key={i} className="flex items-start gap-2 px-2 py-1 rounded" style={{ background: 'rgba(42,49,61,0.2)' }}>
          <span className="text-dark-600 text-[9px] font-mono w-4 text-right flex-shrink-0 mt-0.5">{i + 1}</span>
          <span className="text-dark-300 text-[11px] leading-relaxed break-all">{line || '(空)'}</span>
        </div>
      ))}
    </div>
  );
}

function FieldsTab({ data }: { data: StockParseResult }) {
  const fields = [
    { label: '股票名称', value: data.stock_name },
    { label: '股票代码', value: data.stock_code },
    { label: '当前价格', value: data.current_price },
    { label: '涨跌幅', value: data.change_percent },
    { label: '涨跌额', value: data.change_amount },
    { label: '开盘价', value: data.open },
    { label: '最高价', value: data.high },
    { label: '最低价', value: data.low },
    { label: '成交量', value: data.volume },
    { label: '成交额', value: data.turnover },
    { label: '换手率', value: data.turnover_rate },
    { label: '市盈率', value: data.pe },
    { label: '市净率', value: data.pb },
  ];

  return (
    <div className="space-y-1">
      {fields.map((f) => (
        <div key={f.label} className="data-row px-1">
          <span className="data-label">{f.label}</span>
          <span className="text-dark-300 text-[11px] font-mono">{f.value ?? '--'}</span>
        </div>
      ))}

      {data._filtered_result && (
        <div className="mt-2 pt-2" style={{ borderTop: '1px solid #2A313D' }}>
          <p className="text-dark-500 text-[10px] mb-1">过滤器输出</p>
          <pre className="text-dark-400 text-[9px] font-mono rounded p-2 overflow-x-auto whitespace-pre-wrap break-all" style={{ background: 'rgba(42,49,61,0.3)' }}>
            {JSON.stringify(data._filtered_result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

function DebugTab({ data }: { data: StockParseResult }) {
  const hasDebug = data.debug_info || data._ocr_meta || data.confidence_warnings;

  return (
    <div className="space-y-3">
      {data._ocr_meta && (
        <div>
          <p className="text-dark-400 text-[10px] font-medium mb-1.5">处理耗时</p>
          <div className="grid grid-cols-4 gap-1.5">
            <StatMini label="OCR" value={`${data._ocr_meta.ocr_ms}ms`} />
            <StatMini label="ROI" value={`${data._ocr_meta.roi_ms ?? '--'}ms`} />
            <StatMini label="解析" value={`${data._ocr_meta.parse_ms ?? '--'}ms`} />
            <StatMini label="总计" value={`${data._ocr_meta.total_ms}ms`} />
          </div>
        </div>
      )}

      <div>
        <p className="text-dark-400 text-[10px] font-medium mb-1.5">置信度</p>
        <div className="grid grid-cols-3 gap-1.5">
          <StatMini
            label="整体"
            value={data.overall_confidence != null ? `${(data.overall_confidence * 100).toFixed(0)}%` : '--'}
            color={data.overall_confidence != null && data.overall_confidence >= 0.7 ? 'price-up' : 'text-yellow-400'}
          />
          <StatMini
            label="低置信"
            value={data.low_confidence_warning ? '是' : '否'}
            color={data.low_confidence_warning ? 'text-yellow-400' : 'price-up'}
          />
          <StatMini
            label="数据源"
            value={data.recognition_source ?? data.price_source ?? '--'}
          />
        </div>
      </div>

      {data.confidence_warnings && data.confidence_warnings.length > 0 && (
        <div className="px-2 py-1.5 rounded border border-yellow-500/20" style={{ background: 'rgba(255,183,77,0.04)' }}>
          {data.confidence_warnings.map((w, i) => (
            <div key={i} className="text-yellow-400/80 text-[9px]">⚠ {w}</div>
          ))}
        </div>
      )}

      {data.ignored_texts && data.ignored_texts.length > 0 && (
        <div>
          <p className="text-dark-400 text-[10px] font-medium mb-1">被忽略的文本 ({data.ignored_texts.length})</p>
          <div className="max-h-24 overflow-y-auto rounded p-1.5" style={{ background: 'rgba(42,49,61,0.3)' }}>
            {data.ignored_texts.map((t, i) => (
              <div key={i} className="text-dark-500 text-[9px] py-0.5 font-mono">{t || '(空)'}</div>
            ))}
          </div>
        </div>
      )}

      {data.debug_info && (
        <div>
          <p className="text-dark-400 text-[10px] font-medium mb-1">完整 JSON</p>
          <pre className="text-dark-500 text-[8px] font-mono rounded p-2 max-h-40 overflow-auto whitespace-pre-wrap break-all" style={{ background: 'rgba(42,49,61,0.3)' }}>
            {JSON.stringify(data.debug_info, null, 2)}
          </pre>
        </div>
      )}

      {!hasDebug && (
        <p className="text-dark-600 text-[11px] text-center py-4">无调试数据</p>
      )}
    </div>
  );
}

function AiLogTab({ analysis }: { analysis?: string | null }) {
  if (!analysis) {
    return <p className="text-dark-600 text-[11px] text-center py-4">暂无 AI 分析日志</p>;
  }

  return (
    <div className="space-y-2">
      <p className="text-dark-300 text-[11px] leading-relaxed whitespace-pre-wrap">{analysis}</p>
    </div>
  );
}

function StatMini({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex flex-col gap-[2px] px-2 py-[6px] rounded-[6px]" style={{ background: 'rgba(42,49,61,0.3)', border: '1px solid rgba(42,49,61,0.4)' }}>
      <span className="text-dark-500 text-[9px]">{label}</span>
      <span className={`text-[10px] font-mono font-semibold ${color ?? 'text-dark-200'}`}>{value}</span>
    </div>
  );
}
