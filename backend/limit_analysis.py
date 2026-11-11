"""
Limit Analysis — 涨跌停检测 / 连板统计 / ST 风险识别 / 炸板风险预测

模块化设计，暴露统一接口 analyse_all()。
所有判断基于已有行情字段，缺失数据明确提示"暂无数据"。
"""

from __future__ import annotations
import re
from typing import Optional, Any


# ─── Market Detection ──────────────────────────────────────────

MARKET_TYPES = {'main_board', 'gem', 'kcb', 'bj', 'unknown'}


def identify_market(code: str) -> str:
    """根据股票代码判断所属市场板块。

    返回: 'main_board' | 'gem' | 'kcb' | 'bj' | 'unknown'
    """
    c = code.upper().strip()
    for prefix in ('SH', 'SZ', 'BJ'):
        if c.startswith(prefix):
            c = c[len(prefix):]
            break

    if not c.isdigit():
        return 'unknown'

    num = int(c)

    # 创业板 300000-301999
    if 300000 <= num <= 301999:
        return 'gem'

    # 科创板 688000-689999
    if 688000 <= num <= 689999:
        return 'kcb'

    # 北交所
    if (400000 <= num <= 439999 or
            830000 <= num <= 839999 or
            870000 <= num <= 879999 or
            920000 <= num <= 929999):
        return 'bj'

    # SH 主板
    if (600000 <= num <= 609999 or
            601000 <= num <= 603999 or
            605000 <= num <= 605999):
        return 'main_board'

    # SZ 主板
    if 1 <= num <= 4999 or 200000 <= num <= 200999:
        return 'main_board'

    return 'main_board'


# ─── Limit Rules ───────────────────────────────────────────────

def get_limit_pct(market: str, st_type: Optional[str]) -> int:
    """获取涨跌停限制百分比。"""
    if market in ('gem', 'kcb'):
        return 20
    if market == 'bj':
        return 30
    if market == 'main_board' and st_type in ('ST', '*ST'):
        return 5
    return 10


def get_limit_label(market: str, st_type: Optional[str]) -> str:
    pct = get_limit_pct(market, st_type)
    return f'±{pct}%'


# ─── ST Detection ──────────────────────────────────────────────

def detect_st(stock_name: Optional[str]) -> dict:
    """检测股票是否为 ST / *ST。"""
    if not stock_name:
        return {
            'is_st': False,
            'is_sst': False,
            'st_type': None,
            'limit_pct': 10,
            'risk_warning': '未检测到ST标识。',
        }

    name = stock_name.upper()
    is_sst = '*ST' in name
    is_st = 'ST' in name and not is_sst
    st_type = '*ST' if is_sst else ('ST' if is_st else None)

    return {
        'is_st': is_st,
        'is_sst': is_sst,
        'st_type': st_type,
        'limit_pct': 5 if st_type else 10,
        'risk_warning': (
            'ST股票波动限制较严格，请注意退市及经营风险。'
            if st_type else '未检测到ST标识。'
        ),
    }


# ─── Limit Up / Down Detection ─────────────────────────────────

def analyse_limit(
    price: Optional[float],
    prev_close: Optional[float],
    st_type: Optional[str],
    market: str,
) -> dict:
    """计算涨跌停状态。"""
    if price is None or prev_close is None or prev_close == 0:
        return {
            'change_pct': None,
            'is_limit_up': False,
            'is_limit_down': False,
            'limit_up_price': None,
            'limit_down_price': None,
            'distance_to_limit_up': None,
            'distance_to_limit_down': None,
            'distance_to_limit_up_pct': None,
            'limit_type_label': '暂无数据',
        }

    limit_pct = get_limit_pct(market, st_type)
    pct = (price - prev_close) / prev_close * 100
    limit_up_price = prev_close * (1 + limit_pct / 100)
    limit_down_price = prev_close * (1 - limit_pct / 100)
    epsilon = 0.15

    is_limit_up = pct >= limit_pct - epsilon
    is_limit_down = pct <= -(limit_pct - epsilon)

    dist_to_up = round(limit_up_price - price, 2)
    dist_to_down = round(price - limit_down_price, 2)
    dist_to_up_pct = round((dist_to_up / prev_close) * 100, 2) if prev_close > 0 else None

    if is_limit_up:
        label = f'已触及涨停（{limit_pct}.00%）'
    elif is_limit_down:
        label = f'已触及跌停（{limit_pct}.00%）'
    elif dist_to_up_pct is not None and 0 < dist_to_up_pct < limit_pct:
        label = f'距离涨停还有{dist_to_up_pct}%'
    else:
        label = '当前未触及涨跌停'

    return {
        'change_pct': round(pct, 2),
        'is_limit_up': is_limit_up,
        'is_limit_down': is_limit_down,
        'limit_up_price': round(limit_up_price, 2),
        'limit_down_price': round(limit_down_price, 2),
        'distance_to_limit_up': dist_to_up,
        'distance_to_limit_down': dist_to_down,
        'distance_to_limit_up_pct': dist_to_up_pct,
        'limit_type_label': label,
    }


# ─── Consecutive Boards ────────────────────────────────────────

def analyse_consecutive_boards(
    daily_bars: list[dict],
    limit_pct: int,
) -> dict:
    """统计连续涨停天数。

    需要日K线数据，按时间升序排列。
    若无足够历史数据，返回无法确认状态。
    """
    if not daily_bars or len(daily_bars) < 3:
        return {
            'count': 0,
            'label': '数据不足',
            'can_confirm': False,
            'message': '当前数据不足，无法确认连板数量。',
        }

    sorted_bars = sorted(daily_bars, key=lambda b: b.get('time', ''))
    if len(sorted_bars) < 3:
        return {
            'count': 0,
            'label': '数据不足',
            'can_confirm': False,
            'message': '当前数据不足，无法确认连板数量。',
        }

    epsilon = 0.2
    count = 0

    for i in range(len(sorted_bars) - 1, 0, -1):
        bar = sorted_bars[i]
        prev_bar = sorted_bars[i - 1]

        close = bar.get('close', 0)
        prev_close = prev_bar.get('close', 0)
        high = bar.get('high', 0)

        if close == 0 or prev_close == 0:
            break

        day_change = (close - prev_close) / prev_close * 100
        closed_at_high = close >= high * 0.998 if high > 0 else False

        if day_change >= limit_pct - epsilon and closed_at_high:
            count += 1
        else:
            break

    if count == 0:
        return {
            'count': 0,
            'label': '无连板',
            'can_confirm': True,
            'message': '当前未检测到连续涨停。',
        }

    label = '首板' if count == 1 else f'{count}连板'

    return {
        'count': count,
        'label': label,
        'can_confirm': True,
        'message': f'当前属于{label}。历史连续涨停次数：{count}天。',
    }


# ─── Breakout Risk Prediction ──────────────────────────────────

def predict_breakout_risk(
    quote: dict,
    daily_bars: list[dict],
    is_limit_up: bool,
) -> dict:
    """启发式炸板风险评估。

    基于已有数据综合评分，严禁输出确定性措辞。
    """
    if not is_limit_up:
        return {
            'level': '极低',
            'score': 0,
            'explanation': '当前未触及涨停，无需关注炸板风险。',
        }

    score = 0
    factors = []

    # Factor 1: 换手率
    turnover_rate = quote.get('turnover_rate')
    if turnover_rate is not None:
        if turnover_rate > 20:
            score += 30
            factors.append('换手率极高')
        elif turnover_rate > 10:
            score += 20
            factors.append('换手率偏高')
        elif turnover_rate > 5:
            score += 10
            factors.append('换手率较高')
        else:
            score -= 5
            factors.append('换手率较低')
    else:
        factors.append('换手率暂无数据')

    # Factor 2: 振幅
    amplitude = quote.get('amplitude')
    if amplitude is not None:
        if amplitude > 10:
            score += 20
            factors.append('振幅较大')
        elif amplitude > 5:
            score += 10
            factors.append('振幅偏高')
        else:
            score -= 5
            factors.append('振幅较小')

    # Factor 3: 成交量异常（与5日均量对比）
    if daily_bars and len(daily_bars) >= 6:
        sorted_bars = sorted(daily_bars, key=lambda b: b.get('time', ''))
        latest_vol = sorted_bars[-1].get('volume', 0)
        if latest_vol > 0:
            recent_5 = sorted_bars[-6:-1]
            avg5 = sum(b.get('volume', 0) for b in recent_5) / 5 if recent_5 else 0
            if avg5 > 0:
                vol_ratio = latest_vol / avg5
                if vol_ratio > 2.0:
                    score += 20
                    factors.append('尾盘成交量异常放大')
                elif vol_ratio > 1.5:
                    score += 10
                    factors.append('成交量偏高')
                elif vol_ratio < 0.8:
                    score -= 5
                    factors.append('成交量相对萎缩')

    # Factor 4: 封板质量
    if daily_bars and len(daily_bars) > 0:
        last_bar = daily_bars[-1]
        if last_bar.get('close', 0) < last_bar.get('high', 0) * 0.998:
            score += 25
            factors.append('封板不坚决（未封死涨停价）')
        else:
            score -= 10
            factors.append('涨停封单稳定')

    # Clamp
    score = max(0, min(100, score))

    if score >= 70:
        level = '极高'
        explanation = '封单不足且多次开板，建议关注盘中资金承接情况。'
    elif score >= 50:
        level = '较高'
        explanation = '尾盘放量明显，换手率偏高，存在资金分歧，炸板风险较高。'
    elif score >= 30:
        level = '中等'
        explanation = '封板质量一般，成交量有所放大，需关注后续资金动向。'
    elif score >= 10:
        level = '较低'
        explanation = '涨停封单稳定，成交量未明显放大，炸板风险较低。'
    else:
        level = '极低'
        explanation = '封板质量良好，量价配合正常，炸板风险极低。'

    if factors:
        explanation += f'（参考：{"；".join(factors)}）'

    return {'level': level, 'score': score, 'explanation': explanation}


# ─── Main Entry Point ──────────────────────────────────────────

def analyse_all(
    stock_code: Optional[str] = None,
    stock_name: Optional[str] = None,
    price: Optional[float] = None,
    prev_close: Optional[float] = None,
    daily_bars: Optional[list[dict]] = None,
    turnover_rate: Optional[float] = None,
    amplitude: Optional[float] = None,
    **kwargs,
) -> dict:
    """统一入口：执行全部涨跌停分析。

    参数:
        stock_code: 股票代码（如 SH600519）
        stock_name: 股票名称
        price: 当前价格
        prev_close: 昨收价
        daily_bars: 日 K 线数据列表，每个 bar 需包含 time/open/high/low/close/volume
        turnover_rate: 换手率（%）
        amplitude: 振幅（%）

    返回:
        包含 st_status / limit / consecutive / breakout / summary 的字典
    """
    market = identify_market(stock_code or '')
    st_status = detect_st(stock_name)

    limit = analyse_limit(price, prev_close, st_status['st_type'], market)

    limit_pct = get_limit_pct(market, st_status['st_type'])
    consecutive = analyse_consecutive_boards(daily_bars or [], limit_pct)

    quote = {
        'turnover_rate': turnover_rate,
        'amplitude': amplitude,
        **kwargs,
    }
    breakout = predict_breakout_risk(quote, daily_bars or [], limit['is_limit_up'])

    # Build summary
    parts = []
    if limit.get('is_limit_up'):
        parts.append('当前个股已封涨停')
    elif limit.get('is_limit_down'):
        parts.append('当前个股已封跌停')
    else:
        parts.append('当前个股未触及涨跌停')

    if consecutive.get('can_confirm') and consecutive.get('count', 0) > 0:
        parts.append(f'属于{consecutive["label"]}走势')

    if st_status.get('st_type'):
        parts.append(f'{st_status["st_type"]}风险股，涨跌停限制±5%')

    if limit.get('is_limit_up'):
        expl = breakout.get('explanation', '')
        if '（' in expl:
            expl = expl.split('（')[0]
        parts.append(expl.lower())

    summary = '，'.join(parts) + '。'

    return {
        'st_status': st_status,
        'limit': limit,
        'consecutive': consecutive,
        'breakout': breakout,
        'summary': summary,
    }
