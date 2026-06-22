import React, { useState, useEffect } from 'react';
import { readImageFile } from '../services/ocr-service';

interface ImagePreviewProps {
  imagePath: string;
  onClear: () => void;
  compact?: boolean;
}

export function ImagePreview({ imagePath, onClear, compact = false }: ImagePreviewProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError(false);
    setDataUrl(null);
    readImageFile(imagePath)
      .then((url) => { if (!cancelled) setDataUrl(url); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [imagePath]);

  const fileName = imagePath.split('/').pop() || imagePath;

  // ── Compact mode (thumbnail + fullscreen overlay) ────────
  if (compact) {
    return (
      <>
        <div
          className="relative rounded-card overflow-hidden cursor-pointer group"
          style={{ height: 110, border: '1px solid #2A313D', backgroundColor: '#0F1115' }}
          onClick={() => dataUrl && setExpanded(true)}
        >
          {error ? (
            <div className="flex flex-col items-center justify-center h-full text-dark-500">
              <span className="text-[10px]">加载失败</span>
            </div>
          ) : !dataUrl ? (
            <div className="flex items-center justify-center h-full">
              <div className="w-3.5 h-3.5 rounded-full border-2 animate-spin" style={{ borderColor: '#343c4a', borderTopColor: '#3b82f6' }} />
            </div>
          ) : (
            <img src={dataUrl} alt={fileName} className="w-full h-full object-cover" />
          )}

          {/* Hover overlay */}
          {dataUrl && !error && (
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
              <span className="text-white text-[9px] opacity-0 group-hover:opacity-100 transition-opacity bg-black/50 px-2 py-0.5 rounded">
                点击查看大图
              </span>
            </div>
          )}

          {/* Filename badge */}
          <div className="absolute top-1 left-1 right-7 flex items-center">
            <span className="text-[8px] text-white/60 bg-black/40 px-1.5 py-0.5 rounded truncate max-w-full">
              {fileName}
            </span>
          </div>

          {/* Clear button */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onClear(); }}
            className="absolute top-1 right-1 w-4.5 h-4.5 rounded flex items-center justify-center bg-black/40 text-white/60 hover:text-white hover:bg-black/60 transition-colors text-[9px]"
            style={{ width: 18, height: 18 }}
            title="清除图片"
          >
            ✕
          </button>
        </div>

        {/* Fullscreen overlay */}
        {expanded && dataUrl && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center cursor-pointer"
            style={{ backgroundColor: 'rgba(0, 0, 0, 0.85)' }}
            onClick={() => setExpanded(false)}
          >
            <div className="relative max-w-[90vw] max-h-[90vh]">
              <img src={dataUrl} alt={fileName} className="max-w-full max-h-[90vh] object-contain rounded" />
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="absolute top-3 right-3 w-7 h-7 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80 transition-colors text-xs"
              >
                ✕
              </button>
              <div className="absolute bottom-3 left-3 text-white/50 text-[10px] bg-black/50 px-2 py-0.5 rounded">
                {fileName}
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  // ── Normal mode ──────────────────────────────────────────
  return (
    <div className="card overflow-hidden animate-fade-in">
      <div className="flex items-center justify-between px-3 py-2" style={{ borderBottom: '1px solid #2A313D' }}>
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-dark-400 text-[10px] font-medium truncate" title={fileName}>{fileName}</span>
        </div>
        <button type="button" onClick={onClear}
          className="w-6 h-6 rounded flex items-center justify-center text-dark-400 hover:text-dark-200 hover:bg-dark-700/30 transition-all duration-150"
          title="清除图片">✕</button>
      </div>
      <div className="p-2">
        {error ? (
          <div className="flex flex-col items-center justify-center py-10 text-dark-500">
            <span className="text-[11px]">无法加载图片预览</span>
          </div>
        ) : !dataUrl ? (
          <div className="flex items-center justify-center py-10">
            <div className="w-4 h-4 rounded-full border-2 animate-spin" style={{ borderColor: '#343c4a', borderTopColor: '#3b82f6' }} />
          </div>
        ) : (
          <img src={dataUrl} alt={fileName} className="w-full max-h-[320px] object-contain rounded" style={{ backgroundColor: '#0F1115' }} />
        )}
      </div>
    </div>
  );
}
