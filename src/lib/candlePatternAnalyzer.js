/**
 * Candle Pattern Analyzer (K线形态识别)
 *
 * Rule-based pattern detection for common candlestick reversal/continuation patterns.
 * Pure functions — no side effects, no DOM, no dependencies.
 *
 * Input: An array of bars/OHLCV objects (each with open/high/low/close).
 * Output: A list of detected patterns with name, type, signal, and description.
 */

/**
 * Detect candlestick patterns from the most recent 3 bars.
 * @param {Array<{open: number, high: number, low: number, close: number}>} klineData
 * @returns {Array<{name: string, type: string, signal: string, desc: string}>}
 */
export function detectCandlePatterns(klineData) {
  if (!klineData || klineData.length < 3) return [];
  const patterns = [];
  const len = klineData.length;

  // 取最近3根K线做形态判断
  const c0 = klineData[len - 1]; // 最新一根
  const c1 = klineData[len - 2]; // 前一根
  const c2 = klineData[len - 3]; // 再前一根

  // 辅助函数
  const body = (c) => Math.abs(c.close - c.open); // 实体长度
  const range = (c) => c.high - c.low; // 全幅
  const isGreen = (c) => c.close > c.open; // 阳线
  const isRed = (c) => c.close < c.open; // 阴线
  const upperShadow = (c) => c.high - Math.max(c.open, c.close);
  const lowerShadow = (c) => Math.min(c.open, c.close) - c.low;

  // Prevent division by zero for body/range
  const safeBody = Math.max(body(c0), 0.0001);
  const safeRange = Math.max(range(c0), 0.0001);

  // 1. 十字星（Doji）：实体极小，上下影线明显
  if (body(c0) <= safeRange * 0.1 && range(c0) > 0) {
    patterns.push({
      name: '十字星',
      type: 'doji',
      signal: 'neutral',
      desc: '开收盘价几乎相同，市场多空分歧加大，趋势可能反转，需结合前期走势判断。',
    });
  }

  // 2. 锤子线（Hammer）：下影线长，实体小，出现在下跌趋势末端
  if (
    lowerShadow(c0) >= safeBody * 2 &&
    upperShadow(c0) <= safeBody * 0.3 &&
    isRed(c1) &&
    isRed(c2)
  ) {
    patterns.push({
      name: '锤子线',
      type: 'hammer',
      signal: 'bullish',
      desc: '下影线长，空方打压后多方收复，出现在下跌末期，看涨反转信号。',
    });
  }

  // 3. 上吊线（Hanging Man）：形态同锤子线，出现在上涨趋势末端
  if (
    lowerShadow(c0) >= safeBody * 2 &&
    upperShadow(c0) <= safeBody * 0.3 &&
    isGreen(c1) &&
    isGreen(c2)
  ) {
    patterns.push({
      name: '上吊线',
      type: 'hanging_man',
      signal: 'bearish',
      desc: '形似锤子但出现在高位，警示上涨动能衰竭，需警惕回调。',
    });
  }

  // 4. 射击之星（Shooting Star）：上影线长，实体小，出现在上涨后
  if (
    upperShadow(c0) >= safeBody * 2 &&
    lowerShadow(c0) <= safeBody * 0.3 &&
    c0.close > c2.close
  ) {
    patterns.push({
      name: '射击之星',
      type: 'shooting_star',
      signal: 'bearish',
      desc: '上影线长，多方冲高后被压回，看跌反转信号，尤其出现在高位时需重视。',
    });
  }

  // 5. 看涨吞噬（Bullish Engulfing）：阴线后出现更大阳线完全包裹
  if (isGreen(c0) && isRed(c1) && c0.open <= c1.close && c0.close >= c1.open) {
    patterns.push({
      name: '看涨吞噬',
      type: 'bullish_engulfing',
      signal: 'bullish',
      desc: '大阳线完全覆盖前根阴线，多方强势反击，短期看涨信号较强。',
    });
  }

  // 6. 看跌吞噬（Bearish Engulfing）：阳线后出现更大阴线完全包裹
  if (isRed(c0) && isGreen(c1) && c0.open >= c1.close && c0.close <= c1.open) {
    patterns.push({
      name: '看跌吞噬',
      type: 'bearish_engulfing',
      signal: 'bearish',
      desc: '大阴线完全覆盖前根阳线，空方强势压制，短期看跌信号。',
    });
  }

  // 7. 早晨之星（Morning Star）：三根K线，阴线+小实体+阳线，出现在低位
  if (
    isRed(c2) &&
    body(c1) <= range(c1) * 0.3 &&
    isGreen(c0) &&
    c0.close > (c2.open + c2.close) / 2
  ) {
    patterns.push({
      name: '早晨之星',
      type: 'morning_star',
      signal: 'bullish',
      desc: '三K线底部反转形态，信号较强，出现在低位下跌趋势末端时可靠性高。',
    });
  }

  // 8. 黄昏之星（Evening Star）：三根K线，阳线+小实体+阴线，出现在高位
  if (
    isGreen(c2) &&
    body(c1) <= range(c1) * 0.3 &&
    isRed(c0) &&
    c0.close < (c2.open + c2.close) / 2
  ) {
    patterns.push({
      name: '黄昏之星',
      type: 'evening_star',
      signal: 'bearish',
      desc: '三K线顶部反转形态，出现在高位上涨趋势末端，看跌可靠性较高。',
    });
  }

  // 9. 孕线（Harami）：大K线后出现小K线完全被包含
  if (
    body(c0) < body(c1) * 0.5 &&
    c0.high <= Math.max(c1.open, c1.close) &&
    c0.low >= Math.min(c1.open, c1.close)
  ) {
    const signal = isGreen(c0) ? 'bullish' : 'bearish';
    patterns.push({
      name: isGreen(c0) ? '看涨孕线' : '看跌孕线',
      type: 'harami',
      signal,
      desc: '母子线形态，趋势动能减弱，可能出现方向转变，结合成交量判断。',
    });
  }

  // 10. 三连阳 / 三连阴
  if (
    isGreen(c0) &&
    isGreen(c1) &&
    isGreen(c2) &&
    c0.close > c1.close &&
    c1.close > c2.close
  ) {
    patterns.push({
      name: '三连阳',
      type: 'three_white_soldiers',
      signal: 'bullish',
      desc: '连续三根阳线逐级上升，多方持续发力，趋势强势信号。',
    });
  }
  if (
    isRed(c0) &&
    isRed(c1) &&
    isRed(c2) &&
    c0.close < c1.close &&
    c1.close < c2.close
  ) {
    patterns.push({
      name: '三连阴',
      type: 'three_black_crows',
      signal: 'bearish',
      desc: '连续三根阴线逐级下跌，空方持续压制，趋势弱势信号。',
    });
  }

  return patterns;
}

/**
 * Generate a human-readable summary from detected pattern list.
 * @param {Array<{name: string, signal: string, desc: string}>} patterns
 * @returns {string}
 */
export function buildPatternSummary(patterns) {
  if (!patterns || patterns.length === 0) {
    return '当前K线未形成明显特征形态，继续观察。';
  }
  const bullish = patterns.filter((p) => p.signal === 'bullish');
  const bearish = patterns.filter((p) => p.signal === 'bearish');
  const names = patterns.map((p) => p.name).join('、');

  let overall = '';
  if (bullish.length > bearish.length) overall = '整体形态偏多头信号。';
  else if (bearish.length > bullish.length) overall = '整体形态偏空头信号。';
  else overall = '多空形态信号中性，需结合其他指标判断。';

  return `识别到以下形态：${names}。${patterns[0].desc}${overall}`;
}
