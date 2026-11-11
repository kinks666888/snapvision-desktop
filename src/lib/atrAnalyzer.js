/**
 * ATR (Average True Range) 动态止损分析模块
 *
 * 基于14日 ATR 计算止损价、目标价和风险收益比，提供波动率评级。
 * 纯函数，无副作用。
 */

/**
 * 计算 ATR（Wilder 平滑法）
 *
 * @param {Array<{high: number, low: number, close: number}>} klineData - K线数据
 * @param {number} period - 计算周期，默认 14
 * @returns {number|null} ATR 值，数据不足时返回 null
 */
export function calcATR(klineData, period = 14) {
  if (!klineData || klineData.length < period + 1) return null

  // 计算每日真实波幅 TR
  // TR = max(当日高-当日低, |当日高-昨日收|, |当日低-昨日收|)
  const trArr = []
  for (let i = 1; i < klineData.length; i++) {
    const { high, low, close } = klineData[i]
    const prevClose = klineData[i - 1].close
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low  - prevClose)
    )
    trArr.push(tr)
  }

  // 第一个 ATR = 前 period 日 TR 的简单平均
  let atr = trArr.slice(0, period).reduce((a, b) => a + b, 0) / period

  // 后续用 Wilder 平滑：ATR = (前ATR × (period-1) + 当日TR) / period
  for (let i = period; i < trArr.length; i++) {
    atr = (atr * (period - 1) + trArr[i]) / period
  }

  return parseFloat(atr.toFixed(4))
}

/**
 * 基于 ATR 计算止损价、目标价和风险收益比
 *
 * 止损价 = 当前价 - 2 × ATR
 * 目标价 = 当前价 + 3 × ATR
 * 风险收益比 = (目标价 - 当前价) / (当前价 - 止损价) = 3/2 = 1.5
 *
 * @param {Array<{high: number, low: number, close: number}>} klineData - K线数据
 * @param {number} currentPrice - 当前价格（优先使用实时行情价）
 * @returns {Object|null} 止损分析结果，数据不足时返回 null
 */
export function calcStopLoss(klineData, currentPrice) {
  const atr = calcATR(klineData, 14)
  if (!atr) return null

  const stopLoss   = parseFloat((currentPrice - 2 * atr).toFixed(2))
  const target     = parseFloat((currentPrice + 3 * atr).toFixed(2))
  const risk       = parseFloat((currentPrice - stopLoss).toFixed(2))  // 2 × ATR
  const reward     = parseFloat((target - currentPrice).toFixed(2))    // 3 × ATR
  const rrRatio    = parseFloat((reward / risk).toFixed(2))            // 固定 1.50

  // 各价位相对当前价的百分比偏移
  const stopPct    = parseFloat(((stopLoss - currentPrice) / currentPrice * 100).toFixed(2))
  const targetPct  = parseFloat(((target   - currentPrice) / currentPrice * 100).toFixed(2))

  // ATR 占当前价的百分比（衡量波动率高低）
  const atrPct     = parseFloat((atr / currentPrice * 100).toFixed(2))

  // 波动率评级
  let volatilityLevel, volatilityDesc
  if (atrPct < 1.5) {
    volatilityLevel = 'low'
    volatilityDesc  = '低波动'
  } else if (atrPct < 3.0) {
    volatilityLevel = 'medium'
    volatilityDesc  = '中等波动'
  } else if (atrPct < 5.0) {
    volatilityLevel = 'high'
    volatilityDesc  = '高波动'
  } else {
    volatilityLevel = 'extreme'
    volatilityDesc  = '极高波动'
  }

  // 止损合理性提示（A股跌停限制为-10%，止损不应超过跌停）
  const stopTooDeep = stopPct < -9.5
  const stopWarning = stopTooDeep
    ? `注意：止损幅度 ${Math.abs(stopPct).toFixed(1)}% 已超过A股跌停限制（10%），建议当价格跌破 ${(currentPrice * 0.93).toFixed(2)} 时提前观察。`
    : null

  return {
    atr, atrPct, volatilityLevel, volatilityDesc,
    currentPrice,
    stopLoss, stopPct,
    target,   targetPct,
    risk, reward, rrRatio,
    stopWarning,
    summary: buildATRSummary({ atr, atrPct, volatilityDesc, currentPrice, stopLoss, stopPct, target, targetPct, rrRatio })
  }
}

/**
 * 构建自然语言摘要
 */
function buildATRSummary({ atr, atrPct, volatilityDesc, currentPrice, stopLoss, stopPct, target, targetPct, rrRatio }) {
  return `当前14日ATR为 ${atr.toFixed(2)} 元（占股价 ${atrPct}%，${volatilityDesc}）。` +
    `基于2倍ATR止损，合理止损位为 ${stopLoss} 元（下方 ${Math.abs(stopPct)}%）；` +
    `3倍ATR目标位为 ${target} 元（上方 ${targetPct}%）；` +
    `风险收益比 1:${rrRatio}，每承担1元风险期望获得${rrRatio}元收益。` +
    `A股实行T+1规则，止损需次日执行，请结合实际情况灵活调整。`
}

/**
 * ATR 分析结果类型别名（供 JSDoc 参考）
 *
 * @typedef {Object} AtrStopLossResult
 * @property {number} atr        - ATR 值（4位小数）
 * @property {number} atrPct     - ATR 占当前价百分比
 * @property {string} volatilityLevel - 波动率等级: low|medium|high|extreme
 * @property {string} volatilityDesc  - 波动率中文描述
 * @property {number} currentPrice    - 当前价
 * @property {number} stopLoss   - 止损价
 * @property {number} stopPct    - 止损距当前价百分比
 * @property {number} target     - 目标价
 * @property {number} targetPct  - 目标价距当前价百分比
 * @property {number} risk       - 风险金额（2×ATR）
 * @property {number} reward     - 收益金额（3×ATR）
 * @property {number} rrRatio    - 风险收益比
 * @property {string|null} stopWarning - 止损警告（超出跌停限制时）
 * @property {string} summary    - 自然语言摘要
 */
