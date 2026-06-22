import React, { useState, useEffect, useCallback } from 'react';
import { fetchHistoryList, removeHistory, removeAllHistory } from '../services/history-service';
import type { HistoryRecord } from '../types/electron';

interface HistoryListProps {
  onSelectRecord: (id: number) => void;
  onBack: () => void;
}

function Thumbnail({ imagePath }: { imagePath: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.electronAPI
      .readImageFile(imagePath)
      .then((url) => { if (!cancelled) setDataUrl(url); })
      .catch(() => { if (!cancelled) setDataUrl(null); });
    return () => { cancelled = true; };
  }, [imagePath]);

  if (!dataUrl) {
    return (
      <div className="w-9 h-9 rounded flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(42,49,61,0.4)' }}>
        <span className="text-dark-600 text-[10px]">📷</span>
      </div>
    );
  }

  return (
    <img src={dataUrl} alt="" className="w-9 h-9 rounded object-cover flex-shrink-0" style={{ background: 'rgba(42,49,61,0.4)' }} />
  );
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso.replace(' ', 'T'));
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);

    if (diffMin < 1) return '刚刚';
    if (diffMin < 60) return `${diffMin} 分钟前`;
    if (diffMin < 1440) return `${Math.floor(diffMin / 60)} 小时前`;

    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');
    return `${month}-${day} ${hours}:${mins}`;
  } catch {
    return iso;
  }
}

export function HistoryList({ onSelectRecord, onBack }: HistoryListProps) {
  const [items, setItems] = useState<HistoryRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const load = useCallback(async (p: number, s: string) => {
    setLoading(true);
    try {
      const result = await fetchHistoryList({
        search: s || undefined,
        sort: 'created_at_desc',
        page: p,
        page_size: 20,
      });
      setItems(result.items);
      setTotal(result.total);
      setPage(result.page);
      setTotalPages(result.total_pages);
    } catch (err) {
      console.error('Failed to load history:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(page, search);
  }, [page, search, load]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSearch(searchInput.trim());
    setPage(1);
  };

  const handleDelete = async (id: number) => {
    setDeletingId(id);
    try {
      await removeHistory(id);
      setItems((prev) => prev.filter((item) => item.id !== id));
      setTotal((prev) => prev - 1);
    } catch (err) {
      console.error('Failed to delete:', err);
    } finally {
      setDeletingId(null);
    }
  };

  const handleClearAll = async () => {
    try {
      await removeAllHistory();
      setItems([]);
      setTotal(0);
      setTotalPages(1);
      setPage(1);
    } catch (err) {
      console.error('Failed to clear history:', err);
    } finally {
      setShowClearConfirm(false);
    }
  };

  const hasPrev = page > 1;
  const hasNext = page < totalPages;

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
          <span className="text-dark-200 text-[13px] font-semibold">历史记录</span>
          {total > 0 && (
            <span className="text-dark-500 text-[11px] font-mono">({total})</span>
          )}
        </div>

        {total > 0 && (
          <button type="button" onClick={() => setShowClearConfirm(true)}
            className="px-2.5 py-1 rounded text-[10px] font-medium text-dark-500 hover:text-red-400 transition-colors">
            清空全部
          </button>
        )}
      </div>

      {/* Search */}
      <form onSubmit={handleSearchSubmit} className="flex gap-2">
        <input type="text" value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
          placeholder="搜索股票名称或代码…"
          className="flex-1 px-3 py-1.5 rounded text-[11px] text-dark-200 placeholder-dark-600 focus:outline-none focus:border-accent/40 transition-colors"
          style={{ background: 'rgba(42,49,61,0.3)', border: '1px solid #2A313D' }} />
        <button type="submit"
          className="px-3 py-1.5 rounded text-[11px] font-medium text-accent transition-colors"
          style={{ background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.2)' }}>
          搜索
        </button>
        {search && (
          <button type="button" onClick={() => { setSearchInput(''); setSearch(''); setPage(1); }}
            className="px-2.5 py-1.5 rounded text-[11px] text-dark-400 hover:text-dark-200 transition-colors"
            style={{ background: 'rgba(42,49,61,0.3)', border: '1px solid #2A313D' }}>
            清除
          </button>
        )}
      </form>

      {/* Confirm clear dialog */}
      {showClearConfirm && (
        <div className="p-3 rounded-card border border-red-500/20" style={{ background: 'rgba(239,83,80,0.04)' }}>
          <p className="text-red-300 text-[11px] mb-2">
            确认清空全部 {total} 条历史记录？此操作不可撤销。
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={handleClearAll}
              className="px-3 py-1 rounded text-[11px] font-medium text-red-300 transition-colors"
              style={{ background: 'rgba(239,83,80,0.15)' }}>
              确认清空
            </button>
            <button type="button" onClick={() => setShowClearConfirm(false)}
              className="px-3 py-1 rounded text-[11px] text-dark-300 hover:text-dark-200 transition-colors"
              style={{ background: 'rgba(42,49,61,0.4)' }}>
              取消
            </button>
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="w-5 h-5 rounded-full border-2 border-dark-700 border-t-accent animate-spin" />
        </div>
      )}

      {/* Empty state */}
      {!loading && items.length === 0 && (
        <div className="flex flex-col items-center py-16 text-dark-600">
          <svg className="w-10 h-10 mb-3" style={{ color: '#2A313D' }} fill="none" viewBox="0 0 48 48" stroke="currentColor" strokeWidth={1}>
            <rect x="8" y="6" width="32" height="36" rx="4" />
            <path d="M16 18h16M16 26h10" strokeLinecap="round" />
            <circle cx="34" cy="34" r="8" fill="#181C23" />
            <path d="M34 30v8M30 34h8" strokeLinecap="round" strokeWidth={1.5} />
          </svg>
          <span className="text-[12px] font-medium">尚无识别记录</span>
          <span className="text-[11px] mt-1 text-dark-600">
            {search ? '尝试其他搜索词' : '识别股票截图后将自动保存到此处'}
          </span>
        </div>
      )}

      {/* List */}
      {!loading && items.length > 0 && (
        <div className="space-y-1.5">
          {items.map((item) => (
            <div key={item.id}
              className="panel-section cursor-pointer group transition-colors hover:opacity-80"
              onClick={() => onSelectRecord(item.id)}>
              <div className="flex items-center gap-3">
                <Thumbnail imagePath={item.image_path} />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-dark-100 text-[12px] font-semibold truncate">
                      {item.stock_name || '未识别'}
                    </span>
                    {item.stock_code && (
                      <span className="text-dark-500 text-[11px] font-mono flex-shrink-0">
                        {item.stock_code}
                      </span>
                    )}
                  </div>
                  {item.summary_preview && (
                    <p className="text-dark-400 text-[11px] leading-relaxed mt-0.5 line-clamp-2">
                      {item.summary_preview}
                    </p>
                  )}
                  <span className="text-dark-600 text-[10px] mt-0.5 inline-block">
                    {formatTime(item.created_at)}
                  </span>
                </div>

                <button type="button"
                  onClick={(e) => { e.stopPropagation(); handleDelete(item.id); }}
                  disabled={deletingId === item.id}
                  className="w-6 h-6 rounded flex items-center justify-center text-dark-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
                  title="删除">
                  {deletingId === item.id ? (
                    <div className="w-3 h-3 rounded-full border border-red-400 border-t-transparent animate-spin" />
                  ) : (
                    <span className="text-[10px]">✕</span>
                  )}
                </button>
              </div>
            </div>
          ))}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={!hasPrev}
                className="px-2.5 py-1 rounded text-[11px] font-medium text-dark-400 hover:text-dark-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                ← 上一页
              </button>
              <span className="text-dark-500 text-[11px]">
                {page} / {totalPages}
              </span>
              <button type="button" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={!hasNext}
                className="px-2.5 py-1 rounded text-[11px] font-medium text-dark-400 hover:text-dark-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                下一页 →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
