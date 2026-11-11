"""
US Stock API — 美股行情统一服务

多源 fallback (与 crypto_api 同模式):
  1. Yahoo Finance chart API (免 key, 含盘前盘后/52周/公司名)  — 主源
  2. Stooq CSV (免 key)                                        — 备源

情绪数据:
  - VIX 恐慌指数 (^VIX) → 映射为恐慌贪婪 0-100

交易时段 (美股关键差异, 7x24 不适用):
  - pre  盘前 04:00-09:30 ET
  - regular 盘中 09:30-16:00 ET
  - post 盘后 16:00-20:00 ET
  - closed 休市
"""

from __future__ import annotations

import json
import logging
import re
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone, timedelta
from typing import Optional

logger = logging.getLogger(__name__)

_HTTP_TIMEOUT = 8
_ET_OFFSET = timedelta(hours=-5)   # EST 近似 (未处理夏令时, 仅用于状态标签兜底)


# ═══════════════════════════════════════════════════════════════
# HTTP 工具 (与 crypto_api 相同的代理策略)
# ═══════════════════════════════════════════════════════════════

def _build_opener() -> urllib.request.OpenerDirector:
    import os
    proxy = os.environ.get('SNAPVISION_PROXY', '').strip()
    if proxy:
        handler = urllib.request.ProxyHandler({'http': proxy, 'https': proxy})
        return urllib.request.build_opener(handler)
    return urllib.request.build_opener()


_opener: Optional[urllib.request.OpenerDirector] = None


def _http_get_json(url: str, timeout: int = _HTTP_TIMEOUT) -> Optional[dict | list]:
    global _opener
    try:
        if _opener is None:
            _opener = _build_opener()
        req = urllib.request.Request(url, headers={
            'User-Agent': 'Mozilla/5.0 (SnapVision/0.1 us-stock)',
            'Accept': 'application/json',
        })
        with _opener.open(req, timeout=timeout) as resp:
            body = resp.read().decode('utf-8')
        return json.loads(body)
    except Exception as e:  # noqa: BLE001 — 网络层统一兜底
        logger.info('[usstock] GET %s 失败: %s', url[:80], e)
        return None


def _http_get_text(url: str, timeout: int = _HTTP_TIMEOUT) -> Optional[str]:
    global _opener
    try:
        if _opener is None:
            _opener = _build_opener()
        req = urllib.request.Request(url, headers={
            'User-Agent': 'Mozilla/5.0 (SnapVision/0.1 us-stock)',
        })
        with _opener.open(req, timeout=timeout) as resp:
            return resp.read().decode('utf-8', errors='replace')
    except Exception as e:  # noqa: BLE001
        logger.info('[usstock] GET %s 失败: %s', url[:80], e)
        return None


# ═══════════════════════════════════════════════════════════════
# 代码归一化 + 交易时段
# ═══════════════════════════════════════════════════════════════

def normalise_us_symbol(raw: str) -> str:
    """
    归一化美股代码 → 'AAPL' / 'BRK-A'。
    安全: 先校验原始形态 (1-5 字母 + 可选 .A/.B) 再归一, 不合法一律回退 'AAPL',
    防 URL 注入 (如 'AAPL&foo=1' 不能被清洗成合法码)。
    """
    s = (raw or '').strip().upper().replace('$', '').replace(' ', '')
    if not re.fullmatch(r'[A-Z]{1,5}(?:[.\-][AB])?', s):
        return 'AAPL'
    return s.replace('.', '-')          # Yahoo 用 BRK-A 形态


def is_us_market_open(now: Optional[datetime] = None) -> dict:
    """
    返回美股交易时段四态:
      {'state': 'pre'|'regular'|'post'|'closed',
       'label': '盘前交易'|'盘中'|'盘后交易'|'休市',
       'et_time': '2026-11-11 05:52 ET'}
    以美东时间判定 (近似 EST, 周末休市; 未含节假日日历)。
    """
    now_utc = now or datetime.now(timezone.utc)
    et = now_utc + _ET_OFFSET
    weekday = et.weekday()          # 0=周一
    minutes = et.hour * 60 + et.minute

    if weekday >= 5:
        state, label = 'closed', '休市'
    elif 4 * 60 <= minutes < 9 * 60 + 30:
        state, label = 'pre', '盘前交易'
    elif 9 * 60 + 30 <= minutes < 16 * 60:
        state, label = 'regular', '盘中'
    elif 16 * 60 <= minutes < 20 * 60:
        state, label = 'post', '盘后交易'
    else:
        state, label = 'closed', '休市'

    return {
        'state': state,
        'label': label,
        'et_time': et.strftime('%Y-%m-%d %H:%M ET'),
    }


# 统一周期名 → (yahoo interval, yahoo range)
YAHOO_INTERVALS: dict[str, tuple[str, str]] = {
    '5min':   ('5m', '5d'),
    '15min':  ('15m', '5d'),
    '30min':  ('30m', '5d'),
    '60min':  ('60m', '1mo'),
    'daily':  ('1d', '60d'),
    'weekly': ('1wk', '2y'),
    'monthly': ('1mo', '5y'),
}


def map_period(period: str) -> tuple[str, str]:
    return YAHOO_INTERVALS.get(period, ('1d', '60d'))


def _ts_to_label(ts: int, period: str) -> str:
    dt = datetime.fromtimestamp(ts, tz=timezone.utc)
    if period in ('daily', 'weekly', 'monthly'):
        return dt.strftime('%Y-%m-%d')
    return dt.strftime('%Y-%m-%d %H:%M')


# ═══════════════════════════════════════════════════════════════
# Yahoo Finance 数据源
# ═══════════════════════════════════════════════════════════════

class YahooSource:
    name = 'yahoo'
    BASE = 'https://query1.finance.yahoo.com'

    def quote(self, symbol: str) -> Optional[dict]:
        """实时报价 (含盘前盘后/52周/公司名/交易所)。"""
        data = _http_get_json(
            f'{self.BASE}/v8/finance/chart/{symbol}?interval=1d&range=5d')
        if not data:
            return None
        try:
            result = data['chart']['result'][0]
            meta = result['meta']
        except (KeyError, IndexError, TypeError):
            return None

        price = meta.get('regularMarketPrice')
        if price is None:
            return None

        # 涨跌幅: 优先 meta 自带, 否则用 chart 反推前收
        change_pct = meta.get('regularMarketChangePercent')
        prev_close = meta.get('chartPreviousClose')
        if change_pct is None and prev_close:
            change_pct = (price - prev_close) / prev_close * 100
        change_amt = None
        if change_pct is not None and prev_close:
            change_amt = price - prev_close

        # 当日常规时段高低/量
        day_high = meta.get('regularMarketDayHigh')
        day_low = meta.get('regularMarketDayLow')

        return {
            'symbol': symbol,
            'name': meta.get('longName') or meta.get('shortName'),
            'exchange': meta.get('fullExchangeName') or meta.get('exchangeName'),
            'price': float(price),
            'change_pct': round(float(change_pct), 2) if change_pct is not None else None,
            'change_amt': round(float(change_amt), 4) if change_amt is not None else None,
            'open': prev_close,
            'high': float(day_high) if day_high else None,
            'low': float(day_low) if day_low else None,
            'prev_close': float(prev_close) if prev_close else None,
            'volume': float(meta.get('regularMarketVolume') or 0) or None,
            'turnover': None,
            'high_52w': float(meta.get('fiftyTwoWeekHigh')) if meta.get('fiftyTwoWeekHigh') else None,
            'low_52w': float(meta.get('fiftyTwoWeekLow')) if meta.get('fiftyTwoWeekLow') else None,
            'currency': meta.get('currency') or 'USD',
            'source': self.name,
        }

    def kline(self, symbol: str, period: str, count: int) -> Optional[list[dict]]:
        interval, rng = map_period(period)
        data = _http_get_json(
            f'{self.BASE}/v8/finance/chart/{symbol}'
            f'?interval={interval}&range={rng}')
        if not data:
            return None
        try:
            result = data['chart']['result'][0]
            ts_list = result['timestamp']
            q = result['indicators']['quote'][0]
        except (KeyError, IndexError, TypeError):
            return None

        bars = []
        for i, ts in enumerate(ts_list):
            try:
                o, h, l, c = q['open'][i], q['high'][i], q['low'][i], q['close'][i]
                v = (q.get('volume') or [None] * len(ts_list))[i]
                if None in (o, h, l, c):
                    continue
                bars.append({
                    'time': _ts_to_label(int(ts), period),
                    'open': float(o), 'high': float(h),
                    'low': float(l), 'close': float(c),
                    'volume': float(v or 0),
                    'turnover': 0.0,
                })
            except (ValueError, IndexError, TypeError):
                continue
        return bars[-count:] if bars else None

    def vix(self) -> Optional[float]:
        """CBOE VIX 恐慌指数。"""
        data = _http_get_json(
            f'{self.BASE}/v8/finance/chart/%5EVIX?interval=1d&range=1d')
        try:
            return float(data['chart']['result'][0]['meta']['regularMarketPrice'])
        except (KeyError, IndexError, TypeError, ValueError):
            return None

    def search(self, keyword: str) -> Optional[list[dict]]:
        from urllib.parse import quote as url_quote
        data = _http_get_json(
            f'{self.BASE}/v1/finance/search?q={url_quote(keyword)}&quotesCount=8')
        if not data or 'quotes' not in data:
            return None
        out = []
        for q in data['quotes']:
            if q.get('quoteType') not in ('EQUITY', 'ETF', 'INDEX'):
                continue
            out.append({
                'symbol': q.get('symbol'),
                'name': q.get('longname') or q.get('shortname'),
                'exchange': q.get('exchange'),
            })
        return out or None


# ═══════════════════════════════════════════════════════════════
# Stooq 备源 (CSV)
# ═══════════════════════════════════════════════════════════════

class StooqSource:
    name = 'stooq'
    BASE = 'https://stooq.com/q/d/l'

    def kline(self, symbol: str, period: str, count: int) -> Optional[list[dict]]:
        if period not in ('daily', 'weekly', 'monthly'):
            return None   # Stooq 免费版仅日线及以上
        interval = {'daily': 'd', 'weekly': 'w', 'monthly': 'm'}[period]
        text = _http_get_text(
            f'{self.BASE}/?s={symbol.lower()}.us&i={interval}')
        if not text or 'Date' not in text[:20]:
            return None
        bars = []
        lines = text.strip().splitlines()
        for line in lines[1:]:
            parts = line.split(',')
            if len(parts) < 6:
                continue
            try:
                bars.append({
                    'time': parts[0],
                    'open': float(parts[1]), 'high': float(parts[2]),
                    'low': float(parts[3]), 'close': float(parts[4]),
                    'volume': float(parts[5] or 0), 'turnover': 0.0,
                })
            except (ValueError, IndexError):
                continue
        return bars[-count:] if bars else None

    def quote(self, symbol: str) -> Optional[dict]:
        text = _http_get_text(
            f'https://stooq.com/q/l/?s={symbol.lower()}.us&f=sd2t2ohlcv&h&e=csv')
        if not text:
            return None
        try:
            row = text.strip().splitlines()[-1].split(',')
            # Symbol,Date,Time,Open,High,Low,Close,Volume
            return {
                'symbol': symbol,
                'name': None, 'exchange': None,
                'price': float(row[6]),
                'change_pct': None, 'change_amt': None,
                'open': float(row[3]),
                'high': float(row[4]), 'low': float(row[5]),
                'prev_close': None,
                'volume': float(row[7] or 0) if len(row) > 7 else None,
                'turnover': None,
                'high_52w': None, 'low_52w': None,
                'currency': 'USD',
                'source': self.name,
            }
        except (ValueError, IndexError):
            return None


# ═══════════════════════════════════════════════════════════════
# VIX → 恐慌贪婪映射 (与 alternative.me F&G 同量纲 0-100)
# ═══════════════════════════════════════════════════════════════

def _vix_to_fear_greed(vix: float) -> dict:
    # VIX 10 → 80(贪婪), 20 → 50(中性), 30 → 25(恐慌), 40+ → 5(极度恐慌)
    value = max(0, min(100, round(105 - vix * 2.75)))
    if value <= 25:
        label = 'Extreme Fear'
    elif value <= 45:
        label = 'Fear'
    elif value <= 55:
        label = 'Neutral'
    elif value <= 75:
        label = 'Greed'
    else:
        label = 'Extreme Greed'
    return {'value': value, 'label': label, 'vix': round(vix, 2)}


# ═══════════════════════════════════════════════════════════════
# 统一入口
# ═══════════════════════════════════════════════════════════════

class UsStockAPI:
    """
    美股行情统一入口, 多源 fallback。

    用法:
        api = UsStockAPI()
        q = api.getRealtimeQuote('AAPL')
        k = api.getKlineData('TSLA', 'daily', 60)
    """

    def __init__(self):
        self._yahoo = YahooSource()
        self._stooq = StooqSource()

    def getRealtimeQuote(self, symbol: str) -> dict:
        sym = normalise_us_symbol(symbol)
        t0 = time.time()

        quote = self._yahoo.quote(sym) or self._stooq.quote(sym)
        if not quote:
            return {'success': False, 'error': '数据加载失败，请重试', 'symbol': sym}

        # 情绪: VIX → 恐慌贪婪
        vix = self._yahoo.vix()
        quote.update({
            'success': True,
            'fear_greed': _vix_to_fear_greed(vix) if vix else None,
            'market_state': is_us_market_open(),
            'trading': is_us_market_open()['state'] != 'closed',
            'update_time': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'elapsed_ms': round((time.time() - t0) * 1000),
        })
        return quote

    def getKlineData(self, symbol: str, period: str = 'daily', count: int = 60) -> dict:
        sym = normalise_us_symbol(symbol)
        count = max(5, min(int(count), 500))
        bars = self._yahoo.kline(sym, period, count) or self._stooq.kline(sym, period, count)
        if not bars:
            return {'success': False, 'error': '数据加载失败，请重试',
                    'symbol': sym, 'code': sym, 'period': period, 'bars': []}
        return {
            'success': True,
            'symbol': sym,
            'code': sym,
            'period': period,
            'count': len(bars),
            'bars': bars,
        }

    def getSentiment(self, symbol: str) -> dict:
        sym = normalise_us_symbol(symbol)
        vix = self._yahoo.vix()
        return {
            'success': True,
            'symbol': sym,
            'fear_greed': _vix_to_fear_greed(vix) if vix else None,
            'vix': vix,
            'market_state': is_us_market_open(),
        }

    def searchStock(self, keyword: str) -> dict:
        kw = (keyword or '').strip()
        if not kw:
            return {'success': True, 'results': []}
        results = self._yahoo.search(kw) or []
        return {'success': True, 'keyword': keyword, 'results': results}


_us_api: UsStockAPI | None = None


def get_us_stock_api() -> UsStockAPI:
    global _us_api
    if _us_api is None:
        _us_api = UsStockAPI()
    return _us_api
