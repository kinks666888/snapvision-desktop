"""
Stock Parser — 从 OCR 文本中提取结构化股票信息

纯函数模块，不依赖外部 API/网络。
输入：OCR 原始文本列表 list[str]
输出：统一结构化 JSON

支持平台：雪球、东方财富、同花顺、TradingView 等常见股票截图
"""

import re
import logging
from typing import Optional, Any

logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════
# 噪声过滤规则
# ═══════════════════════════════════════════════════════════════

NOISE_PATTERNS: list[str] = [
    # URL / 域名
    r'https?://',
    r'\.com\b', r'\.cn\b', r'\.net\b', r'\.org\b', r'\.io\b',
    r'www\.',

    # 浏览器 UI
    r'chrome', r'safari', r'firefox', r'edge', r'brave',
    r'标签', r'标签页', r'新标签', r'无痕',
    r'书签', r'历史记录', r'地址栏', r'搜索栏',
    r'最小化', r'最大化', r'关闭',
    r'扩展程序', r'插件',

    # App 通用 UI
    r'^下载\s*App$', r'^下载\s*APP$', r'下载App', r'下载APP', r'下载应用',
    r'^首页$', r'^主页$',
    r'^AI$', r'^AI问答$', r'人工智能',
    r'^搜索$', r'搜一搜', r'搜索股票', r'搜索代码',
    r'^登录$', r'^注册$', r'^退出$', r'登录/注册', r'立即登录',
    r'^设置$', r'系统设置', r'偏好设置',
    r'^帮助$', r'^反馈$', r'客服', r'在线客服',
    r'^分享$', r'^收藏$', r'^点赞$', r'评论', r'回复',
    r'^关注$', r'^已关注$', r'^加关注$', r'取消关注',
    r'^转发$', r'^引用$',

    # 导航 / 菜单
    r'^自选$', r'^行情$', r'^交易$', r'^资讯$', r'^我的$',
    r'^发现$', r'^理财$', r'^基金$', r'^社区$', r'^学院$',
    r'^导航$', r'^菜单$',
    r'^市场$', r'^板块$', r'^概念$', r'^行业$',
    r'^沪深$', r'^港股$', r'^美股$', r'^全球$',

    # 行情软件自身 UI（非股票数据）
    r'^模拟交易$', r'^模拟炒股$',
    r'^条件单$', r'^智能条件单$',
    r'^Level\s*2$', r'^Level-2$', r'^L2$',
    r'^VIP$', r'^会员$', r'^充值$', r'^续费$',
    r'^开户$', r'^入金$', r'^出金$', r'^转户$',
    r'^新股申购$', r'^打新$', r'^中签$',
    r'^龙虎榜$', r'^大宗交易$',
    r'^融资融券$', r'^两融$',
    r'^研报$', r'^公告$', r'^财报$',
    r'^提醒$', r'^预警$', r'^通知$',

    # 用户 / 广告
    r'用户.*昵称', r'昵称', r'用户名', r'修改昵称',
    r'广告', r'推广', r'推荐', r'热门', r'精选',
    r'赞助', r'合作', r'商务',
    r'扫码', r'二维码', r'加微信', r'加群',

    # 社交 / 帖子
    r'帖子', r'发帖', r'动态', r'话题',
    r'阅读\s*\d+', r'回复\s*\d+', r'点赞\s*\d+',
    r'楼主', r'层主', r'吧友',

    # 法律 / 隐私
    r'隐私', r'条款', r'政策', r'协议',
    r'©', r'版权所有', r'All Rights Reserved',
    r'ICP', r'备案', r'风险提示', r'免责声明',

    # 时间 / 日期（孤立的）
    r'^\d{1,2}:\d{2}(:\d{2})?\s*(AM|PM|上午|下午)?$',
    r'^\d{4}[-/]\d{1,2}[-/]\d{1,2}$',
    r'^\d{1,2}[-/]\d{1,2}$',

    # 纯 UI 元素
    r'^刷新$', r'^返回$', r'^关闭$', r'^更多$',
    r'^编辑$', r'^删除$', r'^确认$', r'^取消$',
    r'^确定$', r'^知道了$', r'^不再提示$', r'^我知道了$',
    r'^展开$', r'^收起$', r'^详情$', r'^简介$',

    # 极短 / 纯符号噪声
    r'^[_\-\—\.\+★☆◆◇▲▼●○◎]+$',
    r'^[|｜/\\]+$',
]

_noise_re: list[re.Pattern] = [re.compile(p, re.IGNORECASE) for p in NOISE_PATTERNS]


def _is_noise(text: str) -> bool:
    stripped = text.strip()
    if not stripped or len(stripped) <= 1:
        return True
    if len(stripped) >= 50:
        return True
    for pat in _noise_re:
        if pat.search(stripped):
            return True
    return False


def _deduplicate(texts: list[str]) -> list[str]:
    """简单去重：完全相同或去除包含关系的重复行"""
    result: list[str] = []
    for text in texts:
        stripped = text.strip()
        if not stripped:
            continue
        if stripped not in result:
            # 检查是否是已有行的子串（反方向也检查）
            is_dup = False
            for existing in result:
                if stripped == existing:
                    is_dup = True
                    break
                # 如果一个完全是另一个的子串且长度差不大
                if len(stripped) >= 4 and len(existing) >= 4:
                    if stripped in existing or existing in stripped:
                        if abs(len(stripped) - len(existing)) / max(len(stripped), len(existing)) < 0.3:
                            is_dup = True
                            # 保留较长的那个
                            if len(stripped) > len(existing):
                                result.remove(existing)
                                result.append(stripped)
                            break
            if not is_dup:
                result.append(stripped)
    return result


def filter_texts(texts: list[str]) -> list[str]:
    """过滤噪声 → 返回保留文本列表"""
    deduped = _deduplicate(texts)
    return [t.strip() for t in deduped if t.strip() and not _is_noise(t)]


# ═══════════════════════════════════════════════════════════════
# 股票代码识别
# ═══════════════════════════════════════════════════════════════

_CODE_WITH_PREFIX_RE = re.compile(r'(SZ|SH|BJ|HK|sh|sz|bj|hk)\s*(\d{5,8})')
_PURE_CODE_RE = re.compile(r'\b(\d{6})\b')
_HK_CODE_RE = re.compile(r'\b(\d{5})\b')


def _classify_code(code: str) -> Optional[str]:
    if not code.isdigit():
        return None
    n = int(code)
    if (600000 <= n <= 609999 or 601000 <= n <= 603999 or
            605000 <= n <= 605999 or 688000 <= n <= 689999):
        return 'SH'
    if (1 <= n <= 4999 or 2000 <= n <= 2999 or 3000 <= n <= 3999):
        return 'SZ'
    if 300000 <= n <= 301999 or 200000 <= n <= 200999:
        return 'SZ'
    if (400000 <= n <= 439999 or 830000 <= n <= 839999 or
            870000 <= n <= 879999 or 920000 <= n <= 929999):
        return 'BJ'
    return None


def _is_likely_cn_name(text: str) -> bool:
    stripped = text.strip()
    if not stripped or len(stripped) < 2 or len(stripped) > 8:
        return False
    chinese_chars = sum(1 for c in stripped if '\u4e00' <= c <= '\u9fff')
    if chinese_chars < 2:
        return False
    non_chinese = ''.join(c for c in stripped if not ('\u4e00' <= c <= '\u9fff'))
    if non_chinese and not re.match(r'^[A-Za-z0-9·]+$', non_chinese):
        return False
    return True


def _find_stock_name(texts: list[str], code_idx: int, code_text: str) -> Optional[str]:
    start = max(0, code_idx - 3)
    end = min(len(texts), code_idx + 4)
    candidates: list[tuple[str, int]] = []
    for i in range(start, end):
        if i == code_idx:
            prefix = texts[i].split(code_text)[0].strip()
            if _is_likely_cn_name(prefix):
                candidates.append((prefix, 0))
            continue
        text = texts[i].strip()
        if _is_likely_cn_name(text):
            candidates.append((text, abs(i - code_idx)))
    if candidates:
        candidates.sort(key=lambda x: x[1])
        return candidates[0][0]
    return None


def _extract_code_info(texts: list[str]) -> dict:
    result: dict = {'code': None, 'market': None, 'name': None}
    for idx, text in enumerate(texts):
        stripped = text.strip()
        m = _CODE_WITH_PREFIX_RE.search(stripped)
        if m:
            result['market'] = m.group(1).upper()
            result['code'] = m.group(2)
            name = _find_stock_name(texts, idx, m.group(0))
            if name:
                result['name'] = name
            return result
        m = _PURE_CODE_RE.search(stripped)
        if m:
            code = m.group(1)
            market = _classify_code(code)
            if market:
                result['code'] = code
                result['market'] = market
                name = _find_stock_name(texts, idx, code)
                if name:
                    result['name'] = name
                return result
    return result


# ═══════════════════════════════════════════════════════════════
# 数值提取工具
# ═══════════════════════════════════════════════════════════════

_NUMBER_RE = re.compile(r'(?<![a-zA-Z0-9])([+-]?\d+(?:,\d{3})*(?:\.\d{1,4})?)(?![a-zA-Z0-9])')
_PCT_RE = re.compile(r'(?<![a-zA-Z0-9])([+-]?\d+\.?\d{0,2})\s*%')

_UNIT_MULTIPLIER: list[tuple[str, float]] = [
    ('万亿', 1_000_000_000_000),
    ('亿', 100_000_000),
    ('万', 10_000),
    ('千', 1_000),
]


def _parse_raw_number(text: str) -> Optional[float]:
    stripped = text.strip()
    m = _PCT_RE.search(stripped)
    if m:
        return float(m.group(1))
    m = _NUMBER_RE.search(stripped)
    if not m:
        return None
    num_str = m.group(1).replace(',', '')
    try:
        val = float(num_str)
        for unit, mult in _UNIT_MULTIPLIER:
            if unit in stripped:
                val *= mult
                break
        return val
    except ValueError:
        return None


# ═══════════════════════════════════════════════════════════════
# 股票字段提取
# ═══════════════════════════════════════════════════════════════

_STOCK_INDICATOR_MAP: list[tuple[list[str], str]] = [
    (['今开', '开盘'], 'open'),
    (['昨收', '前收', '昨日收盘', '昨收盘'], 'prev_close'),
    (['最高', '最高价', '日内最高'], 'high'),
    (['最低', '最低价', '日内最低'], 'low'),
    (['成交量\\(手\\)', '成交总量', '成交量'], 'volume'),
    (['成交金额', '成交总额', '成交额'], 'turnover'),
    (['换手率', '换手'], 'turnover_rate'),
    (['市盈率\\(动\\)', '市盈\\(动\\)', '市盈率TTM', r'\bPE\b', '市盈率'], 'pe'),
    (['市净率', r'\bPB\b', '市净'], 'pb'),
    (['总市值', '市值'], 'total_market_cap'),
    (['流通市值\\(元\\)', '流通市值', '流通'], 'circulating_market_cap'),
    (['量比'], 'volume_ratio'),
    (['振幅'], 'amplitude'),
    (['委比'], 'committee_ratio'),
]


def _extract_indicators(texts: list[str]) -> dict:
    """提取基本股票指标（今开/昨收/最高/最低/成交量等）"""
    result: dict = {}
    for idx, text in enumerate(texts):
        stripped = text.strip()
        for keywords, field in _STOCK_INDICATOR_MAP:
            if field in result:
                continue
            matched = False
            for kw in keywords:
                if re.search(kw, stripped):
                    matched = True
                    break
            if not matched:
                continue
            # 当前行提取
            val = _parse_raw_number(stripped)
            if val is not None:
                result[field] = val
                continue
            # 下一行兜底
            if idx + 1 < len(texts):
                val = _parse_raw_number(texts[idx + 1])
                if val is not None:
                    result[field] = val
                    continue
            # 上一行兜底
            if idx > 0:
                val = _parse_raw_number(texts[idx - 1])
                if val is not None:
                    result[field] = val
                    continue
    return result


# 6位纯数字 → 可能是股票代码，排除出价格候选
_SIX_DIGIT_NUMBER = re.compile(r'^\d{6}$')

def _extract_price_change(texts: list[str]) -> dict:
    """提取价格、涨跌额、涨跌幅"""
    result: dict = {'price': None, 'change_amount': None, 'change_percent': None}
    numeric_items: list[tuple[int, str, float, bool]] = []

    for idx, text in enumerate(texts):
        stripped = text.strip()
        pct_m = _PCT_RE.search(stripped)
        if pct_m:
            numeric_items.append((idx, stripped, float(pct_m.group(1)), True))
            continue
        # 跳过纯6位数字（一般是股票代码）
        if _SIX_DIGIT_NUMBER.match(stripped):
            continue
        num_m = re.match(r'^[¥$]?\s*([+-]?\d+\.?\d{0,4})\s*$', stripped)
        if num_m:
            numeric_items.append((idx, stripped, float(num_m.group(1)), False))

    if not numeric_items:
        return result

    # 涨跌幅
    pct_items = [(i, t, v) for i, t, v, p in numeric_items if p]
    if pct_items:
        signed = [(i, t, v) for i, t, v in pct_items if t.startswith('+') or t.startswith('-')]
        best = signed[0] if signed else pct_items[0]
        result['change_percent'] = best[2]
        # 保留原始符号格式
        result['_change_percent_raw'] = best[1].strip() if best[1].strip().endswith('%') else f"{best[1].strip()}%"

    # 价格和涨跌额
    num_items = [(i, t, v) for i, t, v, p in numeric_items if not p]
    price_candidates = [(i, t, v) for i, t, v in num_items
                        if not t.startswith('+') and not t.startswith('-')]
    change_candidates = [(i, t, v) for i, t, v in num_items
                         if t.startswith('+') or t.startswith('-')]

    if price_candidates:
        price_candidates.sort(key=lambda x: abs(x[2]), reverse=True)
        for _idx, _raw, val in price_candidates:
            if 0.01 <= abs(val) <= 999999:
                result['price'] = val
                break

    if change_candidates:
        change_candidates.sort(key=lambda x: abs(x[2]))
        for _idx, _raw, val in change_candidates:
            if result['price'] and abs(val) < result['price'] * 0.5:
                result['change_amount'] = val
                result['_change_amount_raw'] = _raw.strip()
                break
            elif not result['price']:
                result['change_amount'] = val
                result['_change_amount_raw'] = _raw.strip()
                break

    return result


# ═══════════════════════════════════════════════════════════════
# 格式化输出工具
# ═══════════════════════════════════════════════════════════════

def _fmt_price(val: Optional[float]) -> Optional[str]:
    if val is None: return None
    return f'{val:.2f}'

def _fmt_signed(val: Optional[float], raw: Optional[str] = None) -> Optional[str]:
    if val is None: return None
    if raw:
        return raw  # 保留原始文本格式（+12.79）
    sign = '+' if val >= 0 else ''
    return f'{sign}{val:.2f}'

def _fmt_percent(val: Optional[float], raw: Optional[str] = None) -> Optional[str]:
    if val is None: return None
    if raw:
        return raw  # 保留原始文本格式（+8.58%）
    sign = '+' if val >= 0 else ''
    return f'{sign}{val:.2f}%'

def _fmt_volume(val: Optional[float]) -> Optional[str]:
    if val is None: return None
    if abs(val) >= 1_0000_0000_0000: return f'{val / 1_0000_0000_0000:.2f}万亿手'
    if abs(val) >= 100_000_000: return f'{val / 100_000_000:.2f}亿手'
    if abs(val) >= 10_000: return f'{val / 10_000:.2f}万手'
    return f'{val:.0f}手'

def _fmt_amount(val: Optional[float]) -> Optional[str]:
    if val is None: return None
    if abs(val) >= 1_0000_0000_0000: return f'{val / 1_0000_0000_0000:.2f}万亿'
    if abs(val) >= 100_000_000: return f'{val / 100_000_000:.2f}亿'
    if abs(val) >= 10_000: return f'{val / 10_000:.2f}万'
    return f'{val:.2f}'

def _fmt_decimal(val: Optional[float]) -> Optional[str]:
    if val is None: return None
    return f'{val:.2f}'


# ═══════════════════════════════════════════════════════════════
# 主入口：解析 OCR 文本为结构化股票数据
# ═══════════════════════════════════════════════════════════════

def parse_stock_info(texts: list[str], keep_raw_ocr: bool = False) -> dict:
    """
    从 OCR 原始文本中解析结构化股票信息。

    参数:
        texts: OCR 识别的文本行列表
        keep_raw_ocr: 如果为 True，在结果中保留 _raw_ocr_texts 原始文本

    返回:
        统一 JSON 结构，空字段为 None
    """
    # ── 1. 过滤噪声 ──────────────────────────────────────
    kept = filter_texts(texts)
    if not kept:
        result = {
            'stock_name': None,
            'stock_code': None,
            'current_price': None,
            'change_percent': None,
            'change_amount': None,
            'open': None,
            'high': None,
            'low': None,
            'volume': None,
            'turnover': None,
            'turnover_rate': None,
            'pe': None,
            'pb': None,
        }
        if keep_raw_ocr:
            result['_raw_ocr_texts'] = texts
        return result

    # ── 2. 股票代码 + 名称 ───────────────────────────────
    code_info = _extract_code_info(kept)

    # ── 3. 价格 + 涨跌 ──────────────────────────────────
    code_idx: Optional[int] = None
    code_text = code_info.get('code')
    if code_text:
        for i, t in enumerate(kept):
            if code_text in t:
                code_idx = i
                break
    price_change = _extract_price_change(kept)

    # ── 4. 基本指标 ─────────────────────────────────────
    indicators = _extract_indicators(kept)

    # ── 5. 组装输出 ─────────────────────────────────────
    stock_code = None
    if code_info.get('market') and code_info.get('code'):
        stock_code = f"{code_info['market']}{code_info['code']}"
    elif code_info.get('code'):
        stock_code = code_info['code']

    result = {
        'stock_name': code_info.get('name'),
        'stock_code': stock_code,
        'current_price': _fmt_price(price_change.get('price')),
        'change_percent': price_change.get('_change_percent_raw') or _fmt_percent(price_change.get('change_percent')),
        'change_amount': price_change.get('_change_amount_raw') or _fmt_signed(price_change.get('change_amount')),
        'open': _fmt_price(indicators.get('open')),
        'high': _fmt_price(indicators.get('high')),
        'low': _fmt_price(indicators.get('low')),
        'volume': _fmt_volume(indicators.get('volume')),
        'turnover': _fmt_amount(indicators.get('turnover')),
        'turnover_rate': _fmt_percent(indicators.get('turnover_rate')),
        'pe': _fmt_decimal(indicators.get('pe')),
        'pb': _fmt_decimal(indicators.get('pb')),
    }

    if keep_raw_ocr:
        result['_raw_ocr_texts'] = texts

    logger.info('StockParser: name=%s code=%s price=%s has_data=%s',
                result['stock_name'], stock_code, result['current_price'],
                bool(stock_code or result['current_price']))

    return result
