"""
Crypto Speculation Engine — 加密货币市场多因子推测引擎

输入: K 线 bars + 实时行情 (含资金费率/多空比/恐慌贪婪指数)
输出: 多空方向推测 (偏多/偏空/震荡) + 置信度 + 因子分解 + 支撑压力位 + 交易计划 + 风险评级

多因子加权模型:
  趋势 (30%)  — MA20/MA50 排列、价格位置、斜率
  动量 (25%)  — RSI(14)、MACD 柱、KDJ
  情绪 (20%)  — 资金费率、多空比、恐慌贪婪指数 (均带反向性)
  量能 (15%)  — 量能趋势、放量/缩量配合
  波动 (10%)  — ATR 波动率 → 主要影响置信度与风险评级

⚠️ 本模块输出仅为技术面统计推测,不构成投资建议。
"""

from __future__ import annotations

import math
from typing import Optional

# ═══════════════════════════════════════════════════════════════
# 基础技术指标 (纯 Python, 与前端 indicators.ts 对齐)
# ═══════════════════════════════════════════════════════════════


def sma(values: list[float], period: int) -> list[Optional[float]]:
    out: list[Optional[float]] = []
    acc = 0.0
    for i, v in enumerate(values):
        acc += v
        if i >= period:
            acc -= values[i - period]
        out.append(acc / period if i >= period - 1 else None)
    return out


def ema(values: list[float], period: int) -> list[Optional[float]]:
    out: list[Optional[float]] = []
    k = 2 / (period + 1)
    prev: Optional[float] = None
    for v in values:
        if prev is None:
            prev = v
        else:
            prev = v * k + prev * (1 - k)
        out.append(prev)
    return out


def rsi(closes: list[float], period: int = 14) -> Optional[float]:
    if len(closes) < period + 1:
        return None
    gains, losses = [], []
    for i in range(1, len(closes)):
        diff = closes[i] - closes[i - 1]
        gains.append(max(diff, 0.0))
        losses.append(max(-diff, 0.0))
    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period
    for i in range(period, len(gains)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100 - 100 / (1 + rs)


def macd(closes: list[float], fast: int = 12, slow: int = 26, signal: int = 9) -> dict:
    ema_fast = ema(closes, fast)
    ema_slow = ema(closes, slow)
    dif = [(f - s) if f is not None and s is not None else 0.0
           for f, s in zip(ema_fast, ema_slow)]
    dea = ema(dif, signal)
    hist = [d - e for d, e in zip(dif, dea)]
    return {
        'dif': dif[-1] if dif else None,
        'dea': dea[-1] if dea else None,
        'hist': hist[-1] if hist else None,
        'hist_prev': hist[-2] if len(hist) >= 2 else None,
    }


def atr(bars: list[dict], period: int = 14) -> Optional[float]:
    if len(bars) < period + 1:
        return None
    trs = []
    for i in range(1, len(bars)):
        h, l = bars[i]['high'], bars[i]['low']
        pc = bars[i - 1]['close']
        trs.append(max(h - l, abs(h - pc), abs(l - pc)))
    # Wilder 平滑
    val = sum(trs[:period]) / period
    for tr in trs[period:]:
        val = (val * (period - 1) + tr) / period
    return val


def find_support_resistance(bars: list[dict], lookback: int = 30) -> dict:
    """近 lookback 根 K 线的摆动高低点聚类 → 支撑/压力。"""
    recent = bars[-lookback:] if len(bars) >= lookback else bars
    if not recent:
        return {'support': None, 'resistance': None}
    highs = [b['high'] for b in recent]
    lows = [b['low'] for b in recent]
    closes = [b['close'] for b in recent]
    last = closes[-1]

    # 压力: 高点均值与最大高点之间取较近者; 支撑同理
    resistance = max(highs)
    support = min(lows)
    # 过滤: 如果距离现价过远 (>25%), 用 ±10% 附近的高低点
    if resistance and last and (resistance - last) / last > 0.25:
        near_highs = [h for h in highs if (h - last) / last < 0.25]
        if near_highs:
            resistance = max(near_highs)
    if support and last and (last - support) / last > 0.25:
        near_lows = [l for l in lows if (last - l) / last < 0.25]
        if near_lows:
            support = min(near_lows)
    return {
        'support': round(support, 8) if support else None,
        'resistance': round(resistance, 8) if resistance else None,
    }


# ═══════════════════════════════════════════════════════════════
# 五因子评分 (-100 ~ +100)
# ═══════════════════════════════════════════════════════════════


def _clamp(v: float, lo: float = -100.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, v))


def trend_factor(bars: list[dict]) -> tuple[float, str]:
    """趋势因子: MA20/MA50 排列 + 价格位置 + MA20 斜率。"""
    closes = [b['close'] for b in bars]
    if len(closes) < 20:
        return 0.0, 'K 线不足, 趋势中性'
    ma20 = sma(closes, 20)
    ma50 = sma(closes, 50) if len(closes) >= 50 else [None] * len(closes)
    last = closes[-1]
    m20 = ma20[-1]
    m50 = ma50[-1] if len(ma50) else None

    score = 0.0
    parts = []
    if m20 is not None:
        if last > m20:
            score += 30
            parts.append('价站上 MA20')
        else:
            score -= 30
            parts.append('价跌破 MA20')
        # MA20 斜率
        if len(ma20) >= 6 and ma20[-6] is not None:
            slope = (m20 - ma20[-6]) / ma20[-6] * 100
            if slope > 1:
                score += 25
                parts.append('MA20 上行')
            elif slope < -1:
                score -= 25
                parts.append('MA20 下行')
    if m20 is not None and m50 is not None:
        if m20 > m50:
            score += 30
            parts.append('MA20>MA50 多头排列')
        else:
            score -= 30
            parts.append('MA20<MA50 空头排列')
    elif m20 is not None:
        score *= 0.7  # 数据不足, 收敛置信
    else:
        return 0.0, '数据不足'

    score = _clamp(score * 0.85)
    return score, '、'.join(parts) if parts else '趋势中性'


def momentum_factor(bars: list[dict]) -> tuple[float, str]:
    """动量因子: RSI + MACD 柱, 带趋势背景校验 (下跌中的超卖不轻易反向加分)。"""
    closes = [b['close'] for b in bars]
    score = 0.0
    parts = []

    m = macd(closes)
    dif = m['dif'] or 0.0
    in_downtrend = dif < 0
    in_uptrend = dif > 0

    r = rsi(closes, 14)
    if r is not None:
        if r >= 55:
            score += 35
            parts.append(f'RSI {r:.0f} 偏强')
            if r >= 70:
                if in_uptrend:
                    score += 10
                    parts.append('强势区钝化')
                else:
                    score -= 30
                    parts.append('超买且趋势未转强, 反转风险')
        elif r <= 45:
            score -= 35
            parts.append(f'RSI {r:.0f} 偏弱')
            if r <= 30:
                if in_downtrend:
                    score -= 10
                    parts.append('超卖且趋势未止跌, 慎言抄底')
                else:
                    score += 25
                    parts.append('上升趋势中的超卖回调')
        else:
            parts.append(f'RSI {r:.0f} 中性')

    if m['hist'] is not None:
        hist = m['hist']
        hist_prev = m['hist_prev']
        if in_uptrend and hist > 0:
            score += 35
            parts.append('MACD 多头格局')
            if hist_prev is not None and hist > hist_prev:
                score += 10
                parts.append('红柱放大')
        elif in_downtrend and hist < 0:
            score -= 35
            parts.append('MACD 空头格局')
            if hist_prev is not None and hist < hist_prev:
                score -= 10
                parts.append('绿柱放大')
        else:
            # 柱线与 DIF 方向背离 → 早期反转信号, 弱加分
            score += 15 if hist > 0 else -15
            parts.append('MACD 柱线背离, 反转初现')

    return _clamp(score * 0.9), '、'.join(parts) if parts else '动量中性'


def sentiment_factor(quote: dict) -> tuple[float, str]:
    """
    情绪因子: 资金费率 / 多空比 / 恐慌贪婪指数。
    三者均带反向性: 极度贪婪/高费率/多头拥挤 → 反向偏空。
    """
    score = 0.0
    parts = []

    fr = quote.get('funding_rate')
    if fr is not None:
        # 资金费率: 正常 ±0.01%; >0.05% 多头拥挤(反向空), <-0.05% 空头拥挤(反向多)
        if fr > 0.05:
            score -= 30
            parts.append(f'资金费率 {fr:.3f}% 偏高(多头拥挤)')
        elif fr < -0.05:
            score += 30
            parts.append(f'资金费率 {fr:.3f}% 为负(空头拥挤)')
        else:
            score += 10
            parts.append(f'资金费率 {fr:.3f}% 中性')
            if fr > 0:
                score += 5  # 温和正费率是牛市常态

    ls = quote.get('long_short')
    if isinstance(ls, dict) and ls.get('long_pct') is not None:
        lp = ls['long_pct']
        # 多空账户比: >62% 多头拥挤(反向), <38% 空头拥挤(反向)
        if lp > 62:
            score -= 25
            parts.append(f'多头占比 {lp:.0f}% 拥挤')
        elif lp < 38:
            score += 25
            parts.append(f'空头占比 {100 - lp:.0f}% 拥挤')
        else:
            score += 5
            parts.append(f'多空均衡 ({lp:.0f}/{100 - lp:.0f})')

    fg = quote.get('fear_greed')
    if isinstance(fg, dict) and fg.get('value') is not None:
        v = fg['value']
        # F&G: <25 极度恐慌(反向多), >75 极度贪婪(反向空)
        if v <= 25:
            score += 30
            parts.append(f'恐慌贪婪 {v} 极度恐慌(反向看多)')
        elif v >= 75:
            score -= 30
            parts.append(f'恐慌贪婪 {v} 极度贪婪(反向看空)')
        elif v <= 45:
            score += 10
            parts.append(f'恐慌贪婪 {v} 偏恐慌')
        elif v >= 55:
            score -= 10
            parts.append(f'恐慌贪婪 {v} 偏贪婪')
        else:
            parts.append(f'恐慌贪婪 {v} 中性')

    if not parts:
        return 0.0, '情绪数据缺失, 中性处理'
    return _clamp(score * 0.85), '、'.join(parts)


def volume_factor(bars: list[dict]) -> tuple[float, str]:
    """量能因子: 近 5 日均量 vs 前 20 日均量 + 量价配合。"""
    if len(bars) < 10:
        return 0.0, '量能数据不足'
    vols = [b['volume'] or 0 for b in bars]
    closes = [b['close'] for b in bars]
    recent = vols[-5:]
    prior = vols[-25:-5] if len(vols) >= 25 else vols[:-5]
    avg_recent = sum(recent) / len(recent)
    avg_prior = sum(prior) / len(prior) if prior else 0

    score = 0.0
    parts = []
    if avg_prior > 0:
        ratio = avg_recent / avg_prior
        if ratio > 1.5:
            parts.append('近 5 日显著放量')
            # 放量跟随价格方向
            if closes[-1] > closes[-6]:
                score += 45
                parts.append('放量上攻')
            else:
                score -= 45
                parts.append('放量下跌')
        elif ratio > 1.1:
            score += 15 if closes[-1] > closes[-6] else -15
            parts.append('量能温和放大')
        elif ratio < 0.7:
            parts.append('明显缩量')
            score += 10 if closes[-1] > closes[-6] else -10  # 缩量回调/阴跌
        else:
            parts.append('量能平稳')

    return _clamp(score * 0.8), '、'.join(parts) if parts else '量能中性'


def volatility_factor(bars: list[dict]) -> tuple[float, str, float]:
    """
    波动因子: ATR/价格 波动率。
    返回 (score, desc, vol_ratio) — score 对方向贡献小, 主要通过 vol_ratio 影响置信度/风险。
    """
    a = atr(bars, 14)
    if a is None or not bars:
        return 0.0, '波动数据不足', 0.0
    last = bars[-1]['close']
    if not last:
        return 0.0, '现价缺失', 0.0
    vol_ratio = a / last * 100  # ATR% (日波动)

    # 高波动 → 方向确定性低 (score 轻微回归中性)
    if vol_ratio > 6:
        return -5.0, f'日波动 ATR {vol_ratio:.1f}% 极高, 单边持续性差', vol_ratio
    if vol_ratio > 3.5:
        return 0.0, f'日波动 ATR {vol_ratio:.1f}% 偏高', vol_ratio
    return 5.0, f'日波动 ATR {vol_ratio:.1f}% 温和, 趋势可持续性较好', vol_ratio


# ═══════════════════════════════════════════════════════════════
# 推测引擎主入口
# ═══════════════════════════════════════════════════════════════

# 因子权重
WEIGHTS = {
    'trend': 0.30,
    'momentum': 0.25,
    'sentiment': 0.20,
    'volume': 0.15,
    'volatility': 0.10,
}


def speculate(bars: list[dict], quote: Optional[dict] = None) -> dict:
    """
    多因子市场推测。

    参数:
        bars:  K 线列表 [{time, open, high, low, close, volume}, ...] (时间升序)
        quote: 实时行情 dict (可含 funding_rate / long_short / fear_greed)

    返回:
        {
            'success': True,
            'direction': 'bullish' | 'bearish' | 'neutral',
            'direction_label': '偏多' | '偏空' | '震荡',
            'score': 0-100,              # 多空强度 (50 为中性)
            'confidence': 0-100,          # 推测置信度
            'probabilities': {'up': %, 'down': %, 'range': %},
            'factors': [
                {'name': '趋势', 'weight': 0.30, 'score': -100~100, 'detail': '...'},
                ...
            ],
            'key_levels': {'support': x, 'resistance': x, 'stop_loss': x,
                           'target1': x, 'target2': x},
            'risk': {'level': '低'|'中'|'高'|'极高', 'volatility_pct': x, 'warnings': [...]},
            'summary': '中文研判文本',
            'disclaimer': '...'
        }
    """
    quote = quote or {}

    if not bars or len(bars) < 5:
        return {
            'success': False,
            'error': 'K 线数据不足 (至少 5 根)',
            'direction': 'neutral', 'direction_label': '震荡',
            'score': 50, 'confidence': 0,
        }

    # ── 五因子评分 ──
    t_score, t_detail = trend_factor(bars)
    m_score, m_detail = momentum_factor(bars)
    s_score, s_detail = sentiment_factor(quote)
    v_score, v_detail = volume_factor(bars)
    w_score, w_detail, vol_ratio = volatility_factor(bars)

    factors = [
        {'key': 'trend', 'name': '趋势', 'weight': WEIGHTS['trend'],
         'score': round(t_score, 1), 'detail': t_detail},
        {'key': 'momentum', 'name': '动量', 'weight': WEIGHTS['momentum'],
         'score': round(m_score, 1), 'detail': m_detail},
        {'key': 'sentiment', 'name': '情绪', 'weight': WEIGHTS['sentiment'],
         'score': round(s_score, 1), 'detail': s_detail},
        {'key': 'volume', 'name': '量能', 'weight': WEIGHTS['volume'],
         'score': round(v_score, 1), 'detail': v_detail},
        {'key': 'volatility', 'name': '波动', 'weight': WEIGHTS['volatility'],
         'score': round(w_score, 1), 'detail': w_detail},
    ]

    # 加权综合分 (-100 ~ +100)
    composite = (
        t_score * WEIGHTS['trend'] +
        m_score * WEIGHTS['momentum'] +
        s_score * WEIGHTS['sentiment'] +
        v_score * WEIGHTS['volume'] +
        w_score * WEIGHTS['volatility']
    )

    # ── 方向判定 ──
    if composite >= 18:
        direction, direction_label = 'bullish', '偏多'
    elif composite <= -18:
        direction, direction_label = 'bearish', '偏空'
    else:
        direction, direction_label = 'neutral', '震荡'

    # 0-100 强度分 (50 = 中性)
    score_100 = round(50 + composite / 2, 1)
    score_100 = max(0.0, min(100.0, score_100))

    # ── 概率分布 (softmax 风格) ──
    # 用 composite 映射: |c|=100 → 主方向 ~70%; c=0 → 均分
    strength = abs(composite) / 100.0
    main_prob = 0.35 + 0.35 * strength
    range_prob = 0.30 - 0.12 * strength
    other_prob = 1.0 - main_prob - range_prob
    if direction == 'bullish':
        p_up, p_down, p_range = main_prob, other_prob, range_prob
    elif direction == 'bearish':
        p_up, p_down, p_range = other_prob, main_prob, range_prob
    else:
        p_up, p_down, p_range = (1 - range_prob) / 2, (1 - range_prob) / 2, range_prob
    probabilities = {
        'up': round(p_up * 100, 1),
        'down': round(p_down * 100, 1),
        'range': round(p_range * 100, 1),
    }

    # ── 置信度: 方向一致性 + 波动惩罚 ──
    weighted_scores = [f['score'] * f['weight'] for f in factors]
    agree = sum(1 for ws in weighted_scores if composite > 0 and ws > 0) or \
            sum(1 for ws in weighted_scores if composite < 0 and ws < 0)
    agree_ratio = agree / len(factors)
    confidence = round(
        max(5.0, min(92.0,
            25 + strength * 45 + agree_ratio * 25
            - (15 if vol_ratio > 6 else 5 if vol_ratio > 3.5 else 0))),
        1,
    )

    # ── 关键价位与交易计划 ──
    sr = find_support_resistance(bars)
    last_price = quote.get('price') or bars[-1]['close']
    a = atr(bars, 14) or (last_price * 0.02)

    support = sr['support'] or last_price * 0.95
    resistance = sr['resistance'] or last_price * 1.05

    if direction == 'bullish':
        stop_loss = round(last_price - a * 1.5, 8)
        target1 = round(last_price + a * 2.0, 8)
        target2 = round(last_price + a * 3.5, 8)
    elif direction == 'bearish':
        stop_loss = round(last_price + a * 1.5, 8)
        target1 = round(last_price - a * 2.0, 8)
        target2 = round(last_price - a * 3.5, 8)
    else:
        stop_loss = round(last_price - a * 1.5, 8) if last_price > support + a else round(last_price + a * 1.5, 8)
        target1 = round(resistance, 8) if last_price > support + a else round(support, 8)
        target2 = round(target1 + a * 1.5, 8) if last_price > support + a else round(target1 - a * 1.5, 8)

    risk_reward = None
    try:
        risk = abs(last_price - stop_loss)
        reward = abs(target1 - last_price)
        if risk > 0:
            risk_reward = round(reward / risk, 2)
    except (TypeError, ZeroDivisionError):
        risk_reward = None

    key_levels = {
        'support': round(support, 8),
        'resistance': round(resistance, 8),
        'stop_loss': stop_loss,
        'target1': target1,
        'target2': target2,
        'risk_reward': risk_reward,
    }

    # ── 风险评级 ──
    warnings = []
    if vol_ratio > 6:
        risk_level = '极高'
        warnings.append('波动率极高, 建议降低仓位并收紧止损')
    elif vol_ratio > 3.5:
        risk_level = '高'
        warnings.append('波动率偏高, 注意仓位控制')
    elif vol_ratio > 2:
        risk_level = '中'
    else:
        risk_level = '低'

    fr = quote.get('funding_rate')
    if fr is not None and abs(fr) > 0.05:
        warnings.append(f'资金费率 {fr:.3f}% 极端, 存在挤仓反转风险')
    if isinstance(quote.get('fear_greed'), dict):
        fgv = quote['fear_greed'].get('value')
        if fgv is not None and (fgv <= 20 or fgv >= 80):
            warnings.append(f'恐慌贪婪指数 {fgv} 处极端区, 情绪反转概率上升')
    if confidence < 35:
        warnings.append('多因子分歧较大, 推测置信度低, 建议观望')

    risk = {
        'level': risk_level,
        'volatility_pct': round(vol_ratio, 2),
        'warnings': warnings,
    }

    # ── 研判文本 ──
    summary = _build_summary(direction, direction_label, score_100, confidence,
                             factors, key_levels, risk, quote)

    return {
        'success': True,
        'direction': direction,
        'direction_label': direction_label,
        'score': score_100,
        'confidence': confidence,
        'probabilities': probabilities,
        'factors': factors,
        'key_levels': key_levels,
        'risk': risk,
        'summary': summary,
        'disclaimer': '以上推测基于公开行情数据的技术统计模型, 不构成投资建议。',
    }


def _build_summary(direction, label, score, confidence, factors,
                   key_levels, risk, quote) -> str:
    """生成中文研判摘要。"""
    best = max(factors, key=lambda f: abs(f['score']) * f['weight'])
    price = quote.get('price')
    price_txt = f'现价 {price:,.4g} 附近' if price else '当前价位'

    if direction == 'bullish':
        stance = '技术面综合偏向多头'
    elif direction == 'bearish':
        stance = '技术面综合偏向空头'
    else:
        stance = '多空分歧较大, 更倾向于震荡整理'

    parts = [
        f'{price_txt}, {stance} (强度 {score:.0f}/100, 置信度 {confidence:.0f}%)。',
        f'主要驱动因子: {best["name"]} ({best["detail"]})。',
        f'支撑 {key_levels["support"]:,.4g} / 压力 {key_levels["resistance"]:,.4g}, '
        f'止损参考 {key_levels["stop_loss"]:,.4g}, '
        f'第一目标 {key_levels["target1"]:,.4g}。',
    ]
    if key_levels.get('risk_reward'):
        parts.append(f'盈亏比约 {key_levels["risk_reward"]}:1。')
    parts.append(f'风险等级: {risk["level"]}'
                 + (f' ({"; ".join(risk["warnings"])})' if risk['warnings'] else '') + '。')
    return ''.join(parts)
