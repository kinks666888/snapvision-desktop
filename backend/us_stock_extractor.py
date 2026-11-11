"""
US Stock Extractor — 美股截图识别与字段提取

从 OCR 文本+文字框坐标判断是否为美股交易截图, 并提取:
  - 股票代码 (AAPL / $TSLA / 个股名称中英文)
  - 交易所 (NASDAQ / NYSE / AMEX) 与平台 (雪球/富途/老虎/TradingView...)
  - 现价、涨跌幅、52周高低、成交量、市值、市盈率、每股收益

与 crypto_extractor 平行; 沿用其已验证的教训:
  - 空间坐标定位 (币名/股名紧贴大字现价, 侧栏列表项降权)
  - 众数价格排除百分比/零值干扰
  - _parse_number 单位顺序 (万亿优先)
"""

from __future__ import annotations

import re
from typing import Optional

# 复用 crypto_extractor 中已验证的通用工具 (避免复制走样)
from crypto_extractor import _parse_number, _fmt_price, _find_price

# ═══════════════════════════════════════════════════════════════
# 美股代码词典 (代码 -> 中文名)
# ═══════════════════════════════════════════════════════════════

US_TICKERS: dict[str, str] = {
    'AAPL': '苹果', 'MSFT': '微软', 'GOOGL': '谷歌', 'GOOG': '谷歌',
    'AMZN': '亚马逊', 'NVDA': '英伟达', 'META': 'Meta', 'TSLA': '特斯拉',
    'NFLX': '奈飞', 'AMD': 'AMD', 'INTC': '英特尔', 'ADBE': 'Adobe',
    'CRM': '赛富时', 'ORCL': '甲骨文', 'IBM': 'IBM', 'CSCO': '思科',
    'QCOM': '高通', 'TXN': '德州仪器', 'AVGO': '博通', 'MU': '美光',
    'AMAT': '应用材料', 'ASML': 'ASML', 'TSM': '台积电', 'ARM': 'ARM',
    'SMCI': '超微电脑', 'DELL': '戴尔', 'HPQ': '惠普',
    'UBER': '优步', 'ABNB': '爱彼迎', 'COIN': 'Coinbase', 'HOOD': 'Robinhood',
    'PLTR': 'Palantir', 'SNOW': 'Snowflake', 'NET': 'Cloudflare',
    'CRWD': 'CrowdStrike', 'PANW': 'Palo Alto', 'DDOG': 'Datadog',
    'ZM': 'Zoom', 'PTON': 'Peloton', 'SPOT': 'Spotify', 'ROKU': 'Roku',
    'PYPL': 'PayPal', 'SHOP': 'Shopify', 'RBLX': 'Roblox',
    'DIS': '迪士尼', 'WBD': '华纳', 'BA': '波音', 'GE': '通用电气',
    'CAT': '卡特彼勒', 'DE': '迪尔', 'HON': '霍尼韦尔', 'MMM': '3M',
    'LMT': '洛克希德', 'RTX': '雷神', 'NOC': '诺斯罗普',
    'JPM': '摩根大通', 'BAC': '美国银行', 'WFC': '富国银行', 'C': '花旗',
    'GS': '高盛', 'MS': '摩根士丹利', 'AXP': '美国运通', 'V': 'Visa',
    'MA': '万事达', 'SCHW': '嘉信理财', 'BLK': '贝莱德',
    'UNH': '联合健康', 'JNJ': '强生', 'PFE': '辉瑞', 'MRK': '默沙东',
    'ABBV': '艾伯维', 'LLY': '礼来', 'BMY': '百时美', 'AMGN': '安进',
    'GILD': '吉利德', 'MRNA': 'Moderna', 'TMO': '赛默飞', 'DHR': '丹纳赫',
    'ABT': '雅培', 'CVS': 'CVS',
    'WMT': '沃尔玛', 'COST': '好市多', 'TGT': '塔吉特', 'HD': '家得宝',
    'LOW': '劳氏', 'NKE': '耐克', 'LULU': 'Lululemon', 'MCD': '麦当劳',
    'SBUX': '星巴克', 'KO': '可口可乐', 'PEP': '百事', 'PG': '宝洁',
    'XOM': '埃克森美孚', 'CVX': '雪佛龙', 'COP': '康菲', 'SLB': '斯伦贝谢',
    'OXY': '西方石油',
    'GM': '通用汽车', 'F': '福特', 'RIVN': 'Rivian', 'LCID': 'Lucid',
    'NIO': '蔚来', 'LI': '理想', 'XPEV': '小鹏',
    'BABA': '阿里巴巴', 'JD': '京东', 'PDD': '拼多多', 'BIDU': '百度',
    'WB': '微博', 'IQ': '爱奇艺', 'BILI': '哔哩哔哩', 'NTES': '网易',
    'TME': '腾讯音乐', 'EDU': '新东方', 'TAL': '好未来', 'VIPS': '唯品会',
    'ZTO': '中通快递', 'ATLX': '亚朵',
    'MO': '奥驰亚', 'T': 'AT&T', 'VZ': '威瑞森', 'TMUS': 'T-Mobile',
    'WBA': '沃尔格林', 'COP': '康菲',
    'SNDK': '闪迪', 'WDC': '西部数据', 'STX': '希捷',
}

# 中文名 -> 代码
CN_NAME_TO_TICKER: dict[str, str] = {
    v: k for k, v in US_TICKERS.items() if re.match(r'^[一-鿿]+$', v)
}

# 美股强特征关键词 (出现即强烈指向美股截图)
US_STRONG_KEYWORDS: list[str] = [
    '52周最高', '52周最低', '52周高', '52周低', '52周', '52W',
    '市盈率TTM', '市盈率(动', '市盈率(静', '每股收益', 'EPS', 'TTM',
    '盘前交易', '盘后交易', '盘前价', '盘前', '盘后',
    '美股', '美东', '纳斯达克', '纽交所', '纽约证券交易所',
    'NASDAQ', 'NYSE', 'AMEX', 'OTC',
    '股息率', '股息', '拆股', '分红派息',
    '10-K', '10-Q', '财报季', '季报',
]

# 弱特征 (累计支持美股判断)
US_WEAK_KEYWORDS: list[str] = [
    '涨跌幅', '涨跌', '成交额', '成交量', '今开', '最高', '最低',
    '总市值', '流通市值', '市值', '市净率', '换手率', '振幅',
    '美元', 'USD', '收盘价', '开盘价',
]

# 平台特征
US_PLATFORM_KEYWORDS: list[str] = [
    '雪球', 'xueqiu', '富途', 'moomoo', 'futu', '牛牛',
    '老虎', 'TIGER', 'tiger', '同花顺', 'TradingView', 'tradingview',
    '盈透', 'IBKR', 'Interactive', 'WEBULL', '微牛', 'Robinhood',
    '长桥', 'Longbridge', '嘉信', 'Charles Schwab', '富途牛牛',
]

# 交易所映射
_EXCHANGE_MAP = {
    'NASDAQ': 'NASDAQ', '纳斯达克': 'NASDAQ', 'NMS': 'NASDAQ',
    'NYSE': 'NYSE', '纽交所': 'NYSE', '纽约证券交易所': 'NYSE',
    'AMEX': 'AMEX', '美国证券交易所': 'AMEX', 'OTC': 'OTC',
}

# 非代码词屏蔽 (2-5 个大写字母但不是股票代码)
_TICKER_BLOCKLIST = {
    'USD', 'USDT', 'USDC', 'NYSE', 'NASDAQ', 'AMEX', 'OTC',
    'CEO', 'CFO', 'IPO', 'ETF', 'EPS', 'TTM', 'PE', 'PB', 'ROE',
    'KDJ', 'RSI', 'MACD', 'MA20', 'MA50', 'MA200', 'BOLL', 'ATR',
    'AH', 'PM', 'AM', 'ET', 'Q1', 'Q2', 'Q3', 'Q4', 'YOY', 'QOQ',
    'OPEN', 'HIGH', 'LOW', 'CLOSE', 'VOL', 'GDP', 'CPI', 'FED',
}


def detect_us_exchange(texts: list[str]) -> Optional[str]:
    """识别交易所 (NASDAQ/NYSE...), 未命中返回 None。"""
    hits: dict[str, int] = {}
    for line in texts:
        upper = line.upper()
        for kw, name in _EXCHANGE_MAP.items():
            if kw.upper() in upper or kw in line:
                hits[name] = hits.get(name, 0) + 1
    if not hits:
        return None
    return max(hits.items(), key=lambda kv: kv[1])[0]


def detect_us_platform(texts: list[str]) -> Optional[str]:
    """识别截图来源平台。"""
    for line in texts:
        for kw, name in [(k, k) for k in US_PLATFORM_KEYWORDS]:
            if kw in line or kw.upper() in line.upper():
                return name
    return None


def detect_us_ticker(texts: list[str],
                     boxes: Optional[list[list[float]]] = None) -> dict:
    """
    识别美股代码 — 空间邻近加权投票 (与 detect_coin 同策略):
      - $AAPL 前缀形态 + 词典代码 + 中文名别名
      - 主图股名紧贴大字现价 (bbox 距离权重), 侧栏列表行降权
    返回 {'symbol': 'AAPL', 'name': '苹果', 'raw': 原始文本}
    """
    votes: dict[str, dict] = {}
    price_re = re.compile(r'(?<![\d.])([\d]{1,3}(?:,\d{3})*\.\d{2,8})(?!\d)')
    pct_re = re.compile(r'[+-]\d+\.\d+%')

    # ── 众数价格 = 主图现价 (排除百分比/零值) ──
    modal_re = re.compile(r'(?<![\d.%])([\d]{1,3}(?:,\d{3})*\.\d{2,8})(?![\d%])')
    counts: dict[str, int] = {}
    for line in texts:
        for m in modal_re.finditer(line):
            val = _parse_number(m.group(1))
            if val is None or val == 0:
                continue
            counts[m.group(1)] = counts.get(m.group(1), 0) + 1
    modal_price = max(counts, key=counts.get) if counts else None

    # ── 现价锚点: 含现价的行中文字框最高的 (大字号) ──
    anchor: Optional[tuple[float, float]] = None
    if modal_price and boxes and len(boxes) == len(texts):
        best_h = -1.0
        for i, line in enumerate(texts):
            if modal_price not in line:
                continue
            x1, y1, x2, y2 = boxes[i]
            h = max(0.0, y2 - y1)
            if h > best_h:
                best_h = h
                anchor = ((x1 + x2) / 2, (y1 + y2) / 2)

    def _dist(idx: int) -> Optional[float]:
        if anchor is None or not boxes or idx >= len(boxes):
            return None
        x1, y1, x2, y2 = boxes[idx]
        cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
        return ((cx - anchor[0]) ** 2 + (cy - anchor[1]) ** 2) ** 0.5

    def _vote(symbol: str, name: Optional[str], raw: str, line_idx: int, weight: float):
        symbol = symbol.upper()
        v = votes.get(symbol)
        if v is None:
            votes[symbol] = {'symbol': symbol, 'name': name, 'raw': raw,
                             'score': weight, 'first_idx': line_idx}
        else:
            v['score'] += weight
            v['first_idx'] = min(v['first_idx'], line_idx)
            if not v.get('name') and name:
                v['name'] = name

    for idx, line in enumerate(texts):
        upper = line.upper()
        seen: set[str] = set()
        has_price = bool(price_re.search(line))
        is_list_row = has_price and bool(pct_re.search(line))

        def _weight(base: float) -> float:
            w = base
            d = _dist(idx)
            if d is not None:
                w += max(0.0, 10.0 - d / 30.0)   # 紧贴现价锚点 +10
            if is_list_row:
                w -= 3.0                          # 侧栏列表行降权
            return w

        # 交易所标签格式 (雪球标题, 最高权重): "闪迪(NASDAQ:SNDK)" / "Apple Inc.(NASDAQ:AAPL)"
        for m in re.finditer(
                r'([一-鿿]{2,12}|[A-Za-z][A-Za-z .&\']{0,30})\s*'
                r'[(（](?:NASDAQ|NYSE|AMEX|OTC)[::]\s*([A-Z]{1,5})[)）]', line):
            sym = m.group(2).upper()
            if sym in _TICKER_BLOCKLIST or sym in seen:
                continue
            seen.add(sym)
            name = m.group(1).strip() or US_TICKERS.get(sym)
            _vote(sym, name, m.group(0), idx, _weight(5.0))

        # $AAPL 前缀形态
        for m in re.finditer(r'\$([A-Z]{1,5})\b', upper):
            sym = m.group(1)
            if sym in _TICKER_BLOCKLIST or sym in seen:
                continue
            seen.add(sym)
            _vote(sym, US_TICKERS.get(sym), m.group(0), idx, _weight(3.0))

        # 词典代码 (词边界防 OPEN/ADA 这类子串误判)
        for sym, name in US_TICKERS.items():
            if sym in seen:
                continue
            if re.search(rf'\b{re.escape(sym)}\b', upper):
                seen.add(sym)
                _vote(sym, name, sym, idx, _weight(2.0))

        # 中文名
        for cn, sym in CN_NAME_TO_TICKER.items():
            if sym in seen or cn not in line:
                continue
            seen.add(sym)
            _vote(sym, cn, cn, idx, _weight(1.5))

    if votes:
        best = max(votes.values(), key=lambda v: (v['score'], -v['first_idx']))
        return {'symbol': best['symbol'], 'name': best.get('name'), 'raw': best['raw']}
    return {'symbol': None, 'name': None, 'raw': None}


# ═══════════════════════════════════════════════════════════════
# 主入口
# ═══════════════════════════════════════════════════════════════

def extract_us_stock_info(texts: list[str], debug: bool = False,
                          boxes: Optional[list[list[float]]] = None) -> dict:
    """
    从 OCR 文本提取美股信息。

    返回:
        {'success', 'is_us_stock', 'market_type', 'exchange', 'platform',
         'symbol', 'name', 'current_price', 'change_percent',
         'high_52w', 'low_52w', 'volume', 'turnover', 'market_cap',
         'pe', 'confidence', 'score'}
    """
    if not texts:
        return {'success': False, 'is_us_stock': False, 'market_type': 'unknown',
                'error': 'OCR 无输出文本', 'confidence': 0.0}

    # ── 打分判断是否美股截图 ──
    strong_hits = sum(1 for t in texts for kw in US_STRONG_KEYWORDS if kw in t or kw.upper() in t.upper())
    weak_hits = sum(1 for t in texts for kw in US_WEAK_KEYWORDS if kw in t)
    exchange = detect_us_exchange(texts)
    platform = detect_us_platform(texts)
    ticker = detect_us_ticker(texts, boxes)
    ticker_found = bool(ticker.get('symbol'))

    score = (strong_hits * 15 + weak_hits * 2
             + (25 if exchange else 0) + (15 if platform else 0)
             + (30 if ticker_found else 0))

    is_us_stock = score >= 45 or (ticker_found and strong_hits >= 1) or (strong_hits >= 3)

    if not is_us_stock:
        return {
            'success': True,
            'is_us_stock': False,
            'market_type': 'unknown',
            'confidence': round(min(0.9, 0.3 + score / 200), 2),
            'score': score,
        }

    # ── 字段提取 (美股专用现价/涨跌 + 复用通用字段) ──
    symbol = ticker.get('symbol')
    price = _find_us_price(texts)
    price_val = _parse_number(price) if price else None
    change = _find_us_change(texts, price)
    change_val = _parse_number(change) if change else None

    high52 = _extract_field_near(texts, [
        r'(?:52周高|52周最高|52周新高|52周高点|52W高)[^\d]{0,6}([\d,]+\.?\d*)',
    ])
    low52 = _extract_field_near(texts, [
        r'(?:52周低|52周最低|52周新低|52周低点|52W低)[^\d]{0,6}([\d,]+\.?\d*)',
    ])
    # OCR 噪声容错: "52周" 被误识为 "52□" 时, 从含 52 的行提取两位小数数值 (先高后低)
    if high52 is None and low52 is None:
        for line in texts:
            if '52' not in line:
                continue
            nums = re.findall(r'(\d+\.\d{2})', line)
            vals = []
            for n in nums:
                v = _parse_number(n.lstrip('0') or '0') if n.startswith('0') else _parse_number(n)
                if v and v > 1:
                    vals.append(n)
            if len(vals) >= 2:
                high52, low52 = vals[0], vals[1]
                break
    pe = _extract_field_near(texts, [
        r'(?:市盈率\s*\(?[TTM动静ttm]*\)?|PE\s*\(?TTM\)?)[:：]?\s*([-\d.]+)',
    ])
    eps = _extract_field_near(texts, [
        r'(?:每股收益|EPS)[:：]?\s*\$?\s*([-\d.]+)',
    ])
    volume = _extract_field_near(texts, [
        r'(?:成交量?)[:：]?\s*([\d,]+\.?\d*[万亿]?)',
    ])
    market_cap = _extract_field_near(texts, [
        r'(?:总市值|市值)[:：]?\s*\$?\s*([\d,]+\.?\d*[万亿]?)',
    ])

    confidence = min(0.95, 0.35
                     + (0.2 if ticker_found else 0)
                     + (0.12 if exchange else 0) + (0.08 if platform else 0)
                     + (0.1 if price_val else 0) + min(0.15, strong_hits * 0.03))

    result = {
        'success': True,
        'is_us_stock': True,
        'market_type': 'us_stock',
        'exchange': exchange,
        'platform': platform,
        'symbol': symbol,
        'name': ticker.get('name') or (US_TICKERS.get(symbol) if symbol else None),
        'current_price': _fmt_price(price_val),
        'change_percent': f'{change_val:+.2f}%' if change_val is not None else None,
        'high_52w': _fmt_price(_parse_number(high52)) if high52 else None,
        'low_52w': _fmt_price(_parse_number(low52)) if low52 else None,
        'pe': pe,
        'eps': eps,
        'volume': volume,
        'market_cap': market_cap,
        'confidence': round(confidence, 2),
        'score': score,
    }
    if debug:
        result['debug_info'] = {
            'strong_hits': strong_hits, 'weak_hits': weak_hits,
            'exchange': exchange, 'platform': platform,
            'ticker_raw': ticker.get('raw'), 'texts': texts[:50],
        }
    return result


def _find_us_price(texts: list[str]) -> Optional[str]:
    """
    美股现价提取 (雪球/富途排版特征):
      1. $ 独立现价行 "$859.99" (大字现价)
      2. "最新：859.99" / "现价" 标签
      3. 兜底: _find_price (币名邻近/众数)
    """
    standalone = re.compile(r'^\$\s*([\d,]+\.\d{2,4})$')
    tagged = re.compile(r'(?:最新|现价|最新价)[:：]?\s*\$?\s*([\d,]+\.\d{2,4})')
    dollar = re.compile(r'\$\s*([\d,]+\.\d{2,4})')

    for line in texts:
        m = standalone.match(line.strip())
        if m:
            return m.group(1)
    for line in texts:
        m = tagged.search(line)
        if m:
            return m.group(1)
    for line in texts:
        m = dollar.search(line)
        if m:
            return m.group(1)
    return _find_price(texts, None)


def _find_us_change(texts: list[str], price: Optional[str]) -> Optional[str]:
    """
    美股涨跌幅提取 (雪球排版: "-26.52-2.99%" = 涨跌额+涨跌幅连排):
      优先级 = 涨跌额连排 > 与现价同行 > 页面顶部概要
    (不复用 _find_change: 其平票时按数值字符串排序, 会误选盘口数值)
    """
    pct_re = re.compile(r'([+-]\d+\.?\d*)%')
    combo_re = re.compile(r'[+-]\d+\.?\d*\s*[+-]\d+\.?\d*%')   # 涨跌额+涨跌幅 连排
    price_norm = price.replace(',', '') if price else None

    best_score, best_val = -1, None
    for i, line in enumerate(texts):
        if '费率' in line:
            continue
        has_combo = bool(combo_re.search(line))
        has_price = bool(price_norm and price_norm in line.replace(',', ''))
        for m in pct_re.finditer(line):
            try:
                val = float(m.group(1))
            except ValueError:
                continue
            score = 0
            if has_combo:
                score += 6
            if has_price:
                score += 4
            if i < 12:
                score += 2
            if val != 0:
                score += 1
            if score > best_score:
                best_score, best_val = score, m.group(1)
    return best_val


def _extract_field_near(texts: list[str], patterns: list[str]) -> Optional[str]:
    """在文本行中按正则组提取第一个捕获组。"""
    for line in texts:
        for p in patterns:
            m = re.search(p, line)
            if m:
                return m.group(1)
    return None
