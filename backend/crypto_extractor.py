"""
Crypto Extractor — 加密货币截图识别与字段提取

从 OCR 文本中判断是否为加密货币交易截图，并提取:
  - 交易对 (BTC/USDT, ETH/USDT ...)
  - 交易所 (Binance / OKX / Bybit ...)
  - 现价、24h 涨跌幅、24h 高低、成交量
  - 合约特征 (永续/杠杆/资金费率/多空比)

与 stock_extractor 平行,输出扁平 dict,供 /crypto-extract 路由使用。
"""

from __future__ import annotations

import re
from typing import Optional

# ═══════════════════════════════════════════════════════════════
# 币种词典 (常见币种,用于中英文识别)
# ═══════════════════════════════════════════════════════════════

COIN_ALIASES: dict[str, str] = {
    'BTC': 'BTC', '比特币': 'BTC', 'BITCOIN': 'BTC',
    'ETH': 'ETH', '以太坊': 'ETH', '以太币': 'ETH', 'ETHEREUM': 'ETH',
    'SOL': 'SOL', 'SOLANA': 'SOL',
    'BNB': 'BNB', '币安币': 'BNB',
    'XRP': 'XRP', '瑞波币': 'XRP',
    'DOGE': 'DOGE', '狗狗币': 'DOGE',
    'ADA': 'ADA', '艾达币': 'ADA',
    'AVAX': 'AVAX', '雪崩': 'AVAX',
    'LINK': 'LINK', 'CHAINLINK': 'LINK',
    'DOT': 'DOT', '波卡': 'DOT',
    'MATIC': 'MATIC', 'POL': 'POL',
    'LTC': 'LTC', '莱特币': 'LTC',
    'TRX': 'TRX', '波场': 'TRX',
    'TON': 'TON', 'NEAR': 'NEAR', 'APT': 'APT', 'SUI': 'SUI',
    'ARB': 'ARB', 'OP': 'OP', 'FIL': 'FIL', 'ATOM': 'ATOM',
    'UNI': 'UNI', 'AAVE': 'AAVE', 'PEPE': 'PEPE', 'SHIB': 'SHIB',
    'WIF': 'WIF', 'BONK': 'BONK', 'ORDI': 'ORDI', 'SATS': 'SATS',
}

# 交易对匹配模式: BTC/USDT, BTCUSDT, BTC-USDT, BTC-PERP
PAIR_PATTERN = re.compile(
    r'\b([A-Z]{2,10})[\s/\\-]?(USDT|USDC|USD|BTC|ETH|PERP|SWAP|永续)\b',
    re.IGNORECASE,
)

# 纯币种模式 (带 $ 前缀或独立词) — $BTC, BTC
COIN_PATTERN = re.compile(r'\$?([A-Z]{2,10})\b')

# 交易所关键词
EXCHANGE_KEYWORDS: dict[str, str] = {
    'BINANCE': 'Binance', '币安': 'Binance',
    'OKX': 'OKX', 'OKEX': 'OKX', '欧易': 'OKX',
    'BYBIT': 'Bybit', 'BYB': 'Bybit',
    '火币': 'HTX', 'HTX': 'HTX', 'HUOBI': 'HTX',
    'GATE': 'Gate.io', 'GATE.IO': 'Gate.io',
    'COINBASE': 'Coinbase',
    'BITGET': 'Bitget',
    'KRAKEN': 'Kraken', 'KUCOIN': 'KuCoin', 'KUCO': 'KuCoin',
    'MEXC': 'MEXC', 'BITFINEX': 'Bitfinex',
    'BITMART': 'BitMart',
    'WEB3': 'Web3', 'DEX': 'DEX',
    'TRADINGVIEW': 'TradingView',
}

# 加密货币强特征关键词 (出现即强烈指向加密截图)
CRYPTO_STRONG_KEYWORDS: list[str] = [
    '资金费率', '费率', '多空比', '大户持仓比', '爆仓', '清算',
    '永续', '交割合约', '合约', '杠杆', '开仓', '平仓', '持仓量',
    '全网持仓', '未平仓', '资金', '多单', '空单', '多头', '空头',
    'USDT', 'USDC', '稳定币', '法币', 'C2C', '提币', '充币',
    '现货', '币币', 'U本位', '币本位', '本位合约',
    '24h涨跌', '24小时', '流通市值', '流通量', '最大供应',
    '持有量', '持币', '链上', 'Gas', 'GAS费',
]

# 弱特征 (累计多条时支持加密判断)
CRYPTO_WEAK_KEYWORDS: list[str] = [
    '涨跌幅', '成交额', '成交量', '最高', '最低', '现价',
    '市值', '排名', '换手', '盘口', '深度',
]

# 平台 UI 特征
CRYPTO_UI_PATTERNS: list[str] = [
    r'(多空|多/空)(比|人数|账户)',
    r'(-?\d+\.?\d*)%',
    r'(24H|24h|24小时)',
    r'(U|USDT)\s*$',
]


# ═══════════════════════════════════════════════════════════════
# 基础工具
# ═══════════════════════════════════════════════════════════════

def _parse_number(text: str) -> Optional[float]:
    """解析带单位的数字: 1.2万 → 12000, 3.4亿 → 340000000, $67,890.5 → 67890.5"""
    if not text:
        return None
    t = text.strip().replace(',', '').replace('，', '')
    t = t.replace('$', '').replace('¥', '').replace('￥', '')
    multiplier = 1.0
    if t.endswith('万亿'):
        multiplier = 1e12
        t = t[:-2]
    elif t.endswith('万'):
        multiplier = 1e4
        t = t[:-1]
    elif t.endswith('亿'):
        multiplier = 1e8
        t = t[:-1]
    elif t.lower().endswith('k'):
        multiplier = 1e3
        t = t[:-1]
    elif t.lower().endswith('m'):
        multiplier = 1e6
        t = t[:-1]
    elif t.lower().endswith('b'):
        multiplier = 1e9
        t = t[:-1]
    try:
        return float(t) * multiplier
    except ValueError:
        return None


def _fmt_price(val: Optional[float]) -> Optional[str]:
    if val is None:
        return None
    if val >= 1000:
        return f'{val:,.2f}'
    if val >= 1:
        return f'{val:.4f}'.rstrip('0').rstrip('.')
    return f'{val:.8f}'.rstrip('0').rstrip('.')


# ═══════════════════════════════════════════════════════════════
# 识别核心
# ═══════════════════════════════════════════════════════════════

def detect_exchange(texts: list[str]) -> Optional[str]:
    """从文本识别交易所名称。"""
    hits: dict[str, int] = {}
    for line in texts:
        upper = line.upper()
        for kw, name in EXCHANGE_KEYWORDS.items():
            if kw in upper or kw in line:
                hits[name] = hits.get(name, 0) + 1
    if not hits:
        return None
    return max(hits.items(), key=lambda kv: kv[1])[0]


def detect_coin(texts: list[str], boxes: Optional[list[list[float]]] = None) -> dict:
    """
    识别主交易对币种 — 空间邻近 + 加权投票:
      - 关键信号: 币名文字框与主图现价文字框的欧氏距离 (主图币名紧贴大字现价, 侧栏币远)
      - 侧栏列表行 (币名+行情价+涨跌% 同现) 降权
      - 同行 pair/alias 命中只计一次; 平票取最先出现者
    boxes: 可选, 与 texts 对齐的 [x1,y1,x2,y2] 列表 (来自 PaddleOCR)
    返回 {'symbol': 'BTC', 'quote': 'USDT', 'pair': 'BTC/USDT', 'raw': 原始文本}
    """
    votes: dict[str, dict] = {}   # symbol -> {'cand', 'score', 'first_idx'}
    price_re = re.compile(r'(?<![\d.])([\d]{1,3}(?:,\d{3})*\.\d{2,8})(?!\d)')
    pct_re = re.compile(r'[+-]\d+\.\d+%')

    # ── 全文众数价格 = 主图现价 (排除百分比数值与 0 值, 防止 "+0.00%" 干扰) ──
    modal_re = re.compile(r'(?<![\d.%])([\d]{1,3}(?:,\d{3})*\.\d{2,8})(?![\d%])')
    counts: dict[str, int] = {}
    for line in texts:
        for m in modal_re.finditer(line):
            val = _parse_number(m.group(1))
            if val is None or val == 0:
                continue
            counts[m.group(1)] = counts.get(m.group(1), 0) + 1
    modal_price = max(counts, key=counts.get) if counts else None

    # ── 现价锚点: 含现价的行中文字框最高的那个 (大字号 = 主图现价, 面积会被长文本行抢走) ──
    anchor: Optional[tuple[float, float]] = None   # (cx, cy)
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
        """币名文字框中心到现价锚点的欧氏距离 (无坐标时 None)。"""
        if anchor is None or not boxes or idx >= len(boxes):
            return None
        x1, y1, x2, y2 = boxes[idx]
        cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
        return ((cx - anchor[0]) ** 2 + (cy - anchor[1]) ** 2) ** 0.5

    modal_lines = {i for i, l in enumerate(texts)
                   if modal_price and modal_price in l}

    def _near_modal(idx: int) -> bool:
        return any(abs(idx - j) <= 2 for j in modal_lines)

    def _vote(symbol: str, quote: str, raw: str, line_idx: int, weight: float):
        v = votes.get(symbol)
        cand = {'symbol': symbol, 'quote': quote,
                'pair': f'{symbol}/{quote}', 'raw': raw}
        if v is None:
            votes[symbol] = {'cand': cand, 'score': weight, 'first_idx': line_idx}
        else:
            v['score'] += weight
            v['first_idx'] = min(v['first_idx'], line_idx)

    for idx, line in enumerate(texts):
        upper = line.upper()
        seen: set[str] = set()
        has_price = bool(price_re.search(line))
        has_modal = bool(modal_price and modal_price in line)
        # 侧栏列表行: 币名 + 行情价 + 涨跌% 同现 (如 "BTCUSDT 永续 73,471.6 +0.40%")
        is_list_row = has_price and bool(pct_re.search(line))
        near_modal = _near_modal(idx)

        def _weight(base: float) -> float:
            w = base
            # 空间距离: 越贴近现价锚点越可信 (主图币名 vs 侧栏币名)
            d = _dist(idx)
            if d is not None:
                w += max(0.0, 10.0 - d / 30.0)   # 300px 外归零, 紧贴现价满分 +10
            if has_modal:
                w += 4.0            # 现价与币名同行 (主图标题)
            elif near_modal:
                w += 2.0            # 行序邻近 (辅助信号)
            if is_list_row:
                w -= 3.0            # 侧栏列表行降权
            return w

        # 交易对模式
        for m in PAIR_PATTERN.finditer(upper):
            base = m.group(1)
            quote = (m.group(2).replace('PERP', 'USDT').replace('SWAP', 'USDT')
                     .replace('永续', 'USDT'))
            if quote == 'USD':
                quote = 'USDT'
            if base not in COIN_ALIASES.values() and base not in COIN_ALIASES:
                continue
            symbol = COIN_ALIASES.get(base, base)
            if symbol in seen:
                continue
            seen.add(symbol)
            w = _weight(2.0)
            if ' ' in m.group(0):
                w += 1.0            # "ETH USDT" 空格形态多见于主图标题
            _vote(symbol, quote, m.group(0), idx, w)

        # 中文/裸别名 (同行去重)
        for alias, symbol in COIN_ALIASES.items():
            if len(alias) < 2 or symbol in seen:
                continue
            if alias in line:
                seen.add(symbol)
                _vote(symbol, 'USDT', alias, idx, _weight(1.0))

    if votes:
        best = max(votes.values(),
                   key=lambda v: (v['score'], -v['first_idx']))
        return best['cand']

    # 最后兜底: $BTC 形式
    for line in texts:
        for m in re.finditer(r'\$([A-Z]{2,10})\b', line.upper()):
            symbol = m.group(1)
            if symbol in COIN_ALIASES.values():
                return {'symbol': symbol, 'quote': 'USDT',
                        'pair': f'{symbol}/USDT', 'raw': m.group(0)}

    return {'symbol': None, 'quote': None, 'pair': None, 'raw': None}


def detect_contract_features(texts: list[str]) -> dict:
    """识别合约特征: 永续/杠杆/资金费率/多空比。"""
    joined = '\n'.join(texts)
    features = {
        'is_perpetual': bool(re.search(r'永续|PERP|SWAP', joined, re.IGNORECASE)),
        'has_leverage': bool(re.search(r'杠杆|[0-9]+X|[0-9]+倍', joined, re.IGNORECASE)),
        'has_funding_rate': '资金费率' in joined or '费率' in joined,
        'has_long_short': bool(re.search(r'多空(比|人数|账户)|多/空', joined)),
        'is_futures': bool(re.search(r'合约|交割|开仓|平仓|持仓', joined)),
    }
    return features


def _find_price(texts: list[str], coin_symbol: Optional[str]) -> Optional[str]:
    """
    提取现价:
      1. 含币种 symbol 的行内、非百分比的价格 ("2,056.55 ETH USDT 永续合约.")
      2. 全文众数 — 现价在行情页反复出现, 众数即现价
      3. $ 前缀兜底 (最不可靠, 可能是市值)
    """
    price_re = re.compile(r'(?<![\d.%])([\d]{1,3}(?:,\d{3})*\.\d{2,8})(?!\s*%|[\d])')

    # 1. 含币种 symbol 的行
    if coin_symbol:
        sym = coin_symbol.upper()
        for line in texts:
            if sym in line.upper():
                for m in price_re.finditer(line):
                    return m.group(1)

    # 2. 众数 (排除百分数 / 明显是量额的超大数)
    counts: dict[str, int] = {}
    for line in texts:
        for m in price_re.finditer(line):
            val = _parse_number(m.group(1))
            if val is not None and 0.000001 < val < 1e7:
                counts[m.group(1)] = counts.get(m.group(1), 0) + 1
    if counts:
        return max(counts.items(), key=lambda kv: kv[1])[0]

    # 3. $ 前缀兜底
    return _extract_field_near(texts, [r'\$\s*([\d,]+\.?\d*)'])


def _find_change(texts: list[str], coin_symbol: Optional[str]) -> Optional[str]:
    """
    提取 24h 涨跌幅, 候选按 (币种邻近, 括号格式, 非零) 排序取最优,
    跳过资金费率行, 避免 K 线 tooltip 的 0.00% 与侧栏他币涨跌抢占。
    """
    paren_re = re.compile(r'\(\s*([+-]?\d+\.?\d*)%\s*\)')
    signed_re = re.compile(r'([+-]\d+\.?\d*)%')

    candidates: list[tuple[int, int, int, str]] = []  # (near, paren, nonzero, value)

    for i, line in enumerate(texts):
        if '费率' in line or 'rate' in line.lower():
            continue  # 资金费率不是涨跌幅
        m = paren_re.search(line) or signed_re.search(line)
        if not m:
            continue
        val = _parse_number(m.group(1))
        if val is None:
            continue
        near = 0
        if coin_symbol and coin_symbol.upper() in ' '.join(
                texts[max(0, i - 2): i + 3]).upper():
            near = 1
        is_paren = 1 if paren_re.search(line) else 0
        nonzero = 1 if val != 0 else 0
        candidates.append((near, is_paren, nonzero, m.group(1)))

    if candidates:
        candidates.sort(reverse=True)
        return candidates[0][3]

    # 兜底: "涨跌" 行
    return _extract_field_near(texts, [
        r'(?:涨跌|涨幅|change)[^\d+-]{0,6}([+-]?\d+\.?\d*)%',
    ])


def _extract_field_near(texts: list[str], patterns: list[str]) -> Optional[str]:
    """在文本行中按正则组提取第一个捕获组。"""
    for line in texts:
        for p in patterns:
            m = re.search(p, line)
            if m:
                return m.group(1)
    return None


def extract_crypto_info(texts: list[str], debug: bool = False,
                        boxes: Optional[list[list[float]]] = None) -> dict:
    """
    从 OCR 文本提取加密货币信息。

    返回:
        {
            'success': bool,
            'is_crypto': bool,
            'market_type': 'crypto' | 'stock' | 'unknown',
            'exchange': 'Binance' | ...,
            'coin_symbol': 'BTC',
            'quote_asset': 'USDT',
            'pair': 'BTC/USDT',
            'current_price': '67,890.50',
            'change_percent': '+2.35%',
            'high_24h': ...,
            'low_24h': ...,
            'volume_24h': ...,
            'turnover_24h': ...,
            'contract_features': {...},
            'confidence': 0.0-1.0,
            'debug_info': {...}  (debug=True 时)
        }
    """
    if not texts:
        return {'success': False, 'is_crypto': False, 'market_type': 'unknown',
                'error': 'OCR 无输出文本', 'confidence': 0.0}

    # ── 打分判断是否加密截图 ──
    strong_hits = sum(1 for t in texts for kw in CRYPTO_STRONG_KEYWORDS if kw in t)
    weak_hits = sum(1 for t in texts for kw in CRYPTO_WEAK_KEYWORDS if kw in t)
    exchange = detect_exchange(texts)
    coin = detect_coin(texts, boxes)
    pair_found = bool(coin.get('pair'))
    features = detect_contract_features(texts)

    score = strong_hits * 15 + weak_hits * 2 + (25 if exchange else 0) + (30 if pair_found else 0)
    if features['is_perpetual'] or features['has_funding_rate'] or features['has_long_short']:
        score += 20

    is_crypto = score >= 40 or (pair_found and strong_hits >= 1) or (strong_hits >= 3)

    if not is_crypto:
        return {
            'success': True,
            'is_crypto': False,
            'market_type': 'unknown',
            'confidence': round(min(0.9, 0.3 + score / 200), 2),
            'score': score,
        }

    # ── 字段提取 ──
    coin_sym = coin.get('symbol')
    price = _find_price(texts, coin_sym)
    price_val = _parse_number(price) if price else None

    change = _find_change(texts, coin_sym)
    change_val = _parse_number(change) if change else None

    high = _extract_field_near(texts, [
        r'(?:24h高|24小时高|24H高|最高(?:价)?)[^\d]{0,6}([\d,]+\.?\d*)',
    ])
    low = _extract_field_near(texts, [
        r'(?:24h低|24小时低|24H低|最低(?:价)?)[^\d]{0,6}([\d,]+\.?\d*)',
    ])
    volume = _extract_field_near(texts, [
        r'(?:24h量|24小时量|成交量?)[^\d]{0,6}([\d,]+\.?\d*[万亿]?)',
    ])
    turnover = _extract_field_near(texts, [
        r'(?:24h额|24小时额|成交额)[^\d]{0,6}([\d,]+\.?\d*[万亿]?)',
    ])

    confidence = min(0.95, 0.35 + (0.2 if pair_found else 0) + (0.15 if exchange else 0)
                     + (0.1 if price_val else 0) + min(0.15, strong_hits * 0.03))

    result = {
        'success': True,
        'is_crypto': True,
        'market_type': 'crypto',
        'exchange': exchange,
        'coin_symbol': coin.get('symbol'),
        'quote_asset': coin.get('quote') or 'USDT',
        'pair': coin.get('pair') or (f"{coin.get('symbol')}/USDT" if coin.get('symbol') else None),
        'current_price': _fmt_price(price_val),
        'change_percent': f'{change_val:+.2f}%' if change_val is not None else None,
        'high_24h': _fmt_price(_parse_number(high)) if high else None,
        'low_24h': _fmt_price(_parse_number(low)) if low else None,
        'volume_24h': volume,
        'turnover_24h': turnover,
        'contract_features': features,
        'confidence': round(confidence, 2),
        'score': score,
    }

    if debug:
        result['debug_info'] = {
            'strong_hits': strong_hits,
            'weak_hits': weak_hits,
            'exchange': exchange,
            'coin_raw': coin.get('raw'),
            'texts': texts[:50],
        }

    return result
