import React, { useState, useCallback, useEffect, useRef } from 'react';
import { StatusBar } from './components/StatusBar';
import { DropZone } from './components/DropZone';
import { ImagePreview } from './components/ImagePreview';
import { AnalysisDashboard } from './components/AnalysisDashboard';
import { HistoryList } from './components/HistoryList';
import { HistoryDetail } from './components/HistoryDetail';
import { StockChart } from './components/StockChart';
import { StockInfoPanel } from './components/StockInfoPanel';
import { MetricCards } from './components/MetricCards';
import { AICards } from './components/AICards';
import { BottomDrawer } from './components/BottomDrawer';
import { SettingsPanel } from './components/SettingsPanel';
import { onOcrStatusChange, getOcrHealth, readImageFile } from './services/ocr-service';
import { extractStockInfoBase64 } from './services/stock-service';
import { getTencentQuote, getKlineData } from './services/market-service';
import { useResponsive } from './hooks/useResponsive';
import { saveHistory } from './services/history-service';
import { saveAnalysisReport } from './services/export-service';
import type { OcrStatus, StockParseResult, RealtimeQuote, KlineResult } from './types/electron';
import type { ChartPeriod } from './components/StockChart';

// ─── Image compression ─────────────────────────────────────

function compressImage(base64: string): Promise<string> {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      const scale = Math.min(1, 1280 / Math.max(img.width, img.height))
      canvas.width = img.width * scale
      canvas.height = img.height * scale
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/jpeg', 0.85).split(',')[1])
    }
    img.src = 'data:image/png;base64,' + base64
  })
}

// ─── Shared small components ───────────────────────────────

function SkeletonCard() {
  return (
    <div className="card overflow-hidden animate-fade-in">
      <div className="panel-header">
        <div className="h-3 w-14 bg-dark-800 rounded animate-pulse" />
      </div>
      <div className="p-3 space-y-2.5">
        <div className="h-4 w-20 bg-dark-800 rounded animate-pulse" />
        <div className="h-6 w-28 bg-dark-800 rounded animate-pulse" />
        <div className="grid grid-cols-2 gap-2">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between">
              <div className="h-2.5 w-9 bg-dark-800 rounded animate-pulse" />
              <div className="h-2.5 w-12 bg-dark-800 rounded animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ProgressBar({ percent }: { percent: number }) {
  return (
    <div className="w-full h-[2px] overflow-hidden flex-shrink-0" style={{ backgroundColor: '#181C23' }}>
      <div
        className="h-full transition-all duration-300 ease-out"
        style={{
          width: `${Math.min(100, Math.max(0, percent))}%`,
          backgroundColor: '#3b82f6',
        }}
      />
    </div>
  );
}

function NoStockInfoBanner({ message }: { message: string }) {
  const tips = [
    '请确保截图包含完整的股票详情页面',
    '避免截图包含广告、评论区等非股票内容',
    '目前支持：东方财富、同花顺、雪球、腾讯自选股',
  ];
  return (
    <div className="card p-3 animate-fade-in">
      <h3 className="text-yellow-400 text-[11px] font-medium mb-1">未识别到股票信息</h3>
      <p className="text-dark-400 text-[10px] leading-relaxed mb-2">{message}</p>
      <ul className="space-y-0.5">
        {tips.map((tip, i) => (
          <li key={i} className="text-dark-500 text-[10px] flex gap-1.5">
            <span className="text-dark-600 flex-shrink-0">{i + 1}.</span>
            <span>{tip}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="card p-3 animate-fade-in">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-red-400 text-[11px] font-medium">识别失败</p>
          <p className="text-dark-400 text-[10px] leading-relaxed break-words mt-0.5">{message}</p>
        </div>
        <button type="button" onClick={onDismiss} className="text-dark-500 hover:text-dark-300 text-xs flex-shrink-0 mt-0.5">
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ─── Toolbar Icons ─────────────────────────────────────────

function IconScan() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0113.5 9.375v-4.5z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5z" />
    </svg>
  );
}

function IconSave() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
    </svg>
  );
}

function IconHistory() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function IconSettings() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

function IconChevron({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d={direction === 'left' ? "M15.75 19.5L8.25 12l7.5-7.5" : "M8.25 4.5l7.5 7.5-7.5 7.5"} />
    </svg>
  );
}

// ─── Main App ──────────────────────────────────────────────

export default function App() {
  const mode = useResponsive();
  const isWide = mode === 'wide';

  // Service status
  const [serviceReady, setServiceReady] = useState(true);
  const [serviceMessage, setServiceMessage] = useState('服务已就绪');

  // Image
  const [imagePath, setImagePath] = useState<string | null>(null);

  // Stock extraction
  const [stockResult, setStockResult] = useState<StockParseResult | null>(null);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);

  // Progress
  const [progressPercent, setProgressPercent] = useState(0);
  const [loadingText, setLoadingText] = useState('正在识别截图...');
  const [showTimeoutRetry, setShowTimeoutRetry] = useState(false);
  const recognitionStartRef = useRef(0);

  // Market data
  const [liveQuote, setLiveQuote] = useState<RealtimeQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);

  // Chart
  const [chartPeriod, setChartPeriod] = useState<ChartPeriod>('daily');
  const [klineResult, setKlineResult] = useState<KlineResult | null>(null);
  const [klineLoading, setKlineLoading] = useState(false);
  const [klineError, setKlineError] = useState<string | null>(null);

  // View
  type View = 'analysis' | 'history' | 'history-detail';
  const [view, setView] = useState<View>('analysis');
  const [historyRecordId, setHistoryRecordId] = useState<number | null>(null);

  // History refresh trigger
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);

  // Save/Export
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Left panel collapsed
  const [leftCollapsed, setLeftCollapsed] = useState(false);

  // Settings panel
  const [settingsOpen, setSettingsOpen] = useState(false);

  // ── Service health ────────────────────────────────────
  useEffect(() => {
    getOcrHealth().then(s => { setServiceReady(s.ready); setServiceMessage(s.message); }).catch(() => { setServiceReady(false); setServiceMessage('服务未启动'); });
    const unsub = onOcrStatusChange(s => { setServiceReady(s.ready); setServiceMessage(s.message); });
    return unsub;
  }, []);

  // ── Progress animation ────────────────────────────────
  useEffect(() => {
    if (!ocrLoading) { setProgressPercent(0); return; }
    const t0 = Date.now();
    const iv = setInterval(() => {
      const e = Date.now() - t0;
      let p: number;
      if (e < 1000) p = 10 + (e / 1000) * 20;
      else if (e < 3000) p = 30 + ((e - 1000) / 2000) * 25;
      else if (e < 6000) p = 55 + ((e - 3000) / 3000) * 20;
      else p = Math.min(80, 75 + ((e - 6000) / 4000) * 5);
      setProgressPercent(Math.round(p));
    }, 200);
    return () => clearInterval(iv);
  }, [ocrLoading]);

  // ── Loading text ──────────────────────────────────────
  useEffect(() => {
    if (!ocrLoading) { setLoadingText('正在识别截图...'); return; }
    const iv = setInterval(() => {
      const s = (Date.now() - recognitionStartRef.current) / 1000;
      if (s < 1) setLoadingText('正在识别截图...');
      else if (s < 3) setLoadingText('AI 提取股票信息...');
      else setLoadingText('即将完成...');
    }, 500);
    return () => clearInterval(iv);
  }, [ocrLoading]);

  // ── Timeout retry ─────────────────────────────────────
  useEffect(() => {
    if (!ocrLoading) { setShowTimeoutRetry(false); return; }
    const t = setTimeout(() => setShowTimeoutRetry(true), 8000);
    return () => clearTimeout(t);
  }, [ocrLoading]);

  // ── Fetch K-line ──────────────────────────────────────
  const fetchKline = useCallback(async (code: string, period: ChartPeriod) => {
    if (!code) return;
    setKlineLoading(true); setKlineError(null);
    try {
      const r = await getKlineData(code, period, 100);
      if (!r.error) setKlineResult(r); else setKlineError(r.error);
    } catch (err) { setKlineError(err instanceof Error ? err.message : 'K线数据加载失败'); }
    finally { setKlineLoading(false); }
  }, []);

  // ── Recognition ───────────────────────────────────────
  const recognitionIdRef = useRef(0);

  const runRecognition = useCallback(async (filePath: string) => {
    const myId = ++recognitionIdRef.current;
    setStockResult(null); setLiveQuote(null); setKlineResult(null); setKlineError(null); setOcrError(null);
    setShowTimeoutRetry(false); setOcrLoading(true); setProgressPercent(0);
    recognitionStartRef.current = Date.now();
    let capturedQuote: RealtimeQuote | undefined;
    try {
      const dataUrl = await readImageFile(filePath);
      if (myId !== recognitionIdRef.current) return;
      const raw = dataUrl.split(',')[1];
      const compressed = await compressImage(raw);
      if (myId !== recognitionIdRef.current) return;
      const result = await extractStockInfoBase64(compressed);
      if (myId !== recognitionIdRef.current) return;
      setStockResult(result); setProgressPercent(100);
      if (!result.error && result.stock_code) {
        setQuoteLoading(true);
        try {
          const q = await getTencentQuote(result.stock_code);
          if (myId !== recognitionIdRef.current) return;
          if (!q.error) {
            setLiveQuote(q);
            capturedQuote = q;
          }
        } catch {} finally { setQuoteLoading(false); }
        fetchKline(result.stock_code, 'daily');
      }
      if (myId !== recognitionIdRef.current) return;
      if (
        result.success &&
        result.stock_code &&
        result.stock_name &&
        capturedQuote &&
        capturedQuote.success
      ) {
        const priceStr = capturedQuote.price != null ? String(capturedQuote.price) : (result.current_price ?? null);
        const changePctStr = capturedQuote.change_pct != null
          ? `${capturedQuote.change_pct > 0 ? '+' : ''}${capturedQuote.change_pct.toFixed(2)}%`
          : (result.change_percent ?? null);
        try {
          await saveHistory({
            image_path: filePath,
            stock_code: result.stock_code,
            stock_name: result.stock_name ?? '',
            current_price: priceStr,
            change_percent: changePctStr,
            change_amount: result.change_amount ?? null,
            open: result.open ?? null,
            high: result.high ?? null,
            low: result.low ?? null,
            volume: result.volume ?? null,
            turnover: result.turnover ?? null,
            source: 'ocr',
          });
          setHistoryRefreshKey(prev => prev + 1);
        } catch (saveErr) {
          console.error('[History] Auto-save failed:', saveErr);
        }
      }
    } catch (err) {
      if (myId !== recognitionIdRef.current) return;
      setOcrError(err instanceof Error ? err.message : '未知错误'); setProgressPercent(0);
    }
    finally {
      if (myId === recognitionIdRef.current) {
        setOcrLoading(false); setShowTimeoutRetry(false);
      }
    }
  }, [fetchKline]);

  const handleImageSelected = useCallback(async (filePath: string) => {
    setImagePath(filePath);
    if (!serviceReady) { setOcrError('AI Vision 服务不可用'); return; }
    await runRecognition(filePath);
  }, [serviceReady, runRecognition]);

  const handleRetryRecognition = useCallback(async () => { if (imagePath) await runRecognition(imagePath); }, [imagePath, runRecognition]);

  const handleChartPeriodChange = useCallback((period: ChartPeriod) => {
    setChartPeriod(period);
    if (stockResult?.stock_code) fetchKline(stockResult.stock_code, period);
  }, [stockResult, fetchKline]);

  const handleClear = useCallback(() => { setImagePath(null); setStockResult(null); setLiveQuote(null); setKlineResult(null); setKlineError(null); setOcrError(null); }, []);
  const handleOpenHistory = useCallback(() => setView('history'), []);
  const handleOpenAnalysis = useCallback(() => setView('analysis'), []);
  const handleSelectRecord = useCallback((id: number) => { setHistoryRecordId(id); setView('history-detail'); }, []);
  const handleBackFromDetail = useCallback(() => setView('history'), []);
  const handleBackFromHistory = useCallback(() => setView('analysis'), []);

  const showToast = useCallback((msg: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(msg);
    toastTimerRef.current = setTimeout(() => setToast(null), 3000);
  }, []);

  const handleSaveReport = useCallback(async () => {
    if (!stockResult || saving) return;
    setSaving(true);
    try {
      const result = await saveAnalysisReport({ stockResult, liveQuote, klineResult });
      if (result.ok) {
        showToast('已保存到本地 SnapVision 目录');
      } else {
        showToast(`保存失败: ${result.error || '未知错误'}`);
      }
    } catch (err) {
      showToast(`保存失败: ${err instanceof Error ? err.message : '未知错误'}`);
    } finally {
      setSaving(false);
    }
  }, [stockResult, liveQuote, klineResult, saving, showToast]);

  const statusMsg: OcrStatus = { status: serviceReady ? 'ok' : 'stopped', ready: serviceReady, message: serviceMessage };

  // Derived state
  const hasResult = !!stockResult && !ocrLoading && !stockResult.error;
  const stockDisplayName = liveQuote?.name ?? stockResult?.stock_name ?? null;
  const stockDisplayCode = stockResult?.stock_code ?? null;

  // ═══════════════════════════════════════════════════════
  // WIDE LAYOUT (fullscreen / >= 1280px)
  // ═══════════════════════════════════════════════════════
  if (isWide) {
    return (
      <div className="h-screen flex flex-col" style={{ backgroundColor: '#0F1115' }}>

        {/* ── Toolbar (36px) ─────────────────────────────── */}
        <header
          className="titlebar-drag flex-shrink-0 flex items-center"
          style={{ height: 36, borderBottom: '1px solid #2A313D', backgroundColor: '#0F1115' }}
        >
          {/* Left: macOS traffic lights spacer + logo */}
          <div className="flex items-center gap-2.5 pl-[78px]">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: '#3b82f6' }} />
              <span className="text-dark-300 text-[10px] font-bold tracking-[0.12em] uppercase" style={{ letterSpacing: '0.12em' }}>
                SnapVision
              </span>
            </div>
            <div className="divider-v" />
            <StatusBar status={statusMsg} />
          </div>

          {/* Center: stock info when result available */}
          <div className="flex-1 flex items-center justify-center">
            {hasResult && stockDisplayName ? (
              <div className="flex items-center gap-2">
                <span className="text-dark-100 text-[12px] font-semibold">{stockDisplayName}</span>
                {stockDisplayCode && (
                  <span className="text-dark-500 text-[10px] font-mono">{stockDisplayCode}</span>
                )}
                {liveQuote?.price != null && (
                  <>
                    <div className="divider-v" />
                    <span className="text-dark-100 text-[12px] font-semibold font-mono tabular-nums">
                      {liveQuote.price.toFixed(2)}
                    </span>
                    {liveQuote.change_pct != null && (
                      <span className={`text-[11px] font-medium font-mono tabular-nums ${liveQuote.change_pct >= 0 ? 'text-[#26A69A]' : 'text-[#EF5350]'}`}>
                        {liveQuote.change_pct > 0 ? '+' : ''}{liveQuote.change_pct.toFixed(2)}%
                      </span>
                    )}
                  </>
                )}
              </div>
            ) : (
              <span className="text-dark-600 text-[10px]">
                {ocrLoading ? loadingText : '等待识别'}
              </span>
            )}
          </div>

           {/* Right: action buttons */}
           <div className="flex items-center gap-0.5 pr-3">
             {/* 识别 */}
             <button type="button" onClick={handleOpenAnalysis}
               className={view === 'analysis' ? 'toolbar-btn-active' : 'toolbar-btn'}>
               <IconScan />
               <span>识别</span>
             </button>

             {/* 保存 */}
             {hasResult && (
               <button type="button" onClick={handleSaveReport} disabled={saving} className="toolbar-btn">
                 <IconSave />
                 <span>{saving ? '...' : '保存'}</span>
               </button>
             )}

             {/* 历史 */}
             <button type="button" onClick={handleOpenHistory}
               className={view !== 'analysis' ? 'toolbar-btn-active' : 'toolbar-btn'}>
               <IconHistory />
               <span>历史</span>
             </button>

             <div className="divider-v mx-1" />

            {/* Settings Button */}
            <div className="titlebar-no-drag">
              <button 
                type="button" 
                onClick={() => {
                  console.log('Settings button clicked, opening panel');
                  setSettingsOpen(true);
                }} 
                className="toolbar-btn"
                title="设置"
              >
                <IconSettings />
              </button>
            </div>
           </div>
        </header>

        {/* Progress bar */}
        {ocrLoading && <ProgressBar percent={progressPercent} />}

        {/* ── Main: 3-column grid ────────────────────────── */}
        {view === 'analysis' ? (
          <div className="flex-1 min-h-0 grid" style={{ gridTemplateColumns: leftCollapsed ? '0px 1fr 340px' : '260px 1fr 340px' }}>

            {/* ── Left Column (260px) ────────────────────── */}
            {!leftCollapsed && (
              <aside className="overflow-y-auto custom-scrollbar" style={{ borderRight: '1px solid #2A313D' }}>
                <div className="p-2.5 space-y-2">
                  {/* Screenshot thumbnail or drop zone */}
                  {!imagePath ? (
                    <DropZone onImageSelected={handleImageSelected} disabled={!serviceReady} compact />
                  ) : (
                    <ImagePreview imagePath={imagePath} onClear={handleClear} compact />
                  )}

                  {ocrError && <ErrorBanner message={ocrError} onDismiss={() => setOcrError(null)} />}

                  {/* Loading spinner */}
                  {ocrLoading && (
                    <div className="card p-3">
                      <div className="flex flex-col items-center gap-2 py-2">
                        <span className="inline-block w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: '#343c4a', borderTopColor: '#3b82f6' }} />
                        <span className="text-dark-400 text-[10px]">{loadingText}</span>
                        {showTimeoutRetry && (
                          <button type="button" onClick={handleRetryRecognition}
                            className="px-2.5 py-1 rounded-button text-yellow-400 text-[10px]"
                            style={{ backgroundColor: 'rgba(234, 179, 8, 0.08)', border: '1px solid rgba(234, 179, 8, 0.15)' }}>
                            重试
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Stock info */}
                  {hasResult && (
                    <>
                      <StockInfoPanel data={stockResult!} liveQuote={liveQuote} quoteLoading={quoteLoading} compact />
                      <MetricCards data={stockResult!} liveQuote={liveQuote} columns={2} />
                      <BottomDrawer data={stockResult!} />
                    </>
                  )}

                  {/* Error state */}
                  {stockResult && !ocrLoading && stockResult.error && (
                    <NoStockInfoBanner message={stockResult.error} />
                  )}

                  {/* Empty state */}
                  {!imagePath && !stockResult && !ocrLoading && (
                    <div className="card p-4 text-center">
                      <p className="text-dark-600 text-[10px] leading-relaxed">
                        拖拽截图到上方区域<br />或点击选择图片开始识别
                      </p>
                    </div>
                  )}
                </div>
              </aside>
            )}

            {/* ── Center Column (chart) ──────────────────── */}
            <section className="overflow-hidden flex flex-col min-h-0 relative">
              {/* Collapse toggle */}
              <button
                type="button"
                onClick={() => setLeftCollapsed(!leftCollapsed)}
                className="absolute top-2 left-1 z-10 w-5 h-5 rounded flex items-center justify-center text-dark-500 hover:text-dark-300 hover:bg-dark-700/30 transition-colors"
                title={leftCollapsed ? '展开侧栏' : '收起侧栏'}
              >
                <IconChevron direction={leftCollapsed ? 'right' : 'left'} />
              </button>

              {hasResult ? (
                <div className="flex-1 min-h-0">
                  <StockChart
                    stockCode={stockResult!.stock_code ?? ''}
                    stockName={stockResult!.stock_name}
                    period={chartPeriod}
                    klineResult={klineResult}
                    loading={klineLoading}
                    error={klineError}
                    onPeriodChange={handleChartPeriodChange}
                    fillContainer
                  />
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center">
                  <div className="text-center space-y-2">
                    {ocrLoading ? (
                      <>
                        <span className="inline-block w-5 h-5 border-2 rounded-full animate-spin" style={{ borderColor: '#343c4a', borderTopColor: '#3b82f6' }} />
                        <p className="text-dark-500 text-[11px]">{loadingText}</p>
                      </>
                    ) : (
                      <>
                        <div className="w-12 h-12 mx-auto rounded-xl flex items-center justify-center" style={{ backgroundColor: 'rgba(42, 49, 61, 0.3)' }}>
                          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1} style={{ color: '#4a5363' }}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                          </svg>
                        </div>
                        <p className="text-dark-500 text-[11px]">在左侧上传截图开始识别</p>
                        <p className="text-dark-600 text-[10px]">支持拖拽、粘贴或点击选择</p>
                      </>
                    )}
                  </div>
                </div>
              )}
            </section>

            {/* ── Right Column (AI) ──────────────────────── */}
            <aside className="overflow-y-auto custom-scrollbar flex flex-col min-h-0" style={{ borderLeft: '1px solid #2A313D' }}>
              {hasResult ? (
                <>
                  <div className="flex-1 p-2.5 space-y-2">
                    <AICards data={stockResult!} liveQuote={liveQuote} klineResult={klineResult} />
                  </div>
                  {/* Disclaimer footer */}
                  <div className="flex-shrink-0 px-3 py-2" style={{ borderTop: '1px solid #2A313D' }}>
                    <p className="text-dark-600 text-[9px]">{new Date().toLocaleString('zh-CN')} 更新</p>
                    <p className="text-dark-600 text-[9px] mt-0.5">本分析仅供参考，不构成投资建议</p>
                  </div>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center p-3">
                  <p className="text-dark-600 text-[11px] text-center">等待识别结果</p>
                </div>
              )}
            </aside>
          </div>
        ) : view === 'history' ? (
          <div className="flex-1 overflow-y-auto">
            <div className="max-w-3xl mx-auto px-6 py-6">
              <HistoryList onSelectRecord={handleSelectRecord} onBack={handleBackFromHistory} />
            </div>
          </div>
        ) : historyRecordId !== null ? (
          <div className="flex-1 overflow-y-auto">
            <div className="max-w-3xl mx-auto px-6 py-6">
              <HistoryDetail recordId={historyRecordId} onBack={handleBackFromDetail} />
            </div>
          </div>
        ) : null}

        {/* Toast notification */}
        {toast && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-fade-in">
            <div className="card flex items-center gap-2 px-4 py-2" style={{ boxShadow: '0 4px 12px rgba(0,0,0,0.4)' }}>
              <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} style={{ color: '#26A69A' }}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
              <span className="text-dark-200 text-[11px] font-medium whitespace-nowrap">{toast}</span>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════
  // COMPACT / STANDARD LAYOUT (< 1280px)
  // ═══════════════════════════════════════════════════════
  return (
    <div className="flex flex-col h-screen" style={{ backgroundColor: '#0F1115' }}>
      {/* Title bar */}
      <header className="titlebar-drag flex-shrink-0 h-11 flex items-center" style={{ borderBottom: '1px solid #2A313D' }}>
        <div className="flex-1" />
        <h1 className="text-dark-400 text-[10px] font-medium tracking-[0.12em] uppercase">SnapVision</h1>
        <div className="flex-1 flex items-center justify-end pr-3 titlebar-no-drag">
          {hasResult && (
            <button type="button" onClick={handleSaveReport} disabled={saving}
              className="toolbar-btn">
              <IconSave />
              <span>{saving ? '...' : '保存'}</span>
            </button>
          )}
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto no-scrollbar">
        <div className="max-w-2xl mx-auto px-6 py-6 space-y-5">
          {view === 'analysis' && (
            <>
              <StatusBar status={statusMsg} />
              {!imagePath ? (
                <DropZone onImageSelected={handleImageSelected} disabled={!serviceReady} />
              ) : (
                <ImagePreview imagePath={imagePath} onClear={handleClear} />
              )}
              {ocrError && <ErrorBanner message={ocrError} onDismiss={() => setOcrError(null)} />}
              {ocrLoading && <ProgressBar percent={progressPercent} />}
              {ocrLoading && (
                <div className="space-y-4 animate-fade-in">
                  <SkeletonCard />
                  <div className="flex flex-col items-center gap-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="inline-block w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: '#343c4a', borderTopColor: '#3b82f6' }} />
                      <span className="text-dark-400 text-[11px]">{loadingText}</span>
                    </div>
                    {showTimeoutRetry && (
                      <div className="flex flex-col items-center gap-2">
                        <p className="text-dark-400 text-[10px]">识别较慢，可能是网络问题</p>
                        <button type="button" onClick={handleRetryRecognition}
                          className="px-3 py-1.5 rounded-button text-yellow-400 text-[11px] font-medium"
                          style={{ backgroundColor: 'rgba(234, 179, 8, 0.08)', border: '1px solid rgba(234, 179, 8, 0.15)' }}>
                          重试
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
              {stockResult && !ocrLoading && !stockResult.error && (
                <AnalysisDashboard
                  data={stockResult} liveQuote={liveQuote} quoteLoading={quoteLoading}
                  chartPeriod={chartPeriod} klineResult={klineResult}
                  klineLoading={klineLoading} klineError={klineError}
                  onChartPeriodChange={handleChartPeriodChange}
                />
              )}
              {stockResult && !ocrLoading && stockResult.error && <NoStockInfoBanner message={stockResult.error} />}
              {!imagePath && !stockResult && <p className="text-center text-dark-600 text-[11px] py-4">上传股票截图，自动识别并分析</p>}
            </>
          )}
          {view === 'history' && <HistoryList onSelectRecord={handleSelectRecord} onBack={handleBackFromHistory} />}
          {view === 'history-detail' && historyRecordId !== null && <HistoryDetail recordId={historyRecordId} onBack={handleBackFromDetail} />}
        </div>
      </main>

      {/* Bottom nav */}
      <nav className="flex-shrink-0 flex" style={{ borderTop: '1px solid #2A313D' }}>
        <button type="button" onClick={handleOpenAnalysis}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-[11px] font-medium transition-colors ${view === 'analysis' ? 'text-accent' : 'text-dark-500 hover:text-dark-300'}`}>
          <IconScan />
          <span>识别</span>
        </button>
        <button type="button" onClick={handleOpenHistory}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-[11px] font-medium transition-colors ${view !== 'analysis' ? 'text-accent' : 'text-dark-500 hover:text-dark-300'}`}>
          <IconHistory />
          <span>历史</span>
        </button>
      </nav>

      {/* Toast notification */}
      {toast && (
        <div className="fixed bottom-16 left-1/2 -translate-x-1/2 z-50 animate-fade-in">
          <div className="card flex items-center gap-2 px-4 py-2" style={{ boxShadow: '0 4px 12px rgba(0,0,0,0.4)' }}>
            <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} style={{ color: '#26A69A' }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
            <span className="text-dark-200 text-[11px] font-medium whitespace-nowrap">{toast}</span>
          </div>
        </div>
      )}

      {/* Settings Panel */}
      {settingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-lg mx-4 rounded-xl bg-dark-900 border border-dark-700 shadow-2xl overflow-hidden p-4">
            <h2 className="text-lg text-white mb-4">测试设置面板 (调试模式)</h2>
            <p className="text-dark-400 mb-4">设置面板已打开，但完整组件可能存在渲染问题。</p>
            <p className="text-dark-400 mb-4">当前状态: settingsOpen = {settingsOpen ? 'true' : 'false'}</p>
            <button 
              onClick={() => setSettingsOpen(false)}
              className="px-4 py-2 bg-blue-600 text-white rounded"
            >
              关闭
            </button>
          </div>
        </div>
      )}
      <SettingsPanel isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
