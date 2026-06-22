"""
Field Confidence Engine — 字段可信度评分（阶段三）

为股票提取的每个字段计算 0.0–1.0 的置信度分数。

评分维度：
  1. 提取方法可信度（method）
  2. 数值合理性（plausibility）
  3. OCR 行置信度（ocr_conf）
  4. 字段间交叉校验（cross_validation）

输出：StockField = {"value": ..., "confidence": 0.0–1.0}
"""

from __future__ import annotations
from typing import Optional, Any
import logging

logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════
# 提取方法 → 基础可信度
# ═══════════════════════════════════════════════════════════════

METHOD_BASE_CONFIDENCE: dict[str, float] = {
    'direct_keyword_adjacent': 0.90,   # 关键词 + 紧邻数字
    'direct_keyword_sameline': 0.85,   # 关键词 + 同行数字
    'direct_keyword_nextline': 0.70,   # 关键词 + 下行数字
    'direct_keyword_prevline': 0.65,   # 关键词 + 上行数字
    'code_prefix_match': 0.95,         # SZ/SH/BJ + 数字 精确匹配
    'code_pure_match': 0.90,           # 6位纯数字 + 范围推断
    'name_proximity': 0.80,            # 代码附近的中文名称
    'price_pattern': 0.80,             # 价格模式匹配
    'change_pattern': 0.75,            # 涨跌模式匹配
    'context_infer': 0.50,             # 上下文推断
    'heuristic': 0.40,                 # 启发式猜测
}


def get_method_confidence(method: str) -> float:
    """获取提取方法的基础可信度"""
    return METHOD_BASE_CONFIDENCE.get(method, 0.50)


# ═══════════════════════════════════════════════════════════════
# 数值合理性检查
# ═══════════════════════════════════════════════════════════════

# 字段合理的值范围
FIELD_RANGES: dict[str, tuple[float, float]] = {
    'price': (0.01, 999_999.99),       # 股价
    'current_price': (0.01, 999_999.99),  # 股价 (别名)
    'change_amount': (-1_000.0, 1_000.0),  # 涨跌额
    'change_percent': (-100.0, 100.0),     # 涨跌幅 %
    'open': (0.01, 999_999.99),
    'high': (0.01, 999_999.99),
    'low': (0.01, 999_999.99),
    'prev_close': (0.01, 999_999.99),
    'volume': (1.0, 1_000_000_000_000.0),  # 成交量
    'turnover': (1.0, 1_000_000_000_000.0), # 成交额
    'turnover_rate': (0.0, 100.0),          # 换手率 %
    'pe': (1.0, 10_000.0),                  # 市盈率
    'pb': (0.1, 1_000.0),                   # 市净率
    'total_market_cap': (1_000.0, 1_000_000_000_000.0),  # 总市值
    'circulating_market_cap': (1_000.0, 1_000_000_000_000.0),
    'volume_ratio': (0.01, 100.0),           # 量比
    'amplitude': (0.0, 100.0),               # 振幅 %
    'committee_ratio': (-100.0, 100.0),      # 委比 %
    # 技术指标
    'ma5': (0.01, 999_999.99),
    'ma10': (0.01, 999_999.99),
    'ma20': (0.01, 999_999.99),
    'ma60': (0.01, 999_999.99),
    'ma120': (0.01, 999_999.99),
    'ma250': (0.01, 999_999.99),
    'macd_dif': (-10_000.0, 10_000.0),
    'macd_dea': (-10_000.0, 10_000.0),
    'macd_bar': (-10_000.0, 10_000.0),
    'kdj_k': (0.0, 100.0),
    'kdj_d': (0.0, 100.0),
    'kdj_j': (-50.0, 150.0),
    'rsi6': (0.0, 100.0),
    'rsi14': (0.0, 100.0),
    'rsi24': (0.0, 100.0),
    'boll_upper': (0.01, 999_999.99),
    'boll_mid': (0.01, 999_999.99),
    'boll_lower': (0.01, 999_999.99),
    'wr10': (0.0, 100.0),
    'bias6': (-100.0, 100.0),
    'bias12': (-100.0, 100.0),
}


def _is_plausible(field: str, value: Optional[float]) -> float:
    """检查值是否在合理范围内，返回 0.0–1.0 的合理性分数"""
    if value is None:
        return 0.0
    if field not in FIELD_RANGES:
        return 0.5  # 未知字段，中性
    lo, hi = FIELD_RANGES[field]
    if lo <= value <= hi:
        # 在范围内 → 满分
        return 1.0
    # 超出范围 → 按超出程度扣分
    if value < lo:
        ratio = value / lo if lo != 0 else 0.0
    else:
        ratio = hi / value if value != 0 else 0.0
    return max(0.1, ratio)


# ═══════════════════════════════════════════════════════════════
# OCR 置信度衰减
# ═══════════════════════════════════════════════════════════════

def _ocr_factor(ocr_conf: Optional[float]) -> float:
    """OCR 置信度 → 调整因子"""
    if ocr_conf is None:
        return 0.8  # 无 OCR 置信度时中性衰减
    return min(1.0, max(0.3, ocr_conf))


# ═══════════════════════════════════════════════════════════════
# 交叉校验
# ═══════════════════════════════════════════════════════════════

def _cross_validate(stock: dict[str, Optional[float]]) -> dict[str, float]:
    """
    字段间交叉校验，返回每字段的校验加分 (0.0–0.05 each)。
    仅在字段值都存在时检查。
    """
    bonuses: dict[str, float] = {}

    price = stock.get('current_price') or stock.get('price')
    prev_close = stock.get('prev_close')
    change_amount = stock.get('change_amount')
    high_val = stock.get('high')
    low = stock.get('low')
    open_val = stock.get('open')

    # 1. price ≈ prev_close + change_amount
    if price is not None and prev_close is not None and change_amount is not None:
        expected = prev_close + change_amount
        if abs(price - expected) <= max(0.05, abs(price) * 0.02):
            bonuses['current_price'] = bonuses.get('current_price', 0) + 0.05
            bonuses['price'] = bonuses.get('price', 0) + 0.05
            bonuses['prev_close'] = bonuses.get('prev_close', 0) + 0.03
            bonuses['change_amount'] = bonuses.get('change_amount', 0) + 0.03

    # 2. high >= price >= low
    if high_val is not None and price is not None and high_val >= price:
        bonuses['high'] = bonuses.get('high', 0) + 0.03
        bonuses['current_price'] = bonuses.get('current_price', 0) + 0.02
        bonuses['price'] = bonuses.get('price', 0) + 0.02
    if low is not None and price is not None and low <= price:
        bonuses['low'] = bonuses.get('low', 0) + 0.03
        bonuses['current_price'] = bonuses.get('current_price', 0) + 0.02
        bonuses['price'] = bonuses.get('price', 0) + 0.02

    # 3. high >= open >= low
    if high_val is not None and open_val is not None and low is not None:
        if high_val >= open_val >= low:
            bonuses['high'] = bonuses.get('high', 0) + 0.02
            bonuses['open'] = bonuses.get('open', 0) + 0.03
            bonuses['low'] = bonuses.get('low', 0) + 0.02

    # 4. high >= low
    if high_val is not None and low is not None and high_val >= low:
        bonuses['high'] = bonuses.get('high', 0) + 0.02
        bonuses['low'] = bonuses.get('low', 0) + 0.02

    return bonuses


# ═══════════════════════════════════════════════════════════════
# 主评分函数
# ═══════════════════════════════════════════════════════════════

def score_field(
    field: str,
    value: Optional[Any],
    method: str,
    ocr_line_confidence: Optional[float] = None,
) -> float:
    """
    计算单个字段的置信度。

    参数:
        field: 字段名（price, pe, ma5, ...）
        value: 字段值（可以是 str, float, None）
        method: 提取方法标识（见 METHOD_BASE_CONFIDENCE）
        ocr_line_confidence: 来源 OCR 行的置信度（可选）

    返回:
        0.0–1.0 的置信度
    """
    if value is None:
        return 0.0

    # 1. 方法基础分
    base = get_method_confidence(method)

    # 2. 数值合理性
    if isinstance(value, (int, float)):
        numeric_val = float(value)
    else:
        # 尝试解析字符串
        try:
            numeric_val = float(str(value).replace(',', '').replace('%', '').replace('+', '').replace('万', '').replace('亿', ''))
        except (ValueError, TypeError):
            numeric_val = None

    plausibility = _is_plausible(field, numeric_val)

    # 3. OCR 置信度
    ocr_f = _ocr_factor(ocr_line_confidence)

    # 4. 加权计算
    # 方法权重 50%，合理性权重 30%，OCR 权重 20%
    confidence = base * 0.50 + plausibility * 0.30 + ocr_f * 0.20

    # 名称/代码特殊处理：置信度不低于 0.70（如果提取到的话）
    if field in ('name', 'code') and value is not None:
        confidence = max(confidence, 0.70)

    return min(1.0, round(confidence, 2))


def score_all_fields(
    raw_stock: dict[str, Optional[Any]],
    raw_technical: dict[str, Optional[Any]],
    extraction_methods: dict[str, str],
    ocr_confidence: Optional[float] = None,
) -> tuple[dict[str, dict], dict[str, dict], dict[str, float]]:
    """
    为所有字段计算置信度。

    参数:
        raw_stock: 基本股票字段 {field: value}
        raw_technical: 技术指标字段 {field: value}
        extraction_methods: 每字段的提取方法 {field: method_name}
        ocr_confidence: OCR 整体置信度

    返回:
        (stock_with_conf, technical_with_conf, cross_bonuses)
        每个字段格式: {"value": ..., "confidence": 0.0–1.0}
    """
    # 交叉校验加分
    # 构建数值版本用于校验
    numeric_stock: dict[str, Optional[float]] = {}
    for k, v in raw_stock.items():
        if v is None:
            numeric_stock[k] = None
        elif isinstance(v, (int, float)):
            numeric_stock[k] = float(v)
        else:
            try:
                numeric_stock[k] = float(str(v).replace(',', '').replace('%', '').replace('+', ''))
            except (ValueError, TypeError):
                numeric_stock[k] = None

    cross_bonuses = _cross_validate(numeric_stock)

    # 为 stock 字段评分
    stock_with_conf: dict[str, dict] = {}
    for field, value in raw_stock.items():
        method = extraction_methods.get(field, 'heuristic')
        conf = score_field(field, value, method, ocr_confidence)
        # 加上交叉校验加分
        bonus = cross_bonuses.get(field, 0)
        conf = min(1.0, conf + bonus)
        stock_with_conf[field] = {
            'value': value,
            'confidence': round(conf, 2),
        }

    # 为 technical 字段评分
    tech_with_conf: dict[str, dict] = {}
    for field, value in raw_technical.items():
        method = extraction_methods.get(field, 'heuristic')
        conf = score_field(field, value, method, ocr_confidence)
        tech_with_conf[field] = {
            'value': value,
            'confidence': round(conf, 2),
        }

    return stock_with_conf, tech_with_conf, cross_bonuses


# ═══════════════════════════════════════════════════════════════
# 关键字段检查
# ═══════════════════════════════════════════════════════════════

CRITICAL_FIELDS = ('name', 'code', 'current_price')
IMPORTANT_FIELDS = ('change_percent', 'high', 'low', 'volume')

CRITICAL_CONFIDENCE_THRESHOLD = 0.50
IMPORTANT_CONFIDENCE_THRESHOLD = 0.40


def check_confidence_warning(
    stock_with_conf: dict[str, dict],
) -> tuple[bool, list[str]]:
    """
    检查关键字段是否缺失或可信度过低。

    返回:
        (should_warn, warnings_list)
    """
    warnings: list[str] = []

    # 检查关键字段
    for field in CRITICAL_FIELDS:
        entry = stock_with_conf.get(field)
        if entry is None or entry.get('value') is None:
            warnings.append(f'关键字段缺失: {field}')
        elif entry.get('confidence', 0) < CRITICAL_CONFIDENCE_THRESHOLD:
            warnings.append(
                f'关键字段可信度低: {field} ({entry["confidence"]:.0%})'
            )

    # 检查重要字段
    missing_important = 0
    for field in IMPORTANT_FIELDS:
        entry = stock_with_conf.get(field)
        if entry is None or entry.get('value') is None:
            missing_important += 1
        elif entry.get('confidence', 0) < IMPORTANT_CONFIDENCE_THRESHOLD:
            missing_important += 1

    if missing_important >= 3:
        warnings.append(f'多个重要字段缺失或可信度低 ({missing_important}/{len(IMPORTANT_FIELDS)})')

    should_warn = len(warnings) > 0

    return should_warn, warnings
