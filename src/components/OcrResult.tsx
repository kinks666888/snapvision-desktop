import React from 'react';
import type { OcrResult } from '../types/electron';

interface OcrResultProps {
  result: OcrResult;
  loading?: boolean;
}

export function OcrResult({ result, loading = false }: OcrResultProps) {
  if (loading) {
    return (
      <div className="glass-card p-6 animate-fade-in">
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 rounded-full border-2 border-blue-400 border-t-transparent animate-spin" />
          <span className="text-dark-300 text-sm font-medium">OCR 识别中…</span>
        </div>
      </div>
    );
  }

  if (!result.success) {
    return null; // Error handled by parent
  }

  const lines = result.texts || [];
  const hasText = result.text && result.text.trim().length > 0;

  return (
    <div className="glass-card overflow-hidden animate-slide-up">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-dark-700/30">
        <div className="flex items-center gap-2">
          <span className="text-sm">📝</span>
          <span className="text-dark-200 text-xs font-semibold tracking-wide">识别结果</span>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-dark-500">
          <span>{lines.length} 行</span>
          <span>置信度 {(result.confidence * 100).toFixed(1)}%</span>
          <span>{result.elapsed_ms}ms</span>
        </div>
      </div>

      {/* Content */}
      <div className="p-4">
        {hasText ? (
          <div className="selectable">
            {/* Line-by-line */}
            {lines.length > 0 && (
              <div className="space-y-1 mb-3">
                {lines.map((line, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 px-3 py-2 rounded-lg bg-dark-800/50 border border-dark-700/30"
                  >
                    <span className="text-dark-600 text-[10px] font-mono flex-shrink-0 mt-0.5 w-5 text-right">
                      {i + 1}
                    </span>
                    <span className="text-dark-200 text-sm leading-relaxed">{line}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Full text copyable */}
            <div className="relative">
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(result.text)}
                className="absolute top-2 right-2 px-2.5 py-1 rounded-lg
                           bg-dark-700/60 text-dark-400 text-[10px] font-medium
                           hover:bg-dark-600/60 hover:text-dark-200
                           transition-all duration-150"
              >
                复制
              </button>
              <pre className="text-dark-300 text-sm leading-relaxed font-mono
                             bg-dark-900/50 rounded-xl p-4 pr-16
                             max-h-[300px] overflow-y-auto no-scrollbar
                             whitespace-pre-wrap break-words selectable">
                {result.text}
              </pre>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center py-8 text-dark-500">
            <span className="text-2xl mb-2">🔍</span>
            <span className="text-xs">未识别到文字内容</span>
          </div>
        )}
      </div>
    </div>
  );
}
