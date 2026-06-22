import React, { useState, useEffect } from 'react';
import { fetchHistoryDetail, exportHistory } from '../services/history-service';
import type { HistoryRecord } from '../types/electron';

interface HistoryDetailProps {
  recordId: number;
  onBack: () => void;
}

function v(val: string | null): string {
  return val ?? '--';
}

function getChangeColor(val: string | null): string {
  if (!val || val === '--') return 'text-dark-400';
  if (val.startsWith('+')) return 'price-up';
  if (val.startsWith('-')) return 'price-down';
  return 'text-dark-400';
}

function Row({ label, value, mono = false }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div className="data-row px-2" style={{ borderBottom: '1px solid rgba(42,49,61,0.4)' }}>
      <span className="data-label">{label}</span>
      <span className={`text-dark-200 text-[11px] font-medium tabular-nums ${mono ? 'font-mono' : ''}`}>
        {v(value)}
      </span>
    </div>
  );
}

export function HistoryDetail({ recordId, onBack }: HistoryDetailProps) {
  const [record, setRecord] = useState<HistoryRecord | null>(null);
  const [parsed, setParsed] = useState<Record<string, unknown> | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ocrExpanded, setOcrExpanded] = useState(false);
  const [debugExpanded, setDebugExpanded] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchHistoryDetail(recordId)
      .then((rec) => {
        if (cancelled) return;
        setRecord(rec);
        try {
          setParsed(JSON.parse(rec.structured_json));
        } catch {
          setParsed(null);
        }
        window.electronAPI
          .readImageFile(rec.image_path)
          .then((url) => { if (!cancelled) setImageUrl(url); })
          .catch(() => { if (!cancelled) setImageUrl(null); });
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '加载失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [recordId]);

  const handleExport = async (format: 'md' | 'json' | 'txt') => {
    setExporting(format);
    try {
      const result = await exportHistory(recordId, format);
      if (!result.ok && !result.cancelled) {
        console.error('Export failed:', result);
      }
    } catch (err) {
      console.error('Export error:', err);
    } finally {
      setExporting(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-5 h-5 rounded-full border-2 border-dark-700 border-t-accent animate-spin" />
      </div>
    );
  }

  if (error || !record) {
    return (
      <div className="space-y-4 animate-fade-in">
        <button type="button" onClick={onBack}
          className="w-7 h-7 rounded flex items-center justify-center text-dark-400 hover:text-dark-200 transition-colors">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
        </button>
        <div className="flex flex-col items-center py-16 text-dark-600">
          <span className="text-sm">{error || '记录不存在'}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button type="button" onClick={onBack}
            className="w-7 h-7 rounded flex items-center justify-center text-dark-400 hover:text-dark-200 transition-colors"
            title="返回">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
          </button>
          <span className="text-dark-200 text-[13px] font-semibold">分析详情</span>
        </div>

        <div className="flex items-center gap-1.5">
          {(['md', 'json', 'txt'] as const).map((fmt) => (
            <button key={fmt} type="button" onClick={() => handleExport(fmt)} disabled={exporting === fmt}
              className="btn-ghost text-[10px]"
              style={{ border: '1px solid #2A313D' }}>
              {exporting === fmt ? '...' : fmt.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Image */}
      {imageUrl ? (
        <div className="card overflow-hidden">
          <img src={imageUrl} alt="截图" className="w-full max-h-[280px] object-contain" style={{ background: '#0F1115' }} />
        </div>
      ) : (
        <div className="card text-center text-dark-600 text-[11px] py-4">
          无法加载图片预览
        </div>
      )}

      {/* Stock Info Card */}
      <div className="card overflow-hidden">
        <div className="panel-header">
          <span className="panel-title">股票信息</span>
        </div>

        <div className="p-3">
          <div className="flex items-baseline gap-2">
            <h2 className="text-dark-100 text-[14px] font-bold">{v(record.stock_name)}</h2>
            <span className="text-dark-500 text-[12px] font-mono">{v(record.stock_code)}</span>
          </div>
        </div>

        {parsed && (
          <>
            <div className="mb-3">
              <div className="flex items-baseline gap-2">
                <span className="text-dark-100 text-[22px] font-bold tabular-nums font-mono">
                  {v(parsed.current_price as string | null)}
                </span>
                <span className={`text-[12px] font-semibold tabular-nums font-mono ${getChangeColor(parsed.change_amount as string | null)}`}>
                  {v(parsed.change_amount as string | null)}
                </span>
                <span className={`text-[12px] font-semibold tabular-nums font-mono ${getChangeColor(parsed.change_percent as string | null)}`}>
                  {v(parsed.change_percent as string | null)}
                </span>
              </div>
            </div>

            <div>
              <Row label="今开" value={parsed.open as string | null} mono />
              <Row label="最高" value={parsed.high as string | null} mono />
              <Row label="最低" value={parsed.low as string | null} mono />
              <Row label="成交量" value={parsed.volume as string | null} />
              <Row label="成交额" value={parsed.turnover as string | null} />
              <Row label="换手率" value={parsed.turnover_rate as string | null} />
              <Row label="市盈率" value={parsed.pe as string | null} />
              <Row label="市净率" value={parsed.pb as string | null} />
            </div>
          </>
        )}
      </div>

      {/* AI Analysis */}
      {record.ai_summary && (
        <div className="card overflow-hidden">
          <div className="panel-header">
            <span className="panel-title">AI 分析</span>
          </div>
          <div className="p-3">
            <p className="text-dark-300 text-[12px] leading-relaxed whitespace-pre-wrap">
              {record.ai_summary}
            </p>
          </div>
        </div>
      )}

      {/* OCR Raw Text */}
      {record.raw_ocr_text && (
        <div className="card overflow-hidden">
          <button type="button" onClick={() => setOcrExpanded(!ocrExpanded)}
            className="w-full panel-header hover:opacity-80 transition-opacity">
            <span className="panel-title">OCR 原始文本</span>
            <svg className={`w-2.5 h-2.5 text-dark-500 transition-transform duration-150 ${ocrExpanded ? 'rotate-90' : ''}`} fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          </button>
          {ocrExpanded && (
            <div style={{ borderTop: '1px solid #2A313D' }}>
              <pre className="text-dark-300 text-[11px] leading-relaxed font-mono p-3 max-h-[300px] overflow-y-auto no-scrollbar whitespace-pre-wrap break-words selectable"
                style={{ background: '#0F1115' }}>
                {record.raw_ocr_text}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* JSON Debug */}
      {parsed && (
        <div className="card overflow-hidden">
          <button type="button" onClick={() => setDebugExpanded(!debugExpanded)}
            className="w-full panel-header hover:opacity-80 transition-opacity">
            <span className="panel-title">JSON 调试信息</span>
            <svg className={`w-2.5 h-2.5 text-dark-500 transition-transform duration-150 ${debugExpanded ? 'rotate-90' : ''}`} fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          </button>
          {debugExpanded && (
            <div style={{ borderTop: '1px solid #2A313D' }}>
              <pre className="text-dark-400 text-[10px] leading-relaxed font-mono p-3 max-h-[400px] overflow-y-auto no-scrollbar whitespace-pre-wrap break-words selectable"
                style={{ background: '#0F1115' }}>
                {JSON.stringify(parsed, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Meta */}
      <div className="text-center text-dark-700 text-[10px] pb-4">
        记录 ID: {record.id} · {record.created_at} · v{record.app_version}
      </div>
    </div>
  );
}
