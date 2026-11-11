/**
 * CryptoSpeculationPanel — 加密货币市场推测面板
 *
 * 展示多因子推测引擎结果:
 *   方向研判 (偏多/偏空/震荡) + 概率条 + 置信度
 *   五因子分解 (趋势/动量/情绪/量能/波动)
 *   关键价位 (支撑/压力/止损/目标) + 盈亏比
 *   风险评级 + 警示
 *   文字研判摘要
 *
 * 配色 (国内惯例): 涨/多 = 红 #EF5350, 跌/空 = 绿 #26A69A
 */

import React from 'react';
import type { CryptoSpeculationResult } from '../types/electron';

// ─── 常量 ─────────────────────────────────────────────────────

const COLOR_BULL = '#EF5350';   // 红 = 多
const COLOR_BEAR = '#26A69A';   // 绿 = 空
const COLOR_NEUTRAL = '#FFB74D';

const RISK_COLOR: Record<string, string> = {
  '低': '#26A69A', '中': '#FFB74D', '高': '#EF5350', '极高': '#EF5350',
};

function fmtPrice(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return '--';
  if (Math.abs(v) >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (Math.abs(v) >= 1) return v.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  return v.toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
}

// ─── 主组件 ───────────────────────────────────────────────────

interface Props {
  result: CryptoSpeculationResult;
  quote?: { price?: number | null } | null;   // 兼容 Crypto/US 行情对象
}

export function CryptoSpeculationPanel({ result, quote }: Props) {
  const dirColor = result.direction === 'bullish' ? COLOR_BULL
    : result.direction === 'bearish' ? COLOR_BEAR
    : COLOR_NEUTRAL;

  return (
    <div className="space-y-2 animate-fade-in">
      <DirectionCard result={result} dirColor={dirColor} />
      <ProbabilityCard result={result} />
      <FactorsCard factors={result.factors} />
      <KeyLevelsCard result={result} quote={quote} />
      <RiskCard risk={result.risk} />
      <SummaryCard summary={result.summary} disclaimer={result.disclaimer} confidence={result.confidence} />
    </div>
  );
}

// ─── 方向研判卡 ───────────────────────────────────────────────

function DirectionCard({ result, dirColor }: { result: CryptoSpeculationResult; dirColor: string }) {
  return (
    <div className="card overflow-hidden">
      <div className="panel-header">
        <span className="panel-title">市场推测</span>
        <span className="badge" style={{ color: dirColor, backgroundColor: `${dirColor}1a` }}>
          {result.direction_label}
        </span>
      </div>
      <div className="p-3">
        <div className="flex items-center gap-3">
          {/* 强度表盘 */}
          <DirectionGauge score={result.score} color={dirColor} />
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-1.5">
              <span className="text-xl font-bold font-mono tabular-nums" style={{ color: dirColor }}>
                {result.score}
              </span>
              <span className="text-dark-600 text-[10px]">/100 多空强度</span>
            </div>
            <div className="mt-1 flex items-center gap-1.5">
              <span className="text-dark-500 text-[10px]">置信度</span>
              <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ backgroundColor: '#222930' }}>
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${result.confidence}%`, backgroundColor: dirColor }}
                />
              </div>
              <span className="text-dark-300 text-[10px] font-mono tabular-nums">{result.confidence}%</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DirectionGauge({ score, color }: { score: number; color: string }) {
  const pct = Math.min(100, Math.max(0, score));
  const arcLength = 62.83;
  const dashLen = (pct / 100) * arcLength;
  return (
    <svg width="52" height="30" viewBox="0 0 48 28">
      <path d="M4 24 A20 20 0 0 1 44 24" fill="none" stroke="#222930" strokeWidth="3" strokeLinecap="round" />
      <path
        d="M4 24 A20 20 0 0 1 44 24"
        fill="none" stroke={color} strokeWidth="3" strokeLinecap="round"
        strokeDasharray={`${dashLen} ${arcLength}`}
      />
      <text x="24" y="21" textAnchor="middle" fontSize="8" fill={color} fontFamily="monospace">
        {pct}
      </text>
    </svg>
  );
}

// ─── 概率卡 ───────────────────────────────────────────────────

function ProbabilityCard({ result }: { result: CryptoSpeculationResult }) {
  const p = result.probabilities;
  return (
    <div className="card overflow-hidden">
      <div className="panel-header">
        <span className="panel-title">方向概率</span>
      </div>
      <div className="p-3 space-y-2">
        <ProbBar label="看涨" value={p.up} color={COLOR_BULL} />
        <ProbBar label="看跌" value={p.down} color={COLOR_BEAR} />
        <ProbBar label="震荡" value={p.range} color={COLOR_NEUTRAL} />
      </div>
    </div>
  );
}

function ProbBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-dark-500 text-[10px] w-6 flex-shrink-0">{label}</span>
      <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ backgroundColor: '#222930' }}>
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${value}%`, backgroundColor: color, opacity: 0.85 }}
        />
      </div>
      <span className="text-dark-200 text-[10px] font-mono tabular-nums w-9 text-right">
        {value.toFixed(1)}%
      </span>
    </div>
  );
}

// ─── 五因子分解 ───────────────────────────────────────────────

function FactorsCard({ factors }: { factors: CryptoSpeculationResult['factors'] }) {
  return (
    <div className="card overflow-hidden">
      <div className="panel-header">
        <span className="panel-title">多因子分解</span>
        <span className="text-dark-600 text-[9px]">权重 × 得分</span>
      </div>
      <div className="p-3 space-y-2">
        {factors.map(f => {
          const color = f.score > 10 ? COLOR_BULL : f.score < -10 ? COLOR_BEAR : COLOR_NEUTRAL;
          const pct = Math.min(100, Math.abs(f.score));
          return (
            <div key={f.key}>
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="text-dark-300 text-[10px] w-6 flex-shrink-0">{f.name}</span>
                <span className="text-dark-600 text-[8px] font-mono">×{Math.round(f.weight * 100)}%</span>
                <div className="flex-1 h-1.5 rounded-full overflow-hidden relative" style={{ backgroundColor: '#222930' }}>
                  {/* 中线 */}
                  <div className="absolute top-0 bottom-0 left-1/2 w-px" style={{ backgroundColor: '#343c4a' }} />
                  <div
                    className="absolute top-0 bottom-0 rounded-full"
                    style={{
                      backgroundColor: color,
                      opacity: 0.85,
                      left: f.score >= 0 ? '50%' : `${50 - pct / 2}%`,
                      width: `${pct / 2}%`,
                    }}
                  />
                </div>
                <span className="text-dark-200 text-[9px] font-mono tabular-nums w-7 text-right">
                  {f.score > 0 ? '+' : ''}{f.score}
                </span>
              </div>
              <p className="text-dark-600 text-[9px] leading-relaxed pl-7">{f.detail}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── 关键价位 ─────────────────────────────────────────────────

function KeyLevelsCard({ result, quote }: { result: CryptoSpeculationResult; quote?: { price?: number | null } | null }) {
  const kl = result.key_levels;
  const price = quote?.price ?? null;
  return (
    <div className="card overflow-hidden">
      <div className="panel-header">
        <span className="panel-title">关键价位</span>
        {kl.risk_reward != null && (
          <span className="badge" style={{ color: '#B39DDB', backgroundColor: 'rgba(179, 157, 219, 0.1)' }}>
            盈亏比 {kl.risk_reward}:1
          </span>
        )}
      </div>
      <div className="p-3">
        {price != null && (
          <div className="flex items-center justify-between mb-2 pb-2" style={{ borderBottom: '1px solid #222930' }}>
            <span className="text-dark-500 text-[10px]">现价</span>
            <span className="text-dark-100 text-[13px] font-bold font-mono tabular-nums">
              {fmtPrice(price)}
            </span>
          </div>
        )}
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
          <LevelRow label="支撑位" value={kl.support} color={COLOR_BEAR} />
          <LevelRow label="压力位" value={kl.resistance} color={COLOR_BULL} />
          <LevelRow label="止损参考" value={kl.stop_loss} color="#FFB74D" />
          <LevelRow label="目标 1" value={kl.target1} color={COLOR_BULL} />
          <LevelRow label="目标 2" value={kl.target2} color={COLOR_BULL} />
        </div>
      </div>
    </div>
  );
}

function LevelRow({ label, value, color }: { label: string; value: number | null | undefined; color: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-dark-500 text-[10px]">{label}</span>
      <span className="text-[11px] font-mono tabular-nums" style={{ color }}>
        {fmtPrice(value)}
      </span>
    </div>
  );
}

// ─── 风险卡 ───────────────────────────────────────────────────

function RiskCard({ risk }: { risk: CryptoSpeculationResult['risk'] }) {
  const color = RISK_COLOR[risk.level] ?? COLOR_NEUTRAL;
  return (
    <div className="card overflow-hidden">
      <div className="panel-header">
        <span className="panel-title">风险评级</span>
        <div className="flex items-center gap-1.5">
          {risk.volatility_pct != null && (
            <span className="text-dark-600 text-[9px] font-mono">ATR {risk.volatility_pct}%</span>
          )}
          <span className="badge" style={{ color, backgroundColor: `${color}1a` }}>
            {risk.level}风险
          </span>
        </div>
      </div>
      {risk.warnings.length > 0 && (
        <div className="p-3 pt-2 space-y-1">
          {risk.warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-1.5">
              <svg className="w-3 h-3 flex-shrink-0 mt-px" fill="none" viewBox="0 0 24 24"
                stroke={color} strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
              <p className="text-dark-400 text-[9px] leading-relaxed">{w}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── 研判摘要 ─────────────────────────────────────────────────

function SummaryCard({ summary, disclaimer, confidence }: {
  summary: string; disclaimer: string; confidence: number;
}) {
  return (
    <div className="card overflow-hidden">
      <div className="panel-header">
        <span className="panel-title">研判摘要</span>
        <span className="text-dark-600 text-[9px]">置信度 {confidence}%</span>
      </div>
      <div className="p-3">
        <p className="text-dark-300 text-[10px] leading-relaxed">{summary}</p>
        <p className="text-dark-600 text-[8px] leading-relaxed mt-2 pt-2" style={{ borderTop: '1px solid #222930' }}>
          {disclaimer}
        </p>
      </div>
    </div>
  );
}
