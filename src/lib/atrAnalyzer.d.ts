export interface StopLossResult {
  atr: number;
  stopLoss: number;
  target: number;
  risk: number;
  reward: number;
  rrRatio: number;
  stopPct: number;
  targetPct: number;
  atrPct: number;
  volatilityLevel: 'low' | 'medium' | 'high' | 'extreme';
  volatilityDesc: string;
  currentPrice: number;
  stopWarning: string | null;
  summary: string;
}

export function calcATR(
  klineData: Array<{ high: number; low: number; close: number }>,
  period?: number,
): number | null;

export function calcStopLoss(
  klineData: Array<{ high: number; low: number; close: number }>,
  currentPrice: number,
): StopLossResult | null;
