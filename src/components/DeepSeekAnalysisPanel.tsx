/**
 * DeepSeekAnalysisPanel — DeepSeek AI 行情分析面板
 *
 * 显示 StockCard 的 🤖分析 tab 中，替代原有的本地分析引擎。
 * 自动流式显示 DeepSeek 返回的分析内容。
 */

import React, { useEffect, useState, useCallback } from 'react';
import type { KlineResult, RealtimeQuote, AiAnalysisResult } from '../types/electron';
import { getAiAnalysis } from '../services/market-service';

interface DeepSeekAnalysisPanelProps {
  stockName: string | null;
  stockCode: string | null;
  currentPrice: string | null;
  changePercent: string | null;
  klineResult: KlineResult | null;
  liveQuote: RealtimeQuote | null;
}

export function DeepSeekAnalysisPanel({
  stockName,
  stockCode,
  currentPrice,
  changePercent,
  klineResult,
  liveQuote,
}: DeepSeekAnalysisPanelProps) {
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timestamp, setTimestamp] = useState<string>('');

  const runAnalysis = useCallback(async () => {
    if (!stockCode || !klineResult?.bars || klineResult.bars.length < 5) return;

    setLoading(true);
    setError(null);

    try {
      const price = liveQuote?.price ?? currentPrice ?? '--';
      const change = liveQuote?.change_pct != null
        ? `${liveQuote.change_pct > 0 ? '+' : ''}${liveQuote.change_pct.toFixed(2)}%`
        : changePercent ?? '--';

      const result: AiAnalysisResult = await getAiAnalysis({
        stock_name: stockName ?? '',
        stock_code: stockCode,
        price: price,
        change_pct: change,
        kline_bars: klineResult.bars.slice(-30),
      });

      if (result.success && result.analysis) {
        setAnalysis(result.analysis);

        const now = new Date();
        setTimestamp(
          `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ` +
          `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`
        );
      } else {
        setError(result.error || '分析生成失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI 分析请求失败');
    } finally {
      setLoading(false);
    }
  }, [stockCode, stockName, currentPrice, changePercent, klineResult, liveQuote]);

  useEffect(() => {
    setAnalysis(null);
    setError(null);
    if (klineResult?.bars && klineResult.bars.length >= 5) {
      runAnalysis();
    }
  }, [klineResult, runAnalysis]);

  // Header
  const header = (
    <div className="flex items-center justify-between px-4 py-3 border-b border-dark-700/30">
      <div className="flex items-center gap-2">
        <span className="text-sm">🤖</span>
        <span className="text-dark-200 text-xs font-semibold tracking-wide">DeepSeek AI 分析</span>
      </div>
      {timestamp && (
        <span className="text-dark-600 text-[10px]">{timestamp}</span>
      )}
    </div>
  );

  // Loading state
  if (loading) {
    return (
      <div className="glass-card overflow-hidden animate-fade-in border-purple-500/10">
        {header}
        <div className="flex items-center gap-3 px-5 py-6">
          <span className="inline-block w-4 h-4 border-2 border-dark-500 border-t-purple-400 rounded-full animate-spin" />
          <div>
            <p className="text-dark-300 text-xs font-medium">DeepSeek AI 分析中…</p>
            <p className="text-dark-600 text-[10px] mt-0.5">正在调用 AI 模型分析 K 线数据</p>
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    // 区分"AI 未配置"和真正错误
    const isNotConfigured = error.includes('DEEPSEEK_API_KEY 未配置') || error.includes('503');
    const borderColor = isNotConfigured ? 'border-yellow-500/10' : 'border-red-500/10';
    const bgColor = isNotConfigured ? 'bg-yellow-500/5 border-yellow-500/15' : 'bg-red-500/5 border-red-500/15';
    const textColor = isNotConfigured ? 'text-yellow-400' : 'text-red-400';

    return (
      <div className={`glass-card overflow-hidden animate-fade-in ${borderColor}`}>
        {header}
        <div className="px-5 py-4">
          <div className={`p-3 rounded-lg ${bgColor}`}>
            {isNotConfigured ? (
              <>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm">⚙️</span>
                  <p className="text-yellow-300 text-xs font-medium">未启用 AI 增强分析</p>
                </div>
                <p className="text-dark-500 text-[10px] leading-relaxed">
                  当前使用本地 OCR 识别。如需 AI 智能分析，请在环境变量中配置
                  <code className="text-dark-400 bg-dark-800/60 px-1 rounded mx-0.5">DEEPSEEK_API_KEY</code>。
                </p>
              </>
            ) : (
              <>
                <p className={`text-xs ${textColor}`}>{error}</p>
                <button
                  onClick={runAnalysis}
                  className="mt-2 text-[10px] px-3 py-1 rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                >
                  重试
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  // No data
  if (!analysis) {
    return (
      <div className="glass-card overflow-hidden animate-fade-in">
        {header}
        <div className="px-5 py-4">
          <p className="text-dark-500 text-xs text-center py-4">
            {klineResult?.bars && klineResult.bars.length >= 5
              ? '点击加载 AI 分析'
              : 'K 线数据不足（需 ≥5 根），无法生成分析'}
          </p>
          {klineResult?.bars && klineResult.bars.length >= 5 && (
            <button
              onClick={runAnalysis}
              className="block mx-auto text-[10px] px-3 py-1 rounded bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 transition-colors"
            >
              开始分析
            </button>
          )}
        </div>
      </div>
    );
  }

  // Success: show analysis
  return (
    <div className="glass-card overflow-hidden animate-fade-in border-purple-500/10">
      {header}

      <div className="px-5 py-4">
        {/* Analysis text */}
        <div className="p-4 rounded-lg bg-purple-500/5 border border-purple-500/10">
          <p className="text-dark-200 text-xs leading-relaxed whitespace-pre-wrap">
            {analysis}
          </p>
        </div>

        {/* Stock info context */}
        <div className="mt-3 flex items-center gap-3 text-[10px] text-dark-600">
          <span>{stockName} ({stockCode})</span>
          {currentPrice && <span>¥{currentPrice}</span>}
          {changePercent && <span className={changePercent.startsWith('+') ? 'text-red-400' : changePercent.startsWith('-') ? 'text-green-400' : ''}>{changePercent}</span>}
        </div>
      </div>
    </div>
  );
}
