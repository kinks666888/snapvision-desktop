"""
Crypto API — 加密货币行情统一服务

多源 fallback (与股票 MarketDataService 同模式):
  1. OKX   公开 API (国内可达,含资金费率/持仓量)  — 主源
  2. Binance 公开 API (数据最全)                    — 备源 1
  3. CoinGecko 免费 API (无需 key)                  — 备源 2

额外情绪数据:
  - 资金费率 (funding rate)
  - 多空比 (long/short ratio, Binance futures)
  - 恐慌贪婪指数 (Alternative.me F&G)

所有接口均无需 API Key。
"""

from __future__ import annotations

import json
import logging
import re
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)

_HTTP_TIMEOUT = 6  # 秒

# 币种别名 → 标准 symbol
_COIN_NORMALISE = {
    'XBT': 'BTC', 'BITCOIN': 'BTC',
    'ETHER': 'ETH', 'ETHEREUM': 'ETH',
}

# 周期映射: 统一周期名 → 各源周期码
_PERIOD_MAP = {
    # unified: (okx bar, binance interval, coingecko days)
    '1min':   ('1m', '1m', 1),
    '5min':   ('5m', '5m', 1),
    '15min':  ('15m', '15m', 1),
    '30min':  ('30m', '30m', 1),
    '60min':  ('1H', '1h', 7),
    '4hour':  ('4H', '4h', 30),
    'daily':  ('1D', '1d', 90),
    'monthly': ('1M', '1M', 365),
    'weekly': ('1W', '1w', 365),
}


# ═══════════════════════════════════════════════════════════════
# HTTP 工具
# ═══════════════════════════════════════════════════════════════

def _build_opener() -> urllib.request.OpenerDirector:
    """
    构造带代理的 urllib opener。

    优先级:
      1. SNAPVISION_PROXY 显式代理 (如 http://127.0.0.1:7890)
      2. urllib 默认代理链 (env http_proxy/https_proxy → macOS 系统代理)
    """
    import os
    proxy = os.environ.get('SNAPVISION_PROXY', '').strip()
    if proxy:
        handler = urllib.request.ProxyHandler({'http': proxy, 'https': proxy})
        return urllib.request.build_opener(handler)
    return urllib.request.build_opener()


_opener: Optional[urllib.request.OpenerDirector] = None


def _http_get_json(url: str, timeout: int = _HTTP_TIMEOUT) -> Optional[dict | list]:
    """GET 请求并解析 JSON,失败返回 None。"""
    global _opener
    try:
        if _opener is None:
            _opener = _build_opener()
        req = urllib.request.Request(url, headers={
            'User-Agent': 'SnapVision/0.1 (crypto-market)',
            'Accept': 'application/json',
        })
        with _opener.open(req, timeout=timeout) as resp:
            body = resp.read().decode('utf-8')
        return json.loads(body)
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError) as e:
        logger.info('[crypto] GET %s 失败: %s', url[:80], e)
        return None
    except Exception as e:  # noqa: BLE001 — 网络层兜底
        logger.info('[crypto] GET %s 异常: %s', url[:80], e)
        return None


def normalise_symbol(raw: str) -> tuple[str, str]:
    """
    归一化币种输入 → (base, quote)
    支持: 'BTC', 'btc', 'BTCUSDT', 'BTC-USDT', 'BTC/USDT', '$BTC'
    安全: 剔除非法字符, 防止 URL 查询参数注入 (如 "BTC&foo=bar")
    """
    s = (raw or '').strip().upper().replace('$', '').replace(' ', '')
    s = s.replace('_', '-').replace('/', '-')
    if not s:
        return ('BTC', 'USDT')
    for sep in ('-',):
        if sep in s:
            parts = s.split(sep)
            if len(parts) == 2 and parts[0] and parts[1]:
                base = _COIN_NORMALISE.get(parts[0], parts[0])
                quote = parts[1] if parts[1] in ('USDT', 'USDC', 'USD', 'BTC', 'ETH') else 'USDT'
                return (_sanitize_base(base), quote)
    # 无分隔符: 尝试拆出 USDT/USDC 后缀
    for quote in ('USDT', 'USDC', 'USD'):
        if s.endswith(quote) and len(s) > len(quote):
            base = s[:-len(quote)]
            return (_sanitize_base(base), quote)
    base = _COIN_NORMALISE.get(s, s)
    return (_sanitize_base(base), 'USDT')


def _sanitize_base(base: str) -> str:
    """别名归一化 + 仅保留 A-Z0-9 且限长, 防查询参数注入。非法输入回退 BTC。"""
    cleaned = re.sub(r'[^A-Z0-9]', '', (base or '').upper())[:15]
    cleaned = _COIN_NORMALISE.get(cleaned, cleaned)
    return cleaned if cleaned else 'BTC'


def _ts_to_label(ms: int, period: str) -> str:
    """毫秒时间戳 → 可读时间标签。"""
    dt = datetime.fromtimestamp(ms / 1000, tz=timezone.utc)
    if period in ('daily', 'weekly'):
        return dt.strftime('%Y-%m-%d')
    return dt.strftime('%Y-%m-%d %H:%M')


# ═══════════════════════════════════════════════════════════════
# OKX 数据源
# ═══════════════════════════════════════════════════════════════

class OkxSource:
    name = 'okx'
    BASE = 'https://www.okx.com'

    @staticmethod
    def _inst_id(base: str, quote: str) -> str:
        return f'{base}-{quote}'

    def ticker(self, base: str, quote: str) -> Optional[dict]:
        inst = self._inst_id(base, quote)
        data = _http_get_json(f'{self.BASE}/api/v5/market/ticker?instId={inst}')
        if not data or data.get('code') != '0' or not data.get('data'):
            return None
        d = data['data'][0]
        last = float(d.get('last') or 0)
        open24 = float(d.get('open24h') or 0)
        change_pct = ((last - open24) / open24 * 100) if open24 else None
        return {
            'symbol': f'{base}/{quote}',
            'base': base, 'quote': quote,
            'price': last,
            'change_pct': round(change_pct, 2) if change_pct is not None else None,
            'change_amt': round(last - open24, 8) if open24 else None,
            'open': open24 or None,
            'high': float(d.get('high24h') or 0) or None,
            'low': float(d.get('low24h') or 0) or None,
            'prev_close': open24 or None,
            'volume': float(d.get('vol24h') or 0) or None,
            'turnover': float(d.get('volCcy24h') or 0) or None,
            'source': self.name,
        }

    def kline(self, base: str, quote: str, period: str, count: int) -> Optional[list[dict]]:
        bar = _PERIOD_MAP.get(period, ('1D', '1d', 90))[0]
        inst = self._inst_id(base, quote)
        data = _http_get_json(
            f'{self.BASE}/api/v5/market/candles?instId={inst}&bar={bar}&limit={min(count, 300)}'
        )
        if not data or data.get('code') != '0' or not data.get('data'):
            return None
        # OKX 返回 [ts, o, h, l, c, vol, volCcy, volCcyQuote, confirm], 新→旧
        bars = []
        for row in reversed(data['data']):
            try:
                bars.append({
                    'time': _ts_to_label(int(row[0]), period),
                    'open': float(row[1]),
                    'high': float(row[2]),
                    'low': float(row[3]),
                    'close': float(row[4]),
                    'volume': float(row[5]),
                    'turnover': float(row[7]) if row[7] else 0.0,
                })
            except (ValueError, IndexError):
                continue
        return bars or None

    def funding_rate(self, base: str, quote: str) -> Optional[float]:
        """永续合约资金费率 (%),非永续返回 None。"""
        inst = f'{base}-{quote}-SWAP'
        data = _http_get_json(f'{self.BASE}/api/v5/public/funding-rate?instId={inst}')
        if not data or data.get('code') != '0' or not data.get('data'):
            return None
        try:
            return round(float(data['data'][0].get('fundingRate') or 0) * 100, 4)
        except (ValueError, KeyError):
            return None

    def open_interest(self, base: str, quote: str) -> Optional[float]:
        inst = f'{base}-{quote}-SWAP'
        data = _http_get_json(f'{self.BASE}/api/v5/market/open-interest?instId={inst}')
        if not data or data.get('code') != '0' or not data.get('data'):
            return None
        try:
            return float(data['data'][0].get('oi') or 0)
        except (ValueError, KeyError):
            return None


# ═══════════════════════════════════════════════════════════════
# Binance 数据源
# ═══════════════════════════════════════════════════════════════

class BinanceSource:
    name = 'binance'
    BASE = 'https://api.binance.com'
    FAPI = 'https://fapi.binance.com'

    def ticker(self, base: str, quote: str) -> Optional[dict]:
        symbol = f'{base}{quote}'
        d = _http_get_json(f'{self.BASE}/api/v3/ticker/24hr?symbol={symbol}')
        if not d or 'lastPrice' not in d:
            return None
        try:
            last = float(d['lastPrice'])
            open24 = float(d.get('openPrice') or 0)
            return {
                'symbol': f'{base}/{quote}',
                'base': base, 'quote': quote,
                'price': last,
                'change_pct': round(float(d.get('priceChangePercent') or 0), 2),
                'change_amt': float(d.get('priceChange') or 0),
                'open': open24 or None,
                'high': float(d.get('highPrice') or 0) or None,
                'low': float(d.get('lowPrice') or 0) or None,
                'prev_close': float(d.get('weightedAvgPrice') or 0) or None,
                'volume': float(d.get('volume') or 0),
                'turnover': float(d.get('quoteVolume') or 0),
                'source': self.name,
            }
        except (ValueError, KeyError):
            return None

    def kline(self, base: str, quote: str, period: str, count: int) -> Optional[list[dict]]:
        interval = _PERIOD_MAP.get(period, ('1D', '1d', 90))[1]
        symbol = f'{base}{quote}'
        data = _http_get_json(
            f'{self.BASE}/api/v3/klines?symbol={symbol}&interval={interval}&limit={min(count, 500)}'
        )
        if not isinstance(data, list) or not data:
            return None
        bars = []
        for row in data:
            try:
                bars.append({
                    'time': _ts_to_label(int(row[0]), period),
                    'open': float(row[1]),
                    'high': float(row[2]),
                    'low': float(row[3]),
                    'close': float(row[4]),
                    'volume': float(row[5]),
                    'turnover': float(row[7]),
                })
            except (ValueError, IndexError):
                continue
        return bars or None

    def funding_rate(self, base: str, quote: str) -> Optional[float]:
        symbol = f'{base}{quote}'
        d = _http_get_json(f'{self.FAPI}/fapi/v1/premiumIndex?symbol={symbol}')
        if not d or 'lastFundingRate' not in d:
            return None
        try:
            return round(float(d['lastFundingRate']) * 100, 4)
        except (ValueError, KeyError):
            return None

    def long_short_ratio(self, base: str, quote: str) -> Optional[dict]:
        """全网多空账户比 (近 5 分钟)。"""
        symbol = f'{base}{quote}'
        data = _http_get_json(
            f'{self.FAPI}/futures/data/globalLongShortAccountRatio?symbol={symbol}&period=5m&limit=1'
        )
        if not isinstance(data, list) or not data:
            return None
        try:
            d = data[-1]
            long_pct = float(d.get('longAccount') or 0) * 100
            short_pct = float(d.get('shortAccount') or 0) * 100
            return {
                'long_pct': round(long_pct, 2),
                'short_pct': round(short_pct, 2),
                'ratio': round(long_pct / short_pct, 3) if short_pct else None,
            }
        except (ValueError, KeyError, IndexError):
            return None


# ═══════════════════════════════════════════════════════════════
# CoinGecko 数据源
# ═══════════════════════════════════════════════════════════════

_CG_ID_MAP = {
    'BTC': 'bitcoin', 'ETH': 'ethereum', 'SOL': 'solana', 'BNB': 'binancecoin',
    'XRP': 'ripple', 'DOGE': 'dogecoin', 'ADA': 'cardano', 'AVAX': 'avalanche-2',
    'LINK': 'chainlink', 'DOT': 'polkadot', 'LTC': 'litecoin', 'TRX': 'tron',
    'TON': 'the-open-network', 'NEAR': 'near', 'APT': 'aptos', 'SUI': 'sui',
    'ARB': 'arbitrum', 'OP': 'optimism', 'FIL': 'filecoin', 'ATOM': 'cosmos',
    'UNI': 'uniswap', 'AAVE': 'aave', 'PEPE': 'pepe', 'SHIB': 'shiba-inu',
}


class CoinGeckoSource:
    name = 'coingecko'
    BASE = 'https://api.coingecko.com/api/v3'

    def _coin_id(self, base: str) -> Optional[str]:
        return _CG_ID_MAP.get(base)

    def ticker(self, base: str, quote: str) -> Optional[dict]:
        cid = self._coin_id(base)
        if not cid:
            return None
        data = _http_get_json(
            f'{self.BASE}/coins/markets?vs_currency=usd&ids={cid}'
            '&price_change_percentage=24h&sparkline=false'
        )
        if not isinstance(data, list) or not data:
            return None
        d = data[0]
        try:
            last = float(d.get('current_price') or 0)
            change_pct = float(d.get('price_change_percentage_24h') or 0)
            prev = last / (1 + change_pct / 100) if change_pct != -100 and last else None
            return {
                'symbol': f'{base}/{quote}',
                'base': base, 'quote': quote,
                'price': last,
                'change_pct': round(change_pct, 2),
                'change_amt': round(last - prev, 8) if prev else None,
                'open': prev,
                'high': float(d.get('high_24h') or 0) or None,
                'low': float(d.get('low_24h') or 0) or None,
                'prev_close': prev,
                'volume': float(d.get('total_volume') or 0),
                'turnover': float(d.get('total_volume') or 0),
                'market_cap': float(d.get('market_cap') or 0) or None,
                'market_cap_rank': d.get('market_cap_rank'),
                'circulating_supply': float(d.get('circulating_supply') or 0) or None,
                'source': self.name,
            }
        except (ValueError, KeyError):
            return None

    def kline(self, base: str, quote: str, period: str, count: int) -> Optional[list[dict]]:
        cid = self._coin_id(base)
        if not cid:
            return None
        days = _PERIOD_MAP.get(period, ('1D', '1d', 90))[2]
        data = _http_get_json(
            f'{self.BASE}/coins/{cid}/market_chart?vs_currency=usd&days={days}'
        )
        if not data or 'prices' not in data:
            return None
        prices = data['prices']
        vols = data.get('total_volumes', [])
        # 收敛到目标条数
        step = max(1, len(prices) // max(count, 1))
        bars = []
        for i in range(0, len(prices), step):
            try:
                ts, close = prices[i]
                vol = vols[i][1] if i < len(vols) else 0
                nxt = prices[i + step][1] if i + step < len(prices) else close
                bars.append({
                    'time': _ts_to_label(int(ts), period),
                    'open': close,          # 区间近似
                    'high': max(close, nxt),
                    'low': min(close, nxt),
                    'close': close,
                    'volume': float(vol),
                    'turnover': 0.0,
                })
            except (ValueError, IndexError):
                continue
        return bars or None


# ═══════════════════════════════════════════════════════════════
# 恐慌贪婪指数 (Alternative.me)
# ═══════════════════════════════════════════════════════════════

def fetch_fear_greed() -> Optional[dict]:
    """加密市场恐慌贪婪指数 (0-100, 0=极度恐慌, 100=极度贪婪)。"""
    data = _http_get_json('https://api.alternative.me/fng/?limit=1')
    if not data or 'data' not in data or not data['data']:
        return None
    d = data['data'][0]
    try:
        return {
            'value': int(d.get('value') or 0),
            'label': d.get('value_classification') or '',
            'timestamp': d.get('timestamp'),
        }
    except (ValueError, KeyError):
        return None


# ═══════════════════════════════════════════════════════════════
# 统一入口
# ═══════════════════════════════════════════════════════════════

class CryptoAPI:
    """
    加密货币行情统一入口, 多源 fallback。

    用法:
        api = CryptoAPI()
        quote = api.getRealtimeQuote('BTC')          # 或 'BTCUSDT', 'btc-usdt'
        kline = api.getKlineData('ETH', 'daily', 60)
        sentiment = api.getSentiment('BTC')
    """

    def __init__(self):
        self._sources = [OkxSource(), BinanceSource(), CoinGeckoSource()]

    def _pick_source_for(self, method: str, *args):
        """按优先级尝试各源, 返回 (source, result)。args 透传给源方法。"""
        for src in self._sources:
            fn = getattr(src, method, None)
            if not fn:
                continue
            try:
                result = fn(*args)
            except Exception:  # noqa: BLE001 — 单源异常不影响 fallback
                logger.warning('[crypto] %s.%s 异常', src.name, method, exc_info=True)
                result = None
            if result:
                return src, result
        return None, None

    def getRealtimeQuote(self, symbol: str) -> dict:
        """
        获取实时行情 (含资金费率/多空比/恐慌贪婪)。

        返回:
            {'success': True, 'symbol': 'BTC/USDT', 'price': ..., 'funding_rate': ...,
             'long_short': {...}, 'fear_greed': {...}, 'source': 'okx', ...}
        """
        t0 = time.time()
        base, quote = normalise_symbol(symbol)
        _, quote_data = self._pick_source_for('ticker', base, quote)
        if not quote_data:
            return {'success': False, 'error': '数据加载失败，请重试',
                    'symbol': f'{base}/{quote}'}

        # 补充情绪指标 (失败不致命)
        funding = None
        long_short = None
        oi = None
        for src in self._sources:
            if funding is None and hasattr(src, 'funding_rate'):
                try:
                    funding = src.funding_rate(base, quote)
                except Exception:  # noqa: BLE001
                    funding = None
            if long_short is None and hasattr(src, 'long_short_ratio'):
                try:
                    long_short = src.long_short_ratio(base, quote)
                except Exception:  # noqa: BLE001
                    long_short = None
            if oi is None and hasattr(src, 'open_interest'):
                try:
                    oi = src.open_interest(base, quote)
                except Exception:  # noqa: BLE001
                    oi = None
            if funding is not None and long_short is not None:
                break

        fg = fetch_fear_greed()

        quote_data.update({
            'success': True,
            'funding_rate': funding,
            'long_short': long_short,
            'open_interest': oi,
            'fear_greed': fg,
            'trading': True,  # 加密 7x24
            'update_time': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'elapsed_ms': round((time.time() - t0) * 1000),
        })
        return quote_data

    def getKlineData(self, symbol: str, period: str = 'daily', count: int = 60) -> dict:
        """获取 K 线,多源 fallback。"""
        base, quote = normalise_symbol(symbol)
        _, bars = self._pick_source_for('kline', base, quote, period, count)
        if not bars:
            return {'success': False, 'error': '数据加载失败，请重试',
                    'symbol': f'{base}/{quote}', 'code': f'{base}/{quote}',
                    'period': period, 'bars': []}
        return {
            'success': True,
            'symbol': f'{base}/{quote}',
            'code': f'{base}/{quote}',
            'period': period,
            'count': len(bars),
            'bars': bars[-count:],
        }

    def getSentiment(self, symbol: str) -> dict:
        """市场情绪: 资金费率 + 多空比 + 恐慌贪婪指数。"""
        base, quote = normalise_symbol(symbol)
        funding = None
        long_short = None
        for src in self._sources:
            if funding is None and hasattr(src, 'funding_rate'):
                try:
                    funding = src.funding_rate(base, quote)
                except Exception:  # noqa: BLE001
                    funding = None
            if long_short is None and hasattr(src, 'long_short_ratio'):
                try:
                    long_short = src.long_short_ratio(base, quote)
                except Exception:  # noqa: BLE001
                    long_short = None
        return {
            'success': True,
            'symbol': f'{base}/{quote}',
            'funding_rate': funding,
            'long_short': long_short,
            'fear_greed': fetch_fear_greed(),
        }

    def searchCoins(self, keyword: str) -> dict:
        """简单币种搜索 (本地词典 + CoinGecko 兜底)。"""
        kw = (keyword or '').strip().upper()
        if not kw:
            return {'success': True, 'results': []}
        results = []
        for sym in sorted(set(_CG_ID_MAP.keys())):
            if kw in sym:
                results.append({'symbol': f'{sym}/USDT', 'base': sym, 'quote': 'USDT',
                                'name': sym})
        if not results:
            # CoinGecko 模糊搜索兜底
            from urllib.parse import quote as url_quote
            data = _http_get_json(
                f'{CoinGeckoSource.BASE}/search?query={url_quote(kw)}')
            if data and 'coins' in data:
                for c in data['coins'][:8]:
                    results.append({'symbol': f"{(c.get('symbol') or '').upper()}/USDT",
                                    'base': (c.get('symbol') or '').upper(),
                                    'quote': 'USDT', 'name': c.get('name')})
        return {'success': True, 'keyword': keyword, 'results': results}


# 单例
_crypto_api: CryptoAPI | None = None


def get_crypto_api() -> CryptoAPI:
    global _crypto_api
    if _crypto_api is None:
        _crypto_api = CryptoAPI()
    return _crypto_api
