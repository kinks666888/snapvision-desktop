/**
 * 多周期共振分析模块
 *
 * 对日K/周K/月K 三个周期分别做技术分析，
 * 判断多周期是否形成共振（看多/看空），并据此调整综合评分。
 */

import { analyze } from './stockAnalyzer.js'

// ─── 周期配置 ────────────────────────────────────────────────

export const PERIODS = {
  daily:   { klt: 101, label: '日K', count: 120, period: 'daily' },
  weekly:  { klt: 102, label: '周K', count: 60,  period: 'weekly' },
  monthly: { klt: 103, label: '月K', count: 36,  period: 'monthly' },
}

// ─── 判定函数 ────────────────────────────────────────────────

function isBullish(result) {
  return result.score.value >= 50 && result.trend.direction !== 'down'
}

function isBearish(result) {
  return result.score.value < 35 || result.trend.direction === 'down'
}

// ─── 纯计算：接收已获取的 K 线数据，返回共振分析结果 ────────

/**
 * @param {Object} periodDataMap  { daily: bar[], weekly: bar[], monthly: bar[] }
 *                                每个值可以为 null（请求失败时）
 * @param {Object} stockInfo      { code, name, price, changePct, ... }
 * @returns {Object} 共振分析结果
 */
export function analyzeMultiTimeframe(periodDataMap, stockInfo) {
  const keys = ['daily', 'weekly', 'monthly']
  const results = {}
  const failed = []

  for (const key of keys) {
    const bars = periodDataMap[key]
    if (bars && bars.length >= 20) {
      results[key] = analyze(bars, stockInfo)
    } else {
      failed.push(key)
    }
  }

  const availableKeys = Object.keys(results)

  // 数据不完整时的降级处理
  if (availableKeys.length === 0) {
    return {
      periods: {},
      resonance: { type: 'no_data', label: '数据不足', color: 'gray', multiplier: 1, bullishCount: 0 },
      score: { base: 0, adjusted: 0, gradeLabel: '建议观望' },
      summary: '所有周期数据获取失败，无法进行共振分析。',
      failed,
    }
  }

  // 标记每个周期的多空状态
  const periodResults = {}
  for (const key of keys) {
    if (results[key]) {
      periodResults[key] = {
        ...results[key],
        label: PERIODS[key].label,
        bullish: isBullish(results[key]),
        bearish: isBearish(results[key]),
      }
    }
  }

  const bullishCount = availableKeys.filter(k => isBullish(results[k])).length
  const bearishCount = availableKeys.filter(k => isBearish(results[k])).length
  const isIncomplete = failed.length > 0

  // 共振类型判定
  let resonanceType, multiplier, resonanceLabel, resonanceColor

  if (isIncomplete) {
    resonanceType = 'incomplete'
    multiplier = 0.9
    resonanceLabel = '数据不完整'
    resonanceColor = 'gray'
  } else if (bullishCount === 3) {
    resonanceType = 'strong_bull'
    multiplier = 1.3
    resonanceLabel = '强多头共振'
    resonanceColor = 'green'
  } else if (bullishCount === 2) {
    resonanceType = 'weak_bull'
    multiplier = 1.1
    resonanceLabel = '弱多头共振'
    resonanceColor = 'blue'
  } else if (bearishCount === 3) {
    resonanceType = 'strong_bear'
    multiplier = 0.7
    resonanceLabel = '多周期下跌'
    resonanceColor = 'red'
  } else if (bearishCount === 2) {
    resonanceType = 'weak_bear'
    multiplier = 0.85
    resonanceLabel = '偏空震荡'
    resonanceColor = 'orange'
  } else {
    resonanceType = 'neutral'
    multiplier = 0.85
    resonanceLabel = '信号不稳定'
    resonanceColor = 'gray'
  }

  // 使用日线基准分（如果日线不可用，取第一个可用周期）
  const baseKey = results.daily ? 'daily' : availableKeys[0]
  const baseScore = results[baseKey].score.value
  const adjustedScore = Math.min(100, Math.round(baseScore * multiplier))
  const gradeLabel = adjustedScore >= 70 ? '可以关注'
                   : adjustedScore >= 40 ? '建议观望'
                   : '注意风险'

  // 生成共振摘要
  const trendWord = d => d === 'up' ? '偏多' : d === 'down' ? '偏空' : '震荡'
  const parts = []
  for (const key of keys) {
    if (results[key]) {
      parts.push(`${PERIODS[key].label}${trendWord(results[key].trend.direction)}`)
    }
  }
  const summary = parts.join('，') + `。形成【${resonanceLabel}】，${bullishCount} 个周期共振看多。`

  return {
    periods: periodResults,
    resonance: {
      type: resonanceType,
      label: resonanceLabel,
      color: resonanceColor,
      multiplier,
      bullishCount,
    },
    score: { base: baseScore, adjusted: adjustedScore, gradeLabel },
    summary,
    failed,
  }
}

// ─── 便捷包装：拉取 + 计算一体化 ────────────────────────────

/**
 * 并发拉取三个周期的 K 线数据并执行共振分析
 *
 * @param {string}   stockCode    股票代码
 * @param {Object}   stockInfo    股票基础信息
 * @param {Function} fetchKlineFn 拉取函数 (code, klt, count) => Promise<bar[]>
 * @returns {Promise<Object>}     共振分析结果
 */
export async function multiTimeframeAnalyze(stockCode, stockInfo, fetchKlineFn) {
  const entries = Object.entries(PERIODS)
  const fetches = await Promise.allSettled(
    entries.map(([, cfg]) => fetchKlineFn(stockCode, cfg.klt, cfg.count))
  )

  const periodDataMap = {}
  entries.forEach(([key], i) => {
    const result = fetches[i]
    if (result.status === 'fulfilled' && Array.isArray(result.value)) {
      periodDataMap[key] = result.value
    } else if (result.status === 'fulfilled' && result.value?.bars) {
      // 兼容 KlineResult 格式
      periodDataMap[key] = result.value.bars
    } else {
      periodDataMap[key] = null
    }
  })

  return analyzeMultiTimeframe(periodDataMap, stockInfo)
}
