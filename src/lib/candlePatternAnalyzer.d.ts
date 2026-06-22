export interface CandlePatternResult {
  name: string;
  type: string;
  signal: 'bullish' | 'bearish' | 'neutral';
  desc: string;
}

export function detectCandlePatterns(
  klineData: Array<{ open: number; high: number; low: number; close: number }>,
): CandlePatternResult[];

export function buildPatternSummary(patterns: CandlePatternResult[]): string;
